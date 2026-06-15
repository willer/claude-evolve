import { describe, expect, it } from 'vitest';

import { buildBacktestTable, qualPct, scoreAlgo } from './backtests';
import type { BacktestRow } from './backtests';
import {
  STALE_MS,
  classifyHealth,
  computeStats,
  emptyStats,
  genOf,
  isEarlier,
  parseCandidates,
  parseCsv,
} from './csv';
import { TRADING_METRICS, resolveProfile } from './profile';
import { adhocSessionName, classifyPane, hashText, sessionName, toolSessionName } from './state';

const HEADER =
  'id,basedOnId,description,performance,status,sharpe,yearly_return,max_drawdown,return_2025,idea-LLM,run-LLM';

function row(
  id: string,
  perf: string,
  status: string,
  metrics: [string, string, string, string] = ['', '', '', ''],
): string {
  return `${id},,desc ${id},${perf},${status},${metrics.join(',')},,`;
}

describe('parseCsv', () => {
  it('handles quoted fields with commas and escaped quotes', () => {
    const rows = parseCsv('a,"b,c","d""e"\n1,2,3\n');
    expect(rows).toEqual([
      ['a', 'b,c', 'd"e'],
      ['1', '2', '3'],
    ]);
  });

  it('handles embedded newlines in quoted fields', () => {
    const rows = parseCsv('a,"line1\nline2",c\n');
    expect(rows).toEqual([['a', 'line1\nline2', 'c']]);
  });
});

describe('genOf', () => {
  it('parses generation ids', () => {
    expect(genOf('gen03-001')).toBe(3);
    expect(genOf('gen1063-008')).toBe(1063);
    expect(genOf('baseline-000')).toBe(0);
    expect(genOf('baseline-001-vixtrim')).toBe(0);
    expect(genOf('weird')).toBeNull();
  });
});

describe('isEarlier', () => {
  it('orders by generation then sequence', () => {
    expect(isEarlier('gen01-002', 'gen02-001')).toBe(true);
    expect(isEarlier('gen02-001', 'gen02-003')).toBe(true);
    expect(isEarlier('gen02-003', 'gen02-001')).toBe(false);
  });
});

describe('parseCandidates', () => {
  it('maps metric columns and skips empty values', () => {
    const text = [HEADER, row('gen01-001', '1.5', 'complete', ['1.2', '0.35', '-0.2', '0.10'])].join('\n');
    const { candidates, metricColumns } = parseCandidates(text);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].metrics).toEqual({
      sharpe: 1.2,
      yearly_return: 0.35,
      max_drawdown: -0.2,
      return_2025: 0.1,
    });
    expect(metricColumns).toEqual(['sharpe', 'yearly_return', 'max_drawdown', 'return_2025']);
  });

  it('normalizes failed-retry statuses to failed', () => {
    const text = [HEADER, row('gen01-001', '', 'failed-retry2')].join('\n');
    expect(parseCandidates(text).candidates[0].status).toBe('failed');
  });
});

describe('computeStats', () => {
  it('finds the leader with earliest-id tie-break', () => {
    const text = [
      HEADER,
      row('gen01-001', '2.0', 'complete'),
      row('gen01-002', '2.0', 'complete'),
      row('gen02-001', '1.5', 'complete'),
    ].join('\n');
    const s = computeStats(text);
    expect(s.leader?.id).toBe('gen01-001'); // tie → earliest
    expect(s.leaderGen).toBe(1);
    expect(s.latestGen).toBe(2);
    expect(s.gensSinceTop).toBe(1);
  });

  it('builds the per-generation sparkline in gen order', () => {
    const text = [
      HEADER,
      row('gen01-001', '1.0', 'complete'),
      row('gen03-001', '3.0', 'complete'),
      row('gen02-001', '2.0', 'complete'),
    ].join('\n');
    expect(computeStats(text).sparkline).toEqual([1.0, 2.0, 3.0]);
  });

  it('counts statuses and computes recent success rate excluding the latest gen', () => {
    const lines = [HEADER];
    // gens 1-5: 4 complete + 1 failed each → 80% over the window before gen 6
    for (let g = 1; g <= 5; g++) {
      for (let i = 1; i <= 4; i++) lines.push(row(`gen0${g}-00${i}`, '1.0', 'complete'));
      lines.push(row(`gen0${g}-005`, '', 'failed'));
    }
    lines.push(row('gen06-001', '', 'pending'));
    const s = computeStats(lines.join('\n'));
    expect(s.counts.complete).toBe(20);
    expect(s.counts.failed).toBe(5);
    expect(s.counts.pending).toBe(1);
    expect(s.recentSuccessRate).toBeCloseTo(0.8);
  });

  it('treats a 0.0 score as a real score, not a failure', () => {
    const text = [HEADER, row('gen01-001', '0.0', 'complete')].join('\n');
    const s = computeStats(text);
    expect(s.leader?.id).toBe('gen01-001');
    expect(s.leader?.performance).toBe(0);
  });

  it('handles an empty CSV (header only)', () => {
    const s = computeStats(`${HEADER}\n`);
    expect(s.leader).toBeNull();
    expect(s.generations).toEqual([]);
    expect(s.recentSuccessRate).toBeNull();
  });
});

