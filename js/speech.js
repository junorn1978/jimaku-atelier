/**
 * @file speech.js
 * @description Web Speech API facade. Recognises the configured source
 * language, updates the source subtitle, and forwards finalised chunks to
 * the translation controller.
 *
 * The module is intentionally provider-shaped — additional engines such as
 * Deepgram or Soniox would slot in beside the Web Speech adapter without
 * touching main.js. For now only Web Speech is wired.
 */

import { isDebugEnabled } from './logger.js';
import { settings, subscribe } from './store.js';
import { sendTranslationRequest, resetController } from './controller.js';
import { applyFilter } from './filter.js';
import { publishSource } from './obs.js';
import { decorateSource } from './source-decoration.js';
import { isChrome, isEdge } from './env.js';

/* ============ environment ============ */

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

/* ============ module state ============ */

let recognition  = null;
let isActive     = false;
let previousText = '';

/* ============ source display ============ */

let _sourceEl          = null;
let _lastSource        = '';
let _lastSourcePending = false;

function getSourceEl() {
  if (!_sourceEl) _sourceEl = document.getElementById('display-source');
  return _sourceEl;
}

/* The wrapping symbols flag "still being recognised / not yet sent". A pending
   (interim) line shows them; once the text is finalised and the translation is
   sent, we display it without symbols so the symbols read as a "sending" cue. */
function updateSource(text, pending = false) {
  const el = getSourceEl();
  if (!el || (text === _lastSource && pending === _lastSourcePending)) return;
  el.textContent = pending ? decorateSource(text) : text;
  _lastSource = text;
  _lastSourcePending = pending;
  keepSourceTailVisible(el);
  publishSource(text, pending);  /* raw — obs.js applies the symbols for the overlay */
}

/* Re-decorate the currently shown source line when the symbols change so the
   local preview updates live (the OBS overlay re-syncs via obs.js). */
function redecorateSource() {
  const el = getSourceEl();
  if (el && _lastSource) {
    el.textContent = _lastSourcePending ? decorateSource(_lastSource) : _lastSource;
    keepSourceTailVisible(el);
  }
}

function clearSource() {
  const el = getSourceEl();
  if (el) { el.textContent = ''; el.scrollTop = 0; }
  _lastSource = '';
  _lastSourcePending = false;
  publishSource('');
}

/* In single-line mode the source line is clipped to one line height; keep the
   newest line visible by scrolling to the bottom (no-op when not clipped). */
function keepSourceTailVisible(el) {
  if (el.scrollHeight > el.clientHeight) {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  } else {
    el.scrollTop = 0;
  }
}

/* ============ filter hook ============ */

function filterSource(text /*, lang */) {
  return applyFilter(text);
}

/* ============ Web Speech adapter ============ */

async function decideProcessLocally(lang) {
  /* Edge does not support on-device, but its continuous mode is stable —
     short-circuit to true so configureRecognition picks continuous=true.
     The actual processLocally property is only assigned on Chrome below. */
  if (isEdge) return true;
  if (!isChrome) return false;
  const ctor = window.SpeechRecognition;
  if (!ctor || typeof ctor.available !== 'function') return false;
  try {
    /* No quality → the default 'command' floor, i.e. the broadest match: use
       on-device whenever any installed model qualifies. (language-pack.js picks
       the best floor to *install*; this only asks whether anything is there.) */
    const status = await ctor.available({ langs: [lang], processLocally: true });
    return status === 'available';
  } catch {
    return false;
  }
}

async function configureRecognition(rec, lang) {
  const processLocally = await decideProcessLocally(lang);
  if (isChrome) rec.processLocally = processLocally;

  rec.interimResults  = true;
  rec.lang            = lang;
  rec.continuous      = processLocally;  /* on-device mode is stable in continuous */
  rec.maxAlternatives = 1;
  if ('phrases' in rec) rec.phrases = [];

  if (isDebugEnabled()) console.debug('[speech] configured', {
    lang, processLocally, continuous: rec.continuous,
  });
}

