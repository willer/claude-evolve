# Claude-Evolve – AI Working Notes

These notes capture my current understanding of the project, the major design choices already fixed in the brief / Q&A, and the open items that still require clarification. They are **living notes** – feel free to edit or extend them during the implementation.

## 1. Project Understanding

1. **Purpose** – Provide a lightweight command-line tool (`claude-evolve`) that orchestrates an _algorithm-evolution_ workflow driven by Claude AI. The tool repeatedly:
   • plans → develops a candidate → runs the evaluator → records the result → lets the user/AI propose the next mutation.

2. **Inspiration** – It mirrors the successful `claude-fsd` package (software delivery), but targets algorithm R&D. The entire CLI is implemented as simple **Bourne-compatible shell scripts** published as an **npm** package – no compiled binaries, no extra runtime besides POSIX sh and Node.

3. **Artifacts produced**
   • `evolution/BRIEF.md`  – high-level goal of the algorithm being optimised
   • `evolution/evolution.csv` – log of all candidates (ID,basedOnID,description,performance,status)
   • `evolution/evolution_details.md` – free-form explanation / commentary per candidate
   • `evolution/evolution_idNNN.<ext>` – snapshot of the concrete algorithm evaluated

4. **Evaluator contract** – An _executable_ (often Python, but not required) that receives the candidate file path as its sole argument and prints a **single-line JSON dict** to stdout, e.g. `{"score": 0.87}`. Claude-evolve treats the first numeric value in that dict as "performance" (higher is better).

## 2. Key Technical Decisions & Rationale

• **Shell scripts in an npm package** – keeps the runtime guarantees identical to `claude-fsd`, leverages cross-platform Node installer, and avoids the overhead of compiling/packaging native binaries.

• **LLM-driven search** – instead of classic genetic algorithms, we rely on Claude to suggest mutations based on the project history and metrics. The human operator can inject ideas at any point (`claude-evolve ideate`).

• **File-system persistence** – CSV + Markdown files are trivial to diff and review in Git. Snap-shooting each algorithm version guarantees perfect reproducibility.

• **Single-metric MVP** – Start with exactly one performance number to keep the loop simple; extend to multi-metric later (post-MVP roadmap).

• **Menu _and_ sub-commands** – An interactive menu for exploratory use, plus explicit sub-commands for CI automation, following `claude-fsd` precedent.

• **Visualization as PNG via Node** – Node libraries (e.g. `chartjs-node-canvas`) generate a static PNG for `claude-evolve analyze`, sidestepping browser dependencies.

• **Git-first workflow** – All artifacts (except large training artefacts / checkpoints) tracked in Git. Users work on feature branches; PRs reviewed like any other code change.

• **Strict YAGNI** – Avoid prematurely implementing fancy features (branching selection strategies, cloud storage, etc.) until a real need emerges.

## 3. Assumptions & Constraints

1. `claude` CLI is installed and authenticated in the user’s environment.
2. Users have a POSIX-style shell environment (bash/zsh/sh) and Node ≥16.
3. Evaluations may be _slow_ and resource-intensive; scheduling and cost control are left to the evaluator implementation.
4. The repository **should not** store large binary artefacts – evaluator is responsible for external storage if needed.
5. Concurrency: MVP evaluates _one_ candidate at a time; optional parallelism (max-N background processes) is documented as a stretch goal.

## 4. Areas Requiring Future Clarification

• **Charting implementation** – exact Node library and minimum PNG spec (size, axis labels).
• **Pre-commit policy** – exactly which linters (shellcheck, shfmt, prettier-markdown, …) are required.
• **Timeout/Resource limits** – default wall-clock limit for an evaluation and how to surface that to the user.
• **Multi-metric support** – data model changes (`evolution.csv`) once we decide to support >1 metric.
• **Security/PII** – explicit organisational policy might evolve (currently "no constraints").
• **Distribution** – npm org name, versioning scheme, release cadence.

---

These notes should evolve alongside the code. When a decision is implemented, reflect it here so future contributors can quickly understand the rationale.
