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
 * Writes the launcher and returns its path, for MANUL_NODE.
 *
 * @param dir          a folder the app may write to
 * @param executable   the app's own executable (Electron)
 * @param bindingRoot  the folder whose node_modules has `manul-browser`, as
 *                     real files on disk
 */
export function builtInNode(dir: string, executable: string, bindingRoot: string): string {
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
    fs.writeFileSync(
      launcher,
      ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `"${executable}" ${importFlag} %*`, ''].join('\r\n'),
    );
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
