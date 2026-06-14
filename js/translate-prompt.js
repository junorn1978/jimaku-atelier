/**
 * @file translate-prompt.js
 * @description On-device translation via the Chrome Prompt API (Gemini Nano).
 * An alternative to the gtx/link engines, routed from controller.js when
 * settings.translationMode === 'prompt'.
 *
 * Design (see project notes):
 *   - Availability is binary: only 'available' is usable. We never trigger the
 *     model download ourselves — that is left to the browser's device-AI
 *     setting. 'downloadable' / 'downloading' / 'unavailable' all mean "not
 *     usable" here.
 *   - The Prompt API session is stateful: each prompt() grows inputUsage toward
 *     inputQuota, so we rotate (destroy + recreate) the session once it nears
 *     the quota / a call count / a lifetime — inputQuota is read dynamically,
 *     never hardcoded.
 *   - A single session cannot run prompts in parallel, so requests are
 *     serialised with *latest-wins preemption*: a new translation request
 *     aborts the previous in-flight one (it is already stale for live
 *     subtitles). There is no fixed latency timeout — only an 8s backstop to
 *     recover a genuinely hung inference when no newer request arrives to abort
 *     it.
 *   - On any failure / abort / empty result we return null so the controller
 *     simply displays nothing. We deliberately do NOT fall back to gtx, because
 *     mixing AI and Google output makes the experience feel inconsistent.
 */

import { isDebugEnabled } from './logger.js';
import { getLang } from './languages.js';

/* Generous absolute cap, used only to free a hung session when no following
   request arrives to preempt it. Not part of normal latency control. */
const BACKSTOP_MS = 8000;

const MAX_TRANSLATION_LEN = 800;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

/* Force the response to be { "translation": string } so parsing is trivial and
   the model can't append explanations. */
const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: { translation: { type: 'string', maxLength: MAX_TRANSLATION_LEN } },
  required: ['translation'],
  additionalProperties: false,
};

let session     = null;
let count       = 0;
let createdAt   = 0;
let initPromise = null;
let refreshPromise = null;

/* The controller for the in-flight request; a new request aborts it. */
let activeController = null;
/* The in-flight request chain. A new request aborts the old controller then
   awaits this so the single session is free before it issues its own prompt. */
let inflight = null;

/* Session rotation thresholds. */
const REFRESH_COUNT    = 50;
const QUOTA_THRESHOLD  = 0.8;
const LIFETIME_MS      = 5 * 60 * 1000;

/* ---------------------------------------------------------------- support */

export function isPromptSupported() {
  return 'LanguageModel' in self &&
    typeof self.LanguageModel?.availability === 'function' &&
    typeof self.LanguageModel?.create === 'function';
}

/* expectedInputs/expectedOutputs are pinned to 'en' on purpose: the Prompt API
   currently only accepts 'en' here and it does NOT affect translation output —
   declaring it just silences a console error. Do not "fix" this to real langs. */
function buildCreateOpts() {
  return {
    expectedInputs:  [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    temperature: 0.1,
    topK: 40,
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

function needRefresh() {
  if (!session) return false;
  const used  = Number(session.inputUsage ?? 0);
  const quota = Number(session.inputQuota ?? 0);
  const quotaFull    = quota > 0 && used / quota > QUOTA_THRESHOLD;
  const countFull    = count >= REFRESH_COUNT;
  const lifetimeFull = Date.now() - createdAt > LIFETIME_MS;
  return quotaFull || countFull || lifetimeFull;
}

async function init() {
  if (!isPromptSupported()) throw new Error('Prompt API not supported');
  if (session) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    /* Only build a session when the model is already downloaded; downloads are
       the browser's responsibility, not ours. */
    const avail = await getPromptAvailability();
    if (avail !== 'available') throw new Error(`Prompt model not ready (${avail})`);

    session   = await LanguageModel.create(buildCreateOpts());
    createdAt = Date.now();
    count     = 0;
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

async function refreshSession() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    if (session) {
      try { await session.destroy(); }
      catch (err) { if (isDebugEnabled()) console.warn('[prompt] destroy failed:', err); }
      finally { session = null; count = 0; createdAt = 0; }
    }
    await init();
  })();

  try { await refreshPromise; }
  finally { refreshPromise = null; }
}

/* Refresh proactively *before* a call when near a threshold, so a request never
   lands in the brief window where the session is being torn down. */
async function getSession() {
  if (session && needRefresh()) await refreshSession();
  if (!session) await init();
  return session;
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
  const sess = await getSession();
  const targetName = getLang(targetLangId)?.promptName || targetLangId;

  /* JSON.stringify isolates the source text from the instruction so quotes or
     newlines can't break out of the prompt. "只生成翻譯" must stay or the model
     tends to append an explanation. */
  const safeText = JSON.stringify(String(text));
  const prompt = [
    `將 ${safeText} 翻譯成 "${targetName}"。`,
    '只生成翻譯，只生成JSON格式',
  ].join('\n');

  const raw = await sess.prompt(prompt, {
    signal,
    responseConstraint: TRANSLATION_SCHEMA,
    omitResponseConstraintInput: true,
  });
  count++;
  return safeParseTranslation(raw);
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
     so we can wait for it to unwind before reusing the single session. */
  activeController?.abort();
  const prev = inflight;

  const controller = new AbortController();
  activeController = controller;
  const backstop = setTimeout(() => controller.abort(), BACKSTOP_MS);

  const run = (async () => {
    /* Let the just-aborted request settle so the session isn't mid-generation
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

/** Tear down the session (e.g. on stop). Safe to call when idle. */
export async function destroyPromptSession() {
  activeController?.abort();
  activeController = null;
  if (session) {
    try { await session.destroy(); }
    catch { /* ignore */ }
    finally { session = null; count = 0; createdAt = 0; }
  }
}
