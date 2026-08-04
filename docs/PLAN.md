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
