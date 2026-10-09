// What this app adds to the shared core, as far as it can be tested without a
// window. The window itself is checked by `npm run smoke`.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { parseHunt, StepLocator } from '../src/core/huntDoc';
import { PAUSE_MARKER, VARS_MARKER, parseStdoutLine } from '../src/core/runner';
import { DEMO_FIRST_HUNT, DEMO_FOLDER, openDemo, placeDemo, SITE_TOKEN } from '../src/main/demo';
import { builtInNode, plainForCmd } from '../src/main/hookRuntime';
import { isInside, Workspace } from '../src/main/workspace';
import { isPackageName, parsePackageSpecs } from '../src/shared/packages';
import { quote, runnableLine, stepForElement, verifyForElement } from '../src/shared/steps';

// ── the debug protocol ──────────────────────────────────────────────────────

test('the answer to `vars` is told apart from a pause', () => {
  const vars = parseStdoutLine(`${VARS_MARKER}{"total":"$42.00","who":"Ada"}`);
  assert.deepEqual(vars, { kind: 'vars', data: { total: '$42.00', who: 'Ada' } });

  const pause = parseStdoutLine(`${PAUSE_MARKER}{"step":"CLICK 'Pay'","idx":3}`);
  assert.equal(pause?.kind, 'pause');

  // An engine that predates `vars` only repeats the pause; nothing is invented.
  assert.equal(parseStdoutLine(`${VARS_MARKER}not json`), undefined);
});

test('a pause repeated for one step is located once', () => {
  // The engine announces a pause again after every command that does not end
  // it. Locating each announcement would walk on to the next identical line.
  const outline = parseHunt(['STEP 1: twice', "    CLICK 'Next'", "    CLICK 'Next'", 'DONE.'].join('\n'));
  const pauses = new StepLocator(outline);
  assert.equal(pauses.locate("CLICK 'Next'"), 1);
  // What the run service does: the second announcement of step 1 reuses the
  // line; only the announcement of step 2 asks again.
  assert.equal(pauses.locate("CLICK 'Next'"), 2);
});

test('a step of a borrowed block belongs to the USE line that brought it in', () => {
  const outline = parseHunt(
    [
      "@import: Open the shop, Add the product from '../pages/shop.hunt'",
      'STEP 1: Fill the cart',
      '    USE Open the shop',
      '    FOR EACH {product} IN {wanted}:',
      '        USE Add the product',
      "    VERIFY that 'Cart (2)' is present",
      'DONE.',
    ].join('\n'),
  );
  const steps = new StepLocator(outline);
  // The engine reports a borrowed step under the header it has in its own file.
  assert.equal(steps.locate('NAVIGATE to {shop}/index.html', 'STEP 1: Open the shop', 0), 2);
  assert.equal(steps.locate("VERIFY that 'Steppe Goods' is present", 'STEP 1: Open the shop', 1), 2);
  // Twice round the loop is the same line twice.
  for (let pass = 0; pass < 2; pass++) {
    assert.equal(steps.locate("CLICK the 'Add to cart' button NEAR '{product}'", 'STEP 2: Add the product', 0), 4);
    assert.equal(steps.locate("VERIFY that '{product} added to cart' is present", 'STEP 2: Add the product', 1), 4);
  }
  // And back in the hunt's own block, its own lines.
  assert.equal(steps.locate("VERIFY that 'Cart (2)' is present", 'STEP 1: Fill the cart', 3), 5);
  // A block nothing here uses is not put anywhere.
  assert.equal(steps.locate("CLICK the 'Pay' button", 'STEP 4: Pay', 0), undefined);
});

// ── writing steps from the page ─────────────────────────────────────────────

