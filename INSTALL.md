# Installing Enhance Prompt (for the installing agent)

This repo ships two things in one package:

- **Desktop UI plugin** (`desktop/plugin.js`) — the sparkle beside Send in Hermes Desktop.
- **Agent plugin** (`__init__.py`) — a `/enhance` slash command and an
  `enhance_prompt` tool callable from CLI, gateway, and MCP hosts.

They share the same rewrite prompt (`prompts.py`).

> **Important:** `hermes plugins install` installs *Python agent plugins*
> (documented at `hermes-agent.nousresearch.com`). Desktop UI plugins use a
> different runtime and install path. Follow the steps below.

## Step 1 — Desktop sparkle

```
git clone https://github.com/tuancookiez-hub/hermes-enhance-prompt.git
cd hermes-enhance-prompt
node --check desktop/plugin.js   # must pass
```

Copy `desktop/plugin.js` to:

```
<HERMES_HOME>/desktop-plugins/enhance-prompt/plugin.js
```

Folder name **must** be `enhance-prompt` — matching the plugin id.

On Windows default: `%LOCALAPPDATA%\hermes\desktop-plugins\enhance-prompt\plugin.js`

In Hermes Desktop: **Ctrl/Cmd+K → Reload desktop plugins**.
If the sparkle is missing: Settings → Plugins → Enhance Prompt on.
If still missing: fully quit Desktop (tray too) and reopen.

## Step 2 — Agent tool + slash command

```
hermes plugins install tuancookiez-hub/hermes-enhance-prompt
```

This clones the repo into `<HERMES_HOME>/plugins/enhance-prompt/` and enables it.

Verify:

```
hermes plugins
```

`enhance-prompt` should appear in the list and be enabled.

Test the slash command:

```
hermes enhance fix the login flow
```

Test the tool (from a chat that has the tool enabled):

```
enhance_prompt(input="fix the login")
```

## What only the human can do

- Click the sparkle in a live Desktop window
- Confirm the rewrite landed in the composer

## Troubleshooting

| Symptom | Fix |
|---|---|
| Plugin failed to load toast | `node --check` the file; only import `@hermes/plugin-sdk`, `react`, `react/jsx-runtime` |
| No sparkle in Desktop | folder not named `enhance-prompt`; plugin disabled in Settings |
| Enhance failed toast (Desktop) | gateway down, or `session.create` / `prompt.submit` rejected |
| Draft did not change (Desktop) | composer slot missing; Desktop too old for `COMPOSER_AREAS.actions` |
| `hermes enhance` not found | plugin not in `plugins.enabled`; run `hermes plugins install` |
| enhance_prompt tool not available | plugin not enabled; check `hermes plugins` |

## Uninstall

```
# Desktop sparkle
rm -rf <HERMES_HOME>/desktop-plugins/enhance-prompt/

# Agent plugin
hermes plugins disable enhance-prompt
rm -rf <HERMES_HOME>/plugins/enhance-prompt/
```
