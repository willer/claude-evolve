# Evolve Greenhouse — Plan

## v1

- [x] Repo scaffold: Electron + TypeScript + esbuild, FleetView-style layout
- [x] core/csv: evolution.csv parser + workspace stats (leader, per-gen bests,
      sparkline series, success rate) with vitest coverage
- [x] core/state: pane-motion session classification (working/waiting/asking),
      shared `evolve-<dir>` tmux naming with the autostatus TUI
- [x] main: Poller (discover → parse → classify → push), SessionHost (tmux owns
      sessions, node-pty attach), prefs store, IPC + MessagePort terminal wiring
- [x] renderer: card grid (leader, metrics, sparkline, health, actions),
      detail view (leader metrics, generation table, big sparkline), xterm attach
- [x] Start/stop evolutions (claude + /evolve in detached tmux)
- [x] Native notification on asking transition
- [x] Verify against live trading-strategies workspaces (EG_SHOT screenshots;
      core stats cross-checked against a Python reference on 1d-htqqq-inv —
      exact match)

## v2 — list mode, health, keyboard (current)

- [x] core: classifyHealth — one verdict per workspace (good / plateau /
      failing / stuck / error), autostatus thresholds (>20 gens▲, <80% 5gOK,
      >12h stale while running), with tests
- [x] List mode as the default view (autostatus-style table, sortable column
      headers with ▲/▼); grid kept as a session-only toggle (v) — every
      launch starts in the list
- [x] Theme selector: system / dark / light, persisted; nativeTheme drives a
      prefers-color-scheme CSS palette (charts use CSS vars so they adapt;
      the terminal stays dark in light mode)
- [x] Sort by score by default (the cross-workspace comparable, streamlit-
      report convention); CAGR sort removed — timeframe-dependent metrics
      don't compare across workspaces
- [x] Health chip + health-colored sparklines + alert counts in the header
      totals (asking/failing/stuck/plateau)
- [x] Keyboard-first navigation: j/k/↑↓ cursor, ⏎ open detail (+auto-attach,
      unfocused so stray keys can't reach claude), a attach focused, Space
      peek, v view toggle, s star, r refresh, esc back, ⌘esc back even from a
      focused terminal; hint bar shows bindings
- [x] Quick-status peek (Space): leader ratios (Sharpe/Sortino/CAGR/MaxDD/win
      rate/pain/…), returns by year from return_YYYY columns, run stats
- [x] Detail: leader returns-by-year bars + year-returns-by-generation line
      chart (best of gen, per return_YYYY column, with legend)
- [x] One-key approve/deny for asking sessions (✓1/✗2 buttons + 1/2 keys →
      tmux send-keys), in list rows, cards, and the detail bar
- [x] EG_SHOT harness extended: list → peek → grid → detail (auto-attached
      terminal verified rendering a live session)
- [ ] Hands-on verify terminal typing + wheel scroll on a live session (the
      harness attaches read-only; keystroke verification needs a human)

## v3 — NAV over time

- [x] trading-strategies evaluator (37412cbf69): persist the stitched OOS
      walk-forward NAV series per candidate to equity/<id>.csv (backtest.py
      --json already emitted dates/equity_curve; it was being discarded)
- [x] NAV chart in detail + peek: NAV line, underwater drawdown pane, year
      gridlines, total/maxDD summary; honest "no artifact" note for leaders
      evaluated before the evaluator update
- [x] EG_ROOTS test seam + synthetic-workspace verification
- [ ] equity/ dir retention: artifacts accrue ~50KB per evaluated candidate
      with no pruning yet — revisit (prune to top-N + recent, claude-evolve
      side) before workspaces hit thousands of post-update candidates

## v4 — backtest dashboard + repo tools

- [x] core/backtests: TS port of scoring.py's "By Algorithm" ranking (weighted
      geometric mean of capped AA/Pain, qual%) — expected values in tests come
      from running the python reference directly
- [x] main: backtests:summary reads data/backtest-results.db via the sqlite3
      CLI (read-only, JSON out — no native sqlite dep next to node-pty);
      defaults to the latest run with >10 algos, like the streamlit dashboard
