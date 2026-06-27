// Backtest-results aggregation — a TS port of trading-strategies/scoring.py's
// canonical "By Algorithm" ranking, so this view orders identically to the
// streamlit backtest-dashboard. Pure functions; tested in core.test.ts.

export const PERIOD_ORDER = ['ytd2026', 'cal2025', 'oos', 'recent', 'longterm'];
export const PERIOD_LABELS: Record<string, string> = {
  ytd2026: 'YTD 2026',
  cal2025: 'Cal 2025',
  oos: 'OOS 7/25+',
  recent: '2022+',
  longterm: 'Long-Term',
};
const PERIOD_WEIGHTS: Record<string, number> = {
  ytd2026: 1.0,
  cal2025: 1.5,
  oos: 1.5,
  recent: 2.0,
  longterm: 2.0,
};
const AA_PAIN_CAP = 50.0;

/** One row of the results table in data/backtest-results.db. */
export interface BacktestRow {
  algorithm: string; // directory id, stable across runs (e.g. ev-1d-soxl)
  algorithm_name: string; // evolved champion label
  period: string;
  target_risk: string | null;
  achieved_risk: string | null;
  cagr: number | null;
  pain: number | null;
  aa_pain: number | null;
  sharpe: number | null;
  sortino: number | null;
  turnover: number | null;
}

/** scoring.py _score_algo with penalize_missing=True: weighted geometric mean
 *  of per-period AA/Pain; bad/ERROR risk → 0.001, lost-to-benchmark → 0.5,
 *  capped at 50; a missing period contributes log(0.01). */
