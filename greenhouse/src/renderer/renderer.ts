// Renderer: keyboard-first fleet list (default) + card grid + workspace detail
// with embedded terminal. All data arrives as WorkspaceRow[] pushes; the
// terminal byte stream rides a MessagePort.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

import { PERIOD_LABELS, buildBacktestTable } from '../core/backtests';
import type { BacktestAlgo, BacktestRow } from '../core/backtests';
import { FAILING_FAILS, PLATEAU_GENS, classifyHealth } from '../core/csv';
import { adhocSessionName, sessionName, toolSessionName } from '../core/state';
import type {
  Candidate,
  FleetPayload,
  Health,
  MetricSpec,
  ResolvedProfile,
  Prefs,
  SessionState,
  ToolState,
  WorkspaceRow,
} from '../core/types';

type BacktestSummary = {
  runDate: string;
  runDates: string[];
  rows: BacktestRow[];
  appendix: Array<{ algorithm: string; algorithm_name: string; reasons: string }>;
} | null;

declare global {
  interface Window {
    greenhouse: {
      fleet: { snapshot(): Promise<FleetPayload>; refresh(): Promise<void> };
      workspace: {
        equity(
          name: string,
          candidateId: string,
        ): Promise<{ dates: string[]; nav: number[]; position?: number[] | null } | null>;
        benchmark(name: string): Promise<Benchmark | null>;
      };
      evolution: {
        start(name: string): Promise<void>;
        stop(name: string): Promise<void>;
      };
      adhoc: {
        start(name: string): Promise<void>;
        stop(name: string): Promise<void>;
      };
      tools: { start(key: string): Promise<void>; stop(key: string): Promise<void> };
      backtests: {
        summary(runDate?: string): Promise<BacktestSummary>;
        equity(
          runDate: string,
          algorithm: string,
          period: string,
        ): Promise<{ dates: string[]; nav: number[]; position: number[] | null } | null>;
      };
      session: {
        attach(id: string, cols: number, rows: number): Promise<{ ok: boolean }>;
        detach(id: string): Promise<void>;
        unstick(id: string): Promise<void>;
      };
      prefs: { get(): Promise<Prefs>; set(patch: Partial<Prefs>): Promise<Prefs> };
      pathForFile(file: File): string;
    };
  }
}

const api = window.greenhouse;

let rows: WorkspaceRow[] = [];
let tools: ToolState[] = [];
let prefs: Prefs = { roots: [], starred: [], sortCol: 'score', sortDesc: true, winnerCols: ['', '', '', '', ''], theme: 'system' };
let viewMode: 'list' | 'grid' = 'list'; // session-only — every launch starts in the list
let view: string | null = null; // workspace detail, or null
let toolView: string | null = null; // tool session page (inference-all / backtest-all), or null
let btLatest: BacktestSummary | undefined; // latest run, joined into the per-workspace stats
let btLoaded = false; // have we fetched the summary at least once (distinguishes "no DB" from "not yet loaded")
let selectedName: string | null = null; // keyboard cursor, stable across pushes
let peekFor: string | null = null; // quick-status popover target
let searchQuery = ''; // fleet name/leader filter ('/' focuses the search box)

const $ = (id: string) => document.getElementById(id)!;

// ── formatting ───────────────────────────────────────────────────────────────

function fmtScore(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(4);
}

function fmtNum(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(Math.abs(v) < 1 ? 3 : 2);
}

