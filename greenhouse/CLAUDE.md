# Evolve Greenhouse

Electron dashboard for claude-evolve workspaces — the GUI descendant of
`claude-evolve` autostatus → `~/GitHub/trading-strategies/autostatus` (curses
TUI) → `~/GitHub/genome-fleet-commander` (FleetView). Architecture is a
deliberate FleetView mirror: read those repos before inventing new patterns.

Lives at `claude-evolve/greenhouse/` — it's the GUI for the claude-evolve
engine (the Python/skill side ideates/codes/scores; this observes the resulting
workspaces and drives their tmux sessions). It is engine-agnostic: the
trading-specific bits (NAV charts, backtest dashboard, ratio panel) are one
*profile*, not the core. Point it at any directory of claude-evolve workspaces
(evolution.csv each) via the Roots control. See "Profiles" below.

## Profiles

Each workspace gets a display profile (`src/core/profile.ts`, pure + tested):
- **trading** — the canonical ratio panel (`TRADING_METRICS`) + NAV/backtest
  chrome (which only lights up where its artifacts exist).
- **generic** — just lists whatever numeric columns the evaluator emits.
- a custom name (e.g. **forecasting**) with caller-supplied metric labels.

Resolution order (`resolveProfile`): an explicit `dashboard:` block in the
workspace's `config.yaml` wins; absent that, auto-detect — trading if an
`equity/` dir or stock-shaped columns (`sharpe`, `return_YYYY`, …) are present,
else generic. Malformed YAML falls back to auto-detect (never blanks the fleet).

```yaml
# config.yaml (optional block — claude-evolve ignores it; the dashboard reads it)
dashboard:
  profile: forecasting
  metrics:
    - {col: mape, label: MAPE, pct: true}
    - {col: rmse, label: RMSE}
```
The Poller reads config.yaml per workspace and attaches the resolved profile to
each WorkspaceRow; the renderer's `ratioMetrics` renders `profile.metrics` in
order, then any remaining columns generically. Trading output is byte-identical
to before the profile split — verify against the screenshot harness.

## Layout

- `src/core/` — pure logic, Electron-free, all unit tests live here
  - `csv.ts` — evolution.csv parser + WorkspaceStats (leader, per-gen bests,
    sparkline series, 5-gen success rate). Tie-break: highest score, then
    earliest id. A 0.0 score is a real score, NOT a failure.
  - `backtests.ts` — TS port of trading-strategies/scoring.py's "By Algorithm"
    aggregate score + qual%. Test expectations come from the python reference;
    if scoring.py's weights/caps change, change this in lockstep. The
    equity_curves table (per-period NAV + optional signed position %, written
    by backtest-all since 2026-06-11; position column added 2026-06-17) is the
    other lockstep contract — see backtests:equity in ipc. The `position`
    series is emitted by backtest.py's --json (always, aligned 1:1 with nav)
    and persisted by backtest-all (nullable; older runs / per-candidate
    artifacts carry none, so navChartSvg falls back to its 2-pane layout).
  - `state.ts` — tmux pane-motion classification (working/waiting/asking) and
    the `evolve-<dir>` session naming. Both are a SHARED VOCABULARY with the
    trading-strategies TUI — change them in lockstep or the two tools stop
    adopting each other's sessions.
- `src/main/` — Poller (discover→parse→classify→push, mtime-cached),
  SessionHost (tmux owns sessions; node-pty is only the attach transport),
  ipc.ts (terminal bytes ride a MessagePort, never JSON IPC), prefsStore.
- `src/renderer/` — single-page card grid + detail view + xterm attach.
  The terminal DOM node (`#term-wrap`) must survive re-renders — it's moved,
  not rebuilt, on each fleet:update.
- `src/preload.ts` — the only renderer↔main surface. IPC listeners register at
  module top level (lazy registration drops early MessagePorts).

## Commands

```bash
npm start            # build + launch
npm test             # vitest, core/ only
npm run typecheck
EG_SHOT=shots npm start   # screenshot harness (WEBTESTS.md) — side-effect-free
```

## Gotchas

- node-pty is rebuilt for Electron's ABI (`npm run rebuild-native`) — plain
  `node` cannot load it; that's why tests never touch main/.
- Sandboxed npm installs can skip Electron's binary download. Fix: extract
  `~/Library/Caches/electron/*/electron-v*.zip` into
  `node_modules/electron/dist/` and write `path.txt` containing exactly
  `Electron.app/Contents/MacOS/Electron` — NO trailing newline (printf, not echo).
