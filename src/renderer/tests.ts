// The Tests tab: every hunt of the open folder that is a test, each with a
// tick, and what it came to the last time it was run.
//
// It only lists and asks. Running is the app's (App.runTests), one file after
// another, which tells this list how each one went.

import type { TestFile } from '../shared/api';
import { $, clear, h, reason, studio } from './dom';

export type TestState = 'idle' | 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'stopped';

const MARK: Record<TestState, string> = {
  idle: '○',
  queued: '◌',
  running: '●',
  passed: '✓',
  failed: '✗',
  error: '!',
  stopped: '■',
};

const SAID: Record<TestState, string> = {
  idle: 'not run yet',
  queued: 'waiting its turn',
  running: 'running',
  passed: 'passed',
  failed: 'failed',
  error: 'could not be run',
  stopped: 'stopped',
};

export interface TestEvents {
  run(files: string[]): void;
  open(file: string): void;
}

export class TestExplorer {
  private root = '';
  private tests: TestFile[] = [];
  private readonly ticked = new Set<string>();
  private readonly outcomes = new Map<string, { state: TestState; detail: string }>();
  private busy = false;
  /** Counts lookings, so that only the latest is shown. */
  private turn = 0;
  private readonly list = $('tests-list');
  private readonly all = $<HTMLInputElement>('tests-all');
  private readonly runAll = $<HTMLButtonElement>('tests-run-all');
  private readonly runTicked = $<HTMLButtonElement>('tests-run-selected');

  constructor(private readonly events: TestEvents) {
    this.all.addEventListener('change', () => {
      for (const test of this.tests) {
        if (this.all.checked) this.ticked.add(test.file);
        else this.ticked.delete(test.file);
      }
      for (const box of this.list.querySelectorAll<HTMLInputElement>('.test-row input[type="checkbox"]')) {
        box.checked = this.all.checked;
      }
      this.enable();
    });
    this.runAll.addEventListener('click', () => this.events.run(this.files));
    this.runTicked.addEventListener('click', () => this.events.run(this.tickedFiles));
    $('tests-refresh').addEventListener('click', () => void this.refresh());
  }

  /** Every test, in the order they are listed. */
  get files(): string[] {
    return this.tests.map((t) => t.file);
  }

  get tickedFiles(): string[] {
    return this.files.filter((file) => this.ticked.has(file));
  }

  isTest(file: string): boolean {
    return this.tests.some((t) => t.file === file);
  }

  /** Looks for the tests again: of `root` when given, a folder just opened. */
  async refresh(root = this.root): Promise<void> {
    if (root !== this.root) {
      this.root = root;
      this.ticked.clear();
      this.outcomes.clear();
    }
    const turn = ++this.turn;
    let tests: TestFile[];
    try {
      tests = root ? await studio.listTests() : [];
    } catch (err) {
      if (turn !== this.turn) return;
      this.tests = [];
      clear(this.list);
      this.list.append(h('div', { class: 'empty error', text: `Could not look for tests: ${reason(err)}` }));
      return;
    }
    if (turn !== this.turn) return;
    this.tests = tests;
    const present = new Set(this.files);
    for (const file of [...this.ticked]) if (!present.has(file)) this.ticked.delete(file);
    this.render();
  }

  /** Says how a test went, or how it is going. */
  setOutcome(file: string, state: TestState, detail = ''): void {
    const test = this.tests.find((t) => t.file === file);
    if (!test) return;
    this.outcomes.set(file, { state, detail });
    const old = [...this.list.querySelectorAll<HTMLElement>('.test-row')].find((r) => r.dataset.file === file);
    old?.replaceWith(this.row(test));
    this.summarise();
  }

  /** While something runs, nothing else can be started from here. */
  setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('.test-row .run')) button.disabled = busy;
    this.enable();
  }

  private render(): void {
    clear(this.list);
    if (!this.root) {
      this.list.append(h('div', { class: 'empty', text: 'Open a folder to see its tests.' }));
    } else if (!this.tests.length) {
      this.list.append(
        h('div', {
          class: 'empty',
          text: 'No tests here. A test is a .hunt file that no other hunt borrows blocks from with @import.',
        }),
      );
    }
    let folder: string | undefined;
    for (const test of this.tests) {
      const at = test.path.lastIndexOf('/');
      const dir = at < 0 ? '' : test.path.slice(0, at);
      if (dir !== folder) {
        folder = dir;
        this.list.append(h('h3', { text: dir || 'top of the folder' }));
      }
      this.list.append(this.row(test));
    }
    this.summarise();
  }

  private row(test: TestFile): HTMLElement {
    const { state, detail } = this.outcomes.get(test.file) ?? { state: 'idle' as TestState, detail: '' };
    const name = test.path.slice(test.path.lastIndexOf('/') + 1).replace(/\.hunt$/i, '');
    const box = h('input', { type: 'checkbox', title: 'Run with the ticked ones', 'aria-label': `Tick ${test.path}` });
    box.checked = this.ticked.has(test.file);
    box.addEventListener('change', () => {
      if (box.checked) this.ticked.add(test.file);
      else this.ticked.delete(test.file);
      this.enable();
    });
    const tags = test.tags.length ? ` · ${test.tags.join(', ')}` : '';
    const run = h('button', {
      class: 'quiet run',
      type: 'button',
      title: `Run ${name}`,
      'aria-label': `Run ${test.path}`,
      text: '▶',
      onclick: () => this.events.run([test.file]),
    });
    run.disabled = this.busy;
    return h(
      'div',
      { class: `test-row ${state}`, 'data-file': test.file },
      box,
      h(
        'button',
        {
          class: 'show',
          type: 'button',
          title: [`${test.path}${test.title ? ` — ${test.title}` : ''}${tags}`, `${SAID[state]}${detail ? `: ${detail}` : ''}`].join('\n'),
          onclick: () => this.events.open(test.file),
        },
        h('span', { class: 'state', text: MARK[state], 'aria-label': SAID[state] }),
        h('span', { class: 'name', text: name }),
        h('span', { class: 'detail', text: detail || test.title }),
      ),
      run,
    );
  }

  private summarise(): void {
    const count = (state: TestState): number =>
      this.tests.filter((t) => (this.outcomes.get(t.file)?.state ?? 'idle') === state).length;
    const parts = [`${this.tests.length} ${this.tests.length === 1 ? 'test' : 'tests'}`];
    const passed = count('passed');
    const failed = count('failed') + count('error');
    if (passed) parts.push(`${passed} passed`);
    if (failed) parts.push(`${failed} failed`);
    $('tests-summary').textContent = this.root ? parts.join(' · ') : '';
    $('tests-tab').textContent = failed ? `Tests ${failed}✗` : 'Tests';
    this.enable();
  }

  private enable(): void {
    const ticked = this.tickedFiles.length;
    this.all.checked = ticked > 0 && ticked === this.tests.length;
    this.all.indeterminate = ticked > 0 && ticked < this.tests.length;
    this.all.disabled = !this.tests.length;
    this.runAll.disabled = this.busy || !this.tests.length;
    this.runTicked.disabled = this.busy || !ticked;
    this.runTicked.textContent = ticked ? `▶ Ticked (${ticked})` : '▶ Ticked';
  }
}
