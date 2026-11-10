# Plan

No open items. Completed and accepted work is in git history (`git log docs/PLAN.md`).
- [x] reweight ideation toward Fable 5.2: d8 roll, 1/8 Opus 5.5, 3/8 Fable 5.2, 2/8 Astra, 1/8 Argon, 1/8 Grok
  - evolve-ideate roll + re-roll example, `ideate_branch.py` policy note, both READMEs. See TRUTH.
- [x] add Fable 5.1 high back to the ideation roll for idea diversity: 2/6 Opus 5.5 high, 1/6 Fable 5.1 high, 2/6 Astra xhigh, 1/6 Grok 4.7
  - New `plugin/agents/ideator-fable.md`; `fable` source in `ideate_branch.py`; evolve-ideate roll and dispatch; READMEs, manifests. Plugin 0.3.7. See TRUTH.
- [x] switch ideation from Fable 5.1 xhigh to Opus 5.5 high (benchmarks + newer knowledge); keep Astra, skip Sol
  - `plugin/agents/ideator.md` → opus/high; dice-roll source `fable` → `opus` in `ideate_branch.py`, both skills, both READMEs, both manifests. Plugin 0.3.3. See TRUTH.
- [x] make sure that greenhouse launches its shells niced, so the evolutions run niced. the inference should NOT run niced though.
  - Evolution, adhoc, shell and backtest-all sessions now start under `nice -n 10`; only the inference-all tool session runs at normal priority (`greenhouse/src/core/state.ts`).
  - Running sessions keep their old priority until restarted, and inference-all run by hand from a niced Greenhouse shell stays niced, because a process can't lower its niceness without root.
  - If it misbehaves, check `ps -o nice= -p <pid>` on the claude process and on inference-all's children. The app needs `./run-greenhouse` to pick up the change.