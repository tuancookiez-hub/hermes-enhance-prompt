/**
 * Enhance Prompt — Desktop plugin
 *
 * Sparkle beside Send. Click to rewrite the composer draft; click again to
 * revert; click while spinning to cancel. A small score badge appears next
 * to the sparkle after a successful rewrite.
 *
 * Uses the current active model via host.request → session.create (the same
 * one the rest of the app uses), so the rewrite is "what the current model
 * would naturally produce, focused on prompt craft."
 *
 * Ctrl/Cmd+K runs the same action.
 */

import { jsx, jsxs } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  host,
  useValue,
  COMPOSER_AREAS,
  PALETTE_AREA,
  KEYBINDS_AREA,
  Codicon,
  Button,
  Tip,
  cn,
} from "@hermes/plugin-sdk";

/* ─── Tunables ──────────────────────────────────────────────────────────── */

const MAX_LEN = 1000;           // soft target per stage
// No hard output cap. If the model decides a brief needs 18K chars to
// be complete, that's the right answer for that input. Truncation
// loses information the model was instructed to include. The GMI
// serving endpoint already enforces its own token limit, so the
// request is bounded by the model's context window, not by us.
// Real-world upper bound: GPT-5 leaked system prompt is ~27K chars;
// user-input briefs in this plugin top out around 15–20K. We
// surface the length in the toast so the user can see what was
// produced, but never chop.
const INIT_POLL_MS = 1200;    // first poll interval
const MAX_POLL_MS = 3000;     // max poll interval (exponential backoff)
const TIMEOUT_MS = 90_000;    // total session polling timeout
const MIN_LEN = 8;            // minimum draft length to activate

/* ─── Rewrite prompt (inline — must stay in sync with prompts.py) ───────── */

const SYSTEM = `You are a prompt engineer. Rewrite user requests into clear, well-structured agent prompts.

Your job is NOT to answer the request — it is to reformulate it so an AI agent can execute it correctly on the first attempt.

## Format

Write ONE goal line followed by numbered items (1. 2. 3.). Preserve the original language.

**For short or already-clear inputs:** return the same intent in fewer words as 1-3 tight bullets. Do not pad.

**For substantive inputs (multi-sentence, real task, no clear shape):** produce a production-grade brief:

1. **Goal** — one line stating what success looks like
2. **Role & context** — who the agent is, what tools it has, any runtime constraints
3. **Scope** — what is in scope (IN:) and what is out of scope (OUT:)
4. **Requirements** — 3-7 concrete numbered requirements, each one a single verifiable action
5. **Deliverable** — what form the output takes: files, format, coverage
6. **Quality gates** — what "done" means, how the agent should verify completion
7. **Anti-patterns** — 2-4 things to NOT do

Use only the sections that apply. Do not invent sections.

## Rules

- Match the original language (English/Malay/etc.)
- Do NOT answer the request — restate it as an actionable task
- Do NOT add goals the user did not mention
- Do NOT write tutorial-style output ("First, do X, then Y...")
- Prefer concrete nouns over vague ones ("table" not "the data structure")
- Aim for 600–2400 characters. If the task needs more detail to be actionable, expand; if it's already tight, keep it short.`;

const USER_WRAP = `Rewrite this request as an agent prompt:

{input}

---`;

/* ─── RPC helpers ─────────────────────────────────────────────────────────── */

function unwrap(res) {
  if (!res || typeof res !== "object") return {};
  if (res.result && typeof res.result === "object") return res.result;
  return res;
}

function rpcFail(res) {
  if (!res || typeof res !== "object") return null;
  if (res.ok === false) {
    const err = res.error;
    if (!err) return "request failed";
    if (typeof err === "string") return err;
    return err.message || String(err);
  }
  return null;
}

async function rpc(method, params) {
  if (typeof host.request !== "function")
    throw new Error("host.request unavailable");
  const res = await host.request(method, params);
  const fail = rpcFail(res);
  if (fail) throw new Error(method + ": " + fail);
  return unwrap(res);
}

