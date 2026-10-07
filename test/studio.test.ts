// What this app adds to the shared core, as far as it can be tested without a
// window. The window itself is checked by `npm run smoke`.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { parseHunt, StepLocator } from '../src/core/huntDoc';
import { PAUSE_MARKER, VARS_MARKER, parseStdoutLine } from '../src/core/runner';
import { isInside, Workspace } from '../src/main/workspace';
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
