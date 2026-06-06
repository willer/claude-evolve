---
name: evolve-score
description: Score one evolution candidate against the workspace evaluator. Runs the candidate's evolution_<id>.py through evaluator.py under the same sandbox the claude-evolve engine uses, parses the performance number, and writes status + performance back to evolution.csv. Use when the user says "score gen02-003", "evaluate this candidate", "run the evaluator on <id>", or when a parent skill dispatches scoring. Scoring is deterministic (no model reasoning needed) — this skill exists so the evaluator's output noise stays out of the main conversation.
argument-hint: "<candidate-id> [--working-dir DIR]"
---

# evolve-score

Score a single candidate. This is **deterministic** — the work is "run the user's `evaluator.py` and record the number." There is no algorithmic judgment to make. The reason it is a skill (and, in the omnibus, a Haiku subagent) is purely to keep evaluator output — which can be thousands of lines — out of the main conversation.

## Resolve the plugin root

This skill runs with `$CLAUDE_PLUGIN_ROOT` set. Capture it:

```bash
echo "PLUGIN_ROOT=$CLAUDE_PLUGIN_ROOT"
```

If a subagent invoked you without it, fall back to the path the caller passed you in the prompt.

## Score the candidate

Run exactly one command. It syntax-checks the candidate, runs `validator.py` if the workspace has one, runs `evaluator.py` under the sandbox, parses the score, and writes the result to the CSV:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/scripts/score.py" --working-dir "<WORKING_DIR>" <CANDIDATE_ID>
```

- `<WORKING_DIR>` is the evolution workspace (the directory containing `config.yaml`). If the user didn't specify one, omit `--working-dir` and let it auto-detect `evolution/config.yaml` or `./config.yaml`.
- The script prints **one JSON line on stdout** (everything else is stderr noise you can ignore):
  - success: `{"id":"...","ok":true,"score":1.23,"status":"complete","extra":{...}}`
  - failure: `{"id":"...","ok":false,"status":"failed|failed-validation","error":"...","stage":"syntax|validator|evaluator"}`

The script has already written the status and performance to `evolution.csv` either way — you do not touch the CSV yourself.

## Report

Return a single line to whoever called you:

- success → `<id>: score=<n> (complete)`
- failure → `<id>: FAILED at <stage> — <short error> (status=<status>)`

Do **not** dump the full evaluator output into your reply. If the user explicitly asks why something failed, include the `error` field; otherwise keep it to the one-liner. That brevity is the whole point of running scoring in an isolated context.

## Do not

- Do not edit the candidate's code to make it pass — that is evolve-code's job. A failing score is a real result, not a problem to fix here.
- Do not retry with a different evaluator or fabricate a score. If the evaluator fails, report the failure honestly; the engine has recorded `failed`.