- [x] Backtests view (b key / 📊 header button): ranked algo panels with
      per-period CAGR/Pain/AA-P/Sharpe/Risk/Turnover tables, run-date
      selector, ✅ qual badges; algorithm names link to the matching evolution
      workspace when it's under a configured root
- [x] Repo tool sessions: inference-all / backtest-all launch in their own
      greenhouse-<key> tmux sessions (shell-stays-alive, like evolutions);
      header buttons (shown when the executable exists in a root) open a tool
      page with run/stop + terminal attach
- [x] session:attach/scroll take full session ids (evolve-<dir> /
      greenhouse-<tool>) — renderer wraps names via sessionName/toolSessionName
- [x] EG_SHOT extended: backtests.png + tool.png (both read-only)

## v5 — report integration + NAV per period

- [x] trading-strategies (d7ec0bea76): backtest-all persists per-period NAV
      curves to a new equity_curves table (single runs keep backtest.py's
      curve; walk-forward phases stitch yearly curves by chaining); pruned to
      the 3 most recent runs. Schema is a lockstep contract with
      backtests:equity.
- [x] Backtests view: period rows toggle their NAV chart (lazy-fetched,
      cached; honest absence note for runs predating the table); appendix
      panel — flagged algorithms + reasons, the report's flag section
- [x] Per-workspace integration (workspace dir == algorithm): BT score column
      in the fleet list (sortable), BT score/qual in the peek Run grid, and a
      full Backtest panel in detail (rank, score, qual, ⚑ appendix reasons,
      period table with NAV toggles, pinned to the latest run)
- [x] EG_ROOTS seam now also covers ipc data lookups (backtest DB) — synthetic
      runs no longer read the real repo's database
- [x] EG_SHOT: backtests-nav.png (toggled period chart); verified end-to-end
      against a synthetic curve-bearing DB and against live data
- [ ] Real-data NAV charts appear after the next backtest-all run (the
      2026-06-09 run predates the equity_curves table)

## v6 — session ergonomics + health retune (operator feedback)

- [x] Self-healing terminal attach in detail (start-from-detail / enter-early
      no longer leaves a blank session panel)
- [x] Evolution launches: --permission-mode auto, forced; claude exit now
      exits the tmux session (`; exit`), so the app flips to stopped on the
      next poll — post-mortem shell inspection dropped by operator decision
- [x] Health retune: failing = >3 failures in the last 2 generations (count,
      not rate — AI-supervised coding makes failures rare, moderate attrition
      is normal); stuck renamed stalled and demoted to yellow (a plate that
      stopped spinning — attach and nudge); failing outranks stalled
- [x] "stalled" renamed "idle", then "idle" renamed "stale" (2026-06-28) — the
      verdict is about the RUNNER (claude process quiet >12h), not the evolution
      search; "stalled" misread as the search plateauing, and "idle" misread as
      the agent's `waiting` activity. Level key + label + CSS + totals + rank +
      color all renamed; hover detail leads with the CSV age
- [x] Pane classifier fixes (2026-06-28, core/state.ts): REST hint ("new task?")
      in the live footer vetoes the BUSY "N shells" marker so a finished session
      with an orphan shell reads `waiting` not `working`; STUCK markers scoped to
      the recentBand (last 2 spinner cycles) so a resolved spend-limit blip in
      scrollback no longer false-flags a self-converged session as `stuck`
- [x] Badge order unified across list/grid/detail/peek: activity badge, then
      health chip (was reversed in detail/grid/peek vs the list view)
- [x] Removed one-key ✓1/✗2 answer machinery (buttons, 1/2 keys, IPC,
      sendKeys) — asking still badges + notifies; answer in the terminal

## Later

- [ ] Monthly/quarterly per-timeframe returns table like the streamlit
      reports (derivable from the equity artifact now)
- [ ] Aggregate header sparkline (fleet-wide best-score trend)
- [ ] Windows: ConPTY session host (FleetView's SessionHost seam applies)

Dropped: log tail panel — the tmux pane is the log, and the embedded terminal
already shows it live with scrollback.
