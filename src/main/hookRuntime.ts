// The Node that hook scripts run on: the app's own.
//
// The engine starts a `.js` or `.mjs` hook script with whatever MANUL_NODE
// names, or `node` from PATH. A person who installed the app has neither a
// `node` nor, in their folder of hunts, the `manul-browser` package such a
// script imports. The app has both: Electron is a Node, and the binding is
// among its dependencies. This module hands them to the engine.
//
// MANUL_NODE can only name an executable, so it names a small launcher,
// written here, that starts the app's executable as Node with one extra
// module loaded first. That module resolves `manul-browser` to the app's copy
// when — and only when — the script's own project does not have one, so a
// project that pins a version keeps it.

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const REGISTER = (resolver: string, anchor: string): string => `// Written by Manul Browser Studio; rewritten on every run.
import { register } from 'node:module';
register(${JSON.stringify(resolver)}, { data: { anchor: ${JSON.stringify(anchor)} } });
`;

const RESOLVER = `// Written by Manul Browser Studio; rewritten on every run.
//
// Resolves 'manul-browser' to the copy that came with the app when the
// importing script has none of its own.
let anchor;

export function initialize(data) {
  anchor = data.anchor;
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const ours = specifier === 'manul-browser' || specifier.startsWith('manul-browser/');
    if (!ours || !err || err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    return nextResolve(specifier, { ...context, parentURL: anchor });
  }
}
`;

/**
 * Whether Windows can start a batch file at this path whatever it is handed.
 *
 * A batch file is run by `cmd.exe /c <command line>`, and cmd takes the quotes
 * off a line that begins with one and has more than two: a launcher whose
 * path has a space in it, started with a script whose path has one too,
 * becomes `C:\Users\me\AppData\Roaming\Manul` — "not recognized as a
 * command". A path that needs no quotes is never in that position.
 */
export function plainForCmd(file: string): boolean {
  return !/[\s&|()<>^%!"',;=]/.test(file);
}

/**
 * Writes the launcher and returns its path, for MANUL_NODE.
 *
 * @param dirs         folders the app may write to, best first. On Windows
 *                     one that `plainForCmd` is taken ahead of one that is
 *                     not, and the per-user data folder — which has the
 *                     app's name, spaces and all, in it — never is.
 * @param executable   the app's own executable (Electron)
 * @param bindingRoot  the folder whose node_modules has `manul-browser`, as
 *                     real files on disk
 */
export function builtInNode(dirs: string[], executable: string, bindingRoot: string): string {
  const ordered =
    process.platform === 'win32' ? [...dirs.filter(plainForCmd), ...dirs.filter((d) => !plainForCmd(d))] : dirs;
  let failure: unknown = new Error('nowhere to write the launcher for hook scripts');
  for (const dir of ordered) {
    try {
      return writeLauncher(dir, executable, bindingRoot);
    } catch (err) {
      failure = err;
    }
  }
  throw failure;
}

function writeLauncher(dir: string, executable: string, bindingRoot: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const register = path.join(dir, 'register.mjs');
  const resolver = path.join(dir, 'resolve.mjs');
  // Resolution starts from the folder of the importing file; any file name
  // inside bindingRoot stands in for one.
  const anchor = pathToFileURL(path.join(bindingRoot, 'hooks.mjs')).href;
  fs.writeFileSync(resolver, RESOLVER);
  fs.writeFileSync(register, REGISTER(pathToFileURL(resolver).href, anchor));

  const importFlag = `--import "${pathToFileURL(register).href}"`;
  if (process.platform === 'win32') {
    const launcher = path.join(dir, 'node.cmd');
    // `@echo off` is not cosmetic: the script's stdout is the protocol, and
    // an echoed command line on it would be the first thing the engine reads.
    // A percent sign is doubled: in a batch file `%20`, which is how a URL
    // writes a space, is the second argument followed by a zero.
    const line = `"${executable}" ${importFlag}`.replaceAll('%', '%%');
    fs.writeFileSync(launcher, ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `${line} %*`, ''].join('\r\n'));
    return launcher;
  }
  const launcher = path.join(dir, 'node');
  fs.writeFileSync(
    launcher,
    ['#!/bin/sh', `ELECTRON_RUN_AS_NODE=1 exec "${executable}" ${importFlag} "$@"`, ''].join('\n'),
    { mode: 0o755 },
  );
  return launcher;
}
