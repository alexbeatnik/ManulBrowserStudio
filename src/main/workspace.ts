// The files of the open folder.
//
// The window asks for paths by name, so every request is checked against the
// folder that is open: a path outside it is refused rather than read or
// written, whatever sent it.

import * as fs from 'fs/promises';
import * as path from 'path';
import { DirEntry } from '../shared/api';

/** Folders that are never worth listing in an explorer. */
const HIDDEN = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv']);

export function isInside(root: string, target: string): boolean {
  if (!root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export class Workspace {
  constructor(private readonly root: () => string) {}

  private guard(target: string): string {
    const resolved = path.resolve(target);
    if (!isInside(this.root(), resolved)) {
      throw new Error(`${resolved} is outside the open folder`);
    }
    return resolved;
  }

  async list(dir: string): Promise<DirEntry[]> {
    const where = this.guard(dir);
    const entries = await fs.readdir(where, { withFileTypes: true });
    return entries
      .filter((e) => !HIDDEN.has(e.name) && (e.isDirectory() || e.isFile()))
      .map((e) => ({ name: e.name, path: path.join(where, e.name), dir: e.isDirectory() }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  }

  async read(file: string): Promise<string> {
    return fs.readFile(this.guard(file), 'utf8');
  }

  async write(file: string, text: string): Promise<void> {
    await fs.writeFile(this.guard(file), text, 'utf8');
  }

  /** A name for one new entry: no separators, nothing a file system refuses. */
  private entry(dir: string, name: string, kind: string): string {
    const clean = name.trim();
    if (!clean || clean === '.' || clean === '..' || /[\\/:*?"<>|]/.test(clean)) {
      throw new Error(`"${name}" is not a ${kind} name`);
    }
    return this.guard(path.join(dir, clean));
  }

  /** Creates an empty file and refuses to replace one that is there. */
  async create(dir: string, name: string): Promise<string> {
    const file = this.entry(dir, name, 'file');
    await fs.writeFile(file, '', { encoding: 'utf8', flag: 'wx' });
    return file;
  }

  /** Creates a folder; one that is already there is an error, not a success. */
  async mkdir(dir: string, name: string): Promise<string> {
    const folder = this.entry(dir, name, 'folder');
    await fs.mkdir(folder);
    return folder;
  }
}
