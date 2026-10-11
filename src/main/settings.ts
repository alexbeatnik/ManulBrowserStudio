// What the app remembers between launches: one small JSON file in the
// per-user data folder.

import * as fs from 'fs';
import * as path from 'path';
import { BROWSERS, DEFAULT_SETTINGS, SCREENSHOT_MODES, Settings } from '../shared/api';

/**
 * The settings in what was read or sent, and nothing else. The file can be
 * edited by hand, and is left behind by versions that kept other things in
 * it: a browser this version does not have would be passed to the engine as
 * it is, and a folder that is not text would be opened.
 */
export function sanitise(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== 'object') return {};
  const given = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, standard] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof given[key] === typeof standard) out[key] = given[key];
  }
  const kept = out as Partial<Settings>;
  if (kept.browser !== undefined && !BROWSERS.includes(kept.browser)) delete kept.browser;
  if (kept.screenshots !== undefined && !SCREENSHOT_MODES.includes(kept.screenshots)) delete kept.screenshots;
  return kept;
}

export class SettingsStore {
  private current: Settings;

  constructor(private readonly file: string) {
    this.current = { ...DEFAULT_SETTINGS, ...this.read() };
  }

  get(): Settings {
    return { ...this.current };
  }

  update(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...sanitise(patch) };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, `${JSON.stringify(this.current, null, 2)}\n`);
    } catch {
      // Settings that cannot be saved are still in force for this session.
    }
    return this.get();
  }

  private read(): Partial<Settings> {
    try {
      return sanitise(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return {};
    }
  }
}
