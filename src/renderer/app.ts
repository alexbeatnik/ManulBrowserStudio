// The window: it builds the views and carries what happens in one to the
// others — a run's events to the editor's margin, a picked element to a line
// of the file, a menu command to whichever of them it means.

import './styles.css';
import * as monaco from 'monaco-editor';
import type { CatalogueEntry } from '../core/catalogue';
import type { BrowserName, MenuCommand, RunEvent, ScreenshotMode, Settings } from '../shared/api';
import { runnableLine, stepForElement, verifyForElement } from '../shared/steps';
import { ask, choose, tell } from './dialogs';
import { $, basename, clear, dirname, duration, h, reason, resizable, studio, tabs } from './dom';
import { EditorView } from './editor';
import { Explorer } from './explorer';
import { registerHunt, setCatalogue } from './hunt';
import { MANUL_ICON } from './icons';
import { completionsAt, setUpScriptLanguages } from './languages';
import { Libraries } from './libraries';
import { PagePanel } from './page';
import { Panels, stoppedByAuthor } from './panels';

type RunState = 'idle' | 'running' | 'paused';

const STARTER = (title: string): string =>
  `@title: ${title}\n\nSTEP 1: Open the page\n    NAVIGATE to https://example.com\nDONE.\n`;

class App {
  private settings!: Settings;
  private readonly editor: EditorView;
  private readonly explorer: Explorer;
  private readonly panels: Panels;
  private readonly page: PagePanel;
  private readonly libraries: Libraries;
  private readonly showBottom: (pane: string) => void;
  private readonly showSidebar: (pane: string) => void;

  private runState: RunState = 'idle';
  /** The file the current or last run is of. */
  private runFile = '';
  /** Steps the current run has finished, and its verdict once it has one. */
  private stepsDone = 0;
  private verdict = '';
  /**
   * What the current run has spent on each line so far. A line is come back
   * to by a loop, and a USE line stands for every step of the block it names.
   */
  private readonly lineTime = new Map<number, number>();
  private quitting = false;
  /** The person asked for the current run to be stopped. */
  private stopping = false;
  private lastCommand = { name: '', at: 0 };

  constructor() {
    registerHunt();
    this.showBottom = tabs(document.querySelector<HTMLElement>('[data-tabs="bottom"]')!, (pane) => {
      // A hidden pane cannot be scrolled, so what was logged meanwhile left
      // it at the top; the news is at the other end.
      if (pane === 'output') $('output').scrollTop = $('output').scrollHeight;
    });
    this.showSidebar = tabs(document.querySelector<HTMLElement>('[data-tabs="sidebar"]')!);

    this.editor = new EditorView($('editor'), $('editor-tabs'), {
      onActivate: (path) => {
        this.explorer.setActive(path);
        this.refreshChrome();
      },
      onCursor: (line, column) => {
        $('status-position').textContent = `Ln ${line}, Col ${column}`;
      },
      confirmClose: (path) => this.confirmClose(path),
    });
    this.explorer = new Explorer($('tree'), (file) => void this.openFile(file));
    this.panels = new Panels(this.showBottom, (line) => {
      if (this.runFile && this.editor.isOpen(this.runFile)) this.editor.activate(this.runFile);
      this.editor.reveal(line);
    });
    this.page = new PagePanel({
      onPick: (el) => this.writeStep(stepForElement(el)),
      onVerify: (el) => this.writeStep({ text: verifyForElement(el) }),
      onStatus: (text) => this.status(text),
      onVariables: (vars) => {
        if (this.runState === 'idle') this.panels.setVariables(vars);
      },
      onError: (message) => void tell('Live session', message),
    });

    this.libraries = new Libraries({
      onStart: () => this.showBottom('output'),
      onStatus: (text) => this.status(text),
      onError: (title, message) => void tell(title, message),
    });
    studio.onPackageLog((line) => this.panels.addLog(line));

    $<HTMLImageElement>('welcome-logo').src = MANUL_ICON;
    this.wireToolbar();
    this.wireKeys();
    this.wireLayout();
    studio.onMenu((command) => this.command(command));
    studio.onRunEvent((event) => this.onRunEvent(event));
    window.addEventListener('beforeunload', (e) => this.onClose(e));
  }

