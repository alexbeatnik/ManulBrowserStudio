// Git, for the open folder: what has changed, and the handful of things a
// person does about it — commit, pull, push, settle a conflict.
//
// This is the git on the machine, run as a command and read back; the app
// carries none of its own. A person who works in a repository has one, and it
// is the one that knows their credentials and their settings.

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitDiff, GitFile, GitResolution, GitState, GitStatus } from '../shared/api';
import { hasConflicts } from '../shared/conflicts';
import { isInside } from './workspace';

/** What a run, or an installed library, leaves in a folder of hunts. */
const LEFT_BY_RUNS = ['reports/', 'screenshots/', 'node_modules/'];

/** More of a file than this is not shown side by side. */
const DIFF_LIMIT = 2 << 20;

/**
 * How much of one command line may be the names of files. Windows takes
 * 32,767 characters for the whole of it, and refuses to start a longer one.
 */
const NAMES_LIMIT = 20_000;

/**
 * A file's name for git, as that name and nothing else. Git reads a name as a
 * pattern — `[ab].hunt` is also `a.hunt` — unless it is told not to. Said of
 * each name, and not with GIT_LITERAL_PATHSPECS: that would be handed on to
 * the repository's hooks, whose own patterns it would break.
 */
const literal = (file: string): string => `:(literal)${file}`;

/** The names in as many lots as it takes for each to fit on a command line. */
export function lots(files: string[], limit = NAMES_LIMIT): string[][] {
  const out: string[][] = [];
  let size = 0;
  for (const file of files) {
    // With the quotes around it and the space after it.
    const cost = literal(file).length + 3;
    if (out.length === 0 || size + cost > limit) {
      out.push([]);
      size = 0;
    }
    out[out.length - 1].push(file);
    size += cost;
  }
  return out;
}

/** How much of a command is written to the log; a commit of a thousand files names them all. */
const LOGGED = 400;

const NO_REPO: GitStatus = {
  available: true,
  repo: false,
  root: '',
  branch: '',
  upstream: '',
  ahead: 0,
  behind: 0,
  operation: '',
  files: [],
};

/**
 * Reads `git status --porcelain=v2 --branch -z`: the branch and its upstream
 * from the header, and a record a file. Records end in NUL; one for a rename
 * is followed by a second with the name the file had.
 */
export function parseStatus(text: string): Pick<GitStatus, 'branch' | 'upstream' | 'ahead' | 'behind'> & {
  files: Array<Omit<GitFile, 'file'>>;
} {
  const out = { branch: '', upstream: '', ahead: 0, behind: 0, files: [] as Array<Omit<GitFile, 'file'>> };
  const records = text.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length);
      out.branch = head === '(detached)' ? '' : head;
    } else if (record.startsWith('# branch.upstream ')) {
      out.upstream = record.slice('# branch.upstream '.length);
    } else if (record.startsWith('# branch.ab ')) {
      const counts = record.match(/\+(\d+) -(\d+)/);
      if (counts) [out.ahead, out.behind] = [Number(counts[1]), Number(counts[2])];
    } else if (record.startsWith('? ')) {
      out.files.push({ path: record.slice(2), state: 'untracked' });
    } else if (record.startsWith('u ')) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      out.files.push({ path: record.split(' ').slice(10).join(' '), state: 'conflict' });
    } else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      // 1 XY sub mH mI mW hH hI path
      // 2 XY sub mH mI mW hH hI Xscore path, then the old name
      const renamed = record[0] === '2';
      const fields = record.split(' ');
      const xy = fields[1];
      const state: GitState = renamed
        ? 'renamed'
        : xy.includes('D')
          ? 'deleted'
          : xy.includes('A')
            ? 'added'
            : 'modified';
      const file: Omit<GitFile, 'file'> = { path: fields.slice(renamed ? 9 : 8).join(' '), state };
      if (renamed) file.from = records[++i];
      out.files.push(file);
    }
  }
  return out;
}

/** What git answered, when it was not what was hoped for. */
class GitError extends Error {}

export class GitService {
  private available?: boolean;

  constructor(
    private readonly folder: () => string,
    private readonly log: (line: string) => void,
  ) {}

