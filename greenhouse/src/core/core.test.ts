import { describe, expect, it } from 'vitest';

import { benchmarkReturns, buildBacktestTable, qualPct, scoreAlgo } from './backtests';
import type { BacktestRow, PricePoint } from './backtests';
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
import { resolveDevSourceDir } from './devRebuild';
import { chartFracs, genFrac, genTicks, sharedGenDomain } from './genAxis';
import { parseInferenceAll, productionTags } from './inferenceAll';
import { TRADING_METRICS, resolveProfile } from './profile';
import {
  SESSION_KINDS,
  adhocSessionName,
  classifyPane,
  hashText,
  pickSessionTab,
  sessionDotClass,
  sessionName,
  shellSessionName,
  toolSessionName,
} from './state';
import type { SessionKind } from './state';
import type { Activity, SessionState } from './types';

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

  it('picks a yearRow from year data alone, so unscored gens still plot', () => {
    // gen02 was never walk-forward scored — no performance, status skipped — but a cheap
    // single-window backtest filled return_2025. It must still back a year-chart point,
    // otherwise archived generations are unplottable without a full 15-window re-score.
    const text = [
      HEADER,
      row('gen01-001', '1.0', 'complete', ['', '', '', '0.11']),
      row('gen02-001', '', 'skipped', ['', '', '', '0.22']),
    ].join('\n');
    const s = computeStats(text);
    const g2 = s.generations.find((g) => g.gen === 2);
    expect(g2?.best).toBeNull(); // no score → absent from the sparkline
    expect(g2?.yearRow?.id).toBe('gen02-001'); // but present on the year chart
    expect(s.sparkline).toEqual([1.0]);
  });

  it('prefers the champion as yearRow when it carries year data', () => {
    const text = [
      HEADER,
      row('gen01-001', '1.0', 'complete', ['', '', '', '0.11']),
      row('gen01-002', '9.0', 'complete', ['', '', '', '0.99']),
    ].join('\n');
    const g1 = computeStats(text).generations.find((g) => g.gen === 1);
    // gen01-001 is seen first, but the champion must win — otherwise the year chart
    // would describe a different algorithm than the score chart above it.
    expect(g1?.yearRow?.id).toBe('gen01-002');
  });

  it('leaves yearRow null when a generation has no year data at all', () => {
    const text = [HEADER, row('gen01-001', '1.0', 'complete')].join('\n');
    expect(computeStats(text).generations[0]?.yearRow).toBeNull();
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

  it('reports stale only when running with a stale CSV', () => {
    expect(classifyHealth(goodStats(), stale, true, NOW).level).toBe('stale');
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
    // failing outranks stale — broken beats quiet
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

  it('stays working when background shells run, even byte-static', () => {
    // Real evolve footer: idle composer but a background shell still churning.
    const txt = '❯ \n  ⏵⏵ auto mode on · 1 shell · ← for agents';
    const first = classifyPane(txt, null);
    expect(classifyPane(txt, first.hash).activity).toBe('working'); // not 'waiting'
    const multi = '✻ Worked for 3m 33s · 2 shells still running\n❯ ';
    const m1 = classifyPane(multi, null);
    expect(classifyPane(multi, m1.hash).activity).toBe('working');
  });

  it('stays working when subagents are mid-flight, even byte-static', () => {
    // Real evolve agent-fleet rows: workers running while the main pane is idle.
    const txt = '❯ \n  ⏺ main\n  ◯ evolve-worker-1  evolve worker 1   1m 13s · ↓ 32.0k tokens';
    const first = classifyPane(txt, null);
    expect(classifyPane(txt, first.hash).activity).toBe('working'); // not 'waiting'
  });

  it('still reports waiting for a truly idle composer (no background work)', () => {
    const txt = '❯ \n  ⏵⏵ auto mode on (shift+tab to cycle)';
    const first = classifyPane(txt, null);
    expect(classifyPane(txt, first.hash).activity).toBe('waiting');
  });

  it('assumes working when the pane is unreadable', () => {
    expect(classifyPane(null, hashText('x')).activity).toBe('working');
  });

  it('does NOT stay working on stale "N shells" frozen in scrollback', () => {
    // Real 1d-soxl-inv pane: every worker came to rest on the spend limit; the
    // last live spinner line is "Cooked for 0s" (idle), but old "· N shells
    // still running" lines are frozen above it. Scoping busy markers to the live
    // footer must keep those stale lines from pinning it to 'working'.
    const txt = [
      '✻ Cogitated for 56m 34s · 2 shells still running',
      '⏺ Agent "evolve worker 1" came to rest · 34m 14s',
      '✻ Cooked for 0s · 1 shell still running',
      '⏺ Agent "evolve worker 1" came to rest · 1h 6m 35s',
      '✻ Cooked for 0s',
      '❯ ',
      '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
    ].join('\n');
    const first = classifyPane(txt, null);
    expect(classifyPane(txt, first.hash).activity).not.toBe('working');
  });

  it('reports waiting once the agent is at rest, despite a lingering shell', () => {
    // Real ev-1d-fas pane 2026-06-28: the run finished and printed its report,
    // but one orphan background shell is still listed. The "new task?" rest hint
    // proves the main agent is idle, so the stray "1 shell" must NOT pin it to
    // 'working'.
    const txt = [
      '✻ Cogitated for 10h 34m 17s · 1 shell still running',
      '                new task? /clear to save 413.3k tokens · ◉ /goal active (2d)',
      '❯ ',
      '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
    ].join('\n');
    const first = classifyPane(txt, null);
    expect(classifyPane(txt, first.hash).activity).toBe('waiting');
  });

  it('reports waiting (not stuck) when it recovered from an earlier spend limit and finished', () => {
    // Real ev-1d-vt: hit the spend limit early, recovered, kept evolving, then
    // converged and came to rest on its own. The limit message is buried in
    // scrollback with a full recovery turn + the final report after it, so it is
    // resolved history — NOT a current wall. Must read 'waiting', not 'stuck'.
    const txt = [
      "  ⎿  You've hit your org's monthly spend limit · run /usage-credits to raise it",
      '✻ Worked for 4m 02s',
      '⏺ Recovered; resumed evolving.',
      '✻ Worked for 2h 11m',
      '⏺ gen435 ideation empty across all strategies — converged. I agree it is done.',
      '✻ Cogitated for 10h 34m 17s',
      '                new task? /clear to save 413.3k tokens',
      '❯ ',
    ].join('\n');
    const first = classifyPane(txt, null);
    expect(classifyPane(txt, first.hash).activity).toBe('waiting');
  });

  it('still reports stuck when the spend limit is the current wall (recent band)', () => {
    // Hit the wall at the end of a long run: the failed turn that hit it is the
    // last thing that happened, so the marker sits in the recent band even with
    // a large-context "new task?" hint present.
    const txt = [
      '✻ Worked for 3m 20s',
      "  ⎿  You've hit your org's monthly spend limit · run /usage-credits to raise it",
      '✻ Cooked for 0s',
      '                new task? /clear to save 413.3k tokens',
      '❯ ',
    ].join('\n');
    const first = classifyPane(txt, null);
    expect(classifyPane(txt, first.hash).activity).toBe('stuck');
  });

  it('reports stuck when byte-static on a spend/usage limit', () => {
    const txt = [
      "  ⎿  You've hit your org's monthly spend limit · run /usage-credits to raise it",
      '✻ Cooked for 0s',
      '❯ ',
    ].join('\n');
    const first = classifyPane(txt, null);
    expect(classifyPane(txt, first.hash).activity).toBe('stuck');
  });

  it('recovers to working once a spend-limited pane resumes moving', () => {
    // The stale spend-limit line lingers in scrollback after the cap is raised;
    // a moving pane (new hash) must override it back to 'working'.
    const stuckTxt = "  ⎿  hit your org's monthly spend limit\n✻ Cooked for 0s\n❯ ";
    const s1 = classifyPane(stuckTxt, null);
    expect(classifyPane(stuckTxt, s1.hash).activity).toBe('stuck');
    const moving = "  ⎿  hit your org's monthly spend limit\n✻ Worked for 2s · 1 shell still running\n❯ ";
    expect(classifyPane(moving, s1.hash).activity).toBe('working');
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

  it('names the shell session with its own prefix', () => {
    expect(shellSessionName('ev-1d-tqqq-sigma')).toBe('shell-ev-1d-tqqq-sigma');
  });
});

describe('session tabs', () => {
  const st = (running: boolean, activity: Activity | null = null): SessionState => ({ running, activity });
  const states = (
    evolution: SessionState,
    adhoc: SessionState,
    shell: SessionState,
  ): Record<SessionKind, SessionState> => ({ evolution, adhoc, shell });
  const off = st(false);

  it('lists the three kinds in display order', () => {
    expect(SESSION_KINDS).toEqual(['evolution', 'adhoc', 'shell']);
  });

  it('opens on the evolution tab when nothing runs', () => {
    expect(pickSessionTab(states(off, off, off))).toBe('evolution');
  });

  it('prefers evolution whenever it is running', () => {
    expect(pickSessionTab(states(st(true, 'working'), st(true, 'waiting'), st(true, 'working')))).toBe('evolution');
  });

  it('falls through to the first running session in order', () => {
    expect(pickSessionTab(states(off, st(true, 'waiting'), st(true, 'working')))).toBe('adhoc');
    expect(pickSessionTab(states(off, off, st(true, 'working')))).toBe('shell');
  });

  it('maps session state to an indicator class', () => {
    expect(sessionDotClass(off)).toBe('stopped');
    expect(sessionDotClass(st(true, 'working'))).toBe('working');
    expect(sessionDotClass(st(true, 'asking'))).toBe('asking');
    expect(sessionDotClass(st(true, 'stuck'))).toBe('stuck');
    // running but unclassified (capture failed / brand-new pane) still reads live
    expect(sessionDotClass(st(true, null))).toBe('working');
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

describe('benchmarkReturns (buy & hold CAGR)', () => {
  const pt = (date: string, close: number): PricePoint => ({ date: `${date} 04:00:00`, close });
  // CAGR over [start, end]: (1+total)^(1/years)-1, years = day-span / 365.25.
  const cagr = (total: number, startDay: string, endDay: string): number => {
    const years = (Date.parse(endDay) - Date.parse(startDay)) / (365.25 * 86_400_000);
    return Math.pow(1 + total, 1 / years) - 1;
  };

  it('annualizes the per-window buy&hold return to CAGR', () => {
    // One point per relevant boundary; close doubles over cal2025.
    const inst = [pt('2025-01-02', 100), pt('2025-12-31', 150), pt('2026-06-15', 300)];
    const spy = [pt('2025-01-02', 100), pt('2025-12-31', 110), pt('2026-06-15', 121)];
    const r = benchmarkReturns(inst, spy);
    expect(r.cal2025.instrument).toBeCloseTo(cagr(0.5, '2025-01-02', '2025-12-31'), 10);
    expect(r.cal2025.spy).toBeCloseTo(cagr(0.1, '2025-01-02', '2025-12-31'), 10);
    expect(r.ytd2026.instrument).toBeNull(); // single 2026 point → no window
  });

  it('measures SPY over the instrument window so different inceptions stay comparable', () => {
    // Instrument starts 2010 (no SPY before it); longterm SPY must use 2010 start.
    const inst = [pt('2010-02-11', 1), pt('2026-06-15', 401)];
    const spy = [pt('2003-09-10', 50), pt('2010-02-11', 100), pt('2026-06-15', 700)];
    const r = benchmarkReturns(inst, spy);
    expect(r.longterm.instrument).toBeCloseTo(cagr(400, '2010-02-11', '2026-06-15'), 10); // 401/1-1, annualized
    expect(r.longterm.spy).toBeCloseTo(cagr(6, '2010-02-11', '2026-06-15'), 10); // 700/100-1 from 2010, annualized
  });

  it('returns null for a period with too little instrument data', () => {
    const inst = [pt('2026-03-01', 100)]; // only one point, all in ytd2026
    const r = benchmarkReturns(inst, [pt('2026-03-01', 100), pt('2026-06-15', 110)]);
    expect(r.cal2025).toEqual({ instrument: null, spy: null });
    expect(r.ytd2026).toEqual({ instrument: null, spy: null }); // single point → no window
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

describe('resolveDevSourceDir', () => {
  const SRC = '/Users/x/GitHub/claude-evolve/greenhouse';
  // The markers `npm run package` needs: esbuild.mjs, package.sh, src/main/main.ts.
  const present = new Set([
    `${SRC}/esbuild.mjs`,
    `${SRC}/package.sh`,
    `${SRC}/src/main/main.ts`,
  ]);
  const exists = (p: string) => present.has(p);

  it('walks up from the packaged .app exe to the source dir', () => {
    const exe = `${SRC}/release/mac-arm64/Evolve Greenhouse.app/Contents/MacOS/Evolve Greenhouse`;
    expect(resolveDevSourceDir(exe, exists)).toBe(SRC);
  });

  it('resolves an unpackaged electron exe nested under the source dir', () => {
    const exe = `${SRC}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`;
    expect(resolveDevSourceDir(exe, exists)).toBe(SRC);
  });

  it('returns null for a shipped install outside the source tree', () => {
    const exe = '/Applications/Evolve Greenhouse.app/Contents/MacOS/Evolve Greenhouse';
    expect(resolveDevSourceDir(exe, exists)).toBeNull();
  });

  it('requires ALL markers — a partial tree does not qualify', () => {
    const partial = (p: string) => p === `${SRC}/esbuild.mjs`; // missing package.sh + main.ts
    const exe = `${SRC}/release/mac-arm64/Evolve Greenhouse.app/Contents/MacOS/Evolve Greenhouse`;
    expect(resolveDevSourceDir(exe, partial)).toBeNull();
  });
});

describe('parseInferenceAll', () => {
  // Shapes taken verbatim from ~/GitHub/trading-strategies/inference-all.
  const SOLO = `("ev-1d-soxl", "SOXL", "1d", ["--signal", "--signal-name=SOXL-MED", "--pin=gen823-001"]),`;
  const BLEND = `    ("ev-1d-tqqq-high+ev-1d-htqqq", "TQQQ", "1d", ["--signal", "--signal-name=TQQQ-MIX",
                                                   "--pin=ev-1d-htqqq:gen78-001",
                                                   "--pin=ev-1d-tqqq-high:gen246-011"]),`;

  it('reads a solo entry: one member, its signal name, its unqualified pin', () => {
    const m = parseInferenceAll(SOLO);
    expect(m.get('ev-1d-soxl')).toEqual({
      signalName: 'SOXL-MED',
      members: ['ev-1d-soxl'],
      pin: 'gen823-001',
    });
  });

  it('reads a MIXED entry: both members, each with its own workspace-qualified pin', () => {
    const m = parseInferenceAll(BLEND);
    expect(m.get('ev-1d-tqqq-high')).toEqual({
      signalName: 'TQQQ-MIX',
      members: ['ev-1d-tqqq-high', 'ev-1d-htqqq'],
      pin: 'gen246-011',
    });
    expect(m.get('ev-1d-htqqq')).toEqual({
      signalName: 'TQQQ-MIX',
      members: ['ev-1d-tqqq-high', 'ev-1d-htqqq'],
      pin: 'gen78-001',
    });
  });

  it('leaves a blend member unpinned when only its partner is pinned', () => {
    const m = parseInferenceAll(
      `("a+b", "TQQQ", "1d", ["--signal", "--signal-name=MIX", "--pin=b:gen1-001"]),`,
    );
    expect(m.get('a')!.pin).toBeNull();
    expect(m.get('b')!.pin).toBe('gen1-001');
  });

  it('applies an unqualified pin in a blend to every member', () => {
    const m = parseInferenceAll(`("a+b", "X", "1d", ["--signal", "--pin=gen5-002"]),`);
    expect(m.get('a')!.pin).toBe('gen5-002');
    expect(m.get('b')!.pin).toBe('gen5-002');
  });

  it('records a live UNPINNED signal (production deploys the champion)', () => {
    const m = parseInferenceAll(`("ev-1d-urnm", "URNM", "1d", ["--signal", "--signal-name=URNM-MED"]),`);
    expect(m.get('ev-1d-urnm')).toEqual({ signalName: 'URNM-MED', members: ['ev-1d-urnm'], pin: null });
  });

  it('ignores commented-out signals — they are not live, hence not pinned', () => {
    const m = parseInferenceAll(
      `  # ("1d-qqq-inv", "QQQ", "1d", ["--signal", "--signal-name=QQQ-INV", "--pin=gen280-007"]),\n${SOLO}`,
    );
    expect(m.has('1d-qqq-inv')).toBe(false);
    expect(m.get('ev-1d-soxl')!.pin).toBe('gen823-001');
  });

  it('ignores a --pin= mentioned in a trailing or preceding comment', () => {
    const m = parseInferenceAll(
      `    # Re-pin only after a gate clears; old pin was --pin=gen999-999.\n` +
        `("ev-1d-tna", "TNA", "1d", ["--signal", "--signal-name=TNA-MED", "--pin=gen281-009"]),  # TEMP flush pin --pin=gen000-000\n`,
    );
    expect(m.get('ev-1d-tna')!.pin).toBe('gen281-009');
  });

  it('parses every live entry of a multi-entry file, blends and solos alike', () => {
    const m = parseInferenceAll([SOLO, BLEND, `("1d-gld-inv", "GLD", "1d", ["--signal", "--pin=gen42-005"]),`].join('\n'));
    expect([...m.keys()].sort()).toEqual(
      ['1d-gld-inv', 'ev-1d-htqqq', 'ev-1d-soxl', 'ev-1d-tqqq-high'],
    );
  });

  it('returns an empty map for a file with no signal tuples', () => {
    expect(parseInferenceAll('#!/usr/bin/env python\nimport os\n').size).toBe(0);
  });
});

describe('productionTags', () => {
  const solo = { signalName: 'SOXL-MED', members: ['ev-1d-soxl'], pin: 'gen823-001' };
  const blend = {
    signalName: 'TQQQ-MIX',
    members: ['ev-1d-tqqq-high', 'ev-1d-htqqq'],
    pin: 'gen246-011',
  };

  it('shows nothing for a workspace that is not live in inference-all', () => {
    expect(productionTags('ev-1d-boil', null, 'gen1-001')).toEqual([]);
  });

  it('marks a solo pin that matches the leader as deployed', () => {
    const t = productionTags('ev-1d-soxl', solo, 'gen823-001');
    expect(t.map((x) => x.cls)).toEqual(['winner']);
    expect(t[0].text).toBe('\u2713 deployed');
  });

  it('warns when a solo pin is NOT the leader, naming the pinned algo', () => {
    const t = productionTags('ev-1d-soxl', solo, 'gen868-004');
    expect(t.map((x) => x.cls)).toEqual(['prev']);
    expect(t[0].text).toContain('gen823-001');
  });

  it('flags blend membership FIRST and names the partner leg', () => {
    const t = productionTags('ev-1d-tqqq-high', blend, 'gen302-016');
    expect(t.map((x) => x.cls)).toEqual(['mix', 'prev']);
    expect(t[0].text).toContain('TQQQ-MIX');
    expect(t[0].title).toContain('ev-1d-htqqq');
    expect(t[0].title).not.toContain('ev-1d-tqqq-high,'); // never lists itself as a partner
    expect(t[1].text).toContain('gen246-011');
  });

  it('says a matching blend leg is deployed AS a leg, not as the whole signal', () => {
    const t = productionTags('ev-1d-tqqq-high', blend, 'gen246-011');
    expect(t.map((x) => x.cls)).toEqual(['mix', 'winner']);
    expect(t[1].text).toContain('TQQQ-MIX leg');
  });

  it('shows blend membership alone when that leg is unpinned (champion deploys)', () => {
    const t = productionTags('ev-1d-htqqq', { ...blend, pin: null }, 'gen146-007');
    expect(t.map((x) => x.cls)).toEqual(['mix']);
  });

  it('shows no pill for a live solo workspace with no pin — the champion is what trades', () => {
    expect(productionTags('ev-1d-urnm', { signalName: 'URNM-MED', members: ['ev-1d-urnm'], pin: null }, 'g1-1')).toEqual([]);
  });

  it('does not call a pin deployed when there is no leader yet', () => {
    expect(productionTags('ev-1d-soxl', solo, null)[0].cls).toBe('prev');
  });
});

describe('sharedGenDomain / genFrac / genTicks', () => {
  it('spans min(min) and max(max) across both charts lists', () => {
    // Score sparkline covers gens 820-892; the year chart also carries an old
    // backfilled gen 3 — the shared axis must cover 3..892, not one list's range.
    expect(sharedGenDomain([[820, 850, 892], [3, 850]])).toEqual({ min: 3, max: 892 });
  });

  it('ignores empty lists and reports null when nothing is plottable', () => {
    expect(sharedGenDomain([[], [5, 7]])).toEqual({ min: 5, max: 7 });
    expect(sharedGenDomain([[], []])).toBeNull();
  });

  it('places the same generation at the same fraction for both charts', () => {
    const ax = sharedGenDomain([[0, 100], [50, 100]])!;
    expect(genFrac(0, ax)).toBe(0);
    expect(genFrac(50, ax)).toBeCloseTo(0.5);
    expect(genFrac(100, ax)).toBe(1);
  });

  it('gives two charts with different coverage the same position for a shared gen', () => {
    // The defect this replaced: positions came from ARRAY INDEX, so gen 850 landed at
    // 1/2 of the width in the 3-point score chart and at 1/1 in the 2-point year chart.
    const spark = [820, 850, 892];
    const year = [3, 850];
    const ax = sharedGenDomain([spark, year])!;
    const sf = chartFracs(spark, ax);
    const yf = chartFracs(year, ax);
    expect(sf[1]).toBeCloseTo(yf[1]);
    expect(yf[0]).toBe(0); // the year chart, not the score chart, owns the left edge
    expect(sf[2]).toBe(1);
  });

  it('collapses a one-generation domain instead of dividing by zero', () => {
    expect(genFrac(7, { min: 7, max: 7 })).toBe(0);
    expect(genTicks({ min: 7, max: 7 }, 5)).toEqual([[7, 0]]);
  });

  it('labels whole generations evenly across the domain, endpoints included', () => {
    expect(genTicks({ min: 0, max: 100 }, 3)).toEqual([
      [0, 0],
      [50, 0.5],
      [100, 1],
    ]);
  });
});

describe('computeStats yearRow', () => {
  it('plots the generation champion when it carries year data', () => {
    const csv = [
      HEADER,
      row('gen05-001', '1.0', 'complete', ['2', '0.1', '0.2', '0.30']),
      row('gen05-002', '2.0', 'complete', ['3', '0.2', '0.2', '0.44']),
      '',
    ].join('\n');
    const g = computeStats(csv).generations.find((x) => x.gen === 5)!;
    expect(g.best!.id).toBe('gen05-002');
    expect(g.yearRow!.id).toBe('gen05-002');
  });

  it('plots an unscored generation from any row that has year data', () => {
    // Cheap single-window backtests fill return_YYYY without a walk-forward score,
    // so this generation has no `best` but still belongs on the year chart.
    const csv = [
      HEADER,
      row('gen06-001', '', 'pending', ['', '', '', '']),
      row('gen06-002', '', 'pending', ['', '', '', '0.12']),
      row('gen06-003', '', 'pending', ['', '', '', '0.99']),
      '',
    ].join('\n');
    const g = computeStats(csv).generations.find((x) => x.gen === 6)!;
    expect(g.best).toBeNull();
    expect(g.yearRow!.id).toBe('gen06-002'); // earliest id with year data wins
  });

  it('leaves yearRow null when no row in the generation has year data', () => {
    const csv = [HEADER, row('gen07-001', '1.0', 'complete', ['2', '0.1', '0.2', '']), ''].join('\n');
    expect(computeStats(csv).generations.find((x) => x.gen === 7)!.yearRow).toBeNull();
  });
});
