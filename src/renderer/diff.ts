// What changed in a file: as it was at the last commit beside as it is now,
// drawn over the editor until it is closed.

import * as monaco from 'monaco-editor';
import type { GitFile } from '../shared/api';
import { $, reason, studio } from './dom';
import { HUNT } from './hunt';

export class DiffView {
  private readonly host = $('diff');
  private readonly title = $('diff-title');
  private readonly note = $('diff-note');
  private readonly openButton = $<HTMLButtonElement>('diff-open');
  private editor?: monaco.editor.IStandaloneDiffEditor;
  private models: monaco.editor.ITextModel[] = [];
  private shown?: GitFile;
  private count = 0;

  constructor(private readonly openFile: (file: string) => void) {
    $('diff-close').addEventListener('click', () => this.close());
    this.openButton.addEventListener('click', () => {
      const file = this.shown?.file;
      this.close();
      if (file) this.openFile(file);
    });
    this.host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return !this.host.classList.contains('hidden');
  }

  /** The file whose changes are shown, as git names it; '' when none is. */
  get path(): string {
    return this.isOpen ? (this.shown?.path ?? '') : '';
  }

  async show(file: GitFile): Promise<void> {
    this.shown = file;
    this.title.textContent = file.path;
    this.openButton.disabled = file.state === 'deleted';
    this.host.classList.remove('hidden');
    let text = { original: '', modified: '', opaque: false };
    let failure = '';
    try {
      text = await studio.gitDiff(file.path);
    } catch (err) {
      failure = reason(err);
    }
    // Another file was asked for, or this was closed, while git was reading.
    if (this.shown !== file || !this.isOpen) return;
    this.note.textContent =
      failure ||
      (text.opaque
        ? 'not text, or too long to show side by side'
        : file.state === 'untracked' || file.state === 'added'
          ? 'new: nothing to compare it with'
          : file.state === 'deleted'
            ? 'deleted: this is what it was'
            : 'the last commit, and now');

    this.editor ??= monaco.editor.createDiffEditor($('diff-editor'), {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: "'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace",
      fontSize: 13.5,
      lineHeight: 21,
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
    });
    // Each showing has models of its own, under names nothing else has.
    const turn = ++this.count;
    const language = file.path.toLowerCase().endsWith('.hunt') ? HUNT : undefined;
    const model = (side: string, content: string): monaco.editor.ITextModel =>
      monaco.editor.createModel(content, language, monaco.Uri.parse(`studio-git://${side}/${turn}/${encodeURI(file.path)}`));
    const stale = this.models;
    this.models = [model('before', text.original), model('now', text.modified)];
    this.editor.setModel({ original: this.models[0], modified: this.models[1] });
    for (const old of stale) old.dispose();
  }

  close(): void {
    this.host.classList.add('hidden');
    this.shown = undefined;
  }
}
