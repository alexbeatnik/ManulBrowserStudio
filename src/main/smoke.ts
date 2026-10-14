// `electron . --smoke [dir]`: the app checking itself, end to end.
//
// It starts as a first start does, with the demo project, and runs every hunt
// in it. Then it opens a folder with one hunt and one local page in it, and
// does what a person would: runs the file, with the hook script beside it,
// debugs it to a breakpoint, steps, asks for an explanation, tries a line in a
// live session, and asks for completion in the hook script — through the same
// commands the menu sends, against a real engine and a real browser. What it
// saw goes to `dir` as screenshots and a report, and the process exits
// non-zero if any expectation failed.
//
// Unit tests cover the pieces that can be tested without a window. This is
// the only check that the pieces are wired to each other.

import { execFileSync } from 'child_process';
import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { BuiltInBrowser } from './builtInBrowser';
import { DEMO_FOLDER } from './demo';

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Smoke page</title></head>
<body>
  <h1>Sign up</h1>
  <form onsubmit="event.preventDefault(); document.getElementById('done').textContent = 'Welcome, ' + document.getElementById('name').value + '!';">
    <label>Full name <input id="name" type="text"></label>
    <label>Plan <select id="plan"><option value="f">Free</option><option value="p">Pro</option></select></label>
    <label><input type="checkbox" id="terms"> Accept the terms</label>
    <button type="submit">Create account</button>
  </form>
  <p id="done"></p>
</body></html>
`;

// A hook script as a person would write one. Nothing in the folder provides
// `manul-browser` or a `node` to run it on; the app has to.
const HOOKS = `import { beforeAll, call, serveHooks } from 'manul-browser';

beforeAll((ctx) => {
  ctx.variables.greeting = 'hello from hooks';
});

call('studio.shout', (ctx) => String(ctx.args[0]).toUpperCase());

// stderr is the script's own; stdout belongs to the engine.
console.error('hooks ready in', process.cwd());

await serveHooks();
`;

/** The 1-based line and column just after the first occurrence of text in the hook script. */
function afterInHooks(text: string): { line: number; column: number } {
  const lines = HOOKS.split('\n');
  const line = lines.findIndex((l) => l.includes(text));
  return { line: line + 1, column: lines[line].indexOf(text) + text.length + 1 };
}

const hunt = (pageUrl: string): string => `@title: smoke
@var: {who} = Ada

STEP 1: Hooks
    CALL HOST studio.shout with args: "ada" into {loud}
    PRINT "{loud} / {greeting}"

STEP 2: Fill the form
    NAVIGATE to ${pageUrl}
    FILL 'Full name' field with '{who} Lovelace'
    SELECT 'Pro' from the 'Plan' dropdown
    CHECK the checkbox for 'Accept the terms'
    EXTRACT the 'Full name' into {typed}

STEP 3: Submit
    CLICK the 'Create account' button
    VERIFY that 'Welcome, Ada Lovelace!' is present
    CLICK the 'Remove everything' button
