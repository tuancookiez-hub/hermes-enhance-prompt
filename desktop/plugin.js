/**
 * Enhance Prompt — sparkle beside Send on Hermes Desktop.
 *
 * Install: <hermes home>/desktop-plugins/enhance-prompt/plugin.js
 * Folder name MUST equal plugin id.
 *
 * Click sparkle → rewrite the composer draft (does not send).
 * Click again while enhanced → revert.
 * Click while running → cancel the UI wait (the hidden session may still finish).
 */

import {
  Button,
  cn,
  Codicon,
  COMPOSER_AREAS,
  PALETTE_AREA,
  host,
  Tip,
  useValue
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { jsx } from 'react/jsx-runtime'

const SLOT = 'composer-rich-input'
const MIN_LEN = 8
const MAX_LEN = 800
const POLL_MS = 400
const TIMEOUT_MS = 45000

// Rewrite prompt lives in prompts.py so the agent-side /enhance slash command
// and enhance_prompt tool stay byte-identical to what the sparkle sends. The
// inline copy below is the agent-prompt contract; any edit here must also
// update prompts.py (and vice versa). Keep them in sync.
const SYSTEM = `You are a Prompt Engineering Expert specializing in improving user prompts for a development code assistant. When given a prompt, analyze and enhance it to create a more effective version while maintaining its core purpose. The requests are being made to an AI assistant that specializes in writing code.

TASK: When given a prompt, analyze and enhance it to create a more effective version while maintaining its core purpose.

ANALYSIS PROCESS:
Evaluate the original prompt:
Identify the main objective
Note any ambiguities or gaps
Assess the clarity of instructions
Check for missing context
Apply these prompt engineering principles:
Write clear, specific instructions
Include necessary context
Set explicit parameters and constraints
Structure the output as a numbered task list
Add relevant examples
Match tone and complexity to the use case
Remove redundant information
Create the enhanced version:
Maintain the original goal
Incorporate identified improvements
Ensure clarity and completeness
Be realistic in the features to add
Do NOT request guides/how-tos unless the user asks
Do NOT ask for code snippets
Do NOT suggest specific technologies unless mentioned in the user's prompt
Do NOT explain HOW to do things, focus on WHAT
Do NOT answer questions - expand/rewrite them to be more detailed

IMPORTANT CONSTRAINTS:
1. Language matching is the highest priority - You MUST strictly respond in the exact same language as the user's input. If the user writes in Chinese, respond in Chinese; if the user writes in English, respond in English; if the user uses another language, respond in that same language. Do not mix languages unless the user's input itself mixes languages.
2. Keep the enhanced prompt concise - maximum length should be around 800 characters
3. NUMBERED LIST IS REQUIRED - write the enhanced prompt as a short goal line, then numbered steps (1. 2. 3.). Use 3-7 items. Each item is one concrete ask. Prefer "1." over bullets or a single paragraph. Only skip numbering if the input is already a single atomic question that cannot be split.
FORMAT: Provide only the enhanced prompt with no additional commentary.`

const USER_WRAP = `You are a prompt enhancement assistant. Improve the user prompt while preserving its intent and language.

USER INPUT:
{input}

TASK:
Rewrite the user input into a clearer, more specific prompt for the target AI assistant.

CRITICAL PRIORITY - LANGUAGE CONSISTENCY:
1. You MUST detect the language of the user input above and write the enhanced prompt in that same language.
2. If the user writes in Chinese, the enhanced prompt MUST be entirely in Chinese.
3. If the user writes in English, the enhanced prompt MUST be entirely in English.
4. If the user writes in any other language, the enhanced prompt MUST use that exact same language.
5. If the user mixes languages, keep a natural matching mix. Do not translate the user's intent into a single language.
6. These language rules are behavior instructions only; never include language analysis or language labels in the output.

ENHANCEMENT REQUIREMENTS:
1. Return only the enhanced prompt text; do not add explanations, prefaces, markdown fences, labels, or analysis.
2. Do not include language labels or meta notes such as "User input is in Chinese" or "Response must be in Chinese".
3. Preserve the user's original intent, topic, constraints, and target output type. Do not answer the request.
4. Always make a substantive enhancement when possible: clarify the task, scope, constraints, and expected output.
5. Format as a numbered list: one short goal line, then 3-7 numbered steps (1. 2. 3.). Each step is one concrete ask. Do not use bullets. Do not write a single paragraph. Only skip numbering if the input is already one atomic question that cannot be split.
6. If the original prompt is already numbered, keep that numbering and only tighten the items.
7. Keep the enhanced prompt complete and concise. Do not end with an unfinished list, dangling conjunction, or trailing colon.
8. Do not add unrelated requirements, unsupported facts, or unnecessary sections.

EXAMPLES:
User input: "fix the login"
Enhanced prompt:
Fix the login flow.
1. Identify why login currently fails.
2. Apply a minimal fix that preserves existing auth behavior.
3. Confirm a user can sign in and see the expected next screen.

User input: "请帮我解释这段代码"
Enhanced prompt:
请解释这段代码。
1. 说明主要功能。
2. 按执行顺序列出关键逻辑。
3. 指出需要注意的边界情况。`

function unwrap(res) {
  if (!res || typeof res !== 'object') return {}
  if (res.result && typeof res.result === 'object') return res.result
  return res
}

function rpcFail(res) {
  if (!res || typeof res !== 'object') return null
  if (res.ok === false) {
    const err = res.error
    if (!err) return 'request failed'
    if (typeof err === 'string') return err
    return err.message || String(err)
  }
  return null
}

async function rpc(method, params) {
  if (typeof host.request !== 'function') throw new Error('host.request unavailable')
  const res = await host.request(method, params)
  const fail = rpcFail(res)
  if (fail) throw new Error(method + ': ' + fail)
  return unwrap(res)
}

function editor() {
  const nodes = document.querySelectorAll(`[data-slot="${SLOT}"]`)
  for (const n of nodes) {
    if (!(n instanceof HTMLElement)) continue
    if (n.offsetParent !== null || n.getClientRects().length) return n
  }
  return nodes[0] instanceof HTMLElement ? nodes[0] : null
}

function readDraft() {
  const el = editor()
  if (!el) return ''
  return String(el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim()
}

function writeDraft(text) {
  const el = editor()
  if (!el) throw new Error('composer not found')
  const next = String(text ?? '')
  el.focus()
  try {
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    const ok = document.execCommand('insertText', false, next)
    if (!ok) throw new Error('insertText failed')
  } catch {
    el.textContent = next
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: next }))
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function stripQuotes(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^<\|[\w:-]+\|>[^\n]*\n?/gm, '')
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
    .replace(/^['"`\u201c\u201d\u2018\u2019]+|['"`\u201c\u201d\u2018\u2019]+$/g, '')
    .trim()
}

function lastAssistant(messages) {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant') continue
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      const bits = m.content
        .map((p) => {
          if (typeof p === 'string') return p
          if (p && typeof p.text === 'string') return p.text
          if (p && typeof p.content === 'string') return p.content
          return ''
        })
        .filter(Boolean)
      if (bits.length) return bits.join('\n')
    }
    if (typeof m.text === 'string') return m.text
  }
  return ''
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

async function enhanceOnce(input, signal) {
  const created = await rpc('session.create', {
    title: 'Enhance prompt',
    hidden: true,
    messages: [{ role: 'system', content: SYSTEM }]
  })
  const sid = created.session_id
  if (!sid) throw new Error('session.create returned no session_id')

  const user = USER_WRAP.replace('{input}', input)
  await rpc('prompt.submit', { session_id: sid, text: user })

  const start = Date.now()
  let last = ''
  let stable = 0
  while (Date.now() - start < TIMEOUT_MS) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    try {
      const hist = await rpc('session.history', { session_id: sid })
      const next = stripQuotes(lastAssistant(hist.messages || hist.history || []))
      if (next && next === last) {
        stable += 1
        if (stable >= 2) return next
      } else if (next) {
        last = next
        stable = 0
      }
    } catch {
      /* keep polling */
    }
    await sleep(POLL_MS, signal)
  }
  if (last) return last
  throw new Error('timed out waiting for enhanced prompt')
}

