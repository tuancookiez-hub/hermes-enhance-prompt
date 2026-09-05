# Changelog

## [0.4.0] — 2026-09-05

### Added
- **Stage-by-stage enhancement** — each pass is a distinct *transformation* of the input, not just a longer version. The model is given a stage-specific system hint that tells it what shape to produce:
  - **Stage 1 (Clarify):** goal line + 3-5 numbered requirements. Readable in 30 seconds.
  - **Stage 2 (Detail):** each requirement broken into a sub-task with tool, context, and deliverable. An executable task list.
  - **Stage 3 (Horizon):** the task list reframed as a phased project with milestones, dependencies, and success criteria per phase. Long-horizon, resumable from any checkpoint.
- The sparkle button advances through these stages. The first click runs Stage 1; the second runs Stage 2; the third runs Stage 3. Stage 3+ keeps the same horizon framing.
- Each stage gets its own system message in the hidden session.

### Changed
- **No hard output cap.** The previous truncation at 2,000 / 4,000 / 6,000 chars has been removed. If the model produces 18,000 chars, the user sees 18,000 chars. The cap is now only a soft hint passed as `max_tokens` to the model — the model writes the brief it thinks is needed. The Python tool defaults to `max_chars=0` (no cap). The stage caps (3,000 / 6,000 / 10,000) are soft targets for the model's token budget only.
- Tooltips describe the stage action: "Stage 2: break into detailed task list" / "Stage 3: convert to phased plan".
- Toast messages include the character count: "(12,450 chars)" so the user can see how much was produced.
- The `extend` function is reworked: it re-runs the current stage at the same depth and appends the result, rather than being a separate "force 2x cap" button.

## [0.3.2] — 2026-09-04

### Changed
- **First-pass cap raised** from 1200 → **2000 chars** (`MAX_LEN × 2 = 1000 × 2`).
- **Extend cap raised** from 2400 → **4000 chars**. The explicit ↓ button now always writes up to 4000 chars.
- **Stage-by-stage enhance** — the sparkle button is now stage-aware. Each click after the first one advances the rewrite one stage deeper. Replaces the old "sparkle = revert" behavior. Revert is now a separate `x` icon button next to the extend arrow, so the user can always throw the rewrite away.
- Stages use a `---` separator between appended sections so the original brief and the deeper rewrite are visually distinct.

### UX
- Sparkle icon changes from `sparkle` to `arrow-right` once an enhanced version is in place, so the user can see at a glance that the next click advances rather than re-does.
- A small toast on each stage says "Stage 2 appended." / "Stage 3 appended." so the user can track progress.
- Tooltip reads "Stage 2: deepen (4000 chars)" / "Stage 3: refine (4000 chars)" depending on the current stage.

## [0.3.1] — 2026-09-04

### Fixed
- **Prompt truncation:** the hard 1200-char client-side cap was cutting off substantive briefs. Raised the default cap to 8000 chars and the Python `max_tokens` budget to 8192. The model is no longer told to artificially stop at 1200.

### Added
- **Extend button** (`↓` arrow) — appears beside the undo/discard icon after a successful enhance. Click it to re-run the rewrite at 2400-char cap and append the result to the current draft. Lets the user get a longer, more detailed brief without losing the first pass.

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