  /**
   * Runs git and resolves to what it printed. `quiet` is for the questions
   * the app asks on its own account, which nobody needs to read about.
   */
  private run(cwd: string, args: string[], options: { quiet?: boolean; input?: string } = {}): Promise<string> {
    if (!options.quiet) {
      const typed = args.join(' ');
      this.log(`$ git ${typed.length > LOGGED ? `${typed.slice(0, LOGGED)}…` : typed}`);
    }
    return new Promise((resolve, reject) => {
      const child = execFile(
        'git',
        // Names as they are, not octal escapes, whatever the person's setting.
        ['-c', 'core.quotepath=false', ...args],
        {
          cwd,
          windowsHide: true,
          maxBuffer: 64 << 20,
          // A network operation that never answers is given up on.
          timeout: options.quiet ? 30_000 : 180_000,
          env: {
            ...process.env,
            // Nothing here has a terminal to ask a password in; git's own
            // credential helper asks in a window of its own, and still can.
            GIT_TERMINAL_PROMPT: '0',
            // A status asked in the background must not lock the index
            // against the command a person is typing in a terminal.
            GIT_OPTIONAL_LOCKS: '0',
          },
        },
        (err, stdout, stderr) => {
          if (!options.quiet) for (const line of `${stdout}${stderr}`.split(/\r?\n/)) if (line.trim()) this.log(line);
          if (!err) return resolve(stdout);
          // Why, as git put it. A warning is not the reason — and on Windows
          // there is one a file, about line endings — and the reason may not
          // be on stderr at all: "nothing to commit" is not.
          const reason = stderr
            .split(/\r?\n/)
            .filter((line) => line.trim() && !/^warning:/i.test(line))
            .join('\n');
          reject(new GitError(reason.trim() || stdout.trim() || stderr.trim() || err.message));
        },
      );
      if (options.input !== undefined) child.stdin?.end(options.input);
    });
  }

  /** The top of the repository the open folder is in; '' when it is in none. */
  private async root(): Promise<string> {
    const folder = this.folder();
    if (!folder) return '';
    try {
      return path.normalize((await this.run(folder, ['rev-parse', '--show-toplevel'], { quiet: true })).trim());
    } catch {
      return '';
    }
  }

  private async requireRoot(): Promise<string> {
    const root = await this.root();
    if (!root) throw new Error('The open folder is not in a git repository.');
    return root;
  }

  /** Where a file git names is on disk. A name that leads out of the repository is not one of its files. */
  private onDisk(root: string, file: string): string {
    const target = path.join(root, file);
    if (!isInside(root, target)) throw new Error(`${file} is outside the repository.`);
    return target;
  }

  /**
   * Whether there is a git to run. Asked from the app's own folder, not the
   * open one — a folder that has been deleted cannot run anything, and that
   * is not git's absence. A no is asked again: git may be installed since.
   */
  private async hasGit(): Promise<boolean> {
    if (!this.available) {
      this.available = await this.run(process.cwd(), ['--version'], { quiet: true }).then(
        () => true,
        () => false,
      );
    }
    return this.available;
  }

  private async operation(root: string): Promise<GitStatus['operation']> {
    const dir = path.resolve(root, (await this.run(root, ['rev-parse', '--git-dir'], { quiet: true })).trim());
    if (fs.existsSync(path.join(dir, 'rebase-merge')) || fs.existsSync(path.join(dir, 'rebase-apply'))) return 'rebase';
    if (fs.existsSync(path.join(dir, 'MERGE_HEAD'))) return 'merge';
    return '';
  }