function fmtAge(mtimeMs: number | null): { text: string; stale: boolean } {
  if (mtimeMs === null) return { text: 'n/a', stale: false };
  const secs = (Date.now() - mtimeMs) / 1000;
  const stale = secs > 43200; // >12h with no CSV write
  if (secs < 60) return { text: `${Math.floor(secs)}s ago`, stale };
  if (secs < 3600) return { text: `${Math.floor(secs / 60)}m ago`, stale };
  if (secs < 86400) return { text: `${Math.floor(secs / 3600)}h ago`, stale };
  return { text: `${Math.floor(secs / 86400)}d ago`, stale };
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function healthOf(r: WorkspaceRow): Health {
  return classifyHealth(r.stats, r.csvMtimeMs, r.session.running, Date.now());
}

function healthChip(h: Health): string {
  return `<span class="hc ${h.level}" title="${esc(h.detail)}">${esc(h.label)}</span>`;
}

// CSS variables so chart strokes follow the light/dark theme.
const HEALTH_COLOR: Record<Health['level'], string> = {
  good: 'var(--green)',
  plateau: 'var(--yellow)',
  stale: 'var(--yellow)',
  failing: 'var(--red)',
  error: 'var(--red)',
};

// Leader metrics, label-mapped and percent-aware. Year returns (return_YYYY)
// are kept out of here — they get their own by-year section.
// Percent-formatted columns NOT in the profile's metric list (e.g. trading's
// total_return/benchmark_return), used by the generic fallback below.
const PCT_KEYS = new Set([
  'total_return', 'benchmark_return', 'volatility',
]);

function fmtMetric(key: string, v: number): { v: string; cls: string } {
  if (PCT_KEYS.has(key) || /^return_\d{4}$/.test(key)) {
    return { v: `${(v * 100).toFixed(1)}%`, cls: v >= 0 ? 'pos' : 'neg' };
  }
  return { v: fmtNum(v), cls: '' };
}

function fmtSpec(m: MetricSpec, v: number): { v: string; cls: string } {
  if (m.pct) return { v: `${(v * 100).toFixed(1)}%`, cls: m.neg ? 'neg' : v >= 0 ? 'pos' : 'neg' };
  return { v: fmtNum(v), cls: '' };
}

// Leader metrics in the workspace profile's preferred order/labels, then any
// remaining evaluator columns generically (year returns get their own section).
function ratioMetrics(c: Candidate, profile: ResolvedProfile): Array<{ k: string; v: string; cls: string }> {
  const out: Array<{ k: string; v: string; cls: string }> = [];
  const seen = new Set<string>();
  for (const m of profile.metrics) {
    if (c.metrics[m.col] !== undefined) {
      seen.add(m.col);
      out.push({ k: m.label, ...fmtSpec(m, c.metrics[m.col]) });
    }
  }
  for (const [key, val] of Object.entries(c.metrics)) {
    if (seen.has(key) || /^return_\d{4}$/.test(key)) continue;
    out.push({ k: key, ...fmtMetric(key, val) });
  }
  return out;
}

/** [year label, value] pairs from return_YYYY metric columns, ascending. */
function yearReturns(c: Candidate): Array<{ year: string; v: number }> {
  return Object.keys(c.metrics)
    .filter((k) => /^return_\d{4}$/.test(k))
    .sort()
    .map((k) => ({ year: k.replace('return_', ''), v: c.metrics[k] }));
}

function yearBarsHtml(years: Array<{ year: string; v: number }>): string {
  if (years.length === 0) return `<div class="desc" style="color: var(--dim)">no per-year returns in CSV</div>`;
  const maxAbs = Math.max(...years.map((y) => Math.abs(y.v)), 0.0001);
  return years
    .map((y) => {
      const cls = y.v >= 0 ? 'pos' : 'neg';
      const w = (Math.abs(y.v) / maxAbs) * 100;
      return `<div class="ybar-row">
        <span class="yb-label">${esc(y.year)}</span>
        <div class="yb-track"><div class="yb-fill ${cls}" style="width:${w.toFixed(1)}%"></div></div>
        <span class="yb-val ${cls}">${(y.v * 100).toFixed(1)}%</span>
      </div>`;
    })
    .join('');
}

// Compact card metrics: CAGR, Sharpe, MaxDD, latest year return.
function headlineMetrics(c: Candidate): Array<{ k: string; v: string; cls: string }> {
  const out: Array<{ k: string; v: string; cls: string }> = [];
  const m = c.metrics;
  if (m.yearly_return !== undefined) out.push({ k: 'CAGR', ...fmtMetric('yearly_return', m.yearly_return) });
  if (m.sharpe !== undefined) out.push({ k: 'Sharpe', v: m.sharpe.toFixed(2), cls: m.sharpe >= 1 ? 'pos' : '' });
  if (m.max_drawdown !== undefined) {
    out.push({ k: 'MaxDD', v: `${(Math.abs(m.max_drawdown) * 100).toFixed(1)}%`, cls: 'neg' });
  }
  const last = yearReturns(c).pop();
  if (last) out.push({ k: last.year, v: `${(last.v * 100).toFixed(1)}%`, cls: last.v >= 0 ? 'pos' : 'neg' });
  return out.slice(0, 4);
}

// ── charts (inline SVG) ──────────────────────────────────────────────────────

// Panel-colored outline drawn behind axis glyphs (paint-order: stroke) so labels
// stay legible where a line or gridline passes through them.
const HALO = 'paint-order: stroke; stroke: var(--panel); stroke-width: 3px; stroke-linejoin: round;';

// Compact Y-axis label: enough precision to tell values apart without overflowing
// the gutter (scores can be Sharpe-like ones or six-figure NAVs).
function axisNum(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

// Left gutter labels (min/max) on the value axis — shared by the spark/multiline
// charts when enlarged. The leftPad is the gutter width the caller reserves.
function yAxisGutter(
  w: number,
  leftPad: number,
  x0: number,
  yOf: (v: number) => number,
  marks: number[],
): string {
  const yLab = (yy: number, t: string) =>
    `<text x="${leftPad - 4}" y="${(yy + 3).toFixed(1)}" style="fill: var(--dim); ${HALO}" font-size="9" text-anchor="end">${t}</text>`;
  const gLine = (yy: number) =>
    `<line x1="${x0}" y1="${yy.toFixed(1)}" x2="${(w - 2).toFixed(1)}" y2="${yy.toFixed(1)}" style="stroke: var(--border)" stroke-dasharray="1,3" opacity="0.6"/>`;
  return marks.map((v) => gLine(yOf(v)) + yLab(yOf(v), axisNum(v))).join('');
}

// Bottom (generation) axis for the spark/multiline charts when enlarged: an
// axis baseline plus a handful of evenly-spaced "gen N" labels across the plot
// width. gens[i] is the generation number at plot position i (aligned 1:1 with
// the series). Endpoints anchor inward so they don't clip the chart edges.
function xAxisGen(
  w: number,
  x0: number,
  baseY: number,
  labelY: number,
  xOf: (i: number) => number,
  gens: number[],
): string {
  const n = gens.length;
  if (n < 2) return '';
  const maxLabels = Math.max(2, Math.floor((w - 2 - x0) / 44));
  const step = Math.max(1, Math.ceil((n - 1) / (maxLabels - 1)));
  const idxs: number[] = [];
  for (let i = 0; i < n; i += step) idxs.push(i);
  if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
  let out = `<line x1="${x0}" y1="${baseY.toFixed(1)}" x2="${(w - 2).toFixed(1)}" y2="${baseY.toFixed(1)}" style="stroke: var(--border)"/>`;
  for (const i of idxs) {
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    out += `<text x="${xOf(i).toFixed(1)}" y="${labelY}" style="fill: var(--dim); ${HALO}" font-size="9" text-anchor="${anchor}">${gens[i]}</text>`;
  }
  return out;
}

function sparklineSvg(
  values: number[],
  w: number,
  h: number,
  color = 'var(--green)',
  axes = false,
  xLabels?: number[],
): string {
  if (values.length < 2) {
    return `<svg class="spark" width="${w}" height="${h}"><line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" style="stroke: var(--border)" stroke-dasharray="3,3"/></svg>`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const leftPad = axes ? 46 : 0;
  const bottomPad = axes ? 16 : 0;
  const x0 = leftPad + 2;
  const plotW = w - 4 - leftPad;
  const x = (i: number) => x0 + (i / (values.length - 1)) * plotW;
  const y = (v: number) => h - 3 - bottomPad - ((v - min) / span) * (h - 6 - bottomPad);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  const axisG = axes
    ? yAxisGutter(w, leftPad, x0, y, max === min ? [max] : [max, min]) +
      (xLabels ? xAxisGen(w, x0, h - 3 - bottomPad, h - 4, x, xLabels) : '')
    : '';
  return (
    `<svg class="spark" width="${w}" height="${h}">` +
    axisG +
    `<polyline points="${pts.join(' ')}" fill="none" style="stroke: ${color}" stroke-width="1.5"/>` +
    `<circle cx="${last[0]}" cy="${last[1]}" r="2.2" style="fill: ${color}"/>` +
    `</svg>`
  );
}

const SERIES_COLORS = ['var(--cyan)', 'var(--magenta)', 'var(--green)', 'var(--yellow)', 'var(--red)'];

interface Series {
  name: string;
  values: Array<number | null>; // indexed by generation position; null = no data
  color: string;
}

/** Multi-line chart over generation positions; series may have gaps (nulls). */
function multiLineSvg(series: Series[], w: number, h: number, axes = false, xLabels?: number[]): string {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const n = Math.max(...series.map((s) => s.values.length));
  if (all.length < 2 || n < 2) return '';
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 0);
  const span = max - min || 1;
  const leftPad = axes ? 46 : 0;
  const bottomPad = axes ? 16 : 0;
  const x0 = leftPad + 2;
  const plotW = w - 4 - leftPad;
  const x = (i: number) => x0 + (i / (n - 1)) * plotW;
  const y = (v: number) => h - 3 - bottomPad - ((v - min) / span) * (h - 6 - bottomPad);
  const zero = y(0);
  let out = `<svg class="spark" width="${w}" height="${h}">`;
  if (axes) out += yAxisGutter(w, leftPad, x0, y, [max, min].filter((v) => v !== 0));
  if (axes && xLabels) out += xAxisGen(w, x0, h - 3 - bottomPad, h - 4, x, xLabels);
  out += `<line x1="${axes ? x0 : 0}" y1="${zero.toFixed(1)}" x2="${axes ? (w - 2).toFixed(1) : w}" y2="${zero.toFixed(1)}" style="stroke: var(--border)" stroke-dasharray="3,3"/>`;
  if (axes)
    out += `<text x="${leftPad - 4}" y="${(zero + 3).toFixed(1)}" style="fill: var(--dim); ${HALO}" font-size="9" text-anchor="end">0</text>`;
  for (const s of series) {
    const pts = s.values
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter((p): p is string => p !== null);
    if (pts.length === 0) continue;
    if (pts.length > 1) out += `<polyline points="${pts.join(' ')}" fill="none" style="stroke: ${s.color}" stroke-width="1.5"/>`;
    const last = pts[pts.length - 1].split(',');
    out += `<circle cx="${last[0]}" cy="${last[1]}" r="2.2" style="fill: ${s.color}"/>`;
  }
  return `${out}</svg>`;
}

// ── NAV chart (out-of-sample equity artifact) ────────────────────────────────

// position: signed % of portfolio (long +, short −), aligned 1:1 with nav, or
// absent (undefined/null) for the per-candidate artifact and pre-position runs.
type Equity = { dates: string[]; nav: number[]; position?: number[] | null };
type Benchmark = { symbol: string; periods: Record<string, { instrument: number | null; spy: number | null }> };

// One fetch per workspace/candidate per session; null (no artifact) is cached
// too — a candidate's artifact is written once at evaluation time, and a new
// leader is a new id, so there's nothing to re-poll.
const equityCache = new Map<string, Equity | null>();
const equityPending = new Set<string>();

/** Cached equity series; undefined = fetch in flight (render again on arrival). */
function equityFor(ws: string, candidateId: string): Equity | null | undefined {
  const key = `${ws}/${candidateId}`;
  if (equityCache.has(key)) return equityCache.get(key);
  if (!equityPending.has(key)) {
    equityPending.add(key);
    void api.workspace
      .equity(ws, candidateId)
      .then((d) => {
        equityCache.set(key, d);
        equityPending.delete(key);
        render();
      })
      .catch(() => equityPending.delete(key));
  }
  return undefined;
}

/** Annualized Sharpe from a daily NAV series: mean/std of daily returns × √252.
 *  null when too few points or zero variance. Computed over whatever slice it's
 *  given, so the interactive zoom reports the Sharpe of the *visible* window. */
function annualizedSharpe(nav: number[]): number | null {
  const rets: number[] = [];
  for (let i = 1; i < nav.length; i++) if (nav[i - 1] > 0) rets.push(nav[i] / nav[i - 1] - 1);
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? (mean / sd) * Math.sqrt(252) : null;
}

/** Sub-range an Equity to [i0, i1] inclusive — the unit of interactive zoom/pan.
 *  Slicing and re-rendering autoscales Y and recomputes the badge stats to the
 *  visible window, since navChartSvg derives everything from the array it's given. */
function sliceEquity(eq: Equity, i0: number, i1: number): Equity {
  return {
    dates: eq.dates.slice(i0, i1 + 1),
    nav: eq.nav.slice(i0, i1 + 1),
    position: eq.position ? eq.position.slice(i0, i1 + 1) : eq.position,
  };
}

/** NAV line over time with an underwater (drawdown) pane and year gridlines —
 *  the at-a-glance view of big drawdowns and stalled NAV. With axes:true it
 *  adds a left gutter of %-return-vs-start labels (Y) and start/end dates (X) —
 *  return-from-start is the only comparable scale, since the backtest periods
 *  aren't rebased to a common base (longterm starts at 1.0, ytd2026 at ~200k). */
function navChartSvg(eq: Equity, w: number, h: number, opts: { axes?: boolean } = {}): string {
  const { dates, nav } = eq;
  if (nav.length < 2) return '';
  const axes = opts.axes ?? false;
  const leftPad = axes ? 46 : 0;
  const labelH = axes ? 16 : 12;
  const plotH = h - labelH;
  // Optional middle pane: signed position (% of portfolio, long +/short −),
  // mirroring backtest.py's 3-panel chart. Only when the curve carries a 1:1
  // position series (backtest-all equity_curves since 2026-06-17); the
  // per-candidate artifact and older runs omit it, so the chart stays 2-pane.
  const position = eq.position && eq.position.length === nav.length ? eq.position : null;
  const navH = Math.round(plotH * (position ? 0.54 : 0.7));
  const posH = position ? Math.round(plotH * 0.2) : 0;
  const ddTop = position ? navH + posH + 6 : navH + 3; // 3px gap above each lower pane
  const ddH = plotH - ddTop;
  const x0 = leftPad + 2;
  const plotW = w - 4 - leftPad;
  const x = (i: number) => x0 + (i / (nav.length - 1)) * plotW;

  const base = nav[0];
  const min = Math.min(...nav);
  const max = Math.max(...nav);
  const span = max - min || 1;
  const yNav = (v: number) => navH - 2 - ((v - min) / span) * (navH - 4);

  // Underwater curve: nav / running-max - 1 (≤ 0).
  let runMax = -Infinity;
  const dd = nav.map((v) => {
    runMax = Math.max(runMax, v);
    return v / runMax - 1;
  });
  const minDd = Math.min(...dd, -0.0001);
  const yDd = (d: number) => ddTop + (d / minDd) * (ddH - 2);

  // Time axis: walk calendar-month boundaries, then pick a stride (months) whose
  // tick count fits the plot width — so a wide/zoomed chart labels every month
  // while a narrow tile falls back to quarters or years. Labels land on
  // calendar-aligned positions (Jan, Apr, …) and carry the year on January (and
  // on the first label) so context survives even when most ticks are bare months.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mb: Array<{ i: number; y: number; m: number }> = [];
  let prevYm = '';
  for (let i = 0; i < dates.length; i++) {
    const ym = dates[i].slice(0, 7);
    if (ym !== prevYm) {
      mb.push({ i, y: +dates[i].slice(0, 4), m: +dates[i].slice(5, 7) });
      prevYm = ym;
    }
  }
  const monthsAbs = (b: { y: number; m: number }) => b.y * 12 + (b.m - 1);
  const maxLabels = Math.max(2, Math.floor(plotW / 42));
  const STRIDES = [1, 2, 3, 6, 12, 24, 36, 60, 120, 240];
  let stride = STRIDES[STRIDES.length - 1];
  for (const s of STRIDES) {
    if (mb.filter((b) => monthsAbs(b) % s === 0).length <= maxLabels) {
      stride = s;
      break;
    }
  }
  const yearly = stride >= 12;
  let ticks = '';
  let labels = '';
  let nLabels = 0;
  for (const b of mb) {
    if (monthsAbs(b) % stride !== 0) continue;
    const tx = x(b.i).toFixed(1);
    let txt: string;
    if (yearly) txt = String(b.y);
    else txt = b.m === 1 || nLabels === 0 ? `${MONTHS[b.m - 1]} ’${String(b.y).slice(2)}` : MONTHS[b.m - 1];
    ticks += `<line x1="${tx}" y1="0" x2="${tx}" y2="${plotH}" style="stroke: var(--border)" stroke-dasharray="2,3"/>`;
    labels += `<text x="${tx}" y="${h - 2}" style="fill: var(--dim); ${HALO}" font-size="9" text-anchor="middle">${txt}</text>`;
    nLabels++;
  }

  // Axis gutter: %-return-vs-start on Y, period endpoints on X (single-year
  // periods carry no year-boundary label, so the endpoints supply the scale).
  let axisG = '';
  if (axes) {
    const pct = (v: number) => `${v / base - 1 >= 0 ? '+' : ''}${((v / base - 1) * 100).toFixed(0)}%`;
    const yLab = (y: number, t: string) =>
      `<text x="${leftPad - 4}" y="${(y + 3).toFixed(1)}" style="fill: var(--dim); ${HALO}" font-size="9" text-anchor="end">${t}</text>`;
    const gLine = (y: number) =>
      `<line x1="${x0}" y1="${y.toFixed(1)}" x2="${(w - 2).toFixed(1)}" y2="${y.toFixed(1)}" style="stroke: var(--border)" stroke-dasharray="1,3" opacity="0.6"/>`;
    axisG += gLine(yNav(max)) + yLab(yNav(max), pct(max));
    axisG += yLab(yNav(min), pct(min));
    if (base > min && base < max) axisG += gLine(yNav(base)) + yLab(yNav(base), '0%');
    axisG += yLab(ddTop + ddH - 2, `${(minDd * 100).toFixed(0)}%`); // worst drawdown
    // Exact series bounds, top-left (mirrors the return badge top-right). The
    // interior ticks land on calendar months, so the data may start/end
    // mid-month — these full ISO dates make the precise window unambiguous in
    // the zoomed view. Halo keeps them legible over the NAV line.
    axisG += `<text x="${x0}" y="11" style="fill: var(--dim); ${HALO}" font-size="10" text-anchor="start">${dates[0]} → ${dates[dates.length - 1]}</text>`;
  }

  const navPts = nav.map((v, i) => `${x(i).toFixed(1)},${yNav(v).toFixed(1)}`).join(' ');
  const ddPts = dd.map((d, i) => `${x(i).toFixed(1)},${yDd(d).toFixed(1)}`).join(' ');
  const ddArea = `${x0},${ddTop.toFixed(1)} ${ddPts} ${(w - 2).toFixed(1)},${ddTop.toFixed(1)}`;

  // Position pane: signed exposure filled green (long) above / red (short) below
  // a zero baseline, with the exposure line on top — same read as backtest.py.
  let posG = '';
  if (position) {
    const posTop = navH + 3;
    const posZero = posTop + posH / 2;
    const posMax = Math.max(1, ...position.map((p) => Math.abs(p)));
    const yPos = (p: number) => posZero - (Math.max(-posMax, Math.min(posMax, p)) / posMax) * (posH / 2 - 2);
    const area = (clamp: (p: number) => number) =>
      `${x0},${posZero.toFixed(1)} ` +
      position.map((p, i) => `${x(i).toFixed(1)},${yPos(clamp(p)).toFixed(1)}`).join(' ') +
      ` ${(w - 2).toFixed(1)},${posZero.toFixed(1)}`;
    const posLine = position.map((p, i) => `${x(i).toFixed(1)},${yPos(p).toFixed(1)}`).join(' ');
    posG =
      `<polygon points="${area((p) => Math.max(0, p))}" style="fill: var(--green)" opacity="0.30"/>` +
      `<polygon points="${area((p) => Math.min(0, p))}" style="fill: var(--red)" opacity="0.30"/>` +
      `<line x1="${x0}" y1="${posZero.toFixed(1)}" x2="${(w - 2).toFixed(1)}" y2="${posZero.toFixed(1)}" style="stroke: var(--border)" stroke-dasharray="3,3"/>` +
      `<polyline points="${posLine}" fill="none" style="stroke: var(--text)" stroke-width="1" opacity="0.7"/>` +
      `<text x="${(w - 4).toFixed(1)}" y="${(posTop + 9).toFixed(1)}" style="fill: var(--dim); ${HALO}" font-size="9" text-anchor="end">position ±${posMax.toFixed(0)}%</text>`;
    if (axes) {
      const yLabP = (y: number, t: string) =>
        `<text x="${leftPad - 4}" y="${(y + 3).toFixed(1)}" style="fill: var(--dim); ${HALO}" font-size="9" text-anchor="end">${t}</text>`;
      posG += yLabP(yPos(posMax), `+${posMax.toFixed(0)}%`) + yLabP(posZero, '0%');
    }
  }

  const total = nav[nav.length - 1] / nav[0] - 1;
  // Sharpe + CAGR round out the visible-window stats (total return + maxDD) in
  // the zoomed view; omitted at tile size where the badge has no room. CAGR is
  // calendar-time annualized over the visible span, skipped for spans under a
  // month where annualizing a handful of days is just noise.
  const sharpe = axes ? annualizedSharpe(nav) : null;
  const sharpeTxt = sharpe !== null ? ` · Sharpe ${sharpe.toFixed(2)}` : '';
  let cagrTxt = '';
  if (axes && nav[0] > 0) {
    const years = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 31_557_600_000;
    if (years > 0.08) {
      const cagr = Math.pow(nav[nav.length - 1] / nav[0], 1 / years) - 1;
      cagrTxt = ` · CAGR ${cagr >= 0 ? '+' : ''}${(cagr * 100).toFixed(0)}%`;
    }
  }
  return (
    `<svg class="spark" width="${w}" height="${h}">` +
    ticks +
    axisG +
    `<polyline points="${navPts}" fill="none" style="stroke: var(--cyan)" stroke-width="1.5"/>` +
    posG +
    `<polygon points="${ddArea}" style="fill: var(--red)" opacity="0.45"/>` +
    `<text x="${w - 4}" y="11" style="fill: var(--dim); ${HALO}" font-size="10" text-anchor="end"><tspan style="fill: ${total >= 0 ? 'var(--green)' : 'var(--red)'}" font-weight="700">${total >= 0 ? '+' : ''}${(total * 100).toFixed(0)}%</tspan>${cagrTxt} · maxDD ${(minDd * 100).toFixed(0)}%${sharpeTxt}</text>` +
    labels +
    `</svg>`
  );
}

/** Panel body for a candidate's NAV chart: chart, loading note, or honest absence. */
function navPanelHtml(ws: string, candidateId: string, w: number, h: number): string {
  const eq = equityFor(ws, candidateId);
  if (eq === undefined) return `<div class="desc" style="color: var(--dim)">loading…</div>`;
  if (eq === null)
    return `<div class="desc" style="color: var(--dim)">no NAV artifact for ${esc(candidateId)} — equity curves are saved at evaluation time, OOS-correct since the 2026-06-12 evaluator fix (earlier artifacts plotted the full backtest)</div>`;
  return navChartSvg(eq, w, h, { axes: true });
}

/** Small-multiples NAV: one mini chart per backtest period for this workspace's
 *  champion in the latest run. Each period is a distinct story — YTD 2026 and
 *  OOS are true holdouts, Long-Term the full single-pass backtest — and the
 *  curves run through the latest data (fresher than the walk-forward artifact).
 *  Curves load lazily via btEquityFor, repainting as each arrives. Empty string
 *  when the workspace has no entry in the latest backtest run. */
function navByPeriodPanel(name: string, cw: number, tag: string): string {
  const t = latestBtTable();
  if (!btLatest || !t || !btAlgoFor(name)) return '';
  const runDate = btLatest.runDate;
  const cols = cw >= 780 ? 3 : cw >= 460 ? 2 : 1;
  const gap = 10;
  const cellW = Math.max(180, Math.floor((cw - gap * (cols - 1)) / cols));
  const tiles = t.periods
    .map((p) => {
      const eq = btEquityFor(runDate, name, p);
      const body =
        eq === undefined
          ? `<div class="desc" style="color: var(--dim); height: 96px">loading…</div>`
          : eq === null
            ? `<div class="desc" style="color: var(--dim); height: 96px">no curve</div>`
            : registerNavZoom(`nav-period-${p}`, eq) +
              zoomable(
                `nav-period-${p}`,
                (w, ht, zoom) => {
                  const e2 = btEquityFor(runDate, name, p);
                  return e2 ? navChartSvg(e2, w, ht, { axes: zoom }) : '';
                },
                cellW,
                96,
              );
      return `<figure class="nav-fig" style="width:${cellW}px"><figcaption>${esc(PERIOD_LABELS[p] ?? p)}</figcaption>${body}</figure>`;
    })
    .join('');
  return `<div class="panel">
      <h3>Backtest NAV by period — run ${esc(runDate)}${tag}</h3>
      <div class="nav-grid" style="gap:${gap}px">${tiles}</div>
    </div>`;
}

/** Best-of-generation return_YYYY series, one per year column in the CSV. */
function yearSeries(r: WorkspaceRow): Series[] {
  const years = r.stats.metricColumns.filter((k) => /^return_\d{4}$/.test(k)).sort();
  return years.map((col, i) => ({
    name: col.replace('return_', ''),
    values: r.stats.generations.map((g) => g.best?.metrics[col] ?? null),
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));
}

// ── backtest join: latest run → per-workspace stats ──────────────────────────

let btLatestTable: { algos: BacktestAlgo[]; periods: string[] } | null = null;
let btLatestFor: BacktestSummary | undefined; // memo key (summary object identity)

function latestBtTable(): { algos: BacktestAlgo[]; periods: string[] } | null {
  if (btLatestFor !== btLatest) {
    btLatestFor = btLatest;
    btLatestTable = btLatest ? buildBacktestTable(btLatest.rows) : null;
  }
  return btLatestTable;
}

/** Latest-run backtest entry for a workspace (dir name == algorithm), with rank. */
// Pull the candidate id (e.g. gen756-008) out of a backtest champion label like
// "1d-fas gen756-008"; fall back to the last token for baselines/odd labels.
function candidateIdOf(algoName: string): string | null {
  const m = algoName.match(/gen\d+-\d+/i);
  if (m) return m[0];
  return algoName.trim().split(/\s+/).pop() || null;
}

// Every leader/backtest pane carries one of these so it's never ambiguous
// whether you're looking at the live champion or one scored earlier:
//   'winner'   — the current evolution leader (green)
//   'previous' — backtest-all scored an older champion than today's leader (yellow)
//   'unknown'  — no completed leader yet to compare against (neutral)
function winnerTag(state: 'winner' | 'previous' | 'unknown', tested?: string | null, leader?: string | null): string {
  if (state === 'winner')
    return `<span class="tag tag-winner" title="Shows the current evolution leader">★ current winner</span>`;
  if (state === 'previous')
    return `<span class="tag tag-prev" title="Shows ${esc(tested ?? 'an earlier champion')}, not the current leader ${esc(leader ?? '')} — re-run backtest-all to refresh">⚠ previous winner${tested ? ` · ${esc(tested)}${leader ? ` (now ${esc(leader)})` : ''}` : ''}</span>`;
  return `<span class="tag tag-unknown" title="Backtested champion — no completed evolution leader yet to compare">tested${tested ? ` ${esc(tested)}` : ''}</span>`;
}

function btAlgoFor(name: string): { algo: BacktestAlgo; rank: number } | null {
  const t = latestBtTable();
  if (!t) return null;
  const i = t.algos.findIndex((a) => a.algorithm === name);
  return i === -1 ? null : { algo: t.algos[i], rank: i + 1 };
}

// Re-reads the latest backtest-all run from sqlite. Called at startup and on
// each detail open, so a long-open app picks up new daily runs without a
// restart — but NOT on the fleet poll: switching the run out from under a
// static, open detail panel is what made its backtest charts vanish mid-run.
//
// requireAlgo (the workspace being opened) guards the other half of that bug:
// backtest-all writes a run incrementally, so the newest run can already be
// "latest" (>10 algos) while still missing this workspace. Adopting it then
// would blank the workspace's panels (btAlgoFor → null) until the run catches
// up. So when the candidate run lacks requireAlgo but the current run has it,
// keep the current (complete) run and let a later open pick up the finished one.
async function loadLatestBacktests(requireAlgo?: string): Promise<void> {
  const next = await api.backtests.summary();
  if (!next) {
    // DB momentarily unavailable (e.g. mid-write) — never clobber a good run.
    if (!btLoaded) {
      btLoaded = true;
      render();
    }
    return;
  }
  if (
    requireAlgo &&
    btLatest &&
    !next.rows.some((r) => r.algorithm === requireAlgo) &&
    btLatest.rows.some((r) => r.algorithm === requireAlgo)
  )
    return;
  if (btLoaded && next.runDate === btLatest?.runDate) return; // same run, nothing new
  btLoaded = true;
  btLatest = next;
  render();
}

// Per-period NAV series, lazily fetched and cached (a run's curves never
// change after the run); null (no curve in the DB) is cached too.
const btEquityCache = new Map<string, Equity | null>();
const btEquityPending = new Set<string>();
const btExpanded = new Set<string>(); // `${algorithm}|${period}` chart toggles

function btEquityFor(runDate: string, algo: string, period: string): Equity | null | undefined {
  const key = `${runDate}|${algo}|${period}`;
  if (btEquityCache.has(key)) return btEquityCache.get(key);
  if (!btEquityPending.has(key)) {
    btEquityPending.add(key);
    void api.backtests
      .equity(runDate, algo, period)
      .then((d) => {
        btEquityCache.set(key, d);
        btEquityPending.delete(key);
        render();
      })
      .catch(() => btEquityPending.delete(key));
  }
  return undefined;
}

// Buy & hold benchmarks per workspace, lazily fetched and cached (prices change
// at most daily; a re-poll never invalidates them mid-view). null = no price
// data / not a single-symbol trading workspace; undefined = still loading.
const benchmarkCache = new Map<string, Benchmark | null>();
const benchmarkPending = new Set<string>();

function benchmarkFor(name: string): Benchmark | null | undefined {
  if (benchmarkCache.has(name)) return benchmarkCache.get(name);
  if (!benchmarkPending.has(name)) {
    benchmarkPending.add(name);
    void api.workspace
      .benchmark(name)
      .then((d) => {
        benchmarkCache.set(name, d);
        benchmarkPending.delete(name);
        render();
      })
      .catch(() => benchmarkPending.delete(name));
  }
  return undefined;
}

const BT_NUM = (v: number | null, digits: number, suffix = ''): string =>
  v === null || v === undefined ? '—' : `${v.toFixed(digits)}${suffix}`;

// Buy&hold / total-return cell: signed percent with pos/neg colour.
const BT_PCT = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? '<td class="num">—</td>'
    : `<td class="num ${v >= 0 ? 'pos' : 'neg'}">${(v * 100).toFixed(1)}%</td>`;

/** Per-period results table for one algorithm; rows with data toggle their
 *  period's NAV chart. Shared by the backtests view and the detail panel.
 *  Passing `returns` (detail panel only) appends buy&hold CAGR for SPY and for
 *  the traded instrument — annualized to sit in the same units as the CAGR
 *  column, the "did it beat just holding?" check against the strategy's CAGR. */
function btPeriodTableHtml(
  a: BacktestAlgo,
  periods: string[],
  runDate: string,
  chartW: number,
  returns?: { bh: Benchmark | null | undefined },
): string {
  const sym = returns?.bh?.symbol ?? 'ETF';
  const cols = 7 + (returns ? 2 : 0);
  const retHead = returns
    ? `<th class="num" title="Buy &amp; hold SPY over the same window, annualized (CAGR) — directly comparable to the strategy CAGR column">SPY B&H</th>` +
      `<th class="num" title="Buy &amp; hold ${esc(sym)} over the same window, annualized (CAGR) — directly comparable to the strategy CAGR column">${esc(sym)} B&H</th>`
    : '';
  const head =
    `<tr><th>Period</th><th class="num">CAGR</th><th class="num">Pain</th>` +
    `<th class="num">AA/P</th><th class="num">Sharpe</th><th>Risk</th><th class="num">Turnover</th>${retHead}</tr>`;
  const retCells = (p: string): string => {
    if (!returns) return '';
    const bp = returns.bh?.periods[p];
    return BT_PCT(bp?.spy) + BT_PCT(bp?.instrument);
  };
  const body = periods
    .map((p) => {
      const r = a.periods[p];
      const label = esc(PERIOD_LABELS[p] ?? p);
      if (!r)
        return `<tr><td>${label}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td>N/A</td><td class="num">—</td>${retCells(p)}</tr>`;
      const expanded = btExpanded.has(`${a.algorithm}|${p}`);
      const cagr = r.cagr === null ? null : r.cagr * 100;
      const badRisk = r.achieved_risk === 'bad' || r.achieved_risk === 'ERROR';
      const row = `<tr class="bt-row" data-bt-algo="${esc(a.algorithm)}" data-bt-period="${esc(p)}" title="Toggle the period's NAV chart">
        <td><span class="caret">${expanded ? '▾' : '▸'}</span> ${label}</td>
        <td class="num ${cagr !== null ? (cagr >= 0 ? 'pos' : 'neg') : ''}">${BT_NUM(cagr, 1, '%')}</td>
        <td class="num">${BT_NUM(r.pain, 1)}</td>
        <td class="num ${r.aa_pain !== null ? (r.aa_pain >= 0 ? 'pos' : 'neg') : ''}">${BT_NUM(r.aa_pain, 1)}</td>
        <td class="num">${BT_NUM(r.sharpe, 2)}</td>
        <td class="${badRisk ? 'risk-bad' : ''}">${esc(r.achieved_risk ?? '—')}</td>
        <td class="num">${BT_NUM(r.turnover, 1, 'x')}</td>
        ${retCells(p)}
      </tr>`;
      const chart = expanded
        ? `<tr class="bt-chart"><td colspan="${cols}">${zoomable(
            `bt-${a.algorithm}-${p}`,
            (w, h) => {
              const eq = btEquityFor(runDate, a.algorithm, p);
              if (eq === undefined)
                return `<div class="desc" style="color: var(--dim)">loading…</div>`;
              if (eq === null)
                return `<div class="desc" style="color: var(--dim)">no NAV series for this run — backtest-all saves per-period curves since the 2026-06-11 update</div>`;
              return navChartSvg(eq, w, h, { axes: true });
            },
            chartW,
            165,
          )}</td></tr>`
        : '';
      return row + chart;
    })
    .join('');
  return `<table>${head}${body}</table>`;
}

// One delegated handler covers period-row toggles in both hosting views.
function btToggleClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest('[data-bt-algo]') as HTMLElement | null;
  if (!el) return;
  const key = `${el.dataset.btAlgo}|${el.dataset.btPeriod}`;
  if (btExpanded.has(key)) btExpanded.delete(key);
  else btExpanded.add(key);
  render();
}

// ── sorting ──────────────────────────────────────────────────────────────────

const ACTIVITY_RANK: Record<string, number> = { stuck: 4, asking: 3, waiting: 2, working: 1 };
const HEALTH_RANK: Record<Health['level'], number> = { error: 4, failing: 3, stale: 2, plateau: 1, good: 0 };

const SORTS: Record<string, (r: WorkspaceRow) => number | string | null> = {
  name: (r) => r.name.toLowerCase(),
  score: (r) => r.stats.leader?.performance ?? null,
  updated: (r) => r.csvMtimeMs,
  state: (r) => (r.session.running ? ACTIVITY_RANK[r.session.activity ?? 'working'] : 0),
  gens: (r) => r.stats.gensSinceTop,
  rate: (r) => r.stats.recentSuccessRate,
  health: (r) => HEALTH_RANK[healthOf(r).level],
};

// Case-insensitive substring match over name + leader id + leader description.
function matchesSearch(r: WorkspaceRow): boolean {
  if (!searchQuery) return true;
  const hay = `${r.name} ${r.stats.leader?.id ?? ''} ${r.stats.leader?.description ?? ''}`.toLowerCase();
  return hay.includes(searchQuery);
}

// Resolve a sort-column id to its comparator. Winner columns sort on the
// leader's value for an evaluator metric, addressed as `metric:<col>`.
function sortKey(col: string): (r: WorkspaceRow) => number | string | null {
  if (col.startsWith('metric:')) {
    const m = col.slice('metric:'.length);
    return (r) => r.stats.leader?.metrics[m] ?? null;
  }
  return SORTS[col] ?? SORTS.score;
}

function sorted(): WorkspaceRow[] {
  const key = sortKey(prefs.sortCol);
  const dir = prefs.sortDesc ? -1 : 1;
  // Starred first, missing values last regardless of direction.
  return [...rows].filter(matchesSearch).sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    const va = key(a);
    const vb = key(b);
    if (va === null && vb === null) return a.name.localeCompare(b.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.name.localeCompare(b.name);
  });
}

async function setSort(col: string): Promise<void> {
  // Same column again flips direction; new column starts at its natural
  // direction (name ascending, everything else best/worst-first descending).
  const sortDesc = prefs.sortCol === col ? !prefs.sortDesc : col !== 'name';
  prefs = await api.prefs.set({ sortCol: col, sortDesc });
  syncHeaderControls();
  render();
}

// ── shared row bits ──────────────────────────────────────────────────────────

// sessId enables the 'stuck' badge to act as an unstick button (sends Esc +
// "continue please" + Enter to that tmux session). Omit it for read-only badges.
function sessBadge(s: SessionState, sessId?: string): string {
  if (!s.running) return `<span class="badge stopped">stopped</span>`;
  const a = s.activity ?? 'working';
  if (a === 'stuck' && sessId) {
    return `<button class="badge stuck" data-unstick="${esc(sessId)}" title="Nudge it: sends Esc + 'continue please' + Enter to the session">⚠ unstick</button>`;
  }
  const label = a === 'asking' ? '❓ asking' : a === 'stuck' ? '⚠ stuck' : a;
  return `<span class="badge ${a}">${label}</span>`;
}

function badge(r: WorkspaceRow): string {
  return sessBadge(r.session, sessionName(r.name));
}

// Evolution / adhoc action buttons, shared by list and grid. No Attach button —
// open the workspace (click the row) to attach in the detail view.
function evoButtons(r: WorkspaceRow): string {
  const n = esc(r.name);
  return r.session.running
    ? `<button data-act="evo-stop" data-name="${n}" class="danger" title="Stop evolution">⏹ Stop</button>`
    : `<button data-act="evo-start" data-name="${n}" class="primary" title="Start the /evolve loop">▶ Evolve</button>`;
}

function adhocButtons(r: WorkspaceRow): string {
  const n = esc(r.name);
  return r.adhoc.running
    ? `<button data-act="adhoc-stop" data-name="${n}" class="danger" title="Stop the adhoc claude session">⏹ Stop</button>`
    : `<button data-act="adhoc-start" data-name="${n}" title="Launch a plain claude in this workspace (no /evolve)">▶ Adhoc</button>`;
}

function renderTotals(): void {
  const running = rows.filter((r) => r.session.running).length;
  const asking = rows.filter((r) => r.session.activity === 'asking').length;
  const stuck = rows.filter((r) => r.session.activity === 'stuck').length;
  const counts: Record<string, number> = {};
  for (const r of rows) counts[healthOf(r).level] = (counts[healthOf(r).level] ?? 0) + 1;
  const parts = [`<b>${rows.length}</b> workspaces`, `<b>${running}</b> running`];
  if (stuck) parts.push(`<span class="t-red"><b>${stuck}</b> stuck</span>`);
  if (asking) parts.push(`<span class="t-magenta"><b>${asking}</b> asking</span>`);
  for (const [level, cls] of [
    ['error', 't-red'],
    ['failing', 't-red'],
    ['stale', 't-yellow'],
    ['plateau', 't-yellow'],
  ] as const) {
    if (counts[level]) parts.push(`<span class="${cls}"><b>${counts[level]}</b> ${level}</span>`);
  }
  $('totals').innerHTML = parts.join(' · ');
}

// ── host load gauges (header) ────────────────────────────────────────────────
// Fed by the main process on the system:update channel (own cadence, separate
// from the fleet poll) so the gauges tick without re-rendering the grid.
interface SysSample {
  cpu: number;
  load: number;
  loadRaw: number;
  mem: number;
  cores: number;
}
const SYS_HISTORY = 90;
const sysCpu: number[] = [];
const sysLoad: number[] = []; // core-normalised (1.0 = fully loaded)
const sysMem: number[] = [];
let sysCores = 0;

function pushSys(s: SysSample): void {
  sysCores = s.cores;
  for (const [buf, v] of [
    [sysCpu, s.cpu],
    [sysLoad, s.load],
    [sysMem, s.mem],
  ] as const) {
    buf.push(v);
    if (buf.length > SYS_HISTORY) buf.shift();
  }
  renderSysCharts();
}

// Fixed 0..max scale (metrics read honestly against an absolute ceiling rather
// than auto-zooming to their own range, the way sparklineSvg does).
function gaugeSpark(values: number[], w: number, h: number, color: string, max: number): string {
  if (values.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    const y = h - 2 - (Math.max(0, Math.min(max, v)) / max) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    `<svg class="spark" width="${w}" height="${h}">` +
    `<polyline points="${pts.join(' ')}" fill="none" style="stroke:${color}" stroke-width="1.5"/></svg>`
  );
}

function sysColor(v: number, warn: number, bad: number): string {
  return v >= bad ? 'var(--red)' : v >= warn ? 'var(--yellow)' : 'var(--green)';
}

function renderSysCharts(): void {
  const el = document.getElementById('sys-metrics');
  if (!el) return;
  const cpu = sysCpu.at(-1) ?? 0;
  const load = sysLoad.at(-1) ?? 0;
  const mem = sysMem.at(-1) ?? 0;
  const loadRaw = load * (sysCores || 1);
  const metrics = [
    {
      label: 'CPU',
      buf: sysCpu,
      color: sysColor(cpu, 0.6, 0.85),
      max: 1,
      val: `${Math.round(cpu * 100)}%`,
      title: `CPU busy across ${sysCores} cores`,
    },
    {
      label: 'LOAD',
      buf: sysLoad,
      color: sysColor(load, 0.7, 1),
      max: 1.5,
      val: loadRaw.toFixed(2),
      title: `1-min load average ${loadRaw.toFixed(2)} over ${sysCores} cores`,
    },
    {
      label: 'MEM',
      buf: sysMem,
      color: sysColor(mem, 0.7, 0.9),
      max: 1,
      val: `${Math.round(mem * 100)}%`,
      title: 'Used memory',
    },
  ];
  el.innerHTML = metrics
    .map(
      (m) =>
        `<span class="sys-metric" title="${esc(m.title)}"><span class="sl">${m.label}</span>` +
        `${gaugeSpark(m.buf, 54, 18, m.color, m.max)}` +
        `<span class="sv" style="color:${m.color}">${m.val}</span></span>`,
    )
    .join('');
}

// The header is two rows and its height shifts (tool buttons appear after the
// first poll, the window resizes). Sticky offsets below it read --header-h.
function syncHeaderHeight(): void {
  const h = document.querySelector('header');
  if (h) document.documentElement.style.setProperty('--header-h', `${h.offsetHeight}px`);
}

function ensureSelection(order: WorkspaceRow[]): void {
  if (order.length === 0) {
    selectedName = null;
    return;
  }
  if (!selectedName || !order.some((r) => r.name === selectedName)) selectedName = order[0].name;
}

// ── fleet: list view ─────────────────────────────────────────────────────────

// The configurable winner-info columns (right of Score) are inserted live from
// prefs.winnerCols — non-blank slots only — so the header and cells stay aligned.
function activeWinnerCols(): string[] {
  return (prefs.winnerCols ?? []).filter(Boolean);
}

// Union of evaluator metric columns across the fleet — the choices offered in
// the config dialog's winner-column dropdowns.
function availableMetricCols(): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const col of r.stats.metricColumns) set.add(col);
  return [...set].sort();
}

