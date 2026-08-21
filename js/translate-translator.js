/**
 * @file translate-translator.js
 * @description On-device translation via the built-in Translator API (Chrome
 * 138+, Edge 148+). Routed from controller.js when
 * settings.translationMode === 'translator'.
 *
 * Design:
 *   - One Translator instance per (source → target) pair, cached in a pool.
 *     Creating one is expensive (it may download a model), translating with an
 *     existing one is cheap, so instances are kept for the whole session and
 *     only the pairs that are no longer selected get destroyed.
 *   - create() downloads the model on first use and REQUIRES user activation
 *     to do so. Subtitle translation runs long after any click, so the pool is
 *     warmed up from ui-languages.js at the moments a gesture is available —
 *     picking the engine, or changing a source/target language. If a pair is
 *     still missing when a subtitle arrives, create() rejects with
 *     NotAllowedError and the UI asks the user to press the engine button.
 *   - Unlike the Prompt API engine we DO trigger downloads: per-pair models are
 *     small and downloading them on demand is the API's intended flow.
 *   - Errors propagate to the controller, matching the gtx contract.
 *
 * Notes / limits:
 *   - Translations are processed sequentially per instance, so a long text
 *     blocks the ones behind it. Subtitle lines are short, and the controller
 *     already drops results older than 10s, so no extra preemption is done.
 *   - The API reports every unsupported pair as 'downloadable' (a
 *     fingerprinting countermeasure), so availability() cannot tell "not
 *     downloaded yet" from "not supported". Only create() gives the real
 *     answer, via NotSupportedError.
 *   - Manual text translation passes 'auto' as the source. The Translator API
 *     has no auto mode, so the language is resolved with the LanguageDetector
 *     API — which is created inside the same click, where activation exists.
 */

import { isDebugEnabled } from './logger.js';
import { getLang } from './languages.js';

/* ---------------------------------------------------------------- support */

export function isTranslatorSupported() {
  return typeof self.Translator?.availability === 'function' &&
         typeof self.Translator?.create === 'function';
}

function isDetectorSupported() {
  return typeof self.LanguageDetector?.create === 'function';
}

function codeOf(langId) {
  return getLang(langId)?.translatorCode ?? null;
}

/* ------------------------------------------------------------------- pool */

/** 'ja→zh-Hant' → Promise<Translator>. Rejected entries are evicted. */
const _pool = new Map();

const pairKey = (src, tgt) => `${src}→${tgt}`;

function getTranslator(src, tgt, onProgress) {
  const key = pairKey(src, tgt);
  const cached = _pool.get(key);
  if (cached) return cached;

  const created = Translator.create({
    sourceLanguage: src,
    targetLanguage: tgt,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onProgress?.(key, e.loaded));
    },
  }).catch((err) => {
    /* Never cache a failure — the next warm-up (with a fresh user gesture, or
       after the model finishes downloading) must be able to retry. */
    _pool.delete(key);
    throw err;
  });

  _pool.set(key, created);
  return created;
}

/* Destroy instances whose pair is no longer selected, so switching languages
   mid-session doesn't accumulate models in memory. */
function pruneTranslators(activeKeys) {
  for (const [key, entry] of _pool) {
    if (activeKeys.has(key)) continue;
    _pool.delete(key);
    Promise.resolve(entry)
      .then(tr => tr.destroy?.())
      .catch(() => { /* creation already failed — nothing to release */ });
  }
}

/* ------------------------------------------------------- source resolution */

let _detector = null;

/** Best-effort language detection for the manual ('auto') path. */
async function detectSourceCode(text) {
  if (!isDetectorSupported()) {
    throw new Error('[translator] language detection unavailable');
  }
  _detector ??= LanguageDetector.create().catch((err) => { _detector = null; throw err; });
  const detector = await _detector;
  const [best] = await detector.detect(text);
  if (!best?.detectedLanguage) {
    throw new Error('[translator] could not detect the source language');
  }
  if (isDebugEnabled()) {
    console.debug('[translator] detected', best.detectedLanguage, best.confidence);
  }
  return best.detectedLanguage;
}

async function resolveSourceCode(sourceLangId, text) {
  if (sourceLangId && sourceLangId !== 'auto') {
    const code = codeOf(sourceLangId);
    if (code) return code;
  }
  return detectSourceCode(text);
}

/* ---------------------------------------------------------------- warm-up */

/**
 * Create (and if needed download) the translators for the current language
 * selection. MUST be called from a user gesture — that is what allows the
 * model download.
 *
 * @param {string} sourceLangId
 * @param {string[]} targetLangIds
 * @param {(loaded: number) => void} [onProgress] 0–1 download progress
 * @returns {Promise<{ok: boolean, reason?: 'unsupported'|'unavailable'|'blocked'|'failed'}>}
 */
export async function prepareTranslators(sourceLangId, targetLangIds, onProgress) {
  if (!isTranslatorSupported()) return { ok: false, reason: 'unsupported' };

  const src = codeOf(sourceLangId);
  const pairs = (targetLangIds || [])
    .filter(id => id && id !== 'none')
    .map(codeOf)
    .filter(tgt => tgt && tgt !== src);

  /* Drop instances for pairs that are no longer selected. With no source
     language the set is empty, which releases everything. */
  pruneTranslators(new Set(src ? pairs.map(tgt => pairKey(src, tgt)) : []));

  /* No source language picked yet, or nothing to translate into: nothing to
     warm up, and nothing is wrong either. */
  if (!src || pairs.length === 0) return { ok: true };

  try {
    await Promise.all(pairs.map(tgt =>
      getTranslator(src, tgt, (_key, loaded) => onProgress?.(loaded))
    ));
    return { ok: true };
  } catch (err) {
    if (isDebugEnabled()) console.warn('[translator] prepare failed:', err?.name, err?.message);
    if (err?.name === 'NotSupportedError') return { ok: false, reason: 'unavailable' };
    if (err?.name === 'NotAllowedError')   return { ok: false, reason: 'blocked' };
    return { ok: false, reason: 'failed' };
  }
}

/* -------------------------------------------------------------- translate */

/**
 * Translate one source line into each target. Matches the gtx contract.
 *
 * @param {string} text
 * @param {string[]} targetLangIds  positions preserved; 'none'/'' yields ''
 * @param {string} sourceLangId     'auto' triggers language detection
 * @returns {Promise<{translations: string[]} | null>}
 */
export async function translateTranslator(text, targetLangIds, sourceLangId) {
  if (!text || !text.trim()) return null;
  if (!isTranslatorSupported()) throw new Error('[translator] API not supported');

  const src = await resolveSourceCode(sourceLangId, text);

  const translations = await Promise.all(targetLangIds.map(async (tlId) => {
    if (!tlId || tlId === 'none') return '';
    const tgt = codeOf(tlId);
    if (!tgt) return '';
    /* Same language on both ends: the API would reject the pair, and echoing
       the source is what the user asked to see anyway. */
    if (tgt === src) return text;

    const translator = await getTranslator(src, tgt);
    return translator.translate(text);
  }));

  return { translations };
}
