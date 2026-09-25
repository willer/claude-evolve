# Changelog

All notable changes to `claude-evolve` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Note: this changelog was reconstructed from git history; the project did not
> tag releases, so entries are grouped by theme rather than mapped to exact
> version tags. The npm-published line is the source of truth for released
> versions (`npm view claude-evolve versions`).

## [Unreleased]

### Fixed

- **CSV lock no longer unlinked on release (plugin 0.3.2)** — deleting
  `.evolution.csv.lock` handed the next writer a fresh inode, so two workers
  could each hold an "exclusive" flock and concurrent read-modify-write cycles
  silently reverted scored rows to `running` (seen 2026-08-14). Both engine
  copies fixed; dead `lib/csv-lock.sh` removed.

### Changed

- **Grok ideation runs through Claude Code, not opencode (plugin 0.3.4)** —
  `ideate_branch.py` runs the OpenRouter sources (grok, and the unrolled
  glm/kimi/qwen) as a headless `claude -p --bare` (read-only tools) with the same
  routing env Spaces uses for its claude/grok route. opencode is no longer a
  plugin dependency.
- **Failed ideation branches re-roll to another model (plugin 0.3.4)** — a
  branch whose external source errors or times out is relaunched on a source
  re-rolled from the ones that have not failed this generation, instead of
  leaving its slots empty. Replaces the 0.3.0 no-fallback rule: when Grok went
  down (really: opencode 1.18.30 crashing on every call), whole hill-climbing
  and crossover slates were lost each generation.
- README rewritten around the plugin marketplace install (Claude Code and
  Codex); the npm CLI is documented as legacy. Stale root scripts, sample
  workspaces, and superseded design docs deleted.
- Greenhouse leader summary shows `kurtosis` when the CSV has it.

### Added

- **Script-run ideation branches (plugin 0.3.0)** — `scripts/ideate_branch.py`
  assembles every ideation branch's prompt from the context JSON and, for the
  external sources the dice roll picks (codex GPT-6 Astra, Grok 4.6; GLM,
  Kimi, Qwen stay wired but unrolled),
  runs the CLI itself and parses the JSON array. Fable branches get ONE
  `ideator` subagent that reads the prompt file. Previously every external
  branch also spawned a full xhigh Fable subagent whose only job was to build
  the prompt and shell out — six of those per generation, each carrying the
  BRIEF, notes, and thousands of descriptions, was the dominant Claude spend
  of a run and tripped the spend cap under multi-board load. Model IDs for the
  roll now live in the script, not in skill prose. Roll is 3/6 Fable 5.1
  xhigh, 2/6 Astra xhigh, 1/6 Grok 4.6. No cross-model fallback: a
  failed branch reports `error`/`timeout` and the orchestrator decides.

- **Divergent ideation (plugin 0.2.0)** — absorbed the parallel-divergence
  mechanics from the ADHD ideation skill into `evolve-ideate`:
  `novel_exploration` now fans out as three isolated branches (each with its
  own cognitive frame and its own model dice-roll), the orchestrator pools
  ~3× ideas and keeps the best N; `structural_mutation` gets a rolled frame
  too. Framed branches ban the obvious first answers and overgenerate before
  returning. Frames: inversion, biology, remove_assumption, crudest,
  maximalist, speedrunner, transplant, oncall.

- **Greenhouse dashboard** — an Electron desktop app (`greenhouse/`) for
  monitoring and driving claude-evolve workspaces: click-to-zoom performance
  charts, host-load gauges, winner labels, a fleet search filter, and
  goal-driven evolution launch.
- **Plugin agents** — `plugin/` ships ideator and coder subagents plus the
  `evolve`, `evolve-ideate`, and related skills used by the self-respawning
  worker pool.
- **`claude-evolve-batch`** — run N pending candidates concurrently.

### Changed

- Ideation switched from Fable to Opus (high effort).
- Plateau detection default raised to 5 generations.

### Fixed

- Sandbox parallelism and an npm-link auto-update clobber bug.

## [1.x] — Model roster & AI orchestration

### Added

- `claude-evolve check` command for AI model health testing.
- UCB bandit model selection, meta-learning notes between generations, and
  power-law parent selection.
- macOS sandbox isolation (`lib/sandbox.sb`) for evaluating evolved algorithms.
- Quality-triggered escalation: cheaper models code candidates first, larger
  models fix on failure.

### Changed

- Overhauled the model roster to version-free names; added Ollama cloud and
  MiniMax providers; updated GPT-5.x / Gemini / Qwen / Kimi model mixes.
- Moved evaluation timeout handling from bash into Python.
- Switched model selection from round-robin to random to avoid token
  exhaustion.

### Fixed

- Worker crash on `nohup` / terminal disconnect (pass `stdin=DEVNULL`).
- Numerous CSV race conditions and corruption bugs: duplicate candidate IDs
  causing infinite loops, wrong IDs updated during ideation, multi-parent ID
  resolution, quote/leading-zero stripping.

## [1.9.x] — Python rewrite

### Changed

- Rewrote the evolution scripts in Python (`lib/evolve_run.py`,
  `lib/evolve_worker.py`, `lib/evolution_csv.py`), replacing the original
  shell-script implementation while keeping the `claude-evolve` CLI surface.

## [Earlier] — Initial MVP

### Added

- Core CLI: `setup`, `ideate`, `run`, `analyze`, `status`.
- Evolution workspace scaffolding (`BRIEF.md`, `algorithm.py`, `evaluator.py`,
  `evolution.csv`).
- Multiple evaluator output formats (numeric, JSON `performance`/`score`,
  legacy `SCORE:`); all extra JSON fields preserved as CSV columns.