// One winner-column cell: the leader's value for that evaluator column.
function winnerCell(r: WorkspaceRow, col: string): string {
  const val = r.stats.leader?.metrics[col];
  if (val === undefined) return '<td class="num">—</td>';
  const f = fmtMetric(col, val);
  return `<td class="num ${f.cls}">${f.v}</td>`;
}

function listCols(): Array<{ label: string; sort?: string; cls?: string }> {
  return [
    { label: '★' },
    { label: 'Name', sort: 'name' },
    { label: 'State', sort: 'state' },
    { label: 'Health', sort: 'health' },
    { label: 'Winner' },
    { label: 'Score', sort: 'score', cls: 'num' },
    ...activeWinnerCols().map((col) => ({ label: col, sort: `metric:${col}`, cls: 'num' })),
    { label: 'Gens▲', sort: 'gens', cls: 'num' },
    { label: '5gOK%', sort: 'rate', cls: 'num' },
    { label: 'Updated', sort: 'updated', cls: 'num' },
    { label: 'Score Trend' },
    { label: 'Evolution' },
    { label: 'Adhoc' },
  ];
}

function renderList(order: WorkspaceRow[]): void {
  if (order.length === 0 && searchQuery) {
    $('list').innerHTML = `<div class="empty">No workspaces match “${esc(searchQuery)}”.</div>`;
    return;
  }
  const winnerCols = activeWinnerCols();
  const head = listCols().map((c) => {
    const arrow = c.sort && prefs.sortCol === c.sort ? (prefs.sortDesc ? ' ▼' : ' ▲') : '';
    const attrs = c.sort ? ` data-sort="${c.sort}" title="Sort by ${esc(c.label)}"` : '';
    return `<th class="${c.cls ?? ''}"${attrs}>${esc(c.label)}${arrow}</th>`;
  }).join('');

  const body = order
    .map((r) => {
      const s = r.stats;
      const h = healthOf(r);
      const age = fmtAge(r.csvMtimeMs);
      const gens = s.gensSinceTop;
      const rate = s.recentSuccessRate;
      const n = esc(r.name);
      return `<tr class="row ${r.name === selectedName ? 'selected' : ''}" data-name="${n}">
        <td><span class="star ${r.starred ? 'on' : ''}" data-star="${n}" title="Pin to top">${r.starred ? '★' : '☆'}</span></td>
        <td class="name" title="${esc(r.path)}">${n}</td>
        <td>${badge(r)}</td>
        <td>${healthChip(h)}</td>
        <td class="winner">${s.error ? `<span class="warn">${esc(s.error)}</span>` : esc(s.leader?.id ?? '—')}</td>
        <td class="num score">${fmtScore(s.leader?.performance ?? null)}</td>
        ${winnerCols.map((col) => winnerCell(r, col)).join('')}
        <td class="num ${gens !== null && gens > PLATEAU_GENS ? 'warn' : ''}" title="Generations since the leader">${gens ?? '—'}</td>
        <td class="num ${s.recentFails > FAILING_FAILS ? 'warn' : rate !== null ? 'pos' : ''}" title="Success rate, last 5 gens (${s.recentFails} fails in last 2)">${rate === null ? '--' : `${Math.round(rate * 100)}%`}</td>
        <td class="num ${age.stale ? 'stale' : ''}">${age.text}</td>
        <td>${sparklineSvg(s.sparkline, 120, 20, HEALTH_COLOR[h.level])}</td>
        <td><div class="actions">${evoButtons(r)}</div></td>
        <td><div class="actions">${adhocButtons(r)}</div></td>
      </tr>`;
    })
    .join('');

  $('list').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ── fleet: grid view ─────────────────────────────────────────────────────────

function renderGridCards(order: WorkspaceRow[]): void {
  if (order.length === 0) {
    $('grid').innerHTML = searchQuery
      ? `<div class="empty">No workspaces match “${esc(searchQuery)}”.</div>`
      : `<div class="empty">No evolution workspaces found.<br>Configure roots (⚙) to point at directories containing claude-evolve workspaces.</div>`;
    return;
  }
  $('grid').innerHTML = order
    .map((r) => {
      const s = r.stats;
      const h = healthOf(r);
      const leader = s.leader;
      const age = fmtAge(r.csvMtimeMs);
      const metrics = leader
        ? headlineMetrics(leader)
            .map((m) => `<span class="metric"><span class="k">${esc(m.k)}</span><span class="v ${m.cls}">${esc(m.v)}</span></span>`)
            .join('')
        : '';
      const rate = s.recentSuccessRate;
      const gens = s.gensSinceTop;
      const c = s.counts;
      const act = r.session.activity;
      const cls = [
        act === 'asking' ? 'asking' : act === 'stuck' ? 'stuck' : '',
        r.name === selectedName ? 'selected' : '',
      ].join(' ');
      return `
      <div class="card ${cls}" data-name="${esc(r.name)}">
        <div class="title-row">
          <span class="star ${r.starred ? 'on' : ''}" data-star="${esc(r.name)}" title="Pin to top">${r.starred ? '★' : '☆'}</span>
          <span class="name" title="${esc(r.path)}">${esc(r.name)}</span>
          <span style="flex:1"></span>
          ${badge(r)}
          ${healthChip(h)}
        </div>
        ${
          s.error
            ? `<div class="desc" style="color: var(--red)">${esc(s.error)}</div>`
            : leader
              ? `<div class="leader">${esc(leader.id)} · <span class="score">${fmtScore(leader.performance)}</span></div>
                 <div class="desc" title="${esc(leader.description)}">${esc(leader.description)}</div>`
              : `<div class="desc">no completed candidates yet</div>`
        }
        <div class="metrics">${metrics}</div>
        ${sparklineSvg(s.sparkline, 300, 34, HEALTH_COLOR[h.level])}
        <div class="foot">
          <span>gen${String(s.latestGen).padStart(3, '0')}</span>
          <span class="${gens !== null && gens > PLATEAU_GENS ? 'warn' : ''}" title="Generations since the leader">▲${gens ?? '–'}</span>
          <span class="${s.recentFails > FAILING_FAILS ? 'warn' : ''}" title="Success rate, last 5 gens (${s.recentFails} fails in last 2)">ok ${rate === null ? '--' : `${Math.round(rate * 100)}%`}</span>
          <span title="pending/complete/failed/running">P${c.pending} C${c.complete} F${c.failed} R${c.running}</span>
          <span style="flex:1"></span>
          <span class="${age.stale ? 'stale' : ''}">${age.text}</span>
        </div>
        <div class="actions">
          <span class="act-grp"><span class="act-lbl">evo</span>${evoButtons(r)}</span>
          <span class="act-grp"><span class="act-lbl">adhoc</span>${adhocButtons(r)}</span>
        </div>
      </div>`;
    })
    .join('');
}

// ── peek popover (Space) ─────────────────────────────────────────────────────

function renderPeek(): void {
  const peek = $('peek');
  const r = peekFor ? rows.find((x) => x.name === peekFor) : undefined;
  if (!r) {
    peek.style.display = 'none';
    return;
  }
  const s = r.stats;
  const h = healthOf(r);
  const leader = s.leader;
  const age = fmtAge(r.csvMtimeMs);
  peek.style.display = 'block';
  peek.innerHTML = `
    <h3>${esc(r.name)} ${badge(r)} ${healthChip(h)}</h3>
    ${
      leader
        ? `<div class="sub">${esc(leader.id)} · <span class="score">${fmtScore(leader.performance)}</span></div>`
        : `<div class="sub">no completed candidates yet</div>`
    }
    ${
      leader
        ? `<h4>Leader ratios</h4>
           <div class="metric-grid">${ratioMetrics(leader, r.profile)
             .map((m) => `<span class="metric"><span class="k">${esc(m.k)}</span><span class="v ${m.cls}">${esc(m.v)}</span></span>`)
             .join('')}</div>
           <h4>NAV over time (out-of-sample)</h4>
           ${navPanelHtml(r.name, leader.id, 404, 100)}
           <h4>Returns by year</h4>
           ${yearBarsHtml(yearReturns(leader))}`
        : ''
    }
    <h4>Best score by generation</h4>
    ${sparklineSvg(s.sparkline, 404, 44, HEALTH_COLOR[h.level])}
    <h4>Run</h4>
    <div class="metric-grid">
      ${
        (() => {
          const bt = btAlgoFor(r.name);
          return bt
            ? `<span class="metric" title="Backtest aggregate score, latest run (#${bt.rank})"><span class="k">BT score</span><span class="v">${bt.algo.score.toFixed(2)}</span></span>
               <span class="metric"><span class="k">BT qual</span><span class="v">${bt.algo.qualPct === null ? '—' : `${bt.algo.qualPct}%`}</span></span>`
            : '';
        })()
      }
      <span class="metric"><span class="k">Latest gen</span><span class="v">${s.latestGen}</span></span>
      <span class="metric"><span class="k">Gens since top</span><span class="v ${s.gensSinceTop !== null && s.gensSinceTop > PLATEAU_GENS ? 'warn' : ''}">${s.gensSinceTop ?? '—'}</span></span>
      <span class="metric"><span class="k">5g success</span><span class="v ${s.recentFails > FAILING_FAILS ? 'warn' : ''}">${s.recentSuccessRate === null ? '--' : `${Math.round(s.recentSuccessRate * 100)}%`}</span></span>
      <span class="metric" title="Failures in the last 2 generations"><span class="k">2g fails</span><span class="v ${s.recentFails > FAILING_FAILS ? 'warn' : ''}">${s.recentFails}</span></span>
      <span class="metric"><span class="k">P/C/F/R</span><span class="v">${s.counts.pending}/${s.counts.complete}/${s.counts.failed}/${s.counts.running}</span></span>
      <span class="metric"><span class="k">Updated</span><span class="v ${age.stale ? 'stale' : ''}">${age.text}</span></span>
    </div>`;
}

function togglePeek(): void {
  peekFor = peekFor === selectedName ? null : selectedName;
  renderPeek();
}

// ── render dispatcher ────────────────────────────────────────────────────────

function render(): void {
  const isDetail = view !== null;
  const isTool = toolView !== null;
  const isFleet = !isDetail && !isTool;
  $('list').style.display = isFleet && viewMode === 'list' ? 'block' : 'none';
  $('grid').style.display = isFleet && viewMode === 'grid' ? 'grid' : 'none';
  $('detail').style.display = isDetail ? 'block' : 'none';
  $('tool').style.display = isTool ? 'block' : 'none';
  renderTotals();
  renderToolButtons();
  renderHints();
  if (!isFleet) {
    peekFor = null;
    renderPeek();
    if (isDetail) renderDetail();
    else renderTool();
    return;
  }
  const order = sorted();
  ensureSelection(order);
  if (viewMode === 'list') renderList(order);
  else renderGridCards(order);
  if (peekFor !== null) {
    peekFor = selectedName;
    renderPeek();
  }
}

function renderHints(): void {
  $('hints').innerHTML =
    view || toolView
      ? `<b>esc</b> back · <b>⌘esc</b> back (even from terminal) · <b>⏎/a</b> focus terminal${view ? ' · <b>s</b> start/stop' : ''} · click a chart to enlarge · click terminal to type · wheel scrolls the session`
      : `<b>↑↓ j k</b> select · <b>⏎</b> open + attach · <b>space</b> peek stats · <b>v</b> ${viewMode === 'list' ? 'grid' : 'list'} · <b>s</b> start/stop · <b>*</b> star`;
}

// ── detail view ──────────────────────────────────────────────────────────────

// Live attached terminals, keyed by full tmux session id (evolve-… / adhoc-… /
// greenhouse-…). The detail view runs two at once (evolution + adhoc), the tool
// page one — so the old single-terminal globals are now a map, one entry per
// attached session. Each entry's .term-wrap DOM node must survive fleet-push
// re-renders (moving a focused node blurs it); only attach/teardown touch slots.
interface TermSession {
  sessId: string;
  term: Terminal;
  fit: FitAddon;
  port: MessagePort | null;
  wrap: HTMLElement;
  ro: ResizeObserver;
}
const terms = new Map<string, TermSession>();

function teardownTerminal(sessId: string): void {
  const ts = terms.get(sessId);
  if (!ts) return;
  terms.delete(sessId);
  void api.session.detach(sessId);
  ts.ro.disconnect();
  ts.port?.close();
  ts.term.dispose();
  ts.wrap.remove(); // never leave a stale .term-wrap behind in another view
}

function teardownAllTerminals(): void {
  for (const sessId of [...terms.keys()]) teardownTerminal(sessId);
}

/** Focus the primary terminal of the current view: evolution first, then adhoc
 *  (detail), or the tool terminal. Returns whether one was focused. */
function focusPrimaryTerm(): boolean {
  const order = view
    ? [sessionName(view), adhocSessionName(view)]
    : toolView
      ? [toolSessionName(toolView)]
      : [];
  for (const id of order) {
    const ts = terms.get(id);
    if (ts) {
      ts.term.focus();
      return true;
    }
  }
  return false;
}

function openDetail(name: string, focusTerm = false): void {
  view = name;
  selectedName = name;
  teardownAllTerminals();
  render(); // renderDetail attaches running sessions (unfocused) as part of rendering
  // Re-read the latest backtest-all run from sqlite on each open: btLatest is
  // otherwise fetched once at startup, so a run that finished after launch
  // wouldn't show until restart. Pass the workspace so an in-progress run that
  // hasn't reached it yet can't blank its panels. The runDate-keyed curve caches
  // self-invalidate when the run changes, so refreshing this pointer is enough.
  void loadLatestBacktests(name);
  window.scrollTo(0, 0); // the page scroll position carries over from the fleet list otherwise
  // Focus only on explicit intent (open+attach / 'a'), so stray keys can't reach claude.
  if (focusTerm) focusPrimaryTerm();
}

function closeDetail(): void {
  view = null;
  detailBuiltFor = null;
  teardownAllTerminals();
  render();
}

// AIDEV-NOTE: the detail skeleton is built ONCE per workspace and only the
// bar / stats column / session control rows are refreshed on each 5s fleet
// push. The session panels (and the .term-wrap nodes inside their slots) must
// never be rebuilt, replaced, or re-appended — moving a focused DOM node blurs
// it, which used to kick the user out of the terminal mid-keystroke every poll.
let detailBuiltFor: string | null = null;

/** Inner content width of a panel filling the given column, for fluid charts —
 *  panels add 14px padding + 1px border each side. Falls back when the column
 *  isn't laid out yet (first paint before the display:block reflow). */
function panelInnerW(colId: string, fallback: number): number {
  const w = document.getElementById(colId)?.clientWidth ?? 0;
  return w > 60 ? w - 30 : fallback;
}

// ── click-to-enlarge charts ──────────────────────────────────────────────────
// Each chart wrapped by zoomable() registers a renderer keyed by a stable id;
// the overlay calls it again at a larger size for a crisp (not CSS-scaled)
// repaint. The map is rebuilt every render of the hosting view, so ids stay
// fresh; an open overlay holds its own renderer closure (zoomRender) and is
// unaffected by the rebuild.
// render(w, h, zoom): zoom is true only in the enlarged overlay, so a chart can
// add a labeled Y-axis gutter (and other chrome) that wouldn't fit in the tile.
type ChartRender = (w: number, h: number, zoom?: boolean) => string;
const chartRenderers = new Map<string, ChartRender>();
let zoomRender: ChartRender | null = null;

// NAV charts (walk-forward leader + per-period) get a richer zoom than the
// static re-render: an interactive viewer that pans/zooms a time window and
// rescales live. The underlying Equity for each is registered here by id (same
// lifecycle as chartRenderers — cleared and rebuilt every detail render); a
// clicked id present here opens the interactive viewer instead of openZoom.
const navZoomData = new Map<string, Equity>();
// Open interactive NAV viewer state; null when the overlay isn't a NAV zoom. An
// open viewer holds its own eq copy, so a background re-render can clear the map
// without disturbing it (mirrors zoomRender). i0..i1 is the visible index window.
let navZoom: { eq: Equity; i0: number; i1: number } | null = null;
const NAV_ZOOM_MIN = 8; // smallest visible window (points) — keeps the chart legible

function zoomable(id: string, render: ChartRender, w: number, h: number): string {
  chartRenderers.set(id, render);
  return `<div class="chart-zoom" data-chart="${esc(id)}" title="Click to enlarge">${render(w, h)}</div>`;
}

/** Register a chart id's Equity for the interactive viewer (no-op when the curve
 *  hasn't loaded yet). Returns '' so it composes inline in template strings. */
function registerNavZoom(id: string, eq: Equity | null | undefined): string {
  if (eq) navZoomData.set(id, eq);
  return '';
}

function zoomDims(): { w: number; h: number } {
  const w = Math.min(window.innerWidth - 120, 1200);
  const h = Math.min(window.innerHeight - 160, Math.max(360, Math.round(w * 0.5)));
  return { w, h };
}

function chartZoomOpen(): boolean {
  return zoomRender !== null || navZoom !== null;
}

function openZoom(render: ChartRender): void {
  const { w, h } = zoomDims();
  const html = render(w, h, true);
  if (!/<svg/.test(html)) return; // nothing to enlarge yet (loading / no data)
  zoomRender = render;
  const ov = $('chart-zoom-overlay');
  ov.innerHTML = `<div class="zoom-box">${html}</div>`;
  ov.classList.add('open');
}

function closeZoom(): void {
  zoomRender = null;
  navZoom = null;
  const ov = $('chart-zoom-overlay');
  ov.classList.remove('open');
  ov.innerHTML = '';
}

// Delegated on #detail and #bt: a NAV chart opens the interactive viewer; any
// other chart falls back to the static enlarge.
function chartZoomClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest('.chart-zoom') as HTMLElement | null;
  if (!el) return;
  const id = el.dataset.chart ?? '';
  const eq = navZoomData.get(id);
  if (eq) {
    openNavZoom(eq);
    return;
  }
  const render = chartRenderers.get(id);
  if (render) openZoom(render);
}