/* ─── Composer DOM helpers ────────────────────────────────────────────────── */

const COMPOSER_SLOT = "composer-rich-input";

function composerEl() {
  const nodes = document.querySelectorAll(`[data-slot="${COMPOSER_SLOT}"]`);
  for (const n of nodes) {
    if (!(n instanceof HTMLElement)) continue;
    if (n.offsetParent !== null || n.getClientRects().length) return n;
  }
  return nodes[0] instanceof HTMLElement ? nodes[0] : null;
}

function readDraft() {
  const el = composerEl();
  if (!el) return "";
  return String(el.innerText || el.textContent || "")
    .replace(/\u00a0/g, " ")
    .trim();
}

function writeDraft(text) {
  const el = composerEl();
  if (!el) throw new Error("composer not found");
  const next = String(text ?? "");

  el.focus();
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand("insertText", false, next);
    if (!ok) throw new Error("insertText failed");
  } catch {
    el.textContent = next;
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertReplacementText",
        data: next,
      })
    );
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ─── Output cleaning ────────────────────────────────────────────────────── */

function stripQuotes(text) {
  return String(text || "")
    .replace(/<｜[\s\S]*?｜>/g, "")
    .replace(/<\|[\s\S]*?\|>/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^<\/?[\w:-]+>[^\n]*\n?/gm, "")
    .replace(/^```[a-zA-Z0-9_-]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim()
    .replace(/^['"`\u201c\u201d\u2018\u2019]+|['"`\u201c\u201d\u2018\u2019]+$/g, "")
    .trim();
}

function lastAssistant(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      const bits = m.content
        .map((p) => {
          if (typeof p === "string") return p;
          if (p && typeof p.text === "string") return p.text;
          if (p && typeof p.content === "string") return p.content;
          return "";
        })
        .filter(Boolean);
      if (bits.length) return bits.join("\n");
    }
    if (typeof m.text === "string") return m.text;
  }
  return "";
}

/* ─── G-EVAL scorer (LLM-as-judge) ─────────────────────────────────────────── */

const SCORER_SYSTEM = `You are an expert evaluator of prompts for an AI coding assistant.

Score the prompt on five criteria using a 1–5 scale (5 = excellent, 1 = poor).
Use the full range. Be strict.

Criteria:
1. Clarity (1-5) — Is the language clear, grammatical, and unambiguous?
2. Specificity (1-5) — Is the task scope well-defined, with concrete details?
3. Actionability (1-5) — Can an AI take concrete steps from this prompt?
4. Structure (1-5) — Is it organised (goal line, numbered steps, sections)?
5. Concreteness (1-5) — Does it name real nouns (file, function, table, api)?

Reply ONLY with valid JSON, no prose, no fences:
{"clarity":N,"specificity":N,"actionability":N,"structure":N,"concreteness":N,"reason":"<one short sentence>"}

N must be an integer 1..5. If the prompt is empty, return 1s.`;

const SCORER_USER = (label, text) =>
  `${label}\n\nPROMPT TO EVALUATE:\n"""\n${text.slice(0, 4000)}
"""\n\nJSON:`;

