- [T] move the terminal windows so they're within tabs, with indicators whether the terminals are active for each type or not. it's hard to work with having to scroll the main window to get to the 2nd and 3rd terminal
  > ✅ **DONE**: The detail view's three stacked session panels (Evolution /
  > Adhoc / Shell) are now ONE panel with a tab strip and a single tall terminal
  > (74vh) — the 2nd and 3rd sessions no longer sit below the fold. Each tab
  > carries an activity dot in the badge vocabulary (green working / yellow
  > waiting / magenta asking / red stuck / hollow when stopped), so the two
  > hidden sessions stay legible at a glance. Opening a workspace lands on the
  > first RUNNING session (evolution first); `1`/`2`/`3` or a click switch tabs
  > without stealing terminal focus. Only the VISIBLE tab holds a tmux client —
  > tmux runs `window-size latest`, so an attach inside a `display:none` pane
  > (0×0) would resize the session for every other client; leaving a tab detaches
  > it and returning re-attaches (a ResizeObserver guard also ignores zero-size
  > fits). Tab picking + indicator mapping are pure and unit-tested
  > (`core/state.ts` `pickSessionTab` / `sessionDotClass` / `SESSION_KINDS`, 5 new
  > tests; 59/59 green). The screenshot harness now switches to Shell and back,
  > logging `session-tab shell={"active":"shell-pane","terms":0}` →
  > `back={"active":"evolution-pane","terms":1}` — verified live, along with
  > `focus-after-poll=true` surviving the round trip.
- [x] change Greenhouse to understand the new method of pinning, in cases where an algo is being used by inference-all mixed with another one. there's a different pinning there, which it doesn't show.
- [x] change greenhouse to use the same X axis for best score by generation and year returns by generation (using the min(min) and max(max)) of the two
- [x] in the algorithm summary, if there's an ulcer index field in the csv, display that in the summary info along with stuff like matspain (you'll need to check the field name in an existing csv, I forget the name)
- [x] in greenhouse, when the non-winning algo is pinned, show the charts and stats for both pinned and winner — a tab selection at the top, defaulting to winner but also allowing the pinned one
  > ✅ **DONE** (2026-08-29): a Winner / Pinned tab strip above the detail summary
  > panel, present only when inference-all pins a different algo than the leader.
  > Pinned swaps the summary, walk-forward NAV chart, and returns-by-year bars to
  > the pinned row (`p` toggles); the pinned row is resolved in `core/csv.ts`
  > `computeStats(text, pinId)` → `stats.pinned` (pure, unit-tested; 95/95 green,
  > typecheck clean). Verified via the EG_SHOT harness against a synthetic pinned
  > root: `focus-pinned head="Pinned — gen02-001 · 1.6000 production pin deployed"`.
- [x] change the coder helper/judge to run on opus medium rather than fable low. even if fable is more efficient, it has its own separate session limit and that's getting hit sooner than the global one.
  - Pinned `plugin/agents/coder.md` to model opus / effort medium (was fable / low) and updated the matching prose in the evolve and evolve-code skills plus plugin README; plugin version bumped to 0.3.1.
  - The `run-LLM` CSV tag the worker writes when it codes a candidate itself is now `opus` instead of `fable`; old rows keep saying `fable` because that is what actually coded them, and the column is free text so nothing needed migrating.
  - Deliberately left ideation alone — the ideator agent and the fable/codex/grok dice roll are unchanged; if the loop misbehaves, check first that the coder subagent really launches on Opus (the evolve skill must still pass NO `model` override, letting the agent definition win).
- [x] change the charts when they're in zoomed mode to not use a static image, and instead use an active chart that lets me mouse over the data points and see the exact X and Y values at that point. presumably some standard chart widget would fit the bill on this.
  - Every enlarged chart (best-score sparkline, year-returns multi-line, and both NAV views) now snaps a crosshair to the nearest x under the pointer, dots each series on its own line, and shows a tooltip with the exact values — gen number or ISO date on X, score / per-year return / return+drawdown+position on Y.
  - Deliberately did NOT add a chart library: the hit-test geometry is 40 lines of pure code in `core/hover.ts` (unit-tested), while porting the three-pane NAV layout and the shared generation domain into Chart.js would have been a rewrite; tile-sized charts also deliberately keep no hover, so the fleet list stays cheap.
  - If it misbehaves, check the EG_SHOT harness lines `zoom-hover=` / `year-hover=` / `nav-hover=` first — a `tip:null` means the chart stopped publishing its hover columns (only the `axes`/enlarged render path publishes them, and the overlay must read them via `takeHoverCols()` immediately after the render call).
