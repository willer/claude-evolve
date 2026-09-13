# claude-evolve

Evolutionary algorithm search, run from inside your coding agent. Give it a
problem brief, a starting algorithm, and an evaluator; it grows better variants
generation by generation, AlphaEvolve-style, and records every attempt in one
`evolution.csv`.

It ships as a **plugin marketplace** for Claude Code and Codex. Nothing to
`npm install` or `pip install`: the engine is stdlib Python bundled in the
plugin, and the AI steps run as the host agent's own subagents.

## Install

Claude Code (terminal, or the same two commands as `/plugin …` inside a session):

```bash
claude plugin marketplace add willer/claude-evolve
claude plugin install claude-evolve@claude-evolve
```

Codex:

```bash
codex plugin marketplace add willer/claude-evolve
codex plugin add claude-evolve@claude-evolve
```

Working from a local checkout instead of GitHub: pass the checkout path to
`marketplace add` and the plugin tracks your working tree.

Claude Code is the tested host. The omnibus `/evolve` loop is built on Claude
Code's background subagents; under Codex the per-candidate skills work but the
worker pool has not been verified.

## Quick start

1. Make a workspace: a directory holding `config.yaml`, `BRIEF.md`,
   `algorithm.py`, and `evaluator.py`. Copy the starters from
   [`templates/`](templates/) and edit them.
   - `BRIEF.md` describes the problem and what "better" means.
   - `algorithm.py` is generation zero, the first plant in the greenhouse.
   - `evaluator.py` runs a candidate and prints its score (formats below).
2. In your agent, from that directory (or with `--working-dir <path>`):
   ```
   /evolve
   ```
3. Watch `evolution.csv`, or open the Greenhouse dashboard (below).

The loop runs until ideation stops producing new ideas or `auto_ideate` is off.
Every candidate lands in the CSV as `complete`, `failed`, `failed-validation`,
or `failed-parent-missing`. A failure is a real result: nothing ever fakes a
score, edits the evaluator, or touches `algorithm.py`. Workers only write
`evolution_<id>.py`.

## Skills

| Skill | What it does |
|-------|--------------|
| `/evolve` | The whole loop: code pending candidates, score them, ideate the next generation when the queue drains, repeat. Runs a self-respawning pool of background worker subagents so your conversation stays a status feed. |
| `/evolve-ideate` | One generation of ideas. Six parallel branches (three framed novel-exploration, hill-climb, structural mutation, crossover), appended as `pending` rows. One at a time per workspace. |
| `/evolve-code <id>` | Write one candidate: resolve its parent, copy to `evolution_<id>.py`, implement the description. |
| `/evolve-score <id>` | Run one candidate through `evaluator.py` in the sandbox and write the score back. |

### Model roles

| Step | Who |
|------|-----|
| Ideation | Dice roll per branch: 3/6 Claude Fable 5.1 (xhigh), 2/6 Codex GPT-6 Astra (xhigh), 1/6 Grok 4.6 (max, via opencode + OpenRouter) |
| Coding | Codex GPT-5.6 Luna writes first; a Claude Opus worker (medium) judges the diff and codes it itself if Codex fell short |
| Scoring | Deterministic script under the sandbox; no model judgment |

Roles are pinned in `plugin/agents/*.md` and `plugin/scripts/ideate_branch.py`,
not in config. A missing external CLI makes that branch report an error and the
orchestrator carries on with the rest; a missing `codex` makes coding stop with
an environment fault rather than silently degrading.

## Requirements

- Python 3 (stdlib only; PyYAML is used if present).
- Claude Code with access to Fable and Opus, or Codex (see host note above).
- `codex` CLI on PATH for the coding first pass and the Codex ideation roll.
- `opencode` on PATH plus an OpenRouter key for the Grok ideation roll (optional).
- macOS: `sandbox-exec` isolates evaluations (no network, workspace-only writes).
  Linux gets memory and CPU limits only.

## Workspace layout

```
my-experiment/
├── config.yaml          # settings (below)
├── BRIEF.md             # problem description, what to optimise
├── algorithm.py         # generation zero
├── evaluator.py         # prints the score
├── evolution.csv        # every candidate: id, parent, description, score, status, models
└── evolution_<id>.py    # generated variants
```

Skills find the workspace from `--working-dir`, else `./evolution/config.yaml`,
else `./config.yaml`.

## Evaluator output

`evaluator.py` prints a score to stdout in any of these forms. Higher is better.

```python
print(1.234)                                                    # bare number
print('{"performance": 1.234, "sharpe": 0.95, "ulcer": 4.2}')   # JSON, extra fields kept in the CSV
print('{"score": 1.234}')                                       # JSON with score
print("SCORE: 1.234")                                           # legacy prefix
```

A score of 0.0 is a low score, not a failure. To fail a candidate, exit
non-zero.

## Configuration

The keys `/evolve` reads from `config.yaml`:

```yaml
algorithm_file: "algorithm.py"
evaluator_file: "evaluator.py"
brief_file: "BRIEF.md"
evolution_csv: "evolution.csv"

ideation_strategies:
  total_ideas: 15
  novel_exploration: 3
  hill_climbing: 5
  structural_mutation: 3
  crossover_hybrid: 4
  num_elites: 3

auto_ideate: true               # ideate again when the queue drains
min_completed_for_ideation: 3   # need this many scored rows before ideating
worker_max_candidates: 3        # a worker exits and respawns after this many
parallel:
  max_workers: 4                # concurrent worker subagents

sandbox:
  enabled: true
  memory_limit_mb: 12288
  cpu_limit_seconds: 300
```

`templates/config.yaml` documents the rest, including per-workspace ideation
intents and the `llm_cli` block, which only the legacy CLI reads.

## Greenhouse dashboard

[`greenhouse/`](greenhouse/) is an Electron app that watches a directory of
workspaces: health chips, leader and score, best-score-per-generation
sparklines, NAV and per-year return charts, and a live terminal attached to
each run. It starts and stops evolutions as detached tmux sessions running
`claude` with `/evolve`, so runs survive the app quitting.

```bash
./run-greenhouse          # build, package, and open the app
cd greenhouse && npm test # vitest on the pure core/ modules
```

See [`greenhouse/README.md`](greenhouse/README.md) for the keys and views.

## Repo map

- `plugin/` is the plugin: `skills/` (the four skills), `agents/` (ideator and
  coder definitions with their model pins), `scripts/` (JSON-emitting CLIs the
  skills call), `lib/` (CSV locking, ID generation, sandbox).
- `.claude-plugin/marketplace.json` makes this repo the marketplace.
- `templates/` holds the workspace starters.
- `bin/` and `lib/` are the legacy `claude-evolve` npm CLI (below).
- `docs/PLAN.md` is the task list and bug tracker; `docs/TRUTH.md` records how
  things work and why.

## Legacy npm CLI

The original implementation is a bash and Python CLI published to npm
(`npm install -g claude-evolve`, then `claude-evolve setup | ideate | run |
analyze | status`). It uses the same workspace layout and CSV, so old
workspaces open in the plugin and in Greenhouse unchanged. The plugin is the
maintained path; the CLI is kept for existing servers.

## License

MIT
