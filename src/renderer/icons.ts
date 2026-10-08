// An icon for every kind of file the explorer and the tabs show.
//
// A hunt carries the Manul Browser mark. Everything else gets a small tile in
// the colour its language is usually given, with a letter or two on it — drawn
// here, so there is no icon pack to ship or to license.

import manul from './assets/manul.png';
import { h } from './dom';

export const MANUL_ICON: string = manul;

interface Tile {
  text: string;
  /** Background. */
  color: string;
  /** Text colour; white unless the background is light. */
  ink?: string;
}

const TILES: Record<string, Tile> = {
  py: { text: 'py', color: '#3572a5' },
  js: { text: 'js', color: '#f1e05a', ink: '#1d1d1d' },
  mjs: { text: 'js', color: '#f1e05a', ink: '#1d1d1d' },
  cjs: { text: 'js', color: '#f1e05a', ink: '#1d1d1d' },
  jsx: { text: 'jsx', color: '#f1e05a', ink: '#1d1d1d' },
  ts: { text: 'ts', color: '#3178c6' },
  tsx: { text: 'tsx', color: '#3178c6' },
  go: { text: 'go', color: '#00add8', ink: '#06222b' },
  json: { text: '{}', color: '#cb9b3b', ink: '#1d1d1d' },
  jsonl: { text: '{}', color: '#cb9b3b', ink: '#1d1d1d' },
  html: { text: '<>', color: '#e34c26' },
  htm: { text: '<>', color: '#e34c26' },
  xml: { text: '<>', color: '#8a6d3b' },
  css: { text: '#', color: '#7b52c7' },
  scss: { text: '#', color: '#c6538c' },
  md: { text: 'md', color: '#4a6fa5' },
  yml: { text: 'y', color: '#cb171e' },
  yaml: { text: 'y', color: '#cb171e' },
  toml: { text: 't', color: '#9c4221' },
  ini: { text: '⚙', color: '#5a6272' },
  cfg: { text: '⚙', color: '#5a6272' },
  env: { text: '⚙', color: '#5a6272' },
  csv: { text: '▦', color: '#2f8f5b' },
  tsv: { text: '▦', color: '#2f8f5b' },
  txt: { text: '≡', color: '#5a6272' },
  log: { text: '≡', color: '#5a6272' },
  sh: { text: '>_', color: '#3c8d40' },
  bash: { text: '>_', color: '#3c8d40' },
  bat: { text: '>_', color: '#3c8d40' },
  cmd: { text: '>_', color: '#3c8d40' },
  ps1: { text: '>_', color: '#2a6fb0' },
  sql: { text: 'db', color: '#b8662e' },
  png: { text: '◩', color: '#7d5ba6' },
  jpg: { text: '◩', color: '#7d5ba6' },
  jpeg: { text: '◩', color: '#7d5ba6' },
  gif: { text: '◩', color: '#7d5ba6' },
  webp: { text: '◩', color: '#7d5ba6' },
  svg: { text: '◩', color: '#b07a1e' },
  ico: { text: '◩', color: '#7d5ba6' },
  pdf: { text: 'pdf', color: '#b5302a' },
  zip: { text: 'zip', color: '#6b6f7a' },
  lock: { text: '🔒', color: 'transparent' },
};

/** Files known by their whole name rather than by an extension. */
const NAMES: Record<string, Tile> = {
  dockerfile: { text: '🐳', color: 'transparent' },
  makefile: { text: 'mk', color: '#5a6272' },
  license: { text: '§', color: '#5a6272' },
  '.gitignore': { text: 'git', color: '#b5432f' },
  '.gitattributes': { text: 'git', color: '#b5432f' },
  '.env': { text: '⚙', color: '#5a6272' },
};

const FOLDER =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="#c9a45c" d="M1.5 3.5a1 1 0 0 1 1-1h3.3l1.4 1.5h6.3a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/></svg>';
const FOLDER_OPEN =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="#a8874a" d="M1.5 3.5a1 1 0 0 1 1-1h3.3l1.4 1.5h5.8a1 1 0 0 1 1 1V6h-10L1.5 12z"/><path fill="#e0b965" d="M3.6 6.5h11.2a.6.6 0 0 1 .58.77l-1.5 5.3a1 1 0 0 1-.96.73H1.9a.4.4 0 0 1-.38-.5l1.5-5.57a.6.6 0 0 1 .58-.73z"/></svg>';
const FILE =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="none" stroke="#7b8291" d="M3.5 1.5h6l3 3v10h-9z"/><path fill="none" stroke="#7b8291" d="M9.5 1.5v3h3"/></svg>';

export type IconKind = 'folder' | 'folder-open' | 'file';

/** The icon for a file or folder name. */
export function iconFor(name: string, kind: IconKind = 'file'): HTMLElement {
  const box = h('span', { class: 'ficon' });
  if (kind !== 'file') {
    box.innerHTML = kind === 'folder' ? FOLDER : FOLDER_OPEN;
    return box;
  }
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  if (ext === 'hunt') {
    box.append(h('img', { src: MANUL_ICON, alt: '' }));
    return box;
  }
  const tile = NAMES[lower] ?? TILES[ext];
  if (!tile) {
    box.innerHTML = FILE;
    return box;
  }
  box.append(
    h('span', {
      class: `tile${tile.text.length > 2 ? ' narrow' : ''}`,
      text: tile.text,
      style: `background:${tile.color};color:${tile.ink ?? '#fff'}`,
    }),
  );
  return box;
}
