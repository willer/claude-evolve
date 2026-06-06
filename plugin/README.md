# claude-evolve (Claude Code plugin)

Evolutionary algorithm search, driven from inside Claude Code. This is the
plugin packaging of [claude-evolve](https://github.com/anthropics/claude-evolve):
same `evolution.csv` engine and sandboxed evaluator, but the AI steps run as
Anthropic subagents instead of shelling out to external model CLIs.

## What it does

Evolution is a greenhouse: each generation grows new algorithm variants from the
best of the last one. The loop is always the same:

1. **Ideate** new variants from the top performers + your `BRIEF.md` (Opus).
2. **Code** each variant by editing a copy of its parent algorithm (Sonnet).
3. **Score** each variant by running your `evaluator.py` under a sandbox (Haiku /
   deterministic).
4. Record the result in `evolution.csv` and repeat.

You provide `BRIEF.md`, a starting `algorithm.py`, and an `evaluator.py`; the
plugin runs the loop.

## Skills

| Skill | Tier | Does |
|-------|------|------|
| `evolve` | orchestrator | Runs the whole loop as a self-respawning pool of background worker subagents. The main conversation stays a clean dashboard. Equivalent to `claude-evolve run`. |
| `evolve-ideate` | Opus | One generation of ideation. Fans out parallel strategy subagents (novel / hill-climb / structural / crossover), appends new `pending` rows. Run one at a time per workspace. |
| `evolve-code` | Sonnet | Write the code for one candidate: resolve parent, copy to `evolution_<id>.py`, implement its description. |
| `evolve-score` | Haiku | Score one candidate: syntax-check, optional `validator.py`, sandboxed `evaluator.py`, write the number to the CSV. Deterministic — the subagent only exists to keep evaluator noise out of the main thread. |

## Workspace

A workspace is any directory with a `config.yaml` (and the `algorithm.py` /
`evaluator.py` / `BRIEF.md` it points at). Skills take `--working-dir DIR`; with
no flag they auto-detect `evolution/config.yaml` or `./config.yaml`. The
`templates/` directory in the repo root has starter files.

## Design notes

- **Self-contained & stdlib-only.** The deterministic engine (CSV file-locking,
  ID generation, sandboxed evaluation) is vendored under `lib/` from the npm
  package and needs no `pip install` — it falls back to a minimal config parser
  when PyYAML is absent.
- **Anthropic-only v1.** The npm engine's multi-model bandit, escalation tiers,
  and Ollama-embedding novelty filter are intentionally dropped here for
  simplicity. Models are fixed: Opus ideates, Sonnet codes, the evaluator scores.
  Novelty is enforced by handing the Opus ideators the existing descriptions and
  telling them to stay distinct.
- **`scripts/`** are thin JSON-emitting CLIs the skills call:
  `evolve_csv.py` (all CSV reads/writes + ideation context), `prepare.py` (parent
  resolution + file copy), `score.py` (sandboxed evaluation). All AI judgment
  lives in the skills/subagents; everything deterministic lives in the scripts.

## Honesty

A failing candidate is a real result — it gets recorded (`failed`,
`failed-validation`, `failed-parent-missing`) and the loop moves on. The plugin
never fakes a score, weakens the evaluator, or edits a candidate just to make it
pass. If the evaluator itself is broken, the run stops and says so.
