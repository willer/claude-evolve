# TRUTH — what is known true about this repo

Running record of how things actually work, decisions and the reason for them, and findings
that outlive one pass. Checklist items live in `docs/PLAN.md`; long write-ups get their own
file under `docs/` and are linked from here.

## Greenhouse ↔ inference-all: production signals and pins

`~/GitHub/trading-strategies/inference-all` is the production launcher and the ONLY place
that says what actually trades. Greenhouse reads it (from the parent dir of each workspace,
mtime-cached) purely to annotate the R&D leader — it never changes what R&D resolves.

Each live signal is a python tuple `("<dir>", "<sym>", "<tf>", [flags…])`, and there are
**two** shapes:

- **solo** — `("ev-1d-soxl", …, ["--pin=gen823-001"])`. One workspace, one webhook.
- **MIXED / blend** — `("ev-1d-tqqq-high+ev-1d-htqqq", …, ["--signal-name=TQQQ-MIX",
  "--pin=ev-1d-htqqq:gen78-001", "--pin=ev-1d-tqqq-high:gen246-011"])`. The dir field is a
  `+`-joined list of workspaces whose raw signals inference.py **averages into one webhook**,
  and each leg carries its OWN pin, qualified by workspace name. A blend entry also spans
  several physical lines.

Greenhouse's original parser assumed the solo shape only and was line-based, so on a blend it
(a) never matched either workspace (the dir key was the literal `"a+b"` string), (b) missed the
pins entirely (they sit on continuation lines with no dir match), and (c) mis-captured
`ev-1d-htqqq:gen78-001` as the algo id `ev-1d-htqqq` because `:` fell outside its character
class. Net effect: the two TQQQ-MIX workspaces showed NO production pin at all — exactly the
case where the dashboard leader diverges most from what trades.

Now: `core/inferenceAll.ts` (pure, unit-tested) parses the file into
`Map<workspace, ProductionSignal{signalName, members, pin}>` — brace-balanced so multi-line
tuples are read whole, quote-aware comment stripping so a `--pin=` quoted in a comment cannot
poison a live entry, `#`-commented signals ignored (not live ⇒ not pinned), qualified pins
bound to their named member and an unqualified pin applied to every member. `productionTags()`
turns that plus the on-screen leader id into the detail-view pills. `WorkspaceRow.productionPin:
string | null` was REPLACED by `production: ProductionSignal | null` (no compatibility shim —
the old field could not express blend membership).

Blend membership is shown as its own magenta pill BEFORE the pin verdict, because it changes
what "deployed" means: the workspace drives only part of the live position, so a green
"deployed" there reads "deployed — TQQQ-MIX leg", not "this is the signal".

Verified 2026-08-04 against the real `inference-all`: 12 live tuples → 13 workspaces, every
pin resolved (including both TQQQ-MIX legs, `ev-1d-htqqq` → gen78-001 and `ev-1d-tqqq-high` →
gen246-011), and visually against a synthetic root through the `EG_SHOT` harness.

**Lockstep contract:** the tuple/flag grammar is owned by trading-strategies. If inference-all
grows a new pin or blend syntax, `core/inferenceAll.ts` must move with it or Greenhouse
silently reports a stale production picture.

## Greenhouse: the two per-generation charts share one X axis

The detail view stacks "Best score by generation" (sparkline) and "Year returns by
generation" (multi-line). Both read "by generation", so a reader compares them
left-to-right — but each can only plot the generations it has data for, and those sets
differ:

- a generation with no completed candidate has no score, so it is absent from the sparkline;
- a generation whose rows carry `return_YYYY` but never got a walk-forward score (cheap
  single-window backfill) has year points but no score point.

Both charts used to position points by ARRAY INDEX, which stretched each chart's own subset
across the same pixel width. Gen 850 then sat at 40% of one panel and 92% of the other, and
on a board with year data only on recent generations the year lines were crushed against one
edge — which read as "the year data is missing" when it was only unreadable.

