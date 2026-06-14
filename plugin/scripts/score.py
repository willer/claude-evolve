#!/usr/bin/env python3
"""
Score one candidate: syntax-check, optional validator, sandboxed evaluation,
then write the result back to evolution.csv.

This is the deterministic core of evolve-score. It needs no AI — it just runs
the user's evaluator.py under a macOS sandbox and records the number. A Haiku
subagent wraps it only to keep the evaluator's output noise out of the main
conversation.

On success: sets the candidate to 'complete', writes performance + any extra
JSON metric fields, and prints a JSON result.
On failure: sets an appropriate failed-* status and exits non-zero.

Output JSON (always):
  {"id":"...","ok":true,"score":1.23,"status":"complete","extra":{...}}
  {"id":"...","ok":false,"status":"failed","error":"...","stage":"syntax|validator|evaluator"}

Exit codes: 0 ok; 1 syntax/validator/eval failure (status written).
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from evolve_common import add_workspace_args, load_workspace, PLUGIN_ROOT

sys.path.insert(0, str(PLUGIN_ROOT))
from lib.evolution_csv import EvolutionCSV
from lib.sandbox_wrapper import run_sandboxed, sandbox_exec_available

BASELINE_IDS = {"baseline", "baseline-000", "000", "0", "gen00-000"}


def parse_evaluator_output(output: str):
    """Parse score + extra fields. Supports numeric, JSON(performance/score), SCORE:."""
    score = None
    json_data = {}
    for line in output.strip().split("\n"):
        line = line.strip()
        if line.startswith("{"):
            try:
                data = json.loads(line)
                json_data = data
                if "performance" in data:
                    score = float(data["performance"])
                elif "score" in data:
                    score = float(data["score"])
                break
            except (json.JSONDecodeError, ValueError):
                pass
        if score is None and line and not line.startswith("{"):
            try:
                score = float(line)
                break
            except ValueError:
                pass
    if score is None:
        m = re.search(r"^SCORE:\s*([+-]?\d*\.?\d+)", output, re.MULTILINE)
        if m:
            try:
                score = float(m.group(1))
            except ValueError:
                pass
    return score, json_data


def emit_and_exit(obj, code):
    print(json.dumps(obj))
    sys.exit(code)


def main():
    parser = argparse.ArgumentParser(description="Score one candidate")
    add_workspace_args(parser)
    parser.add_argument("id")
    args = parser.parse_args()

    ws = load_workspace(args.working_dir, args.config)
    is_baseline = args.id in BASELINE_IDS
    target = None if is_baseline else ws.output_dir / f"evolution_{args.id}.py"

    # 1. Syntax check (skip for baseline, which evaluates algorithm.py directly)
    if target is not None:
        if not target.exists():
            with EvolutionCSV(str(ws.csv_path)) as csv:
                csv.update_candidate_status(args.id, "failed")
            emit_and_exit({"id": args.id, "ok": False, "status": "failed",
                           "error": f"target file missing: {target.name}", "stage": "syntax"}, 1)
        sc = subprocess.run([ws.python_cmd, "-m", "py_compile", str(target)],
                            capture_output=True, text=True)
        if sc.returncode != 0:
            with EvolutionCSV(str(ws.csv_path)) as csv:
                csv.update_candidate_status(args.id, "failed-validation")
            emit_and_exit({"id": args.id, "ok": False, "status": "failed-validation",
                           "error": sc.stderr.strip(), "stage": "syntax"}, 1)

    # 2. Optional validator.py smoke test
    validator = ws.evolution_dir / "validator.py"
    if validator.exists() and not is_baseline:
        vr = subprocess.run([ws.python_cmd, str(validator), args.id],
                            capture_output=True, text=True, timeout=300,
                            cwd=str(ws.evolution_dir))
        if vr.returncode != 0:
            detail = (vr.stdout + "\n" + vr.stderr).strip()
            with EvolutionCSV(str(ws.csv_path)) as csv:
                csv.update_candidate_status(args.id, "failed-validation")
                csv.update_candidate_field(args.id, "validation_error", detail[:200])
            emit_and_exit({"id": args.id, "ok": False, "status": "failed-validation",
                           "error": detail, "stage": "validator"}, 1)

    # 3. Run evaluator (sandboxed)
    eval_cmd = [ws.python_cmd, str(ws.evaluator_path)]
    if not is_baseline:
        eval_cmd.append(args.id)
    use_sandbox = ws.sandbox_enabled and sandbox_exec_available()
    returncode, stdout, stderr = run_sandboxed(
        command=eval_cmd,
        evolution_dir=str(ws.evolution_dir),
        memory_mb=ws.memory_limit_mb,
        cpu_seconds=ws.cpu_limit_seconds,
        timeout_seconds=ws.timeout_seconds,
        use_sandbox=use_sandbox,
    )
    if returncode != 0:
        with EvolutionCSV(str(ws.csv_path)) as csv:
            csv.update_candidate_status(args.id, "failed")
        emit_and_exit({"id": args.id, "ok": False, "status": "failed",
                       "error": (stderr or stdout).strip()[-500:], "stage": "evaluator"}, 1)

    score, json_data = parse_evaluator_output(stdout + stderr)
    if score is None:
        with EvolutionCSV(str(ws.csv_path)) as csv:
            csv.update_candidate_status(args.id, "failed")
        emit_and_exit({"id": args.id, "ok": False, "status": "failed",
                       "error": "no score parsed from evaluator output", "stage": "evaluator"}, 1)

    extra = {k: v for k, v in json_data.items() if k not in ("performance", "score")}
    with EvolutionCSV(str(ws.csv_path)) as csv:
        csv.update_candidate_status(args.id, "complete")
        csv.update_candidate_performance(args.id, str(score))
        for k, v in extra.items():
            csv.update_candidate_field(args.id, k, str(v))

    emit_and_exit({"id": args.id, "ok": True, "score": score,
                   "status": "complete", "extra": extra}, 0)


if __name__ == "__main__":
    main()
