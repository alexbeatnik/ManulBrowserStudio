// What a run says, under the editor: its steps as they finish, the engine's
// own output, the variables at a pause, and the answer to "what would this
// step act on?".

import type { CandidateResult, ExplainEvent, HuntResult, StepResult } from '../core/runner';
import type { LiveStepOutcome } from '../shared/api';
import { $, clear, duration, h } from './dom';

/** How much engine output is kept; the oldest goes first. */
const LOG_LIMIT = 400_000;

/**
 * True for the step a debugged run was stopped on. The engine reports it as a
 * failed step, with this as its error; to the author it is where they pressed
 * Stop.
 */
export const stoppedByAuthor = (step: StepResult): boolean =>
  !step.success && /debug: stop requested/i.test(step.error ?? '');

const candidateName = (c: CandidateResult): string =>
  c.visible_text || c.aria_label || c.placeholder || c.id || `<${c.tag}>`;

export class Panels {
  private readonly results = $('results');
  private readonly log = $('log');
  private readonly variables = $('variables');
  private readonly explain = $('explain-pane');
  private readonly summary = $('run-summary');
  private block = '';
  private passed = 0;
  private failed = 0;

  constructor(
    private readonly show: (pane: string) => void,
    private readonly reveal: (line: number) => void,
  ) {
    this.reset();
  }

  /** Clears everything a previous run left. */
  reset(): void {
    clear(this.results);
    this.results.append(h('div', { class: 'empty', text: 'Run a file (F5), or run the line under the caret in a live session (Ctrl+Enter).' }));
    this.log.textContent = '';
    this.block = '';
    this.passed = 0;
    this.failed = 0;
    this.summary.textContent = '';
    this.setVariables({}, 'Variables are shown while a run is paused, and for the live session.');
    clear(this.explain);
    this.explain.append(h('div', { class: 'empty', text: 'Pause a run on a step and press Explain to see what it would act on.' }));
  }

  private append(row: HTMLElement): void {
    this.results.querySelector('.empty')?.remove();
    // Follow the run only while the view is already at its end.
    const atEnd = this.results.scrollTop + this.results.clientHeight >= this.results.scrollHeight - 30;
    this.results.append(row);
    if (atEnd) this.results.scrollTop = this.results.scrollHeight;
  }

  addStep(step: StepResult, line: number | undefined): void {
    if ((step.step_block ?? '') !== this.block) {
      this.block = step.step_block ?? '';
      if (this.block) this.append(h('div', { class: 'result block', text: this.block }));
    }
    // The step a run was stopped on did not fail; it was not run.
    if (stoppedByAuthor(step)) {
      this.append(
        h(
          'div',
          { class: 'result stopped' },
          h('span', { class: 'mark', text: '■' }),
          h('span', { class: 'text', text: step.step }),
          h('span', { class: 'meta', text: 'stopped here' }),
        ),
      );
      return;
    }
    if (step.success) this.passed++;
    else this.failed++;
    this.summary.textContent = `${this.passed} passed · ${this.failed} failed`;

    const meta = [step.winner_score ? `score ${step.winner_score.toFixed(2)}` : '', duration(step.duration_ms)]
      .filter(Boolean)
      .join(' · ');
    // What the step produced, unless the step's own text already says it.
    const value = step.success && step.action_value && !step.step.includes(step.action_value) ? step.action_value : '';
    const row = h(
      'div',
      { class: `result ${step.success ? 'pass' : 'fail'}`, title: line === undefined ? '' : `Line ${line + 1}` },
      h('span', { class: 'mark', text: step.success ? '✓' : '✗' }),
      h('span', { class: 'text', text: step.step }),
      h('span', { class: 'meta value', text: value ? `→ ${value}` : '', title: value }),
      h('span', { class: 'meta', text: meta }),
    );
    if (!step.success) {
      row.append(h('div', { class: 'detail', text: step.error || step.failure_reason || 'failed' }));
      const near = (step.ranked_candidates ?? []).slice(0, 4);
      if (near.length) {
        const list = near.map((c) => `${candidateName(c)} (${(c.score?.total ?? 0).toFixed(2)})`).join(' · ');
        row.append(h('div', { class: 'near', text: `closest on the page: ${list}` }));
      }
    }
    if (line !== undefined) this.makeRevealable(row, line, step.step);
    this.append(row);
  }