  async start(): Promise<void> {
    this.settings = await studio.getSettings();
    $<HTMLSelectElement>('browser').value = this.settings.browser;
    $<HTMLInputElement>('headless').checked = this.settings.headless;
    $<HTMLSelectElement>('screenshots').value = this.settings.screenshots;
    this.showBrowserChoice();

    if (this.settings.workspace) {
      try {
        // Asked here and not left to the tree, which shows a folder it cannot
        // read as an error and carries on.
        await studio.listDir(this.settings.workspace);
      } catch {
        // The folder is gone since last time; start without one.
        this.settings = await studio.setSettings({ workspace: '' });
      }
    }
    if (this.settings.workspace) await this.explorer.setRoot(this.settings.workspace);
    this.refreshChrome();
    await this.loadEngine();
    this.loadScriptTypes();
    void this.libraries.showRuntime();
    void this.libraries.refresh(this.settings.workspace);

    // The demo project, when it has just been asked for. With nothing else to
    // open it is opened; a person with a folder of their own open keeps it.
    const offer = await studio.demoOffer();
    if (offer && !this.settings.workspace) {
      await this.openDemo(true);
    } else if (offer === 'installer') {
      // They said yes to it all the same: it is put where it belongs.
      const demo = await studio.openDemo().catch(() => undefined);
      if (demo) this.status(`The demo project is in ${demo.folder}. File → Open Demo Project opens it.`);
    }
  }

  /** Brings the toolbar and the page panel in line with which browser is chosen. */
  private showBrowserChoice(): void {
    const builtIn = this.settings.browser === 'builtin';
    // The page in the panel is always in sight; there is no window to hide.
    $<HTMLInputElement>('headless').disabled = builtIn;
    this.page.setBuiltIn(builtIn);
  }

  /**
   * Hook scripts are JavaScript; completion for them needs the binding's
   * declarations, which are large and not needed to start working.
   */
  private loadScriptTypes(): void {
    if (this.settings.workspace) void setUpScriptLanguages(this.settings.workspace).catch(() => undefined);
  }

  // ── chrome ────────────────────────────────────────────────────────────────

  private status(text: string): void {
    $('status-text').textContent = text;
  }

  /** Brings the toolbar, the title and the welcome screen in line with the state. */
  private refreshChrome(): void {
    const workspace = this.settings?.workspace ?? '';
    const active = this.editor.activePath;
    const hunt = this.editor.activeIsHunt;
    const idle = this.runState === 'idle';

    document.title = workspace ? `${basename(workspace)} — Manul Browser Studio` : 'Manul Browser Studio';
    $('workspace-name').textContent = workspace ? basename(workspace) : 'No folder open';
    $<HTMLButtonElement>('new-file').disabled = !workspace;
    $<HTMLButtonElement>('new-folder').disabled = !workspace;

    for (const id of ['run', 'debug', 'step-through']) $<HTMLButtonElement>(id).disabled = !idle || !hunt;
    $('run-controls').classList.toggle('hidden', this.runState === 'paused');
    $('debug-controls').classList.toggle('hidden', this.runState !== 'paused');
    $<HTMLButtonElement>('stop').disabled = idle;
    $('status').className = this.runState === 'idle' ? '' : this.runState;

    const welcome = $('welcome');
    welcome.classList.toggle('hidden', !!active);
    if (!active && workspace) {
      clear(welcome);
      welcome.append(
        h('img', { class: 'logo', src: MANUL_ICON, alt: '' }),
        h('h1', { text: basename(workspace) }),
        h('p', { class: 'dim', text: 'Pick a file on the left, or start a new hunt.' }),
        h('p', {}, h('button', { class: 'primary', text: 'New hunt', onclick: () => void this.newFile() })),
      );
    }
  }

