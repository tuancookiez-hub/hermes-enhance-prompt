"""Hermes Enhance Prompt — Desktop UI extension + agent-side tool.

The Desktop chrome (sparkle beside Send) lives in ``desktop/plugin.js`` and is
loaded as a blob URL by the Hermes Desktop runtime. It is **not** the agent
plugin API documented at
``hermes-agent.nousresearch.com/docs/user-guide/features/plugins``; the Desktop
hot-reload and SDK restrictions are different (see HANDOFF in the
``hermes-experts-plugin`` for the long form).

This file does the agent-side half: registers a ``/enhance`` slash command and
a ``enhance_prompt`` tool so the same rewrite logic is callable from the CLI,
the gateway, MCP hosts, and any other surface that picks up agent plugins.

The Desktop sparkle and the agent tool share the same SYSTEM + USER_WRAP
templates in ``prompts.py`` so behaviour stays identical.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

from .prompts import SYSTEM, build_user_message, strip_wrappers, MAX_CHARS

__version__ = "0.4.0"
logger = logging.getLogger(__name__)

TOOL_NAME = "enhance_prompt"
TOOL_DESCRIPTION = (
    "Rewrite a user prompt into a clearer, more specific version as a short "
    "goal line followed by a numbered task list (1. 2. 3.). Matches the "
    "original language. Does not answer the request."
)

SCHEMA: Dict[str, Any] = {
    "name": TOOL_NAME,
    "description": TOOL_DESCRIPTION,
    "parameters": {
        "type": "object",
        "properties": {
            "input": {
                "type": "string",
                "description": "The original user prompt to enhance.",
                "minLength": 8,
            },
            "max_chars": {
                "type": "integer",
                "description": "Soft hint for max_tokens. Use 0 for no cap (recommended).",
                "minimum": 0,
                "maximum": 128000,
                "default": 0,
            },
        },
        "required": ["input"],
    },
}


def _enhance_text(ctx, input_text: str, max_chars: int) -> str:
    if not isinstance(input_text, str) or len(input_text.strip()) < 8:
        raise ValueError("input must be a string of at least 8 characters")

    # No hard cap on output. max_chars is a soft hint passed to
    # max_tokens; the user sees the full model response.
    if not isinstance(max_chars, (int, float)):
        max_chars = 0
    max_chars = max(0, min(int(max_chars), 128000))

    user_msg = build_user_message(input_text)
    # When cap is 0 the model writes as much as it needs; otherwise the
    # budget tracks the soft target.
    max_tok = min(16384, max(256, max_chars * 2)) if max_chars else 16384
    raw = ctx.llm.complete(
        system=SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
        temperature=0.2,
        max_tokens=max_tok,
    )
    text = strip_wrappers(raw or "").strip()
    if not text:
        raise RuntimeError("enhance_prompt: empty response from model")
    return text


def _tool_handler(ctx, params, **_kwargs):
    input_text = ""
    max_chars = MAX_CHARS
    if isinstance(params, dict):
        input_text = str(params.get("input") or "")
        raw_chars = params.get("max_chars", MAX_CHARS)
        if raw_chars is not None:
            try:
                max_chars = int(raw_chars)
            except (TypeError, ValueError):
                max_chars = MAX_CHARS
    elif isinstance(params, str):
        input_text = params
    if not input_text:
        return json.dumps({"success": False, "error": "missing 'input'"}, ensure_ascii=False)
    try:
        return json.dumps(
            {"success": True, "enhanced": _enhance_text(ctx, input_text, max_chars)},
            ensure_ascii=False,
        )
    except Exception as exc:  # noqa: BLE001 - surface to the user
        logger.warning("enhance-prompt: tool call failed: %s", exc)
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


def _slash_enhance(ctx, args: str = "") -> str:
    text = (args or "").strip()
    if len(text) < 8:
        return "Usage: /enhance <prompt text (8+ chars)>"
    try:
        return _enhance_text(ctx, text, MAX_CHARS)
    except Exception as exc:  # noqa: BLE001 - surface to the user
        logger.warning("enhance-prompt: rewrite failed: %s", exc)
        return f"Enhance failed: {exc}"


def register(ctx) -> None:
    """Wire the tool + slash command into the running Hermes agent."""
    ctx.register_tool(
        name=TOOL_NAME,
        toolset="enhance_prompt",
        schema=SCHEMA,
        handler=_tool_handler,
    )
    ctx.register_command(
        name="enhance",
        description="Rewrite a prompt as a numbered task list. Usage: /enhance <text>",
        handler=_slash_enhance,
        args_hint="<prompt text>",
    )
