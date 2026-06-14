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