- Evolution launch = detached tmux session in the workspace dir, then
  send-keys `claude --model opus --effort medium --dangerously-skip-permissions
  "run the /evolve skill"` — typed, not passed to new-session, so the shell
  survives claude exiting and the pane stays inspectable post-mortem.
- Evaluator metrics are generic: any non-core numeric CSV column becomes a
  metric. Extreme values (Sharpe 365 in 1d-htqqq-inv) are real data — display
  faithfully, never clamp.

## State / next steps

Tracker: `docs/PLAN.md`. v1–v4 verified against live data (core stats and
backtest scoring both cross-checked exactly against Python references).
v4 added repo tool sessions (inference-all / backtest-all in greenhouse-<key>
tmux). Backtest scoring (the streamlit By Algorithm port over
data/backtest-results.db via sqlite3 CLI) lives in core/backtests.ts and now
surfaces ONLY inside each workspace's detail Backtest panel — the standalone
"Backtests" page/button/`b` key was removed (the data is per-evolution, so it
belongs in the detail view). Detail/backtest
charts are now fluid — sized from the live column width (panelInnerW) and
repainted on window resize, no baked-in pixel widths. The detail view shows
a "Leader NAV by period" small-multiples panel (one navChartSvg per backtest
period — YTD 2026 / Cal 2025 / OOS / 2022+ / Long-Term, from equity_curves,
fresher than the walk-forward artifact); the single artifact chart is
relabeled "walk-forward OOS" since the stitched per-year test slices
genuinely span the full history. Each workspace now has TWO independent
sessions: the evolution session (evolve-<dir>, claude /evolve) and an adhoc
session (adhoc-<dir>, a plain `claude` with no prompt, for poking at the
workspace by hand). The fleet list/grid expose separate Evolve and Adhoc
start/stop controls (no Attach button — click the row to open the detail);
the detail view stacks both session terminals on the right and the renderer
now drives MULTIPLE live xterms at once (terms Map keyed by session id,
MessagePort routed by meta.attachId), not the old single-terminal global.
Dragging a file onto a terminal types its path into that session (preload
webUtils.getPathForFile — File.path is gone in Electron 39; a window-wide
drop preventDefault stops Electron from navigating to the file:// URL). The
workspace health verdict for a RUNNER quiet >12h (claude process quiet via CSV
mtime, not the evolution search) is "stale" — renamed from "idle" (and earlier
"stalled") because "idle" read as the AGENT's `waiting` activity; the hover
leads with the CSV age. Two pane-classifier fixes (core/state.ts, 2026-06-28):
(1) the idle-composer REST hint ("new task?" / "/clear to save") in the live
footer vetoes the BUSY "N shells" marker — a finished session with one orphan
background shell now reads `waiting`, not a pinned-forever `working`; (2) the
hard-wall STUCK markers (spend/usage limit) are scoped to the recentBand (last
two spinner-line cycles), so a spend-limit blip that was hit, resolved, and
buried under a full recovery turn + the final report no longer false-flags a
self-converged session (e.g. ev-1d-vt) as `stuck`. Badge order is unified
across list/grid/detail/peek: session activity badge first, then health chip. The detail-view backtest period table now appends a buy&hold comparison
(single-symbol trading workspaces only): Ret (strategy total return from the
period NAV) next to SPY B&H and <SYM> B&H, computed by the workspace:benchmark
IPC straight from data/raw/<SYM>_1d_*.csv over each period window (SPY measured
over the instrument's own window so differing inceptions stay comparable). It's
retroactive (reads raw prices, no re-run) and absent when the workspace has no
resolvable symbol. Period bounds mirror backtest-all (core/backtests.ts
PERIOD_BOUNDS — LOCKSTEP). Terminal wheel-scroll: xterm handles the wheel
natively (NO custom handler) and forwards it as a mouse sequence to the attached
app. claude runs in the alternate screen with mouse tracking on, so tmux keeps
ZERO scrollback for its pane (`history_size` 0) — the earlier copy-mode hijack
scrolled a buffer that didn't exist and, by returning false, stopped the wheel
ever reaching claude, so claude couldn't scroll its own conversation. tmux
`mouse off` means tmux forwards mouse events to the app instead of grabbing them.
The old `session:scroll` IPC / `SessionHost.scroll` / copy-mode path is deleted.
Detail-view NAV charts (leader walk-forward + per-period) open an INTERACTIVE
viewer (drag/shift-wheel pan, wheel/± zoom, reset) that re-slices the series so
the Y axis autoscales and the return/CAGR/maxDD/Sharpe badge reflect the visible
window; every other chart still uses the static enlarge. Unverified (need a
human with a real wheel + live claude session): that claude now scrolls on wheel.
Open: equity/ artifact retention (claude-evolve side).
