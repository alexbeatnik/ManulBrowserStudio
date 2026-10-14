// What the window may ask of the main process, and what it is told.
//
// The renderer has no Node and no filesystem: everything that touches a file,
// a process or the engine goes through this one interface, which the preload
// script exposes as `window.studio`.

import type { Catalogue, CatalogueEntry } from '../core/catalogue';
import type { ExplainEvent, HuntResult, PauseEvent, StepResult } from '../core/runner';

/**
 * `builtin` is the page in the page panel, which is the app's own Chromium;
 * the others are browsers on the machine, which the engine starts.
 */
export type BrowserName = 'builtin' | 'chromium' | 'firefox';

export type ScreenshotMode = 'none' | 'on-fail' | 'always';

/** Every value a setting of that kind may have. */
export const BROWSERS: readonly BrowserName[] = ['builtin', 'chromium', 'firefox'];
export const SCREENSHOT_MODES: readonly ScreenshotMode[] = ['none', 'on-fail', 'always'];

/** A rectangle of the window, in the window's own pixels. */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the built-in browser is; `url` is '' before it has been anywhere. */
export interface PageState {
  url: string;
  title: string;
}

export interface Settings {
  /** Folder last opened; reopened on start. */
  workspace: string;
  /** An engine binary to use instead of the one found automatically. */
  enginePath: string;
  browser: BrowserName;
  headless: boolean;
  screenshots: ScreenshotMode;
  /** The yes to the demo project that has been acted on; '' when none has. */
  demoOffer: string;
}

/**
 * Who has just asked for the demo project: the installer, on its own page, or
 * nobody in particular — a first run from source. '' when nobody has.
 */
export type DemoOffer = '' | 'installer' | 'source';

export const DEFAULT_SETTINGS: Settings = {
  workspace: '',
  enginePath: '',
  browser: 'builtin',
  headless: false,
  screenshots: 'on-fail',
  demoOffer: '',
};

export interface DirEntry {
  name: string;
  path: string;
  dir: boolean;
}

export interface EngineStatus {
  found: boolean;
  path: string;
  version: string;
  /** Where it came from, in a word: npm, Python, Go, custom, PATH. */
  source: string;
  detail: string;
  /** Candidates that were there and would not run. */
  failures: string[];
}

/** The catalogue, and the same entries arranged for the step palette. */
export interface CatalogueView {
  catalogue: Catalogue;
  groups: Array<{ id: string; title: string; entries: CatalogueEntry[] }>;
}

export interface RunRequest {
  file: string;
  /** `debug` pauses at breakpoints; `step` pauses before every command. */
  mode: 'run' | 'debug' | 'step';
  /** 1-based lines. */
  breakLines: number[];
}

/**
 * One thing that happened in a run. Lines are 0-based and absent when the
 * step the engine reported could not be found in the file.
 */
export type RunEvent =
  | { kind: 'started'; file: string; commandLine: string; dropped: string[]; hooks: string }
  | { kind: 'step'; step: StepResult; line?: number; screenshot?: string }
  | { kind: 'pause'; pause: PauseEvent; line?: number }
  | { kind: 'vars'; vars: Record<string, string> }
  | { kind: 'explain'; explain: ExplainEvent }
  | { kind: 'result'; result: HuntResult }
  | { kind: 'log'; text: string }
  | {
      kind: 'exit';
      code: number | null;
      error?: string;
      /**
       * Set for a run in the built-in browser, which has been made new by
       * now: a picture of the page the run ended on, as a data: URL, or ''
       * when there is none to show.
       */
      still?: string;
    };

export type DebugAction = 'next' | 'continue' | 'explain-next' | 'highlight';

export interface MapElement {
  label: string;
  role: string;
  editable: boolean;
}

export interface MapGroup {
  name: string;
  elements: MapElement[];
  truncated: number;
}

/** The live session's browser as it stands. */
export interface LiveSnapshot {
  open: boolean;
  browser: string;
  url: string;
  title: string;
  /** A PNG as a data: URL. */
  screenshot: string;
  groups: MapGroup[];
  vars: Record<string, string>;
}

/** What one step run in the live session came to. */
export interface LiveStepOutcome {
  ok: boolean;
  step: string;
  action: string;
  value: string;
  reason: string;
  error: string;
  score: number;
  near: Array<{ text: string; score: number }>;
}

/** One declaration file for the editor's TypeScript service, at its path under a package root. */
export interface TypeLibrary {
  path: string;
  content: string;
}

/** A library the open folder's package.json names. */
export interface InstalledPackage {
  name: string;
  /** The range package.json asks for. */
  wanted: string;
  /** What is in node_modules; '' when it is not installed. */
  version: string;
  dev: boolean;
}

/** The Node the app carries, and what came with it. */
export interface RuntimeInfo {
  node: string;
  electron: string;
  npm: string;
}

/** What has happened to a file since the last commit. */
export type GitState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';

export interface GitFile {
  /** As git names it: from the top of the repository, with forward slashes. */
  path: string;
  /** Where it is on disk. */
  file: string;
  state: GitState;
  /** The name it had, for one that was renamed. */
  from?: string;
  /** For a file in conflict: whether its text still has a conflict in it. */
  unresolved?: boolean;
}

