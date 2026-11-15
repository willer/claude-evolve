"""Legacy CLI coder selection: the bandit only picks CONFIGURED models.

A workspace's llm_bandit.json keeps stats for every model it ever used. Loading it
used to re-add those models, so select_model() kept picking models (kimi-coder,
kimi-k2.5, gpt-5-codex...) long after the config stopped naming them.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lib"))
from llm_bandit import LLMBandit  # noqa: E402


def test_saved_stats_for_removed_models_are_dropped(tmp_path):
    state = tmp_path / "llm_bandit.json"
    old = LLMBandit(["kimi-coder", "codex-coding"], state_file=str(state))
    old.update("kimi-coder", child_score=2.0, parent_score=1.0)
    old.update("codex-coding", child_score=1.5, parent_score=1.0)
    assert "kimi-coder" in json.loads(state.read_text())["models"]

    new = LLMBandit(["codex-coding"], state_file=str(state))
    assert list(new.models) == ["codex-coding"]
    assert new.models["codex-coding"].n_completed == 1  # configured stats survive
    assert {new.select_model() for _ in range(50)} == {"codex-coding"}


def test_cli_coding_defaults_match_plugin_coder():
    out = subprocess.run(
        ["bash", "-c", f'source "{ROOT}/lib/config.sh"; echo "$DEFAULT_LLM_RUN|$DEFAULT_LLM_RUN_ESCALATION"'],
        capture_output=True, text=True, check=True).stdout.strip()
    assert out == "codex-coding|opus"
    cli = (ROOT / "lib" / "ai-cli.sh").read_text()
    assert 'codex exec -m gpt-5.6-luna -c model_reasoning_effort="max" -s workspace-write' in cli
    assert "--model opus --effort medium" in cli
    plugin = (ROOT / "plugin" / "scripts" / "code_with_codex.py").read_text()
    assert 'DEFAULT_MODEL = "gpt-5.6-luna"' in plugin
