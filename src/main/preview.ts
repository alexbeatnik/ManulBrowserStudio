// Serves the open folder to the editor's preview of an HTML file.
//
// The page is shown from `manul-preview://` (see src/shared/preview.ts), so it
// gets its stylesheets, scripts and pictures from the folder as a browser
// would — and gets the text of a file that is open with unsaved changes, so
// what is shown is what is in the editor. Nothing outside the open folder is
// served.

import { protocol } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PREVIEW_SCHEME, previewFile } from '../shared/preview';
import { isInside } from './workspace';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};

/** Must be called before the app is ready: the scheme is one a page can be served from. */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

export class PreviewServer {
  private drafts = new Map<string, string>();

  constructor(private readonly root: () => string) {}

  /** Starts answering preview addresses. */
  listen(): void {
    protocol.handle(PREVIEW_SCHEME, (request) => this.respond(request.url));
  }

  /** The unsaved text of open files, served in place of what is on disk. Replaces the last lot. */
  setDrafts(drafts: Record<string, string>): void {
    this.drafts = new Map(Object.entries(drafts).map(([file, text]) => [path.resolve(file), text]));
  }

  async respond(url: string): Promise<Response> {
    const file = previewFile(url);
    if (!file || !isInside(this.root(), file)) return new Response('Not in the open folder.', { status: 404 });
    const resolved = path.resolve(file);
    const headers = {
      'content-type': TYPES[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
      // Shown again after an edit, it must be read again.
      'cache-control': 'no-store',
    };
    const draft = this.drafts.get(resolved);
    if (draft !== undefined) return new Response(draft, { headers });
    try {
      return new Response(await fs.readFile(resolved), { headers });
    } catch {
      return new Response(`${path.basename(resolved)} is not there.`, { status: 404 });
    }
  }
}