// ── interactive NAV viewer ────────────────────────────────────────────────────
// Pan (drag / shift+wheel) and zoom (wheel / ± buttons) a time window over the
// full series; the slice re-renders through navChartSvg, so Y autoscales and the
// return / maxDD / Sharpe badge all reflect the visible window. The control bar
// is built once; only the plot slice repaints on interaction.
function openNavZoom(eq: Equity): void {
  if (eq.nav.length < 2) return;
  navZoom = { eq, i0: 0, i1: eq.nav.length - 1 };
  const ov = $('chart-zoom-overlay');
  ov.innerHTML = `<div class="zoom-box nav-zoom">
      <div class="nav-zoom-ctl">
        <button data-nz="out" title="Zoom out">−</button>
        <button data-nz="in" title="Zoom in">+</button>
        <button data-nz="reset" title="Show full range">reset</button>
        <span class="nav-zoom-hint">drag to pan · wheel to zoom · shift-wheel to pan</span>
      </div>
      <div class="nav-zoom-plot" id="nav-zoom-plot"></div>
    </div>`;
  ov.classList.add('open');
  updateNavZoomPlot();
}

function updateNavZoomPlot(): void {
  if (!navZoom) return;
  const plot = document.getElementById('nav-zoom-plot');
  if (!plot) return;
  const { w, h } = zoomDims();
  // Reserve the control-bar height so the chart fits the overlay without scroll.
  const svg = navChartSvg(sliceEquity(navZoom.eq, navZoom.i0, navZoom.i1), w, h - 34, { axes: true });
  plot.innerHTML = svg;
}

