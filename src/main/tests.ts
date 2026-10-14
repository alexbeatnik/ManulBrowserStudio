// The hunts of the open folder that are tests: every .hunt file, except the
// ones other hunts borrow blocks from.
//
// A page object (demo/pages/*.hunt) is a .hunt file like any other, but it is
// not meant to be run on its own — its steps read variables the hunt that
// uses them sets. What makes it one is not where it is but that a hunt names
// it in an `@import:` line, so that is what is looked for.

import * as fs from 'fs/promises';
import * as path from 'path';
import type { TestFile } from '../shared/api';
import { HIDDEN } from './workspace';

/** More than this many .hunt files is a folder too big to have been meant. */
const LIMIT = 5000;

/** What the header of a hunt says about it. */
export function huntHeader(text: string): { title: string; tags: string[]; imports: string[] } {
  const title = text.match(/^\s*@title:\s*(.+?)\s*$/m)?.[1] ?? '';
  const tags = (text.match(/^\s*@tags:\s*(.+?)\s*$/m)?.[1] ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const imports = [...text.matchAll(/^\s*@import:.*?\bfrom\s+(['"])(.+?)\1/gm)].map((m) => m[2]);
  return { title, tags, imports };
}

/** Every .hunt file under a folder, leaving out the folders an explorer leaves out. */
async function huntFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= LIMIT) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!HIDDEN.has(entry.name) && !entry.name.startsWith('.')) await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.hunt')) {
        found.push(full);
      }
    }
  };
  await walk(root);
  return found;
}

/** A path as the file system compares it: Windows does not mind case. */
const key = (file: string): string => {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

export async function findTests(root: string): Promise<TestFile[]> {
  if (!root) return [];
  const files = await huntFiles(root);
  const headers = new Map<string, ReturnType<typeof huntHeader>>();
  const borrowed = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const header = huntHeader(text);
    headers.set(file, header);
    for (const source of header.imports) borrowed.add(key(path.join(path.dirname(file), source)));
  }
  return [...headers]
    .filter(([file]) => !borrowed.has(key(file)))
    .map(([file, header]) => ({
      file,
      path: path.relative(root, file).split(path.sep).join('/'),
      title: header.title,
      tags: header.tags,
    }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}