test('a picked element becomes the step that acts on it', () => {
  const el = (role: string, label: string, editable = false) => ({ role, label, editable });
  assert.deepEqual(stepForElement(el('button', 'Sign in')), { text: "CLICK the 'Sign in' button" });
  assert.deepEqual(stepForElement(el('link', 'Pricing')), { text: "CLICK the 'Pricing' link" });
  assert.deepEqual(stepForElement(el('checkbox', 'Accept the terms')), { text: "CHECK the checkbox for 'Accept the terms'" });
  assert.deepEqual(stepForElement(el('radio', 'Monthly')), { text: "CLICK the 'Monthly' radio" });
  assert.deepEqual(stepForElement(el('heading', 'Welcome')), { text: "CLICK the 'Welcome'" });

  // A field and a dropdown are left with the caret where the value goes.
  const fill = stepForElement(el('textbox', 'Email', true));
  assert.equal(fill.text, "FILL 'Email' field with ''");
  assert.equal(fill.text.slice(0, fill.caret), "FILL 'Email' field with '");
  const select = stepForElement(el('combobox', 'Plan'));
  assert.equal(select.text, "SELECT '' from the 'Plan' dropdown");
  assert.equal(select.text.slice(0, select.caret), "SELECT '");

  assert.equal(verifyForElement(el('button', 'Sign in')), "VERIFY that 'Sign in' is present");
});

test('a label with an apostrophe is written in double quotes', () => {
  assert.equal(quote("It's gone!"), `"It's gone!"`);
  assert.equal(quote('  Full \n  name '), "'Full name'");
});

test('only a line that is a step is run on its own', () => {
  assert.equal(runnableLine("    CLICK the 'Pay' button"), "CLICK the 'Pay' button");
  assert.equal(runnableLine("  3. FILL 'Email' field with 'a@b.c'"), "FILL 'Email' field with 'a@b.c'");
  for (const line of ['', '   ', '# a note', '@title: checkout', 'STEP 2: Pay', 'DONE.', '[SETUP]', '[END TEARDOWN]', "IF button 'Pay' exists:", 'ELSE:']) {
    assert.equal(runnableLine(line), '', line);
  }
});

// ── the open folder ─────────────────────────────────────────────────────────

test('a path is inside the folder only if it really is', () => {
  const root = path.join(os.tmpdir(), 'studio-root');
  assert.equal(isInside(root, path.join(root, 'a.hunt')), true);
  assert.equal(isInside(root, path.join(root, 'sub', '..', 'a.hunt')), true);
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, path.join(root, '..', 'elsewhere.hunt')), false);
  assert.equal(isInside(root, `${root}-sibling${path.sep}a.hunt`), false);
  assert.equal(isInside('', path.join(root, 'a.hunt')), false);
});

test('files outside the open folder are refused, and nothing is overwritten on create', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ws-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, 'flows'));
  const ws = new Workspace(() => root);

  await assert.rejects(ws.read(path.join(outside, 'secret.txt')), /outside the open folder/);
  await assert.rejects(ws.write(path.join(root, '..', path.basename(outside), 'x.txt'), 'y'), /outside the open folder/);

  const file = await ws.create(root, 'checkout.hunt');
  await ws.write(file, 'DONE.\n');
  assert.equal(await ws.read(file), 'DONE.\n');
  await assert.rejects(ws.create(root, 'checkout.hunt'));
  await assert.rejects(ws.create(root, '../escape.hunt'), /not a file name/);

  // Folders first, and nothing an explorer has no business listing.
  assert.deepEqual((await ws.list(root)).map((e) => e.name), ['flows', 'checkout.hunt']);
});

test('a folder is created once, inside the open folder, under a plain name', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dirs-'));
  const ws = new Workspace(() => root);

  const made = await ws.mkdir(root, ' suites ');
  assert.equal(made, path.join(root, 'suites'));
  assert.ok(fs.statSync(made).isDirectory());
  // Nested, by naming the folder it goes into.
  assert.ok(fs.statSync(await ws.mkdir(made, 'checkout')).isDirectory());

  await assert.rejects(ws.mkdir(root, 'suites'), /EEXIST/);
  for (const name of ['', '.', '..', 'a/b', 'a\\b', 'what?']) {
    await assert.rejects(ws.mkdir(root, name), /not a folder name/, name);
  }
  await assert.rejects(ws.mkdir(path.join(root, '..'), 'outside'), /outside the open folder/);
});

