// The editor: one Monaco instance, a tab per open file, and the marks a run
// leaves on the lines it touched.
//
// Marks are decorations on the file's model rather than on the editor, so they
// stay with their file when another tab is in front, and move with their line
// when text is typed above it.

import * as monaco from 'monaco-editor';
import { basename, clear, h } from './dom';
import { HUNT, THEME } from './hunt';
import { iconFor } from './icons';

// Monaco starts a worker per language service and asks where its script is.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorkerUrl(_moduleId: string, label: string): string {
    if (label === 'json') return './json.worker.js';
    if (label === 'css' || label === 'scss' || label === 'less') return './css.worker.js';
    if (label === 'html' || label === 'handlebars' || label === 'razor') return './html.worker.js';
    if (label === 'typescript' || label === 'javascript') return './ts.worker.js';
    return './editor.worker.js';
  },
};

interface Tab {
  path: string;
  model: monaco.editor.ITextModel;
  /** The model's version when it was last read from or written to disk. */
  savedVersion: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
  breakpoints: string[];
  marks: string[];
  paused: string[];
}

export interface EditorEvents {
  /** The front tab changed, or the last one closed (`undefined`). */
  onActivate(path: string | undefined): void;
  onCursor(line: number, column: number): void;
  /** Asked before a tab with unsaved text is closed. Resolve false to keep it. */
  confirmClose(path: string): Promise<boolean>;
}

export class EditorView {
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly tabs = new Map<string, Tab>();
  private current?: Tab;
  private hintLine = 0;
  private hint: string[] = [];

  constructor(
    host: HTMLElement,
    private readonly strip: HTMLElement,
    private readonly events: EditorEvents,
  ) {
    this.editor = monaco.editor.create(host, {
      model: null,
      theme: THEME,
      automaticLayout: true,
      glyphMargin: true,
      minimap: { enabled: false },
      fontFamily: "'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace",
      fontSize: 13.5,
      lineHeight: 21,
      tabSize: 4,
      insertSpaces: true,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      wordBasedSuggestions: 'off',
      quickSuggestions: { other: true, comments: false, strings: false },
      padding: { top: 6 },
      stickyScroll: { enabled: false },
    });

    this.editor.onDidChangeModelContent(() => this.renderTabs());
    this.editor.onDidChangeCursorPosition((e) => events.onCursor(e.position.lineNumber, e.position.column));

    // The margin left of the line numbers toggles a breakpoint, and shows
    // where one would go.
    const inMargin = (e: monaco.editor.IEditorMouseEvent): number | undefined =>
      e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ? e.target.position?.lineNumber : undefined;
    this.editor.onMouseDown((e) => {
      const line = inMargin(e);
      if (line) this.toggleBreakpoint(line);
    });
    this.editor.onMouseMove((e) => this.showHint(inMargin(e) ?? 0));
    this.editor.onMouseLeave(() => this.showHint(0));
  }

  // ── tabs ──────────────────────────────────────────────────────────────────

  get activePath(): string | undefined {
    return this.current?.path;
  }

  get activeIsHunt(): boolean {
    return this.current?.model.getLanguageId() === HUNT;
  }

  isOpen(path: string): boolean {
    return this.tabs.has(path);
  }

  isDirty(path: string): boolean {
    const tab = this.tabs.get(path);
    return !!tab && tab.model.getAlternativeVersionId() !== tab.savedVersion;
  }

  openPaths(): string[] {
    return [...this.tabs.keys()];
  }

  dirtyPaths(): string[] {
    return [...this.tabs.keys()].filter((p) => this.isDirty(p));
  }

  text(path: string): string {
    return this.tabs.get(path)?.model.getValue() ?? '';
  }

  /** Opens a file's text in a tab, or brings its tab to the front. */
  open(path: string, text: string): void {
    let tab = this.tabs.get(path);
    if (!tab) {
      const uri = monaco.Uri.file(path);
      const language = path.toLowerCase().endsWith('.hunt') ? HUNT : undefined;
      const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(text, language, uri);
      tab = {
        path,
        model,
        savedVersion: model.getAlternativeVersionId(),
        viewState: null,
        breakpoints: [],
        marks: [],
        paused: [],
      };
      this.tabs.set(path, tab);
    }
    this.activate(path);
  }

  activate(path: string): void {
    const tab = this.tabs.get(path);
    if (!tab) return;
    if (this.current && this.current !== tab) this.current.viewState = this.editor.saveViewState();
    this.current = tab;
    this.hint = [];
    this.hintLine = 0;
    this.editor.setModel(tab.model);
    if (tab.viewState) this.editor.restoreViewState(tab.viewState);
    this.editor.focus();
    this.renderTabs();
    this.events.onActivate(path);
  }

