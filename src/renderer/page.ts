// The page panel: what the browser is showing, and what on it can be acted
// on.
//
// It has two sources. A live session gives a picture and a map of elements,
// and takes steps one at a time. A run of a file gives only the pictures its
// steps record, so the map is left as it was and marked as not belonging to
// the picture above it.

import type { LiveSnapshot, MapElement } from '../shared/api';
import { CLOSED_SNAPSHOT } from '../shared/api';
import { $, clear, h, studio } from './dom';

export interface PageEvents {
  /** An element was picked: write the step that acts on it. */
  onPick(element: MapElement): void;
  /** Its "verify" button was pressed: write the step that asserts it. */
  onVerify(element: MapElement): void;
  onStatus(text: string): void;
  onVariables(vars: Record<string, string>): void;
  /** Something went wrong that the author should read. */
  onError(message: string): void;
}

export class PagePanel {
  private readonly toggle = $<HTMLButtonElement>('live-toggle');
  private readonly address = $<HTMLFormElement>('address');
  private readonly url = $<HTMLInputElement>('url');
  private readonly shot = $<HTMLImageElement>('shot');
  private readonly shotHost = $('shot-host');
  private readonly shotEmpty = $('shot-empty');
  private readonly source = $('page-source');
  private readonly map = $('map');
  private readonly filter = $<HTMLInputElement>('map-filter');
  private snapshot: LiveSnapshot = CLOSED_SNAPSHOT;
  private busy = 0;

  constructor(private readonly events: PageEvents) {
    this.toggle.addEventListener('click', () => void (this.snapshot.open ? this.close() : this.open()));
    $('live-refresh').addEventListener('click', () => void this.refresh());
    this.address.addEventListener('submit', (e) => {
      e.preventDefault();
      const typed = this.url.value.trim();
      if (!typed) return;
      const target = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
      void this.step(`NAVIGATE to ${target}`);
    });
    this.filter.addEventListener('input', () => this.renderMap());
    this.render();
  }

  get isOpen(): boolean {
    return this.snapshot.open;
  }

  /** Runs `work` with the panel marked busy, and reports what it throws. */
  private async working<T>(what: string, work: () => Promise<T>): Promise<T | undefined> {
    this.busy++;
    this.shotHost.classList.add('busy');
    this.toggle.disabled = true;
    this.events.onStatus(what);
    try {
      return await work();
    } catch (err) {
      this.events.onError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      return undefined;
    } finally {
      if (--this.busy === 0) {
        this.shotHost.classList.remove('busy');
        this.toggle.disabled = false;
        this.events.onStatus('Ready');
      }
    }
  }

  async open(): Promise<boolean> {
    const snapshot = await this.working('Starting the live session…', () => studio.liveOpen());
    if (snapshot) this.apply(snapshot);
    return this.snapshot.open;
  }

  async close(): Promise<void> {
    await this.working('Closing the live session…', () => studio.liveClose());
    this.apply(CLOSED_SNAPSHOT);
  }

  async refresh(): Promise<void> {
    const snapshot = await this.working('Reading the page…', () => studio.liveRefresh());
    if (snapshot) this.apply(snapshot);
  }

  /** Runs one step in the live session and shows the page it leaves. */
  async step(text: string): Promise<Awaited<ReturnType<typeof studio.liveStep>>['outcome'] | undefined> {
    const done = await this.working(`Running: ${text}`, () => studio.liveStep(text));
    if (!done) return undefined;
    this.apply(done.snapshot);
    return done.outcome;
  }

  /** The app's settings changed under an open session; it is gone. */
  closedElsewhere(): void {
    this.apply(CLOSED_SNAPSHOT);
  }

  private apply(snapshot: LiveSnapshot): void {
    this.snapshot = snapshot;
    if (snapshot.open) {
      this.url.value = snapshot.url;
      this.setShot(snapshot.screenshot, `live · ${snapshot.browser}`);
      this.events.onVariables(snapshot.vars);
    }
    this.render();
  }

  /** Shows a picture a run recorded. The map keeps whatever it last showed. */
  showRunShot(dataUrl: string, caption: string): void {
    this.setShot(dataUrl, caption);
    this.map.classList.toggle('stale', this.snapshot.open);
  }

  private setShot(dataUrl: string, caption: string): void {
    if (dataUrl) {
      this.shot.src = dataUrl;
      this.shotEmpty.classList.add('hidden');
    }
    this.source.textContent = caption;
  }

  private render(): void {
    const open = this.snapshot.open;
    this.toggle.textContent = open ? 'End live session' : 'Start live session';
    this.address.classList.toggle('hidden', !open);
    this.filter.disabled = !open;
    if (!open && !this.shot.getAttribute('src')) this.source.textContent = '';
    this.renderMap();
  }

  private renderMap(): void {
    clear(this.map);
    this.map.classList.remove('stale');
    if (!this.snapshot.open) {
      this.map.append(
        h('div', {
          class: 'empty',
          text: 'A live session lists what is on the page here. Click an element to write the step that acts on it.',
        }),
      );
      return;
    }
    const wanted = this.filter.value.trim().toLowerCase();
    let shown = 0;
    for (const group of this.snapshot.groups) {
      const elements = group.elements.filter(
        (el) => !wanted || el.label.toLowerCase().includes(wanted) || el.role.toLowerCase().includes(wanted),
      );
      if (!elements.length) continue;
      this.map.append(h('h3', { text: group.name + (group.truncated ? ` (+${group.truncated} more)` : '') }));
      for (const el of elements) {
        shown++;
        this.map.append(
          h(
            'div',
            { class: 'el', title: 'Write the step that acts on this', onclick: () => this.events.onPick(el) },
            h('span', { class: 'role', text: el.role || 'element' }),
            h('span', { class: 'label', text: el.label }),
            h('button', {
              class: 'verify',
              text: 'verify',
              title: 'Write a step that checks this is on the page',
              onclick: (e) => {
                e.stopPropagation();
                this.events.onVerify(el);
              },
            }),
          ),
        );
      }
    }
    if (!shown) {
      this.map.append(
        h('div', {
          class: 'empty',
          text: wanted ? 'Nothing on the page matches the filter.' : 'Nothing to act on here yet. Type an address above and press Enter.',
        }),
      );
    }
  }
}