// ── libraries ───────────────────────────────────────────────────────────────

test('what is typed for npm is package names and nothing else', () => {
  assert.deepEqual(parsePackageSpecs('dayjs'), ['dayjs']);
  assert.deepEqual(parsePackageSpecs('  lodash@4   @faker-js/faker@^9.0.0, ms@latest '), [
    'lodash@4',
    '@faker-js/faker@^9.0.0',
    'ms@latest',
  ]);

  // It becomes arguments to npm: a flag, a path, a URL or a git reference is
  // not a package name, whatever npm itself would make of it.
  for (const text of [
    '',
    '--global dayjs',
    '-g',
    '../somewhere',
    'C:\\tools\\pkg',
    './local',
    'https://example.com/pkg.tgz',
    'git+ssh://git@github.com/a/b.git',
    'user/repo',
    'dayjs@',
    'dayjs; rm -rf .',
    '$(whoami)',
  ]) {
    assert.throws(() => parsePackageSpecs(text), /package/, text);
  }

  assert.equal(isPackageName('@scope/name'), true);
  assert.equal(isPackageName('--save'), false);
});

// ── hook scripts ────────────────────────────────────────────────────────────

test('the launcher starts the app as Node, with the resolver loaded first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-node-'));
  const exe = path.join(dir, 'Manul Browser Studio.exe');
  const launcher = builtInNode([path.join(dir, 'runtime')], exe, path.join(dir, 'app'));
  const text = fs.readFileSync(launcher, 'utf8');

  assert.ok(text.includes('ELECTRON_RUN_AS_NODE=1'));
  assert.ok(text.includes(`"${exe}"`), 'the executable is quoted: its path has spaces');
  assert.ok(text.includes('--import "file:///'));
  if (process.platform === 'win32') {
    // Anything the launcher prints lands on the protocol's stdout.
    assert.ok(text.startsWith('@echo off'));
    assert.ok(text.includes('%*'));
  }

  const register = fs.readFileSync(path.join(dir, 'runtime', 'register.mjs'), 'utf8');
  const resolver = fs.readFileSync(path.join(dir, 'runtime', 'resolve.mjs'), 'utf8');
  assert.ok(register.includes('resolve.mjs'));
  // The anchor is a file inside the folder whose node_modules has the binding.
  assert.match(register, /anchor: "file:\/\/\/[^"]*app\/hooks\.mjs"/);
  // The project's own copy is tried first; the app's is the fallback.
  assert.ok(resolver.indexOf('nextResolve(specifier, context)') < resolver.indexOf('parentURL: anchor'));
});

test('the launcher is written where Windows can start it from', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-node-'));
  const spaced = path.join(dir, 'Manul Browser Studio', 'hook-runtime');
  const plain = path.join(dir, 'manul-browser-studio', 'hook-runtime');
  assert.equal(plainForCmd(spaced), false);
  assert.equal(plainForCmd('C:\\Users\\R&D\\hook-runtime'), false);
  assert.equal(plainForCmd('C:\\Users\\alexb\\AppData\\Local\\manul-browser-studio\\hook-runtime'), true);

  // The per-user data folder comes first for every other purpose, and has the
  // app's name in it. (Nothing to choose between on a machine whose temp
  // folder has a space of its own.)
  const launcher = builtInNode([spaced, plain], process.execPath, dir);
  const better = process.platform === 'win32' && plainForCmd(plain);
  assert.equal(path.dirname(launcher), better ? plain : spaced);

  // With nowhere better, it is still written — and a %20 in it is not left
  // for the batch file to read as its second argument.
  const forced = builtInNode([spaced], process.execPath, dir);
  if (process.platform === 'win32') {
    assert.ok(fs.readFileSync(forced, 'utf8').includes('Manul%%20Browser%%20Studio'));
  }
});