Now positions come from real generation numbers on ONE domain: `core/genAxis.ts` (pure,
unit-tested) computes `sharedGenDomain([sparkGens, yearGens])` = min of the two mins, max of
the two maxes, and `chartFracs` maps each chart's generations to 0..1 positions on it. The
renderer passes `ChartX = {fracs, ax}` to `sparklineSvg` / `multiLineSvg`; both call the same
`xAxisGen`, whose ticks come from `genTicks(ax, …)` — the DOMAIN, not the point list — so the
two enlarged views print identical "gen N" labels. A vertical line through the two panels is
the same generation.

`ChartX` is optional: the tiny fleet-list/grid sparklines pass none and keep index
positioning (no axis, no sibling chart to line up with).

Related and committed with it: `GenStats.yearRow` (csv.ts) — the row that backs the year
chart, chosen by HAVING year data rather than by performance (earliest id wins, but the
generation champion wins whenever it has the columns). That is what lets a scored-but-not-
walk-forward generation appear on the year chart at all; `best` alone hid it.

Verified 2026-08-06 through the `EG_SHOT` harness against a synthetic root built for the
mismatch (scores on gens 20–40, `return_YYYY` on gens 0–30): shared domain 0–40, the score
line starts at 50% of the panel, the year lines end at 75%, and the enlarged score chart
labels 0…40. 88/88 unit tests green, typecheck clean.

## Greenhouse: the leader summary panel is pure, and knows the ulcer index

The leader "algorithm summary" (detail view, peek popover) used to build its
metric list inside `renderer.ts` (`ratioMetrics` + `fmtMetric`/`fmtSpec`/`fmtNum`),
where nothing could test it. That logic is now `core/profile.ts` `leaderMetrics()`
— pure and unit-tested; the renderer keeps a one-line alias. Its contract is
unchanged: the workspace profile's columns first, in profile order and with the
profile's labels, then every remaining evaluator column raw, with `return_YYYY`
excluded (year returns have their own section).

`TRADING_METRICS` now carries the ulcer index, placed with the other pain
measures (Pain · **Ulcer** · CAGR/Pain · Alpha/Pain). Two spellings are accepted
because two exist upstream: `backtest.py`'s metrics dict key is `ulcer` (it
prints `Ulcer: {:.2f}`), while the evolved algorithms compute `ulcer_index`.
Whichever an evaluator writes into evolution.csv gets the same "Ulcer" label and
the same slot; a workspace with neither shows neither, so this is inert until an
evaluator emits it.

It is a RAW number, not a fraction — no percent formatting. As of 2026-08-07 NO
evolution.csv under `~/GitHub/trading-strategies` has an ulcer column yet (the
closest shipped pain columns are `pain_score`, `matspain`, `cagr_pain_ratio`,
`alpha_pain_ratio`, `alpha_matspain_ratio`), so this is forward-looking by
design — before the change an ulcer column would still have appeared, but
unlabelled and trailing after unrelated columns.

Verified 2026-08-07 through the `EG_SHOT` harness against a synthetic root whose
CSV carries `ulcer`: the harness now logs `leader-metrics=[…]` (the summary's
labels in render order) and printed
`["Sharpe","Sortino","CAGR","MaxDD","Win rate","PF","Trades","Alpha","Pain","Ulcer","CAGR/Pain","matspain"]`,
confirmed on the screenshot (`ULCER 7.11` between PAIN and CAGR/PAIN). 100/100
unit tests green, typecheck clean.

## Greenhouse: Winner / Pinned focus tabs in the detail view

