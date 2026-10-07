// `electron . --smoke [dir]`: the app checking itself, end to end.
//
// It opens a folder with one hunt and one local page in it, and does what a
// person would: runs the file, debugs it to a breakpoint, steps, asks for an
// explanation, and tries a line in a live session — through the same commands
// the menu sends, against a real engine and a real browser. What it saw goes
// to `dir` as screenshots and a report, and the process exits non-zero if any
// expectation failed.
//
// Unit tests cover the pieces that can be tested without a window. This is
// the only check that the pieces are wired to each other.

import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

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

const hunt = (pageUrl: string): string => `@title: smoke
@var: {who} = Ada

STEP 1: Fill the form
    NAVIGATE to ${pageUrl}
    FILL 'Full name' field with '{who} Lovelace'
    SELECT 'Pro' from the 'Plan' dropdown
    CHECK the checkbox for 'Accept the terms'
    EXTRACT the 'Full name' into {typed}

STEP 2: Submit
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
  summary: string;
  status: string;
  engine: string;
  liveOpen: boolean;
  liveUrl: string;
  mapElements: number;
  variables: number;
  breakpoints: number[];
  paletteEntries: number;
  hasShot: boolean;
}

export async function runSmoke(win: BrowserWindow, dir: string): Promise<number> {
  fs.rmSync(dir, { recursive: true, force: true });
  const workspace = path.join(dir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const pageFile = path.join(workspace, 'page.html');
  const huntFile = path.join(workspace, 'smoke.hunt');
  fs.writeFileSync(pageFile, PAGE);
  fs.writeFileSync(huntFile, hunt(pathToFileURL(pageFile).href));

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

    await js(`window.__studio.openWorkspace(${JSON.stringify(workspace)})`);
    await js(`window.__studio.openFile(${JSON.stringify(huntFile)})`);
    s = await until('the file to open', (x) => x.active === huntFile, 10_000);
    await shoot('1-editor');

    // ── a plain run ─────────────────────────────────────────────────────────
    await command('run');
    await until('the run to start', (x) => x.runState !== 'idle', 15_000);
    s = await until('the run to end', (x) => x.runState === 'idle');
    await shoot('2-run');
    check('every step of the run is reported', s.results === 8, `${s.results} results`);
    check('the one step that cannot work is the one that fails', s.failed === 1, `${s.failed} failed`);
    check('a screenshot of the page is shown', s.hasShot);

    // ── debugging ───────────────────────────────────────────────────────────
    await js('window.__studio.goto(7)'); // SELECT 'Pro' …
    await command('breakpoint');
    s = await snapshot();
    check('a breakpoint is set on the line', s.breakpoints.join() === '7', s.breakpoints.join());
    await new Promise((r) => setTimeout(r, 300));
    await command('debug');
    s = await until('the run to pause at the breakpoint', (x) => x.runState === 'paused');
    check('the run pauses before the breakpoint line', s.status.includes("SELECT 'Pro'"), s.status);
    check('the steps before it have run', s.results === 2, `${s.results} results`);
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
    s = await until('the next pause', (x) => x.runState === 'paused' && x.results === 3);
    check('Step runs one step and pauses again', s.status.includes('CHECK the checkbox'), s.status);
    await new Promise((r) => setTimeout(r, 300));
    await command('stop');
    s = await until('the run to stop', (x) => x.runState === 'idle', 20_000);
    check('Stop ends a paused run', s.runState === 'idle');

    // ── the live session ────────────────────────────────────────────────────
    await js('window.__studio.goto(5)'); // NAVIGATE to …
    await new Promise((r) => setTimeout(r, 300));
    await command('run-line');
    s = await until('the live session to show the page', (x) => x.liveOpen && x.liveUrl.endsWith('page.html') && x.mapElements > 0);
    check('a line run in the live session opens the page', s.mapElements >= 4, `${s.mapElements} elements mapped`);
    const inserted = await js<string>(`(() => {
      const row = [...document.querySelectorAll('#map .el')].find((el) => el.textContent.includes('Create account'));
      if (!row) return 'no such element in the map';
      window.__studio.goto(12);
      row.click();
      return window.__studio.editor.currentLine().text;
    })()`);
    check('picking an element writes its step', inserted.trim() === "CLICK the 'Create account' button", inserted);
    await shoot('4-live');
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
