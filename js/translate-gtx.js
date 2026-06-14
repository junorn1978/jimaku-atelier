/**
 * @file translate-gtx.js
 * @description Google translate-pa (translateHtml) provider. Posts each
 * (text, source, target) triple to the same endpoint Chrome uses internally
 * for "Translate this page". Endpoint and API key come from config.json.
 *
 * Public surface:
 *   translateGtx(text, targetLangIds, sourceLangId)
 *     → { translations: string[] }   (positionally aligned with targetLangIds)
 *
 * Errors propagate to the caller; the controller surfaces them in the
 * status display.
 */

import { isDebugEnabled } from './logger.js';
import { getLang } from './languages.js';
import { getGtxConfig } from './config.js';

const REQUEST_TIMEOUT_MS = 10000;

/* --- low-level: fetch with timeout + exponential backoff on 429 / network --- */
async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(timeoutId);

    if (response.status === 429 && retries > 0) {
      if (isDebugEnabled()) console.warn('[gtx] 429 throttled, retrying', { retries, delay });
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (retries > 0 && err.name !== 'AbortError') {
      if (isDebugEnabled()) console.warn('[gtx] fetch failed, retrying', { error: err.message, retries });
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    throw err;
  }
}

/* --- text utilities --- */

let _decoderEl = null;
function decodeHtmlEntities(str) {
  if (!str || str.indexOf('&') === -1) return str;
  if (!_decoderEl) _decoderEl = document.createElement('textarea');
  _decoderEl.innerHTML = str;
  return _decoderEl.value;
}

function normalizeLang(code, fallback) {
  let v = String(code ?? '').trim() || fallback;
  if (v === 'zh_TW') v = 'zh-TW';
  if (v === 'zh_CN') v = 'zh-CN';
  return v;
}

function getCode(langId) {
  return getLang(langId)?.gtxCode ?? langId;
}

/* --- core: one (text, sl, tl) call --- */
async function translateOne(text, sl, tl, cfg) {
  /* application/json+protobuf body shape:
        [[ [textArray], sourceLang, targetLang ], clientTag ]
     We only ever send a single text per call to keep the response shape
     trivial — one outer call per target language. */
  const body = JSON.stringify([[[text], sl, tl], cfg.clientTag]);

  const resp = await fetchWithRetry(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json+protobuf',
      'X-Goog-API-Key': cfg.apiKey,
    },
    body,
  });

  if (!resp.ok) throw new Error(`gtx HTTP ${resp.status}`);

  const data = await resp.json();
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const raw = data[0].filter(s => typeof s === 'string').join('');
    return decodeHtmlEntities(raw);
  }
  return '';
}

/* --- public API --- */

/**
 * @param {string} text
 * @param {string[]} targetLangIds  positions are preserved; 'none' or '' yields ''
 * @param {string} sourceLangId
 * @returns {Promise<{translations: string[]} | null>}
 */
export async function translateGtx(text, targetLangIds, sourceLangId) {
  if (!text || text.trim() === '') return null;

  const cfg = getGtxConfig();
  if (!cfg?.endpoint || !cfg?.apiKey) throw new Error('[gtx] config not loaded');

  const sl = normalizeLang(getCode(sourceLangId), 'auto');

  const translations = await Promise.all(targetLangIds.map(async (tlId) => {
    if (!tlId || tlId === 'none') return '';
    const tl = normalizeLang(getCode(tlId), 'zh-TW');
    return translateOne(text, sl, tl, cfg);
  }));

  return { translations };
}
