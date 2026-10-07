// Which engine the app drives, and what that engine can do.
//
// The search itself is src/core/engine.ts. This adds the two places only this
// app knows about — the open folder, and the copy that came with the app's own
// npm dependencies — and remembers the answer until one of them changes.

import { execFile } from 'child_process';
import * as path from 'path';
import { Catalogue, loadBundledCatalogue, mergeSchema, SchemaVerb } from '../core/catalogue';
import { EngineInfo, resolveEngine, sourceLabel } from '../core/engine';
import { EngineStatus, Settings } from '../shared/api';

interface Resolved {
  engine?: EngineInfo;
  failures: string[];
}

export class EngineService {
  private resolved?: Promise<Resolved>;
  private catalogueCache?: Promise<Catalogue>;

  constructor(
    private readonly settings: () => Settings,
    /** The app's own folder, where data/dsl.json is. */
    private readonly appRoot: string,
    /**
     * The folder whose node_modules carries the engine that came with the
     * app. The same as appRoot when run from source; in an installed app it
     * is the unpacked copy beside the archive, because a binary inside the
     * archive can be seen but not started.
     */
    private readonly engineRoot: string = appRoot,
  ) {}

  /** Forget the answer; the folder or the setting has changed. */
  invalidate(): void {
    this.resolved = undefined;
    this.catalogueCache = undefined;
  }

  private resolve(): Promise<Resolved> {
    if (!this.resolved) {
      const { workspace, enginePath } = this.settings();
      // The project's own engine first: a hunt should run on what its project
      // pins. The one bundled with the app is the fallback that makes a bare
      // folder of .hunt files work.
      const roots = [workspace, this.engineRoot].filter(Boolean);
      this.resolved = resolveEngine(roots, { custom: enginePath }).then(({ engine, failures }) => ({
        engine,
        failures,
      }));
    }
    return this.resolved;
  }

  /** The engine, or an error a person can act on. */
  async require(): Promise<EngineInfo> {
    const { engine, failures } = await this.resolve();
    if (engine) return engine;
    const why = failures.length ? ` Tried: ${failures.join('; ')}` : '';
    throw new Error(`No Manul engine was found.${why}`);
  }

  async status(): Promise<EngineStatus> {
    const { engine, failures } = await this.resolve();
    if (!engine) {
      return { found: false, path: '', version: '', source: '', detail: '', failures };
    }
    return {
      found: true,
      path: engine.path,
      version: engine.version,
      source: sourceLabel(engine.source),
      detail: engine.source === 'setting' ? 'chosen in Manul Browser Studio' : engine.detail,
      failures,
    };
  }

  /** The bundled catalogue, with whatever the engine reports beyond it. */
  catalogue(): Promise<Catalogue> {
    if (!this.catalogueCache) {
      const bundled = loadBundledCatalogue(path.join(this.appRoot, 'data', 'dsl.json'));
      this.catalogueCache = this.resolve()
        .then(({ engine }) => (engine ? this.schema(engine.path) : undefined))
        .then((schema) => (schema ? mergeSchema(bundled, schema) : bundled))
        .catch(() => bundled);
    }
    return this.catalogueCache;
  }

  private schema(enginePath: string): Promise<{ version?: string; verbs?: SchemaVerb[] } | undefined> {
    return new Promise((resolve) => {
      execFile(enginePath, ['schema'], { timeout: 8000, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout) => {
        if (err) return resolve(undefined);
        try {
          resolve(JSON.parse(stdout) as { version?: string; verbs?: SchemaVerb[] });
        } catch {
          // An engine without `schema`, or one that printed something else.
          resolve(undefined);
        }
      });
    });
  }
}
