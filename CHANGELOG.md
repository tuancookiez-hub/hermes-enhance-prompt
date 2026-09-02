# Changelog

## [0.2.0] — 2026-09-02

### Added
- Layered rewrite: short inputs → tight numbered list; substantive inputs → Goal / Role / Scope / Requirements / Deliverable / Quality gates / Anti-patterns (only sections that apply).
- Quality score on the sparkle button as `before→after` (heuristic 0–100).
- Agent-side `/enhance` slash command + `enhance_prompt` tool (`__init__.py` + `prompts.py`).
- Real Ctrl/Cmd+K keybind via `KEYBINDS_AREA`.
- README hero + demo GIF/MP4.

### Changed
- Poll backoff 1.2s → 3s (90s cap).
- Empty / identical rewrites auto-revert with a toast.
- Truncation at 1200 chars warns instead of failing silently.
- `writeDraft` **selects all** then inserts — replace, not append.

### Fixed
- Import `jsx` from `react/jsx-runtime` and React hooks from `react` (SDK only exports `useValue`).
- Revert no longer pastes the original on top of the enhanced draft.
- Score lives inside the sparkle button (composer `actions` slot clips siblings).

## [0.1.0] — 2026-09-02

### Added
- Sparkle beside Send that rewrites the composer draft without sending.
- Numbered-list rewrite (goal line + `1. 2. 3.`).
