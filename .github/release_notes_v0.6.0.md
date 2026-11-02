# v0.6.0

Catalog-ready release.

## Fixed
- Score renders inside the sparkle button; the tight composer row can no longer clip it. The per-criterion breakdown moved to the hover title.
- Backup and stage state reset when you switch chats, so discard can no longer write the previous chat's draft into the new one.
- Hidden rewrite and scoring sessions are closed after each read instead of staying live on the gateway.
- The model setting is cached for 15 seconds instead of re-listing the whole plugin hub on every click.

## Changed
- Draft read/write uses `host.composer` (`getDraft` / `setDraft`) rather than querying app markup, which keeps `@file` chips intact.
- New **Enhance model** setting: `auto` follows the chat you are in, or paste a model id to pin one.
- Install is one `hermes plugins install`; the sparkle ships inside the package.
- Agent completions use the current `ctx.llm.complete` API.

## Files
- `assets/hero-banner.png` — 1200×600 catalog banner
- `assets/overview.png` — current workflow card
