# claude-evolve (Claude Code plugin)

Evolutionary algorithm search, driven from inside Claude Code. Install it from
the marketplace and it runs standalone — **no npm package, no pip install, no
external model CLIs.** The `evolution.csv` engine and sandboxed evaluator are
self-contained in this plugin (`lib/`, stdlib-only), and the AI steps run as
Anthropic subagents.

## What it does

Evolution is a greenhouse: each generation grows new algorithm variants from the
best of the last one. The loop is always the same:

1. **Ideate** new variants from the top performers + your `BRIEF.md` (Fable, high effort).
2. **Code** each variant by editing a copy of its parent algorithm (codex-first, Opus judge/fallback).
3. **Score** each variant by running your `evaluator.py` under a sandbox (Haiku /
   deterministic).
4. Record the result in `evolution.csv` and repeat.

You provide `BRIEF.md`, a starting `algorithm.py`, and an `evaluator.py`; the
plugin runs the loop.

## Skills

| Skill | Tier | Does |
|-------|------|------|
| `evolve` | orchestrator | Runs the whole loop as a self-respawning pool of background worker subagents. The main conversation stays a clean dashboard. Equivalent to `claude-evolve run`. |
| `evolve-ideate` | Fable (high) | One generation of ideation. Fans out parallel strategy subagents (novel / hill-climb / structural / crossover) via the plugin's `ideator` agent, appends new `pending` rows. Run one at a time per workspace. |
| `evolve-code` | Opus (medium) | Write the code for one candidate: resolve parent, copy to `evolution_<id>.py`, implement its description. |
| `evolve-score` | Haiku | Score one candidate: syntax-check, optional `validator.py`, sandboxed `evaluator.py`, write the number to the CSV. Deterministic — the subagent only exists to keep evaluator noise out of the main thread. |

## Workspace

A workspace is any directory with a `config.yaml` (and the `algorithm.py` /
`evaluator.py` / `BRIEF.md` it points at). Skills take `--working-dir DIR`; with
no flag they auto-detect `evolution/config.yaml` or `./config.yaml`. The
`templates/` directory in the repo root has starter files.

## Design notes

- **Self-contained & stdlib-only.** The deterministic engine (CSV file-locking,
  ID generation, sandboxed evaluation) lives under `lib/` and needs nothing
  installed — no npm, no `pip` — falling back to a minimal config parser when
  PyYAML is absent. This plugin is the home of that engine, not a copy of it.
- **Fixed model roles, defined in `agents/`.** Fable at high effort ideates
  (`agents/ideator.md`); codex (GPT-5.5) codes first with the Opus worker
  (`agents/coder.md`, restricted tools) judging and falling back to coding
  itself; the evaluator scores. Each agent definition pins its model/effort and
  carries the role's protocol as a system prompt — which also keeps the
  security rules above the untrusted CSV descriptions the workers read.
  (Earlier claude-evolve experiments with a multi-model bandit, escalation
  tiers, and an Ollama-embedding novelty filter are intentionally left out for
  simplicity.) Novelty is enforced by handing the ideators the existing
  descriptions and telling them to stay distinct.
- **`scripts/`** are thin JSON-emitting CLIs the skills call:
  `evolve_csv.py` (all CSV reads/writes + ideation context), `prepare.py` (parent
  resolution + file copy), `score.py` (sandboxed evaluation). All AI judgment
  lives in the skills/subagents; everything deterministic lives in the scripts.

## Honesty

A failing candidate is a real result — it gets recorded (`failed`,
`failed-validation`, `failed-parent-missing`) and the loop moves on. The plugin
never fakes a score, weakens the evaluator, or edits a candidate just to make it
pass. If the evaluator itself is broken, the run stops and says so.