async function geValScore(ctx, label, text) {
  if (!text || !text.trim()) {
    return { total: 0, parts: { clarity: 0, specificity: 0, actionability: 0, structure: 0, concreteness: 0 }, reason: "empty" };
  }
  const created = await rpc("session.create", {
    title: "Score prompt",
    hidden: true,
    messages: [{ role: "system", content: SCORER_SYSTEM }],
  });
  const sid = created.session_id;
  if (!sid) throw new Error("scorer: session.create returned no session_id");
  await rpc("prompt.submit", { session_id: sid, text: SCORER_USER(label, text) });

  const start = Date.now();
  let last = "";
  let stable = 0;
  while (Date.now() - start < 30_000) {
    try {
      const hist = await rpc("session.history", { session_id: sid });
      const raw = stripQuotes(lastAssistant(hist.messages || hist.history || []));
      if (raw && raw === last) {
        stable += 1;
        if (stable >= 2) {
          const parsed = parseScore(raw);
          if (parsed) return scaleTo100(parsed, raw);
        }
      } else if (raw) {
        last = raw;
        stable = 0;
      }
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

function parseScore(raw) {
  // Find a JSON object in the response; tolerate leading prose.
  const m = raw.match(/\{[^{}]*"clarity"[^{}]*\}/i);
  const text = m ? m[0] : raw;
  try {
    const j = JSON.parse(text);
    const n = (v) => {
      const x = Math.round(Number(v));
      if (!Number.isFinite(x)) return 0;
      return Math.max(0, Math.min(5, x));
    };
    return {
      clarity: n(j.clarity),
      specificity: n(j.specificity),
      actionability: n(j.actionability),
      structure: n(j.structure),
      concreteness: n(j.concreteness),
      reason: typeof j.reason === "string" ? j.reason : "",
    };
  } catch {
    return null;
  }
}

function scaleTo100(parts, raw) {
  // 5 criteria × 5 = 25. Scale to 0–100.
  const sum = parts.clarity + parts.specificity + parts.actionability + parts.structure + parts.concreteness;
  return { total: Math.round((sum / 25) * 100), parts, reason: parts.reason || "" };
}

function scoreClass(s) {
  if (s >= 80) return "text-emerald-500";
  if (s >= 60) return "text-amber-500";
  return "text-muted-foreground/70";
}

/* ─── Rewrite session ─────────────────────────────────────────────────────── */

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/* ─── Stage system prompts ──────────────────────────────────────────────── */
// Each stage is a distinct *transformation* of the input, not just a
// longer version of the same thing. The base SYSTEM prompt is the
// shared style guide; the stage hint tells the model what shape to
// produce for this pass.
const STAGE_HINT_CLARIFY = `
## Stage 1 — Clarify
Produce a clean, legible brief. One goal line, then 3-5 numbered
requirements. The output should be a short, dense version of the
user's intent — readable in 30 seconds.`;
const STAGE_HINT_DETAIL = `
## Stage 2 — Detail
Take the brief above and break each requirement into a concrete
sub-task. For each numbered item, add:
- the tool or action the agent should use
- the context or inputs it needs
- the deliverable (file, response, or state change)

Result is an executable task list an agent can follow step by step.`;
const STAGE_HINT_HORIZON = `
## Stage 3 — Horizon
Reframe the task as a long-running project. Add:
- Phases or milestones (numbered, with checkpoints)
- Dependencies between phases
- Success criteria per phase (how the agent knows it's done)
- A time-horizon framing ("end of day", "weekly", "milestone-based")

The result is a phased plan, not a one-shot request. The agent
should be able to resume from any checkpoint.`;

/* ─── enhanceOnce ──────────────────────────────────────────────────────── */
async function enhanceOnce(input, signal, maxChars, stage) {
  const stageHint =
    stage === 2
      ? STAGE_HINT_DETAIL
      : stage === 3
      ? STAGE_HINT_HORIZON
      : STAGE_HINT_CLARIFY;
  const capHint = maxChars
    ? `\n\nIMPORTANT: Produce a detailed rewrite of ${maxChars * 2}–${maxChars * 3} characters.`
    : "";
  const created = await rpc("session.create", {
    title: "Enhance prompt",
    hidden: true,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "system", content: stageHint },
    ],
  });
  const sid = created.session_id;
  if (!sid) throw new Error("session.create returned no session_id");

  const user = USER_WRAP.replace("{input}", input) + capHint;
  await rpc("prompt.submit", { session_id: sid, text: user });

  const start = Date.now();
  let last = "";
  let stable = 0;
  let pollMs = INIT_POLL_MS;

  while (Date.now() - start < TIMEOUT_MS) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const hist = await rpc("session.history", { session_id: sid });
      const next = stripQuotes(
        lastAssistant(hist.messages || hist.history || [])
      );
      if (next && next === last) {
        stable += 1;
        if (stable >= 2) return next;
      } else if (next) {
        last = next;
        stable = 0;
      }
    } catch {
      /* keep polling */
    }
    await sleep(pollMs, signal);
    pollMs = Math.min(pollMs * 1.5, MAX_POLL_MS);
  }
  if (last) return last;
  throw new Error("timed out waiting for enhanced prompt");
}