describe('classifyHealth', () => {
  const NOW = 1_000_000_000_000;
  const fresh = NOW - 60_000;
  const stale = NOW - STALE_MS - 1;

  // gens 1-5 all complete, leader in the latest gen → healthy baseline
  function goodStats() {
    const lines = [HEADER];
    for (let g = 1; g <= 5; g++) lines.push(row(`gen0${g}-001`, String(g), 'complete'));
    return computeStats(lines.join('\n'));
  }

  it('reports good when scoring and improving', () => {
    expect(classifyHealth(goodStats(), fresh, true, NOW).level).toBe('good');
  });

  it('reports error when the CSV is unreadable', () => {
    expect(classifyHealth(emptyStats('ENOENT'), fresh, false, NOW).level).toBe('error');
  });

  it('reports idle only when running with a stale CSV', () => {
    expect(classifyHealth(goodStats(), stale, true, NOW).level).toBe('idle');
    expect(classifyHealth(goodStats(), stale, false, NOW).level).toBe('good'); // stopped → just old
  });

  it('tolerates steady attrition: 1 fail per gen is not failing', () => {
    const lines = [HEADER];
    for (let g = 1; g <= 5; g++) {
      lines.push(row(`gen0${g}-001`, '1.0', 'complete'));
      lines.push(row(`gen0${g}-002`, '', 'failed'));
    }
    lines.push(row('gen06-001', '', 'pending'));
    const s = computeStats(lines.join('\n'));
    expect(s.recentSuccessRate).toBeCloseTo(0.5);
    expect(s.recentFails).toBe(1); // gens 5+6 (mid-run) only
    expect(classifyHealth(s, fresh, true, NOW).level).toBe('good');
  });

  it('reports failing past 3 failures in the last 2 gens, counting the mid-run latest', () => {
    const lines = [HEADER, row('gen01-001', '1.0', 'complete')];
    for (let i = 1; i <= 2; i++) lines.push(row(`gen02-00${i}`, '', 'failed'));
    for (let i = 1; i <= 2; i++) lines.push(row(`gen03-00${i}`, '', 'failed'));
    const s = computeStats(lines.join('\n'));
    expect(s.recentFails).toBe(4);
    const h = classifyHealth(s, fresh, true, NOW);
    expect(h.level).toBe('failing');
    expect(h.detail).toContain('4 failed');
    // failing outranks idle — broken beats quiet
    expect(classifyHealth(s, stale, true, NOW).level).toBe('failing');
  });

  it('reports plateau past 5 gens without a new leader', () => {
    const lines = [HEADER, row('gen01-001', '9.0', 'complete')];
    for (let g = 2; g <= 7; g++) lines.push(row(`gen${String(g).padStart(2, '0')}-001`, '1.0', 'complete'));
    const s = computeStats(lines.join('\n'));
    expect(s.gensSinceTop).toBe(6);
    expect(classifyHealth(s, fresh, true, NOW).level).toBe('plateau');
  });

  it('stays good at exactly 5 gens since the leader (boundary)', () => {
    const lines = [HEADER, row('gen01-001', '9.0', 'complete')];
    for (let g = 2; g <= 6; g++) lines.push(row(`gen${String(g).padStart(2, '0')}-001`, '1.0', 'complete'));
    const s = computeStats(lines.join('\n'));
    expect(s.gensSinceTop).toBe(5); // > PLATEAU_GENS is the trigger, so 5 is still good
    expect(classifyHealth(s, fresh, true, NOW).level).toBe('good');
  });
});

describe('classifyPane', () => {
  it('detects asking from dialog footers', () => {
    expect(classifyPane('blah\nDo you want to proceed?\n❯ 1. Yes', null).activity).toBe('asking');
  });

  it('detects waiting from a byte-static pane', () => {
    const txt = 'composer idle';
    const first = classifyPane(txt, null);
    expect(first.activity).toBe('working'); // first sight — no baseline yet
    expect(classifyPane(txt, first.hash).activity).toBe('waiting');
    expect(classifyPane('something new', first.hash).activity).toBe('working');
  });

  it('assumes working when the pane is unreadable', () => {
    expect(classifyPane(null, hashText('x')).activity).toBe('working');
  });
});

describe('sessionName', () => {
  it('matches the autostatus TUI scheme', () => {
    expect(sessionName('ev-1d-tqqq-sigma')).toBe('evolve-ev-1d-tqqq-sigma');
    expect(toolSessionName('backtest-all')).toBe('greenhouse-backtest-all');
  });

  it('names the adhoc session with its own prefix', () => {
    expect(adhocSessionName('ev-1d-tqqq-sigma')).toBe('adhoc-ev-1d-tqqq-sigma');
  });
});

