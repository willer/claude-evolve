"""The OpenRouter route reads the answer from claude -p's stream, not its `result` field.

Gemini via OpenRouter ends its turn with an empty `redacted_thinking` message after the
text, and claude -p fills `result` from that last message only, so `result` is "". The
stream below has the shape claude -p printed for Gemini 4 Carbon on 2026-11-15.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import ideate_branch  # noqa: E402


def _stream(*events):
    return "\n".join(json.dumps(e) for e in events)


def _assistant(*blocks):
    return {"type": "assistant", "message": {"content": list(blocks)}}


RESULT_OK = {"type": "result", "is_error": False, "result": ""}


def test_text_before_trailing_redacted_thinking_is_the_answer():
    s = _stream(_assistant({"type": "text", "text": '[{"id":"a"}]'}),
                _assistant({"type": "redacted_thinking", "data": ""}), RESULT_OK)
    assert ideate_branch.final_turn_text(s) == '[{"id":"a"}]'


def test_text_before_a_tool_call_is_dropped():
    s = _stream(_assistant({"type": "text", "text": "I'll inspect the leader."},
                           {"type": "tool_use", "name": "Read", "input": {}}),
                {"type": "user", "message": {"content": []}},
                _assistant({"type": "text", "text": "[]"}), RESULT_OK)
    assert ideate_branch.final_turn_text(s) == "[]"


def test_empty_final_turn_fails_loud():
    s = _stream(_assistant({"type": "redacted_thinking", "data": ""}), RESULT_OK)
    with pytest.raises(RuntimeError, match="no answer text"):
        ideate_branch.final_turn_text(s)


def test_api_error_fails_loud():
    s = _stream({"type": "result", "is_error": True, "result": "API Error: 403 Key limit exceeded"})
    with pytest.raises(RuntimeError, match="403"):
        ideate_branch.final_turn_text(s)


def test_cut_off_draft_then_full_answer_keeps_the_full_answer():
    draft = '[\n {"id": "a", "description": "cut off\n'
    full = '[{"id": "a", "description": "complete"}]'
    s = _stream(_assistant({"type": "text", "text": draft}),
                _assistant({"type": "text", "text": full}),
                _assistant({"type": "redacted_thinking", "data": ""}), RESULT_OK)
    assert ideate_branch.final_turn_text(s) == full