  private async loadEngine(): Promise<void> {
    const button = $<HTMLButtonElement>('engine');
    const [status, view] = await Promise.all([studio.engine(), studio.catalogue()]);
    button.classList.toggle('missing', !status.found);
    button.textContent = status.found ? `engine ${status.version} · ${status.source}` : 'no engine found';
    button.title = status.found ? status.path : 'Click to choose the engine';
    setCatalogue(view.catalogue);
    this.renderPalette(view.groups);
  }

  private renderPalette(groups: Array<{ id: string; title: string; entries: CatalogueEntry[] }>): void {
    const host = $('palette');
    const filter = $<HTMLInputElement>('palette-filter');
    const draw = (): void => {
      clear(host);
      const wanted = filter.value.trim().toLowerCase();
      for (const group of groups) {
        const entries = group.entries.filter(
          (e) => !wanted || e.label.toLowerCase().includes(wanted) || e.uiText.toLowerCase().includes(wanted),
        );
        if (!entries.length) continue;
        host.append(h('h3', { text: group.title }));
        for (const entry of entries) {
          host.append(
            h('button', {
              class: 'entry',
              text: entry.uiText,
              title: entry.description,
              onclick: () => {
                if (!this.editor.activeIsHunt) return this.status('Open a .hunt file to put the step in.');
                this.editor.insertSnippet(entry.snippet);
              },
            }),
          );
        }
      }
    };
    filter.oninput = draw;
    draw();
  }

  private async showEngine(): Promise<void> {
    const status = await studio.engine();
    const body: Array<string | HTMLElement> = status.found
      ? [
          `Version ${status.version}, from ${status.source} (${status.detail}).`,
          h('p', { class: 'path', text: status.path }),
        ]
      : [
          'No engine was found. Install one with “npm install manul-browser” or “pip install manul-browser” in the project, or choose a binary.',
        ];
    for (const failure of status.failures) body.push(h('p', { class: 'path dim', text: `would not run: ${failure}` }));
    const answer = await choose(
      'Manul engine',
      body,
      [
        { key: 'auto', label: 'Find automatically' },
        { key: 'pick', label: 'Choose a binary…' },
        { key: 'close', label: 'Close', primary: true },
      ],
      'close',
    );
    if (answer === 'close') return;
    const enginePath = answer === 'pick' ? await studio.chooseEngine() : '';
    if (answer === 'pick' && !enginePath) return;
    this.settings = await studio.setSettings({ enginePath });
    await this.loadEngine();
  }

  // ── files ─────────────────────────────────────────────────────────────────

  private async openFolder(): Promise<void> {
    const folder = await studio.chooseFolder();
    if (folder) await this.openWorkspace(folder);
  }

  /**
   * Opens the person's copy of the demo project, making it first if it is not
   * there. On a first start nobody asked for it, so a failure is not an error
   * to put in front of them.
   */
  private async openDemo(quietly = false): Promise<void> {
    try {
      const demo = await studio.openDemo();
      await this.openWorkspace(demo.folder);
      this.explorer.reveal(dirname(demo.file));
      await this.explorer.refresh();
      await this.openFile(demo.file);
    } catch (err) {
      if (!quietly) await tell('Could not open the demo project', reason(err));
    }
  }

  async openWorkspace(folder: string): Promise<void> {
    for (const path of this.editor.dirtyPaths()) await this.save(path);
    // The files of the folder being left cannot be saved once it is closed.
    if (folder !== this.settings.workspace) for (const path of this.editor.openPaths()) await this.editor.close(path);
    this.settings = await studio.setSettings({ workspace: folder });
    // The live session was that folder's; the main process has closed it.
    this.page.closedElsewhere();
    await this.explorer.setRoot(folder);
    this.refreshChrome();
    await this.loadEngine();
    this.loadScriptTypes();
    void this.libraries.refresh(folder);
  }

