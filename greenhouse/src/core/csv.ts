// evolution.csv parsing + workspace stats. Pure functions — all dashboard
// numbers derive from here, so this file carries the unit tests.

import type { Candidate, GenStats, Health, WorkspaceStats } from './types';

// Core claude-evolve columns; everything else numeric is an evaluator metric.
const CORE_COLS = new Set(['id', 'basedOnId', 'description', 'performance', 'status', 'idea-LLM', 'run-LLM']);

/** RFC-4180-ish CSV parse: quoted fields, escaped quotes, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/** Generation number from a candidate id: gen03-001 → 3, baseline-000 → 0.
 *  Unparseable ids → null (excluded from per-gen stats, like the TUI). */
export function genOf(id: string): number | null {
  if (id.startsWith('baseline') || id === '000' || id === '0' || id.startsWith('gen00-')) return 0;
  const m = /^gen(\d+)-/.exec(id);
  return m ? parseInt(m[1], 10) : null;
}

function seqOf(id: string): number {
  const m = /-(\d+)/.exec(id);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** True if a is earlier than b (generation, then sequence) — leader tie-break. */
export function isEarlier(a: string, b: string): boolean {
  const ga = genOf(a) ?? Number.MAX_SAFE_INTEGER;
  const gb = genOf(b) ?? Number.MAX_SAFE_INTEGER;
  return ga !== gb ? ga < gb : seqOf(a) < seqOf(b);
}

export function parseCandidates(text: string): { candidates: Candidate[]; metricColumns: string[] } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { candidates: [], metricColumns: [] };
  const header = rows[0];
  const col = (name: string) => header.indexOf(name);
  const idIdx = col('id');
  const basedIdx = col('basedOnId');
  const descIdx = col('description');
  const perfIdx = col('performance');
  const statusIdx = col('status');
  const metricIdxs: Array<[string, number]> = [];
  header.forEach((name, i) => {
    if (!CORE_COLS.has(name) && name) metricIdxs.push([name, i]);
  });

  const candidates: Candidate[] = [];
  const seenMetrics = new Set<string>();
  for (const row of rows.slice(1)) {
    const id = row[idIdx] ?? '';
    if (!id) continue;
    const perfRaw = row[perfIdx] ?? '';
    const perf = perfRaw !== '' && isFinite(Number(perfRaw)) ? Number(perfRaw) : null;
    const metrics: Record<string, number> = {};
    for (const [name, i] of metricIdxs) {
      const v = row[i];
      if (v !== undefined && v !== '' && isFinite(Number(v))) {
        metrics[name] = Number(v);
        seenMetrics.add(name);
      }
    }
    let status = row[statusIdx] || 'pending';
    if (status.startsWith('failed')) status = 'failed'; // failed-retry* → failed
    candidates.push({
      id,
      basedOnId: row[basedIdx] ?? '',
      description: row[descIdx] ?? '',
      performance: perf,
      status,
      metrics,
    });
  }
  const metricColumns = metricIdxs.map(([n]) => n).filter((n) => seenMetrics.has(n));
  return { candidates, metricColumns };
}

