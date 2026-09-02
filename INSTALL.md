# Installing Enhance Prompt (for agents)

One package, two runtimes. Do both.

## Desktop sparkle

Copy `desktop/plugin.js` to `<HERMES_HOME>/desktop-plugins/enhance-prompt/plugin.js`.
Folder name MUST be `enhance-prompt`.

Disk plugins load uncompiled. Only these imports resolve:
- `jsx` / `jsxs` from `react/jsx-runtime`
- `useState` / `useEffect` / `useCallback` / `useRef` from `react`
- `useValue`, `Button`, `Tip`, `Codicon`, `COMPOSER_AREAS` from `@hermes/plugin-sdk`

Composer `actions` is a tight icon row — extra siblings next to the button get clipped. Score lives **inside** the button as `40→72`.

`writeDraft` must select-all (`selectNodeContents`) then `insertText`. Collapse-to-end appends on revert.

Reload: Ctrl/Cmd+K → Reload desktop plugins.

## Agent tool

```
hermes plugins install tuancookiez-hub/hermes-enhance-prompt
hermes plugins enable enhance-prompt
```

Shared templates: `prompts.py`. Keep in sync with the SYSTEM string in `desktop/plugin.js`.
