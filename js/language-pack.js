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

/* en-US is SODA's base model: installing any on-device language pack also pulls
   en-US as a dependency, and recognition can't be used until en-US has finished
   downloading too. So listing en-US here doesn't change the outcome — it just
   downloads it up front in the same install() call rather than letting it
   arrive implicitly. Kept explicit so the intent is visible and the wait is
   front-loaded. Set to null to drop the explicit entry (en-US will still be
   fetched alongside the target language).

   Confirmed on Chrome 151 (2026-08-24); first observed on 149. Re-verify on
   future Chrome versions in case the implicit dependency changes. */
const PRIMER_LANG = 'en-US';

/* install() can resolve before the download actually finishes, so we poll
   available() until the model reports ready (or we give up). */
const INSTALL_POLL_INTERVAL_MS = 1500;
const INSTALL_POLL_TIMEOUT_MS  = 60000;

/* No `quality` in available()/install(): both use the default 'command'
   model. Probing 'dictation' first, as this file used to, is withheld
   (2026-10-03) until it ships for real (expected Chrome 157+): on 156 quality
   is an exact match, not the spec's meets-or-exceeds — a 'dictation' pack
   does not satisfy a 'command' request and vice versa — and whether
   'dictation' is offered at all varied from one profile to the next.
   speech.js asks available() without quality too, so the two stay on the same
   model. */

/* TEMPORARILY WITHHELD — re-test before enabling; do not read this as
   "unsupported". Chinese (Mandarin) on-device recognition is held back from
   the pack button and runs on the cloud recogniser instead. zh-CN and zh-HK
   were added on 2026-10-07 by analogy with zh-TW, without a separate install
   test of their own.

   Why it is held: no usable Chinese (SODA) model. Verified twice for zh-TW —
   2026-06-18 on Chrome 149 and again 2026-08-24: install() resolves true, but
   available() answers 'downloadable' forever for zh-TW / cmn-Hant-TW /
   zh-Hant-TW and never flips to 'available' (plain 'zh' answers
   'unavailable', 'dictation' quality is 'unavailable' throughout). en-US
   behaves correctly in the same session, so the on-device machinery is fine —
   the model simply isn't there. It is not a language-code mismatch; every
   code behaves identically. Earlier on-device tests also showed poor Chinese
   accuracy, and the on-device models are still changing heavily, so this may
   well change too.

   To re-test, remove the id from this set and watch the debug log: if the
   pack installs but the next session still reports processLocally:false,
   nothing has changed. When it does become 'available', note that rec.lang
   may then need separating from the translation langId so a code like
   cmn-Hant-TW never reaches getLang().

   Cantonese (yue-Hant-HK) is not listed: available() itself answers
   'unavailable' for it (2026-10-07), so it is cloud-only by the API's own
   account. */
const ON_DEVICE_WITHHELD = new Set(['zh-TW', 'zh-CN', 'zh-HK']);

/**
 * True when the language can only ever be recognised in the cloud: withheld
 * above, or reported 'unavailable' on-device. A pack that is merely not yet
 * downloaded is not cloud-only. False when the browser cannot answer (no
 * available(), non-Chrome), so nothing is flagged on guesswork.
 * @param {string} langId
 */
export async function isCloudOnly(langId) {
  if (!isChrome || !SR || typeof SR.available !== 'function') return false;
  if (ON_DEVICE_WITHHELD.has(langId)) return true;
  const lang = getLang(langId);
  if (!lang) return false;
  try {
    return await SR.available({ langs: [lang.id], processLocally: true }) === 'unavailable';
  } catch {
    return false;
  }
}

let _button   = null;
let _status   = null;
let _info      = null;
let _help        = null;   /* button that opens the removal-instructions popover */
let _helpPopover = null;
let _stateKey = 'lang.offline.btn';   /* i18n key of the current button label */
let _infoKey  = '';                   /* i18n key of the persistent info note */

