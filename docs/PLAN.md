# Plan

No open items. Completed and accepted work is in git history (`git log docs/PLAN.md`).
- [x] switch ideation from Fable 5.1 xhigh to Opus 5.5 high (benchmarks + newer knowledge); keep Astra, skip Sol
  - `plugin/agents/ideator.md` → opus/high; dice-roll source `fable` → `opus` in `ideate_branch.py`, both skills, both READMEs, both manifests. Plugin 0.3.3. See TRUTH.
- [x] make sure that greenhouse launches its shells niced, so the evolutions run niced. the inference should NOT run niced though.
  - Evolution, adhoc, shell and backtest-all sessions now start under `nice -n 10`; only the inference-all tool session runs at normal priority (`greenhouse/src/core/state.ts`).
  - Running sessions keep their old priority until restarted, and inference-all run by hand from a niced Greenhouse shell stays niced, because a process can't lower its niceness without root.
  - If it misbehaves, check `ps -o nice= -p <pid>` on the claude process and on inference-all's children. The app needs `./run-greenhouse` to pick up the change.