export function computeStats(text: string): WorkspaceStats {
  const { candidates, metricColumns } = parseCandidates(text);
  const counts = { pending: 0, running: 0, complete: 0, failed: 0, skipped: 0 };
  const byGen = new Map<number, GenStats>();
  let leader: Candidate | null = null;
  let leaderGen: number | null = null;
  let latestGen = 0;

  for (const c of candidates) {
    const bucket = (counts as Record<string, number>)[c.status] !== undefined ? c.status : 'pending';
    (counts as Record<string, number>)[bucket]++;

    const gen = genOf(c.id);
    if (gen === null) continue;
    latestGen = Math.max(latestGen, gen);
    let g = byGen.get(gen);
    if (!g) {
      g = { gen, pending: 0, running: 0, complete: 0, failed: 0, skipped: 0, best: null };
      byGen.set(gen, g);
    }
    (g as unknown as Record<string, number>)[bucket]++;

    if (c.status === 'complete' && c.performance !== null) {
      // Highest score wins; ties go to the earliest id (matches autostatus).
      if (
        !g.best ||
        c.performance > (g.best.performance as number) ||
        (c.performance === g.best.performance && isEarlier(c.id, g.best.id))
      ) {
        g.best = c;
      }
      if (
        !leader ||
        c.performance > (leader.performance as number) ||
        (c.performance === leader.performance && isEarlier(c.id, leader.id))
      ) {
        leader = c;
        leaderGen = gen;
      }
    }
  }

  const generations = [...byGen.values()].sort((a, b) => a.gen - b.gen);
  const sparkline = generations
    .filter((g) => g.best !== null)
    .map((g) => g.best!.performance as number);

  // Recent success rate: c/(c+f) over the 5 gens before the latest (which may
  // still be mid-run). gen 0 (baseline) participates only if it's not alone.
  let recentSuccessRate: number | null = null;
  const older = generations.filter((g) => g.gen < latestGen).slice(-5);
  const c = older.reduce((n, g) => n + g.complete, 0);
  const f = older.reduce((n, g) => n + g.failed, 0);
  if (c + f > 0) recentSuccessRate = c / (c + f);

  // Failures over the last 2 generations, INCLUDING the mid-run latest —
  // a fresh burst of failures should flag immediately, not a gen later.
  const recentFails = generations
    .filter((g) => g.gen >= latestGen - 1)
    .reduce((n, g) => n + g.failed, 0);

  return {
    error: null,
    counts,
    leader,
    leaderGen,
    latestGen,
    gensSinceTop: leader && leaderGen !== null ? latestGen - leaderGen : null,
    recentSuccessRate,
    recentFails,
    sparkline,
    generations,
    metricColumns,
  };
}

// Verdict thresholds (operator-tuned 2026-06-15; the fail rule is greenhouse's
// own): with an AI supervisor coding candidates — not a blind script — failures
// should be rare, so a COUNT beats a rate. More than FAILING_FAILS failures
// across the last 2 generations means the workspace is broken; a moderate
// failure rate alongside steady scoring is normal attrition.
//
// PLATEAU_GENS dropped 20→5 now that the evolve bots run goal-directed and give
// up after ~2 stale generations: 5 gens without a new leader already means the
// search has run dry, so the dashboard should flag it that early too.
export const PLATEAU_GENS = 5;
export const FAILING_FAILS = 3;
export const STALE_MS = 12 * 3600 * 1000;

/** One verdict per workspace so the dashboard reads at a glance. Severity:
 *  error > failing (red — broken) > stale (yellow — the RUNNER is alive but its
 *  CSV has been quiet >12h, usually claude reporting no progress or sitting on a
 *  question; the evolution search itself isn't stalled, the process driving it
 *  is) > plateau (yellow) > ok. */
export function classifyHealth(
  stats: WorkspaceStats,
  csvMtimeMs: number | null,
  running: boolean,
  nowMs: number,
): Health {
  if (stats.error) return { level: 'error', label: 'error', detail: stats.error };
  if (stats.recentFails > FAILING_FAILS)
    return {
      level: 'failing',
      label: 'failing',
      detail: `${stats.recentFails} failed candidates in the last 2 generations (>${FAILING_FAILS} = broken, not attrition)`,
    };
  if (running && csvMtimeMs !== null && nowMs - csvMtimeMs > STALE_MS) {
    const ageH = Math.floor((nowMs - csvMtimeMs) / 3600000);
    return {
      level: 'stale',
      label: 'stale',
      detail: `runner alive but no CSV write in ${ageH}h; the claude process is likely reporting no progress or waiting on a question, attach to nudge it (the evolution search itself isn't stalled)`,
    };
  }
  if (stats.gensSinceTop !== null && stats.gensSinceTop > PLATEAU_GENS)
    return {
      level: 'plateau',
      label: 'plateau',
      detail: `${stats.gensSinceTop} generations without beating the leader`,
    };
  return { level: 'good', label: 'ok', detail: 'scoring cleanly, session healthy' };
}

export function emptyStats(error: string | null): WorkspaceStats {
  return {
    error,
    counts: { pending: 0, running: 0, complete: 0, failed: 0, skipped: 0 },
    leader: null,
    leaderGen: null,
    latestGen: 0,
    gensSinceTop: null,
    recentSuccessRate: null,
    recentFails: 0,
    sparkline: [],
    generations: [],
    metricColumns: [],
  };
}
