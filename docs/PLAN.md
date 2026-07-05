# Claude-Evolve – Implementation Plan

> ⚠️ **HISTORICAL PLAN — partially superseded.** This document plans the original
> shell-script MVP (`bin/claude-evolve.sh`, `lib/common.sh`, a Bats test suite).
> That implementation was rewritten into the current Python-worker + tmux +
> Electron-`greenhouse` architecture (published to npm at v1.14.0). Several
> remaining `[ ]` items reference files/tests that no longer exist; those are
> marked `[B]` with the reason. Delivered capabilities are marked `[x]` with a
> pointer to the current implementation. New work should be tracked against the
> current architecture, not this plan.

The plan is organised into sequential _phases_ – each phase fits comfortably in a feature branch and ends in a working, testable state. Tick the `[ ]` check-box when the task is complete.

---

## Phase 0 – Repository & SDLC Skeleton

- [x] Initialise Git repository (if not already) and push to remote
  > ✅ **COMPLETED**: Git repository initialized, remote configured as https://github.com/willer/claude-evolve.git, and all commits successfully pushed to origin/main.
- [x] Add `.gitignore` (node*modules, evolution/*.png, \_.log, etc.)
  > ✅ **COMPLETED**: Comprehensive .gitignore implemented covering Node.js dependencies, OS files, editor files, build outputs, and project-specific evolution artifacts.
- [x] Enable conventional commits / commitlint (optional)
  > ✅ **COMPLETED**: Commitlint configuration properly set up with conventional commit standards, integrated with pre-commit framework, and tested to reject invalid commits while accepting valid ones.
- [x] Configure branch protection rules (main protected, feature branches for work)
  > ✅ **COMPLETED**: Branch protection rules configured for main branch - requires PR reviews (1 approver), dismisses stale reviews, enforces admin compliance, blocks direct pushes and force pushes.
  > ⚠️ **PROCESS VIOLATION**: Developer worked directly on main branch instead of creating feature branch, contradicting established workflow. Future work must follow "One feature branch per phase" process.

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
- [x] Add Husky or pre-commit-hooks via `npm pkg set scripts.prepare="husky install"` > ✅ **COMPLETED**: Using pre-commit (Python) instead of Husky for better shell script linting integration. Pre-commit hooks successfully configured with shellcheck, shfmt, and prettier.

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

## Phase 2 – `setup` Command ✅

> ✅ **COMPLETED**: `cmd_setup` fully implemented to initialize evolution workspace.

- [x] `claude-evolve setup` creates `evolution/` folder if absent
  > ✅ **COMPLETED**: Created `evolution/` directory as needed.
- [x] Copy template `BRIEF.md`, `evaluator.py`, baseline `algorithm.py`
  > ✅ **COMPLETED**: Templates copied to `evolution/` directory.
- [x] Generate `evolution.csv` with header `id,basedOnId,description,performance,status`
  > ✅ **COMPLETED**: Evolution CSV file created with correct header.
- [x] Open `$EDITOR` for the user to edit `evolution/BRIEF.md`
  > ✅ **COMPLETED**: Brief file opened in editor in interactive mode; skipped if non-interactive.
- [x] Idempotent (safe to run again)
  > ✅ **COMPLETED**: Re-running command does not overwrite existing files or reopen editor unnecessarily.

---

## Phase 3 – Idea Generation (`ideate`) ✅ COMPLETED

> ✅ **COMPLETED**: `cmd_ideate` fully implemented to generate algorithm ideas with AI-driven and manual entry modes.

- [x] `claude-evolve ideate [N]` (default: 1)
- [x] Prompt Claude (`claude -p`) with a template pulling context from:
      • The project `evolution/BRIEF.md`
      • Recent top performers from `evolution.csv`
- [x] Append new rows into `evolution.csv` with blank performance/status
- [x] Offer interactive _manual entry_ fallback when `–no-ai` is passed or Claude fails

---

## Phase 4 – Candidate Execution Loop (`run`) ✅ COMPLETED

> ✅ **COMPLETED**: Core `cmd_run` functionality fully implemented with comprehensive error handling and CSV manipulation.

Basic MVP ✅

- [x] Implement `cmd_run` function with complete evolution workflow
- [x] Implement CSV manipulation functions in lib/common.sh:
  - [x] `update_csv_row` - Update CSV rows with performance and status (with file locking)
  - [x] `find_oldest_empty_row` - Find next candidate to execute
  - [x] `get_csv_row` - Extract row data for processing
  - [x] `generate_evolution_id` - Generate unique IDs for new evolution files
  - [x] CSV file locking mechanism for concurrent access (atomic updates with .lock files)
- [x] Select the **oldest** row in `evolution.csv` with empty status
- [x] Build prompt for Claude to mutate the parent algorithm (file path from `basedOnId`)
- [x] Save generated code as `evolution/evolution_idXXX.py` (preserves Python extension)
- [x] Invoke evaluator (`python3 $EVALUATOR $filepath`) and capture JSON → performance
- [x] Update CSV row with performance and status `completed` or `failed`
- [x] Stream progress log to terminal (ID, description, performance metric)

Error handling ✅

- [x] Detect evaluator non-zero exit → mark `failed`
- [x] Graceful Ctrl-C → mark current row `interrupted` (signal handler with trap)
- [x] Claude CLI availability check with helpful error messages
- [x] Missing evolution workspace detection
- [x] No empty rows available detection
- [x] Parent algorithm file validation
- [x] JSON parsing validation for evaluator output
- [x] File permission and I/O error handling

Additional Features ✅

- [x] Support for `CLAUDE_CMD` environment variable (enables testing with mock Claude)
- [x] Proper file extension handling for generated algorithms
- [x] Comprehensive logging with status updates
- [x] Atomic CSV operations to prevent corruption
- [x] Full test coverage with Bats test suite (run command tests passing)
  > ✅ **COMPLETED**: All run command tests pass when run via `npm test`.

---

## Phase 5 – Enhancements to `run`

**🔄 STATUS UPDATE**: Timeout functionality has been validated and is working correctly!

> ⚠️ **INCOMPLETE**: Implementation exists but is currently failing the Bats test suite. Please ensure the timeout logic (exit codes, error messaging, and process cleanup) aligns with test expectations and fix or update tests as needed (see Phase 7).

- [x] `--parallel <N>` → run up to N candidates concurrently (background subshells)
  > ✅ **DELIVERED (rewritten form)**: Concurrent execution is shipped — `lib/config.sh` parses a `parallel:` config section (`DEFAULT_PARALLEL_ENABLED`), `lib/evolve_run.py` runs a concurrent worker pool, and `bin/claude-evolve-batch` runs N pending candidates concurrently. Config-driven rather than a literal `--parallel` flag on the (deleted) `bin/claude-evolve.sh`.
- [B] ETA & throughput stats in the live log — blocked on missing timing data, not just a moved UI. `evolution.csv` (header `id,basedOnId,description,performance,status,idea-LLM,run-LLM`) has no start/end timestamps, so throughput and ETA are not derivable from it, and the original foreground `cmd_run` streaming log this targeted no longer exists. **Needs from the maintainer:** a decision to (a) add `started_at`/`completed_at` columns in `lib/evolve_worker.py` plus a CSV migration, and (b) pick the surface to render ETA — `bin/claude-evolve-status` vs the greenhouse dashboard. Until that schema+surface decision is made this cannot be implemented as written.

---

## Phase 6 – Analyse (`analyze`) ✅

- [x] Parse `evolution.csv` into memory (Node.js with csv-parser)
- [x] Identify top performer and display table summary
- [x] Render PNG line chart (performance over iteration) to `evolution/performance.png`
- [x] `--open` flag opens the PNG with `open` (mac) / `xdg-open`

Implementation Notes ✅

- [x] Created Node.js analyzer script at `bin/analyze.js` using chartjs-node-canvas for PNG generation
- [x] Added csv-parser dependency for robust CSV handling
- [x] Implements comprehensive summary statistics (total, completed, running, failed, pending candidates)
- [x] Displays top performer with ID, performance score, and description
- [x] Generates line chart showing performance progression over evolution IDs
- [x] Cross-platform file opening support (macOS `open`, Linux `xdg-open`)
- [x] Robust error handling for malformed CSVs, missing files, and empty datasets
- [x] Full CLI integration with proper argument forwarding
- [x] Comprehensive help documentation and usage examples
- [x] Graceful handling of edge cases (no completed candidates, single data points)

---

## Phase 7 – Testing & CI ⚠️ INCOMPLETE

**Phase 7 Status**: ⚠️ **INCOMPLETE** – 32 of 44 Bats tests failing (73% failure rate), fundamental implementation bugs block progress.

**Next Developer Requirements (critical)**:

- [B] Fix existing Bats test failures without modifying tests — **obsolete, not fixable.** Verified this pass: `find . -name '*.bats'` returns zero files, and the `bin/claude-evolve.sh` / `lib/common.sh` those tests exercised were deleted in the Python rewrite. There is literally nothing to fix. The live test surface is `npm test` (→ `claude-evolve --help`, passing) plus the greenhouse `lib/core` unit tests. **Needs from the maintainer:** a decision to either delete this line as superseded or fold it into a fresh Python-worker test suite (see the next two items) — no build worker can act on it as written.
- [B] Achieve 100% Bats test pass rate (44/44 passing) — **obsolete.** The 44-test Bats suite does not exist (0 `.bats` files, verified) and cannot exist against the current Python/tmux/Electron architecture. **Needs from the maintainer:** approval to commission a new test suite (e.g. pytest over `lib/*.py` + the greenhouse `lib/core` tests) with an agreed coverage target; that is a distinct build task, not a pass-rate fix on a deleted suite.
- [B] Follow a test-driven development approach with continuous validation — process directive, not a discrete buildable deliverable, and it was predicated on the now-deleted Bats suite. **Needs from the maintainer:** fold this into whatever new Python test suite gets commissioned above; there is no standalone artifact for a build worker to produce or commit here.

**Remaining CI Setup**:

- [x] Set up GitHub Actions CI pipeline
  > ✅ **DONE**: Added `.github/workflows/ci.yml` running `npm ci`, `npm test` (CLI smoke test, verified green), and `python3 -m py_compile lib/*.py` (verified green) on push/PR to `main`.
- [B] Add shellcheck integration to test suite — blocked on tooling + triage. Verified this pass: `shellcheck` is not installed in this environment (`shellcheck not found`), so no clean run can be produced, and the 21 legacy scripts in `bin/` (`claude-evolve*`) would need a warning-triage pass before a blanket gate could go green. Adding it now ships either a red build or a no-op advisory step. **Needs from the maintainer:** run `shellcheck bin/*` locally, fix/annotate the findings in a dedicated PR, then add a green `shellcheck` step to `.github/workflows/ci.yml`.

---

## Phase 8 – Documentation & Release Prep

- [x] Update `README.md` with install / quick-start / screenshots
  > ✅ **DONE**: `README.md` has Install & Quick Start, How It Works, and a full command reference. (Screenshots omitted — claude-evolve is a CLI; the greenhouse GUI is documented in `greenhouse/`.)
- [x] Add `docs/` usage guides (ideation, branching, parallelism)
  > ✅ **DONE**: `docs/` contains usage guides including `PARALLEL-DESIGN.md` (parallelism), `IDEAS.md`, and `QUESTIONS.md`; ideation is also documented in `README.md` and the `plugin/` skills.
- [x] Write CHANGELOG.md (keep-a-changelog format)
  > ✅ **DONE**: Created `CHANGELOG.md` in Keep-a-Changelog format, reconstructed from git history (the project has no release tags), grouped by theme with an `[Unreleased]` section.
- [x] `npm publish --access public`
  > ✅ **DONE**: Published to npm — `npm view claude-evolve version` reports v1.14.0. The package auto-updates itself on `claude-evolve` invocation.

---

## Post-MVP Backlog (Nice-to-Have)

- [x] Multi-metric support (extend CSV → wide format)
  > ✅ **DELIVERED**: `lib/evolve_worker.py` writes every extra field from the evaluator's JSON output into the CSV via `update_candidate_field`, adding columns as needed (the wide format). See the Evaluator Output Specification in `CLAUDE.md`.
- [x] Web UI wrapper around analyse output
  > ✅ **DELIVERED**: The `greenhouse/` Electron dashboard wraps the evolution analysis — performance charts, host-load gauges, winner labels, fleet search, and goal-driven launch.
- [B] Branch visualiser (graphviz) showing basedOnId tree — Post-MVP nice-to-have, intentionally deferred (YAGNI per this plan's Process Notes); not built and not committed. **Unblock only on an explicit maintainer request** to render the `basedOnId` lineage (the greenhouse dashboard already covers analysis, so this is optional); no build worker should pick it up otherwise.
- [B] Cloud storage plugin for large artefacts (S3, GCS) — Post-MVP nice-to-have, intentionally deferred (YAGNI); not built and not committed. **Unblock only on an explicit maintainer request** that also specifies the target backend and which artefacts to offload; no build worker should pick it up otherwise.
- [B] Auto-generation of release notes from CSV improvements — Post-MVP nice-to-have, intentionally deferred (YAGNI); not built and not committed. **Unblock only on an explicit maintainer request**; CHANGELOG.md is currently maintained by hand (Keep-a-Changelog), so this is optional. No build worker should pick it up otherwise.

---

### Process Notes

• One _feature branch_ per phase or sub-feature – keep PRs small.
• Each merged PR must pass tests & pre-commit hooks.
• Strict adherence to **YAGNI** – only ship what is necessary for the next user-visible increment.
- [x] change the root run-greenhouse.sh to just run package-and-run.sh, because that works better anyway
  > ✅ **DONE**: The root launcher (named `run-greenhouse`, no `.sh`) now just `exec`s `greenhouse/package-and-run.sh`, forwarding args. The old `npm install` guard was dropped — `package-and-run.sh` → `package.sh` already runs `npm install` itself.
- [x] within both main and detail view, add Shell as an option, which launches a straight zsh in tmux
  > ✅ **DONE**: Added a third session type `shell` (bare `zsh`, no claude) alongside evolution/adhoc. `shellSessionName` (`shell-<dir>`) + `SHELL_CMD='zsh'` in `core/state.ts`; `SessionHost.startShell` launches a detached tmux session running zsh in the workspace dir; `shell:start`/`shell:stop` IPC + preload bridge; the Poller classifies and pushes `row.shell`. Main view exposes a Shell ▶/⏹ control in both the fleet list (new "Shell" column) and grid cards; the detail view stacks a third "Shell session" terminal panel (attach/stop, keyboard focus fallback). Unit test covers `shellSessionName`; tmux launch verified live (zsh pane in the workspace cwd, killable).
- [x] when the app is running in a dev environment, silently rebuild the app when there are changes every so often, so when I relaunch from Dock, I get the latest version
  > ✅ **DONE**: A PACKAGED `.app` running from inside its own source tree (`greenhouse/release/…` under `greenhouse/`) now silently re-packages itself when `src/` changes, so quitting and relaunching from the Dock always lands on the latest build. `core/devRebuild.ts` (`resolveDevSourceDir`, pure + unit-tested) climbs from `app.getPath('exe')` to the source dir by its markers (`esbuild.mjs`, `package.sh`, `src/main/main.ts`) — returns null for a shipped `/Applications` install, disabling the feature there. `main/DevRebuilder.ts` watches `src/` recursively and, after a 5 s quiet window following edits (editor `.swp`/`~` files ignored), runs `npm run package` (build + `electron-builder --mac dir`, no `npm install`) one build at a time, folding mid-build edits into a single follow-up, logging to `<userData>/dev-rebuild.log` (never a GUI prompt). Gated on `app.isPackaged` (off for `electron .`), and off under `EG_SHOT`/`EG_ROOTS` harnesses or `EG_NO_AUTOREBUILD=1`. Verified: real packaged-exe path resolves to the greenhouse dir (shipped path → null); watch→debounce→`npm run package`→log exercised end-to-end with a fake `npm` (swap files ignored, rapid saves collapse to one build, `stop()` halts further builds).
- [x] fix up the app icon so it has a transparent background, not white
  > ✅ **DONE**: `greenhouse/assets/icon.svg` already drew a rounded panel on a
  > transparent canvas, but `icon.png`/`icon.icns` had been exported against a
  > white background — every pixel was opaque `(255,255,255,255)`, so macOS
  > showed a white square. Added `greenhouse/scripts/render-icon.sh`
  > (rsvg-convert → transparent 1024² PNG; per-size renders → `iconutil` .icns)
  > and regenerated both assets: corners are now `(0,0,0,0)` transparent, the
  > green-sprout panel unchanged. Regression guard `src/core/icon.test.ts`
  > (dependency-free PNG RGBA decoder) asserts transparent corners + opaque
  > center; `npm test` green (54/54). release/ is a build artifact (gitignored)
  > and picks up the new `.icns` on the next `npm run package`/`dist`.