function EnhanceButton() {
  const chatBusy = useValue(host.state.busy)
  const [enhancing, setEnhancing] = useState(false)
  const [hasBackup, setHasBackup] = useState(false)
  const [error, setError] = useState('')
  const [hasText, setHasText] = useState(false)
  const backup = useRef(null)
  const after = useRef(null)
  const abort = useRef(null)

  const refreshHasText = useCallback(() => {
    const text = readDraft()
    setHasText(text.length >= MIN_LEN)
    if (hasBackup && after.current && text !== after.current) {
      backup.current = null
      after.current = null
      setHasBackup(false)
    }
  }, [hasBackup])

  useEffect(() => {
    refreshHasText()
    const el = editor()
    if (!el) return undefined
    const on = () => refreshHasText()
    el.addEventListener('input', on)
    el.addEventListener('keyup', on)
    const t = setInterval(on, 800)
    return () => {
      el.removeEventListener('input', on)
      el.removeEventListener('keyup', on)
      clearInterval(t)
    }
  }, [refreshHasText])

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setEnhancing(false)
  }, [])

  const revert = useCallback(() => {
    if (!backup.current) return
    writeDraft(backup.current)
    backup.current = null
    after.current = null
    setHasBackup(false)
    setError('')
  }, [])

  const run = useCallback(async () => {
    const text = readDraft()
    if (text.length < MIN_LEN) {
      host.notify({ kind: 'error', message: 'Type a bit more, then enhance.' })
      return
    }
    cancel()
    const ac = new AbortController()
    abort.current = ac
    setEnhancing(true)
    setError('')
    backup.current = text
    try {
      const enhanced = stripQuotes(await enhanceOnce(text, ac.signal))
      if (ac.signal.aborted) return
      if (!enhanced) throw new Error('empty rewrite')
      const clipped = enhanced.length > MAX_LEN * 2 ? enhanced.slice(0, MAX_LEN * 2).trim() : enhanced
      writeDraft(clipped)
      after.current = readDraft()
      setHasBackup(true)
    } catch (err) {
      if (err?.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      host.notify({ kind: 'error', message: 'Enhance failed: ' + msg })
      backup.current = null
      after.current = null
      setHasBackup(false)
    } finally {
      if (abort.current === ac) abort.current = null
      setEnhancing(false)
    }
  }, [cancel])

  const disabled = enhancing ? false : !!chatBusy || !hasText
  const tip = error
    ? error
    : enhancing
      ? 'Enhancing… click to cancel'
      : hasBackup
        ? 'Revert to original'
        : 'Enhance prompt'

  return jsx(Tip, {
    label: tip,
    children: jsx(Button, {
      'aria-label': tip,
      className: cn(
        'size-(--composer-control-size) shrink-0 rounded-md',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
        (enhancing || hasBackup) && 'text-foreground'
      ),
      disabled,
      onClick: enhancing ? cancel : hasBackup ? revert : run,
      size: 'icon-xs',
      type: 'button',
      variant: 'ghost',
      children: jsx(Codicon, {
        name: enhancing ? 'sync' : hasBackup ? 'discard' : 'sparkle',
        size: 14,
        spinning: enhancing
      })
    })
  })
}

function clickStar() {
  const tips = ['Enhance prompt', 'Revert to original', 'Enhancing… click to cancel']
  const btn = [...document.querySelectorAll('button[aria-label]')].find((el) =>
    tips.includes(el.getAttribute('aria-label') || '')
  )
  if (btn instanceof HTMLElement) btn.click()
  else host.notify({ kind: 'info', message: 'Type in the composer, then use the sparkle next to Send.' })
}

export default {
  id: 'enhance-prompt',
  name: 'Enhance Prompt',
  description: 'Sparkle beside Send that rewrites the composer draft without sending it.',
  defaultEnabled: true,
  register(ctx) {
    ctx.register({
      id: 'star',
      area: COMPOSER_AREAS.actions,
      order: 40,
      render: () => jsx(EnhanceButton, {})
    })
    ctx.register({
      id: 'palette',
      area: PALETTE_AREA,
      data: {
        id: 'enhance-prompt.run',
        label: 'Enhance prompt',
        keywords: ['enhance', 'prompt', 'sparkle', 'rewrite', 'star'],
        run: clickStar
      }
    })
  }
}