  async close(path: string): Promise<void> {
    const tab = this.tabs.get(path);
    if (!tab) return;
    if (this.isDirty(path) && !(await this.events.confirmClose(path))) return;
    this.tabs.delete(path);
    tab.model.dispose();
    if (this.current === tab) {
      this.current = undefined;
      const next = [...this.tabs.keys()].pop();
      if (next) {
        this.activate(next);
        return;
      }
      this.editor.setModel(null);
      this.events.onActivate(undefined);
    }
    this.renderTabs();
  }

  /** Records that the tab's text is what is on disk now. */
  markSaved(path: string): void {
    const tab = this.tabs.get(path);
    if (!tab) return;
    tab.savedVersion = tab.model.getAlternativeVersionId();
    this.renderTabs();
  }

  private renderTabs(): void {
    clear(this.strip);
    for (const tab of this.tabs.values()) {
      const dirty = this.isDirty(tab.path);
      const el = h(
        'div',
        {
          class: `tab${tab === this.current ? ' active' : ''}${dirty ? ' dirty' : ''}`,
          title: tab.path,
          onclick: () => this.activate(tab.path),
        },
        iconFor(basename(tab.path)),
        h('span', { text: basename(tab.path) }),
        h('span', {
          class: 'close',
          title: 'Close',
          onclick: (e) => {
            e.stopPropagation();
            void this.close(tab.path);
          },
        }),
      );
      // The middle button closes a tab, as it does everywhere else.
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) void this.close(tab.path);
      });
      this.strip.append(el);
    }
  }

  // ── breakpoints ───────────────────────────────────────────────────────────

  toggleBreakpoint(line?: number): void {
    const tab = this.current;
    if (!tab || !this.activeIsHunt) return;
    const at = line ?? this.editor.getPosition()?.lineNumber;
    if (!at) return;
    const existing = tab.breakpoints.find((id) => tab.model.getDecorationRange(id)?.startLineNumber === at);
    if (existing) {
      tab.model.deltaDecorations([existing], []);
      tab.breakpoints = tab.breakpoints.filter((id) => id !== existing);
    } else {
      const [id] = tab.model.deltaDecorations([], [
        {
          range: new monaco.Range(at, 1, at, 1),
          options: { glyphMarginClassName: 'bp-glyph', stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
        },
      ]);
      tab.breakpoints.push(id);
    }
    this.showHint(0);
  }

  /** The 1-based lines of a file's breakpoints, wherever editing has moved them. */
  breakpoints(path: string): number[] {
    const tab = this.tabs.get(path);
    if (!tab) return [];
    const lines = tab.breakpoints
      .map((id) => tab.model.getDecorationRange(id)?.startLineNumber)
      .filter((n): n is number => typeof n === 'number');
    return [...new Set(lines)].sort((a, b) => a - b);
  }

  private showHint(line: number): void {
    const tab = this.current;
    if (!tab || line === this.hintLine) return;
    this.hintLine = line;
    const taken = line > 0 && this.breakpoints(tab.path).includes(line);
    this.hint = tab.model.deltaDecorations(
      this.hint,
      line > 0 && !taken && this.activeIsHunt
        ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'bp-hint' } }]
        : [],
    );
  }

  // ── what a run leaves behind ──────────────────────────────────────────────

  clearMarks(path: string): void {
    const tab = this.tabs.get(path);
    if (!tab) return;
    tab.marks = tab.model.deltaDecorations(tab.marks, []);
    tab.paused = tab.model.deltaDecorations(tab.paused, []);
  }

  /** Marks a 0-based line as passed or failed, with a note after its text. */
  markLine(path: string, line: number, ok: boolean, note: string): void {
    const tab = this.tabs.get(path);
    if (!tab || line < 0 || line >= tab.model.getLineCount()) return;
    const n = line + 1;
    // A line run again — a loop body, a retry — shows its latest result.
    const stale = tab.marks.filter((id) => tab.model.getDecorationRange(id)?.startLineNumber === n);
    if (stale.length) {
      tab.model.deltaDecorations(stale, []);
      tab.marks = tab.marks.filter((id) => !stale.includes(id));
    }
    const end = tab.model.getLineMaxColumn(n);
    const added = tab.model.deltaDecorations([], [
      {
        range: new monaco.Range(n, 1, n, end),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: ok ? 'line-pass' : 'line-fail',
          className: ok ? undefined : 'line-fail-text',
          after: note ? { content: note, inlineClassName: `inline-note ${ok ? 'pass' : 'fail'}` } : undefined,
        },
      },
    ]);
    tab.marks.push(...added);
  }

  /** Shows where a run is paused: 0-based line, or undefined for nowhere. */
  setPaused(path: string | undefined, line?: number): void {
    for (const tab of this.tabs.values()) {
      if (tab.paused.length) tab.paused = tab.model.deltaDecorations(tab.paused, []);
    }
    const tab = path ? this.tabs.get(path) : undefined;
    if (!tab || line === undefined) return;
    const n = line + 1;
    tab.paused = tab.model.deltaDecorations([], [
      {
        range: new monaco.Range(n, 1, n, 1),
        options: { isWholeLine: true, className: 'line-paused', glyphMarginClassName: 'paused-glyph' },
      },
    ]);
    if (tab === this.current) this.editor.revealLineInCenterIfOutsideViewport(n);
  }

  reveal(line: number): void {
    this.editor.revealLineInCenterIfOutsideViewport(line + 1);
    this.editor.setPosition({ lineNumber: line + 1, column: 1 });
    this.editor.focus();
  }

  // ── writing into the file ─────────────────────────────────────────────────

  /** The text of the line the caret is on, and its 0-based number. */
  currentLine(): { text: string; line: number } | undefined {
    const model = this.editor.getModel();
    const pos = this.editor.getPosition();
    if (!model || !pos) return undefined;
    return { text: model.getLineContent(pos.lineNumber), line: pos.lineNumber - 1 };
  }

  /**
   * Leaves the caret on a blank line ready for a step: the caret's own line if
   * it is blank, a new line below it otherwise, indented like its neighbours.
   */
  private openLine(): { line: number; indent: string } | undefined {
    const model = this.editor.getModel();
    const pos = this.editor.getPosition();
    if (!model || !pos) return undefined;
    const here = model.getLineContent(pos.lineNumber);
    const blank = here.trim() === '';
    const indentOf = (text: string): string => text.match(/^\s*/)?.[0] ?? '';
    const isHeader = (text: string): boolean => /^\s*(?:\d+\.\s*)?STEP\b.*:/i.test(text);
    // A step under a STEP header sits one level in; one after another step
    // sits where that step does.
    let indent = indentOf(here);
    if (blank) {
      for (let n = pos.lineNumber - 1; n >= 1; n--) {
        const above = model.getLineContent(n);
        if (above.trim() === '') continue;
        indent = isHeader(above) ? `${indentOf(above)}    ` : indentOf(above);
        break;
      }
    } else if (isHeader(here)) {
      indent += '    ';
    }
    const line = blank ? pos.lineNumber : pos.lineNumber + 1;
    const range = blank
      ? new monaco.Range(line, 1, line, here.length + 1)
      : new monaco.Range(pos.lineNumber, here.length + 1, pos.lineNumber, here.length + 1);
    this.editor.pushUndoStop();
    this.editor.executeEdits('manul-browser-studio', [
      { range, text: blank ? indent : `${model.getEOL()}${indent}`, forceMoveMarkers: true },
    ]);
    this.editor.setPosition({ lineNumber: line, column: indent.length + 1 });
    return { line, indent };
  }

  /**
   * Puts a step on a line of its own at the caret. `caret` is an offset into
   * the step where typing should resume; the end of it when not given.
   */
  insertStep(step: string, caret?: number): void {
    const at = this.openLine();
    if (!at) return;
    const column = at.indent.length + 1;
    this.editor.executeEdits('manul-browser-studio', [
      { range: new monaco.Range(at.line, column, at.line, column), text: step, forceMoveMarkers: true },
    ]);
    this.editor.pushUndoStop();
    this.editor.setPosition({ lineNumber: at.line, column: column + (caret ?? step.length) });
    this.editor.revealLineInCenterIfOutsideViewport(at.line);
    this.editor.focus();
  }

  /** Inserts a catalogue snippet on a line of its own, placeholders live. */
  insertSnippet(snippet: string): void {
    if (!this.openLine()) return;
    const controller = this.editor.getContribution('snippetController2') as
      | { insert(template: string): void }
      | null;
    this.editor.focus();
    if (controller) controller.insert(snippet);
    else this.editor.trigger('manul-browser-studio', 'type', { text: snippet });
  }

  format(): void {
    void this.editor.getAction('editor.action.formatDocument')?.run();
  }
}
