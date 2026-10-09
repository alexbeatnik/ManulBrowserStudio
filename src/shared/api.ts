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
export type ScreenshotMode = 'none' | 'on-fail' | 'always';

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
  | { kind: 'exit'; code: number | null; error?: string };

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
  | 'run-line';

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
