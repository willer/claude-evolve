import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type { Prefs } from '../core/types';

const DEFAULTS: Prefs = {
  roots: [path.join(os.homedir(), 'GitHub', 'trading-strategies')],
  starred: [],
  // Score is the one cross-workspace comparable (same convention as the
  // streamlit reports); CAGR-style metrics are timeframe-dependent.
  sortCol: 'score',
  sortDesc: true,
  winnerCols: ['', '', '', '', ''],
  theme: 'system',
  // Listed so a saved value survives the known-keys load filter; the window
  // falls back to its default size until the first close writes real bounds.
  windowBounds: undefined,
};

export class PrefsStore {
  private prefs: Prefs;

  constructor(private file: string) {
    this.prefs = { ...DEFAULTS };
    try {
      // Only known keys survive a load, so retired prefs don't linger forever.
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      for (const k of Object.keys(DEFAULTS) as Array<keyof Prefs>) {
        if (k in raw) (this.prefs as unknown as Record<string, unknown>)[k] = raw[k];
      }
    } catch {
      // first run — defaults
    }
  }

  get(): Prefs {
    return this.prefs;
  }

  set(patch: Partial<Prefs>): Prefs {
    this.prefs = { ...this.prefs, ...patch };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.prefs, null, 2));
    return this.prefs;
  }
}
