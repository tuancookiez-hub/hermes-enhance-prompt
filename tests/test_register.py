"""Call the registered handlers the way core does.

Hermes invokes tool handlers as ``handler(args, **kwargs)`` and command
handlers as ``handler(raw_args)``. A ctx-as-first-parameter signature
registers fine but raises TypeError at call time, which no other test
catches — so exercise both call shapes here.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

_ROUND = 2

_ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "enhance_prompt", _ROOT / "__init__.py", submodule_search_locations=[str(_ROOT)]
)
assert _SPEC and _SPEC.loader
_mod = importlib.util.module_from_spec(_SPEC)
sys.modules["enhance_prompt"] = _mod
_SPEC.loader.exec_module(_mod)


class _Reply:
    def __init__(self, text: str) -> None:
        self.text = text


class _Llm:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def complete(self, messages, **kwargs):
        self.calls.append({"messages": messages, "kwargs": kwargs})
        return _Reply("Fix the login.\n1. Find the bug.")


class _Ctx:
    def __init__(self) -> None:
        self.llm = _Llm()
        self.tools: dict = {}
        self.commands: dict = {}

    def register_tool(self, **kw):
        self.tools[kw["name"]] = kw

    def register_command(self, **kw):
        self.commands[kw["name"]] = kw


def _wire():
    ctx = _Ctx()
    _mod.register(ctx)
    return ctx


def test_tool_handler_takes_args_positionally():
    ctx = _wire()
    out = ctx.tools["enhance_prompt"]["handler"]({"input": "fix the login"})
    assert json.loads(out)["success"] is True
    assert json.loads(out)["enhanced"].startswith("Fix the login.")
    sent = ctx.llm.calls[0]["messages"]
    assert sent[0]["role"] == "system"
    assert "fix the login" in sent[1]["content"]


def test_command_handler_takes_raw_args():
    ctx = _wire()
    out = ctx.commands["enhance"]["handler"]("fix the login")
    assert out.startswith("Fix the login.")
    assert ctx.llm.calls[0]["kwargs"]["temperature"] == 0.2


def test_command_short_input_is_usage():
    ctx = _wire()
    assert ctx.commands["enhance"]["handler"]("hi").startswith("Usage:")
    assert ctx.llm.calls == []


def test_tool_error_is_json():
    ctx = _wire()
    out = ctx.commands["enhance"]["handler"]("x" * 20)
    assert out  # sanity
    err = ctx.tools["enhance_prompt"]["handler"]({"input": "short"})
    assert json.loads(err)["success"] is False


if __name__ == "__main__":
    test_tool_handler_takes_args_positionally()
    test_command_handler_takes_raw_args()
    test_command_short_input_is_usage()
    test_tool_error_is_json()
    print("ok")
