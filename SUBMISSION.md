# Add enhance-prompt to the plugin catalog

## What it does

A sparkle beside Send rewrites the composer draft into a structured brief without sending it. Further clicks deepen the brief. `/enhance` and the `enhance_prompt` tool do the same rewrite from the agent.

## Hermes surfaces used

- Desktop `COMPOSER_AREAS.actions`, palette, and a keybind. Draft read/write is `host.composer.getDraft` / `setDraft`. No app DOM queries.
- Hidden `session.create` + `prompt.submit` for the rewrite, and optionally a second hidden session to score it. `model` is passed only when the setting is not `auto`.
- Agent: `ctx.register_tool(enhance_prompt)` and `ctx.register_command(enhance)`. Completions go through `ctx.llm.complete`. A non-auto model uses `llm.model_override`.

## Risky behaviour

- Opens hidden gateway sessions and spends the user's model credits (one rewrite, plus an optional score).
- When Enhance model is not `auto`, pins that model id on those sessions. `auto` uses the chat's current model and does not override.
- Reads plugin settings via `plugins.manage`. No credentials, no third-party network, no filesystem writes, no telemetry, no self-update.

## Validation

- [ ] `hermes plugins validate . --install-deps` passes at the pinned SHA
