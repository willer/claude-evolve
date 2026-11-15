"""Every ideation prompt forbids choosing constants by replaying the evaluator's scored data.

Replaying the scored windows to pick a gain or threshold fits the test set: the score rises and
the sealed holdout does not. The rule must reach every source (subagent and external CLIs),
so it lives in build_prompt, which writes the prompt file all of them read.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import ideate_branch  # noqa: E402


def test_every_strategy_prompt_forbids_replay_tuning():
    ctx = {"existing_descriptions": [], "top_performers": [], "brief": "b", "notes": ""}
    for strategy in ideate_branch.STRATEGIES:
        prompt = ideate_branch.build_prompt(ctx, strategy, ["gen01-001"], None, {}, "")
        assert ideate_branch.NO_REPLAY_TUNING in prompt
        assert "replay" in ideate_branch.NO_REPLAY_TUNING.lower()