When inference-all pins a workspace to an algo that is NOT the evolution
leader, the detail view used to show only the leader's summary, NAV chart, and
year returns, with a yellow "not deployed — prod pins <id>" pill as the sole
trace of what actually trades. Now a tab strip sits above the summary panel:
"★ Winner · <leader id>" (default) and "📌 Pinned · <pinned id>". Pinned swaps
the summary heading/description/metric grid, the walk-forward NAV chart
(`equity/<pinned id>.csv`), and the returns-by-year bars to the pinned row;
the `p` key toggles; the focus resets to Winner each time a workspace opens.
While Pinned is shown, the production pill reads green "deployed" — the algo on
screen IS what trades — and the pinned generation's row in the generation table
is cyan with a 📌.

What does NOT switch: the per-generation charts, the generation table, and the
Backtest panel are workspace-wide (backtest-all tests whichever champion it saw),
so they stay as they were. The tab strip is absent when the workspace is
unpinned, when the pin IS the leader (one view suffices), or when the pinned id
is not in the CSV.

The pinned row is resolved in `core/csv.ts`: `computeStats(text, pinId)` sets
`WorkspaceStats.pinned` (case-insensitive id match, null when it equals the
leader). The Poller reads the inference-all signal BEFORE stats and keys its
mtime cache on the pin too, so re-pinning in inference-all refreshes the tab
without a CSV change. Pure and unit-tested; the renderer only picks `focus`.

Verified 2026-08-29 through the `EG_SHOT` harness against a synthetic root
(leader gen03-001, `--pin=gen02-001`): `focus-tabs=["★ Winner · gen03-001","📌
Pinned · gen02-001"]`, then `focus-pinned head="Pinned — gen02-001 · 1.6000📌
production pin✓ deployed"`, then `focus-winner head="Leader — gen03-001 · 2.3000★
current winner⚠ not deployed — prod pins gen02-001"`; screenshot confirmed the
NAV chart and year bars changed with it. 95/95 unit tests green, typecheck clean.

## Greenhouse: launch-time self-update for the dev-tree .app

The DevRebuilder only catches source edits made while the app is RUNNING (it
watches src/ and repackages so the next Dock launch is fresh). Source changed
while the app was closed — an edit, a git pull — still launched the stale
bundle with no warning. Now `npm run build` (esbuild.mjs) writes
`dist/buildstamp.json` ({builtAt}), which ships inside the .app via the
`dist/**` packaging glob; at launch, main.ts compares the newest src/ mtime
(`DevRebuilder.newestSourceMtime`, same SOURCE_RE as the watcher, +2s slack)
against the running bundle's stamp. When stale it asks — "Update & Relaunch" /
"Not Now" — then repackages through the SAME single-flight guard as the watcher
(`DevRebuilder.packageOnce`), and on success quits and reopens the fresh .app
via a detached `sh -c 'sleep 1.5; exec open …'` (macOS `open` merely focuses a
running instance, so the reopen must happen after this process exits). A bundle
with no stamp predates the mechanism and counts as stale, so the first launch
after this change updates itself once.

Scope guards are unchanged from the watcher: packaged app inside its own dev
tree only (resolveDevSourceDir), disabled under EG_SHOT / EG_ROOTS /
EG_NO_AUTOREBUILD=1; shipped installs outside the source tree never see it.
A failed repackage shows an error dialog pointing at dev-rebuild.log and keeps
the current build running.

Verified 2026-08-29: buildstamp confirmed inside the packaged asar
(`npx asar extract-file … dist/buildstamp.json` → builtAt matching the
package), staleness compare exercised on live data on both sides (fresh build
→ not stale; src newer than stamp → stale). The dialog/relaunch path is
hands-on (WEBTESTS.md) — it needs a real Dock launch. 95/95 unit tests green,
typecheck clean.

## Plugin coder/judge runs on Opus medium, not Fable low (2026-09-07)

The `claude-evolve:coder` agent (`plugin/agents/coder.md`) is pinned to
`model: opus` / `effort: medium`. It was Fable at low effort, chosen for
efficiency. The reason for the switch is capacity, not quality: Fable carries
its own per-model session limit, separate from the global one, and the evolve
run's coder pool — which respawns continuously and is by far the highest-volume
Anthropic role in the loop — was exhausting the Fable limit well before the
global limit. Opus draws on the global budget instead, so the loop keeps
running longer.

