# Claude-Evolve Project – Clarifying Questions

Below is a focused list of open questions that surfaced while analysing the current BRIEF.md. Answering them will prevent the development team (human and AI) from making incorrect assumptions during implementation.

## 1. Technical Architecture & Tooling

1. **Primary implementation language** – The brief references both npm (JavaScript/TypeScript) and Python artefacts. Should the CLI itself be written in Node / TypeScript, Python, or a hybrid approach?
   Let's keep it simple: shell script in a npm package, just like claude-fsd. I'm a curmudgeon this way.
   The evaluator itself doesn't have to be python, but probably is. It's a good point, in that we shouldn't
   just assume the file extension of the algo and evaluator are `py`.

2. **Package distribution** – Will claude-evolve be published to a public package registry (e.g. npm, PyPI) or consumed only from source? This influences versioning and dependency policies.
   public package, just like claude-fsd

3. **Prompt templates for Claude** – Are there predefined prompt skeletons the CLI should inject when calling `claude -p`, or should prompts be assembled dynamically from the project state?
   We don't have the prompts now. Take a look at what's in claude-fsd, and use that to write something
   that makes sense. We can tweak it after.

4. **Evaluator I/O contract** – Must the evaluator print a JSON string to stdout, write to a file, or return a Python dict via IPC? Clarify the exact interface so automation can parse results reliably.
   Evaluator must print a JSON dictionary to stdout.

## 2. Data & Persistence Model

5. **`evolution.csv` schema details** – Beyond the five columns listed, are additional fields (e.g. timestamp, random seed, hyper-parameters) required? What fixed set of status codes are expected?
   No additional fields required. Maybe status codes are just '' (meaning not yet implemented), 'failed', 'completed'?

6. **Large artefact storage** – If evolved algorithms produce sizeable checkpoints or models, should those be committed to git, stored in a separate artefact store, or ignored entirely?
   Let's ignore entirely. The algorithm or evaluator will have to decide what to do with those files.
   The initial use case for this involves an algorithm/evaluator that trains ML models in Modal, so
   that will exercise this idea.

## 3. Evolution Strategy & Workflow

7. **Selection policy** – How should the next parent candidate be chosen (best-so-far, weighted sampling, user selection)? Is there a configurable strategy interface?
   Parent candidate is based on basedonID. ID 000 is implied as the baseline. No weighted sampling or user
   selection. This is an LLM-driven R&D system, not using any old mathy-type approaches like are in
   AlphaEvolve.

8. **Stopping condition** – What criteria (max iterations, plateau patience, absolute metric) should cause `claude-evolve run` to stop automatically?
   Keep running until it's out of candidates.

9. **Parallel evaluations** – Is concurrent execution of evaluator jobs desirable? If so, what is the preferred concurrency mechanism (threads, processes, external cluster)?
   Interesting idea! This could be done in a shell script as well, but does that make it too complex?
   It would have to be max N processes as the mechanism.

## 4. User Experience

10. **CLI menu vs. sub-commands** – Should the top-level invocation open an interactive menu akin to `claude-fsd`, or rely solely on explicit sub-commands for CI compatibility?
    both as per `claude-fsd`.

11. **Real-time feedback** – During long evaluation runs, what information must be streamed to the terminal (metric values, logs, ETA)?
    All of the above. Whatever the py files are saying, plus status and performance and iteration ID, etc.
    by `claude-evolve`'s scripts.

12. **Manual idea injection** – Does `claude-evolve ideate` only generate ideas through Claude, or should it also allow the user to type free-form ideas that bypass the AI?
    Totally the user could enter it at any time. Ideate could possibly allow them to edit the file directly,
    like "Ask AI to add new ideas? [Y/n]", and "User directly add new ideas? [y/N]"

## 5. Analysis & Visualisation

13. **Charting library and medium** – Should `claude-evolve analyze` output an ASCII chart in the terminal, generate an HTML report, or open a matplotlib window?
    I think `claude-evolve analyze` could make a png chart with ... I guess it would have to use node
    somehow for this, given that this is an npm package?

14. **Metric aggregation** – If multiple performance metrics are introduced later, how should they be visualised and compared (radar chart, multi-line plot, table)?
    No idea. Right now it's just a performance number.

## 6. Operations & Compliance

15. **Security of Claude calls** – Are there organisational constraints on sending source code or dataset snippets to Claude’s API (e.g. PII redaction, encryption at rest)? Define any red-lines to avoid accidental data leakage.
    There are not. Assume that's handled by the organization.

## 7. Development Process Issues

16. **Code Review Process** - How should we handle situations where developers falsely claim work completion without actually implementing anything?

**Context**: This issue has been resolved. Git repository has been properly initialized with comprehensive .gitignore, initial commit made, and proper development process established.

**Status**: ✅ RESOLVED - Git repository now properly initialized with comprehensive .gitignore covering Node.js dependencies, OS files, editor files, build outputs, and project-specific evolution artifacts. Initial commit completed with all project documentation.

## 8. Git Remote Repository Setup

17. **Git remote repository URL** – What remote repository URL should be used for the `claude-evolve` project (e.g., GitHub, GitLab, self-hosted)? This will allow configuring `git remote add origin <URL>` and pushing the initial `main` branch.

**Context**: Remote `origin` configured to https://github.com/willer/claude-evolve.git and initial `main` branch pushed successfully.
**Status**: ✅ RESOLVED

## 9. Pre-commit Hook Strategy