/** The open folder, as git sees it. */
export interface GitStatus {
  /** There is a git on this machine. */
  available: boolean;
  /** The folder is in a repository. */
  repo: boolean;
  /** The top of the repository, which may be above the open folder. */
  root: string;
  /** The branch; '' on a detached HEAD. */
  branch: string;
  /** The branch this one pulls from and pushes to; '' when it has none. */
  upstream: string;
  ahead: number;
  behind: number;
  /** What was begun and not finished: a merge or a rebase that met a conflict. */
  operation: '' | 'merge' | 'rebase';
  files: GitFile[];
}

/** One file as it was at the last commit, and as it is now. */
export interface GitDiff {
  original: string;
  modified: string;
  /** Not text, or too much of it: there is nothing to show side by side. */
  opaque: boolean;
}

/** How a conflict, or a whole file of them, is settled. */
export type GitResolution = 'current' | 'incoming' | 'resolved';

export type MenuCommand =
  | 'open-folder'
  | 'open-demo'
  | 'new-file'
  | 'new-folder'
  | 'new-hooks'
  | 'save'
  | 'run'
  | 'debug'
  | 'step-through'
  | 'stop'
  | 'format'
  | 'run-line'
  | 'toggle-preview';

export interface StudioApi {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;

  /** Shows the folder picker. Resolves to the folder, or '' if cancelled. */
  chooseFolder(): Promise<string>;
  /** Shows the file picker for an engine binary. '' if cancelled. */
  chooseEngine(): Promise<string>;
  listDir(dir: string): Promise<DirEntry[]>;
  readFile(file: string): Promise<string>;
  writeFile(file: string, text: string): Promise<void>;
  /** Creates an empty file in `dir`; resolves to its path. */
  createFile(dir: string, name: string): Promise<string>;
  /** Creates a folder in `dir`; resolves to its path. */
  createFolder(dir: string, name: string): Promise<string>;
  /**
   * The unsaved text of open files, for the preview of an HTML file to show
   * in place of what is on disk. Replaces what was given last time.
   */
  previewDrafts(drafts: Record<string, string>): Promise<void>;
  /** Creates a starter hook script at the top of the open folder; resolves to its path. */
  createHookScript(): Promise<string>;
  /**
   * Makes sure the person has their copy of the demo project; resolves to its
   * folder and the file to show first.
   */
  openDemo(): Promise<{ folder: string; file: string }>;
  /** Whether the demo project has just been asked for. Answers once per asking. */
  demoOffer(): Promise<DemoOffer>;

  engine(): Promise<EngineStatus>;
  catalogue(): Promise<CatalogueView>;
  /** Declarations for JavaScript and TypeScript completion. */
  typeLibraries(): Promise<TypeLibrary[]>;

  runtime(): Promise<RuntimeInfo>;
  packages(): Promise<InstalledPackage[]>;
  /** Installs what was typed with npm, into the open folder. Resolves to npm's exit code. */
  installPackages(text: string): Promise<number>;
  removePackage(name: string): Promise<number>;
  /** npm's output, a line at a time. */
  onPackageLog(listener: (line: string) => void): void;

  startRun(request: RunRequest): Promise<void>;
  stopRun(): Promise<void>;
  debug(action: DebugAction): Promise<void>;
  onRunEvent(listener: (event: RunEvent) => void): void;

  liveOpen(): Promise<LiveSnapshot>;
  liveClose(): Promise<void>;
  liveRefresh(): Promise<LiveSnapshot>;
  liveStep(step: string): Promise<{ outcome: LiveStepOutcome; snapshot: LiveSnapshot }>;

  /** What git says of the open folder. Never rejects: no git, or no repository, is an answer. */
  gitStatus(): Promise<GitStatus>;
  /** Makes the open folder a repository. */
  gitInit(): Promise<void>;
  /** A changed file, before and after. */
  gitDiff(path: string): Promise<GitDiff>;
  /** Commits these files, as they are on disk, and no others. */
  gitCommit(message: string, paths: string[]): Promise<void>;
  /** Brings in what the upstream branch has. A conflict is not a failure: the status says so. */
  gitPull(): Promise<void>;
  gitPush(): Promise<void>;
  /** Settles a file in conflict: one side of it whole, or as it is on disk now. */
  gitResolve(path: string, how: GitResolution): Promise<void>;
  /** Finishes a merge or a rebase whose conflicts are settled. */
  gitContinue(): Promise<void>;
  /** Gives a merge or a rebase up, and puts things back as they were before it. */
  gitAbort(): Promise<void>;
  /** What git was asked and what it said, a line at a time. */
  onGitLog(listener: (line: string) => void): void;

  /**
   * Puts the built-in browser over a rectangle of the window, or — with
   * null — out of sight. It is drawn above everything the window draws.
   */
  pagePlace(rect: PageRect | null): Promise<void>;
  /** Sends the built-in browser to an address. */
  pageNavigate(url: string): Promise<void>;
  onPageState(listener: (state: PageState) => void): void;

  onMenu(listener: (command: MenuCommand) => void): void;
}

export const CLOSED_SNAPSHOT: LiveSnapshot = {
  open: false,
  browser: '',
  url: '',
  title: '',
  screenshot: '',
  groups: [],
  vars: {},
};
