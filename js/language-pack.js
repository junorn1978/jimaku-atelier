/**
 * @file language-pack.js
 * @description Offline (on-device) speech recognition pack manager. Chrome
 * exposes SpeechRecognition.available()/install() to query and download local
 * language models; this module drives a single download button off the current
 * source language and reflects the model state back to the user.
 *
 * On-device packs are Chrome-only, so the button is wired only on Chrome.
 */

import { getLang } from './languages.js';
import { isDebugEnabled } from './logger.js';
import { stopSpeech } from './speech.js';
import { settings, subscribe } from './store.js';
import { t } from './i18n.js';
import { isChrome } from './env.js';

const SR = window.SpeechRecognition;

/* en-US is SODA's base model: as of Chrome 149, installing any on-device
   language pack also pulls en-US as a dependency, and recognition can't be used
   until en-US has finished downloading too. So listing en-US here doesn't change
   the outcome — it just downloads it up front in the same install() call rather
   than letting it arrive implicitly. Kept explicit so the intent is visible and
   the wait is front-loaded. Set to null to drop the explicit entry (en-US will
   still be fetched alongside the target language). Re-verify on future Chrome
   versions in case the implicit dependency changes. */
const PRIMER_LANG = 'en-US';

/* install() can resolve before the download actually finishes, so we poll
   available() until the model reports ready (or we give up). */
const INSTALL_POLL_INTERVAL_MS = 1500;
const INSTALL_POLL_TIMEOUT_MS  = 60000;

/* On-device model quality floors we accept, best first (Chrome 150+). quality
   is a "meets-or-exceeds" floor in the spec, so we probe the best floor and
   fall back to a lower one when no model satisfies it. As of Chrome 150 only
   'command' packs are shipped, so this resolves to 'command' today and will
   pick up 'dictation' automatically once those packs ship — no code change.
   Older Chrome / Edge ignore the unknown `quality` member, so it stays a no-op
   there. The default 'command' floor in available()/install() = lowest bar. */
const QUALITY_PREFERENCE = ['dictation', 'command'];

let _button   = null;
let _status   = null;
let _info      = null;
let _stateKey = 'lang.offline.btn';   /* i18n key of the current button label */
let _infoKey  = '';                   /* i18n key of the persistent info note */
let _installQuality = QUALITY_PREFERENCE[QUALITY_PREFERENCE.length - 1];
                                      /* floor querySupport last resolved; install() reuses it */

async function querySupport(langId) {
  const lang = getLang(langId);
  if (!lang || !SR || typeof SR.available !== 'function') {
    return { supported: false, downloadable: false, downloading: false, quality: null };
  }
  /* Probe each quality floor best-first; the first that isn't 'unavailable' is
     the one we'd act on. Today only 'command' answers, so this collapses to the
     pre-quality behaviour. */
  for (const quality of QUALITY_PREFERENCE) {
    try {
      const status = await SR.available({ langs: [lang.id], processLocally: true, quality });
      if (isDebugEnabled()) console.debug('[language-pack] available:', { id: lang.id, quality, status });
      if (status !== 'unavailable') {
        return {
          supported:    status === 'available',
          downloadable: status === 'downloadable',
          downloading:  status === 'downloading',
          quality,
        };
      }
    } catch (err) {
      if (isDebugEnabled()) console.error('[language-pack] available() failed:', err);
    }
  }
  return { supported: false, downloadable: false, downloading: false, quality: null };
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Poll available() until the language model is fully installed, or time out.
 * Works around install() resolving before the download completes.
 */
async function waitUntilInstalled(langId, timeoutMs = INSTALL_POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await querySupport(langId)).supported) return true;
    await delay(INSTALL_POLL_INTERVAL_MS);
  }
  return false;
}

function setState(key, disabled) {
  _stateKey = key;
  if (!_button) return;
  _button.textContent = t(key);
  _button.disabled = disabled;
}

/* A success message is a one-off nudge ("press Start again"); left on screen it
   just sits on top of the info note below it. Failures stay put — the user has
   to know a retry is needed. */
const STATUS_CLEAR_MS = 6000;

let _statusKey   = '';
let _statusTimer = null;

function renderStatus() {
  if (_status) _status.textContent = _statusKey ? t(_statusKey) : '';
}