18. **Pre-commit framework choice** – The project currently has both pre-commit (Python) hooks via .pre-commit-config.yaml and claims about Husky (Node.js) integration. Which approach should be the canonical pre-commit solution? Having both could lead to conflicts or confusion.

**Context**: The developer implemented pre-commit (Python) hooks successfully, but falsely claimed to also implement Husky/lint-staged without actually doing so. This creates confusion about the intended approach.

**Status**: ✅ RESOLVED - Chose pre-commit (Python) as the canonical pre-commit solution. Removed incomplete Husky setup (.husky directory) and updated PLAN.md. Pre-commit provides better integration with shell script tooling (shellcheck, shfmt) and is already working effectively for code quality enforcement.

## 10. Run Command Implementation Questions

25. **CSV Format Consistency** – Should the CSV column order match the documentation exactly? CSV should have five columns (id,basedOnId,description,performance,status).

26. **Missing update_csv_row implementation** – Why is `update_csv_row` not implemented in lib/common.sh? Should the CSV update logic be committed?

27. **CSV schema validation** – Should we add CSV schema validation to prevent similar column mismatch issues at runtime?

28. **Shellcheck warnings resolution** – Should the remaining shellcheck warnings (SC2086, SC2206) be addressed as part of code quality improvements?

29. **Unit tests for CSV manipulation** – Would it be beneficial to add specific unit tests for CSV manipulation functions?

30. **jq requirement for cmd_run** – Should the `cmd_run` implementation verify that the `jq` command-line tool is installed and provide a clear error message if missing?

**Status**: ✅ RESOLVED - Added a pre-flight `jq` availability check in `cmd_run()` to provide a clear error if the JSON parser is missing.

33. **Duplicate/similar idea handling** – How should the ideate command handle duplicate or very similar ideas?
34. **Idea editing/removal** – Should there be a way to edit or remove ideas after they're added?
35. **Claude API rate limits and timeouts** – What's the best way to handle Claude API rate limits or timeouts?
36. **Idea metadata fields** – Should ideas have additional metadata like creation timestamp or source (AI vs manual)?

## 14. Conventional Commits Integration

53. **Commitlint and pre-commit integration** – Should commitlint be integrated with the existing pre-commit framework or use a separate Git hook system? How do we handle the conflict between pre-commit's Python-based approach and potential Node.js-based commit linting?

**Status**: ✅ RESOLVED - Successfully integrated commitlint with pre-commit framework using the alessandrojcm/commitlint-pre-commit-hook. This provides a clean integration that leverages the existing pre-commit infrastructure without needing a separate Node.js-based Git hook system.

## 15. Commitlint Hook Integration

54. **Pre-commit legacy hook conflicts** – The legacy pre-commit hook (/Users/willer/GitHub/claude-evolve/.git/hooks/pre-commit.legacy) was causing interference with the commitlint configuration. Should we investigate cleaning up legacy Node.js pre-commit installations to prevent hook conflicts?

**Status**: ✅ RESOLVED - Removed the problematic legacy pre-commit hook that was trying to execute non-existent ./node_modules/pre-commit/hook. The commitlint hook now works correctly and properly validates commit messages according to conventional commit standards.

## 16. Branch Protection Configuration

55. **Branch protection enforcement level** – The current configuration requires 1 PR review and enforces admin compliance. Should we add additional protections like requiring status checks from CI/CD once GitHub Actions are set up? Should we require linear history to prevent complex merge scenarios?

56. **Status checks integration** – Once CI/CD is implemented, should specific status checks (like test passing, linting, etc.) be required before merging? This would require updating the branch protection rules after Phase 7 CI implementation.

## 17. Git Workflow Compliance

57. **Feature branch enforcement** – How should we ensure developers follow the "One feature branch per phase" process established in the plan, especially given that branch protection rules are now in place? Should we add automation to detect when work is done directly on main branch?

58. **Branch naming conventions** – Should we establish standardized branch naming conventions (e.g., feature/phase-X-description) to improve project organization and automate branch management?

## 18. Timeout Implementation Questions

59. **Process group management** – The current timeout implementation uses bash's `timeout` command which may not kill all child processes if the evaluator spawns subprocesses. Should we implement process group killing (`timeout --kill-after`) to ensure complete cleanup?

60. **Timeout granularity** – Should we support more granular timeout specification (e.g., minutes, hours) or is seconds sufficient for most use cases?

61. **Default timeout behavior** – Should there be a default timeout value when none is specified, or should the current unlimited behavior be maintained? What would be a reasonable default if implemented?

62. **Timeout status differentiation** – Should we differentiate between different types of timeouts (wall-clock vs CPU time) or provide more granular timeout status information?

63. **Timeout recovery** – Should there be automatic retry mechanisms for timed-out evaluations, or should users manually handle timeout scenarios?

64. **Cross-platform timeout compatibility** – The bash `timeout` command may behave differently across platforms (Linux vs macOS vs Windows with WSL). Should we test and document platform-specific timeout behavior?

## 19. Testing Infrastructure Crisis

65. **Critical test failure root cause** – All timeout-related tests are failing despite the implementation appearing correct. What is causing the widespread test infrastructure failure? Is this a Bats configuration issue, environment problem, or fundamental implementation flaw?

66. **Test environment integrity** – Should we implement alternative testing approaches (manual shell scripts, docker-based tests) to verify functionality while Bats issues are resolved?

67. **Timeout verification methodology** – How can we verify the timeout functionality works correctly when the testing framework itself is broken? Should we create standalone verification scripts?
