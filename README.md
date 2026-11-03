# Hermes Enhance Prompt

![Hero banner](assets/hero-banner.png)

Sparkle beside Send on [Hermes Desktop](https://hermes-agent.nousresearch.com). Click it to rewrite the composer draft. It does **not** send the message.

- Messy draft → sparkle → numbered agent brief
- Score on the button: `40→72` (before → after)
- Click the discard icon to revert (replaces the draft, does not append)
- Click while spinning to cancel the wait
- Cmd/Ctrl+Shift+E → **Enhance prompt**

Runs one stateless model call on your **current chat's model**. Same language as the original. Does not invent tech you did not name. Does not answer the question — it expands it.

## Demo

![Enhance Prompt demo](assets/demo-enhance-prompt.gif)

Messy draft → sparkle → numbered ask. It does not send.

Higher-quality MP4: [assets/demo-enhance-prompt.mp4](assets/demo-enhance-prompt.mp4)

---

## What the rewrite looks like

**Short / already-clear input** → tight 1–3 numbered steps.

**Substantive input** → a production-grade brief, only the sections that apply:

1. Goal
2. Role & context
3. Scope (IN / OUT)
4. Requirements (3–7 numbered, each one action)
5. Deliverable
6. Quality gates
7. Anti-patterns

---

## Install

```
hermes plugins install tuancookiez-hub/hermes-enhance-prompt
hermes plugins enable enhance-prompt
```

One package covers both halves. The sparkle loads from `desktop/plugin.js` inside the install. Reload desktop plugins (Cmd/Ctrl+K → Reload desktop plugins) if the button is missing.

## Which model it uses

The model of the chat you are in. To use another one for a single draft, switch the chat model before clicking — there is no separate setting to keep in sync.

## Disclosure

Each sparkle click runs **one stateless `llm.oneshot` call** on your gateway, using the current chat's model. It is not an agent turn: no tools run and nothing lands in a session you cannot see, so a draft that reads like a task cannot make it execute anything. The optional score is a second short call. Cancel stops the wait; the in-flight call may still finish. The plugin sends nothing to a third party, does not send the composer message, stores no credentials, has no telemetry and no self-update. Drafts under 8 characters are ignored.

## License

MIT — see `LICENSE`.