/** Rescale the window by `factor` (<1 zoom in, >1 out) about `focusFrac` (0..1
 *  of the current window) — keeps the focused point under the cursor fixed. */
function navZoomScale(focusFrac: number, factor: number): void {
  if (!navZoom) return;
  const n = navZoom.eq.nav.length;
  const len = navZoom.i1 - navZoom.i0;
  const focus = navZoom.i0 + focusFrac * len;
  let newLen = Math.round(len * factor);
  newLen = Math.max(NAV_ZOOM_MIN, Math.min(n - 1, newLen));
  let i0 = Math.round(focus - focusFrac * newLen);
  i0 = Math.max(0, Math.min(n - 1 - newLen, i0));
  navZoom.i0 = i0;
  navZoom.i1 = i0 + newLen;
  updateNavZoomPlot();
}

/** Shift the window by `frac` of its width (sign = direction), clamped to data. */
function navZoomPan(frac: number): void {
  if (!navZoom) return;
  const n = navZoom.eq.nav.length;
  const len = navZoom.i1 - navZoom.i0;
  let i0 = Math.round(navZoom.i0 + frac * len);
  i0 = Math.max(0, Math.min(n - 1 - len, i0));
  navZoom.i0 = i0;
  navZoom.i1 = i0 + len;
  updateNavZoomPlot();
}

