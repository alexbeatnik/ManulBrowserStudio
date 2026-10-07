// The files of the open folder, as a tree that reads a folder when it is
// opened and not before.

import type { DirEntry } from '../shared/api';
import { clear, h, studio } from './dom';

export class Explorer {
  private root = '';
  private active = '';
  private readonly expanded = new Set<string>();

  constructor(
    private readonly host: HTMLElement,
    private readonly open: (file: string) => void,
  ) {}

  async setRoot(root: string): Promise<void> {
    this.root = root;
    this.expanded.clear();
    await this.refresh();
  }

  /** Marks the file whose tab is in front. */
  setActive(file: string | undefined): void {
    this.active = file ?? '';
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
      into.append(h('div', { class: 'empty', text: (err as Error).message }));
      return;
    }
    if (depth === 0 && entries.length === 0) {
      into.append(h('div', { class: 'empty', text: 'This folder is empty. Use “+ New” to start a hunt.' }));
    }
    for (const entry of entries) {
      const pad = `${8 + depth * 14}px`;
      if (entry.dir) {
        const children = h('div');
        const twist = h('span', { class: 'twist', text: this.expanded.has(entry.path) ? '▾' : '▸' });
        const row = h('div', { class: 'row', style: `padding-left:${pad}`, title: entry.path }, twist, entry.name);
        row.addEventListener('click', () => {
          if (this.expanded.delete(entry.path)) {
            twist.textContent = '▸';
            clear(children);
          } else {
            this.expanded.add(entry.path);
            twist.textContent = '▾';
            void this.render(entry.path, children, depth + 1);
          }
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
            onclick: () => this.open(entry.path),
          },
          h('span', { class: 'twist' }),
          entry.name,
        );
        into.append(row);
      }
    }
  }
}
