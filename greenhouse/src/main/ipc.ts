// IPC handlers + MessagePort wiring — the single place where the workspace/
// session model meets Electron IPC. Terminal bytes ride a MessagePort, not
// JSON IPC (same transport design as Genome FleetView).

import { BrowserWindow, MessageChannelMain, ipcMain, nativeTheme } from 'electron';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import type { BacktestRow, PricePoint } from '../core/backtests';
import { benchmarkReturns } from '../core/backtests';
import { adhocSessionName, sessionName, toolSessionName } from '../core/state';
import type { Prefs } from '../core/types';
import type { Poller } from './Poller';
import type { PrefsStore } from './prefsStore';
import type { AttachHandle, SessionHost } from './SessionHost';

const execFileP = promisify(execFile);

/** Query data/backtest-results.db via the sqlite3 CLI (read-only, JSON out) —
 *  avoids a native sqlite dependency next to node-pty. */
async function sqliteJson(db: string, sql: string): Promise<unknown[]> {
  const { stdout } = await execFileP('sqlite3', ['-json', '-readonly', db, sql]);
  return stdout.trim() ? (JSON.parse(stdout) as unknown[]) : [];
}

export function wireIpc(
  win: () => BrowserWindow | null,
  host: SessionHost,
  poller: Poller,
  prefs: PrefsStore,
  // Effective prefs (EG_ROOTS test seam applied) — data lookups must follow
  // the same roots the Poller scans, or EG_ROOTS runs leak real-repo data.
  effPrefs: () => Prefs,
): void {
  ipcMain.handle('fleet:snapshot', () => ({ rows: poller.current(), tools: poller.currentTools() }));
  ipcMain.handle('fleet:refresh', () => poller.poll());

  // Repo-level tool scripts (inference-all / backtest-all) in their own tmux.
  ipcMain.handle('tools:start', async (_e, key: string) => {
    const tool = poller.currentTools().find((t) => t.key === key);
    if (!tool?.root) throw new Error(`tool not available in any root: ${key}`);
    if (tool.running) throw new Error(`tool already running: ${key}`);
    await host.startTool(key, tool.root);
    await poller.poll();
  });

  ipcMain.handle('tools:stop', async (_e, key: string) => {
    host.kill(toolSessionName(key));
    await new Promise((r) => setTimeout(r, 300));
    await poller.poll();
  });

  const backtestDb = (): string | undefined =>
    effPrefs()
      .roots.map((r) => path.join(r, 'data', 'backtest-results.db'))
      .find((p) => fs.existsSync(p));

  // Backtest dashboard data: latest complete run (>10 algos, like the
  // streamlit default) unless a specific runDate is requested. Includes the
  // run's appendix (flagged algorithms + reasons — the report's flag section).
  ipcMain.handle('backtests:summary', async (_e, runDate?: string) => {
    const db = backtestDb();
    if (!db) return null;
    const dates = (await sqliteJson(
      db,
      'SELECT run_date, COUNT(*) AS count FROM results GROUP BY run_date ORDER BY run_date DESC',
    )) as Array<{ run_date: string; count: number }>;
    if (dates.length === 0) return null;
    let chosen = runDate;
    if (chosen !== undefined && !/^[\w :.-]+$/.test(chosen)) throw new Error(`bad run date: ${chosen}`);
    if (!chosen || !dates.some((d) => d.run_date === chosen)) {
      chosen = (dates.find((d) => d.count > 10) ?? dates[0]).run_date;
    }
    const rows = (await sqliteJson(
      db,
      `SELECT algorithm, algorithm_name, period, target_risk, achieved_risk,
              cagr, pain, aa_pain, sharpe, sortino, turnover
       FROM results WHERE run_date = '${chosen}'`,
    )) as BacktestRow[];
    const appendix = (await sqliteJson(
      db,
      `SELECT algorithm, algorithm_name, reasons FROM appendix WHERE run_date = '${chosen}' ORDER BY algorithm`,
    )) as Array<{ algorithm: string; algorithm_name: string; reasons: string }>;
    return { runDate: chosen, runDates: dates.map((d) => d.run_date), rows, appendix };
  });

  // Per-period NAV + position series, written by backtest-all since 2026-06-11
  // (the equity_curves table — schema shared with trading-strategies, lockstep).
  // Null = honest absence: DB predates the table, or the run carried no curve.
  // position is signed % of portfolio (long +, short −), aligned 1:1 with the
  // NAV series, or absent (null) for older runs that predate the column.
  ipcMain.handle('backtests:equity', async (_e, runDate: string, algorithm: string, period: string) => {
    if (!/^[\w :.-]+$/.test(runDate)) throw new Error(`bad run date: ${runDate}`);
    if (!/^[\w./-]+$/.test(algorithm)) throw new Error(`bad algorithm: ${algorithm}`);
    if (!/^\w+$/.test(period)) throw new Error(`bad period: ${period}`);
    const db = backtestDb();
    if (!db) return null;
    let rows: unknown[];
    try {
      rows = await sqliteJson(
        db,
        `SELECT dates, nav, position FROM equity_curves
         WHERE run_date = '${runDate}' AND algorithm = '${algorithm}' AND period = '${period}'`,
      );
    } catch (err) {
      const msg = String((err as { stderr?: string }).stderr ?? err);
      if (msg.includes('no such table')) return null; // DB predates the curve artifact
      if (msg.includes('no such column')) {
        // DB predates the position column — re-query NAV only so older runs still chart.
        rows = await sqliteJson(
          db,
          `SELECT dates, nav FROM equity_curves
           WHERE run_date = '${runDate}' AND algorithm = '${algorithm}' AND period = '${period}'`,
        );
      } else throw err;
    }
    if (rows.length === 0) return null;
    const r = rows[0] as { dates: string; nav: string; position?: string | null };
    return {
      dates: JSON.parse(r.dates) as string[],
      nav: JSON.parse(r.nav) as number[],
      position: r.position ? (JSON.parse(r.position) as number[]) : null,
    };
  });

  ipcMain.handle('evolution:start', async (_e, name: string) => {
    const ws = poller.current().find((r) => r.name === name);
    if (!ws) throw new Error(`unknown workspace: ${name}`);
    await host.startEvolution(ws.name, ws.path);
    await poller.poll();
  });

  ipcMain.handle('evolution:stop', async (_e, name: string) => {
    host.kill(sessionName(name));
    // kill-session is async fire-and-forget; give tmux a beat before re-listing
    await new Promise((r) => setTimeout(r, 300));
    await poller.poll();
  });

  // Adhoc session: plain claude in the workspace dir, run alongside evolution.
  ipcMain.handle('adhoc:start', async (_e, name: string) => {
    const ws = poller.current().find((r) => r.name === name);
    if (!ws) throw new Error(`unknown workspace: ${name}`);
    await host.startAdhoc(ws.name, ws.path);
    await poller.poll();
  });

  ipcMain.handle('adhoc:stop', async (_e, name: string) => {
    host.kill(adhocSessionName(name));
    await new Promise((r) => setTimeout(r, 300));
    await poller.poll();
  });

  // One attach client per session; re-attach replaces the old client. The
  // renderer passes full session ids (evolve-<dir> / greenhouse-<tool>).
  const attaches = new Map<string, AttachHandle>();
  ipcMain.handle('session:attach', (_e, id: string, cols: number, rows: number) => {
    attaches.get(id)?.close();
    const handle = host.attach(id, cols, rows);
    attaches.set(id, handle);
    const { port1, port2 } = new MessageChannelMain();
    handle.onData((chunk) => port1.postMessage(chunk));
    port1.on('message', (e) => {
      const msg = e.data as
        | { type: 'input'; data: string }
        | { type: 'resize'; cols: number; rows: number };
      if (msg.type === 'input') handle.write(msg.data);
      else handle.resize(msg.cols, msg.rows);
    });
    port1.start();
    handle.onClose(() => {
      port1.postMessage({ __eg: 'detached' });
      port1.close();
      attaches.delete(id);
    });
    win()?.webContents.postMessage('session:port', { attachId: id }, [port2]);
    return { ok: true };
  });

  ipcMain.handle('session:detach', (_e, id: string) => {
    attaches.get(id)?.close();
    attaches.delete(id);
  });

  ipcMain.handle('session:scroll', (_e, id: string, dir: 'up' | 'down', lines: number) =>
    host.scroll(id, dir, lines),
  );

  ipcMain.handle('session:unstick', (_e, id: string) => host.unstick(id));

  // NAV artifact for one candidate: <workspace>/equity/<id>.csv, written by the
  // trading-strategies evaluator since 2026-06-11. Columns are date,nav with an
  // optional third position column (signed % of portfolio, long +/short −) added
  // 2026-06-26 — present only on artifacts written since, so the walk-forward
  // chart draws the position pane for re-evaluated candidates and stays 2-pane
  // otherwise. Null when absent — older candidates predate the artifact entirely.
  ipcMain.handle('workspace:equity', (_e, name: string, candidateId: string) => {
    const ws = poller.current().find((r) => r.name === name);
    if (!ws) throw new Error(`unknown workspace: ${name}`);
    if (!/^[\w.-]+$/.test(candidateId)) throw new Error(`bad candidate id: ${candidateId}`);
    const file = path.join(ws.path, 'equity', `${candidateId}.csv`);
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return null; // no artifact for this candidate
    }
    const dates: string[] = [];
    const nav: number[] = [];
    const position: number[] = [];
    let hasPosition = true; // false the moment any row lacks a finite position
    for (const line of text.split('\n').slice(1)) {
      const [d, v, p] = line.split(',');
      if (!d || v === undefined) continue;
      const n = Number(v);
      if (!isFinite(n)) continue;
      dates.push(d);
      nav.push(n);
      const pn = p === undefined ? NaN : Number(p);
      if (isFinite(pn)) position.push(pn);
      else hasPosition = false;
    }
    if (dates.length < 2) return null;
    return { dates, nav, position: hasPosition && position.length === nav.length ? position : null };
  });

  // Buy & hold benchmarks for the detail-page period table. Computed straight
  // from the raw price CSVs the evaluator already trades on — no re-run, works
  // retroactively on every workspace. Null = honest absence (not a single-symbol
  // trading workspace, or no price data under any root).
  // Parsed price series cached by path + mtime; raw CSVs refresh ~daily.
  const priceCache = new Map<string, { mtimeMs: number; series: PricePoint[] }>();
  const loadPriceSeries = (file: string): PricePoint[] => {
    const st = fs.statSync(file);
    const hit = priceCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.series;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const header = lines[0]?.split(',') ?? [];
    const di = header.indexOf('date');
    const ci = header.indexOf('close');
    const series: PricePoint[] = [];
    if (di >= 0 && ci >= 0) {
      for (let k = 1; k < lines.length; k++) {
        const f = lines[k].split(',');
        const date = f[di];
        const close = Number(f[ci]);
        if (date && isFinite(close)) series.push({ date, close });
      }
    }
    series.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    priceCache.set(file, { mtimeMs: st.mtimeMs, series });
    return series;
  };
  // Latest dated <root>/data/raw/<SYM>_1d_*.csv across the configured roots.
  const latestPriceFile = (symbol: string): string | undefined => {
    const re = new RegExp(`^${symbol}_1d_.*\\.csv$`);
    for (const root of effPrefs().roots) {
      const dir = path.join(root, 'data', 'raw');
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      const match = names.filter((n) => re.test(n)).sort();
      if (match.length) return path.join(dir, match[match.length - 1]);
    }
    return undefined;
  };
  // Traded symbol for a workspace, from its evaluator.py's `symbol="..."`.
  const workspaceSymbol = (wsPath: string): string | undefined => {
    try {
      const text = fs.readFileSync(path.join(wsPath, 'evaluator.py'), 'utf8');
      return text.match(/symbol\s*=\s*["']([A-Za-z0-9.]+)["']/)?.[1];
    } catch {
      return undefined;
    }
  };
  ipcMain.handle('workspace:benchmark', (_e, name: string) => {
    const ws = poller.current().find((r) => r.name === name);
    if (!ws) throw new Error(`unknown workspace: ${name}`);
    const symbol = workspaceSymbol(ws.path);
    if (!symbol) return null; // not a single-symbol trading workspace
    const instFile = latestPriceFile(symbol);
    const spyFile = latestPriceFile('SPY');
    if (!instFile || !spyFile) return null; // no price data under any root
    const inst = loadPriceSeries(instFile);
    const spy = loadPriceSeries(spyFile);
    if (inst.length < 2 || spy.length < 2) return null;
    return { symbol, periods: benchmarkReturns(inst, spy) };
  });

  ipcMain.handle('prefs:get', () => prefs.get());
  ipcMain.handle('prefs:set', async (_e, patch) => {
    const p = prefs.set(patch);
    nativeTheme.themeSource = p.theme;
    await poller.poll();
    return p;
  });
}