function navZoomReset(): void {
  if (!navZoom) return;
  navZoom.i0 = 0;
  navZoom.i1 = navZoom.eq.nav.length - 1;
  updateNavZoomPlot();
}

function renderDetail(): void {
  const r = rows.find((x) => x.name === view);
  const detail = $('detail');
  if (!r) {
    detail.innerHTML = `<div class="empty">workspace gone</div>`;
    detailBuiltFor = null;
    return;
  }

  if (detailBuiltFor !== r.name) {
    detail.innerHTML = `
      <div class="bar" id="d-bar"></div>
      <div class="cols">
        <div class="left" id="d-left"></div>
        <div class="right">
          <div class="panel">
            <h3>Evolution session</h3>
            <div id="evo-term-slot"></div>
            <div id="evo-term-ctl" class="term-ctl"></div>
          </div>
          <div class="panel">
            <h3>Adhoc session</h3>
            <div id="adhoc-term-slot"></div>
            <div id="adhoc-term-ctl" class="term-ctl"></div>
          </div>
        </div>
      </div>`;
    detailBuiltFor = r.name;
  }

  // Charts fill the live column width (the user may run any window size); the
  // panel wrapper trims 30px of padding/border. Re-measured every render and on
  // window resize, so they reflow instead of sitting at a baked-in width.
  const cw = panelInnerW('d-left', 540);
  chartRenderers.clear(); // rebuilt below as the detail charts re-register
  navZoomData.clear(); // NAV viewer data re-registers with the charts

  const s = r.stats;
  const h = healthOf(r);
  const leader = s.leader;
  const years = yearSeries(r);
  // Generation numbers behind each chart's X positions, so the enlarged view
  // labels a real "gen N" axis. sparkline drops gens with no best (matching
  // csv.ts); yearSeries spans every generation (best?.metric ?? null).
  const sparkGens = s.generations.filter((g) => g.best !== null).map((g) => g.gen);
  const yearGens = s.generations.map((g) => g.gen);
  // Enough data to draw? Mirrors multiLineSvg's own emptiness guard so we can
  // decide whether to show the panel without rendering a throwaway SVG.
  const yearVals = years.flatMap((sr) => sr.values.filter((v): v is number => v !== null));
  const yearN = years.length ? Math.max(...years.map((sr) => sr.values.length)) : 0;
  const hasYearChart = yearVals.length >= 2 && yearN >= 2;
  const bt = btAlgoFor(r.name);
  const btFlag = btLatest?.appendix.find((x) => x.algorithm === r.name);
  // backtest-all scores whichever champion was current the last time it ran —
  // which can lag the live leader. Name the tested champion and flag staleness
  // so an old backtest isn't mistaken for the current leader's verdict.
  const testedId = bt ? candidateIdOf(bt.algo.name) : null;
  const leaderId = leader?.id ?? null;
  const btStale = !!(testedId && leaderId && testedId.toLowerCase() !== leaderId.toLowerCase());
  const btWinnerState: 'winner' | 'previous' | 'unknown' = !leaderId
    ? 'unknown'
    : btStale
      ? 'previous'
      : 'winner';
  const btTag = bt ? winnerTag(btWinnerState, testedId, leaderId) : '';
  const btPanel = bt && btLatest
    ? `<div class="panel bt-host">
         <h3>Backtest — run ${esc(btLatest.runDate)} · testing ${esc(bt.algo.name)} · #${bt.rank} of ${latestBtTable()!.algos.length} · score ${bt.algo.score.toFixed(2)}${bt.algo.qualPct !== null ? ` · qual ${bt.algo.qualPct}%` : ''}${btTag}</h3>
         ${
           btWinnerState === 'previous'
             ? `<div class="desc" style="color: var(--yellow); margin-bottom: 8px; user-select: text;">⚠ backtest-all last scored ${esc(testedId!)}; the current leader ${esc(leaderId!)} hasn't been backtested yet — re-run backtest-all to score it.</div>`
             : ''
         }
         ${btFlag ? `<div class="desc" style="color: var(--red); margin-bottom: 8px; user-select: text;">⚑ ${esc(btFlag.reasons)}</div>` : ''}
         ${btPeriodTableHtml(bt.algo, latestBtTable()!.periods, btLatest.runDate, cw, { bh: benchmarkFor(r.name) })}
       </div>`
    : '';

  // Start/stop for both sessions live in the right-column panels (below); the
  // bar just identifies the workspace and shows the evolution badge. Badge order
  // (session activity, then health) mirrors the fleet list view.
  $('d-bar').innerHTML = `
    <button id="back">← Fleet</button>
    <h2>${esc(r.name)}</h2>
    ${badge(r)}
    ${healthChip(h)}
    <span style="flex:1"></span>`;
  $('back').onclick = closeDetail;

  $('d-left').innerHTML = `
    <div class="panel">
      <h3>Leader ${leader ? `— ${esc(leader.id)} · ${fmtScore(leader.performance)}${winnerTag('winner')}` : ''}</h3>
      ${
        leader
          ? `<div class="desc" style="color: var(--dim); margin-bottom: 10px; user-select: text;">${esc(leader.description)}</div>
             <div class="metric-grid">${ratioMetrics(leader, r.profile)
               .map(
                 (m) =>
                   `<span class="metric"><span class="k">${esc(m.k)}</span><span class="v ${m.cls}">${esc(m.v)}</span></span>`,
               )
               .join('')}</div>`
          : `<div class="desc">no completed candidates yet</div>`
      }
    </div>
    ${btPanel}
    ${
      leader
        ? `<div class="panel"><h3>Leader NAV over time — walk-forward OOS${winnerTag('winner')}</h3>${registerNavZoom('nav-leader', equityFor(r.name, leader.id))}${zoomable('nav-leader', (w, ht) => navPanelHtml(r.name, leader.id, w, ht), cw, 130)}</div>
           ${navByPeriodPanel(r.name, cw, btTag)}
           <div class="panel"><h3>Leader returns by year${winnerTag('winner')}</h3>${yearBarsHtml(yearReturns(leader))}</div>`
        : ''
    }
    <div class="panel">
      <h3>Best score by generation</h3>
      ${zoomable('spark-gen', (w, ht, zoom) => sparklineSvg(s.sparkline, w, ht, HEALTH_COLOR[h.level], zoom, sparkGens), cw, 60)}
    </div>
    ${
      hasYearChart
        ? `<div class="panel">
             <h3>Year returns by generation (best of gen)</h3>
             ${zoomable('year-gen', (w, ht, zoom) => multiLineSvg(years, w, ht, zoom, yearGens), cw, 80)}
             <div class="legend">${years
               .map((y) => `<span><span class="sw" style="background:${y.color}"></span>${esc(y.name)}</span>`)
               .join('')}</div>
           </div>`
        : ''
    }
    <div class="panel">
      <h3>Generations (latest first)</h3>
      <div class="gen-table-wrap">
        <table>
          <tr><th>Gen</th><th>P/C/F/R</th><th>Best</th><th class="num">Score</th><th>Description</th></tr>
          ${[...s.generations]
            .reverse()
            .map((g) => {
              const isLeader = g.best && leader && g.best.id === leader.id;
              return `<tr class="${isLeader ? 'leader' : ''}">
                <td>gen${String(g.gen).padStart(3, '0')}</td>
                <td>${g.pending}/${g.complete}/${g.failed}/${g.running}</td>
                <td>${g.best ? esc(g.best.id) : '—'}</td>
                <td class="num">${g.best ? fmtScore(g.best.performance) : '—'}</td>
                <td>${g.best ? esc(g.best.description.slice(0, 90)) : 'no completed candidates'}</td>
              </tr>`;
            })
            .join('')}
        </table>
      </div>
    </div>`;

  // Both session panels sync every poll-driven re-render (self-healing attach +
  // control row). A session that starts WHILE this view is open attaches as
  // soon as it's listed.
  syncSessionPanel(
    r.name,
    sessionName(r.name),
    'evo-term-slot',
    'evo-term-ctl',
    r.session,
    () => void startEvolution(r.name),
    () => void stopEvolution(r.name),
    '▶ Start evolution',
  );
  syncSessionPanel(
    r.name,
    adhocSessionName(r.name),
    'adhoc-term-slot',
    'adhoc-term-ctl',
    r.adhoc,
    () => void startAdhoc(r.name),
    () => void stopAdhoc(r.name),
    '▶ Start adhoc claude',
  );
}

/** Sync one detail session panel: when running, self-heal the attach into its
 *  slot and show a Stop control; when stopped, tear down any stale terminal and
 *  show a launch button in the slot. Never rewrites the slot while a live
 *  terminal occupies it (moving a focused node blurs it). */
function syncSessionPanel(
  name: string,
  sessId: string,
  slotId: string,
  ctlId: string,
  state: SessionState,
  startAct: () => void,
  stopAct: () => void,
  startLabel: string,
): void {
  const slot = $(slotId);
  const ctl = $(ctlId);
  if (state.running) {
    // Skipped once attached this visit — a dead client leaves the entry in the
    // map, so an externally killed attach doesn't auto-reattach-loop.
    if (!terms.has(sessId)) void attachTerminal(sessId, false, slot, 'dual');
    const attached = terms.has(sessId);
    ctl.innerHTML =
      `${sessBadge(state, sessId)} ` +
      (attached
        ? `<span class="term-note">live — click (or ⏎) to focus; wheel scrolls the session; ⌘esc backs out</span>`
        : `<button class="primary" data-sess-attach>Attach terminal</button>`) +
      `<span style="flex:1"></span><button class="danger" data-sess-stop>⏹ Stop</button>`;
  } else {
    if (terms.has(sessId)) teardownTerminal(sessId); // session died — clear stale term
    slot.innerHTML = `<button class="primary term-launch" data-sess-start>${esc(startLabel)}</button>`;
    ctl.innerHTML = `${sessBadge(state, sessId)} <span class="term-note">not running</span>`;
  }
  slot.querySelector('[data-sess-start]')?.addEventListener('click', startAct);
  ctl.querySelector('[data-sess-stop]')?.addEventListener('click', stopAct);
  ctl
    .querySelector('[data-sess-attach]')
    ?.addEventListener('click', () => void attachTerminal(sessId, true, slot, 'dual'));
}

/** Attach xterm to a tmux session by full id, in the given slot. Multiple may
 *  be live at once (detail runs evolution + adhoc); each is tracked in `terms`
 *  keyed by session id. heightClass ('dual' stacked / 'solo' full) sizes the
 *  wrap. */
async function attachTerminal(
  sessId: string,
  focus: boolean,
  slot: HTMLElement,
  heightClass: string,
): Promise<void> {
  teardownTerminal(sessId); // replace any prior client for this same session
  const wrap = document.createElement('div');
  wrap.className = `term-wrap ${heightClass}`;
  slot.innerHTML = '';
  slot.appendChild(wrap);

  const term = new Terminal({
    fontFamily: 'SF Mono, Menlo, monospace',
    fontSize: 12,
    theme: { background: '#000000' },
    scrollback: 0, // the attached app (claude, alt-screen) owns its own scrollback
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(wrap);
  fit.fit();

  const ts: TermSession = { sessId, term, fit, port: null, wrap, ro: null as unknown as ResizeObserver };
  terms.set(sessId, ts);

  term.onData((data) => ts.port?.postMessage({ type: 'input', data }));
  // No custom wheel handler: claude runs in the alternate screen with mouse
  // tracking on, so tmux keeps zero scrollback for it (`history_size` 0) — the
  // old copy-mode hijack scrolled a buffer that doesn't exist and, by cancelling
  // the wheel event, stopped it ever reaching claude. Letting xterm handle the
  // wheel natively forwards it as a mouse sequence (onData → pty → tmux →
  // claude), so claude scrolls its own conversation. tmux `mouse off` means tmux
  // forwards to the app rather than grabbing the wheel for itself.
  ts.ro = new ResizeObserver(() => {
    fit.fit();
    ts.port?.postMessage({ type: 'resize', cols: term.cols, rows: term.rows });
  });
  ts.ro.observe(wrap);

  await api.session.attach(sessId, term.cols, term.rows);
  if (focus) term.focus();
  render(); // refresh the control row (detail or tool page)
}

// ── tool page (inference-all / backtest-all in their own tmux sessions) ──────

let toolBuiltFor: string | null = null;

function openTool(key: string): void {
  if (view) closeDetail();
  toolView = key;
  teardownAllTerminals();
  render();
  window.scrollTo(0, 0);
  const t = tools.find((x) => x.key === key);
  if (t?.running) void attachTerminal(toolSessionName(key), false, $('tool-term-slot'), 'solo');
}

function closeTool(): void {
  toolView = null;
  toolBuiltFor = null;
  teardownAllTerminals();
  render();
}

async function startTool(key: string): Promise<void> {
  await api.tools.start(key); // resolves after the post-start poll, so the session is listed
  if (toolView === key) void attachTerminal(toolSessionName(key), false, $('tool-term-slot'), 'solo');
}

async function stopTool(key: string): Promise<void> {
  if (!confirm(`Stop ${key}? The tmux session will be killed.`)) return;
  teardownTerminal(toolSessionName(key));
  await api.tools.stop(key);
}

// Same skeleton discipline as the detail view: the panel holding #tool-term-slot
// is built once per tool and only the bar / hint line refresh on fleet pushes.
function renderTool(): void {
  const t = tools.find((x) => x.key === toolView);
  const el = $('tool');
  if (!t) {
    el.innerHTML = `<div class="empty">tool not available in any configured root</div>`;
    toolBuiltFor = null;
    return;
  }
  if (toolBuiltFor !== t.key) {
    el.innerHTML = `
      <div class="bar" id="t-bar"></div>
      <div class="panel">
        <h3>Session</h3>
        <div id="tool-term-slot"></div>
        <div id="tool-term-hint"></div>
      </div>`;
    toolBuiltFor = t.key;
  }
  $('t-bar').innerHTML = `
    <button id="t-back">← Fleet</button>
    <h2>⚒ ${esc(t.key)}</h2>
    <span class="badge ${t.running ? 'working' : 'stopped'}">${t.running ? 'running' : 'stopped'}</span>
    <span style="flex:1"></span>
    ${
      t.running
        ? `<button id="t-stop" class="danger">Stop</button>`
        : `<button id="t-start" class="primary">▶ Run ./${esc(t.key)}</button>`
    }`;
  $('t-back').onclick = closeTool;
  document.getElementById('t-start')?.addEventListener('click', () => void startTool(t.key));
  document.getElementById('t-stop')?.addEventListener('click', () => void stopTool(t.key));
  $('tool-term-hint').innerHTML = t.running
    ? terms.has(toolSessionName(t.key))
      ? 'Live tmux attach — click (or ⏎) to focus; keystrokes then go to the session; wheel scrolls the session; ⌘esc backs out.'
      : '<button id="t-attach" class="primary">Attach terminal</button>'
    : `Not running. ▶ runs ./${esc(t.key)} in ${esc(t.root ?? '?')} — the pane stays inspectable after it exits.`;
  document
    .getElementById('t-attach')
    ?.addEventListener('click', () => void attachTerminal(toolSessionName(t.key), true, $('tool-term-slot'), 'solo'));
}

function renderToolButtons(): void {
  $('tool-btns').innerHTML = tools
    .filter((t) => t.root !== null)
    .map(
      (t) =>
        `<button data-tool="${esc(t.key)}" class="${t.running ? 'on' : ''}"
           title="${t.running ? `${esc(t.key)} is running — open its session` : `Open ${esc(t.key)}`}">${t.running ? '●' : '⚒'} ${esc(t.key)}</button>`,
    )
    .join('');
  syncHeaderHeight();
}

// MessagePort arrives via preload re-post (meta.attachId = session id); route
// it to that session's terminal. Stale ports (session torn down before the
// port landed) are closed and dropped.
window.addEventListener('message', (e) => {
  if (e.data?.type === 'eg-session-port') {
    const id = e.data.meta?.attachId as string | undefined;
    const ts = id ? terms.get(id) : undefined;
    const port = e.ports[0];
    if (!ts) {
      port?.close();
      return;
    }
    ts.port?.close();
    ts.port = port;
    port.onmessage = (m) => {
      if (typeof m.data === 'string') ts.term.write(m.data);
      else if (m.data?.__eg === 'detached') {
        // The attach dropped — usually because the tmux session ended (claude
        // exited / was killed). Force an authoritative re-poll now instead of
        // waiting for the periodic tick: poll() re-lists live tmux, so the panel
        // flips to its launch button promptly (syncSessionPanel tears the dead
        // terminal down) rather than stranding a frozen session.
        ts.term.write('\r\n\x1b[33m[detached]\x1b[0m\r\n');
        void api.fleet.refresh();
      }
    };
  } else if (e.data?.type === 'eg-event' && e.data.channel === 'fleet:update') {
    const payload = e.data.payload as FleetPayload;
    rows = payload.rows;
    tools = payload.tools;
    render();
  } else if (e.data?.type === 'eg-event' && e.data.channel === 'system:update') {
    pushSys(e.data.payload as SysSample);
  }
});

// ── actions ──────────────────────────────────────────────────────────────────

async function startEvolution(name: string): Promise<void> {
  // Resolves after the post-start poll; the resulting fleet push re-renders
  // the detail view, whose self-healing attach picks the new session up.
  await api.evolution.start(name);
}

async function stopEvolution(name: string): Promise<void> {
  // No confirmation — the tmux pane survives claude exiting (post-mortem
  // inspectable) and a stopped session restarts with one keypress.
  teardownTerminal(sessionName(name));
  await api.evolution.stop(name);
}

/** Nudge a stuck session back to work: sends Esc + "continue please" + Enter to
 *  its tmux pane, then refreshes so the badge reclassifies once it moves. */
async function unstick(sessId: string): Promise<void> {
  await api.session.unstick(sessId);
  setTimeout(() => void api.fleet.refresh(), 1500);
}

async function startAdhoc(name: string): Promise<void> {
  // Plain claude in the workspace dir; the fleet push re-renders the detail
  // view, whose self-healing attach picks the new session up.
  await api.adhoc.start(name);
}

async function stopAdhoc(name: string): Promise<void> {
  teardownTerminal(adhocSessionName(name));
  await api.adhoc.stop(name);
}

/** 's' toggle: start a stopped evolution, stop a running one. */
async function toggleEvolution(name: string): Promise<void> {
  const r = rows.find((x) => x.name === name);
  if (!r) return;
  if (r.session.running) await stopEvolution(name);
  else await startEvolution(name);
}

async function toggleStar(name: string): Promise<void> {
  const starred = prefs.starred.includes(name)
    ? prefs.starred.filter((s) => s !== name)
    : [...prefs.starred, name];
  prefs = await api.prefs.set({ starred });
}

// Event delegation, shared by list rows and grid cards (both re-render every
// push, so handlers live on the containers).
function fleetClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  const sortTh = t.closest('[data-sort]') as HTMLElement | null;
  if (sortTh) {
    void setSort(sortTh.dataset.sort!);
    return;
  }
  const star = t.closest('[data-star]') as HTMLElement | null;
  if (star) {
    e.stopPropagation();
    void toggleStar(star.dataset.star!);
    return;
  }
  const unstickBtn = t.closest('[data-unstick]') as HTMLElement | null;
  if (unstickBtn) {
    e.stopPropagation();
    void unstick(unstickBtn.dataset.unstick!);
    return;
  }
  const btn = t.closest('[data-act]') as HTMLElement | null;
  if (btn) {
    e.stopPropagation();
    const name = btn.dataset.name!;
    switch (btn.dataset.act) {
      case 'evo-start':
        void startEvolution(name);
        break;
      case 'evo-stop':
        void stopEvolution(name);
        break;
      case 'adhoc-start':
        void startAdhoc(name);
        break;
      case 'adhoc-stop':
        void stopAdhoc(name);
        break;
    }
    return;
  }
  const item = t.closest('.card, tr.row') as HTMLElement | null;
  if (item?.dataset.name) openDetail(item.dataset.name);
}
$('grid').addEventListener('click', fleetClick);
$('list').addEventListener('click', fleetClick);
$('detail').addEventListener('click', btToggleClick);
$('detail').addEventListener('click', chartZoomClick);
// 'stuck' unstick badge in the detail bar / session control rows.
$('detail').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-unstick]') as HTMLElement | null;
  if (b) void unstick(b.dataset.unstick!);
});
// Backdrop click (not the chart box) dismisses the enlarged chart; the ± / reset
// buttons drive the interactive NAV viewer.
$('chart-zoom-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    closeZoom();
    return;
  }
  const btn = (e.target as HTMLElement).closest('[data-nz]') as HTMLElement | null;
  if (!btn || !navZoom) return;
  const act = btn.dataset.nz;
  if (act === 'in') navZoomScale(0.5, 0.6);
  else if (act === 'out') navZoomScale(0.5, 1 / 0.6);
  else if (act === 'reset') navZoomReset();
});

// Wheel over the NAV viewer: zoom about the cursor (shift = pan). The plot's
// own width maps the cursor to a window fraction so zoom stays centered on it.
$('chart-zoom-overlay').addEventListener(
  'wheel',
  (e) => {
    if (!navZoom) return;
    e.preventDefault();
    if (e.shiftKey) {
      navZoomPan((e.deltaY > 0 ? 0.15 : -0.15));
      return;
    }
    const plot = document.getElementById('nav-zoom-plot');
    const rect = plot?.getBoundingClientRect();
    const frac = rect && rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
    navZoomScale(frac, e.deltaY > 0 ? 1 / 0.85 : 0.85); // scroll up = zoom in
  },
  { passive: false },
);

// Drag across the NAV viewer pans the window; window-level move/up so the drag
// survives the cursor leaving the plot.
$('chart-zoom-overlay').addEventListener('mousedown', (e) => {
  if (!navZoom) return;
  const plot = document.getElementById('nav-zoom-plot');
  if (!plot || !plot.contains(e.target as Node)) return;
  e.preventDefault();
  const rect = plot.getBoundingClientRect();
  const startX = e.clientX;
  const startI0 = navZoom.i0;
  const startI1 = navZoom.i1;
  const len = startI1 - startI0;
  plot.classList.add('dragging');
  const move = (m: MouseEvent) => {
    if (!navZoom || rect.width <= 0) return;
    const di = Math.round((-(m.clientX - startX) / rect.width) * len);
    const n = navZoom.eq.nav.length;
    let i0 = Math.max(0, Math.min(n - 1 - len, startI0 + di));
    navZoom.i0 = i0;
    navZoom.i1 = i0 + len;
    updateNavZoomPlot();
  };
  const up = () => {
    plot.classList.remove('dragging');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// ── keyboard (fleet-commander style) ─────────────────────────────────────────

function termFocused(): boolean {
  const ae = document.activeElement;
  return !!ae && !!(ae as HTMLElement).closest?.('.term-wrap');
}

function moveSelection(delta: number): void {
  const order = sorted();
  if (order.length === 0) return;
  const idx = Math.max(0, order.findIndex((r) => r.name === selectedName));
  const next = Math.min(order.length - 1, Math.max(0, idx + delta));
  selectedName = order[next].name;
  render();
  document
    .querySelector(`#${viewMode === 'list' ? 'list' : 'grid'} [data-name="${CSS.escape(selectedName)}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}