function setStatus(key, autoClear = false) {
  _statusKey = key || '';
  if (_statusTimer) { clearTimeout(_statusTimer); _statusTimer = null; }
  renderStatus();
  if (_statusKey && autoClear) {
    _statusTimer = setTimeout(() => { _statusTimer = null; setStatus(''); }, STATUS_CLEAR_MS);
  }
}

/* Persistent guidance note shown beneath the button: removal instructions once
   the pack is installed, otherwise a note on which audio the pack suits. */
function setInfo(key) {
  _infoKey = key;
  if (_info) _info.textContent = key ? t(key) : '';
}

async function refreshButton(langId) {
  const lang = getLang(langId);
  if (!lang) {
    setInfo('lang.offline.info.notReady');
    return setState('lang.offline.btn.unsupported', true);
  }

  /* Chrome's on-device model for Traditional Chinese (zh-TW) is still
     unstable, so the pack is intentionally withheld for now. */
  if (lang.id === 'zh-TW') {
    setInfo('lang.offline.info.notReady');
    return setState('lang.offline.btn.unavailable', true);
  }

  const s = await querySupport(langId);
  /* Remember which floor to install — downloadPack() can't await available()
     first without consuming the user gesture, so it reuses this. */
  if (s.quality) _installQuality = s.quality;
  if (s.supported)         setState('lang.offline.btn.ready', true);
  else if (s.downloadable) setState('lang.offline.btn', false);
  else if (s.downloading)  setState('lang.offline.btn.downloading', true);
  else                     setState('lang.offline.btn.unsupported', true);

  /* Once installed, point users to the browser settings to remove it; before
     that, note which audio the pack is recommended for. */
  setInfo(s.supported ? 'lang.offline.info.installed' : 'lang.offline.info.notReady');
}

async function downloadPack(langId) {
  const lang = getLang(langId);
  if (!lang) return;

  if (!navigator.onLine) { setStatus('lang.offline.msg.failed'); return; }

  setStatus('');
  setState('lang.offline.btn.downloading', true);

  /* install() rejects with NotAllowedError if any await (e.g. available())
     runs before it and consumes the user gesture, so it MUST be the first
     awaited call. en-US is the SODA base model that gets pulled in alongside
     the target language anyway (see PRIMER_LANG), so we bundle it into this
     same call to front-load the download instead of awaiting a separate one. */
  const langs = (PRIMER_LANG && lang.id !== PRIMER_LANG)
    ? [PRIMER_LANG, lang.id]
    : [lang.id];

  /* Reuse the floor querySupport resolved (best installable); install() must
     stay the first awaited call, so we can't re-probe available() here. */
  const quality = _installQuality;

  let ok = false;
  try {
    if (isDebugEnabled()) console.debug('[language-pack] installing', { langs, quality });
    ok = await SR.install({ langs, processLocally: true, quality });
    if (isDebugEnabled()) console.debug('[language-pack] install resolved:', ok);
  } catch (err) {
    if (isDebugEnabled()) console.error('[language-pack] install failed:', err);
  }

  /* install() can resolve/throw before the download completes — confirm via
     available() and keep polling until the selected model is actually ready. */
  const installed = ok || await waitUntilInstalled(lang.id);
  if (installed) {
    setState('lang.offline.btn.ready', true);
    setInfo('lang.offline.info.installed');
    setStatus('lang.offline.msg.ready', true);
    /* Some recognition params (processLocally, continuous, …) are only applied
       on a fresh start, so stop now and prompt the user to press Start again. */
    stopSpeech();
  } else {
    await refreshButton(langId);
    setStatus('lang.offline.msg.failed');
  }
}

/**
 * Wire the offline-pack button. No-op on non-Chrome (caller hides the row).
 * @param {{ button: HTMLButtonElement, status: HTMLElement }} els
 */
export function setupLanguagePackButton({ button, status, info }) {
  if (!isChrome || !SR || typeof SR.install !== 'function') return;

  _button = button;
  _status = status;
  _info   = info ?? null;

  refreshButton(settings.sourceLangId);

  button.addEventListener('click', () => downloadPack(settings.sourceLangId));

  subscribe('sourceLangId', (id) => { setStatus(''); refreshButton(id); });
  /* Re-render the button label, status and info note in the new UI language
     without re-querying. */
  subscribe('uiLang', () => {
    if (_button) _button.textContent = t(_stateKey);
    if (_info)   _info.textContent   = _infoKey ? t(_infoKey) : '';
    renderStatus();
  });
}
