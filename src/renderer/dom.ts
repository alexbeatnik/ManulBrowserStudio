// The few DOM helpers the window is built with. There is no framework here:
// the views are small, and each one owns the element it draws into.

import type { StudioApi } from '../shared/api';

declare global {
  interface Window {
    studio: StudioApi;
  }
}

export const studio = window.studio;

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
}

type Child = Node | string | false | null | undefined;

interface Props {
  class?: string;
  title?: string;
  text?: string;
  onclick?: (event: MouseEvent) => void;
  [attribute: string]: unknown;
}

/** Creates an element. `class`, `title`, `text` and `onclick` are set as such; anything else is an attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'onclick') el.addEventListener('click', value as EventListener);
    else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    el.append(child);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

export function dirname(file: string): string {
  const at = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return at > 0 ? file.slice(0, at) : file;
}

/** `1234` → `1.2s`, `87` → `87ms`. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Wires a row of tab buttons to the panes they name by `data-tab`. */
export function tabs(nav: HTMLElement, onChange?: (id: string) => void): (id: string) => void {
  const buttons = [...nav.querySelectorAll<HTMLButtonElement>('button[data-tab]')];
  const show = (id: string): void => {
    for (const b of buttons) {
      const active = b.dataset.tab === id;
      b.classList.toggle('active', active);
      document.getElementById(b.dataset.tab ?? '')?.classList.toggle('active', active);
    }
    onChange?.(id);
  };
  for (const b of buttons) b.addEventListener('click', () => show(b.dataset.tab ?? ''));
  return show;
}

/**
 * Makes a splitter drag a CSS length. `sign` is +1 when dragging towards the
 * positive axis grows the pane the variable sizes, -1 when it shrinks it.
 */
export function resizable(
  splitter: HTMLElement,
  variable: string,
  axis: 'x' | 'y',
  sign: 1 | -1,
  min: number,
  max: () => number,
): void {
  splitter.addEventListener('pointerdown', (down) => {
    down.preventDefault();
    splitter.setPointerCapture(down.pointerId);
    splitter.classList.add('dragging');
    const root = document.documentElement;
    const start = axis === 'x' ? down.clientX : down.clientY;
    const initial = parseFloat(getComputedStyle(root).getPropertyValue(variable)) || min;
    const basis =
      variable === '--map-h' ? (document.getElementById('map-host')?.getBoundingClientRect().height ?? initial) : initial;
    const move = (ev: PointerEvent): void => {
      const delta = ((axis === 'x' ? ev.clientX : ev.clientY) - start) * sign;
      const size = Math.min(max(), Math.max(min, basis + delta));
      root.style.setProperty(variable, `${size}px`);
    };
    const up = (): void => {
      splitter.classList.remove('dragging');
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
  });
}
