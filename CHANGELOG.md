# Changelog

## [Unreleased]

### Added
- Layered rewrite prompts in `prompts.py` and `desktop/plugin.js`: short inputs get a tight numbered list, substantive inputs (multi-sentence, real task, no clear shape) get a production-grade brief with Goal / Role & context / Scope / Requirements / Deliverable / Quality gates / Anti-patterns sections. The model picks the right shape per input.
- Bumped `MAX_CHARS` to 1600 to fit the longer brief format.
- `KEYBINDS_AREA` registration: real Ctrl/Cmd+K keybind on the Desktop, alongside the existing palette command.
- Desktop tooltip uses a short, stable `aria-label` and a longer `title` for screen readers.

### Changed
- `desktop/plugin.js` polling backs off (1.2s → 3s) instead of flat 400ms; max session wait stays 90s.
- Empty or identical rewrites are auto-reverted with an info toast ("Prompt was already clear — no change needed.").
- Silent truncation at the cap now emits an info toast so the user knows the rewrite was cut.
- `writeDraft` collapses the selection to the end of the new text so the cursor lands where the user expects after an enhance.

### Fixed
- `_tool_handler` and `_slash_enhance` in `__init__.py` share the same `strip_wrappers` cleanup, so the Desktop and agent tool no longer disagree on quote / channel / thinking-block stripping.
- `session.history` polling normalises the assistant text before stable-detection so streaming whitespace toggles no longer reset the wait.

## [0.1.0] — 2026-09-02

### Added
- Sparkle beside Send that rewrites the composer draft without sending.
- Numbered-list rewrite (goal line + `1. 2. 3.`).
- README hero banner (`assets/hero-banner.png`).
- README demo GIF + MP4 (`assets/demo-enhance-prompt.gif`, `assets/demo-enhance-prompt.mp4`).