export function scoreAlgo(rows: BacktestRow[]): number {
  let weightedLogSum = 0;
  let totalWeight = 0;
  for (const period of PERIOD_ORDER) {
    const weight = PERIOD_WEIGHTS[period] ?? 1.0;
    const r = rows.find((x) => x.period === period);
    if (r) {
      const aaPain = r.aa_pain ?? 0;
      let ratio: number;
      if (r.achieved_risk === 'bad' || r.achieved_risk === 'ERROR') ratio = 0.001;
      else if (aaPain <= 0) ratio = 0.5;
      else ratio = Math.min(aaPain, AA_PAIN_CAP);
      weightedLogSum += weight * Math.log(Math.max(ratio, 0.001));
      totalWeight += weight;
    } else {
      weightedLogSum += weight * Math.log(0.01);
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? Math.exp(weightedLogSum / totalWeight) : 0;
}

/** Dashboard qual%: of periods with pain+aa_pain present, the share that pass
 *  (AA/P ≥ 0 and Pain < 20). Null when nothing was measurable. */
export function qualPct(rows: BacktestRow[]): number | null {
  let tested = 0;
  let passed = 0;
  for (const r of rows) {
    if (r.pain !== null && r.aa_pain !== null) {
      tested++;
      if (r.aa_pain >= 0 && r.pain < 20) passed++;
    }
  }
  return tested > 0 ? Math.round((passed / tested) * 100) : null;
}

export interface BacktestAlgo {
  algorithm: string;
  name: string;
  score: number;
  qualPct: number | null;
  periods: Record<string, BacktestRow>;
}

/** One run's rows → ranked algorithm table (replay/benchmark dirs hidden,
 *  like the dashboard default) + the periods actually present, in order. */
export function buildBacktestTable(rows: BacktestRow[]): {
  algos: BacktestAlgo[];
  periods: string[];
} {
  const byAlgo = new Map<string, BacktestRow[]>();
  for (const r of rows) {
    if (/replay/i.test(r.algorithm)) continue;
    const list = byAlgo.get(r.algorithm) ?? [];
    list.push(r);
    byAlgo.set(r.algorithm, list);
  }
  const present = new Set(rows.map((r) => r.period));
  const periods = PERIOD_ORDER.filter((p) => present.has(p)).concat(
    [...present].filter((p) => !PERIOD_ORDER.includes(p)).sort(),
  );
  const algos = [...byAlgo.entries()]
    .map(([algorithm, list]) => ({
      algorithm,
      name: list[0].algorithm_name,
      score: scoreAlgo(list),
      qualPct: qualPct(list),
      periods: Object.fromEntries(list.map((r) => [r.period, r])),
    }))
    .sort((a, b) => b.score - a.score || a.algorithm.localeCompare(b.algorithm));
  return { algos, periods };
}

// ── buy & hold benchmarks ────────────────────────────────────────────────────
// The backtest table reports the strategy's own numbers; to judge whether the
// strategy actually earned its keep we also want "what if you'd just held?".
// Both benchmarks come straight from the raw price CSVs (trading-strategies/
// data/raw/<SYM>_1d_*.csv) the evaluator already trades on — no re-run needed.

/** One (date, close) point from a raw price CSV, sorted ascending by date. */
export interface PricePoint {
  date: string;
  close: number;
}

/** Per-period date windows, mirrored from trading-strategies/backtest-all
 *  (LONG/RECENT/OUT_OF_SAMPLE/CAL2025/YTD2026_PERIOD). `end: null` → latest
 *  available data. LOCKSTEP: if those constants move, move these too. The OOS
 *  start matches backtest-all's default (per-algo overrides are ignored here —
 *  a buy&hold yardstick doesn't need them). */
export const PERIOD_BOUNDS: Record<string, { start: string; end: string | null }> = {
  ytd2026: { start: '2026-01-01', end: null },
  cal2025: { start: '2025-01-01', end: '2025-12-31' },
  oos: { start: '2025-07-15', end: null },
  recent: { start: '2022-01-01', end: null },
  longterm: { start: '1990-01-01', end: null },
};

/** Buy & hold CAGR (annualized) for one period, for the traded instrument and
 *  SPY — annualized so they sit in the same units as the strategy's CAGR column
 *  (a raw total return over an open-ended window isn't comparable to it). */
export interface PeriodBenchmark {
  instrument: number | null;
  spy: number | null;
}

const dayOf = (d: string): string => d.slice(0, 10); // raw dates are "YYYY-MM-DD HH:MM:SS"

/** Annualize a total return over [startDay, endDay] → CAGR. Buy&hold prices stay
 *  positive so 1+total > 0 always; sub-year windows are extrapolated, matching how
 *  backtest-all reports the strategy CAGR. Degenerate (≤0-length) window → total. */
function annualize(total: number | null, startDay: string, endDay: string): number | null {
  if (total === null) return null;
  const years = (Date.parse(endDay) - Date.parse(startDay)) / (365.25 * 86_400_000);
  return years > 0 ? Math.pow(1 + total, 1 / years) - 1 : total;
}

/** First index whose day ≥ start (series sorted ascending); -1 if none. */
function idxAtOrAfter(s: PricePoint[], start: string): number {
  for (let i = 0; i < s.length; i++) if (dayOf(s[i].date) >= start) return i;
  return -1;
}

/** Last index whose day ≤ end; -1 if none. */
function idxAtOrBefore(s: PricePoint[], end: string): number {
  for (let i = s.length - 1; i >= 0; i--) if (dayOf(s[i].date) <= end) return i;
  return -1;
}

/** Total return holding `s` across [startDay, endDay] (close[end]/close[start]−1). */
function holdReturn(s: PricePoint[], startDay: string, endDay: string): number | null {
  const i = idxAtOrAfter(s, startDay);
  const j = idxAtOrBefore(s, endDay);
  if (i < 0 || j < 0 || j <= i || s[i].close <= 0) return null;
  return s[j].close / s[i].close - 1;
}

/** Per-period buy&hold CAGR for the instrument and SPY. SPY is measured over
 *  the instrument's *actual* window inside each period, so the two are directly
 *  comparable even when their data inceptions differ (e.g. TQQQ 2010 vs SPY
 *  2003 over Long-Term). Each is annualized over that same window so it lines up
 *  with the strategy CAGR column. A period with too little instrument data → both null. */
export function benchmarkReturns(
  instrument: PricePoint[],
  spy: PricePoint[],
): Record<string, PeriodBenchmark> {
  const out: Record<string, PeriodBenchmark> = {};
  for (const period of PERIOD_ORDER) {
    const b = PERIOD_BOUNDS[period];
    const i = b ? idxAtOrAfter(instrument, b.start) : -1;
    const j = b ? idxAtOrBefore(instrument, b.end ?? '9999-12-31') : -1;
    if (i < 0 || j < 0 || j <= i || instrument[i].close <= 0) {
      out[period] = { instrument: null, spy: null };
      continue;
    }
    const startDay = dayOf(instrument[i].date);
    const endDay = dayOf(instrument[j].date);
    out[period] = {
      instrument: annualize(instrument[j].close / instrument[i].close - 1, startDay, endDay),
      spy: annualize(holdReturn(spy, startDay, endDay), startDay, endDay),
    };
  }
  return out;
}