function toggleView(): void {
  viewMode = viewMode === 'list' ? 'grid' : 'list';
  syncHeaderControls();
  render();
}

// ⌘esc backs out of the detail view even while the terminal has focus —
// captured before xterm can swallow it.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && e.metaKey && (view || toolView)) {
      e.preventDefault();
      e.stopPropagation();
      if (view) closeDetail();
      else closeTool();
    }
  },
  { capture: true },
);

// Charts are sized from the live column width, so a window resize must repaint
// the chart-bearing views to re-measure. rAF-coalesced; the fleet grid/list use
// CSS for layout and don't need it. Re-rendering the detail keeps the .term-wrap
// nodes (the skeleton isn't rebuilt when detailBuiltFor is unchanged).
let resizeRaf = 0;
window.addEventListener('resize', () => {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    if (view) render();
  });
});

// Dropping a file onto a session terminal types its absolute path into that
// session — the easy way to hand the running claude a screenshot/log to read.
// We must preventDefault on BOTH events window-wide regardless of target, or
// Electron navigates the whole renderer to the dropped file:// URL and the app
// blanks out. A drop off a terminal is swallowed (no path injected).
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const target = e.target as Node | null;
  const ts = target ? [...terms.values()].find((t) => t.wrap.contains(target)) : undefined;
  if (!ts) return; // dropped outside any live terminal
  const text = Array.from(files)
    .map((f) => api.pathForFile(f))
    .filter(Boolean)
    .map((p) => (/\s/.test(p) ? `'${p}'` : p)) // quote paths with spaces so claude reads one token
    .join(' ');
  if (!text) return;
  ts.port?.postMessage({ type: 'input', data: text + ' ' });
  ts.term.focus();
});

