/**
 * Enhance Prompt — Desktop plugin
 *
 * Sparkle beside Send. Click to rewrite the composer draft into a
 * structured brief. Click again to deepen into a task list. Click a
 * third time to reframe as a phased plan. A small quality score
 * appears next to the sparkle after a successful rewrite.
 *
 * Uses the current active model via host.request → session.create (the
 * same one the rest of the app uses), so the rewrite is "what the
 * current model would naturally produce, focused on prompt craft."
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

const INIT_POLL_MS = 1200;     // first poll interval
const MAX_POLL_MS = 3000;      // max poll interval (exponential backoff)
const TIMEOUT_MS = 90_000;     // total session polling timeout
const MIN_LEN = 8;

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
- Output exactly as much as the brief needs. A 5-sentence input may produce 200 words; a paragraph-long input may produce 1,000+ words. Do not artificially pad or cut — write the brief that an agent actually needs to execute the task correctly.`;

const USER_WRAP = `Rewrite this request as an agent prompt:

{input}

---`;

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

const STAGE_HINT = {
  1: STAGE_HINT_CLARIFY,
  2: STAGE_HINT_DETAIL,
  3: STAGE_HINT_HORIZON,
};

/* ─── RPC helpers ───────────────────────────────────────────────────────── */

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

/* ─── Composer DOM helpers ──────────────────────────────────────────────── */

const AUTO = "auto";
const MODEL_CACHE_MS = 15_000;
let modelCache = { at: 0, value: AUTO };

function sid() {
  const atom = host.state && host.state.focusedSessionId;
  if (atom && typeof atom.get === "function") return atom.get() || null;
  return null;
}

function chatModel() {
  const atom = host.state && host.state.model;
  if (!atom || typeof atom.get !== "function") return "";
  return String(atom.get() || "").trim();
}

function composerApi() {
  if (!host.composer || typeof host.composer.getDraft !== "function") {
    throw new Error("Update Hermes Desktop — enhance-prompt needs the composer draft API");
  }
  return host.composer;
}

async function readDraft() {
  const text = await composerApi().getDraft(sid());
  return String(text || "").replace(/\u00a0/g, " ").trim();
}

async function writeDraft(text) {
  const ok = await composerApi().setDraft(sid(), String(text ?? ""));
  if (ok === false) throw new Error("composer rejected the rewrite");
}

