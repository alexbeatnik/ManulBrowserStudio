// How a file in the open folder is addressed when it is shown as a page
// rather than as text.
//
// A page is served from an address of its own, `manul-preview://files/…`, with
// the file's path for the rest. The path keeps its folders, so whatever the
// page names beside it — `shop.css`, `img/logo.png` — resolves to a file
// beside it, as it would in a browser.

export const PREVIEW_SCHEME = 'manul-preview';
const ORIGIN = `${PREVIEW_SCHEME}://files`;

/** What a file can be shown as, besides its text. */
export type PreviewKind = 'html' | 'markdown';

export function previewKind(file: string): PreviewKind | undefined {
  const ext = file.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  return undefined;
}

/** The address a file is shown at. */
export function previewUrl(file: string): string {
  const parts = file.replace(/\\/g, '/').split('/');
  // A path from the root starts with '' — the root is the address's own.
  if (parts[0] === '') parts.shift();
  return `${ORIGIN}/${parts.map(encodeURIComponent).join('/')}`;
}

/**
 * The file an address is of; undefined for one that is not a preview address.
 * Whether the file may be read is for the caller to say.
 */
export function previewFile(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== `${PREVIEW_SCHEME}:` || parsed.host !== 'files') return undefined;
  let parts: string[];
  try {
    parts = parsed.pathname.split('/').slice(1).map(decodeURIComponent);
  } catch {
    return undefined;
  }
  if (!parts.length || parts.every((p) => p === '')) return undefined;
  // A Windows path starts at a drive, and is written as Windows writes it, to
  // be the same path as the one the explorer gives; any other starts at the root.
  return /^[A-Za-z]:$/.test(parts[0]) ? parts.join('\\') : `/${parts.join('/')}`;
}
