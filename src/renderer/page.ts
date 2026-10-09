// The page panel: what the browser is showing, and what on it can be acted
// on.
//
// It has two sources. A live session gives a picture and a map of elements,
// and takes steps one at a time. A run of a file gives only the pictures its
// steps record, so the map is left as it was and marked as not belonging to
// the picture above it.
//
// With the built-in browser there is no picture: the page itself is in the
// panel, drawn there by the app, and runs and the live session both happen
// in it.

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
  private readonly zoom = $<HTMLButtonElement>('shot-zoom');
  private readonly shotHost = $('shot-host');
  private readonly shotEmpty = $('shot-empty');
  private readonly browserHost = $('browser-host');
  private builtIn = false;
  private readonly source = $('page-source');
  private readonly map = $('map');
  private readonly filter = $<HTMLInputElement>('map-filter');
  private snapshot: LiveSnapshot = CLOSED_SNAPSHOT;
  private busy = 0;
  private shotZoomed = false;

  constructor(private readonly events: PageEvents) {
    this.toggle.addEventListener('click', () => void (this.snapshot.open ? this.close() : this.open()));
    $('live-refresh').addEventListener('click', () => void this.refresh());
    this.zoom.addEventListener('click', () => {
      this.shotZoomed = !this.shotZoomed;
      this.shotHost.classList.toggle('zoomed', this.shotZoomed);
      this.zoom.textContent = this.shotZoomed ? 'Fit' : '100%';
      this.zoom.title = this.shotZoomed ? 'Fit screenshot to the panel' : 'Show screenshot at its original size';
    });
    this.address.addEventListener('submit', (e) => {
      e.preventDefault();
      const typed = this.url.value.trim();
      if (!typed) return;
      const target = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
      if (this.builtIn) void this.visit(target);
      else void this.step(`NAVIGATE to ${target}`);
    });
    this.filter.addEventListener('input', () => this.renderMap());

    // The built-in browser is told where the box it belongs in is, whenever
    // that changes. It is drawn above the window, so it is taken away while
    // the window has something to show over it, and while a splitter beside
    // it is being dragged.
    new ResizeObserver(() => this.place()).observe(this.browserHost);
    window.addEventListener('resize', () => this.place());
    new MutationObserver(() => this.place()).observe($('dialog-backdrop'), { attributeFilter: ['class'] });
    document.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest?.('.splitter')) return;
      this.dragging = true;
      this.place();
      document.addEventListener(
        'pointerup',
        () => {
          this.dragging = false;
          this.place();
        },
        { once: true },
      );
    });
    studio.onPageState((state) => {
      if (this.builtIn && document.activeElement !== this.url) this.url.value = state.url;
    });
    this.render();
  }

  /** Whether the page is the built-in browser's, and so in the panel itself. */
  setBuiltIn(on: boolean): void {
    this.builtIn = on;
    this.shotHost.classList.toggle('built-in', on);
    this.render();
    this.place();
  }

  private dragging = false;

  private place(): void {
    const box = this.browserHost.getBoundingClientRect();
    const covered = this.dragging || !$('dialog-backdrop').classList.contains('hidden');
    const shown = this.builtIn && !covered && box.width > 0 && box.height > 0;
    void studio.pagePlace(shown ? { x: box.x, y: box.y, width: box.width, height: box.height } : null);
  }

  /** Sends the built-in browser to an address; the map follows if there is one. */
  private async visit(target: string): Promise<void> {
    await this.working(`Opening ${target}`, () => studio.pageNavigate(target));
    if (this.snapshot.open) await this.refresh();
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
    // The built-in browser is showing the run itself.
    if (this.builtIn) return;
    this.setShot(dataUrl, caption);
    this.map.classList.toggle('stale', this.snapshot.open);
  }

  private setShot(dataUrl: string, caption: string): void {
    if (dataUrl) {
      this.shot.src = dataUrl;
      this.shotEmpty.classList.add('hidden');
    } else {
      this.shot.removeAttribute('src');
      this.shotEmpty.classList.remove('hidden');
    }
    this.source.textContent = caption;
    this.zoom.disabled = !dataUrl;
  }

  private render(): void {
    const open = this.snapshot.open;
    this.toggle.textContent = open ? 'End live session' : 'Start live session';
    this.zoom.classList.toggle('hidden', this.builtIn);
    this.address.classList.toggle('hidden', !open && !this.builtIn);
    this.filter.disabled = !open;
    if (this.builtIn) this.source.textContent = open ? 'live · built-in' : 'built-in';
    else if (!open && !this.shot.getAttribute('src')) this.source.textContent = '';
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
            { class: 'el' },
            h(
              'button',
              { class: 'pick', title: 'Write the step that acts on this', onclick: () => this.events.onPick(el) },
              h('span', { class: 'role', text: el.role || 'element' }),
              h('span', { class: 'label', text: el.label }),
            ),
            h('button', {
              class: 'verify',
              text: 'verify',
              title: 'Write a step that checks this is on the page',
              onclick: () => this.events.onVerify(el),
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
