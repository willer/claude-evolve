# Changelog

All notable changes to `claude-evolve` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Note: this changelog was reconstructed from git history; the project did not
> tag releases, so entries are grouped by theme rather than mapped to exact
> version tags. The npm-published line is the source of truth for released
> versions (`npm view claude-evolve versions`).

## [Unreleased]

### Added

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