Scope: the CODER/judge role only. Ideation is unchanged — `agents/ideator.md`
stays Fable 5.1 xhigh, and the ideation dice roll in
`scripts/ideate_branch.py` (`ENABLED_SOURCES` = fable/codex/grok, 3/6-2/6-1/6)
is untouched. Coding is still codex-first: codex (GPT-5.6 Luna) takes the first
pass and the Opus worker judges it, coding the candidate itself only when codex
falls short.

The model tag written to the CSV's `run-LLM` column when the worker codes a
candidate itself changed `fable` → `opus` (in both the agent and the standalone
`evolve-code` skill). `run-LLM` is free text — no enum, no migration needed —
so historical rows keep saying `fable` and that is correct: they were coded by
Fable. Greenhouse reads the column as an opaque string.

This is prompt/frontmatter configuration with no executable surface, so there
is no unit test for it; the check is that `plugin/agents/coder.md` frontmatter
parses with model/effort and that no coder-side `fable` reference survives
(`grep -rni fable plugin/` should return ideation-side hits only). Plugin
version bumped to 0.3.1.

## Enlarged charts carry a live hover readout (2026-09-09)

Clicking a chart used to give you a bigger repaint of the same static SVG: the
axis gutter named the min and the max and nothing else, so "what was the score
at generation 340" meant eyeballing a pixel against a tick. Every ENLARGED
chart now hit-tests the pointer and draws a crosshair, a dot per series, and a
tooltip with the exact values. Tile-sized charts are unchanged — hover is a
zoom-only affordance, so the fleet list stays cheap.

No chart library was added. The charts are hand-rolled SVG whose value→pixel
mapping only exists inside the chart function, so each function now BUILDS its
hover data while it lays its points out and parks it in a module-level
`pendingHoverCols`; the overlay calls `takeHoverCols()` immediately after the
render call that produced the markup it is inserting. Only the `axes` (enlarged)
path publishes, so a tile render can never clobber a pending set. Pulling in
Chart.js/uPlot would have meant re-deriving the three-pane NAV layout, the
shared generation domain, and the walk-forward badge in someone else's model —
far more work than a mousemove handler, for a chart that already draws right.

Hit-testing is x-only, against COLUMNS rather than points: the year-returns
chart has one line per `return_YYYY`, and a reader hovering a generation wants
that generation's whole cross-section, not whichever single line the cursor
happens to be nearest. It also means a pointer anywhere in the plot's height
finds a readout instead of having to trace a thin line.

The geometry is pure and unit-tested in `core/hover.ts` —
`nearestColumnIndex(xs, mx)` (binary search; a daily NAV curve is thousands of
columns and this runs on every mousemove) and `tipPlacement(...)` (above-right
by default, flipped at either edge, clamped as a last resort). The DOM side
lives in `renderer.ts` `attachChartHover(host, cols)`: crosshair and dots go in
a `<g class="hv-layer">` appended to the SVG and the tooltip in a sibling div,
so both die with the next `innerHTML` swap — there is no teardown to forget,
which matters because the interactive NAV viewer replaces its plot on every pan
and zoom.

Verified live via the EG_SHOT harness against `~/GitHub/trading-strategies`
(1d-fndf-inv): `zoom-hover={"tip":"gen 357best score0.8328","marks":2}`,
`year-hover={"tip":"gen 3692025+41.7%2026+34.0%","marks":3}`,
`nav-hover={"tip":"2020-07-09return+23.68%drawdown-5.53%position+100.0%","marks":4}`
— marks being 1 crosshair line plus one dot per series. A `tip:null` in those
lines is the regression signal that the enlarge went back to a static image.
102/102 tests green, typecheck clean.
