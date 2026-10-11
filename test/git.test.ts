// Git for the open folder: reading its status, and the service itself against
// real repositories made for the purpose — a remote, and two people's clones
// of it. Needs a git on the machine, and says so and passes without one.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { GitService, lots, parseStatus } from '../src/main/git';
import { findConflicts, hasConflicts, takeAll, takeLines } from '../src/shared/conflicts';

// ── conflicts in a text ─────────────────────────────────────────────────────

const CONFLICTED = [
  'STEP 1: Pay',
  '<<<<<<< HEAD',
  "    CLICK the 'Pay now' button",
  '=======',
  "    CLICK the 'Place order' button",
  "    VERIFY that 'Thank you' is present",
  '>>>>>>> origin/main',
  'DONE.',
];

test('a conflict is found by its markers, and either side of it can be taken', () => {
  const [conflict, ...rest] = findConflicts(CONFLICTED);
  assert.deepEqual(conflict, { start: 1, base: -1, middle: 3, end: 6 });
  assert.equal(rest.length, 0);
  assert.deepEqual(takeLines(CONFLICTED, conflict, 'current'), ["    CLICK the 'Pay now' button"]);
  assert.deepEqual(takeLines(CONFLICTED, conflict, 'incoming').length, 2);
  assert.deepEqual(takeLines(CONFLICTED, conflict, 'both').length, 3);

  assert.equal(
    takeAll(CONFLICTED.join('\r\n'), 'incoming'),
    ['STEP 1: Pay', "    CLICK the 'Place order' button", "    VERIFY that 'Thank you' is present", 'DONE.'].join('\r\n'),
  );
  assert.equal(hasConflicts(takeAll(CONFLICTED.join('\n'), 'both')), false);
});

test('what both sides started from is not either side, and half a conflict is not one', () => {
  // merge.conflictStyle = diff3
  const three = ['<<<<<<< HEAD', 'mine', '||||||| base', 'ours once', '=======', 'theirs', '>>>>>>> other'];
  const [conflict] = findConflicts(three);
  assert.equal(conflict.base, 2);
  assert.deepEqual(takeLines(three, conflict, 'current'), ['mine']);
  assert.deepEqual(takeLines(three, conflict, 'both'), ['mine', 'theirs']);

  // A row of equals signs in a text, or a marker somebody left behind.
  assert.equal(findConflicts(['Title', '=======', 'text', '>>>>>>> not opened']).length, 0);
  assert.equal(findConflicts(['<<<<<<< HEAD', 'never closed', '=======']).length, 0);
  assert.equal(hasConflicts("    VERIFY that '<<<<<<<' is present"), false);
});

// ── reading the status ──────────────────────────────────────────────────────

test('the status is read: the branch, how far it is from its upstream, and each file', () => {
  const text = [
    '# branch.oid 1234567',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaaa bbbb hunts/first order.hunt',
    '1 A. N... 000000 100644 100644 0000 cccc pages/new.hunt',
    '1 .D N... 100644 100644 000000 dddd dddd gone.hunt',
    '2 R. N... 100644 100644 100644 eeee eeee R100 pages/cart.hunt',
    'pages/basket.hunt',
    'u UU N... 100644 100644 100644 100644 f1 f2 f3 hunts/both changed.hunt',
    '? notes.txt',
    '',
  ].join('\0');
  const status = parseStatus(text);
  assert.equal(status.branch, 'main');
  assert.equal(status.upstream, 'origin/main');
  assert.deepEqual([status.ahead, status.behind], [2, 1]);
  assert.deepEqual(status.files, [
    { path: 'hunts/first order.hunt', state: 'modified' },
    { path: 'pages/new.hunt', state: 'added' },
    { path: 'gone.hunt', state: 'deleted' },
    { path: 'pages/cart.hunt', state: 'renamed', from: 'pages/basket.hunt' },
    { path: 'hunts/both changed.hunt', state: 'conflict' },
    { path: 'notes.txt', state: 'untracked' },
  ]);
  assert.equal(parseStatus('# branch.head (detached)\0').branch, '');
});

