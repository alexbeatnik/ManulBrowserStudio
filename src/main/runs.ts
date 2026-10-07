// Running a hunt file, and stepping through one.
//
// One engine process per run (src/core/runner.ts). This module adds what the
// window needs on top of the engine's own events: which line of the file each
// reported step belongs to, the screenshot a step left behind, and the
// variables in hand at each pause.

import * as fs from 'fs';
import * as path from 'path';
import { parseHunt, StepLocator } from '../core/huntDoc';
import { buildArgs, HuntRun, stripAnsi } from '../core/runner';
import { DebugAction, RunEvent, RunRequest, Settings } from '../shared/api';
import { EngineService } from './engineService';

export class RunService {
  private run?: HuntRun;

  constructor(
    private readonly engines: EngineService,
    private readonly settings: () => Settings,
    private readonly emit: (event: RunEvent) => void,
  ) {}

  get active(): boolean {
    return this.run !== undefined;
  }

  async start(request: RunRequest): Promise<void> {
    if (this.run) throw new Error('A run is already in progress.');
    const engine = await this.engines.require();
    const settings = this.settings();
    const cwd = settings.workspace || path.dirname(request.file);

    // The engine reports a step by its text and block, not by its line. The
    // file as it is on disk now is the one the engine is about to read.
    const outline = parseHunt(fs.readFileSync(request.file, 'utf8'));
    const steps = new StepLocator(outline);
    const pauses = new StepLocator(outline);

    const { args, dropped } = buildArgs(
      request.file,
      {
        browser: settings.browser,
        headless: settings.headless,
        screenshot: settings.screenshots,
        breakLines: request.mode === 'debug' ? request.breakLines : undefined,
        stepThrough: request.mode === 'step',
      },
      engine,
    );

    const run = new HuntRun(engine.path, args, cwd, process.env);
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
        line: steps.locate(step.step, step.step_block),
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
      if (this.run === run) this.run = undefined;
      this.emit({ kind: 'exit', code, error: error?.message });
    });

    this.emit({ kind: 'started', file: request.file, commandLine: run.commandLine, dropped });
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
