// The Libraries pane: what a hook script in this folder can import, and a way
// to add to it.

import type { InstalledPackage } from '../shared/api';
import { $, clear, h, studio } from './dom';

export interface LibraryEvents {
  /** npm is about to print; bring its output into view. */
  onStart(): void;
  onStatus(text: string): void;
  onError(title: string, message: string): void;
}

/** What an IPC rejection says, without Electron's wrapping. */
const reason = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export class Libraries {
  private readonly form = $<HTMLFormElement>('lib-form');
  private readonly input = $<HTMLInputElement>('lib-name');
  private readonly button = $<HTMLButtonElement>('lib-install');
  private readonly list = $('lib-list');
  private hasFolder = false;
  private busy = false;

  constructor(private readonly events: LibraryEvents) {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.install(this.input.value);
    });
  }

  /** Shows which Node and npm the app carries, here and in the status bar. */
  async showRuntime(): Promise<void> {
    const runtime = await studio.runtime();
    $('lib-runtime').textContent = `Node ${runtime.node} · npm ${runtime.npm}`;
    const status = $('status-node');
    status.textContent = `Node ${runtime.node}`;
    status.title = `The Node built into the app (Electron ${runtime.electron}). Hook scripts run on it; npm ${runtime.npm} installs libraries for them.`;
  }

  /** Reads the open folder's libraries again. */
  async refresh(folder: string): Promise<void> {
    this.hasFolder = !!folder;
    this.enable();
    clear(this.list);
    if (!folder) {
      this.list.append(h('div', { class: 'empty', text: 'Open a folder to install libraries into it.' }));
      return;
    }
    let packages: InstalledPackage[];
    try {
      packages = await studio.packages();
    } catch (err) {
      this.list.append(h('div', { class: 'empty', text: reason(err) }));
      return;
    }
    if (packages.length === 0) {
      this.list.append(
        h('div', {
          class: 'empty',
          text: 'No libraries yet. One installed here can be imported by this folder’s hook scripts.',
        }),
      );
      return;
    }
    for (const pkg of packages) {
      this.list.append(
        h(
          'div',
          { class: 'lib', title: `${pkg.name} ${pkg.wanted}${pkg.dev ? ' (dev)' : ''}` },
          h('span', { class: 'name', text: pkg.name }),
          h('span', { class: `version${pkg.version ? '' : ' missing'}`, text: pkg.version || 'not installed' }),
          h('button', {
            class: 'quiet remove',
            text: 'remove',
            title: `Uninstall ${pkg.name}`,
            onclick: () => void this.run(`Removing ${pkg.name}…`, () => studio.removePackage(pkg.name)),
          }),
        ),
      );
    }
  }

  private enable(): void {
    const off = this.busy || !this.hasFolder;
    this.input.disabled = off;
    this.button.disabled = off;
    for (const b of this.list.querySelectorAll<HTMLButtonElement>('button.remove')) b.disabled = this.busy;
  }

  private async install(text: string): Promise<void> {
    if (!text.trim()) return;
    const ok = await this.run(`Installing ${text.trim()}…`, () => studio.installPackages(text));
    if (ok) this.input.value = '';
  }

  private async run(status: string, work: () => Promise<number>): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.enable();
    this.events.onStart();
    this.events.onStatus(status);
    let ok = false;
    try {
      const code = await work();
      ok = code === 0;
      this.events.onStatus(ok ? 'Libraries updated' : 'npm failed; see Output');
    } catch (err) {
      this.events.onStatus('Ready');
      this.events.onError('Libraries', reason(err));
    } finally {
      this.busy = false;
      const settings = await studio.getSettings();
      await this.refresh(settings.workspace);
    }
    return ok;
  }
}