function setupRecognition() {
  if (!SpeechRecognitionImpl) return null;
  const rec = new SpeechRecognitionImpl();

  let silenceThreshold = 1000;
  let silenceTimer     = null;
  let finalTranscript  = '';
  let interimTranscript = '';

  /* Edge auto-restart is slow enough that forcing a break tends to drop
     words, so the silence guard is Chrome-only. */
  const resetSilenceTimer = () => {
    if (!isChrome) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (interimTranscript.trim()) {
        const text = filterSource(
          interimTranscript.replace(/[、。？\s]+/g, ' ').trim(),
          rec.lang
        );
        if (text) {
          sendTranslationRequest(text, previousText, rec.lang);
          previousText = text;
          updateSource(text);
        }
      }
      rec.abort();
    }, silenceThreshold);
  };

  rec.onsoundstart = () => {
    if (rec.continuous) {
      silenceThreshold = 2000;
      resetSilenceTimer();
    }
  };

  rec.onresult = (event) => {
    silenceThreshold = rec.continuous ? 10000 : 3000;
    if (interimTranscript.trim()) resetSilenceTimer();

    interimTranscript = '';
    finalTranscript   = '';
    let hasFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) { finalTranscript += t; hasFinal = true; }
      else                          { interimTranscript += t; }
    }

    if (hasFinal && finalTranscript.trim()) {
      const text = filterSource(
        finalTranscript.replace(/[、。？\s]+/g, ' ').trim(),
        rec.lang
      );
      if (text) {
        if (isDebugEnabled()) console.info('[speech] final →', text);
        sendTranslationRequest(text, previousText, rec.lang);
        previousText = text;
      }
    }

    const fullText = filterSource(
      `${finalTranscript} ${interimTranscript}`.replace(/[、。？\s]+/g, ' ').trim(),
      rec.lang
    );
    /* Interim text still pending → wrap with symbols; an all-final line has
       already been sent → show it bare. */
    if (fullText) updateSource(fullText, interimTranscript.trim().length > 0);
  };

  rec.onend = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    finalTranscript   = '';
    interimTranscript = '';
    autoRestart();
  };

  rec.onerror = (event) => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (event.error !== 'aborted' && isDebugEnabled()) {
      console.error('[speech] error:', event.error);
    }
  };

  return rec;
}

function autoRestart(options = { delay: 0 }) {
  if (!isActive) return;
  setTimeout(() => {
    try {
      recognition.start();
      options.delay = 0;
    } catch {
      /* start() throws while the previous instance is still tearing down.
         Bump delay linearly (200ms steps, 1000ms cap) and recurse — the
         outer setTimeout supplies the wait, so we don't double-stack timers. */
      if (options.delay < 1000) options.delay += 200;
      autoRestart(options);
    }
  }, options.delay);
}

/* ============ mic info ============ */

async function showDefaultMic() {
  const el = document.getElementById('default-mic-name');
  if (!el) return;
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    if (!audioInputs.length) return;
    const def = audioInputs.find(d => d.deviceId === 'default') || audioInputs[0];
    if (def?.label) el.textContent = def.label;
  } catch (err) {
    if (isDebugEnabled()) console.warn('[speech] enumerateDevices failed:', err);
  }
}

/* ============ buttons ============ */

function updateButtons() {
  const start = document.getElementById('btn-start');
  const stop  = document.getElementById('btn-stop');
  if (start) start.disabled = isActive || !settings.sourceLangId;
  if (stop)  stop.disabled  = !isActive;
}

/* ============ control flow ============ */

async function handleStart() {
  const lang = settings.sourceLangId;
  if (!lang || !recognition || isActive) return;

  previousText = '';
  clearSource();
  resetController();
  document.querySelector('.subtitle-display')?.classList.add('is-recording');

  /* Permission first — also lets us read the device label for the header. */
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    await showDefaultMic();
  } catch (err) {
    if (isDebugEnabled()) console.warn('[speech] mic permission denied:', err);
    return;
  }

  isActive = true;
  updateButtons();

  try {
    await configureRecognition(recognition, lang);
    recognition.start();
  } catch (err) {
    if (isDebugEnabled()) console.error('[speech] start failed:', err);
    isActive = false;
    updateButtons();
  }
}

function handleStop() {
  if (!isActive) return;
  isActive = false;
  if (recognition) recognition.abort();
  document.querySelector('.subtitle-display')?.classList.remove('is-recording');
  updateButtons();
}

/* ============ public API ============ */

export function initSpeech() {
  if (!SpeechRecognitionImpl) {
    if (isDebugEnabled()) console.warn('[speech] Web Speech API not available');
    return;
  }

  recognition = setupRecognition();
  if (!recognition) return;

  document.getElementById('btn-start')?.addEventListener('click', handleStart);
  document.getElementById('btn-stop') ?.addEventListener('click', handleStop);

  updateButtons();
  subscribe('sourceLangId', updateButtons);
  subscribe('subSourcePrefix', redecorateSource);
  subscribe('subSourceSuffix', redecorateSource);
}

export function stopSpeech() { handleStop(); }
