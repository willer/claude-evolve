// Shared types across main/renderer. The renderer only ever sees these JSON
// shapes (plus the raw terminal byte stream over a MessagePort).

/** Live-session activity, classified from tmux pane motion (see state.ts).
 *  'stuck' = byte-static on a hard wall (spend/usage limit) — needs a human. */
export type Activity = 'working' | 'waiting' | 'asking' | 'stuck';

export interface SessionState {
  running: boolean;
  activity: Activity | null; // null when not running
}

/** One evolution candidate row, header-mapped. Extra evaluator metrics
 *  (sharpe, yearly_return, …) ride in `metrics` keyed by CSV column name. */
export interface Candidate {
  id: string;
  basedOnId: string;
  description: string;
  performance: number | null;
  status: string; // pending | running | complete | failed* | skipped
  metrics: Record<string, number>;
}

export interface GenStats {
  gen: number; // 0 for baseline
  pending: number;
  running: number;
  complete: number;
  failed: number;
  skipped: number;
  best: Candidate | null;
}

/** Everything the dashboard knows about one workspace's CSV. */
export interface WorkspaceStats {
  error: string | null;
  counts: { pending: number; running: number; complete: number; failed: number; skipped: number };
  leader: Candidate | null;
  leaderGen: number | null;
  latestGen: number;
  gensSinceTop: number | null;
  /** c/(c+f) over the 5 generations before the latest (latest may be mid-run). */
  recentSuccessRate: number | null;
  /** Failures across the last 2 generations, including the mid-run latest. */
  recentFails: number;
  /** Best score per generation, ascending by gen — the card sparkline. */
  sparkline: number[];
  generations: GenStats[];
  /** Metric column names that have at least one numeric value. */
  metricColumns: string[];
}

/** One displayed leader metric: which CSV column, its label, and formatting. */
export interface MetricSpec {
  col: string;
  label: string;
  pct?: boolean; // render value*100 with a % suffix
  neg?: boolean; // always color as a loss (e.g. drawdown), regardless of sign
}

/** Per-workspace display profile. 'trading' shows the canonical ratio panel
 *  (and the NAV/backtest chrome lights up where its artifacts exist); 'generic'
 *  just lists the evaluator's CSV columns. Resolved from config.yaml's optional
 *  `dashboard:` block, else auto-detected from artifacts/columns. */
export interface ResolvedProfile {
  kind: string; // 'trading' | 'generic' | a custom name (e.g. 'forecasting')
  metrics: MetricSpec[]; // ordered preferred metrics; [] = list raw columns
}

export interface WorkspaceRow {
  name: string; // directory basename
  path: string; // absolute path
  csvMtimeMs: number | null;
  stats: WorkspaceStats;
  /** The evolution session (claude running /evolve). */
  session: SessionState;
  /** The adhoc session (plain claude, NOT told to evolve) — independent of the
   *  evolution session; either, both, or neither may be running. */
  adhoc: SessionState;
  starred: boolean;
  /** Display profile (metric labels/ordering + trading-vs-generic kind). */
  profile: ResolvedProfile;
}

/** Overall workspace health: error (CSV unreadable) > failing (>3 failures
 *  in the last 2 gens — broken, red) > idle (the RUNNER is alive but its CSV
 *  has been static >12h — the claude process sitting on a question or quiet,
 *  not the evolution itself; yellow) > plateau (>20 gens since the leader) >
 *  good. */
export type HealthLevel = 'error' | 'idle' | 'failing' | 'plateau' | 'good';

export interface Health {
  level: HealthLevel;
  /** Short chip text, e.g. "plateau". */
  label: string;
  /** One-line explanation for tooltips. */
  detail: string;
}

/** Repo-level tool script (inference-all / backtest-all) session state. */
export interface ToolState {
  key: string;
  /** Root directory containing the executable, or null if absent everywhere. */
  root: string | null;
  running: boolean;
}

/** Everything one fleet push carries. */
export interface FleetPayload {
  rows: WorkspaceRow[];
  tools: ToolState[];
}

export interface Prefs {
  /** Directories scanned for evolution workspaces (subdirs with evolution.csv). */
  roots: string[];
  starred: string[];
  sortCol: string;
  sortDesc: boolean;
  /** Up to 5 evaluator CSV columns shown for the current winner, right of Score
   *  in the fleet list. '' = an empty slot. Chosen in the Roots/config dialog. */
  winnerCols: string[];
  /** UI theme; 'system' follows the OS. Drives Electron's nativeTheme, which
   *  the renderer picks up via prefers-color-scheme. */
  theme: 'system' | 'light' | 'dark';
  /** Last window position/size, restored on launch. Undefined until the first
   *  window close. `maximized` restores a maximized window over the saved
   *  normal bounds. */
  windowBounds?: { x: number; y: number; width: number; height: number; maximized: boolean };
}
