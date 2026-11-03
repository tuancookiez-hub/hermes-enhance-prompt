# Add enhance-prompt to the plugin catalog

## What it does

A sparkle beside Send rewrites the composer draft into a structured brief without sending it. Further clicks deepen the brief. `/enhance` and the `enhance_prompt` tool do the same rewrite from the agent.

## Hermes surfaces used

- Desktop `COMPOSER_AREAS.actions`, palette, and a keybind (`mod+shift+e`). Draft read/write is `host.composer.getDraft` / `setDraft`. No app DOM queries.
- `llm.oneshot` for the rewrite, and a second short `llm.oneshot` for the optional score, both with `session_id` set to the focused session so they take its model. Stateless: no agent turn, no tools, no history.
- Agent: `ctx.register_tool(enhance_prompt)` and `ctx.register_command(enhance)`, with ctx bound at registration so the `handler(args, **kwargs)` / `handler(raw_args)` call shapes core uses work. Completions go through `ctx.llm.complete`.

## Risky behaviour

- Spends the user's model credits: one call per click, plus one for the score.
- Uses the chat's current model and overrides nothing, so no `llm.model_override` consent is needed.
- No credentials, no third-party network, no filesystem writes, no telemetry, no self-update. It never sends the composer message.

## Validation

- [ ] `hermes plugins validate . --install-deps` passes at the pinned SHA


## PR

https://github.com/NousResearch/hermes-agent/pull/148095
