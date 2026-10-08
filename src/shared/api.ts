// What the window may ask of the main process, and what it is told.
//
// The renderer has no Node and no filesystem: everything that touches a file,
// a process or the engine goes through this one interface, which the preload
// script exposes as `window.studio`.

import type { Catalogue, CatalogueEntry } from '../core/catalogue';
import type { ExplainEvent, HuntResult, PauseEvent, StepResult } from '../core/runner';

export type BrowserName = 'chromium' | 'firefox';
export type ScreenshotMode = 'none' | 'on-fail' | 'always';

export interface Settings {
  /** Folder last opened; reopened on start. */
  workspace: string;
  /** An engine binary to use instead of the one found automatically. */
  enginePath: string;
  browser: BrowserName;
  headless: boolean;
  screenshots: ScreenshotMode;
}

export const DEFAULT_SETTINGS: Settings = {
  workspace: '',
  enginePath: '',
  browser: 'chromium',
  headless: false,
  screenshots: 'on-fail',
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

export type MenuCommand =
  | 'open-folder'
  | 'new-file'
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
  /** Creates a starter hook script at the top of the open folder; resolves to its path. */
  createHookScript(): Promise<string>;

  engine(): Promise<EngineStatus>;
  catalogue(): Promise<CatalogueView>;
  /** Declarations for JavaScript and TypeScript completion. */
  typeLibraries(): Promise<TypeLibrary[]>;

  startRun(request: RunRequest): Promise<void>;
  stopRun(): Promise<void>;
  debug(action: DebugAction): Promise<void>;
  onRunEvent(listener: (event: RunEvent) => void): void;

  liveOpen(): Promise<LiveSnapshot>;
  liveClose(): Promise<void>;
  liveRefresh(): Promise<LiveSnapshot>;
  liveStep(step: string): Promise<{ outcome: LiveStepOutcome; snapshot: LiveSnapshot }>;

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