async function querySupport(langId) {
  const lang = getLang(langId);
  if (!lang || !SR || typeof SR.available !== 'function') {
    return { supported: false, downloadable: false, downloading: false };
  }
  try {
    const status = await SR.available({ langs: [lang.id], processLocally: true });
    if (isDebugEnabled()) console.debug('[language-pack] available:', { id: lang.id, status });
    return {
      supported:    status === 'available',
      downloadable: status === 'downloadable',
      downloading:  status === 'downloading',
    };
  } catch (err) {
    if (isDebugEnabled()) console.error('[language-pack] available() failed:', err);
    return { supported: false, downloadable: false, downloading: false };
  }
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

/* A success message is a one-off nudge ("press Start again") and takes itself
   away. Failures stay until dismissed — the user has to know a retry is needed.

   The element is a popover (see the markup note in ui-languages.js): the pack
   section has no room under it, so this has to live in the top layer or it is
   simply invisible. */
const STATUS_CLEAR_MS = 6000;

let _statusKey   = '';
let _statusTimer = null;

function renderStatus() {
  if (_status) _status.textContent = _statusKey ? t(_statusKey) : '';
}

/* Both calls throw when the popover is already in the state being asked for,
   so each is guarded on what is actually on screen. */
function showStatus() {
  if (_status?.showPopover && !_status.matches(':popover-open')) _status.showPopover();
}

function hideStatus() {
  if (_status?.hidePopover && _status.matches(':popover-open')) _status.hidePopover();
}

function setStatus(key, { autoClear = false, error = false } = {}) {
  _statusKey = key || '';
  if (_statusTimer) { clearTimeout(_statusTimer); _statusTimer = null; }

  if (!_statusKey) {
    /* Text is left in place on the way out: clearing it first would empty the
       bubble for the length of the fade. renderStatus() catches up the next
       time it runs. */
    hideStatus();
    return;
  }

  _status?.classList.toggle('is-error', error);
  /* Shown before the text is written, so the live region is already in the
     accessibility tree when its content changes and the message is announced. */
  showStatus();
  renderStatus();

  if (autoClear) {
    _statusTimer = setTimeout(() => { _statusTimer = null; setStatus(''); }, STATUS_CLEAR_MS);
  }
}

/* Removal instructions, shown in a popover rather than as standing text. The
   note only applies once a pack is installed, so the trigger button appears
   with it and hides again when there is nothing to explain — no permanent
   paragraph competing for the panel's height. */
function setInfo(key) {
  _infoKey = key;
  if (_info) _info.textContent = key ? t(key) : '';
  if (_help) {
    _help.hidden = !key;
    /* A hidden trigger leaves its popover orphaned on screen. */
    if (!key) _helpPopover?.hidePopover?.();
  }
}

async function refreshButton(langId) {
  const lang = getLang(langId);
  if (!lang) {
    setInfo('');
    return setState('lang.offline.btn.unsupported', true);
  }

  /* Chinese is withheld for now (see ON_DEVICE_WITHHELD) — this is a
     temporary hold, not a finding that Chinese can never run on-device. */
  if (ON_DEVICE_WITHHELD.has(lang.id)) {
    setInfo('');
    return setState('lang.offline.btn.unavailable', true);
  }

  const s = await querySupport(langId);
  if (s.supported)         setState('lang.offline.btn.ready', true);
  else if (s.downloadable) setState('lang.offline.btn', false);
  else if (s.downloading)  setState('lang.offline.btn.downloading', true);
  else                     setState('lang.offline.btn.unsupported', true);

  /* The only note worth keeping: how to remove an installed pack, since that
     lives in the browser's settings and isn't discoverable from here. Anything
     describing what a pack is good for went stale as the on-device models were
     revised — the button's own label carries the state instead. */
  setInfo(s.supported ? 'lang.offline.info.installed' : '');
}

async function downloadPack(langId) {
  const lang = getLang(langId);
  if (!lang) return;

  if (!navigator.onLine) { setStatus('lang.offline.msg.failed', { error: true }); return; }

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

  let ok = false;
  try {
    if (isDebugEnabled()) console.debug('[language-pack] installing', { langs });
    ok = await SR.install({ langs, processLocally: true });
    if (isDebugEnabled()) console.debug('[language-pack] install resolved:', ok);
  } catch (err) {
    if (isDebugEnabled()) console.error('[language-pack] install failed:', err);
  }

  /* available() is the only trustworthy signal. install() resolving true means
     the request was accepted, NOT that the model is usable: for a language
     Chrome has no model for it resolves true and available() still answers
     'downloadable' forever (see the note on ON_DEVICE_WITHHELD). Trusting `ok`
     here reported "installed" for a pack that recognition then refused to use
     with processLocally, so the button lied until the next reload. Always poll —
     a genuine install satisfies the first probe and returns immediately. */
  const installed = await waitUntilInstalled(lang.id);
  if (isDebugEnabled() && ok && !installed) {
    console.warn('[language-pack] install() resolved true but the model never became available:', lang.id);
  }
  if (installed) {
    setState('lang.offline.btn.ready', true);
    setInfo('lang.offline.info.installed');
    setStatus('lang.offline.msg.ready', { autoClear: true });
    /* Some recognition params (processLocally, continuous, …) are only applied
       on a fresh start, so stop now and prompt the user to press Start again. */
    stopSpeech();
  } else {
    await refreshButton(langId);
    setStatus('lang.offline.msg.failed', { error: true });
  }
}

/**
 * Wire the offline-pack button. No-op on non-Chrome (caller hides the row).
 * @param {{ button: HTMLButtonElement, status: HTMLElement }} els
 */
export function setupLanguagePackButton({ button, status, info, help }) {
  if (!isChrome || !SR || typeof SR.install !== 'function') return;

  _button = button;
  _status = status;
  _info   = info ?? null;
  _help   = help ?? null;
  _helpPopover = _help?.popoverTargetElement
    ?? (_help ? document.getElementById(_help.getAttribute('popovertarget')) : null);

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
