// Collects the type declarations the editor completes JavaScript and
// TypeScript from, into one file the app ships.
//
// A hook script is Node code that imports `manul-browser`. The editor's
// TypeScript service runs in the window and sees no disk, so it has to be
// handed the declarations of the two things such a script uses: the binding,
// and Node itself. They are gathered here, at build time, rather than read
// from node_modules when the app runs — a packaged app does not have them
// there: the packager leaves every `.d.ts` out.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every `.d.ts` and package.json under `dir`, as paths relative to it. */
function declarations(dir, into = [], rel = '') {
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') declarations(dir, into, child);
    } else if (entry.name.endsWith('.d.ts') || entry.name === 'package.json') {
      into.push(child);
    }
  }
  return into;
}

function library(root, virtual, only = () => true) {
  return declarations(root)
    .filter(only)
    .map((rel) => ({
      path: `node_modules/${virtual}/${rel}`,
      content: readFileSync(join(root, rel), 'utf8'),
    }));
}

/**
 * The declarations, each at the path it should have under a `node_modules`
 * folder. The window puts that folder at the root of the volume the open
 * folder is on, which is above every file in it.
 */
export function collectTypeLibraries(modules = 'node_modules') {
  return [
    // The binding publishes its declarations in dist/ behind an `exports`
    // map. The service resolves packages the classic Node way, so they are
    // laid out flat: `manul-browser` is then `manul-browser/index.d.ts`, and
    // its own `./session.js` imports find their neighbours.
    ...library(join(modules, 'manul-browser', 'dist'), 'manul-browser', (rel) => rel.endsWith('.d.ts')),
    ...library(join(modules, '@types', 'node'), '@types/node'),
    // What @types/node gets `fetch` and its relatives from.
    ...library(join(modules, 'undici-types'), 'undici-types'),
  ];
}
