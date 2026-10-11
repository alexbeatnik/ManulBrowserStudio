// Running a hunt file, and stepping through one.
//
// One engine process per run (src/core/runner.ts). This module adds what the
// window needs on top of the engine's own events: which line of the file each
// reported step belongs to, the screenshot a step left behind, and the
// variables in hand at each pause.

import * as fs from 'fs';
import * as path from 'path';
import { hookEnvironment, hookRuntime, resolveHookScript } from '../core/hooks';
import { parseHunt, StepLocator } from '../core/huntDoc';
import { buildArgs, HuntRun, stripAnsi } from '../core/runner';
import { DebugAction, RunEvent, RunRequest, Settings } from '../shared/api';
import type { BuiltInBrowser } from './builtInBrowser';
import { EngineService } from './engineService';

export class RunService {
  private run?: HuntRun;
  private starting = false;

  constructor(
    private readonly engines: EngineService,
    private readonly settings: () => Settings,
    private readonly emit: (event: RunEvent) => void,
    /** The launcher for the app's own Node; see hookRuntime.ts. */
    private readonly builtInNode: () => string,
    private readonly builtIn: BuiltInBrowser,
    /**
     * Makes the built-in browser new — nothing kept, a page that has been
     * nowhere — and resolves, when asked for one, to a picture of the page as
     * it was just before.
     */
    private readonly renewBuiltIn: (picture: boolean) => Promise<string>,
  ) {}

  get active(): boolean {
    return this.run !== undefined;
  }

  async start(request: RunRequest): Promise<void> {
    // Getting a run under way takes a moment — the engine is looked for, the
    // built-in browser made new — and a second asked for in that moment
    // would otherwise be started beside the first.
    if (this.run || this.starting) throw new Error('A run is already in progress.');
    this.starting = true;
    try {
      await this.begin(request);
    } finally {
      this.starting = false;
    }
  }

  private async begin(request: RunRequest): Promise<void> {
    const engine = await this.engines.require();
    const settings = this.settings();
    const cwd = settings.workspace || path.dirname(request.file);

    // The engine reports a step by its text and block, not by its line. The
    // file as it is on disk now is the one the engine is about to read.
    const outline = parseHunt(fs.readFileSync(request.file, 'utf8'));
    const steps = new StepLocator(outline);
    const pauses = new StepLocator(outline);

    // The engine runs the hook script it is told about and looks for none.
    // The one that belongs to this hunt is the nearest `manul_hooks.*` at or
    // above it, inside the open folder.
    const hooks = resolveHookScript(request.file, cwd, { enabled: true, path: '' });
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (hooks) {
      Object.assign(env, hookEnvironment(hooks, [cwd], engine, { python: '', node: '' }));
      // A JavaScript script runs on the Node that came with the app, which
      // can also find the binding for it. A Python one needs a Python.
      if (hookRuntime(hooks) === 'node') env.MANUL_NODE = this.builtInNode();
    }

    // The built-in browser is not started by the engine but attached to: a
    // page that is there already, made as empty as a new browser would be.
    const builtIn = settings.browser === 'builtin';
    if (builtIn) await this.renewBuiltIn(false);
    const { args, dropped } = buildArgs(
      request.file,
      {
        hooks,
        browser: builtIn ? undefined : settings.browser,
        headless: builtIn ? undefined : settings.headless,
        extraArgs: builtIn ? ['--cdp', await this.builtIn.endpoint()] : undefined,
        screenshot: settings.screenshots,
        breakLines: request.mode === 'debug' ? request.breakLines : undefined,
        stepThrough: request.mode === 'step',
      },
      engine,
    );

    const run = new HuntRun(engine.path, args, cwd, env);
    this.run = run;

    // A pause is announced again after every command that does not end it,
    // `vars` included — so the variables are asked for once per pause, and the
    // line is found once, or each repeat would move on to the next match.
    let pausedAt = -1;
    let pausedLine: number | undefined;

    run.on('step', (step) => {
      pausedAt = -1;
      this.emit({
        kind: 'step',
        step,
        line: steps.locate(step.step, step.step_block, step.step_index),
        screenshot: readScreenshot(cwd, step.screenshot_path),
      });
    });
    run.on('pause', (pause) => {
      if (pause.idx !== pausedAt) {
        pausedAt = pause.idx;
        pausedLine = pauses.locate(pause.step);
        // An engine that predates `vars` announces the pause again and says
        // nothing else, which is all the answer the window needs to show none.
        run.send('vars');
      }
      this.emit({ kind: 'pause', pause, line: pausedLine });
    });
    run.on('vars', (vars) => this.emit({ kind: 'vars', vars }));
    run.on('explain', (explain) => this.emit({ kind: 'explain', explain }));
    run.on('result', (result) => this.emit({ kind: 'result', result }));
    run.on('log', (text) => this.emit({ kind: 'log', text: stripAnsi(text) }));
    run.on('exit', ({ code, error }) => {
      // A browser the engine started is closed by the engine. The built-in
      // one is not the engine's to close, so it is made new here: what the
      // hunt signed in to, stored or left open ends with the hunt. The run is
      // not over until that is done — the next must not begin in the middle.
      const over = (still?: string): void => {
        if (this.run === run) this.run = undefined;
        this.emit({ kind: 'exit', code, error: error?.message, still });
      };
      if (!builtIn) return over();
      this.renewBuiltIn(true).then(over, () => over(''));
    });

    this.emit({ kind: 'started', file: request.file, commandLine: run.commandLine, dropped, hooks: hooks ?? '' });
    run.start();
  }

  debug(action: DebugAction): void {
    this.run?.send(action);
  }

  stop(): void {
    this.run?.stop();
  }
}

/** The PNG a step recorded, as a data: URL the window can show. */
function readScreenshot(cwd: string, file: string | undefined): string | undefined {
  if (!file) return undefined;
  try {
    const png = fs.readFileSync(path.resolve(cwd, file));
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return undefined;
  }
}