window.addEventListener('keydown', (e) => {
  if (termFocused()) return; // keystrokes belong to the tmux session
  if (($('prefs-dialog') as HTMLDialogElement).open) return;
  if (document.activeElement?.id === 'search') return; // typing in the filter box
  if (chartZoomOpen()) {
    // The enlarged-chart overlay grabs Escape before it can back out of the view.
    if (e.key === 'Escape') {
      e.preventDefault();
      closeZoom();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const sel = selectedName ? rows.find((r) => r.name === selectedName) : undefined;

  if (view || toolView) {
    // Detail/tool page: ⏎/a focus the primary terminal (evolution first), esc
    // backs out, s toggles evolution. Space is swallowed so a stray press (e.g.
    // right after losing terminal focus) can't scroll the page.
    if (e.key === 'Escape') view ? closeDetail() : closeTool();
    else if (e.key === 's' && view) void toggleEvolution(view);
    else if (e.key === 'Enter' || e.key === 'a') {
      if (focusPrimaryTerm()) return; // a live terminal — just focus it
      // none attached yet (attach in flight / not started): attach the first
      // running session and focus it.
      if (view) {
        const r = rows.find((x) => x.name === view);
        if (r?.session.running) void attachTerminal(sessionName(view), true, $('evo-term-slot'), 'dual');
        else if (r?.adhoc.running) void attachTerminal(adhocSessionName(view), true, $('adhoc-term-slot'), 'dual');
      } else if (toolView) {
        const t = tools.find((x) => x.key === toolView);
        if (t?.running) void attachTerminal(toolSessionName(toolView), true, $('tool-term-slot'), 'solo');
      }
    } else if (e.key === ' ') e.preventDefault();
    return;
  }

  switch (e.key) {
    case 'j':
    case 'ArrowDown':
      e.preventDefault();
      moveSelection(1);
      break;
    case 'k':
    case 'ArrowUp':
      e.preventDefault();
      moveSelection(-1);
      break;
    case 'Enter':
      if (sel) openDetail(sel.name);
      break;
    case 'a':
      if (sel) openDetail(sel.name, true);
      break;
    case ' ':
      e.preventDefault();
      togglePeek();
      break;
    case 'Escape':
      if (peekFor) {
        peekFor = null;
        renderPeek();
      }
      break;
    case 'v':
      toggleView();
      break;
    case 's':
      if (sel) void toggleEvolution(sel.name);
      break;
    case '*':
      if (sel) void toggleStar(sel.name);
      break;
    case '/': {
      e.preventDefault();
      const s = $('search') as HTMLInputElement;
      s.focus();
      s.select();
      break;
    }
  }
});

// ── header controls ──────────────────────────────────────────────────────────

// Theme cycles system → dark → light on each click of the icon button.
const THEME_CYCLE: Array<Prefs['theme']> = ['system', 'dark', 'light'];
const THEME_ICON: Record<Prefs['theme'], string> = { system: '◐', dark: '●', light: '○' };

function syncHeaderControls(): void {
  const themeBtn = $('theme-btn');
  themeBtn.textContent = THEME_ICON[prefs.theme];
  themeBtn.title = `Theme: ${prefs.theme}`;
  $('view-toggle')
    .querySelectorAll<HTMLButtonElement>('button')
    .forEach((b) => b.classList.toggle('active', b.dataset.view === viewMode));
}

const searchEl = $('search') as HTMLInputElement;
searchEl.addEventListener('input', () => {
  searchQuery = searchEl.value.trim().toLowerCase();
  render();
});
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchEl.value = '';
    searchQuery = '';
    searchEl.blur();
    render();
  } else if (e.key === 'Enter') {
    searchEl.blur(); // keep the filter, hand keyboard nav back to the list
  }
});

$('view-toggle').addEventListener('click', (e) => {
  const mode = (e.target as HTMLElement).closest('button')?.dataset.view as 'list' | 'grid' | undefined;
  if (!mode || mode === viewMode) return;
  viewMode = mode;
  syncHeaderControls();
  render();
});
$('tool-btns').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-tool]') as HTMLElement | null;
  if (btn) openTool(btn.dataset.tool!);
});

$('theme-btn').addEventListener('click', () => {
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(prefs.theme) + 1) % THEME_CYCLE.length];
  void api.prefs.set({ theme: next }).then((p) => {
    prefs = p;
    syncHeaderControls();
  });
});

// Build the 5 winner-column dropdowns from the columns the fleet actually emits,
// preselecting whatever's saved (even if not currently present in the union).
function syncWinnerColDialog(): void {
  const cols = availableMetricCols();
  const saved = prefs.winnerCols ?? [];
  const opts = (sel: string): string => {
    const known = cols.includes(sel) || sel === '';
    const extra = known ? '' : `<option value="${esc(sel)}" selected>${esc(sel)}</option>`;
    const list = cols
      .map((c) => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(c)}</option>`)
      .join('');
    return `<option value=""${sel === '' ? ' selected' : ''}>— none —</option>${extra}${list}`;
  };
  $('winner-cols').innerHTML = Array.from({ length: 5 }, (_, i) => {
    const sel = saved[i] ?? '';
    return `<select class="winner-col" data-slot="${i}" title="Winner info column ${i + 1}">${opts(sel)}</select>`;
  }).join('');
}

$('prefs-btn').addEventListener('click', () => {
  ($('roots-input') as HTMLTextAreaElement).value = prefs.roots.join('\n');
  syncWinnerColDialog();
  ($('prefs-dialog') as HTMLDialogElement).showModal();
});
$('prefs-cancel').addEventListener('click', () => ($('prefs-dialog') as HTMLDialogElement).close());
$('prefs-save').addEventListener('click', async () => {
  const roots = ($('roots-input') as HTMLTextAreaElement).value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const winnerCols = Array.from(
    document.querySelectorAll<HTMLSelectElement>('#winner-cols .winner-col'),
  ).map((sel) => sel.value);
  prefs = await api.prefs.set({ roots, winnerCols });
  ($('prefs-dialog') as HTMLDialogElement).close();
  render();
});

// ── boot ─────────────────────────────────────────────────────────────────────

void (async () => {
  prefs = await api.prefs.get();
  if (!(prefs.sortCol in SORTS) && !prefs.sortCol.startsWith('metric:'))
    prefs = await api.prefs.set({ sortCol: 'score', sortDesc: true });
  syncHeaderControls();
  const payload = await api.fleet.snapshot();
  rows = payload.rows;
  tools = payload.tools;
  render();
  syncHeaderHeight();
  void loadLatestBacktests(); // joins BT scores into the list/peek/detail when it lands
})();

window.addEventListener('resize', syncHeaderHeight);
