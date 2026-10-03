/**
 * @file translate-link.js
 * @description Custom URL provider. Posts JSON to a user-supplied endpoint
 * and expects a JSON response of shape `{ translations: string[] }`
 * (positions aligned with the `targetLangs` array sent in the payload).
 *
 * URL conveniences (mirrors the old project's contract so existing backends
 * keep working):
 *   - "secret-key://host.tld/api"  → key extracted as X-API-Key, prefix dropped
 *   - "host.tld" without scheme    → auto-prepend http (localhost) or https
 *   - missing "/translate" path    → auto-appended
 *
 * The returned `translations` array is re-aligned to positional slots
 * matching `targetLangIds` (with '' for 'none'/empty entries) so the
 * controller does not need to know which provider it called.
 */

import { isDebugEnabled } from './logger.js';
import { getLang } from './languages.js';

const REQUEST_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, init = {}, ms = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(input) {
  let finalUrl = String(input ?? '').trim();
  let apiKey   = '';

  /* Custom scheme like "myKey://example.com" — non-http(s) scheme is treated
     as an embedded API key and stripped. */
  const m = finalUrl.match(/^([a-zA-Z0-9_-]+):\/\/(.+)$/);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      apiKey = m[1];
      finalUrl = m[2];
    }
  }

  if (!/^https?:\/\//.test(finalUrl)) {
    const isLocal = /localhost|127\.0\.0\.1/.test(finalUrl);
    finalUrl = `${isLocal ? 'http' : 'https'}://${finalUrl}`;
  }

  if (!finalUrl.endsWith('/translate')) {
    finalUrl = finalUrl.replace(/\/+$/, '') + '/translate';
  }

  if (!/^https?:\/\/[\w.\-]+(:\d+)?\/translate$/.test(finalUrl)) {
    throw new Error(`Invalid URL format: ${finalUrl}`);
  }

  return { url: finalUrl, apiKey };
}

/* ============ local network permission ============ */

/* Chrome 142+ (Local Network Access) asks before a public page — the GitHub
   Pages build — may reach this machine or the LAN; WebSockets too since 147.
   Left to itself the prompt appears on the first translation, i.e. mid-stream
   on the first sentence, and that request waits on it. So on Start one request
   is sent ahead purely to bring the prompt up while the streamer is still at
   the controls. Not a CORS matter: the server needs no new headers. */

const isLoopback = (host) => host === 'localhost' || host === '[::1]' || /^127\./.test(host);
const isPrivate  = (host) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith('.local');

/* Permission names changed along the way: one 'local-network-access' at 142,
   split in two at 145/146. An unknown name throws, so try them in turn. */
async function isGranted(names) {
  for (const name of names) {
    try { return (await navigator.permissions.query({ name })).state === 'granted'; }
    catch { /* not a name this browser knows */ }
  }
  return false;
}

export async function primeLocalAccess(serviceUrl) {
  let target;
  try { target = new URL(buildUrl(serviceUrl).url); } catch { return; }
  const host = target.hostname;
  /* Nothing is asked of a page that is itself served from this machine. */
  if (isLoopback(location.hostname)) return;
  const names = isLoopback(host) ? ['loopback-network', 'local-network-access']
              : isPrivate(host)  ? ['local-network', 'local-network-access']
              : null;
  if (!names || await isGranted(names)) return;
  if (isDebugEnabled()) console.debug('[link] priming local network permission for', target.origin);
  /* no-cors: only the prompt is wanted, not the answer, and this keeps the
     probe from failing on CORS before it gets that far. */
  fetch(target, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }).catch(() => {});
}

function toCode(langId) {
  return getLang(langId)?.gtxCode ?? langId;
}

/**
 * @param {string}   text
 * @param {string[]} targetLangIds  positional; 'none' / '' produce '' in output
 * @param {string}   sourceLangId
 * @param {string}   serviceUrl
 * @param {number}   sequenceId
 * @param {string|null} [previousText]
 * @returns {Promise<object|null>}  Original response merged with positional translations.
 */
export async function translateLink(text, targetLangIds, sourceLangId, serviceUrl, sequenceId, previousText = null) {
  if (!text?.trim()) return null;
  if (!serviceUrl)    throw new Error('Custom URL is empty');

  const { url, apiKey } = buildUrl(serviceUrl);

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;

  const activeIds = targetLangIds.filter(id => id && id !== 'none');

  const payload = {
    text,
    sourceLang:   toCode(sourceLangId),
    targetLangs:  activeIds.map(toCode),
    sequenceId,
    previousText: previousText || null,
  };

  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => '');
    throw new Error(`link HTTP ${resp.status}${msg ? `: ${msg.slice(0, 200)}` : ''}`);
  }

  const data = await resp.json();
  const backend = Array.isArray(data?.translations) ? data.translations : [];

  /* Re-align backend results to positional slots. */
  const aligned = new Array(targetLangIds.length).fill('');
  let i = 0;
  targetLangIds.forEach((id, idx) => {
    if (id && id !== 'none') {
      aligned[idx] = backend[i] ?? '';
      i++;
    }
  });

  if (isDebugEnabled()) console.debug('[link] response', { sequenceId, aligned });

  return { ...data, translations: aligned };
}
