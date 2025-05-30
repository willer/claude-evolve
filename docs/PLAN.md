# Claude-Evolve – Implementation Plan

The plan is organised into sequential _phases_ – each phase fits comfortably in a feature branch and ends in a working, testable state. Tick the `[ ]` check-box when the task is complete.

---

## Phase 0 – Repository & SDLC Skeleton

- [ ] Initialise Git repository (if not already) and push to remote
  > ⚠️ **Action Required**: Please configure the remote `origin` with the repository URL (see Question 17 in QUESTIONS.md) and push the initial `main` branch.
- [x] Add `.gitignore` (node*modules, evolution/*.png, \_.log, etc.)
  > ✅ **COMPLETED**: Comprehensive .gitignore implemented covering Node.js dependencies, OS files, editor files, build outputs, and project-specific evolution artifacts.
- [ ] Enable conventional commits / commitlint (optional)
- [ ] Configure branch protection rules (main protected, feature branches for work)

### Tooling Baseline

- [x] `npm init -y` – create `package.json`
  > ✅ **COMPLETED**: Generated package.json with default values for claude-evolve project.
- [x] Add `bin/claude-evolve` entry in `package.json` (points to `./bin/claude-evolve.sh`)
  > ✅ **COMPLETED**: Added bin field to package.json enabling CLI functionality via "./bin/claude-evolve.sh".
- [x] Install dev-dependencies:
      • `shellcheck` & `shfmt` (lint/format shell scripts)
      • `@commitlint/*`, `prettier` (markdown / json formatting) > ✅ **COMPLETED**: Installed shellcheck, shfmt, @commitlint/cli, @commitlint/config-conventional, and prettier. Added npm scripts for linting and formatting. Downloaded shfmt binary locally due to npm package issues.
- [x] Add **pre-commit** config (`.pre-commit-config.yaml`) running:
      • shellcheck
      • shfmt
      • prettier –write "\*.md" > ✅ **COMPLETED**: Created .pre-commit-config.yaml with hooks for shellcheck (shell linting), shfmt (shell formatting), and prettier (markdown formatting).
- [ ] Add Husky or pre-commit-hooks via `npm pkg set scripts.prepare="husky install"` > ⚠️ **NOTE**: Husky and lint-staged are added as devDependencies but the `prepare` script to install hooks is missing. Please add `"prepare": "husky install"` to package.json to enable automatic hook installation.

---

## Phase 1 – Minimal CLI Skeleton

Directory layout

- [x] `bin/claude-evolve.sh` – argument parsing stub (menu + sub-commands)
  > ✅ **COMPLETED**: Created main CLI script with argument parsing, command routing to `cmd_<name>` functions, and interactive menu.
- [x] `lib/common.sh` – shared helper functions (logging, json parsing)
  > ✅ **COMPLETED**: Implemented logging functions, JSON parsing with jq, file validation, and utility functions with proper error handling.
- [x] `templates/` – default files copied by `setup`
  > ✅ **COMPLETED**: Created template directory with BRIEF.md, evaluator.py, and algorithm.py templates for project initialization.

Core behaviour

- [x] `claude-evolve --help` prints usage & version (from package.json)
  > ✅ **COMPLETED**: Implemented help functionality with comprehensive usage information and dynamic version extraction from package.json.
- [x] No-arg invocation opens interactive menu (placeholder)
  > ✅ **COMPLETED**: Interactive menu system with numbered options for all commands, proper input validation, and error handling.
- [x] `claude-evolve <cmd>` routes to `cmd_<name>` bash functions
  > ✅ **COMPLETED**: Command routing system implemented with proper argument passing and unknown command handling.

Unit tests

- [x] Add minimal Bats-core test verifying `--help` exits 0
  > ✅ **COMPLETED**: Comprehensive Bats test suite covering help flags, version flags, command routing, error handling, and exit codes. Updated package.json test script.

---

## Phase 2 – `setup` Command

- [ ] `claude-evolve setup` creates `evolution/` folder if absent
- [ ] Copy template `BRIEF.md`, `evaluator.py`, baseline `algorithm.py`
- [ ] Generate `evolution.csv` with header `id,basedOnId,description,performance,status`
- [ ] Open `$EDITOR` for the user to edit `evolution/BRIEF.md`
- [ ] Idempotent (safe to run again)

---

## Phase 3 – Idea Generation (`ideate`)

- [ ] `claude-evolve ideate [N]` (default 1)
- [ ] Prompt Claude (`claude -p`) with a template pulling context from:
      • The project `evolution/BRIEF.md`
      • Recent top performers from `evolution.csv`
- [ ] Append new rows into `evolution.csv` with blank performance/status
- [ ] Offer interactive _manual entry_ fallback when `–no-ai` is passed or Claude fails

---

## Phase 4 – Candidate Execution Loop (`run`)

Basic MVP

- [ ] Select the **oldest** row in `evolution.csv` with empty status
- [ ] Build prompt for Claude to mutate the parent algorithm (file path from `basedOnId`)
- [ ] Save generated code as `evolution/evolution_idXXX.<ext>` (use same extension as parent)
- [ ] Invoke evaluator (`bash -c "$EVALUATOR $filepath"`) and capture JSON → performance
- [ ] Update CSV row with performance and status `completed` or `failed`
- [ ] Stream progress log to terminal (ID, description, metric)

Error handling

- [ ] Detect evaluator non-zero exit → mark `failed`
- [ ] Graceful Ctrl-C → mark current row `interrupted`

---

## Phase 5 – Enhancements to `run`

- [ ] `--timeout <sec>` option → kill evaluator past limit, mark `timeout`
- [ ] `--parallel <N>` → run up to N candidates concurrently (background subshells)
- [ ] ETA & throughput stats in the live log

---

## Phase 6 – Analyse (`analyze`)

- [ ] Parse `evolution.csv` into memory (Node or awk + jq)
- [ ] Identify top performer and display table summary
- [ ] Render PNG line chart (performance over iteration) to `evolution/performance.png`
- [ ] `--open` flag opens the PNG with `open` (mac) / `xdg-open`

---

## Phase 7 – Testing & CI

- [ ] Extend Bats tests to cover each command path
- [ ] Mock Claude calls via environment var `CLAUDE_MOCK=1`
- [ ] GitHub Actions: matrix `{os: [ubuntu-latest, macos-latest]}` running test suite + shellcheck

---

## Phase 8 – Documentation & Release Prep

- [ ] Update `README.md` with install / quick-start / screenshots
- [ ] Add `docs/` usage guides (ideation, branching, parallelism)
- [ ] Write CHANGELOG.md (keep-a-changelog format)
- [ ] `npm publish --access public`

---

## Post-MVP Backlog (Nice-to-Have)

- [ ] Multi-metric support (extend CSV → wide format)
- [ ] Branch visualiser (graphviz) showing basedOnId tree
- [ ] Cloud storage plugin for large artefacts (S3, GCS)
- [ ] Web UI wrapper around analyse output
- [ ] Auto-generation of release notes from CSV improvements

---

### Process Notes

• One _feature branch_ per phase or sub-feature – keep PRs small.
• Each merged PR must pass tests & pre-commit hooks.
• Strict adherence to **YAGNI** – only ship what is necessary for the next user-visible increment.
