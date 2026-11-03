# v0.7.0

Fixes the four things from the catalog review at `cb8b1f4`.

## Fixed
- `enhance_prompt` and `/enhance` run again. Hermes calls tool handlers as `handler(args, **kwargs)` and command handlers as `handler(raw_args)`; ctx was expected as the first argument, so the tool raised `TypeError` and the command always printed usage. ctx is now bound in `register()`, and `tests/test_register.py` calls both handlers the way core does.
- Keybind defaults to `mod+shift+e`. `cmd+k` never matched and `mod+k` loses to the command palette.

## Changed
- The sparkle and the score use stateless `llm.oneshot` with the focused session id, instead of creating hidden sessions and polling history. No agent turn per click, so a draft that reads like a task cannot run tools, and no approval prompt lands in a session you cannot see. Nothing leaks: there is no session to close.
- Dropped the **Enhance model** setting and the `llm.model_override` capability. `llm.oneshot` takes the model from the focused session, which the capability does not gate, so the setting was never honoured on the Desktop path. The sparkle always uses the chat's model now.
- Removed the polling backoff, history reader and session-close helpers that only existed for the old path.