  async status(): Promise<GitStatus> {
    if (!(await this.hasGit())) return { ...NO_REPO, available: false };
    const root = await this.root();
    if (!root) return NO_REPO;
    try {
      const text = await this.run(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], {
        quiet: true,
      });
      const parsed = parseStatus(text);
      const files = parsed.files.map((f): GitFile => {
        const file = path.join(root, f.path);
        if (f.state !== 'conflict') return { ...f, file };
        let unresolved = false;
        try {
          unresolved = hasConflicts(fs.readFileSync(file, 'utf8'));
        } catch {
          // Deleted on one side: there is no text to have a conflict in.
        }
        return { ...f, file, unresolved };
      });
      // Conflicts first: they are what stands in the way of everything else.
      files.sort((a, b) => Number(b.state === 'conflict') - Number(a.state === 'conflict') || a.path.localeCompare(b.path));
      return { ...parsed, available: true, repo: true, root, operation: await this.operation(root), files };
    } catch {
      return NO_REPO;
    }
  }

  /**
   * Makes the open folder a repository. A folder of hunts fills with what
   * runs leave behind — reports, screenshots, the libraries of hook scripts —
   * none of which is the project: with no .gitignore of its own, it is given
   * one that says so.
   */
  async init(): Promise<void> {
    const folder = this.folder();
    if (!folder) throw new Error('Open a folder first.');
    await this.run(folder, ['init']);
    const ignore = path.join(folder, '.gitignore');
    if (!fs.existsSync(ignore)) {
      fs.writeFileSync(ignore, `${LEFT_BY_RUNS.join('\n')}\n`);
      this.log(`.gitignore written: ${LEFT_BY_RUNS.join(', ')}`);
    }
  }

  async diff(file: string): Promise<GitDiff> {
    const root = await this.requireRoot();
    const target = this.onDisk(root, file);
    const status = await this.status();
    const entry = status.files.find((f) => f.path === file);
    const read = (buffer: Buffer | undefined): string | undefined => {
      if (!buffer) return '';
      // A NUL is the sign git itself goes by.
      if (buffer.length > DIFF_LIMIT || buffer.includes(0)) return undefined;
      return buffer.toString('utf8');
    };
    const committed = await new Promise<Buffer | undefined>((resolve) => {
      // An untracked or added file was not there at the last commit.
      if (entry?.state === 'untracked' || entry?.state === 'added') return resolve(undefined);
      execFile(
        'git',
        ['show', `HEAD:${entry?.from ?? file}`],
        { cwd: root, windowsHide: true, encoding: 'buffer', maxBuffer: 64 << 20 },
        (err, stdout) => resolve(err ? undefined : stdout),
      );
    });
    let now: Buffer | undefined;
    try {
      now = fs.readFileSync(target);
    } catch {
      // Deleted.
    }
    const original = read(committed);
    const modified = read(now);
    if (original === undefined || modified === undefined) return { original: '', modified: '', opaque: true };
    return { original, modified, opaque: false };
  }

  /**
   * Commits the named files as they are on disk. Only those: what else is
   * changed, or was staged in a terminal, stays as it was.
   */
  async commit(message: string, paths: string[]): Promise<void> {
    const root = await this.requireRoot();
    const text = message.trim();
    if (!text) throw new Error('Say what the commit is, in a line.');
    if (paths.length === 0) throw new Error('Nothing is chosen to commit.');
    const status = await this.status();
    if (status.operation) throw new Error(`A ${status.operation} is in progress; finish it or give it up first.`);
    // The old name of a renamed file is part of the same change.
    const renamed = new Map(status.files.map((f) => [f.path, f.from]));
    const all = [...new Set(paths.flatMap((p) => [p, renamed.get(p) ?? p]))];

    // The index is told of each as it is on disk. One that is not there is
    // taken out of it, and not with `git add`: a name that is in neither
    // place — the old one of a file renamed with `git mv` — is to `git add`
    // a name it knows nothing of, and it refuses the lot.
    const there = (file: string): boolean => {
      try {
        // Not followed: a link that leads nowhere is still there.
        fs.lstatSync(file);
        return true;
      } catch {
        return false;
      }
    };
    const gone = new Set(all.filter((p) => !there(this.onDisk(root, p))));
    for (const lot of lots(all.filter((p) => !gone.has(p)))) await this.run(root, ['add', '-A', '--', ...lot.map(literal)]);
    for (const lot of lots([...gone])) {
      await this.run(root, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...lot.map(literal)]);
    }

    // What that came to. Not everything chosen need be in it: a file added
    // in a terminal and deleted before it was ever committed is no change at
    // all, and a name git has nothing to say of would stop the commit.
    // (An untracked repository is listed as `name/`, and staged as `name`.)
    const chosen = new Set(all.map((p) => p.replace(/\/$/, '')));
    const inIndex = (await this.run(root, ['diff', '--cached', '--name-only', '--no-renames', '-z'], { quiet: true }))
      .split('\0')
      .filter(Boolean);
    const staged = inIndex.filter((p) => chosen.has(p));
    if (staged.length === 0) throw new Error('Nothing of what is chosen has changed since the last commit.');

    // The message by stdin: a line of it is not to be read as an option.
    // With nothing else staged the index is the commit, and is committed as
    // it stands. Naming the files would have git read each from disk again,
    // where a name that changed only its case is still the name it had.
    if (staged.length === inIndex.length) {
      await this.run(root, ['commit', '-F', '-'], { input: text });
      return;
    }
    if (lots(staged).length === 1) {
      await this.run(root, ['commit', '-F', '-', '--', ...staged.map(literal)], { input: text });
      return;
    }
    // More names than a command line holds are read from a file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manul-browser-studio-commit-'));
    try {
      const list = path.join(dir, 'paths');
      fs.writeFileSync(list, staged.map(literal).join('\0'));
      await this.run(root, ['commit', '-F', '-', `--pathspec-from-file=${list}`, '--pathspec-file-nul'], { input: text });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async pull(): Promise<void> {
    const root = await this.requireRoot();
    // How two branches that have both moved are brought together is for the
    // person to have said; git refuses to guess. Where they have not, it is
    // a merge, which is what every git did before it began to ask.
    const preference = await this.run(root, ['config', '--get', 'pull.rebase'], { quiet: true }).catch(() => '');
    const args = preference.trim() ? ['pull'] : ['pull', '--no-rebase'];
    try {
      await this.run(root, args);
    } catch (err) {
      // A conflict is not a failure of the pull but the next thing to do.
      if ((await this.operation(root)) === '') throw err;
    }
  }

  async push(): Promise<void> {
    const root = await this.requireRoot();
    const status = await this.status();
    if (status.upstream) return void (await this.run(root, ['push']));
    if (!status.branch) throw new Error('There is no branch to push: HEAD is detached.');
    const remotes = (await this.run(root, ['remote'], { quiet: true })).split(/\r?\n/).filter(Boolean);
    if (remotes.length === 0) throw new Error('This repository has no remote to push to.');
    const remote = remotes.includes('origin') ? 'origin' : remotes[0];
    await this.run(root, ['push', '--set-upstream', remote, status.branch]);
  }

  async resolve(file: string, how: GitResolution): Promise<void> {
    const root = await this.requireRoot();
    const target = this.onDisk(root, file);
    if (how === 'resolved') {
      let text = '';
      try {
        text = fs.readFileSync(target, 'utf8');
      } catch {
        // Deleted here: staging that is the resolution.
      }
      if (hasConflicts(text)) throw new Error(`${file} still has a conflict in it.`);
    } else {
      // A side that deleted the file has no version of it to check out:
      // taking that side is deleting it. The index says which sides have one
      // — `<mode> <object> <stage>`, where 2 is what was here and 3 what is
      // coming in.
      const wanted = how === 'current' ? '2' : '3';
      const sides = (await this.run(root, ['ls-files', '--unmerged', '-z', '--', literal(file)], { quiet: true }))
        .split('\0')
        .filter(Boolean)
        .map((entry) => entry.split('\t')[0].split(' ')[2]);
      if (sides.length > 0 && !sides.includes(wanted)) {
        await this.run(root, ['rm', '--quiet', '--force', '--', literal(file)]);
        return;
      }
      // git's names for the two sides: what was here, and what is coming in.
      await this.run(root, ['checkout', how === 'current' ? '--ours' : '--theirs', '--', literal(file)]);
    }
    // -A, so that a file that is gone is staged as gone.
    await this.run(root, ['add', '-A', '--', literal(file)]);
  }

  async continue(): Promise<void> {
    const root = await this.requireRoot();
    const status = await this.status();
    if (!status.operation) throw new Error('There is no merge or rebase to finish.');
    const left = status.files.filter((f) => f.state === 'conflict');
    if (left.length) throw new Error(`${left.length === 1 ? left[0].path + ' is' : `${left.length} files are`} still in conflict.`);
    // Neither is to open an editor for a message: the one git wrote stands.
    if (status.operation === 'merge') {
      await this.run(root, ['commit', '--no-edit']);
    } else {
      try {
        await this.run(root, ['-c', 'core.editor=true', 'rebase', '--continue']);
      } catch (err) {
        // The next commit of the rebase may conflict in its turn.
        if ((await this.operation(root)) === '') throw err;
      }
    }
  }

  async abort(): Promise<void> {
    const root = await this.requireRoot();
    const operation = await this.operation(root);
    if (!operation) throw new Error('There is no merge or rebase to give up.');
    await this.run(root, [operation, '--abort']);
  }
}
