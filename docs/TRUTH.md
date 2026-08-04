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
