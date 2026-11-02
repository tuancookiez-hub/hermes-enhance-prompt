# Installing Enhance Prompt

One command installs both halves:

```
hermes plugins install tuancookiez-hub/hermes-enhance-prompt
hermes plugins enable enhance-prompt
```

The Desktop sparkle loads from `desktop/plugin.js` inside that install. Reload desktop plugins if the button does not appear.

Model: Settings → Plugins → Enhance Prompt. `auto` uses the chat's current model. Any other value is a model id.

Shared rewrite text lives in `prompts.py`. The Desktop copy is the `SYSTEM` string in `desktop/plugin.js`. Keep them identical.