describe('backtests scoring (port of scoring.py)', () => {
  const row = (period: string, aa_pain: number | null, achieved = 'med'): BacktestRow => ({
    algorithm: 'a',
    algorithm_name: 'a gen01-001',
    period,
    target_risk: 'med',
    achieved_risk: achieved,
    cagr: 0.2,
    pain: 5,
    aa_pain,
    sharpe: 1,
    sortino: 1.5,
    turnover: 2,
  });

  // Expected values computed from trading-strategies scoring._score_algo directly.
  it('matches the python reference: cap, negative-alpha dent, missing-period penalty', () => {
    const rows = [row('ytd2026', 3.0), row('cal2025', 10.0), row('oos', -1.0), row('recent', 60.0)];
    expect(scoreAlgo(rows)).toBeCloseTo(1.3044863340386268, 10);
  });

  it('matches the python reference: uniform aa_pain scores as itself', () => {
    const rows = ['ytd2026', 'cal2025', 'oos', 'recent', 'longterm'].map((p) => row(p, 5.0));
    expect(scoreAlgo(rows)).toBeCloseTo(5.0, 10);
  });

  it('matches the python reference: ERROR risk is disqualifying', () => {
    expect(scoreAlgo([row('longterm', 5.0, 'ERROR')])).toBeCloseTo(0.005623413251903492, 10);
  });

  it('computes qual% over measurable periods only', () => {
    const rows = [row('cal2025', 3.0), row('recent', -1.0), row('longterm', null)];
    expect(qualPct(rows)).toBe(50); // null aa_pain row not tested
    expect(qualPct([row('oos', null)])).toBeNull();
  });

  it('ranks algorithms best-first and hides replay dirs', () => {
    const rows: BacktestRow[] = [
      { ...row('cal2025', 2.0), algorithm: 'ev-1d-a', algorithm_name: 'a' },
      { ...row('cal2025', 9.0), algorithm: 'ev-1d-b', algorithm_name: 'b' },
      { ...row('cal2025', 99.0), algorithm: '1d-replay-x', algorithm_name: 'replay' },
    ];
    const t = buildBacktestTable(rows);
    expect(t.algos.map((a) => a.algorithm)).toEqual(['ev-1d-b', 'ev-1d-a']);
    expect(t.periods).toEqual(['cal2025']);
  });
});

describe('resolveProfile', () => {
  const NONE = { hasEquityDir: false, metricColumns: [] as string[] };

  it('auto-detects trading from an equity/ dir', () => {
    const p = resolveProfile(null, { hasEquityDir: true, metricColumns: [] });
    expect(p.kind).toBe('trading');
    expect(p.metrics).toBe(TRADING_METRICS);
  });

  it('auto-detects trading from stock-shaped columns (sharpe / return_YYYY)', () => {
    expect(resolveProfile(null, { ...NONE, metricColumns: ['sharpe'] }).kind).toBe('trading');
    expect(resolveProfile(null, { ...NONE, metricColumns: ['return_2025'] }).kind).toBe('trading');
  });

  it('is generic with no artifacts and non-stock columns', () => {
    const p = resolveProfile(null, { ...NONE, metricColumns: ['mape', 'rmse'] });
    expect(p.kind).toBe('generic');
    expect(p.metrics).toEqual([]); // renderer lists raw columns
  });

  it('honors an explicit dashboard.metrics block over auto-detect', () => {
    const cfg = [
      'algorithm_file: algorithm.py',
      'dashboard:',
      '  profile: forecasting',
      '  metrics:',
      '    - {col: mape, label: MAPE, pct: true}',
      '    - {col: rmse, label: RMSE}',
    ].join('\n');
    const p = resolveProfile(cfg, { hasEquityDir: true, metricColumns: ['sharpe'] }); // would auto-detect trading
    expect(p.kind).toBe('forecasting');
    expect(p.metrics).toEqual([
      { col: 'mape', label: 'MAPE', pct: true, neg: false },
      { col: 'rmse', label: 'RMSE', pct: false, neg: false },
    ]);
  });

  it('honors a declared profile name even without explicit metrics', () => {
    const p = resolveProfile('dashboard:\n  profile: generic\n', { ...NONE, metricColumns: ['sharpe'] });
    expect(p.kind).toBe('generic'); // declared generic overrides the sharpe signal
    expect(p.metrics).toEqual([]);
  });

  it('falls back to auto-detect on malformed YAML rather than throwing', () => {
    const p = resolveProfile('dashboard: : : not valid\n\t- broken', { hasEquityDir: true, metricColumns: [] });
    expect(p.kind).toBe('trading');
  });
});