  /** A step run on its own in the live session. */
  addLive(outcome: LiveStepOutcome, line: number | undefined): void {
    if (this.block !== 'Live session') {
      this.block = 'Live session';
      this.append(h('div', { class: 'result block', text: this.block }));
    }
    const row = h(
      'div',
      { class: `result ${outcome.ok ? 'pass' : 'fail'}` },
      h('span', { class: 'mark', text: outcome.ok ? '✓' : '✗' }),
      h('span', { class: 'text', text: outcome.step }),
      h('span', { class: 'meta', text: outcome.value && outcome.ok ? `→ ${outcome.value}` : '' }),
      h('span', { class: 'meta', text: outcome.score ? `score ${outcome.score.toFixed(2)}` : '' }),
    );
    if (!outcome.ok) {
      row.append(h('div', { class: 'detail', text: outcome.error || outcome.reason || 'failed' }));
      if (outcome.near.length) {
        const list = outcome.near.map((n) => `${n.text} (${n.score.toFixed(2)})`).join(' · ');
        row.append(h('div', { class: 'near', text: `closest on the page: ${list}` }));
      }
    }
    if (line !== undefined) this.makeRevealable(row, line, outcome.step);
    this.append(row);
    this.show('results');
  }

  private makeRevealable(row: HTMLElement, line: number, step: string): void {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Go to line ${line + 1}: ${step}`);
    row.addEventListener('click', () => this.reveal(line));
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.reveal(line);
    });
  }

  finish(result: HuntResult): void {
    const verdict = result.success ? 'passed' : 'failed';
    const soft = result.soft_errors?.length ? ` · ${result.soft_errors.length} soft` : '';
    this.summary.textContent = `${verdict}: ${result.passed}/${result.total_steps} steps · ${duration(result.total_duration_ms)}${soft}`;
    for (const warning of result.soft_errors ?? []) {
      this.append(h('div', { class: 'result fail' }, h('span', { class: 'mark', text: '!' }), h('span', { class: 'text', text: warning })));
    }
  }

  addLog(text: string): void {
    const atEnd = this.log.parentElement
      ? this.log.parentElement.scrollTop + this.log.parentElement.clientHeight >= this.log.parentElement.scrollHeight - 30
      : true;
    let next = `${this.log.textContent ?? ''}${text}\n`;
    if (next.length > LOG_LIMIT) next = next.slice(next.indexOf('\n', next.length - LOG_LIMIT) + 1);
    this.log.textContent = next;
    if (atEnd && this.log.parentElement) this.log.parentElement.scrollTop = this.log.parentElement.scrollHeight;
  }

  setVariables(vars: Record<string, string>, emptyNote = 'No variables are set.'): void {
    clear(this.variables);
    const names = Object.keys(vars).sort();
    if (!names.length) {
      this.variables.append(h('div', { class: 'empty', text: emptyNote }));
      return;
    }
    const table = h('table', { class: 'kv' });
    for (const name of names) {
      table.append(h('tr', {}, h('td', { text: `{${name}}` }), h('td', { text: vars[name] })));
    }
    this.variables.append(table);
  }

  setExplain(ev: ExplainEvent): void {
    clear(this.explain);
    const label = ev.confidence_label ?? (ev.target_found ? 'low' : 'none');
    const box = h(
      'div',
      { class: 'explain' },
      h('div', {}, h('code', { text: ev.step })),
      h('p', {}, h('span', { class: `confidence ${label}`, text: label }), ` score ${ev.score.toFixed(3)}`),
    );
    const table = h('table', { class: 'kv' });
    const row = (name: string, value: string | null | undefined): void => {
      if (value) table.append(h('tr', {}, h('td', { text: name }), h('td', { text: value })));
    };
    row('target', ev.target_found === false ? 'nothing on the page matches' : ev.target_element);
    row('why', ev.explanation);
    row('risk', ev.risk);
    row('instead', ev.suggestion);
    row('matched', ev.heuristic_match);
    box.append(table);
    this.explain.append(box);
    this.show('explain-pane');
  }
}
