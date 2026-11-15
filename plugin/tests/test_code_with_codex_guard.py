"""code_with_codex.py must never touch a candidate file that is already coded.

A re-score queues rows whose evolution_<id>.py already holds real code. prepare.py reports
already_exists=true for them; if a worker still ran codex (or its parent-restore fallback),
the file would be rewritten and a different program would be scored under the old id.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "code_with_codex.py"


def _workspace(tmp_path: Path) -> Path:
    (tmp_path / "config.yaml").write_text('algorithm_file: "algorithm.py"\nevaluator_file: "evaluator.py"\n'
                                          'brief_file: "BRIEF.md"\nevolution_csv: "evolution.csv"\noutput_dir: ""\n')
    (tmp_path / "BRIEF.md").write_text("test\n")
    (tmp_path / "evaluator.py").write_text("print(1.0)\n")
    (tmp_path / "algorithm.py").write_text("def f():\n    return 1\n")
    (tmp_path / "evolution.csv").write_text(
        "id,basedOnId,description,performance,status\n"
        "gen01-001,,make f return 2,,pending\n")
    return tmp_path


def _run(ws: Path, cid: str):
    env = dict(os.environ, PATH="/usr/bin:/bin")  # no codex on PATH: the guard must fire first
    return subprocess.run([sys.executable, str(SCRIPT), "--working-dir", str(ws), cid],
                          capture_output=True, text=True, env=env)


def test_already_coded_file_is_refused_and_left_untouched(tmp_path):
    ws = _workspace(tmp_path)
    coded = "def f():\n    return 2  # already coded\n"
    target = ws / "evolution_gen01-001.py"
    target.write_text(coded)

    proc = _run(ws, "gen01-001")

    assert proc.returncode == 3, proc.stdout + proc.stderr
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert out["already_coded"] is True and out["ok"] is False and out["invoked"] is False
    assert target.read_text() == coded


def test_pristine_parent_copy_is_not_refused(tmp_path):
    ws = _workspace(tmp_path)
    target = ws / "evolution_gen01-001.py"
    target.write_text((ws / "algorithm.py").read_text())

    proc = _run(ws, "gen01-001")

    out = json.loads(proc.stdout.strip().splitlines()[-1])
    assert not out.get("already_coded")
    assert "codex CLI not found" in out.get("error", "")
