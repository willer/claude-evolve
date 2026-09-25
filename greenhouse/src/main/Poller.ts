// Fleet poller: discovers evolution workspaces under the configured roots,
// parses their CSVs (mtime-cached), classifies live tmux sessions, and pushes
// WorkspaceRow[] to the renderer. One poll loop, everything derived.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { computeStats, emptyStats } from '../core/csv';
import { parseInferenceAll } from '../core/inferenceAll';
import { resolveProfile } from '../core/profile';
import { assignKeys } from '../core/roots';
import {
  TOOLS,
  adhocSessionName,
  classifyPane,
  sessionName,
  shellSessionName,
  toolSessionName,
} from '../core/state';
import type {
  Activity,
  Prefs,
  ProductionSignal,
  SessionState,
  ToolState,
  WorkspaceRow,
  WorkspaceStats,
} from '../core/types';
import type { SessionHost } from './SessionHost';

interface CacheEntry {
  mtimeMs: number;
  pin: string | null; // stats.pinned depends on the inference-all pin, not just the CSV
  stats: WorkspaceStats;
}

// inference-all signal map, cached by (path, mtime). Every workspace under a root shares one
// inference-all, so it is parsed at most once per change, not once per workspace per poll.
const signalCache = new Map<string, { mtimeMs: number; signals: Map<string, ProductionSignal> }>();

/** The production signal `<root>/inference-all` declares for a workspace (pin + blend
 *  membership), or null when it declares none. Parsing is pure — see core/inferenceAll.ts. */
function readProductionSignal(root: string, wsName: string): ProductionSignal | null {
  const file = path.join(root, 'inference-all');
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null; // no inference-all in this root
  }
  let entry = signalCache.get(file);
  if (!entry || entry.mtimeMs !== mtimeMs) {
    let signals: Map<string, ProductionSignal>;
    try {
      signals = parseInferenceAll(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
    entry = { mtimeMs, signals };
    signalCache.set(file, entry);
  }
  return entry.signals.get(wsName) ?? null;
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

  /** Workspace = any direct subdir of a root containing evolution.csv (plus the
   *  root itself, if it has one). Same-named workspaces in different roots are
   *  all kept, told apart by key; the same directory reached twice (a root
   *  listed twice, or a root that is itself a subdir of another root) is one. */
  discover(): Array<{ key: string; name: string; path: string; root: string }> {
    const found: Array<{ name: string; path: string; root: string }> = [];
    const seen = new Set<string>(); // realpaths
    const add = (p: string) => {
      let real: string;
      try {
        real = fs.realpathSync(p);
      } catch {
        return;
      }
      if (seen.has(real)) return;
      seen.add(real);
      found.push({ name: path.basename(p), path: p, root: path.dirname(p) });
    };
    for (const root of this.prefs().roots) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue; // missing root — surfaced via empty grid + prefs dialog
      }
      if (fs.existsSync(path.join(root, 'evolution.csv'))) add(root);
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const p = path.join(root, e.name);
        if (fs.existsSync(path.join(p, 'evolution.csv'))) add(p);
      }
    }
    return assignKeys(found).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
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
        // Production signal: the parent-root `inference-all` says whether this workspace is
        // live, whether it is BLENDED with another workspace into one webhook, and which algo
        // production pins it to. The detail view flags when the leader is NOT what production
        // trades, and offers the pinned row as a second focus.
        const production = readProductionSignal(ws.root, ws.name);
        const pin = production?.pin ?? null;

        const csvPath = path.join(ws.path, 'evolution.csv');
        let mtimeMs: number | null = null;
        let stats: WorkspaceStats;
        try {
          mtimeMs = fs.statSync(csvPath).mtimeMs;
          const cached = this.statsCache.get(csvPath);
          if (cached && cached.mtimeMs === mtimeMs && cached.pin === pin) {
            stats = cached.stats;
          } else {
            stats = computeStats(fs.readFileSync(csvPath, 'utf8'), pin);
            this.statsCache.set(csvPath, { mtimeMs, pin, stats });
          }
        } catch (err) {
          stats = emptyStats(String((err as Error).message ?? err).slice(0, 80));
        }

        // Evolution session fires native "asking" notifications (it runs
        // unattended); the adhoc and shell sessions are hand-driven, so their
        // activity feeds the badge only — no notification noise.
        const session = await this.classifySession(sessionName(ws.key), live, ws.key);
        const adhoc = await this.classifySession(adhocSessionName(ws.key), live, null);
        const shell = await this.classifySession(shellSessionName(ws.key), live, null);

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
          key: ws.key,
          name: ws.name,
          path: ws.path,
          root: ws.root,
          csvMtimeMs: mtimeMs,
          stats,
          session,
          adhoc,
          shell,
          starred: starred.has(ws.key),
          profile,
          production,
        });
      }

      // Repo-level tool scripts: one entry per root whose executable exists.
      const found: Array<{ name: string; root: string }> = [];
      for (const key of TOOLS) {
        for (const root of this.prefs().roots) {
          try {
            fs.accessSync(path.join(root, key), fs.constants.X_OK);
            found.push({ name: key, root });
          } catch {
            /* not in this root */
          }
        }
      }
      this.tools = assignKeys(found).map((t) => ({
        id: t.key,
        key: t.name,
        root: t.root,
        running: live.has(toolSessionName(t.key)),
      }));

      this.rows = rows;
      this.onUpdate(rows, this.tools);
    } finally {
      this.polling = false;
    }
  }
}