  async openFile(file: string): Promise<void> {
    if (this.editor.isOpen(file)) return this.editor.activate(file);
    try {
      this.editor.open(file, await studio.readFile(file));
    } catch (err) {
      await tell('Could not open the file', reason(err));
    }
  }

  private async save(path = this.editor.activePath): Promise<boolean> {
    if (!path) return false;
    try {
      await studio.writeFile(path, this.editor.text(path));
      this.editor.markSaved(path);
      return true;
    } catch (err) {
      await tell('Could not save the file', reason(err));
      return false;
    }
  }

  private async newFile(): Promise<void> {
    if (!this.settings.workspace) return this.openFolder();
    const typed = await ask('New file', 'checkout.hunt', 'untitled.hunt');
    if (!typed) return;
    const name = /\.[A-Za-z0-9]+$/.test(typed) ? typed : `${typed}.hunt`;
    // In the folder last clicked, beside the file in front, or at the top.
    const dir = this.explorer.targetDir();
    try {
      const file = await studio.createFile(dir, name);
      if (name.toLowerCase().endsWith('.hunt')) await studio.writeFile(file, STARTER(name.replace(/\.hunt$/i, '')));
      this.explorer.reveal(dir);
      await this.explorer.refresh();
      await this.openFile(file);
    } catch (err) {
      await tell('Could not create the file', reason(err));
    }
  }

  private async newFolder(): Promise<void> {
    if (!this.settings.workspace) return this.openFolder();
    const name = await ask('New folder', 'flows');
    if (!name) return;
    const dir = this.explorer.targetDir();
    try {
      const folder = await studio.createFolder(dir, name);
      // Open, so that it is seen, and what is created next goes into it.
      this.explorer.reveal(folder);
      this.explorer.setTarget(folder);
      await this.explorer.refresh();
    } catch (err) {
      await tell('Could not create the folder', reason(err));
    }
  }

  /** Opens the folder's hook script, writing a starter one if it has none. */
  private async newHooks(): Promise<void> {
    if (!this.settings.workspace) return this.openFolder();
    try {
      const file = await studio.createHookScript();
      await this.explorer.refresh();
      await this.openFile(file);
    } catch (err) {
      await tell('Could not create the hook script', reason(err));
    }
  }

  private async confirmClose(path: string): Promise<boolean> {
    const answer = await choose(
      'Save changes?',
      [`${basename(path)} has changes that are not saved.`],
      [
        { key: 'cancel', label: 'Cancel' },
        { key: 'discard', label: 'Discard' },
        { key: 'save', label: 'Save', primary: true },
      ],
      'cancel',
    );
    if (answer === 'save') return this.save(path);
    return answer === 'discard';
  }

  /** Closing the window with unsaved text asks first; the answer closes it. */
  private onClose(event: BeforeUnloadEvent): void {
    const dirty = this.editor.dirtyPaths();
    if (this.quitting || dirty.length === 0) return;
    event.preventDefault();
    event.returnValue = false;
    void choose(
      'Save changes before closing?',
      [dirty.map(basename).join(', ')],
      [
        { key: 'cancel', label: 'Cancel' },
        { key: 'discard', label: 'Discard' },
        { key: 'save', label: 'Save all', primary: true },
      ],
      'cancel',
    ).then(async (answer) => {
      if (answer === 'cancel') return;
      if (answer === 'save') for (const path of dirty) if (!(await this.save(path))) return;
      this.quitting = true;
      window.close();
    });
  }

  // ── writing steps ─────────────────────────────────────────────────────────

  private writeStep(step: { text: string; caret?: number }): void {
    if (!this.editor.activeIsHunt) return this.status('Open a .hunt file to put the step in.');
    this.editor.insertStep(step.text, step.caret);
  }

