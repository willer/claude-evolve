---
name: evolve-code
description: Write the code for one evolution candidate. Resolves the candidate's parent algorithm, copies it to evolution_<id>.py, then edits that file to implement the candidate's description from evolution.csv. Use when the user says "code gen02-003", "write the algorithm for this candidate", "implement idea <id>", or when a parent skill dispatches coding. This is the Sonnet-tier step of the loop: real algorithmic edits, following the idea's description exactly.
argument-hint: "<candidate-id> [--working-dir DIR]"
---

# evolve-code

Implement one candidate's idea as working code. The candidate already exists in `evolution.csv` with a `description` (the idea) and a `basedOnId` (its parent). Your job: turn the description into a real, substantial code change on a copy of the parent algorithm.

This is the **Sonnet-tier** step — it needs genuine coding judgment. Keep it isolated in a subagent when driven by the omnibus, so the file reads and edits don't flood the main conversation.

## Resolve the plugin root

```bash
echo "PLUGIN_ROOT=$CLAUDE_PLUGIN_ROOT"
```

If a subagent invoked you without it, use the path the caller passed in the prompt.

## Step 1 — Prepare the file (deterministic)

Run the prepare script. It resolves the parent, copies `evolution_<parent>.py` (or `algorithm.py` for a baseline-rooted idea) to `evolution_<id>.py`, and tells you what to implement:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/scripts/prepare.py" --working-dir "<WORKING_DIR>" <CANDIDATE_ID>
```

It prints one JSON line:
```json
{"id":"...","is_baseline":false,"description":"...","parent":"gen01-002",
 "target_path":"/abs/evolution_gen02-001.py","target_basename":"evolution_gen02-001.py",
 "already_exists":false}
```

- **Exit code 2** → the parent file could not be found. Do not invent a parent. Report `<id>: BLOCKED — parent missing (<basedOnId>)` and stop; the engine should mark it `failed-parent-missing`.
- **`is_baseline: true`** → there is nothing to code (the baseline evaluates `algorithm.py` as-is). Report `<id>: baseline — no code change needed` and stop.
- **`already_exists: true`** → the target file was already present. Do not re-copy. Treat the existing file as the starting point only if the user explicitly asked to redo it; otherwise report `<id>: already coded` and stop so it can go straight to scoring.

## Step 2 — Implement the idea (your real work)

Open `target_path` and modify it to implement `description`. Requirements:

1. **Make a substantial, on-description change.** Don't just add comments or rename things. The change must actually do what the description says.
2. **Preserve the interface.** The evaluator calls the algorithm the same way for every candidate — keep the same entry points, function signatures, and I/O contract the parent had. Read the parent and, if needed, `evaluator.py` to confirm the contract before editing.
3. **Read large files in chunks** (offset/limit) to avoid context overload.
4. **Refuse rather than guess.** If the description is unclear, infeasible, or you don't know how to implement it correctly, do **not** make random changes. Leave the file as the unmodified parent copy and report `<id>: REFUSED — <one-line reason>`. A faithful refusal is better than a fabricated edit — the engine will record it and move on. (This honors claude-evolve's fail-loud principle: don't fake work.)

After editing, sanity-check the syntax:

```bash
python3 -m py_compile "<target_path>"
```

If it fails, fix it. If you can't, report `<id>: REFUSED — could not produce valid syntax`.

## Step 3 — Report

Return a single line:

- coded → `<id>: coded — <one-line summary of the change> (ready to score)`
- baseline / already-coded / blocked / refused → the matching line above.

Do **not** score the candidate here — that's evolve-score. Leave the candidate at status `running` (prepare/claim already set it); the parent skill or evolve-score takes it from here. If you were invoked standalone by the user and they want a score too, tell them to run `evolve-score <id>` (or run it yourself as a separate step).
