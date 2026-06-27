// Fleet poller: discovers evolution workspaces under the configured roots,
// parses their CSVs (mtime-cached), classifies live tmux sessions, and pushes
// WorkspaceRow[] to the renderer. One poll loop, everything derived.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { computeStats, emptyStats } from '../core/csv';
import { resolveProfile } from '../core/profile';
import { TOOLS, adhocSessionName, classifyPane, sessionName, toolSessionName } from '../core/state';
import type { Activity, Prefs, SessionState, ToolState, WorkspaceRow, WorkspaceStats } from '../core/types';
import type { SessionHost } from './SessionHost';

interface CacheEntry {
  mtimeMs: number;
  stats: WorkspaceStats;
}

export class Poller {
  private rows: WorkspaceRow[] = [];
  private tools: ToolState[] = [];
  private statsCache = new Map<string, CacheEntry>();
  private paneHashes = new Map<string, number | null>();
  // Sessions currently in an attention state (asking | stuck) — for edge-firing
  // the native notification once per transition into that state.
  private prevAttention = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    private host: SessionHost,
    private prefs: () => Prefs,
    private onUpdate: (rows: WorkspaceRow[], tools: ToolState[]) => void,
    private onAttention: (name: string, activity: Activity) => void,
  ) {}

  current(): WorkspaceRow[] {
    return this.rows;
  }

  currentTools(): ToolState[] {
    return this.tools;
  }

  start(intervalMs: number): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Workspace = any direct subdir of a root containing evolution.csv
   *  (plus the root itself, if it has one). */
  discover(): Array<{ name: string; path: string }> {
    const found: Array<{ name: string; path: string }> = [];
    const seen = new Set<string>();
    for (const root of this.prefs().roots) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue; // missing root — surfaced via empty grid + prefs dialog
      }
      if (fs.existsSync(path.join(root, 'evolution.csv'))) {
        const name = path.basename(root);
        if (!seen.has(name)) {
          seen.add(name);
          found.push({ name, path: root });
        }
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const p = path.join(root, e.name);
        if (fs.existsSync(path.join(p, 'evolution.csv')) && !seen.has(e.name)) {
          seen.add(e.name);
          found.push({ name: e.name, path: p });
        }
      }
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Classify one tmux session: running + pane activity, with mtime-style hash
   *  caching for waiting-detection. notifyName non-null fires a native
   *  notification on the edge into an attention state — asking (a question /
   *  permission prompt) or stuck (hit a hard wall) — evolution only; adhoc
   *  passes null. */
  private async classifySession(
    sess: string,
    live: Set<string>,
    notifyName: string | null,
  ): Promise<SessionState> {
    const running = live.has(sess);
    if (!running) {
      this.paneHashes.delete(sess);
      this.prevAttention.delete(sess);
      return { running: false, activity: null };
    }
    const pane = await this.host.capture(sess);
    const { activity, hash } = classifyPane(pane, this.paneHashes.get(sess) ?? null);
    this.paneHashes.set(sess, hash);
    if (activity === 'asking' || activity === 'stuck') {
      if (notifyName && !this.prevAttention.has(sess)) this.onAttention(notifyName, activity);
      this.prevAttention.add(sess);
    } else {
      this.prevAttention.delete(sess);
    }
    return { running: true, activity };
  }

  async poll(): Promise<void> {
    if (this.polling) return; // never overlap (pane captures can be slow)
    this.polling = true;
    try {
      const workspaces = this.discover();
      let live: Set<string>;
      try {
        live = await this.host.list();
      } catch {
        live = new Set(); // tmux hiccup — degrade to "all stopped" this tick
      }
      const starred = new Set(this.prefs().starred);

      const rows: WorkspaceRow[] = [];
      for (const ws of workspaces) {
        const csvPath = path.join(ws.path, 'evolution.csv');
        let mtimeMs: number | null = null;
        let stats: WorkspaceStats;
        try {
          mtimeMs = fs.statSync(csvPath).mtimeMs;
          const cached = this.statsCache.get(csvPath);
          if (cached && cached.mtimeMs === mtimeMs) {
            stats = cached.stats;
          } else {
            stats = computeStats(fs.readFileSync(csvPath, 'utf8'));
            this.statsCache.set(csvPath, { mtimeMs, stats });
          }
        } catch (err) {
          stats = emptyStats(String((err as Error).message ?? err).slice(0, 80));
        }

        // Evolution session fires native "asking" notifications (it runs
        // unattended); the adhoc session is hand-driven, so its activity feeds
        // the badge only — no notification noise.
        const session = await this.classifySession(sessionName(ws.name), live, ws.name);
        const adhoc = await this.classifySession(adhocSessionName(ws.name), live, null);

        // Display profile: optional config.yaml `dashboard:` block, else
        // auto-detect trading (equity/ dir or stock-shaped columns) vs generic.
        let configText: string | null = null;
        try {
          configText = fs.readFileSync(path.join(ws.path, 'config.yaml'), 'utf8');
        } catch {
          configText = null;
        }
        const hasEquityDir = fs.existsSync(path.join(ws.path, 'equity'));
        const profile = resolveProfile(configText, { hasEquityDir, metricColumns: stats.metricColumns });

        rows.push({
          name: ws.name,
          path: ws.path,
          csvMtimeMs: mtimeMs,
          stats,
          session,
          adhoc,
          starred: starred.has(ws.name),
          profile,
        });
      }

      // Repo-level tool scripts: shown when the executable exists in a root.
      this.tools = TOOLS.map((key) => {
        const root = this.prefs().roots.find((r) => {
          try {
            fs.accessSync(path.join(r, key), fs.constants.X_OK);
            return true;
          } catch {
            return false;
          }
        });
        return { key, root: root ?? null, running: live.has(toolSessionName(key)) };
      });

      this.rows = rows;
      this.onUpdate(rows, this.tools);
    } finally {
      this.polling = false;
    }
  }
}
