// What the app remembers between launches: one small JSON file in the
// per-user data folder.

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SETTINGS, Settings } from '../shared/api';

export class SettingsStore {
  private current: Settings;

  constructor(private readonly file: string) {
    this.current = { ...DEFAULT_SETTINGS, ...this.read() };
  }

  get(): Settings {
    return { ...this.current };
  }

  update(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...patch };
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
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Settings>;
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }
}