// ── the service, against repositories ───────────────────────────────────────

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const hasGit = ((): boolean => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A remote, and a clone of it with one commit pushed; a path with a space in it, as a person's has. */
function repositories(): { remote: string; mine: string; clone(name: string): string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio git '));
  const remote = path.join(dir, 'remote.git');
  git(dir, 'init', '--bare', '--initial-branch=main', remote);
  const clone = (name: string): string => {
    const where = path.join(dir, name);
    git(dir, 'clone', remote, where);
    git(where, 'config', 'user.name', name);
    git(where, 'config', 'user.email', `${name}@example.com`);
    git(where, 'config', 'core.autocrlf', 'false');
    return where;
  };
  const mine = clone('mine');
  git(mine, 'checkout', '-b', 'main');
  fs.writeFileSync(path.join(mine, 'pay.hunt'), "STEP 1: Pay\n    CLICK the 'Pay' button\nDONE.\n");
  git(mine, 'add', '-A');
  git(mine, 'commit', '-m', 'first');
  git(mine, 'push', '-u', 'origin', 'main');
  return { remote, mine, clone };
}

test('a folder that is not a repository says so, and becomes one', { skip: !hasGit }, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-git-'));
  const service = new GitService(() => folder, () => undefined);
  assert.deepEqual(await service.status(), {
    available: true, repo: false, root: '', branch: '', upstream: '', ahead: 0, behind: 0, operation: '', files: [],
  });
  await service.init();
  fs.writeFileSync(path.join(folder, 'a.hunt'), 'DONE.\n');
  // What a run leaves is not the project, and is not listed as a change.
  fs.mkdirSync(path.join(folder, 'reports'));
  fs.writeFileSync(path.join(folder, 'reports', 'run_history.json'), '[]');
  const status = await service.status();
  assert.equal(status.repo, true);
  assert.deepEqual(status.files.map((f) => [f.path, f.state]), [['.gitignore', 'untracked'], ['a.hunt', 'untracked']]);
  // A .gitignore that is there is the person's, and is left as it is.
  fs.writeFileSync(path.join(folder, '.gitignore'), '# mine\n');
  await service.init();
  assert.equal(fs.readFileSync(path.join(folder, '.gitignore'), 'utf8'), '# mine\n');
  // No folder at all is not an error either.
  assert.equal((await new GitService(() => '', () => undefined).status()).repo, false);

  // Nor is a folder that has been deleted since it was opened — and asking
  // about one must not be remembered as there being no git.
  let where = path.join(folder, 'deleted since');
  const moving = new GitService(() => where, () => undefined);
  assert.deepEqual([(await moving.status()).available, (await moving.status()).repo], [true, false]);
  where = folder;
  assert.equal((await moving.status()).repo, true);
});