/* ─── EnhancementButton ──────────────────────────────────────────────────── */

function EnhanceButton() {
  const chatBusy = useValue(host.state.busy);
  const [enhancing, setEnhancing] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [error, setError] = useState("");
  const [hasText, setHasText] = useState(false);
  const lastScore = useRef(null); // { before, after, parts, reason } | null

  const backup = useRef(null);
  const after = useRef(null);
  const abort = useRef(null);
  // 0 = no enhance yet, 1 = first pass done (2000 char cap), 2 = first extend
  // done (4000 char cap), 3 = second extend (still 4000 cap; further stages
  // are useful mainly for re-applying different framing). Tracked so that
  // a re-click on the sparkle continues the stage sequence instead of
  // re-running the same 2000-char rewrite from scratch.
  const stage = useRef(0);

  // Tiny helper to push a re-render when we update the ref-only score.
  const [, setScoreTick] = useState(0);
  const forceRender = useCallback(() => setScoreTick((n) => n + 1), []);

  const refreshHasText = useCallback(() => {
    const text = readDraft();
    setHasText(text.length >= MIN_LEN);
    if (hasBackup && after.current && text !== after.current) {
      backup.current = null;
      after.current = null;
      setHasBackup(false);
      stage.current = 0;
    }
    if (!text.trim() && lastScore.current) {
      lastScore.current = null;
      forceRender();
    }
  }, [hasBackup, forceRender]);

  useEffect(() => {
    refreshHasText();
    const el = composerEl();
    if (!el) return undefined;
    const on = () => refreshHasText();
    el.addEventListener("input", on);
    el.addEventListener("keyup", on);
    const t = setInterval(on, 800);
    return () => {
      el.removeEventListener("input", on);
      el.removeEventListener("keyup", on);
      clearInterval(t);
    };
  }, [refreshHasText]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setEnhancing(false);
  }, []);

  // stageRun advances the enhance to the next stage and appends the result.
  // stage 0 → 1: first pass
  // stage 1 → 2: deepen
  // stage 2 → 3: horizon
  const stageRun = useCallback(async () => {
    const nextStage = Math.min(stage.current + 1, 3);
    // Soft hint for max_tokens; no hard cap on displayed output.
    const cap =
      nextStage === 1
        ? 3000    // stage 1: clarify
        : nextStage === 2
        ? 6000   // stage 2: detail
        : 10000; // stage 3: horizon

    cancel();
    const ac = new AbortController();
    abort.current = ac;
    setEnhancing(true);
    setError("");
    const current = readDraft();
    try {
      const enhanced = stripQuotes(
        await enhanceOnce(current, ac.signal, cap, nextStage)
      );
      if (ac.signal.aborted) return;
      if (!enhanced) throw new Error("empty rewrite");

      // No hard cap on the displayed output. The model is told the
      // cap as a target, not enforced. Whatever the model produces
      // is what the user gets.
      host.notify({
        kind: "info",
        message:
          (nextStage === 2
            ? "Stage 2: detailed task list appended. "
            : nextStage === 3
            ? "Stage 3: phased plan appended. "
            : "Stage " + nextStage + " appended. ") +
          "(" + enhanced.length.toLocaleString() + " chars)",
      });

      // Append with a visual separator between stages.
      const sep = "\n\n---\n\n";
      const merged = current.trimEnd() + sep + enhanced;
      writeDraft(merged);

      requestAnimationFrame(() => {
        after.current = readDraft();
        setHasBackup(true);
        stage.current = nextStage;
      });

      try {
        const score = await geValScore(host, "REWRITE", readDraft());
        if (ac.signal.aborted) return;
        if (score) {
          lastScore.current = {
            before: lastScore.current ? lastScore.current.before : null,
            after: score,
          };
          forceRender();
        }
      } catch { /* scoring is best-effort */ }
    } catch (err) {
      if (err?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      host.notify({ kind: "error", message: "Enhance stage failed: " + msg });
    } finally {
      if (abort.current === ac) abort.current = null;
      setEnhancing(false);
    }
  }, [cancel, forceRender]);

  // revert restores the original text before any enhance ran.
  const revert = useCallback(() => {
    const text = backup.current;
    if (!text) return;
    backup.current = null;
    after.current = null;
    setHasBackup(false);
    lastScore.current = null;
    stage.current = 0;
    forceRender();
    setError("");
    requestAnimationFrame(() => {
      try {
        writeDraft(text);
        host.notify({ kind: "info", message: "Reverted to original." });
      } catch (err) {
        host.notify({
          kind: "error",
          message:
            "Revert failed: " +
            (err && err.message ? err.message : String(err)),
        });
      }
    });
  }, [forceRender]);

  // extend re-runs the rewrite with a higher character cap and
  // appends the new section to the existing draft. Used when the
  // extend is an explicit "force 2x cap" button. After the first
  // enhance, the user can click this to get a longer rewrite at the
  // current stage. No hard cap on output.
  const extend = useCallback(async () => {
    if (!hasBackup || !after.current) return;
    cancel();
    const ac = new AbortController();
    abort.current = ac;
    setEnhancing(true);
    setError("");
    const current = readDraft();
    try {
      // Soft cap hint for max_tokens; no hard cap on displayed output.
      const cap = stage.current || 2;
      const extended = stripQuotes(
        await enhanceOnce(current, ac.signal, cap * 3000, cap)
      );
      if (ac.signal.aborted) return;
      if (!extended) throw new Error("empty extension");

      const merged = current.trimEnd() + "\n\n" + extended;
      writeDraft(merged);
      host.notify({
        kind: "info",
        message:
          "Extended (" + extended.length.toLocaleString() + " chars) appended.",
      });

      requestAnimationFrame(() => {
        after.current = readDraft();
        setHasBackup(true);
        stage.current = cap;
      });

      // Re-score the merged result so the badge stays accurate.
      try {
        const score = await geValScore(host, "REWRITE", readDraft());
        if (ac.signal.aborted) return;
        if (score) {
          lastScore.current = {
            before: lastScore.current ? lastScore.current.before : null,
            after: score,
          };
          forceRender();
        }
      } catch {
        /* scoring is best-effort */
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      host.notify({ kind: "error", message: "Extend failed: " + msg });
    } finally {
      if (abort.current === ac) abort.current = null;
      setEnhancing(false);
    }
  }, [hasBackup, cancel, forceRender]);

  const run = useCallback(async () => {
    const text = readDraft();
    if (text.length < MIN_LEN) {
      host.notify({
        kind: "error",
        message: "Type a bit more, then enhance.",
      });
      return;
    }
    cancel();
    const ac = new AbortController();
    abort.current = ac;
    setEnhancing(true);
    setError("");
    backup.current = text;
    lastScore.current = null;

    try {
      // Soft hint for max_tokens; no hard cap on displayed output.
      const cap = 3000; // stage 1: clarify
      const enhanced = stripQuotes(
        await enhanceOnce(text, ac.signal, cap, 1)
      );
      if (ac.signal.aborted) return;
      if (!enhanced) throw new Error("empty rewrite");

      // No hard cap on the displayed output. Whatever the model
      // produces is what the user gets — truncation would silently
      // drop the very parts of the brief that needed the most space.
      if (enhanced.trim() === backup.current.trim()) {
        backup.current = null;
        after.current = null;
        setHasBackup(false);
        host.notify({
          kind: "info",
          message: "Prompt was already clear — no change needed.",
        });
        return;
      }

      writeDraft(enhanced);
      host.notify({
        kind: "info",
        message:
          "Stage 1: clarified brief (" +
          enhanced.length.toLocaleString() +
          " chars).",
      });

      // Discard icon appears the moment the rewrite lands — scoring is
      // background work that updates the badge without holding the icon back.
      requestAnimationFrame(() => {
        const next = readDraft();
        after.current = next;
        setHasBackup(true);
        stage.current = 1; // first stage (clarify) complete
      });

      // Score before and after via G-EVAL. Show progress while scoring.
      try {
        const beforeScore = await geValScore(host, "ORIGINAL", backup.current || text);
        if (ac.signal.aborted) return;
        if (beforeScore) {
          lastScore.current = { before: beforeScore, after: null };
          forceRender();
        }
        const afterScore = await geValScore(host, "REWRITE", clipped);
        if (ac.signal.aborted) return;
        if (afterScore) {
          lastScore.current = {
            before: lastScore.current ? lastScore.current.before : beforeScore,
            after: afterScore,
          };
          forceRender();
        }
        if (!beforeScore && !afterScore) {
          host.notify({
            kind: "info",
            message: "Scorer timed out — enhancement is live, no score.",
          });
        }
      } catch (scoreErr) {
        host.notify({
          kind: "info",
          message: "Scorer unavailable — enhancement is live, no score.",
        });
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      host.notify({ kind: "error", message: "Enhance failed: " + msg });
      backup.current = null;
      after.current = null;
      setHasBackup(false);
    } finally {
      if (abort.current === ac) abort.current = null;
      setEnhancing(false);
    }
  }, [cancel]);

  const disabled = enhancing ? false : !!chatBusy || !hasText;
  const ls = lastScore.current;
  const buttonTip = (() => {
    if (error) return error;
    if (enhancing) return "Enhancing… click to cancel";
    if (hasBackup) {
      if (stage.current === 1)
        return "Stage 2: break into detailed task list";
      if (stage.current === 2)
        return "Stage 3: convert to phased plan";
      return "Advance to next stage";
    }
    return "Enhance prompt (general — 2000 chars)";
  })();
  const scoreTip = (() => {
    if (!ls || !ls.after) return null;
    const a = ls.after.parts;
    const lines = [
      `${ls.before ? ls.before.total : "?"} → ${ls.after.total}/100`,
      `${a.clarity}/5 clarity · ${a.specificity}/5 specificity · ${a.actionability}/5 actionability · ${a.structure}/5 structure · ${a.concreteness}/5 concreteness`,
    ];
    if (ls.after.reason) lines.push(ls.after.reason);
    return lines.join("\n");
  })();

  return jsxs("div", {
    className: "flex h-(--composer-control-size) items-center gap-1",
    children: [
      jsx(Tip, {
        label: buttonTip,
        children: jsx(Button, {
          "aria-label": hasBackup
            ? "Advance enhance to next stage"
            : "Enhance prompt",
          className: cn(
            "size-(--composer-control-size) shrink-0 rounded-md",
            "text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground",
            (enhancing || hasBackup) && "text-foreground"
          ),
          disabled,
          onClick: enhancing ? cancel : hasBackup ? stageRun : run,
          size: "icon-xs",
          type: "button",
          variant: "ghost",
          children: jsx(Codicon, {
            name: enhancing
              ? "sync"
              : hasBackup
              ? "arrow-right" // advancing to next stage
              : "sparkle",
            size: 14,
            spinning: enhancing,
          }),
        }),
      }),
      // Discard / revert — appears once an enhanced version is in place,
      // letting the user throw the rewrite away and go back to the
      // original draft. Always available alongside the stage-advance
      // and explicit extend buttons.
      hasBackup && !enhancing
        ? jsx(Tip, {
            label: "Discard enhanced version, revert to original",
            children: jsx(Button, {
              "aria-label": "Revert to original",
              className: cn(
                "size-(--composer-control-size) shrink-0 rounded-md",
                "text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground"
              ),
              onClick: revert,
              size: "icon-xs",
              type: "button",
              variant: "ghost",
              children: jsx(Codicon, { name: "discard", size: 14 }),
            }),
          })
        : null,
      // Extend button — explicit "go deeper" with a fixed 4000-char cap.
      // Distinct from the stage-advance sparkle so the user can force a
      // longer rewrite at any stage.
      hasBackup && !enhancing
        ? jsx(Tip, {
            label: "Extend prompt (force 4000-char cap, appends)",
            children: jsx(Button, {
              "aria-label": "Extend prompt",
              className: cn(
                "size-(--composer-control-size) shrink-0 rounded-md",
                "text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground"
              ),
              onClick: extend,
              size: "icon-xs",
              type: "button",
              variant: "ghost",
              children: jsx(Codicon, { name: "arrow-down", size: 14 }),
            }),
          })
        : null,
      ls && ls.after
        ? jsx(Tip, {
            label: scoreTip,
            children: jsx("span", {
              key: "score",
              className: cn(
                "inline-flex h-(--composer-control-size) shrink-0 cursor-help items-center",
                "font-mono text-[10px] leading-none tabular-nums",
                scoreClass(ls.after.total)
              ),
              children: String(ls.after.total),
            }),
          })
        : ls && ls.before && !ls.after
        ? jsx("span", {
            key: "score-pending",
            className: cn(
              "inline-flex h-(--composer-control-size) shrink-0 items-center",
              "font-mono text-[10px] leading-none tabular-nums text-muted-foreground/60 animate-pulse"
            ),
            children: "…",
          })
        : null,
    ],
  });
}

/* ─── Palette + keybind helpers ──────────────────────────────────────────── */

function clickSparkle() {
  const tips = [
    "Enhance prompt (general — 2000 chars)",
    "Advance enhance to next stage",
    "Enhancing… click to cancel",
  ];
  const btn = [...document.querySelectorAll("button[aria-label]")].find((el) =>
    tips.includes(el.getAttribute("aria-label") || "")
  );
  if (btn instanceof HTMLElement) {
    btn.click();
  } else {
    host.notify({
      kind: "info",
      message:
        "Type in the composer, then use the sparkle next to Send.",
    });
  }
}

/* ─── Plugin entry point ─────────────────────────────────────────────────── */

export default {
  id: "enhance-prompt",
  name: "Enhance Prompt",
  description:
    "Sparkle beside Send that rewrites the composer draft without sending it. Shows a small quality score next to the sparkle after each rewrite.",
  defaultEnabled: true,

  register(ctx) {
    ctx.register({
      id: "star",
      area: COMPOSER_AREAS.actions,
      order: 40,
      render: () => jsx(EnhanceButton, {}),
    });

    ctx.register({
      id: "palette",
      area: PALETTE_AREA,
      data: {
        id: "enhance-prompt.run",
        label: "Enhance prompt",
        keywords: ["enhance", "prompt", "sparkle", "rewrite", "star"],
        run: clickSparkle,
      },
    });

    const KEY = navigator.platform.includes("Mac") ? "cmd+k" : "ctrl+k";
    ctx.register({
      id: "keybind",
      area: KEYBINDS_AREA,
      data: {
        id: "enhance-prompt.keybind",
        label: "Enhance prompt",
        category: "Enhance Prompt",
        defaults: [KEY],
        run: clickSparkle,
      },
    });
  },
};
