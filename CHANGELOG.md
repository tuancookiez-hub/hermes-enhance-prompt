# Changelog

## [0.3.0] — 2026-09-03

### Changed
- **Scorer:** G-EVAL (LLM-as-judge) replaces the 40-baseline heuristic. After enhance, the same active model scores the rewrite 1–5 on Clarity, Specificity, Actionability, Structure, Concreteness (25 max → 100). Dropped.
- Score badge shows only the after-number while a spinner (`…`) appears while the before-score is pending.
- Hover tooltip shows the full 5-dimension breakdown.
- `score()` removed; `ACTION_VERBS` set removed.

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
- `/enhance` slash command declares `args_hint="<prompt text>"`.

## [0.1.0] — 2026-09-02

### Added
- Sparkle beside Send that rewrites the composer draft without sending.
- Numbered-list rewrite (goal line + `1. 2. 3.`).
