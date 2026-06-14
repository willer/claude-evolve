# Evolve Greenhouse — UI verification

## Screenshot harness

```bash
EG_SHOT=shots npm start
```

Captures `shots/list.png` (default fleet list, per the theme pref), forces
both themes for `shots/list-light.png` and `shots/list-dark.png` (via
nativeTheme only — the pref is untouched), scrolls the list to the bottom
and clicks the last row for `shots/detail-from-scrolled-list.png` (logs
`scroll-reset pre-click=… detail=…`; detail must be 0 — views always open
at the top), presses Space for `shots/peek.png`
(quick-status popover), presses b for `shots/backtests.png` (backtest
dashboard — reads data/backtest-results.db with sqlite3 -readonly), clicks the
first period row for `shots/backtests-nav.png` (NAV chart, or the honest
absence note when the run predates the equity_curves table), opens the
first tool page for `shots/tool.png` (never presses ▶ Run), toggles to the
grid for `shots/grid.png`, then clicks the first card for `shots/detail.png`
(auto-attaches the terminal when the session is running), then quits.
Read-only: it never clicks action buttons (start/stop/run/answer).

`EG_ROOTS=/path/a:/path/b` overrides the scanned roots without touching saved
prefs — point it at a synthetic workspace (evolution.csv + equity/<id>.csv)
to verify the NAV chart deterministically.

## Checklist (verify in screenshots)

- [ ] List (default view): every workspace under the configured roots appears
      as a row, sorted by score descending
- [ ] List: column headers sort on click with ▲/▼ indicator; health chip
      (ok/plateau/idle/failing/error) and state badge render per row;
      sparkline stroke matches health color (green/yellow/red)
- [ ] Header totals: workspace/running counts plus asking/failing/idle/
      plateau counts in their alert colors
- [ ] Peek (Space): leader ratios grid, returns-by-year bars (return_YYYY
      columns), best-score sparkline, run stats
- [ ] Grid: cards carry health chip + state badge; leader id + score; metrics
      row (CAGR/Sharpe/MaxDD/latest year) when the evaluator emits them
- [ ] Asking sessions: magenta badge + native notification; answering happens
      in the attached terminal (no remote answer buttons — the CLI owns its
      own question asking)
- [ ] Stale CSV (>12h) age renders red; gens-since-top >20 renders red; 5-gen
      success <80% renders red
- [ ] Detail: generation table latest-first, leader row highlighted green;
      leader returns-by-year bars; year-returns-by-generation chart with
      legend when ≥2 gens have year data
- [ ] NAV chart (detail + peek, needs equity/<leader-id>.csv): NAV line with
      year gridlines/labels, red underwater drawdown pane, +total%/maxDD
      summary; honest "no NAV artifact" note when the file is absent
- [ ] Detail "Leader NAV by period" panel (when the workspace has a latest-run
      backtest entry): one small-multiple navChartSvg per period (YTD 2026 /
      Cal 2025 / OOS 7/25+ / 2022+ / Long-Term), each captioned with its own
      total%/maxDD; tiles size to the column and wrap
- [ ] Fluid charts: detail + backtest NAV/sparkline/year charts fill the column
      width (no fixed ~560/720px box) and reflow on window resize
- [ ] Evolution + adhoc columns (list) / button groups (grid): each workspace
      has independent Evolve and Adhoc start/stop controls; NO Attach button
      (click the row/card to open the detail and attach there)
- [ ] Detail: two stacked session panels on the right — Evolution and Adhoc.
      Each running session auto-attaches its terminal (unfocused); a stopped
      session shows a "▶ Start …" launch button in its slot. Both can be live
      at once; ⏎/a focuses the evolution terminal first, then adhoc
- [ ] Adhoc launch runs a plain `claude` (no /evolve prompt, no model pin) in
      the workspace dir under the adhoc-<dir> tmux session; stopping it kills
      only that session and leaves the evolution session untouched (and vice
      versa)
- [ ] Backtests (b / 📊 button): run-date selector defaults to the latest
      complete run; algo panels ranked by score with ✅ qual-100% badges;
      per-period CAGR/Pain/AA-P/Sharpe/Risk/Turnover rows; bad/ERROR risk red;
      algorithm names that match a scanned workspace link to its detail view
- [ ] Backtests: clicking a period row toggles its NAV chart (▸/▾ caret);
      chart shows total/maxDD summary and underwater pane, plus axis labels
      (Y = %-return-vs-start gutter, X = start/end dates or year ticks); runs
      without curves show the honest absence note; appendix panel lists flagged
      algorithms with reasons
- [ ] Per-workspace join: BT column in the list (sortable, '—' when the dir
      isn't in the latest run), BT score/qual in the peek Run grid, Backtest
      panel in detail (rank/score/qual, ⚑ flag reasons, NAV toggles)
- [ ] EG_ROOTS run shows ONLY synthetic data everywhere, including the
      backtests view (the seam covers ipc DB lookups)
- [ ] Header tool buttons (⚒ inference-all / backtest-all) appear when the
      executable exists in a root; ● + green border while running
- [ ] Tool page: stopped shows ▶ Run + the script's cwd; running shows the
      stop button and attaches the greenhouse-<key> session terminal
- [ ] Scroll reset: opening detail/backtests/tool from a scrolled-down fleet
      list lands at the top (harness logs `scroll-reset … detail=0`)
- [ ] Window bounds: position/size persist across launches. Seed
      `windowBounds` in prefs.json, relaunch, confirm the harness `bounds=…`
      log matches (size + y exact; x may snap once to an OS-valid pixel, then
      stays put — no per-launch drift). Off-screen saved bounds fall back to
      the default centered window.
- [ ] Hint bar lists the key bindings for the current view
- [ ] Themes: list-light.png and list-dark.png both readable — chips, badges,
      sparkline colors, and row borders adapt; terminal stays dark in light
      mode
- [ ] Keyboard (hands-on): j/k/↑↓ move the cursor, ⏎ opens detail, Space
      peeks, v toggles view, s starts/stops the session (no confirm — kills
      immediately), * stars, b opens backtests; s also works in detail view
- [ ] Terminal (hands-on): click/⏎ focuses; typing reaches the session; wheel
      scrolls tmux history; ⌘esc backs out even while focused
- [ ] Terminal file drop (hands-on): dragging a file (e.g. a Desktop
      screenshot) onto a session terminal types its absolute path into that
      session (space-containing paths single-quoted), then focuses it; a drop
      anywhere off a terminal is swallowed (the window must NOT navigate to the
      file — that would blank the app)