async function savedModel() {
  if (Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.value;
  try {
    const listed = await rpc("plugins.manage", { action: "list" });
    const rows = listed.plugins || [];
    const row = rows.find((r) => r && (r.key === "enhance-prompt" || r.name === "enhance-prompt"));
    const fields = (row && row.settings_schema) || [];
    const field = fields.find((f) => f && f.key === "model");
    const value = field && field.value != null ? String(field.value).trim() : AUTO;
    modelCache = { at: Date.now(), value };
    return value;
  } catch {
    return modelCache.value || AUTO;
  }
}

async function closeQuiet(sessionId) {
  if (!sessionId) return;
  try {
    await rpc("session.close", { session_id: sessionId });
  } catch {
    /* a hidden session that outlives the read is harmless */
  }
}

async function modelPin() {
  const saved = (await savedModel()) || AUTO;
  if (!saved || saved.toLowerCase() === AUTO) {
    const chat = chatModel();
    return { model: chat || "", label: chat ? "chat model (" + chat + ")" : "chat model" };
  }
  return { model: saved, label: saved };
}

/* ─── Output cleaning ───────────────────────────────────────────────────── */

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

/* ─── G-EVAL scorer (LLM-as-judge) ─────────────────────────────────────── */

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

const TIMEOUT_SCORER_MS = 30_000;
const POLL_SCORER_MS = 600;

async function geValScore(label, text, pin) {
  if (!text || !text.trim()) {
    return { total: 0, parts: { clarity: 0, specificity: 0, actionability: 0, structure: 0, concreteness: 0 }, reason: "empty" };
  }
  const created = await rpc("session.create", {
    title: "Score prompt",
    hidden: true,
    messages: [{ role: "system", content: SCORER_SYSTEM }],
    ...(pin && pin.model ? { model: pin.model } : {}),
  });
  const sid = created.session_id;
  if (!sid) throw new Error("scorer: session.create returned no session_id");
  await rpc("prompt.submit", { session_id: sid, text: SCORER_USER(label, text) });

  const start = Date.now();
  let last = "";
  let stable = 0;
  try {
    while (Date.now() - start < TIMEOUT_SCORER_MS) {
      try {
        const hist = await rpc("session.history", { session_id: sid });
        const raw = stripQuotes(lastAssistant(hist.messages || hist.history || []));
        if (raw && raw === last) {
          stable += 1;
          if (stable >= 2) {
            const parsed = parseScore(raw);
            if (parsed) return scaleTo100(parsed);
          }
        } else if (raw) {
          last = raw;
          stable = 0;
        }
      } catch {
        /* keep polling */
      }
      await new Promise((r) => setTimeout(r, POLL_SCORER_MS));
    }
    return null;
  } finally {
    await closeQuiet(sid);
  }
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

function scaleTo100(parts) {
  // 5 criteria × 5 = 25. Scale to 0–100.
  const sum = parts.clarity + parts.specificity + parts.actionability + parts.structure + parts.concreteness;
  return { total: Math.round((sum / 25) * 100), parts, reason: parts.reason || "" };
}

function scoreClass(s) {
  if (s >= 80) return "text-emerald-500";
  if (s >= 60) return "text-amber-500";
  return "text-muted-foreground/70";
}

function scoreTitle(ls) {
  const a = ls.after.parts;
  return [
    ls.after.total + "/100",
    a.clarity + "/5 clarity · " + a.specificity + "/5 specificity · " +
      a.actionability + "/5 actionability · " + a.structure + "/5 structure · " +
      a.concreteness + "/5 concreteness",
    ls.after.reason || "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ─── Rewrite session ──────────────────────────────────────────────────── */

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

const STAGE_TOAST = {
  1: "Stage 1: clarified brief.",
  2: "Stage 2: detailed task list appended.",
  3: "Stage 3: phased plan appended.",
};

async function enhanceOnce(input, signal, stage, pin) {
  const stageHint = STAGE_HINT[stage] || STAGE_HINT_CLARIFY;
  const created = await rpc("session.create", {
    title: "Enhance prompt",
    hidden: true,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "system", content: stageHint },
    ],
    ...(pin && pin.model ? { model: pin.model } : {}),
  });
  const sid = created.session_id;
  if (!sid) throw new Error("session.create returned no session_id");

  const user = USER_WRAP.replace("{input}", input);
  await rpc("prompt.submit", { session_id: sid, text: user });

  const start = Date.now();
  let last = "";
  let stable = 0;
  let pollMs = INIT_POLL_MS;

  try {
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
  } finally {
    await closeQuiet(sid);
  }
}

/* ─── EnhancementButton ─────────────────────────────────────────────────── */

function EnhanceButton() {
  const chatBusy = useValue(host.state.busy);
  const curSid = useValue(host.state.focusedSessionId);
  const [enhancing, setEnhancing] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [error, setError] = useState("");
  const [hasText, setHasText] = useState(false);
  const [modelLabel, setModelLabel] = useState("chat model");
  const lastScore = useRef(null);

  const backup = useRef(null);
  const after = useRef(null);
  const abort = useRef(null);
  // 0 = no enhance yet, 1 = clarify done, 2 = detail done, 3 = horizon done.
  // Subsequent clicks re-run the same stage to append a deeper version.
  const stage = useRef(0);

  // Tiny helper to push a re-render when we update the ref-only score.
  const [, setScoreTick] = useState(0);
  const forceRender = useCallback(() => setScoreTick((n) => n + 1), []);

  const refreshHasText = useCallback(async () => {
    let text = "";
    try {
      text = await readDraft();
    } catch {
      text = "";
    }
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
    const t = setInterval(refreshHasText, 800);
    return () => clearInterval(t);
  }, [refreshHasText]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setEnhancing(false);
  }, []);

  // The backup and the stage belong to one draft. Switching chats must
  // not let a later revert write the previous chat's text into this one.
  useEffect(() => {
    backup.current = null;
    after.current = null;
    lastScore.current = null;
    stage.current = 0;
    setHasBackup(false);
    setError("");
    cancel();
  }, [curSid, cancel]);

  // advance runs the next stage. From a fresh state (stage 0) this
  // is Stage 1 (clarify). After Stage 1 it runs Stage 2 (detail).
  // After Stage 2 it runs Stage 3 (horizon). After Stage 3+ it
  // re-runs Stage 3 with a deeper framing.
  const advance = useCallback(async () => {
    const text = await readDraft();
    if (text.length < MIN_LEN) {
      host.notify({
        kind: "error",
        message: "Type a bit more, then enhance.",
      });
      return;
    }
    const nextStage = Math.min(stage.current + 1, 3);
    if (stage.current === 0) backup.current = text;
    lastScore.current = null;
    const pin = await modelPin();
    setModelLabel(pin.label);

    cancel();
    const ac = new AbortController();
    abort.current = ac;
    setEnhancing(true);
    setError("");

    try {
      const enhanced = stripQuotes(
        await enhanceOnce(text, ac.signal, nextStage, pin)
      );
      if (ac.signal.aborted) return;
      if (!enhanced) throw new Error("empty rewrite");

      // No hard cap on the displayed output. Whatever the model
      // produces is what the user gets.
      const merged =
        nextStage === 1
          ? enhanced
          : text.trimEnd() + "\n\n---\n\n" + enhanced;
      await writeDraft(merged);

      host.notify({
        kind: "info",
        message:
          (STAGE_TOAST[nextStage] || `Stage ${nextStage} appended.`) +
          " (" + enhanced.length.toLocaleString() + " chars, " + pin.label + ")",
      });

      after.current = await readDraft();
      setHasBackup(true);
      stage.current = nextStage;

      try {
        const score = await geValScore("REWRITE", after.current, pin);
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
      host.notify({ kind: "error", message: "Enhance failed: " + msg });
    } finally {
      if (abort.current === ac) abort.current = null;
      setEnhancing(false);
    }
  }, [cancel, forceRender]);

  // extend re-runs the *current* stage (where the user is now) and
  // appends the result. Useful when the user wants a deeper version
  // of the same stage without advancing to the next.
  const extend = useCallback(async () => {
    if (!hasBackup || !after.current) return;
    const currentStage = stage.current || 1;
    const text = await readDraft();
    const pin = await modelPin();
    setModelLabel(pin.label);
    cancel();
    const ac = new AbortController();
    abort.current = ac;
    setEnhancing(true);
    setError("");
    try {
      const extended = stripQuotes(
        await enhanceOnce(text, ac.signal, currentStage, pin)
      );
      if (ac.signal.aborted) return;
      if (!extended) throw new Error("empty extension");

      const merged = text.trimEnd() + "\n\n" + extended;
      await writeDraft(merged);
      host.notify({
        kind: "info",
        message:
          "Extended (" + extended.length.toLocaleString() + " chars) appended.",
      });

      after.current = await readDraft();
      setHasBackup(true);

      try {
        const score = await geValScore("REWRITE", after.current, pin);
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
      host.notify({ kind: "error", message: "Extend failed: " + msg });
    } finally {
      if (abort.current === ac) abort.current = null;
      setEnhancing(false);
    }
  }, [hasBackup, cancel, forceRender]);

  // revert restores the original text before any enhance ran.
  const revert = useCallback(async () => {
    const text = backup.current;
    if (!text) return;
    backup.current = null;
    after.current = null;
    setHasBackup(false);
    lastScore.current = null;
    stage.current = 0;
    forceRender();
    setError("");
    try {
      await writeDraft(text);
      host.notify({ kind: "info", message: "Reverted to original." });
    } catch (err) {
      host.notify({
        kind: "error",
        message:
          "Revert failed: " +
          (err && err.message ? err.message : String(err)),
      });
    }
  }, [forceRender]);

  useEffect(() => {
    trigger = () => {
      if (enhancing) cancel();
      else advance();
    };
    return () => {
      trigger = null;
    };
  }, [enhancing, cancel, advance]);

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
      return "Stage 3: deepen the phased plan";
    }
    return "Enhance prompt (clarify — Stage 1). Model: " + modelLabel + ". Change in Settings → Plugins.";
  })();

  return jsxs("div", {
    className: "flex h-(--composer-control-size) items-center gap-1",
    children: [
      jsx(Tip, {
        label: buttonTip,
        children: jsx(Button, {
          "aria-label": enhancing
            ? "Cancel enhance"
            : hasBackup
            ? "Advance enhance to next stage"
            : "Enhance prompt",
          className: cn(
            "size-(--composer-control-size) shrink-0 rounded-md",
            "text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground",
            (enhancing || hasBackup) && "text-foreground"
          ),
          disabled,
          onClick: enhancing ? cancel : advance,
          size: "icon-xs",
          type: "button",
          variant: "ghost",
          children: jsxs("span", {
            className: "inline-flex items-center gap-1",
            title: ls && ls.after ? scoreTitle(ls) : undefined,
            children: [
              jsx(Codicon, {
                name: enhancing ? "sync" : hasBackup ? "arrow-right" : "sparkle",
                size: 14,
                spinning: enhancing,
              }),
              ls && ls.after
                ? jsx("span", {
                    className: cn(
                      "font-mono text-[10px] tabular-nums",
                      scoreClass(ls.after.total)
                    ),
                    children: String(ls.after.total),
                  })
                : null,
            ],
          }),
        }),
      }),
      // Revert — appears once an enhanced version is in place.
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
      // Extend — re-run current stage, append result. Distinct from
      // the sparkle advance so the user can get more depth in the
      // same stage without jumping to the next.
      hasBackup && !enhancing
        ? jsx(Tip, {
            label: "Extend (re-run current stage, append result)",
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
    ],
  });
}

/* ─── Palette + keybind helpers ─────────────────────────────────────────── */

let trigger = null;

function clickSparkle() {
  if (typeof trigger === "function") {
    trigger();
    return;
  }
  host.notify({
    kind: "info",
    message: "Type in the composer, then use the sparkle next to Send.",
  });
}

/* ─── Plugin entry point ───────────────────────────────────────────────── */

export default {
  id: "enhance-prompt",
  name: "Enhance Prompt",
  description:
    "Sparkle beside Send that rewrites the composer draft without sending it. Click again to deepen the brief. Model follows the chat unless you set one in Settings → Plugins.",
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
