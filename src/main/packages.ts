// Libraries for hook scripts: npm, run on the app's own Node.
//
// A hook script imports what it likes, and what it likes has to be in a
// node_modules it can see. The app carries npm for that, and runs it the way
// it runs hook scripts — its own executable, started as Node — so installing
// a library needs no Node on the machine either. Packages go into the open
// folder, exactly where `npm install` typed in a terminal there would put
// them, with the same package.json and lockfile beside them.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { LineSplitter, stripAnsi } from '../core/runner';
import type { InstalledPackage, RuntimeInfo, Settings } from '../shared/api';
import { isPackageName, parsePackageSpecs } from '../shared/packages';

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export class PackageService {
  private busy = false;

  constructor(
    private readonly settings: () => Settings,
    /** npm's own folder, whole and on disk: it is run by a Node outside the app. */
    private readonly npmDir: string,
    private readonly emit: (line: string) => void,
  ) {}

  private get npmCli(): string {
    return path.join(this.npmDir, 'bin', 'npm-cli.js');
  }

  runtime(): RuntimeInfo {
    const npm = readJson(path.join(this.npmDir, 'package.json'));
    return {
      node: process.versions.node,
      electron: process.versions.electron ?? '',
      npm: typeof npm?.version === 'string' ? npm.version : '',
    };
  }

  /** What the open folder's package.json asks for, with what is actually installed. */
  list(): InstalledPackage[] {
    const folder = this.settings().workspace;
    if (!folder) return [];
    const manifest = readJson(path.join(folder, 'package.json'));
    if (!manifest) return [];
    const out: InstalledPackage[] = [];
    for (const [field, dev] of [
      ['dependencies', false],
      ['devDependencies', true],
    ] as const) {
      const wanted = manifest[field];
      if (!wanted || typeof wanted !== 'object') continue;
      for (const [name, range] of Object.entries(wanted as Record<string, unknown>)) {
        const installed = readJson(path.join(folder, 'node_modules', ...name.split('/'), 'package.json'));
        out.push({
          name,
          wanted: String(range),
          version: typeof installed?.version === 'string' ? installed.version : '',
          dev,
        });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  install(text: string): Promise<number> {
    return this.npm(['install', ...parsePackageSpecs(text)]);
  }

  remove(name: string): Promise<number> {
    if (!isPackageName(name)) throw new Error(`"${name}" is not a package name.`);
    return this.npm(['uninstall', name]);
  }

  /** Runs npm in the open folder, passing on what it prints; resolves to its exit code. */
  private npm(args: string[]): Promise<number> {
    const folder = this.settings().workspace;
    if (!folder) throw new Error('Open a folder first: libraries are installed into it.');
    if (this.busy) throw new Error('npm is already running; wait for it to finish.');
    this.busy = true;

    const full = [this.npmCli, ...args, '--no-fund', '--no-audit', '--no-progress', '--no-update-notifier'];
    this.emit(`$ npm ${args.join(' ')}`);
    return new Promise((resolve) => {
      const child = spawn(process.execPath, full, {
        cwd: folder,
        // The app's executable is a Node when told so. npm passes this on to
        // whatever it starts, so a package's own scripts get a Node too.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const done = (code: number): void => {
        if (!this.busy) return;
        this.busy = false;
        this.emit(code === 0 ? 'npm finished.' : `npm failed with exit code ${code}.`);
        resolve(code);
      };
      for (const stream of [child.stdout, child.stderr]) {
        const lines = new LineSplitter();
        stream.setEncoding('utf8');
        stream.on('data', (chunk: string) => lines.push(chunk).forEach((l) => l.trim() && this.emit(stripAnsi(l))));
        stream.on('end', () => lines.flush().forEach((l) => l.trim() && this.emit(stripAnsi(l))));
      }
      child.on('error', (err) => {
        this.emit(`npm could not be started: ${err.message}`);
        done(1);
      });
      child.on('close', (code) => done(code ?? 1));
    });
  }
}