test('changes are seen, shown, committed a file at a time, and pushed', { skip: !hasGit }, async () => {
  const { remote, mine } = repositories();
  const log: string[] = [];
  const service = new GitService(() => mine, (line) => log.push(line));

  fs.writeFileSync(path.join(mine, 'pay.hunt'), "STEP 1: Pay\n    CLICK the 'Pay now' button\nDONE.\n");
  fs.mkdirSync(path.join(mine, 'hunts'));
  fs.writeFileSync(path.join(mine, 'hunts', 'new one.hunt'), 'DONE.\n');
  fs.writeFileSync(path.join(mine, 'notes.txt'), 'not for this commit\n');

  let status = await service.status();
  assert.equal(status.branch, 'main');
  assert.equal(status.upstream, 'origin/main');
  assert.deepEqual(
    status.files.map((f) => [f.path, f.state]),
    [['hunts/new one.hunt', 'untracked'], ['notes.txt', 'untracked'], ['pay.hunt', 'modified']],
  );
  assert.equal(status.files[2].file, path.join(status.root, 'pay.hunt'));

  const diff = await service.diff('pay.hunt');
  assert.ok(diff.original.includes("'Pay' button") && diff.modified.includes("'Pay now' button"));
  assert.deepEqual(await service.diff('hunts/new one.hunt'), { original: '', modified: 'DONE.\n', opaque: false });
  fs.writeFileSync(path.join(mine, 'picture.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]));
  assert.equal((await service.diff('picture.png')).opaque, true);
  fs.rmSync(path.join(mine, 'picture.png'));

  await assert.rejects(service.commit('   ', ['pay.hunt']), /Say what the commit is/);
  // A message that begins like an option is a message.
  await service.commit('--amend is not what this is', ['pay.hunt', 'hunts/new one.hunt']);
  status = await service.status();
  assert.deepEqual(status.files.map((f) => f.path), ['notes.txt']);
  assert.equal(status.ahead, 1);
  assert.equal(git(mine, 'log', '-1', '--format=%s').trim(), '--amend is not what this is');
  assert.ok(log.some((line) => line.startsWith('$ git commit')));

  await service.push();
  assert.equal((await service.status()).ahead, 0);
  assert.equal(git(remote, 'log', '--format=%s', 'main').trim().split('\n').length, 2);
});

test('a commit takes the files that are named, whatever their names and however many', { skip: !hasGit }, async () => {
  const { mine } = repositories();
  const service = new GitService(() => mine, () => undefined);
  const changed = async (): Promise<string[][]> => (await service.status()).files.map((f) => [f.path, f.state]);

  // Renamed in a terminal: the old name is in neither the index nor the folder.
  git(mine, 'mv', 'pay.hunt', 'checkout.hunt');
  assert.deepEqual((await service.status()).files.map((f) => [f.path, f.state, f.from]), [['checkout.hunt', 'renamed', 'pay.hunt']]);
  assert.ok((await service.diff('checkout.hunt')).original.includes("'Pay' button"));
  await service.commit('renamed', ['checkout.hunt']);
  assert.deepEqual(await changed(), []);
  assert.equal(git(mine, 'ls-tree', '--name-only', 'HEAD').trim(), 'checkout.hunt');
  // And one whose new name differs only in its case, which on Windows is the
  // name of the same file.
  git(mine, 'mv', 'checkout.hunt', 'Checkout.hunt');
  await service.commit('capital', ['Checkout.hunt']);
  assert.deepEqual(await changed(), []);
  assert.equal(git(mine, 'ls-tree', '--name-only', 'HEAD').trim(), 'Checkout.hunt');

  // A name that git would read as a pattern is that file, and not the one
  // beside it that the pattern also fits — neither when it is on disk only,
  // nor when a terminal has staged it.
  fs.writeFileSync(path.join(mine, '[ab].hunt'), 'DONE.\n');
  fs.writeFileSync(path.join(mine, 'a.hunt'), 'DONE.\n');
  fs.writeFileSync(path.join(mine, 'b.hunt'), 'DONE.\n');
  git(mine, 'add', 'b.hunt');
  await service.commit('one of the three', ['[ab].hunt']);
  assert.deepEqual(await changed(), [['a.hunt', 'untracked'], ['b.hunt', 'added']]);
  await service.commit('the second', ['b.hunt']);
  assert.deepEqual(await changed(), [['a.hunt', 'untracked']]);

  // Added in a terminal and deleted before it was ever committed: nothing to
  // commit, which does not stop the file chosen with it from being committed.
  fs.writeFileSync(path.join(mine, 'draft.hunt'), 'DONE.\n');
  git(mine, 'add', 'draft.hunt');
  fs.rmSync(path.join(mine, 'draft.hunt'));
  await service.commit('the other', ['a.hunt', 'draft.hunt']);
  assert.deepEqual(await changed(), []);
  fs.writeFileSync(path.join(mine, 'draft.hunt'), 'DONE.\n');
  git(mine, 'add', 'draft.hunt');
  fs.rmSync(path.join(mine, 'draft.hunt'));
  await assert.rejects(service.commit('nothing', ['draft.hunt']), /Nothing of what is chosen/);
  assert.deepEqual(await changed(), []);

  // A deleted file is committed as deleted.
  fs.rmSync(path.join(mine, 'a.hunt'));
  await service.commit('gone', ['a.hunt']);
  assert.deepEqual(await changed(), []);

  // More files than one command line can name: a folder of libraries that
  // nobody told git to ignore.
  const many: string[] = [];
  fs.mkdirSync(path.join(mine, 'vendor', 'some-library', 'lib'), { recursive: true });
  for (let i = 0; i < 1200; i++) {
    many.push(`vendor/some-library/lib/module-${String(i).padStart(4, '0')}.js`);
    fs.writeFileSync(path.join(mine, many[i]), 'export {};\n');
  }
  assert.ok(many.join(' ').length > 40_000);
  assert.ok(lots(many).length > 1 && lots(many).flat().length === many.length);
  // With something else staged, which is not for this commit: the files have
  // to be named, and are.
  fs.writeFileSync(path.join(mine, 'notes.txt'), 'not for this commit\n');
  git(mine, 'add', 'notes.txt');
  await service.commit('half the libraries', many.slice(0, 600));
  assert.equal((await changed()).length, 601);
  // And with nothing else staged.
  git(mine, 'reset', '-q', '--', 'notes.txt');
  await service.commit('the other half', many.slice(600));
  assert.deepEqual(await changed(), [['notes.txt', 'untracked']]);
  assert.equal(git(mine, 'ls-tree', '-r', '--name-only', 'HEAD', 'vendor').trim().split('\n').length, 1200);

  // A name that leads out of the repository is not a file of it.
  await assert.rejects(service.diff('../outside.txt'), /outside the repository/);
  await assert.rejects(service.commit('out', ['../outside.txt']), /outside the repository/);
});

test('a file one side deleted is settled either way', { skip: !hasGit }, async () => {
  const { mine, clone } = repositories();
  // Somebody else changes the file; here it is deleted.
  const theirs = clone('theirs');
  const theirText = "STEP 1: Pay\n    CLICK the 'Place order' button\nDONE.\n";
  fs.writeFileSync(path.join(theirs, 'pay.hunt'), theirText);
  git(theirs, 'commit', '-am', 'theirs');
  git(theirs, 'push', 'origin', 'HEAD:main');

  const service = new GitService(() => mine, () => undefined);
  fs.rmSync(path.join(mine, 'pay.hunt'));
  await service.commit('mine', ['pay.hunt']);

  // What was here is no file: keeping it is deleting what came in.
  await service.pull();
  assert.deepEqual((await service.status()).files.map((f) => [f.path, f.state]), [['pay.hunt', 'conflict']]);
  await service.resolve('pay.hunt', 'current');
  assert.equal((await service.status()).files.filter((f) => f.state === 'conflict').length, 0);
  assert.equal(fs.existsSync(path.join(mine, 'pay.hunt')), false);
  await service.abort();

  // And what is coming in is the file as they left it.
  await service.pull();
  await service.resolve('pay.hunt', 'incoming');
  assert.equal(fs.readFileSync(path.join(mine, 'pay.hunt'), 'utf8'), theirText);
  await service.continue();
  assert.equal((await service.status()).operation, '');
});

test('a pull that conflicts is settled a file at a time and finished', { skip: !hasGit }, async () => {
  const { mine, clone } = repositories();
  // Somebody else changes the same line, and gets there first.
  const theirs = clone('theirs');
  fs.writeFileSync(path.join(theirs, 'pay.hunt'), "STEP 1: Pay\n    CLICK the 'Place order' button\nDONE.\n");
  fs.writeFileSync(path.join(theirs, 'theirs.hunt'), 'DONE.\n');
  git(theirs, 'add', '-A');
  git(theirs, 'commit', '-m', 'theirs');
  git(theirs, 'push', 'origin', 'HEAD:main');

  const service = new GitService(() => mine, () => undefined);
  fs.writeFileSync(path.join(mine, 'pay.hunt'), "STEP 1: Pay\n    CLICK the 'Pay now' button\nDONE.\n");
  await service.commit('mine', ['pay.hunt']);

  // Not a failure: the next thing to do.
  await service.pull();
  let status = await service.status();
  assert.equal(status.operation, 'merge');
  assert.deepEqual(status.files.filter((f) => f.state === 'conflict').map((f) => [f.path, f.unresolved]), [['pay.hunt', true]]);
  await assert.rejects(service.continue(), /still in conflict/);
  await assert.rejects(service.commit('not now', ['pay.hunt']), /merge is in progress/);

  // Edited by hand, with a conflict left in: not resolved yet.
  await assert.rejects(service.resolve('pay.hunt', 'resolved'), /still has a conflict/);
  await service.resolve('pay.hunt', 'incoming');
  assert.ok(fs.readFileSync(path.join(mine, 'pay.hunt'), 'utf8').includes("'Place order'"));
  status = await service.status();
  assert.equal(status.files.filter((f) => f.state === 'conflict').length, 0);

  await service.continue();
  status = await service.status();
  assert.equal(status.operation, '');
  assert.equal(status.files.length, 0);
  assert.ok(fs.existsSync(path.join(mine, 'theirs.hunt')));
  await service.push();
  assert.equal((await service.status()).ahead, 0);
});

test('a merge can be given up, and a file settled by hand is taken as it is', { skip: !hasGit }, async () => {
  const { mine, clone } = repositories();
  const theirs = clone('theirs');
  fs.writeFileSync(path.join(theirs, 'pay.hunt'), "STEP 1: Pay\n    CLICK the 'Place order' button\nDONE.\n");
  git(theirs, 'commit', '-am', 'theirs');
  git(theirs, 'push', 'origin', 'HEAD:main');

  const service = new GitService(() => mine, () => undefined);
  const mineText = "STEP 1: Pay\n    CLICK the 'Pay now' button\nDONE.\n";
  fs.writeFileSync(path.join(mine, 'pay.hunt'), mineText);
  await service.commit('mine', ['pay.hunt']);

  await service.pull();
  assert.equal((await service.status()).operation, 'merge');
  await service.abort();
  assert.equal((await service.status()).operation, '');
  assert.equal(fs.readFileSync(path.join(mine, 'pay.hunt'), 'utf8'), mineText);
  await assert.rejects(service.abort(), /no merge or rebase/);

  // Again, and this time the text is put right in the editor.
  await service.pull();
  const settled = "STEP 1: Pay\n    CLICK the 'Pay now' button\n    VERIFY that 'Thank you' is present\nDONE.\n";
  fs.writeFileSync(path.join(mine, 'pay.hunt'), settled);
  await service.resolve('pay.hunt', 'resolved');
  await service.continue();
  assert.equal((await service.status()).operation, '');
  assert.equal(fs.readFileSync(path.join(mine, 'pay.hunt'), 'utf8'), settled);
});
