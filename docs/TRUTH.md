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
