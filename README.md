# Hermes Enhance Prompt

![Hero banner](assets/hero-banner.png)

Sparkle beside Send on [Hermes Desktop](https://hermes-agent.nousresearch.com). Click it to rewrite the composer draft. It does **not** send the message.

- Messy draft → sparkle → numbered agent brief
- Score on the button: `40→72` (before → after)
- Click the discard icon to revert (replaces the draft, does not append)
- Click while spinning to cancel the wait
- Ctrl/Cmd+K → **Enhance prompt**

Uses your **current Desktop model** via a hidden Hermes session. Same language as the original. Does not invent tech you did not name. Does not answer the question — it expands it.

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

## Desktop: the sparkle

### Install (paste into Hermes to have another agent do it)

```
Install the enhance-prompt plugin from tuancookiez-hub/hermes-enhance-prompt.

1. Clone or pull:
   git clone https://github.com/tuancookiez-hub/hermes-enhance-prompt.git
   cd hermes-enhance-prompt
2. Copy desktop/plugin.js to:
   <HERMES_HOME>/desktop-plugins/enhance-prompt/plugin.js
   Folder name MUST be enhance-prompt.
3. In Hermes Desktop: Ctrl/Cmd+K → Reload desktop plugins
   (or Settings → Plugins → Enhance Prompt on)
4. Type in the composer and click the sparkle next to Send.
```

`HERMES_HOME` is normally `%LOCALAPPDATA%\hermes` on Windows, `~/.hermes` on macOS/Linux.

> **Two plugin systems.** `hermes plugins install` installs the *Python agent* half (`/enhance` + `enhance_prompt` tool). The sparkle is a *Desktop UI* plugin — copy `desktop/plugin.js` as above. Both can live in this one repo.

Manual copy:

```
# default profile
<HERMES_HOME>/desktop-plugins/enhance-prompt/plugin.js

# named profile
<HERMES_HOME>/profiles/<name>/desktop-plugins/enhance-prompt/plugin.js
```

The Desktop watches that folder. Drop the file in; no `npm run pack`.

### How the sparkle works

1. Reads the composer (`data-slot="composer-rich-input"`)
2. Hidden `session.create` + rewrite system prompt (uses the **active** model)
3. `prompt.submit` the draft
4. Polls `session.history` until the assistant text settles
5. **Selects all** then `insertText` so the draft is replaced, not appended
6. Shows `before→after` quality score inside the sparkle button

Cancel is UI-only. The hidden session may still finish.

---

## Agent: `/enhance` + `enhance_prompt` tool

Same rewrite logic from CLI, gateway, and MCP:

```
hermes plugins install tuancookiez-hub/hermes-enhance-prompt
```

Then:

```
/enhance fix the login flow
```

or the tool:

```
enhance_prompt(input="fix the login", max_chars=1200)
```

---

## Limits

- Desktop sparkle needs a live Desktop gateway and a working model
- One model turn per click
- No public `setComposerDraft` SDK — write path is DOM-based (select-all + insertText)
- Drafts under 8 characters are ignored
- Quality score is a local heuristic (goal line, numbered steps, action verb, specifics) — not an LLM judge

## Installing-agent notes

Full install / verify / uninstall: `INSTALL.md`.

## License

MIT — see `LICENSE`.
