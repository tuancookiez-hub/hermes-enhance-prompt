/**
 * Enhance Prompt — Desktop plugin
 *
 * Registers a sparkle button beside Send that rewrites the composer draft
 * into a well-structured agent prompt without sending it.  Click again to
 * revert.  Click while spinning to cancel.
 *
 * Settings:
 *   MAX_LEN   — draft character length at which we truncate output (1600)
 *   POLL_MS   — initial polling interval (ms); backs off to MAX_POLL_MS
 *   TIMEOUT   — maximum session polling time (ms)
 *   MIN_LEN   — minimum characters in draft before the sparkle activates
 *
 * Keyboard shortcut: Ctrl/Cmd+K runs the enhance action (same as clicking the
 * sparkle when it is active).  Bound and unbound each time the composer gains
 * focus so it reflects the current keymap.
 */

import {
  host,
  useValue,
  useCallback,
  useEffect,
  useState,
  useRef,
  jsx,
  COMPOSER_AREAS,
  PALETTE_AREA,
  KEYBINDS_AREA,
  Codicon,
  Button,
  Tip,
  cn,
} from "@hermes/plugin-sdk";

/* ─── Tunables ──────────────────────────────────────────────────────────── */

const MAX_LEN = 800;          // characters → write up to 2×MAX_LEN
const INIT_POLL_MS = 1200;    // first poll interval
const MAX_POLL_MS = 3000;     // max poll interval (exponential backoff)
const TIMEOUT_MS = 90_000;    // total session polling timeout
const MIN_LEN = 8;            // minimum draft length to activate

/* ─── Rewrite prompt (inline — must stay in sync with prompts.py) ─────────── */

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
- Do not answer the request — restate it as an actionable task
- Do not add goals the user did not mention
- Do not write tutorial-style output ("First, do X, then Y...")
- Prefer concrete nouns over vague ones ("table" not "the data structure")
- Cap output at 1600 characters`;

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
    // offsetParent === null means hidden; we also check getClientRects
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
    // Save and restore caret so typing continues at the end of the new text.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false); // collapse to end
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

/* ─── Model-output cleaning ──────────────────────────────────────────────── */

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
      const hist = await rpc("session.history", {
        session_id: sid,
      });
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
    // Exponential backoff capped at MAX_POLL_MS.
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

  const backup = useRef(null);   // original draft
  const after = useRef(null);    // draft after last enhance
  const abort = useRef(null);    // AbortController for current run

  // ── Update hasText and auto-clear stale backup ───────────────────────────
  const refreshHasText = useCallback(() => {
    const text = readDraft();
    setHasText(text.length >= MIN_LEN);
    // If the draft diverged from the last enhanced state, discard the backup.
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

  // ── Cancel running enhance ───────────────────────────────────────────────
  const cancel = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setEnhancing(false);
  }, []);

  // ── Revert to original ─────────────────────────────────────────────────
  const revert = useCallback(() => {
    if (!backup.current) return;
    writeDraft(backup.current);
    backup.current = null;
    after.current = null;
    setHasBackup(false);
    setError("");
  }, []);

  // ── Run enhance ─────────────────────────────────────────────────────────
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

      // Auto-revert silently if the model returned the same text.
      if (
        clipped.trim() === backup.current.trim()
      ) {
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
    ? "Revert to original"
    : "Enhance prompt";

  return jsx(Tip, {
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
  });
}

/* ─── Palette: click sparkle from anywhere ───────────────────────────────── */

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
    "Sparkle beside Send that rewrites the composer draft without sending it.",
  defaultEnabled: true,

  register(ctx) {
    // Sparkle button beside Send.
    ctx.register({
      id: "star",
      area: COMPOSER_AREAS.actions,
      order: 40,
      render: () => jsx(EnhanceButton, {}),
    });

    // ⌘K / Ctrl+K palette command.
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

    // Ctrl/Cmd+K keybind — re-bound on composer focus so it always matches
    // the current keyboard layout.
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