DONE.
`;

interface Snapshot {
  workspace: string;
  active: string;
  runState: string;
  results: number;
  failed: number;
  located: number;
  treeError: string;
  gitBranch: string;
  gitChanges: string[];
  gitConflicts: string[];
  gitOperation: string;
  diffOpen: string;
  conflictsInEditor: number;
  summary: string;
  status: string;
  engine: string;
  liveOpen: boolean;
  liveUrl: string;
  mapElements: number;
  variables: number;
  breakpoints: number[];
  paletteEntries: number;
  fileIcons: number;
  folders: string[];
  node: string;
  libraries: string[];
  huntIcons: number;
  tabIcons: number;
  previewing: boolean;
  /** Each row of the Tests tab, as `file|state`. */
  tests: string[];
  testsBusy: boolean;
  log: string;
  hasShot: boolean;
  still: boolean;
}

export async function runSmoke(win: BrowserWindow, dir: string, builtIn: BuiltInBrowser): Promise<number> {
  const workspace = path.join(dir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const pageFile = path.join(workspace, 'page.html');
  const huntFile = path.join(workspace, 'smoke.hunt');
  fs.writeFileSync(pageFile, PAGE);
  fs.writeFileSync(huntFile, hunt(pathToFileURL(pageFile).href));
  const hooksFile = path.join(workspace, 'manul_hooks.mjs');
  fs.writeFileSync(hooksFile, HOOKS);

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const check = (name: string, ok: boolean, detail = ''): void => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const snapshot = (): Promise<Snapshot> => js<Snapshot>('window.__studio.snapshot()');
  const command = (name: string): Promise<void> => js(`window.__studio.command(${JSON.stringify(name)})`);
  const shoot = async (name: string): Promise<void> => {
    // Let the frame that shows the state just reached be painted.
    await new Promise((r) => setTimeout(r, 400));
    fs.writeFileSync(path.join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const until = async (what: string, test: (s: Snapshot) => boolean, timeoutMs = 60_000): Promise<Snapshot> => {
    const deadline = Date.now() + timeoutMs;
    let last = await snapshot();
    while (!test(last)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; last state ${JSON.stringify(last)}`);
      await new Promise((r) => setTimeout(r, 200));
      last = await snapshot();
    }
    return last;
  };

  let failure = '';
  try {
    if (win.webContents.isLoading()) {
      await new Promise<void>((done) => win.webContents.once('did-finish-load', () => done()));
    }
    let s = await until('the engine to be found', (x) => x.engine !== 'engine…', 20_000);
    check('an engine is found', !s.engine.includes('no engine'), s.engine);
    check('the step palette is filled from the catalogue', s.paletteEntries > 30, `${s.paletteEntries} entries`);

    // ── a first start: the demo project ─────────────────────────────────────
    const demo = path.join(dir, DEMO_FOLDER);
    const demoHunt = (name: string): string => path.join(demo, 'hunts', name);
    s = await until('the demo project to open', (x) => x.active === demoHunt('01-first-order.hunt'), 20_000);
    // The settings named a folder that is not there (main.ts): it is let go
    // of, and the demo project that was asked for is opened in its place.
    check('a first start opens the demo project, not a folder that is gone', s.workspace === demo, s.workspace);
    check('nothing in the tree is an error', !s.treeError, s.treeError);
    check(
      "the demo's plain hunts are given the address of its shop",
      fs.readFileSync(s.active, 'utf8').includes(`NAVIGATE to ${pathToFileURL(path.join(demo, 'site')).href}/index.html`),
    );
    await shoot('0-demo');

    // ── HTML and Markdown, as text and as what they make ───────────────────
    const readme = path.join(demo, 'README.md');
    await js(`window.__studio.openFile(${JSON.stringify(readme)})`);
    s = await until('the README to open', (x) => x.active === readme, 10_000);
    check('a Markdown file opens formatted', s.previewing);
    const headings = await js<number>("document.querySelectorAll('#preview .markdown-body h1, #preview .markdown-body h2').length");
    check('the Markdown is drawn as headings and text', headings > 0, `${headings} headings`);
    await shoot('0-markdown');
    await command('toggle-preview');
    s = await until('the README to show its text', (x) => !x.previewing, 5_000);
    check('a Markdown file can be shown as its text', !s.previewing);

    const shopPage = path.join(demo, 'site', 'index.html');
    await js(`window.__studio.openFile(${JSON.stringify(shopPage)})`);
    s = await until('the shop page to open', (x) => x.active === shopPage, 10_000);
    check('an HTML file opens as a page', s.previewing);
    // The page is a frame served from the folder: its stylesheet and script
    // come with it, and the script draws the shop.
    const drawn = await (async (): Promise<string> => {
      const deadline = Date.now() + 10_000;
      let last = 'no frame';
      while (Date.now() < deadline) {
        const frame = win.webContents.mainFrame.framesInSubtree.find((f) => f.url.startsWith('manul-preview:'));
        if (frame) {
          last = String(
            await frame.executeJavaScript(
              "`${document.styleSheets.length && document.styleSheets[0].cssRules.length ? 'styled' : 'plain'} ${document.querySelectorAll('#view *').length}`",
            ).catch((err: unknown) => err),
          );
          if (/^styled [1-9]/.test(last)) return last;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return last;
    })();
    check('an HTML preview runs the page with its stylesheet and script', /^styled [1-9]/.test(drawn), drawn);
    await shoot('0-html-preview');
    // The same command twice within a moment is taken for one key press
    // arriving twice (App.command), and the second is dropped.
    await new Promise((r) => setTimeout(r, 300));
    await command('toggle-preview');
    s = await until('the shop page to show its text', (x) => !x.previewing, 5_000);
    check('an HTML file can be shown as its text', !s.previewing);
    await js(`window.__studio.openFile(${JSON.stringify(demoHunt('01-first-order.hunt'))})`);
    // What each hunt of the demo comes to: 02 is the one with a step to fix.
    const expected: Array<[string, number, number]> = [
      ['01-first-order.hunt', 20, 0],
      ['02-find-the-bug.hunt', 9, 1],
      ['03-full-cart.hunt', 25, 0],
      ['04-delivery-date.hunt', 22, 0],
    ];
    for (const [name, results, failed] of expected) {
      await js(`window.__studio.openFile(${JSON.stringify(demoHunt(name))})`);
      await until(`${name} to open`, (x) => x.active === demoHunt(name), 10_000);
      await command('run');
      await until(`${name} to start`, (x) => x.runState !== 'idle', 15_000);
      s = await until(`${name} to end`, (x) => x.runState === 'idle');
      check(
        `the demo's ${name} ${failed ? 'fails where it is meant to' : 'passes'}`,
        s.results === results && s.failed === failed,
        `${s.results} results, ${s.failed} failed`,
      );
      // 03 and 04 are built from blocks borrowed from pages/: their steps are
      // lines of other files, and belong to the USE lines of this one.
      check(`every step of ${name} is put on a line`, s.located === s.results, `${s.located} of ${s.results}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    await shoot('0-demo-run');

    // ── the Tests tab ───────────────────────────────────────────────────────
    // Every hunt of the demo, and none of the page objects they borrow from;
    // the ones ticked are run one after another, and each says how it went.
    await js("document.getElementById('tests-tab').click()");
    s = await until('the tests to be listed', (x) => x.tests.length > 0, 10_000);
    const listed = s.tests.map((t) => path.relative(demo, t.split('|')[0]).split(path.sep).join('/'));
    check(
      "the Tests tab lists the demo's hunts and not its page objects",
      listed.join(',') === expected.map(([name]) => `hunts/${name}`).join(','),
      listed.join(', '),
    );
    const testRow = (name: string): string =>
      `[...document.querySelectorAll('#tests-list .test-row')].find((r) => r.dataset.file === ${JSON.stringify(demoHunt(name))})`;
    const stateOf = (x: Snapshot, name: string): string =>
      x.tests.find((t) => t.startsWith(`${demoHunt(name)}|`))?.split('|')[1] ?? 'missing';
    await js(`${testRow('01-first-order.hunt')}.querySelector('input').click()`);
    await js(`${testRow('02-find-the-bug.hunt')}.querySelector('input').click()`);
    await js("document.getElementById('tests-run-selected').click()");
    await until('the ticked tests to start', (x) => x.testsBusy, 15_000);
    s = await until('the ticked tests to end', (x) => !x.testsBusy && x.runState === 'idle', 180_000);
    // 03 and 04 keep what their runs above came to: a run of a test from the
    // editor is told to the Tests tab too.
    const states = expected.map(([name]) => stateOf(s, name)).join(', ');
    check('each ticked test says how it went', states === 'passed, failed, passed, passed', states);
    check(
      'the ticked tests are run one after another, and only they, their results in one list',
      s.results === expected[0][1] + expected[1][1] && s.summary === 'Tests: 1 passed, 1 failed',
      `${s.results} results · ${s.summary}`,
    );
    await shoot('0-tests');
    await js(`${testRow('04-delivery-date.hunt')}.querySelector('.run').click()`);
    await until('one test to start', (x) => x.testsBusy, 15_000);
    s = await until('one test to end', (x) => !x.testsBusy && x.runState === 'idle', 120_000);
    check('a test can be run on its own', stateOf(s, '04-delivery-date.hunt') === 'passed', stateOf(s, '04-delivery-date.hunt'));
    await js("document.querySelector('[data-tab=\"files\"]').click()");

    // ── the built-in browser ────────────────────────────────────────────────
    // The same hunts, in the page that is in the panel: the engine is not
    // asked to start a browser but given the address of that page.
    const choose = (browser: string): Promise<void> =>
      js(`(() => {
        const select = document.querySelector('#browser');
        select.value = ${JSON.stringify(browser)};
        select.dispatchEvent(new Event('change'));
      })()`);
    await choose('builtin');
    await new Promise((r) => setTimeout(r, 500));
    for (const [name, results] of [expected[0], expected[3]]) {
      await js(`window.__studio.openFile(${JSON.stringify(demoHunt(name))})`);
      await until(`${name} to open`, (x) => x.active === demoHunt(name), 10_000);
      await command('run');
      await until(`${name} to start`, (x) => x.runState !== 'idle', 15_000);
      s = await until(`${name} to end`, (x) => x.runState === 'idle');
      check(
        `the demo's ${name} passes in the built-in browser`,
        s.results === results && s.failed === 0,
        `${s.results} results, ${s.failed} failed`,
      );
      // The page itself is gone with the run; what is left to look at is a
      // picture of where it ended.
      check('and leaves a picture of the page it ended on', s.still && s.hasShot && s.liveUrl === '', `${s.still} ${s.liveUrl}`);
    }

    // A run ends with the browser made new. A hunt whose page stores
    // something, in the two places a page can: afterwards, with no run in
    // between, the same page is asked what it finds there.
    const keeper = path.join(demo, 'site', 'keeper.html');
    fs.writeFileSync(
      keeper,
      `<!doctype html><title>Keeper</title><p id="found"></p><script>
        document.getElementById('found').textContent =
          'found: ' + localStorage.getItem('kept') + ',' + sessionStorage.getItem('kept') + ',' + history.length;
        if (location.search !== '?read') {
          localStorage.setItem('kept', 'yes');
          sessionStorage.setItem('kept', 'yes');
          document.title = 'Stored';
        }
      </script><p>Something is stored</p>`,
    );
    const keeperHunt = demoHunt('keeper.hunt');
    fs.writeFileSync(
      keeperHunt,
      `@title: keeper\n\nSTEP 1: Store something\n    NAVIGATE to ${pathToFileURL(keeper).href}\n    VERIFY that 'Something is stored' is present\nDONE.\n`,
    );
    await js(`window.__studio.openFile(${JSON.stringify(keeperHunt)})`);
    await until('the keeper hunt to open', (x) => x.active === keeperHunt, 10_000);
    await command('run');
    await until('the keeper hunt to start', (x) => x.runState !== 'idle', 15_000);
    const during = builtIn.pageId;
    s = await until('the keeper hunt to end', (x) => x.runState === 'idle');
    const after = builtIn.pageId;
    await js(`(() => {
      const address = document.querySelector('#url');
      address.value = ${JSON.stringify(`${keeper}?read`)};
      address.form.requestSubmit();
    })()`);
    await until('the built-in page to go back to the keeper', (x) => x.liveUrl.endsWith('keeper.html?read'), 15_000).catch(() => undefined);
    const found = await builtIn.probe<string>(`document.getElementById('found').textContent`);
    // Two pages of history: the browser's blank one, and this. The run's own
    // visit would have been a third.
    check(
      'a run ends with the built-in browser reset: another page, with nothing stored and no history',
      s.failed === 0 && s.results === 2 && after !== during && found === 'found: null,null,2',
      `page ${during} then ${after}; ${found}`,
    );
    // The address above the page takes it somewhere: here a path on disk,
    // typed the way a path is written.
    const shopFile = path.join(demo, 'site', 'index.html');
    await js(`(() => {
      const address = document.querySelector('#url');
      address.value = ${JSON.stringify(shopFile)};
      address.form.requestSubmit();
    })()`);
    s = await until('the built-in page to go where it was sent', (x) => x.liveUrl === pathToFileURL(shopFile).href, 15_000).catch(
      () => snapshot(),
    );
    check('an address typed above the built-in page is gone to', s.liveUrl === pathToFileURL(shopFile).href, s.liveUrl);
    // The page is drawn by the app over a box of the window, so no picture
    // of the window has it: it is asked where it is, and for its own.
    const box = await js<{ x: number; y: number; width: number; height: number }>(
      `(() => { const r = document.querySelector('#browser-host').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    );
    const seen = await builtIn.look();
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
    check(
      'the built-in browser is in its box in the page panel',
      seen.visible &&
        near(seen.bounds.x, box.x) &&
        near(seen.bounds.y, box.y) &&
        near(seen.bounds.width, box.width) &&
        near(seen.bounds.height, box.height),
      `${JSON.stringify(seen.bounds)} in ${JSON.stringify(box)}`,
    );
    fs.writeFileSync(path.join(dir, '0-built-in-page.png'), seen.png);
    await shoot('0-built-in');

    await js(`window.__studio.openFile(${JSON.stringify(demoHunt('01-first-order.hunt'))})`);
    const first = fs.readFileSync(demoHunt('01-first-order.hunt'), 'utf8').split('\n');
    await js(`window.__studio.goto(${first.findIndex((l) => l.includes('NAVIGATE to ')) + 1})`);
    await new Promise((r) => setTimeout(r, 300));
    await command('run-line');
    // The session opens on the page the run left — three things to act on —
    // and the line then takes it to the shop, which has a button a product.
    s = await until(
      'the live session to read the shop in the built-in page',
      (x) => x.liveOpen && x.liveUrl.endsWith('/site/index.html') && x.mapElements >= 6,
      30_000,
    ).catch(() => snapshot());
    check('a line run in the live session is run in the built-in browser', s.mapElements >= 6, `${s.mapElements} elements mapped`);
    await choose('chromium');
    await until('the live session to end with the choice of browser', (x) => !x.liveOpen, 15_000);

    await js(`window.__studio.openWorkspace(${JSON.stringify(workspace)})`);
    await js(`window.__studio.openFile(${JSON.stringify(huntFile)})`);
    s = await until('the file to open', (x) => x.active === huntFile, 10_000);
    check('every file in the tree has an icon', s.fileIcons === 3, `${s.fileIcons} icons for 3 files`);
    check('a hunt carries the Manul Browser mark, in the tree and on its tab', s.huntIcons === 1 && s.tabIcons === 1);
    await shoot('1-editor');

    // ── a plain run ─────────────────────────────────────────────────────────
    await command('run');
    await until('the run to start', (x) => x.runState !== 'idle', 15_000);
    s = await until('the run to end', (x) => x.runState === 'idle');
    await shoot('2-run');
    const zoom = await js<{ original: boolean; fitted: boolean }>(`(() => {
      const button = document.querySelector('#shot-zoom');
      const host = document.querySelector('#shot-host');
      const shot = document.querySelector('#shot');
      button.click();
      const original = host.classList.contains('zoomed') && shot.getBoundingClientRect().width > host.clientWidth;
      button.click();
      return { original, fitted: !host.classList.contains('zoomed') && shot.getBoundingClientRect().width <= host.clientWidth };
    })()`);
    check('a screenshot can be read at original size and fitted again', zoom.original && zoom.fitted);
    check('every step of the run is reported', s.results === 10, `${s.results} results`);
    check('the hook script beside the hunt is picked up', s.log.includes('manul_hooks.mjs'));
    const printed = await js<string>(`document.querySelector('#results').textContent`);
    check(
      'the hook script runs on the built-in Node, with the built-in binding',
      printed.includes('ADA / hello from hooks'),
      printed.includes('ADA / hello from hooks') ? '' : printed.includes('ADA') ? 'CALL HOST answered, before_all did not' : s.log.slice(-400),
    );
    check('the one step that cannot work is the one that fails', s.failed === 1, `${s.failed} failed`);
    check('a screenshot of the page is shown', s.hasShot);

    // ── debugging ───────────────────────────────────────────────────────────
    await js('window.__studio.goto(11)'); // SELECT 'Pro' …
    await command('breakpoint');
    s = await snapshot();
    check('a breakpoint is set on the line', s.breakpoints.join() === '11', s.breakpoints.join());
    await new Promise((r) => setTimeout(r, 300));
    await command('debug');
    s = await until('the run to pause at the breakpoint', (x) => x.runState === 'paused');
    check('the run pauses before the breakpoint line', s.status.includes("SELECT 'Pro'"), s.status);
    check('the steps before it have run', s.results === 4, `${s.results} results`);
    s = await until('variables to arrive', (x) => x.variables > 0, 5_000).catch(() => snapshot());
    // Not a failure when absent: the engine answers `vars` from debug contract
    // 0.2.1 on, and an older one is still an engine this app has to work with.
    if (s.variables > 0) check('variables are shown at the pause', true, `${s.variables} variables`);
    else console.log('note variables are not shown: this engine does not answer `vars`');
    await new Promise((r) => setTimeout(r, 300));
    await command('explain');
    const explained = await js<boolean>(`new Promise((resolve) => {
      const end = Date.now() + 15000;
      const look = () => document.querySelector('#explain-pane .explain') ? resolve(true)
        : Date.now() > end ? resolve(false) : setTimeout(look, 200);
      look();
    })`);
    check('Explain says what the step would act on', explained);
    await shoot('3-paused');
    await new Promise((r) => setTimeout(r, 300));
    await command('next');
    s = await until('the next pause', (x) => x.runState === 'paused' && x.results === 5);
    check('Step runs one step and pauses again', s.status.includes('CHECK the checkbox'), s.status);
    await new Promise((r) => setTimeout(r, 300));
    await command('stop');
    s = await until('the run to stop', (x) => x.runState === 'idle', 20_000);
    check('Stop ends a paused run', s.runState === 'idle');

    // ── the live session ────────────────────────────────────────────────────
    await js('window.__studio.goto(9)'); // NAVIGATE to …
    await new Promise((r) => setTimeout(r, 300));
    await command('run-line');
    s = await until('the live session to show the page', (x) => x.liveOpen && x.liveUrl.endsWith('page.html') && x.mapElements > 0);
    check('a line run in the live session opens the page', s.mapElements >= 4, `${s.mapElements} elements mapped`);
    const inserted = await js<string>(`(() => {
      const row = [...document.querySelectorAll('#map .el')].find((el) => el.textContent.includes('Create account'));
      if (!row) return 'no such element in the map';
      window.__studio.goto(16);
      row.click();
      return window.__studio.editor.currentLine().text;
    })()`);
    check('picking an element writes its step', inserted.trim() === "CLICK the 'Create account' button", inserted);
    await shoot('4-live');

    // ── a hook script in the editor ─────────────────────────────────────────
    await js(`window.__studio.openFile(${JSON.stringify(hooksFile)})`);
    await until('the hook script to open', (x) => x.active === hooksFile, 10_000);
    const complete = (at: { line: number; column: number }): Promise<string[]> =>
      js<string[]>(`window.__studio.completions(${JSON.stringify(hooksFile)}, ${at.line}, ${at.column})`).catch(() => []);
    // The declarations are loaded after the window is up; give them time.
    let offered: string[] = [];
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline && !offered.includes('variables')) {
      await new Promise((r) => setTimeout(r, 500));
      offered = await complete(afterInHooks('  ctx.'));
    }
    check(
      "completion in a hook script knows the binding's types",
      offered.includes('variables') && offered.includes('eval'),
      offered.slice(0, 6).join(', ') || 'nothing offered',
    );
    const onProcess = await complete(afterInHooks('process.'));
    check(
      'and Node\'s own',
      onProcess.includes('cwd') && onProcess.includes('env'),
      onProcess.slice(0, 6).join(', ') || 'nothing offered',
    );
    await shoot('5-hooks');

    // ── git ─────────────────────────────────────────────────────────────────
    // The folder becomes a repository with a remote, a change is looked at,
    // committed and pushed; then somebody else changes the same line first,
    // and the pull that meets it is settled in the editor and finished.
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    let gitHere = true;
    try {
      git(dir, '--version');
    } catch {
      gitHere = false;
    }
    if (!gitHere) {
      console.log('note the Git pane was not checked: there is no git on this machine');
    } else {
      const remote = path.join(dir, 'remote.git');
      git(dir, 'init', '--bare', '--initial-branch=main', remote);
      const press = (selector: string, text?: string): Promise<boolean> =>
        js<boolean>(`(() => {
          const wanted = ${JSON.stringify(text ?? '')};
          const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => !wanted || e.textContent === wanted);
          if (!el || el.disabled) return false;
          el.click();
          return true;
        })()`);
      const commit = (message: string): Promise<void> =>
        js(`(() => {
          const box = document.querySelector('#git-message');
          box.value = ${JSON.stringify(message)};
          box.dispatchEvent(new Event('input'));
          box.form.requestSubmit();
        })()`);

      await press('[data-tab="git"]');
      await new Promise((r) => setTimeout(r, 500));
      await press('#git-list button', 'Make it one');
      s = await until('the folder to become a repository', (x) => x.gitChanges.length > 0, 15_000);
      // The hunt and its page, and not the reports and screenshots the runs
      // above left: the new repository is told to ignore those.
      check(
        'the Git pane makes the folder a repository and lists what is in it',
        s.gitChanges.includes('smoke.hunt') &&
          s.gitChanges.includes('page.html') &&
          !s.gitChanges.some((p) => p.startsWith('reports/') || p.startsWith('screenshots/')),
        s.gitChanges.join(', '),
      );
      // Who commits, and where to: a person's own settings, which a check
      // must neither read nor change.
      git(workspace, 'symbolic-ref', 'HEAD', 'refs/heads/main');
      git(workspace, 'config', 'user.name', 'Smoke');
      git(workspace, 'config', 'user.email', 'smoke@example.com');
      git(workspace, 'config', 'core.autocrlf', 'false');
      git(workspace, 'remote', 'add', 'origin', remote);

      await press('#git-list .git-file[data-path="smoke.hunt"] .show');
      s = await until('the change to be shown', (x) => x.diffOpen === 'smoke.hunt', 10_000).catch(() => snapshot());
      check('a changed file is shown as it was and as it is', s.diffOpen === 'smoke.hunt', s.diffOpen);
      await shoot('7-git-diff');
      await press('#diff-close');

      await commit('first');
      s = await until('the commit to be made', (x) => x.gitChanges.length === 0, 30_000).catch(() => snapshot());
      check('a commit takes the ticked files', s.gitChanges.length === 0 && s.gitBranch.startsWith('main'), s.gitBranch);
      await press('#git-push');
      await until('the push to be made', (x) => x.gitBranch === 'main', 30_000).catch(() => undefined);
      const pushed = git(remote, 'log', '--format=%s', 'main').trim();
      check('a push takes the branch to its remote, and gives it an upstream', pushed === 'first', pushed);

      // Somebody else, in a clone of their own, gets to the title first.
      const other = path.join(dir, 'other');
      // Line endings as they are, from the start: a clone that changed them
      // on the way out would commit every file as changed.
      git(dir, 'clone', '-c', 'core.autocrlf=false', remote, other);
      git(other, 'config', 'user.name', 'Other');
      git(other, 'config', 'user.email', 'other@example.com');
      const theirs = fs.readFileSync(path.join(other, 'smoke.hunt'), 'utf8').replace('@title: smoke', '@title: theirs');
      fs.writeFileSync(path.join(other, 'smoke.hunt'), theirs);
      git(other, 'commit', '-am', 'theirs');
      git(other, 'push', 'origin', 'HEAD:main');

      // Here it is changed too, in the editor. Saving it is what makes it a
      // change: the pane lists it without being asked.
      await js(`window.__studio.openFile(${JSON.stringify(huntFile)})`);
      await until('the hunt to be in front', (x) => x.active === huntFile, 10_000);
      await js(`(() => {
        const model = window.__studio.editor.editor.getModel();
        model.setValue(model.getValue().replace('@title: smoke', '@title: mine'));
      })()`);
      await command('save');
      s = await until('the saved change to be listed', (x) => x.gitChanges.includes('smoke.hunt'), 15_000).catch(() => snapshot());
      check('a file saved in the editor is listed as changed', s.gitChanges.join() === 'smoke.hunt', s.gitChanges.join());
      await commit('mine');
      s = await until('the second commit', (x) => x.gitBranch.includes('↑1'), 30_000).catch(() => snapshot());
      check('and committed', git(workspace, 'show', 'HEAD:smoke.hunt').includes('@title: mine'), s.gitBranch);

      await press('#git-pull');
      s = await until('the pull to meet the conflict', (x) => x.gitOperation === 'merge', 30_000).catch(() => snapshot());
      check('a pull that conflicts says which file', s.gitConflicts.join() === 'smoke.hunt', `${s.gitOperation}: ${s.gitConflicts.join()}`);
      s = await until('the open file to show its conflict', (x) => x.conflictsInEditor > 0, 10_000).catch(() => snapshot());
      check('the file in the editor is read again, with its conflict marked', s.conflictsInEditor > 0);
      await shoot('8-git-conflict');

      // "Accept incoming", above the conflict: a link the editor draws, so
      // it is clicked the way a person clicks it.
      const link = await js<{ x: number; y: number } | null>(`new Promise((resolve) => {
        const end = Date.now() + 15000;
        const look = () => {
          const a = [...document.querySelectorAll('#editor .codelens-decoration a')].find((l) => l.textContent === 'Accept incoming');
          if (a) {
            const r = a.getBoundingClientRect();
            resolve({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
          } else if (Date.now() > end) resolve(null);
          else setTimeout(look, 200);
        };
        look();
      })`);
      if (link) {
        win.webContents.sendInputEvent({ type: 'mouseDown', x: link.x, y: link.y, button: 'left', clickCount: 1 });
        win.webContents.sendInputEvent({ type: 'mouseUp', x: link.x, y: link.y, button: 'left', clickCount: 1 });
      }
      await new Promise((r) => setTimeout(r, 500));
      const settled = await js<string>('window.__studio.editor.editor.getModel().getValue()');
      check(
        'a conflict is settled in the editor, from the choices above it',
        !!link && settled.includes('@title: theirs') && !settled.includes('<<<<<<<') && !settled.includes('@title: mine'),
        link ? settled.split('\n')[0] : 'the choices were not offered',
      );

      // Taken as it now is — saved on the way — and the merge finished.
      await press('#git-list .git-file.conflict .settle button', 'resolved');
      s = await until('the file to be taken as resolved', (x) => x.gitConflicts.length === 0, 20_000).catch(() => snapshot());
      check('a file settled by hand is taken as resolved', s.gitConflicts.length === 0 && s.gitOperation === 'merge', s.gitConflicts.join());
      await press('#git-operation button.primary');
      s = await until('the merge to be finished', (x) => x.gitOperation === '', 30_000).catch(() => snapshot());
      check('the merge is finished', s.gitOperation === '' && s.gitChanges.length === 0, `${s.gitOperation} ${s.gitChanges.join()}`);
      await press('#git-push');
      await until('the merge to be pushed', (x) => x.gitBranch === 'main', 30_000).catch(() => undefined);
      const history = git(remote, 'log', '--format=%s', 'main').trim().split('\n');
      check('and pushed', history.length === 4 && history.includes('theirs') && history.includes('mine'), history.join(' | '));
      await press('[data-tab="files"]');
    }

    // ── folders, and libraries for hook scripts ─────────────────────────────
    s = await snapshot();
    check('the status bar says which Node the app carries', /^Node \d+\.\d+\.\d+$/.test(s.node), s.node);

    await command('new-folder');
    await js(`(() => {
      const input = document.querySelector('#dialog input');
      input.value = 'flows';
      input.form.requestSubmit();
    })()`);
    s = await until('the new folder to be listed', (x) => x.folders.some((f) => f.includes('flows')), 10_000);
    check('a folder can be created from the tree', fs.statSync(path.join(workspace, 'flows')).isDirectory());

    await js(`(() => {
      document.querySelector('[data-tab="libraries"]').click();
      const input = document.querySelector('#lib-name');
      input.value = 'ms@2.1.3';
      input.form.requestSubmit();
    })()`);
    s = await until(
      'npm to finish',
      (x) => x.status === 'Libraries updated' || x.status.startsWith('npm failed'),
      180_000,
    );
    // The one check here that needs the network; without it there is nothing
    // to conclude about the app.
    if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ENETUNREACH/.test(s.log)) {
      console.log('note the library was not installed: the registry could not be reached');
    } else {
      check(
        'a library is installed with the built-in npm, on the built-in Node',
        s.libraries.some((l) => l.includes('ms') && l.includes('2.1.3')) &&
          fs.existsSync(path.join(workspace, 'node_modules', 'ms', 'package.json')),
        s.libraries.join(' | ') || s.log.slice(-400),
      );
    }
    await shoot('6-libraries');
  } catch (err) {
    failure = (err as Error).message;
    check('the smoke run completes', false, failure);
    await shoot('failure').catch(() => undefined);
  }

  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify({ ok: failed.length === 0, checks }, null, 2)}\n`);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${dir}`);
  return failed.length === 0 ? 0 : 1;
}