  /** Runs the step under the caret in the live session, then moves on a line. */
  private async runLine(): Promise<void> {
    const path = this.editor.activePath;
    const at = this.editor.currentLine();
    if (!path || !at || !this.editor.activeIsHunt) return;
    const step = runnableLine(at.text);
    if (!step) return this.status('There is no step on this line to run.');
    if (this.runState !== 'idle') return this.status('A file is running; the live session waits for it.');
    if (!this.page.isOpen && !(await this.page.open())) return;

    const outcome = await this.page.step(step);
    if (!outcome) return;
    this.panels.addLive(outcome, at.line);
    this.editor.markLine(path, at.line, outcome.ok, outcome.ok ? '' : outcome.error || outcome.reason);
    const model = this.editor.editor.getModel();
    if (outcome.ok && model && at.line + 2 <= model.getLineCount()) {
      this.editor.editor.setPosition({ lineNumber: at.line + 2, column: model.getLineMaxColumn(at.line + 2) });
    }
  }

  // ── running ───────────────────────────────────────────────────────────────

  private async run(mode: 'run' | 'debug' | 'step'): Promise<void> {
    if (this.runState === 'paused') return this.debug('continue');
    const file = this.editor.activePath;
    if (this.runState !== 'idle' || !file || !this.editor.activeIsHunt) return;
    // The engine reads the file from disk.
    if (this.editor.isDirty(file) && !(await this.save(file))) return;

    const breakLines = this.editor.breakpoints(file);
    this.runFile = file;
    this.stopping = false;
    this.editor.clearMarks(file);
    this.panels.reset();
    this.showBottom('results');
    this.setRunState('running');
    this.status(
      mode === 'debug' && breakLines.length === 0
        ? 'No breakpoints are set, so this runs to the end. Click left of a line number to set one.'
        : `Running ${basename(file)}…`,
    );
    try {
      await studio.startRun({ file, mode, breakLines });
    } catch (err) {
      this.setRunState('idle');
      this.status('Ready');
      await tell('Could not start the run', reason(err));
    }
  }

  private debug(action: 'next' | 'continue' | 'explain-next'): void {
    if (this.runState !== 'paused') return;
    void studio.debug(action);
    if (action === 'explain-next') return;
    // The engine says nothing until the next step finishes or pauses.
    this.editor.setPaused(undefined);
    this.setRunState('running');
    this.status(`Running ${basename(this.runFile)}…`);
  }

  private setRunState(state: RunState): void {
    this.runState = state;
    this.refreshChrome();
  }