test('a hook script in a folder with a space in its name is started by the launcher', () => {
  // What the engine does with MANUL_NODE: start it, with the script's path as
  // the one argument. The demo project lives in "Manul Browser Demo".
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-node-'));
  const project = path.join(dir, 'Manul Browser Demo');
  fs.mkdirSync(project);
  const script = path.join(project, 'manul_hooks.mjs');
  fs.writeFileSync(script, "process.stdout.write('started from ' + process.argv[1]);\n");

  // Any Node will do for the executable; ELECTRON_RUN_AS_NODE means nothing to it.
  const launcher = builtInNode([path.join(dir, 'manul-browser-studio', 'hook-runtime')], process.execPath, dir);
  // Windows starts a batch file as `cmd.exe /c <launcher> "<script>"`.
  const run =
    process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/c', launcher, script], { encoding: 'utf8' })
      : spawnSync(launcher, [script], { encoding: 'utf8' });
  assert.equal(run.stdout, `started from ${script}`, run.stderr);
});

// ── the demo project ────────────────────────────────────────────────────────

const DEMO = path.resolve(__dirname, '..', '..', 'demo');

/** Every file under a folder, as paths relative to it. */
function filesUnder(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(path.join(dir, e.name), path.join(prefix, e.name)) : [path.join(prefix, e.name)],
  );
}

test('the demo is copied whole, with the address of its shop written into the hunts', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studio demo '));
  const { folder, file } = openDemo(DEMO, [home]);

  assert.equal(folder, path.join(home, DEMO_FOLDER));
  assert.equal(file, path.join(folder, DEMO_FIRST_HUNT));
  assert.deepEqual(filesUnder(folder).sort(), filesUnder(DEMO).sort());

  // A space in the path is a %20 in the address, or the engine would be
  // handed half of it.
  const first = fs.readFileSync(file, 'utf8');
  const site = first.match(/NAVIGATE to (\S+)\/index\.html/)?.[1] ?? '';
  assert.match(site, /^file:\/\/\/.*studio%20demo%20.*\/site$/);
  for (const name of filesUnder(folder)) {
    assert.ok(!fs.readFileSync(path.join(folder, name), 'utf8').includes(SITE_TOKEN), `${name} still has the token`);
  }
});

test('opening the demo again puts back what is missing and leaves the rest alone', () => {
  const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-demo-')), DEMO_FOLDER);
  placeDemo(DEMO, folder);
  const fixed = path.join(folder, 'hunts', '02-find-the-bug.hunt');
  const gone = path.join(folder, 'pages', 'cart.hunt');
  fs.writeFileSync(fixed, 'the fix\n');
  fs.rmSync(gone);

  placeDemo(DEMO, folder);
  assert.equal(fs.readFileSync(fixed, 'utf8'), 'the fix\n');
  assert.ok(fs.existsSync(gone));
});

test('the demo goes to the next place when the first will not take it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-demo-'));
  // A file where the folder would have to be made.
  const refused = path.join(dir, 'documents');
  fs.writeFileSync(refused, '');
  const { folder } = openDemo(DEMO, [refused, path.join(dir, 'data')]);
  assert.equal(folder, path.join(dir, 'data', DEMO_FOLDER));
  assert.throws(() => openDemo(DEMO, [refused]));
});

test("every block a demo hunt borrows is in the page object it names", () => {
  const hunts = path.join(DEMO, 'hunts');
  let borrowed = 0;
  for (const name of fs.readdirSync(hunts)) {
    const text = fs.readFileSync(path.join(hunts, name), 'utf8');
    const available = new Set<string>();
    for (const [, names, source] of text.matchAll(/^@import:\s*(.+?)\s+from\s+'([^']+)'/gm)) {
      const page = parseHunt(fs.readFileSync(path.join(hunts, source), 'utf8'));
      const labels = page.steps.map((s) => s.label.toLowerCase());
      for (const block of names.split(',').map((n) => n.trim().toLowerCase())) {
        assert.ok(labels.includes(block), `${name}: "${block}" is not a block of ${source}`);
        available.add(block);
      }
    }
    for (const [, used] of text.matchAll(/^\s*USE\s+(.+?)\s*$/gm)) {
      assert.ok(available.has(used.toLowerCase()), `${name}: USE ${used} is not imported`);
      borrowed++;
    }
  }
  assert.ok(borrowed > 0);
});
