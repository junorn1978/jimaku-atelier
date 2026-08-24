/**
 * @file translate-prompt.js
 * @description On-device translation via the Chrome Prompt API (Gemini Nano).
 * An alternative to the gtx/link engines, routed from controller.js when
 * settings.translationMode === 'prompt'.
 *
 * Kept as a reference implementation rather than as a practical engine: a single
 * line costs ~800ms per target language on top of a ~17s one-off model load, and
 * target languages outside the API's supported set produce visibly wrong output.
 * See the note on buildCreateOpts() below.
 *
 * Those figures were re-measured on Chrome 151 (2026-08-24) and are unchanged
 * from Chrome 150, but they are a best case rather than a typical one. Inference
 * leans heavily on the GPU, so the engine needs capable hardware to perform at
 * all and degrades steeply without it — and it has to share that GPU with
 * whatever else is running, which for this app usually means OBS encoding a live
 * stream. What any given user sees therefore depends both on their machine and
 * on what is competing with it. Read ~800ms as the ceiling this API offers, and
 * note that even the ceiling is slow for live subtitles.
 *
 * Design:
 *   - Availability is binary: only 'available' is usable. We never trigger the
 *     model download ourselves — that is left to the browser's device-AI
 *     setting. 'downloadable' / 'downloading' / 'unavailable' all mean "not
 *     usable" here.
 *   - One *pristine* base session is created up front and never prompted, so
 *     its context stays at the system prompt (31 tokens of a 9216 window).
 *     Every translation clones it, prompts the clone, and destroys it. clone()
 *     costs ~0ms, so each request starts from a clean context and no session
 *     ever grows — which is why there is no rotation logic here at all.
 *   - Creating that base session is what pays the model's first-load cost, so
 *     preparePromptSession() exists to do it ahead of time; the engine picker
 *     calls it when the user selects this engine.
 *   - A single model cannot run prompts in parallel, so requests are serialised
 *     with *latest-wins preemption*: a new translation request aborts the
 *     previous in-flight one (it is already stale for live subtitles). There is
 *     no fixed latency timeout — only an 8s backstop to recover a genuinely
 *     hung inference when no newer request arrives to abort it.
 *   - On any failure / abort / empty result we return null so the controller
 *     simply displays nothing. We deliberately do NOT fall back to gtx, because
 *     mixing AI and Google output makes the experience feel inconsistent.
 */

import { isDebugEnabled } from './logger.js';
import { getLang } from './languages.js';

/* Generous absolute cap, used only to free a hung request when no following
   request arrives to preempt it. Not part of normal latency control. */
const BACKSTOP_MS = 8000;

const MAX_TRANSLATION_LEN = 800;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

/* Force the response to be { "translation": string } so parsing is trivial and
   the model can't append explanations. Without it the model treats the prompt
   as an essay question and answers with a few hundred tokens instead of a
   dozen, which costs seconds. */
const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: { translation: { type: 'string', maxLength: MAX_TRANSLATION_LEN } },
  required: ['translation'],
  additionalProperties: false,
};

/** The pristine session everything clones from. Never prompted directly. */
let base = null;
/** In-flight create(), shared so concurrent callers don't build two sessions. */
let baseCreating = null;

/* The controller for the in-flight request; a new request aborts it. */
let activeController = null;
/* The in-flight request chain. A new request aborts the old controller then
   awaits this so the model is free before it issues its own prompt. */
let inflight = null;

/* ---------------------------------------------------------------- support */

export function isPromptSupported() {
  return 'LanguageModel' in self &&
    typeof self.LanguageModel?.availability === 'function' &&
    typeof self.LanguageModel?.create === 'function';
}

/* expectedInputs/expectedOutputs are pinned to 'en' on purpose. The API accepts
   only [de, en, es, fr, ja] — notably NOT zh. Declaring a Chinese output makes
   availability() return 'unavailable' outright ("The requested language options
   are not supported"), which would kill the engine for this app's main language
   pair. Declaring 'en' keeps it alive and does not change what the model
   produces; the real target is carried by the prompt text. Treat any target
   outside that set as working incidentally rather than supported — Chinese
   output in particular mixes scripts and invents proper nouns, which is the
   cost of the model never being told what language to emit.

   Re-verified on Chrome 151 (2026-08-24): zh and zh-Hant both still answer
   'unavailable'. Chrome enumerates the accepted set in the rejection it logs
   ("Please only specify supported language codes: [de, en, es, fr, ja]"), so
   that message — not this comment — is the source of truth; re-probe
   availability() to see whether zh has since been added.

   temperature/topK are deliberately absent: on the web they need an origin
   trial (LanguageModel.params() is undefined without one) and are otherwise
   ignored, so passing them only implied a control we never actually had. */
