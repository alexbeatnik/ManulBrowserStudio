// What is typed above the page, as an address a browser can be sent to.

/** Schemes that are written without `//` after them. */
const BARE_SCHEMES = /^(?:about|data|blob|file|view-source|chrome):/i;

/** A host that is this machine or a number: served without TLS, as a rule. */
function isLocal(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.startsWith('[') ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
  );
}

/**
 * `example.com` is `https://example.com`. `localhost:3000` is a host and a
 * port, not a scheme called localhost, and a server on one's own machine is
 * asked over http. A path on disk is the file at it. '' for nothing typed.
 */
export function toAddress(typed: string): string {
  const text = typed.trim();
  if (!text) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || BARE_SCHEMES.test(text)) return text;
  // C:\site\index.html, or /home/me/site/index.html
  if (/^[A-Za-z]:[\\/]/.test(text)) return encodeURI(`file:///${text.replace(/\\/g, '/')}`);
  if (text.startsWith('/')) return encodeURI(`file://${text}`);
  const host = (text.startsWith('[') ? text.slice(0, text.indexOf(']') + 1) : text.split(/[/:?#]/)[0]).toLowerCase();
  return `${isLocal(host) ? 'http' : 'https'}://${text}`;
}