  private onRunEvent(event: RunEvent): void {
    switch (event.kind) {
      case 'started':
        this.stepsDone = 0;
        this.verdict = '';
        this.lineTime.clear();
        this.panels.addLog(`$ ${event.commandLine}`);
        if (event.dropped.length) {
          this.panels.addLog(`This engine does not know ${event.dropped.join(', ')}; left out.`);
        }
        if (event.hooks) this.panels.addLog(`Hook script: ${event.hooks}`);
        break;
      case 'step': {
        const { step, line } = event;
        this.stepsDone++;
        this.panels.addStep(step, line);
        if (line !== undefined && !stoppedByAuthor(step)) {
          const spent = (this.lineTime.get(line) ?? 0) + step.duration_ms;
          this.lineTime.set(line, spent);
          const note = step.success ? duration(spent) : step.error || step.failure_reason || 'failed';
          this.editor.markLine(this.runFile, line, step.success, note.split('\n')[0].slice(0, 160));
        }
        if (event.screenshot) this.page.showRunShot(event.screenshot, `run · after step ${this.stepsDone}`);
        break;
      }
      case 'pause':
        if (this.editor.isOpen(this.runFile) && this.editor.activePath !== this.runFile) {
          this.editor.activate(this.runFile);
        }
        this.editor.setPaused(this.runFile, event.line);
        this.setRunState('paused');
        this.status(`Paused before: ${event.pause.step.trim()}`);
        break;
      case 'vars':
        this.panels.setVariables(event.vars);
        break;
      case 'explain':
        this.panels.setExplain(event.explain);
        break;
      case 'result': {
        const { result } = event;
        this.panels.finish(result);
        this.verdict = result.success
          ? `Run passed: ${result.passed} steps`
          : `Run failed: ${result.passed} of ${result.total_steps} steps passed`;
        break;
      }
      case 'log':
        this.panels.addLog(event.text);
        break;
      case 'exit':
        this.editor.setPaused(undefined);
        this.setRunState('idle');
        // A run in the built-in browser has left the live session's page
        // somewhere its list of elements knows nothing about.
        if (this.settings.browser === 'builtin' && this.page.isOpen) void this.page.refresh();
        if (event.error) {
          this.status(`The engine could not be run: ${event.error}`);
          this.showBottom('output');
          this.panels.addLog(event.error);
        } else if (this.verdict || event.code === 0 || this.stopping) {
          // No verdict means the run never got to give one: it was stopped.
          this.status(this.verdict || (event.code === 0 ? 'Run finished' : 'Run stopped'));
        } else {
          // Or the engine gave up by itself — a hook script that would not
          // start, a browser that is not installed. Why is the last thing it
          // said, and nobody looks for it under a tab that is not in front.
          this.status('The run ended before it had a result. What the engine said is under Output.');
          this.showBottom('output');
        }
        break;
    }
  }

  // ── commands ──────────────────────────────────────────────────────────────

  /**
   * A command by name, whoever asked: the menu, a toolbar button, a key. One
   * key press can arrive twice — once through the menu's accelerator and once
   * through the editor's own binding — so a repeat within a moment is dropped.
   */
  command(name: MenuCommand | 'next' | 'explain' | 'breakpoint'): void {
    const now = performance.now();
    if (this.lastCommand.name === name && now - this.lastCommand.at < 200) return;
    this.lastCommand = { name, at: now };
    switch (name) {
      case 'open-folder':
        return void this.openFolder();
      case 'open-demo':
        return void this.openDemo();
      case 'new-file':
        return void this.newFile();
      case 'new-folder':
        return void this.newFolder();
      case 'new-hooks':
        return void this.newHooks();
      case 'save':
        return void this.save();
      case 'run':
        return void this.run('run');
      case 'debug':
        return void this.run('debug');
      case 'step-through':
        return void this.run('step');
      case 'stop':
        this.stopping = true;
        return void studio.stopRun();
      case 'format':
        return this.editor.format();
      case 'run-line':
        return void this.runLine();
      case 'next':
        return this.debug('next');
      case 'explain':
        return this.debug('explain-next');
      case 'breakpoint':
        return this.editor.toggleBreakpoint();
    }
  }

  private wireToolbar(): void {
    const on = (id: string, name: Parameters<App['command']>[0]): void =>
      $(id).addEventListener('click', () => this.command(name));
    on('open-folder', 'open-folder');
    on('welcome-open', 'open-folder');
    on('welcome-demo', 'open-demo');
    on('new-file', 'new-file');
    on('new-folder', 'new-folder');
    on('run', 'run');
    on('debug', 'debug');
    on('step-through', 'step-through');
    on('continue', 'run');
    on('next', 'next');
    on('explain', 'explain');
    on('stop', 'stop');
    $('engine').addEventListener('click', () => void this.showEngine());

    const change = async (patch: Partial<Settings>): Promise<void> => {
      this.settings = await studio.setSettings(patch);
      // A live browser was launched under the old choice.
      if (this.page.isOpen && ('browser' in patch || 'headless' in patch)) {
        await this.page.close();
        this.status('The live session was ended; start it again for the new browser settings.');
      }
      if ('browser' in patch) this.showBrowserChoice();
    };
    $<HTMLSelectElement>('browser').addEventListener('change', (e) =>
      void change({ browser: (e.target as HTMLSelectElement).value as BrowserName }),
    );
    $<HTMLInputElement>('headless').addEventListener('change', (e) =>
      void change({ headless: (e.target as HTMLInputElement).checked }),
    );
    $<HTMLSelectElement>('screenshots').addEventListener('change', (e) =>
      void change({ screenshots: (e.target as HTMLSelectElement).value as ScreenshotMode }),
    );
  }