function buildCreateOpts() {
  return {
    expectedInputs:  [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    initialPrompts: [
      {
        role: 'system',
        content: [
          '你是一位專業的翻譯人員。',
          '你的任務是將接收到的「待翻譯文字」翻譯成指定的「目標語言」。',
        ].join('\n'),
      },
    ],
  };
}

/** Normalised availability: 'available' | 'downloadable' | 'unavailable'. */
export async function getPromptAvailability() {
  if (!isPromptSupported()) return 'unavailable';
  try {
    const a = await LanguageModel.availability(buildCreateOpts());
    if (a === 'available' || a === 'readily' || a === 'yes') return 'available';
    if (a === 'downloadable' || a === 'downloading' || a === 'after-download') return 'downloadable';
    return 'unavailable';
  } catch (err) {
    if (isDebugEnabled()) console.warn('[prompt] availability check failed:', err);
    return 'unavailable';
  }
}

/* ---------------------------------------------------------------- session */

function ensureBase(signal) {
  if (base) return Promise.resolve(base);
  if (!baseCreating) {
    baseCreating = (async () => {
      const avail = await getPromptAvailability();
      if (avail !== 'available') throw new Error(`Prompt model not ready (${avail})`);
      /* This call is where the model's first load happens: prefilling the
         system prompt pulls it into memory (~17s cold, ~300ms once warm).
         create() without initialPrompts returns in ~1ms but is lazy, which
         would just move that cost onto the first translation instead. */
      base = await LanguageModel.create({ ...buildCreateOpts(), signal });
      return base;
    })().finally(() => { baseCreating = null; });
  }
  return baseCreating;
}

/**
 * Build the base session ahead of time so the model's first-load cost is paid
 * before the user starts speaking. Safe to call repeatedly.
 * @param {AbortSignal} [signal]  aborts the (long) create()
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export async function preparePromptSession(signal) {
  if (!isPromptSupported()) return { ok: false, reason: 'unsupported' };
  try {
    await ensureBase(signal);
    return { ok: true };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, reason: 'aborted' };
    if (isDebugEnabled()) console.warn('[prompt] prepare failed:', err?.message);
    return { ok: false, reason: 'failed' };
  }
}

/** Tear down the base session and release the model. Safe to call when idle. */
export function destroyPromptSession() {
  activeController?.abort();
  activeController = null;
  const s = base;
  base = null;
  try { s?.destroy(); }
  catch (err) { if (isDebugEnabled()) console.warn('[prompt] destroy failed:', err); }
}

/* ---------------------------------------------------------------- parsing */

function sanitizeText(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\n\r\t]/g, ' ').replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
}

function safeParseTranslation(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.translation !== 'string') return '';
    const clean = sanitizeText(obj.translation);
    return clean.length > MAX_TRANSLATION_LEN ? '' : clean;
  } catch (err) {
    if (isDebugEnabled()) console.warn('[prompt] parse failed:', err?.message, '| raw:', String(raw).slice(0, 80));
    return '';
  }
}

/* ---------------------------------------------------------------- translate */

async function translateOne(text, targetLangId, signal) {
  const sess = await ensureBase(signal);
  const targetName = getLang(targetLangId)?.promptName || targetLangId;

  /* JSON.stringify isolates the source text from the instruction so quotes or
     newlines can't break out of the prompt. "只生成翻譯" must stay or the model
     tends to append an explanation. */
  const safeText = JSON.stringify(String(text));
  const prompt = [
    `將 ${safeText} 翻譯成 "${targetName}"。`,
    '只生成翻譯，只生成JSON格式',
  ].join('\n');

  /* Clone per translation: the copy inherits the system prompt but no history,
     so nothing accumulates anywhere and the base stays pristine. */
  const scratch = await sess.clone();
  try {
    const raw = await scratch.prompt(prompt, {
      signal,
      responseConstraint: TRANSLATION_SCHEMA,
      omitResponseConstraintInput: true,
    });
    return safeParseTranslation(raw);
  } finally {
    try { scratch.destroy(); } catch { /* ignore */ }
  }
}

/**
 * Translate one source line into each target. Matches the gtx/link contract.
 * @param {string} text
 * @param {string[]} targetLangIds  positions preserved; 'none'/'' yields ''
 * @param {string} _sourceLangId    unused (target name carries the intent)
 * @returns {Promise<{translations: string[]} | null>}  null → display nothing
 */
export async function translatePrompt(text, targetLangIds, _sourceLangId) {
  if (!text || !text.trim()) return null;
  if (!isPromptSupported()) return null;

  /* Preempt the previous in-flight request — it is now stale — and remember it
     so we can wait for it to unwind before asking the model again. */
  activeController?.abort();
  const prev = inflight;

  const controller = new AbortController();
  activeController = controller;
  const backstop = setTimeout(() => controller.abort(), BACKSTOP_MS);

  const run = (async () => {
    /* Let the just-aborted request settle so the model isn't mid-generation
       when we issue ours. Its result is irrelevant here. */
    if (prev) { try { await prev; } catch { /* ignore */ } }
    if (controller.signal.aborted) return null;

    const translations = [];
    for (const tlId of targetLangIds) {
      if (!tlId || tlId === 'none') { translations.push(''); continue; }
      translations.push(await translateOne(text, tlId, controller.signal));
    }
    return { translations };
  })();

  inflight = run;

  try {
    return await run;
  } catch (err) {
    /* Abort (preempted or backstop) or any inference error → show nothing,
       no fallback. */
    if (isDebugEnabled()) console.warn('[prompt] translate failed:', err?.message);
    return null;
  } finally {
    clearTimeout(backstop);
    if (activeController === controller) activeController = null;
    if (inflight === run) inflight = null;
  }
}
