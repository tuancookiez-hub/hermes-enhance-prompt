"""Load prompts.py by path — the plugin dir name is not a valid Python package."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location("enhance_prompts", _ROOT / "prompts.py")
assert _SPEC and _SPEC.loader
_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_mod)

build_user_message = _mod.build_user_message
strip_wrappers = _mod.strip_wrappers
SYSTEM = _mod.SYSTEM
USER_TEMPLATE = _mod.USER_TEMPLATE
MAX_CHARS = _mod.MAX_CHARS


def test_build_user_message_injects_input():
    out = build_user_message("fix the login")
    assert "fix the login" in out
    assert "{input}" not in out
    assert USER_TEMPLATE.split("{input}")[0] in out


def test_strip_wrappers_thinking_and_channels():
    raw = "<think>secret</think><|channel|>x\nFix the login.\n1. Find the bug."
    out = strip_wrappers(raw)
    assert "secret" not in out
    assert "<think>" not in out
    assert "Fix the login" in out


def test_strip_wrappers_empty():
    assert strip_wrappers("") == ""


def test_strip_wrappers_fullwidth_channel_tags():
    # Fullwidth channel tags used by some serving backends.
    raw = "<｜o1｜>final output<｜/o1｜>"
    assert strip_wrappers(raw) == "final output"
    # Multi-line channel block.
    raw = "<｜channel｜>line one\nline two<｜/channel｜>\nafter"
    assert strip_wrappers(raw) == "after"
    # Naked think block.
    raw = "<think>\nlet me think\n</think>\nactual answer"
    assert strip_wrappers(raw) == "actual answer"


def test_max_chars_and_system_present():
    # MAX_CHARS = 0 means "no cap" — model decides the brief length.
    assert MAX_CHARS == 0
    assert "Do NOT answer the request" in SYSTEM
    assert "numbered" in SYSTEM.lower()
    # The no-cap rule should be in the system prompt.
    assert "exactly as much" in SYSTEM or "as much as the brief needs" in SYSTEM


if __name__ == "__main__":
    test_build_user_message_injects_input()
    test_strip_wrappers_thinking_and_channels()
    test_strip_wrappers_empty()
    test_max_chars_and_system_present()
    print("ok")
