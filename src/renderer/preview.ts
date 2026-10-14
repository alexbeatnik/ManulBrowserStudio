// The other way to look at an HTML or Markdown file: as what it makes,
// instead of as its text.
//
// An HTML file is shown as a page, in a frame served from the open folder by
// the main process (src/main/preview.ts) — its own stylesheets and scripts
// with it. A Markdown file is turned into HTML here, cleaned of anything that
// could run, and drawn in the window itself.

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import * as monaco from 'monaco-editor';
import { previewFile, PreviewKind, previewUrl } from '../shared/preview';
import { clear, h, studio } from './dom';
import { HUNT } from './hunt';

export interface PreviewEvents {
  /** A link in a Markdown file to another file in the folder was followed. */
  openFile(file: string): void;
}

export class PreviewView {
  private readonly frame: HTMLIFrameElement;
  private readonly doc: HTMLElement;
  /** How far down each Markdown file was read, to come back to. */
  private readonly scrolled = new Map<string, number>();
  private shown?: { path: string; kind: PreviewKind };

  constructor(
    private readonly host: HTMLElement,
    private readonly events: PreviewEvents,
  ) {
    // Its own origin, not the window's: the page's scripts run, and can reach
    // nothing of the app's.
    this.frame = h('iframe', {
      class: 'preview-frame',
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
      title: 'Preview',
    });
    this.doc = h('article', { class: 'markdown-body' });
    this.doc.addEventListener('click', (e) => this.follow(e));
    this.doc.addEventListener('scroll', () => {
      if (this.shown?.kind === 'markdown') this.scrolled.set(this.shown.path, this.doc.scrollTop);
    });
    host.append(this.frame, this.doc);
  }

  get visible(): boolean {
    return !!this.shown;
  }

  /**
   * Shows a file as what it makes. `drafts` is the unsaved text of every open
   * file, which a page is shown with in place of what is on disk.
   */
  async show(path: string, kind: PreviewKind, text: string, drafts: Record<string, string>): Promise<void> {
    this.shown = { path, kind };
    this.host.classList.remove('hidden');
    this.frame.classList.toggle('hidden', kind !== 'html');
    this.doc.classList.toggle('hidden', kind !== 'markdown');
    if (kind === 'html') {
      clear(this.doc);
      await studio.previewDrafts({ ...drafts, [path]: text });
      // Set again even when it is the same address: that is what reloads it.
      if (this.shown?.path === path) this.frame.src = previewUrl(path);
    } else {
      this.frame.removeAttribute('src');
      this.renderMarkdown(path, text);
    }
  }

  hide(): void {
    this.shown = undefined;
    this.host.classList.add('hidden');
    // A page left running would go on doing whatever its scripts do.
    this.frame.removeAttribute('src');
    clear(this.doc);
  }

  focus(): void {
    (this.shown?.kind === 'html' ? this.frame : this.host).focus();
  }

  private renderMarkdown(path: string, text: string): void {
    const html = marked.parse(text, { gfm: true, async: false }) as string;
    const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    const base = previewUrl(path);
    this.doc.innerHTML = clean;

    // A picture beside the file is read from the folder.
    for (const img of this.doc.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (src && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) img.src = new URL(src, base).href;
    }
    // Headings get the ids a link to `#a-heading` expects, as GitHub gives them.
    const taken = new Map<string, number>();
    for (const heading of this.doc.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
      const slug =
        (heading.textContent ?? '')
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, '')
          .replace(/\s/g, '-') || 'section';
      const seen = taken.get(slug) ?? 0;
      taken.set(slug, seen + 1);
      heading.id = seen ? `${slug}-${seen}` : slug;
    }
    // Code in a language the editor knows is coloured as the editor would.
    for (const code of this.doc.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
      const name = code.className.match(/language-([\w+#-]+)/)?.[1];
      const language = name && languageFor(name);
      if (!language) continue;
      code.setAttribute('data-lang', language);
      void monaco.editor.colorizeElement(code, { tabSize: 4 });
    }

    this.doc.scrollTop = this.scrolled.get(path) ?? 0;
  }

  /** A link in a Markdown file: to a place in it, to the web, or to another file in the folder. */
  private follow(e: MouseEvent): void {
    const link = (e.target as HTMLElement).closest('a');
    const href = link?.getAttribute('href');
    if (!link || !href || !this.shown) return;
    e.preventDefault();
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      this.doc.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' });
      return;
    }
    // The window sends these to the system browser.
    if (/^(?:https?|mailto):/i.test(href)) {
      window.open(href);
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    const file = previewFile(new URL(href, previewUrl(this.shown.path)).href);
    if (file) this.events.openFile(file);
  }
}

/** The editor's language for the name a fenced block gives: `js`, `bash`, `hunt`… */
function languageFor(name: string): string | undefined {
  const wanted = name.toLowerCase();
  if (wanted === 'hunt') return HUNT;
  const found = monaco.languages
    .getLanguages()
    .find(
      (l) =>
        l.id === wanted ||
        l.aliases?.some((a) => a.toLowerCase() === wanted) ||
        l.extensions?.some((x) => x.toLowerCase() === `.${wanted}`),
    );
  return found?.id;
}
