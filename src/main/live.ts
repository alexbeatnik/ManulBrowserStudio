// The live session: a browser the author drives a step at a time while
// writing, and looks at through the page panel.
//
// It is a `manul serve` session held open through the engine's Node binding,
// which is the only thing here that knows the protocol. Runs of a whole file
// do not go through it — they are separate engine processes with their own
// browser (src/main/runs.ts), so a run cannot disturb the page being explored
// and the two can be open at once.

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import type { Session } from 'manul-browser';
import { CLOSED_SNAPSHOT, LiveSnapshot, LiveStepOutcome, MapGroup, Settings } from '../shared/api';
import { EngineService } from './engineService';

/** The file name the preview screenshot is taken under, and removed from. */
const PREVIEW = 'manul-browser-studio-preview';

/** How many elements of one landmark the page panel lists. */
const MAP_BUDGET = 60;

export class LiveService {
  private session?: Session;
  private cwd = '';
  private browser = '';
  /** Calls are made one at a time: the session is one conversation. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly engines: EngineService,
    private readonly settings: () => Settings,
  ) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  open(): Promise<LiveSnapshot> {
    return this.serial(async () => {
      if (!this.session) {
        const engine = await this.engines.require();
        const settings = this.settings();
        // Steps run here resolve relative paths against the folder that is
        // open, as they would in a hunt run from it.
        this.cwd = settings.workspace || fs.mkdtempSync(path.join(os.tmpdir(), 'manul-browser-studio-'));
        const { Session } = await import('manul-browser');
        this.session = await Session.launch({
          binary: engine.path,
          browser: settings.browser,
          headless: settings.headless,
          // Not the default port: a run of a file launches its own browser
          // there, and so may the author's own Chrome.
          port: await freePort(),
          cwd: this.cwd,
          stderr: 'ignore',
        });
        this.browser = this.session.browser || settings.browser;
      }
      return this.snapshot();
    });
  }

  close(): Promise<void> {
    return this.serial(async () => {
      const session = this.session;
      this.session = undefined;
      await session?.close().catch(() => undefined);
    });
  }

  refresh(): Promise<LiveSnapshot> {
    return this.serial(() => this.snapshot());
  }

  step(text: string): Promise<{ outcome: LiveStepOutcome; snapshot: LiveSnapshot }> {
    return this.serial(async () => {
      const session = this.require();
      const raw = await session.step(text);
      const outcome: LiveStepOutcome = {
        ok: raw.ok,
        step: raw.step || text,
        action: raw.action,
        value: raw.value,
        reason: raw.reason,
        error: raw.error,
        score: raw.score,
        near: raw.near.map((n) => ({ text: String(n.text ?? ''), score: Number(n.score ?? 0) })),
      };
      return { outcome, snapshot: await this.snapshot() };
    });
  }

  private require(): Session {
    if (!this.session || this.session.closed) {
      this.session = undefined;
      throw new Error('The live session is not open.');
    }
    return this.session;
  }

  private async snapshot(): Promise<LiveSnapshot> {
    if (!this.session || this.session.closed) {
      this.session = undefined;
      return CLOSED_SNAPSHOT;
    }
    const session = this.session;
    const state = await session.state();
    const map = await session.map({ maxPerGroup: MAP_BUDGET });
    const groups: MapGroup[] = map.groups.map((g) => ({
      name: g.name,
      truncated: g.truncated,
      elements: g.elements.map((e) => ({ label: e.label, role: e.role, editable: e.editable })),
    }));
    return {
      open: true,
      browser: this.browser,
      url: state.url ?? '',
      title: state.title ?? '',
      screenshot: await this.screenshot(session),
      groups,
      vars: await session.vars(),
    };
  }

  /**
   * A picture of the page. The protocol has no command for one, so this runs
   * the SCREENSHOT step the DSL does have and takes the file it writes —
   * `screenshots/<name>.png` under the engine's working directory — leaving
   * that folder as it was found.
   */
  private async screenshot(session: Session): Promise<string> {
    const dir = path.join(this.cwd, 'screenshots');
    const file = path.join(dir, `${PREVIEW}.png`);
    const dirExisted = fs.existsSync(dir);
    try {
      const outcome = await session.step(`SCREENSHOT "${PREVIEW}"`);
      if (!outcome.ok) return '';
      const png = fs.readFileSync(file);
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch {
      return '';
    } finally {
      fs.rmSync(file, { force: true });
      if (!dirExisted) {
        try {
          fs.rmdirSync(dir);
        } catch {
          // Something else is in it now; it is not ours to remove.
        }
      }
    }
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}
