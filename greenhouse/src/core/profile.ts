// Per-workspace display profile. The dashboard is a generic claude-evolve
// observer; the trading-specific metric panel is just one profile. A workspace
// declares its profile in config.yaml's optional `dashboard:` block; absent
// that, we auto-detect trading (equity/ dir or stock-shaped CSV columns) vs a
// plain generic view that lists whatever the evaluator emits.
//
//   dashboard:
//     profile: forecasting          # optional label; trading | generic | custom
//     metrics:                      # optional — ordered leader metrics
//       - {col: mape, label: MAPE, pct: true}
//       - {col: rmse, label: RMSE}

import { load as yamlLoad } from 'js-yaml';
import type { MetricSpec, ResolvedProfile } from './types';

// The canonical trading ratio panel (formerly the renderer's RATIO_ORDER /
// PCT_KEYS) — the single source of truth for the auto-detected 'trading' kind.
export const TRADING_METRICS: MetricSpec[] = [
  { col: 'sharpe', label: 'Sharpe' },
  { col: 'sortino', label: 'Sortino' },
  { col: 'yearly_return', label: 'CAGR', pct: true },
  { col: 'max_drawdown', label: 'MaxDD', pct: true, neg: true },
  { col: 'win_rate', label: 'Win rate', pct: true },
  { col: 'profit_factor', label: 'PF' },
  { col: 'total_trades', label: 'Trades' },
  { col: 'alpha', label: 'Alpha', pct: true },
  { col: 'pain_score', label: 'Pain' },
  { col: 'cagr_pain_ratio', label: 'CAGR/Pain' },
  { col: 'alpha_pain_ratio', label: 'Alpha/Pain' },
];

// CSV columns that mark a workspace as a trading evolve set when no profile is
// declared (a forecasting set won't carry these).
const STOCK_SIGNAL_COLS = ['sharpe', 'sortino', 'yearly_return', 'max_drawdown', 'aa_pain', 'cagr_pain_ratio', 'pain_score'];

function autodetectKind(hasEquityDir: boolean, metricColumns: string[]): string {
  if (hasEquityDir) return 'trading';
  if (metricColumns.some((c) => STOCK_SIGNAL_COLS.includes(c) || /^return_\d{4}$/.test(c))) return 'trading';
  return 'generic';
}

function coerceMetrics(raw: unknown): MetricSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: MetricSpec[] = [];
  for (const m of raw) {
    if (m && typeof m === 'object' && typeof (m as Record<string, unknown>).col === 'string') {
      const o = m as Record<string, unknown>;
      out.push({
        col: o.col as string,
        label: typeof o.label === 'string' ? o.label : (o.col as string),
        pct: o.pct === true,
        neg: o.neg === true,
      });
    }
  }
  return out;
}

/** Resolve a workspace's display profile. An explicit config.yaml `dashboard:`
 *  block wins; otherwise auto-detect trading vs generic. Malformed YAML falls
 *  back to auto-detection rather than blanking the workspace — the dashboard is
 *  a read-only observer, so a user's config typo must not take out the fleet. */
export function resolveProfile(
  configText: string | null,
  opts: { hasEquityDir: boolean; metricColumns: string[] },
): ResolvedProfile {
  let block: Record<string, unknown> | null = null;
  if (configText) {
    try {
      const doc = yamlLoad(configText);
      const d = doc && typeof doc === 'object' ? (doc as Record<string, unknown>).dashboard : null;
      if (d && typeof d === 'object') block = d as Record<string, unknown>;
    } catch {
      block = null;
    }
  }
  const explicit = coerceMetrics(block?.metrics);
  const declaredKind = typeof block?.profile === 'string' ? (block.profile as string) : null;
  if (explicit.length) return { kind: declaredKind ?? 'custom', metrics: explicit };
  const kind = declaredKind ?? autodetectKind(opts.hasEquityDir, opts.metricColumns);
  return { kind, metrics: kind === 'trading' ? TRADING_METRICS : [] };
}