  private wireKeys(): void {
    const { KeyCode, KeyMod } = monaco;
    const editor = this.editor.editor;
    // Keys the editor would otherwise keep for itself.
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => this.command('run-line'));
    editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => this.command('save'));
    editor.addCommand(KeyCode.F9, () => this.command('breakpoint'));
    editor.addCommand(KeyCode.F10, () => this.command('next'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F10' && this.runState === 'paused') {
        e.preventDefault();
        this.command('next');
      }
    });
  }

  private wireLayout(): void {
    const split = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-resize="${name}"]`)!;
    resizable(split('sidebar'), '--sidebar-w', 'x', 1, 160, () =>
      window.innerWidth - $('page').getBoundingClientRect().width - 308,
    );
    resizable(split('page'), '--page-w', 'x', -1, 240, () =>
      window.innerWidth - $('sidebar').getBoundingClientRect().width - 308,
    );
    resizable(split('bottom'), '--bottom-h', 'y', -1, 80, () =>
      $('center').clientHeight - $('editor-tabs').clientHeight - 84,
    );
    resizable(split('map'), '--map-h', 'y', -1, 80, () =>
      $('shot-host').clientHeight + $('map-host').clientHeight - 80,
    );
    this.showSidebar('files');
  }

  /** What a scripted check of the app looks at. */
  snapshot(): Record<string, unknown> {
    return {
      workspace: this.settings?.workspace ?? '',
      active: this.editor.activePath ?? '',
      runState: this.runState,
      results: document.querySelectorAll('#results .result.pass, #results .result.fail').length,
      failed: document.querySelectorAll('#results .result.fail').length,
      located: document.querySelectorAll('#results .result.pass[title^="Line"], #results .result.fail[title^="Line"]').length,
      summary: $('run-summary').textContent,
      status: $('status-text').textContent,
      engine: $('engine').textContent,
      liveOpen: this.page.isOpen,
      liveUrl: $<HTMLInputElement>('url').value,
      mapElements: document.querySelectorAll('#map .el').length,
      variables: document.querySelectorAll('#variables tr').length,
      breakpoints: this.editor.activePath ? this.editor.breakpoints(this.editor.activePath) : [],
      paletteEntries: document.querySelectorAll('#palette .entry').length,
      fileIcons: document.querySelectorAll('#tree .row .ficon').length,
      treeError: document.querySelector('#tree .empty.error')?.textContent ?? '',
      folders: [...document.querySelectorAll<HTMLElement>('#tree .row[data-dir]')].map((r) => r.textContent ?? ''),
      node: $('status-node').textContent ?? '',
      libraries: [...document.querySelectorAll('#lib-list .lib')].map((r) => r.textContent ?? ''),
      huntIcons: document.querySelectorAll('#tree .row.hunt .ficon img').length,
      tabIcons: document.querySelectorAll('#editor-tabs .tab .ficon').length,
      log: $('log').textContent ?? '',
      hasShot: !!$('shot').getAttribute('src'),
    };
  }

  /** What the script language service offers at a position; for scripted checks. */
  completions(file: string, line: number, column: number): Promise<string[]> {
    return completionsAt(file, line, column);
  }

  /** Puts the caret on a 1-based line; for scripted checks. */
  goto(line: number): void {
    this.editor.editor.setPosition({ lineNumber: line, column: 1 });
  }
}

const app = new App();
(window as unknown as { __studio: App }).__studio = app;
void app.start();
