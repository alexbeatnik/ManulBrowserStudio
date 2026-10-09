// The files of the open folder, as a tree that reads a folder when it is
// opened and not before.

import type { DirEntry } from '../shared/api';
import { clear, dirname, h, reason, studio } from './dom';
import { iconFor } from './icons';

export class Explorer {
  private root = '';
  private active = '';
  /** The folder last clicked, or the one of the file in front. */
  private focus = '';
  private readonly expanded = new Set<string>();

  constructor(
    private readonly host: HTMLElement,
    private readonly open: (file: string) => void,
  ) {}

  async setRoot(root: string): Promise<void> {
    this.root = root;
    this.focus = '';
    this.expanded.clear();
    await this.refresh();
  }

  /** Where a new file or folder goes: the folder in focus, else the top. */
  targetDir(): string {
    return this.focus || this.root;
  }

  /** Opens a folder in the tree, and every folder above it. */
  reveal(dir: string): void {
    for (let d = dir; d.length > this.root.length; d = dirname(d)) this.expanded.add(d);
  }

  /** Makes a folder the one new files and folders go into. */
  setTarget(dir: string): void {
    this.focus = dir === this.root ? '' : dir;
  }

  private markTarget(): void {
    for (const row of this.host.querySelectorAll<HTMLElement>('.row[data-dir]')) {
      row.classList.toggle('target', row.dataset.dir === this.focus);
    }
  }

  /** Marks the file whose tab is in front. */
  setActive(file: string | undefined): void {
    this.active = file ?? '';
    if (file) {
      const dir = dirname(file);
      this.focus = dir === this.root ? '' : dir;
      this.markTarget();
    }
    for (const row of this.host.querySelectorAll<HTMLElement>('.row')) {
      row.classList.toggle('active', row.dataset.path === this.active);
    }
  }

  async refresh(): Promise<void> {
    clear(this.host);
    if (!this.root) return;
    await this.render(this.root, this.host, 0);
  }

  private async render(dir: string, into: HTMLElement, depth: number): Promise<void> {
    let entries: DirEntry[];
    try {
      entries = await studio.listDir(dir);
    } catch (err) {
      into.append(h('div', { class: 'empty error', text: reason(err) }));
      return;
    }
    if (depth === 0 && entries.length === 0) {
      into.append(h('div', { class: 'empty', text: 'This folder is empty. Use “+ File” to start a hunt.' }));
    }
    for (const entry of entries) {
      const pad = `${8 + depth * 14}px`;
      if (entry.dir) {
        const children = h('div');
        const open = this.expanded.has(entry.path);
        const twist = h('span', { class: 'twist', text: open ? '▾' : '▸' });
        let icon = iconFor(entry.name, open ? 'folder-open' : 'folder');
        const row = h(
          'div',
          {
            class: `row${entry.path === this.focus ? ' target' : ''}`,
            style: `padding-left:${pad}`,
            title: entry.path,
            'data-dir': entry.path,
            role: 'button',
            tabindex: '0',
            'aria-expanded': String(open),
            'aria-label': `${open ? 'Collapse' : 'Expand'} ${entry.name}`,
          },
          twist,
          icon,
          entry.name,
        );
        const setOpen = (now: boolean): void => {
          twist.textContent = now ? '▾' : '▸';
          row.setAttribute('aria-expanded', String(now));
          row.setAttribute('aria-label', `${now ? 'Collapse' : 'Expand'} ${entry.name}`);
          const next = iconFor(entry.name, now ? 'folder-open' : 'folder');
          icon.replaceWith(next);
          icon = next;
        };
        const toggle = (): void => {
          this.focus = entry.path;
          this.markTarget();
          if (this.expanded.delete(entry.path)) {
            setOpen(false);
            clear(children);
          } else {
            this.expanded.add(entry.path);
            setOpen(true);
            void this.render(entry.path, children, depth + 1);
          }
        };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggle();
        });
        into.append(row, children);
        if (this.expanded.has(entry.path)) await this.render(entry.path, children, depth + 1);
      } else {
        const hunt = entry.name.toLowerCase().endsWith('.hunt');
        const row = h(
          'div',
          {
            class: `row ${hunt ? 'hunt' : 'other'}${entry.path === this.active ? ' active' : ''}`,
            style: `padding-left:${pad}`,
            title: entry.path,
            'data-path': entry.path,
            role: 'button',
            tabindex: '0',
            onclick: () => this.open(entry.path),
          },
          h('span', { class: 'twist' }),
          iconFor(entry.name),
          entry.name,
        );
        row.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          this.open(entry.path);
        });
        into.append(row);
      }
    }
  }
}
