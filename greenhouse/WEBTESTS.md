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
(quick-status popover), opens the
first tool page for `shots/tool.png` (never presses ▶ Run), toggles to the
grid for `shots/grid.png`, then clicks the first card for `shots/detail.png`
(auto-attaches the terminal when the session is running), then clicks a detail
chart to enlarge it for `shots/detail-zoom.png` (the overlay repaints the chart
at full size with a labeled Y-axis gutter), then opens the leader NAV chart in
the interactive viewer for `shots/detail-zoom-nav.png` (full range: %-return Y
gutter, start→end ISO date range top-left, return/maxDD/Sharpe badge, and the
signed-position pane when the equity artifact carries one), clicks `+` three
times for `shots/detail-zoom-nav-in.png` (the time window narrows about its
centre and the Y axis + date range + return/maxDD/Sharpe badge all recompute to
the visible slice — proves it's a live chart, not a static enlarge), pressing
Escape after each. Then quits. NAV charts (leader + per-period) open this
interactive viewer; every other chart uses the static enlarge.
Read-only: it never clicks action buttons (start/stop/run/answer).

The interactive NAV viewer pans (drag, shift-wheel) and zooms (wheel about the
cursor, `±` buttons about centre, `reset` to full) a time window over the full
series; each interaction re-slices and re-renders, so the Y axis autoscales and
the return/maxDD/Sharpe stats reflect only the visible window (drawdown is the
worst peak-to-trough *within* the window, not all-time).

`EG_ROOTS=/path/a:/path/b` overrides the scanned roots without touching saved
prefs — point it at a synthetic workspace (evolution.csv + equity/<id>.csv)
to verify the NAV chart deterministically.

## Checklist (verify in screenshots)

- [ ] List (default view): every workspace under the configured roots appears
      as a row, sorted by score descending
- [ ] List: column headers sort on click with ▲/▼ indicator; health chip
      (ok/plateau/idle/failing/error) and state badge render per row;
      sparkline stroke matches health color (green/yellow/red)
- [ ] Header is two rows: row 1 = brand + totals (left) and CPU/LOAD/MEM
      host-load gauges (right); row 2 = tool buttons (left) and search +
      list/grid segmented toggle + theme icon button + ⚙ Config (right).
      Sticky list/peek offsets sit just below the (taller) header — no overlap
- [ ] List/grid segmented toggle: two joined pill buttons (☰ / ⊞); the active
      one is filled blue; clicking switches view; the `v` key toggles too
- [ ] Theme icon button cycles system (◐) → dark (●) → light (○) on click,
      title reflects current; no sort dropdown, no refresh button, no
      Backtests button (backtests are inside each workspace's detail view)
- [ ] Starred ★ markers are large and clearly visible in both list and grid
- [ ] Header host-load gauges: CPU% / 1-min loadavg / MEM% each with a
      fixed-scale sparkline that fills over ~minutes; value color greens→
      yellow→red as load climbs
- [ ] Header totals: workspace/running counts plus asking/failing/idle/
      plateau counts in their alert colors
- [ ] Peek (Space): leader ratios grid, returns-by-year bars (return_YYYY
      columns), best-score sparkline, run stats
- [ ] Grid: cards carry health chip + state badge; leader id + score; metrics
      row (CAGR/Sharpe/MaxDD/latest year) when the evaluator emits them
- [ ] Asking sessions: magenta badge + native notification; answering happens
      in the attached terminal (no remote answer buttons — the CLI owns its
      own question asking)
- [ ] Stuck sessions (byte-static on a spend/usage-limit wall): red badge +
      native "is stuck" notification + header `N stuck` count. The badge is a
      red-outlined "⚠ unstick" BUTTON (list, grid, and detail bar / session
      control rows) — clicking it sends Esc + "continue please" + Enter to that
      tmux session (api.session.unstick), then refreshes; clicking it must NOT
      open the detail view
- [ ] Stale CSV (>12h) age renders red; gens-since-top >20 renders red; 5-gen
      success <80% renders red
- [ ] Detail: generation table latest-first, leader row highlighted green;
      leader returns-by-year bars; year-returns-by-generation chart with
      legend when ≥2 gens have year data
- [ ] NAV chart (detail + peek, needs equity/<leader-id>.csv): NAV line with
      year gridlines/labels, red underwater drawdown pane, +total%/maxDD
      summary; honest "no NAV artifact" note when the file is absent
- [ ] Position pane (backtest equity_curves charts only, when the run recorded
      a 1:1 position series): a middle pane between NAV and drawdown — green
      fill above / red fill below a zero baseline (long +, short −) with the
      exposure line and a "position ±N%" tag; zoomed it gains +N%/0% Y labels.
      Falls back to the 2-pane NAV/drawdown layout for the per-candidate
      artifact and for older runs whose position column is NULL
- [ ] Detail "Leader NAV by period" panel (when the workspace has a latest-run
      backtest entry): one small-multiple navChartSvg per period (YTD 2026 /
      Cal 2025 / OOS 7/25+ / 2022+ / Long-Term), each captioned with its own
      total%/maxDD; tiles size to the column and wrap
- [ ] Detail backtest period table buy&hold columns (single-symbol trading
      workspace only): Ret (strategy total return from NAV) + SPY B&H + <SYM>
      B&H, computed in workspace:benchmark from data/raw/<SYM>_1d_*.csv over each
      period window. Absent (no extra columns) when the workspace has no
      resolvable symbol / no price files
- [ ] Fluid charts: detail + backtest NAV/sparkline/year charts fill the column
      width (no fixed ~560/720px box) and reflow on window resize
- [ ] Click-to-enlarge (any chart-zoom chart, detail-zoom.png): the overlay
      repaints at full size with a labeled Y-axis gutter — best-score sparkline
      shows min/max score, year-by-gen chart shows min/max/0, NAV-by-period
      tiles gain the %-return gutter (they have none at tile size); Escape or a
      backdrop click closes it
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
- [ ] Detail Backtest panel: clicking a period row toggles its NAV chart (▸/▾
      caret); chart shows total/maxDD summary and underwater pane, plus axis
      labels (Y = %-return-vs-start gutter, X = start/end dates or year ticks);
      runs without curves show the honest absence note
- [ ] Per-workspace join: BT column in the list (sortable, '—' when the dir
      isn't in the latest run), BT score/qual in the peek Run grid, Backtest
      panel in detail (rank/score/qual, ⚑ flag reasons, NAV toggles)
- [ ] Detail Backtest panel names the tested champion ("testing <name>") and
      notes whether it's the current leader: green ✓ when the backtested
      candidate id matches the live leader, yellow ⚠ "re-run backtest-all"
      when it lags (backtest-all scored an older champion)
- [ ] EG_ROOTS run shows ONLY synthetic data everywhere, including the detail
      Backtest panel (the seam covers ipc DB lookups)
- [ ] Header tool buttons (⚒ inference-all / backtest-all) appear when the
      executable exists in a root; ● + green border while running
- [ ] Tool page: stopped shows ▶ Run + the script's cwd; running shows the
      stop button and attaches the greenhouse-<key> session terminal
- [ ] Scroll reset: opening detail/tool from a scrolled-down fleet
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
      immediately), * stars; s also works in detail view
- [ ] Terminal (hands-on): click/⏎ focuses; typing reaches the session; wheel
      scrolls tmux history (every attached session incl. tool pages like
      backtest-all — via xterm's custom wheel hook → tmux copy-mode); ⌘esc
      backs out even while focused
- [ ] Terminal file drop (hands-on): dragging a file (e.g. a Desktop
      screenshot) onto a session terminal types its absolute path into that
      session (space-containing paths single-quoted), then focuses it; a drop
      anywhere off a terminal is swallowed (the window must NOT navigate to the
      file — that would blank the app)
