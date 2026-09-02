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

console.log("[enhance-prompt] plugin.js loaded v2026-09-02-2", new Date().toISOString());

import { jsx } from "react/jsx-runtime";
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

const MAX_LEN = 600;          // soft target length for the rewrite
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
- Cap output at 1200 characters`;

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
    range.collapse(false);
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

/* ─── Simple quality score (0-100) ─────────────────────────────────────────── */

const ACTION_VERBS = new Set([
  "build", "create", "make", "fix", "write", "add", "remove", "update", "edit",
  "design", "implement", "deploy", "test", "review", "refactor", "rewrite",
  "ship", "merge", "open", "close", "send", "list", "check", "find", "search",
  "read", "parse", "render", "save", "load", "install", "configure", "set",
  "delete", "sort", "filter", "show", "explain", "describe", "compare",
  "analyze", "analyse", "measure", "log", "track", "monitor", "schedule",
  "generate", "compute", "calculate", "draft", "plan", "break", "split",
  "combine", "merge", "tag", "label", "rename", "move", "copy", "export",
  "import", "submit", "validate", "verify", "confirm", "ensure", "trace",
]);

function score(text) {
  if (!text) return 0;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return 0;
  const numbered = lines.filter((l) => /^\d+\.\s/.test(l)).length;
  const hasGoal = /[A-Z].{5,}/.test(lines[0]) && !/^\d/.test(lines[0]);

  const lower = text.toLowerCase();
  const wordCount = lower.split(/\s+/).length;
  const firstWord = (lower.split(/\s+/)[0] || "").replace(/[^a-z]/g, "");
  const hasVerb = ACTION_VERBS.has(firstWord);
  const hasSpecifics = /\b(file|table|column|class|function|method|module|component|api|endpoint|test|case|user|customer|order|product|item|message|thread|task|ticket|issue|branch|commit|pr|deploy|build|run|test|sprint)\b/i.test(text);

  // Baseline 40 (any non-empty prompt passes), bonuses up to 60.
  let s = 40;
  if (hasGoal) s += 10;
  if (numbered >= 1) s += Math.min(20, numbered * 4);
  if (hasVerb) s += 10;
  if (hasSpecifics) s += 10;
  if (wordCount >= 30 && wordCount <= 200) s += 10;
  return Math.max(0, Math.min(100, s));
}

function scoreClass(s) {
  if (s >= 80) return "text-emerald-500";
  if (s >= 60) return "text-amber-500";
  if (s >= 40) return "text-muted-foreground";
  return "text-muted-foreground/60";
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

async function enhanceOnce(input, signal) {
  const created = await rpc("session.create", {
    title: "Enhance prompt",
    hidden: true,
    messages: [{ role: "system", content: SYSTEM }],
  });
  const sid = created.session_id;
  if (!sid) throw new Error("session.create returned no session_id");

  const user = USER_WRAP.replace("{input}", input);
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
  const [lastScore, setLastScore] = useState(null); // { before: N, after: N } | null

  const backup = useRef(null);
  const after = useRef(null);
  const abort = useRef(null);

  const refreshHasText = useCallback(() => {
    const text = readDraft();
    setHasText(text.length >= MIN_LEN);
    if (hasBackup && after.current && text !== after.current) {
      backup.current = null;
      after.current = null;
      setHasBackup(false);
    }
  }, [hasBackup]);

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

  const revert = useCallback(() => {
    if (!backup.current) return;
    writeDraft(backup.current);
    backup.current = null;
    after.current = null;
    setHasBackup(false);
    setLastScore(null);
    setError("");
  }, []);

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
    setLastScore({ before: score(text), after: 0 });

    try {
      const enhanced = stripQuotes(await enhanceOnce(text, ac.signal));
      if (ac.signal.aborted) return;
      if (!enhanced) throw new Error("empty rewrite");

      // Truncate to MAX_LEN * 2 and warn if we cut anything.
      const clipped =
        enhanced.length > MAX_LEN * 2
          ? enhanced.slice(0, MAX_LEN * 2).trim()
          : enhanced;

      if (clipped.length < enhanced.length) {
        host.notify({
          kind: "info",
          message:
            "Enhanced prompt truncated to " +
            MAX_LEN * 2 +
            " chars — consider splitting the task.",
        });
      }

      if (clipped.trim() === backup.current.trim()) {
        backup.current = null;
        after.current = null;
        setHasBackup(false);
        host.notify({
          kind: "info",
          message: "Prompt was already clear — no change needed.",
        });
        return;
      }

      writeDraft(clipped);
      after.current = readDraft();
      setLastScore({ before: score(backup.current), after: score(clipped) });
      setHasBackup(true);
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
  const tip = error
    ? error
    : enhancing
    ? "Enhancing… click to cancel"
    : hasBackup
    ? `Revert to original (${lastScore && lastScore.after ? lastScore.before + " → " + lastScore.after + "/100" : "no change"})`
    : lastScore && lastScore.after
    ? `Enhanced (${lastScore.before} → ${lastScore.after}/100) — click again to enhance more`
    : "Enhance prompt";

  return jsx("div", {
    className: "flex items-center gap-1.5",
    children: [
      jsx(Tip, {
        label: tip,
        children: jsx(Button, {
          "aria-label": tip,
          className: cn(
            "size-(--composer-control-size) shrink-0 rounded-md",
            "text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground",
            (enhancing || hasBackup) && "text-foreground"
          ),
          disabled,
          onClick: enhancing ? cancel : hasBackup ? revert : run,
          size: "icon-xs",
          type: "button",
          variant: "ghost",
          children: jsx(Codicon, {
            name: enhancing ? "sync" : hasBackup ? "discard" : "sparkle",
            size: 14,
            spinning: enhancing,
          }),
        }),
      }),
      lastScore != null
        ? jsx(
            "span",
            {
              key: "score",
              className: cn(
                "select-none text-[10px] font-mono tabular-nums",
                scoreClass(lastScore.after || 0)
              ),
              title:
                "Quality: " +
                (lastScore.before || 0) +
                " → " +
                (lastScore.after || 0) +
                "/100",
              "aria-label":
                "Score " +
                (lastScore.before || 0) +
                " to " +
                (lastScore.after || 0) +
                " of 100",
            },
            (lastScore.before || 0) + " \u2192 " + (lastScore.after || 0)
          )
        : null,
    ],
  });
}

/* ─── Palette + keybind helpers ──────────────────────────────────────────── */

function clickSparkle() {
  const tips = [
    "Enhance prompt",
    "Revert to original",
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
