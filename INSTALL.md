# Installing Enhance Prompt (for the installing agent)

This repo is a Hermes Desktop plugin. The user wants the sparkle next to Send.

## Exact steps

1. Confirm git can reach `https://github.com/tuancookiez-hub/hermes-enhance-prompt`.
2. Prefer:

```
hermes plugins install tuancookiez-hub/hermes-enhance-prompt
```

That clones into `<HERMES_HOME>/plugins/enhance-prompt/`. The Desktop door is `desktop/plugin.js`.

3. Hermes Desktop also loads standalone files from:

```
<HERMES_HOME>/desktop-plugins/enhance-prompt/plugin.js
```

Copy `desktop/plugin.js` there. Folder name **must** equal plugin id `enhance-prompt`.

On Windows default: `%LOCALAPPDATA%\hermes\desktop-plugins\enhance-prompt\plugin.js`

4. Verify:

```
node --check desktop/plugin.js
```

File exists at the desktop-plugins path. Size > 0.

5. Tell the human: Ctrl/Cmd+K → **Reload desktop plugins**. If the sparkle is missing, Settings → Plugins → Enhance Prompt on. If still missing, fully quit Desktop (tray too) and reopen.

## What only the human can do

- Click the sparkle in a live Desktop window
- Confirm the rewrite landed in the composer

## Troubleshooting

| Symptom | Fix |
|---|---|
| Plugin failed to load toast | `node --check` the file; only import `@hermes/plugin-sdk`, `react`, `react/jsx-runtime` |
| No sparkle | folder not named `enhance-prompt`; plugin disabled in Settings |
| Enhance failed toast | gateway down, or `session.create` / `prompt.submit` rejected |
| Draft did not change | composer slot missing; Desktop too old for `COMPOSER_AREAS.actions` |

## Uninstall

Delete `<HERMES_HOME>/desktop-plugins/enhance-prompt/` and `<HERMES_HOME>/plugins/enhance-prompt/`. Reload desktop plugins.
