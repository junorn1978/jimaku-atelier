/**
 * @file speech.js
 * @description Web Speech API facade. Recognises the configured source
 * language, updates the source subtitle, and forwards finalised chunks to
 * the translation controller.
 *
 * This is a Web Speech implementation, not a provider-agnostic one — do not
 * read the layering as an adapter boundary, because there isn't one. The
 * recogniser is constructed directly here, and the display logic is shaped
 * around what Chrome's on-device (SODA) model actually does: the prefix hold in
 * updateSource(), the rule that a final is never rendered, and the startup
 * watchdog all encode its observed behaviour rather than anything general.
 *
 * Adding a second engine therefore means extracting that boundary first —
 * roughly { start, stop, onPartial, onFinal }, with the filter, idle clear and
 * source-display logic staying above it. Budget for that refactor; nothing here
 * is a drop-in replacement point today.
 */

import { isDebugEnabled } from './logger.js';
import { settings, subscribe } from './store.js';
import { sendTranslationRequest, resetController, clearTargets } from './controller.js';
import { applyFilter } from './filter.js';
import { publishSource } from './obs.js';
import { decorateSource } from './source-decoration.js';
import { normalizeRecognised } from './normalize-ja.js';
import { isChrome } from './env.js';

/* ============ environment ============ */

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

/* ============ module state ============ */

let recognition  = null;
let isActive     = false;
let previousText = '';

/* ============ session timing trace ============ */

/* Diagnostic only — every call below is a no-op unless debug logging is on.
   Recognition lifecycle events are reported relative to the moment start() was
   called, so one session reads as a single timeline.

   It was added to time the on-device model's first result, and that question is
   settled: a healthy model delivers it ~1ms after onsoundstart, which is the
   figure the startup watchdog below is calibrated against.

   What it is still here for: when the model dies mid-session, does it emit
   *any* event at all? If nothing fires, onend never runs and autoRestart never
   gets a chance. Unanswered — the failure has not been caught in a trace yet. */
let sessionStart = 0;
let resultCount  = 0;

function markSession(label) {
  if (!isDebugEnabled()) return;
  const dt = sessionStart ? (performance.now() - sessionStart).toFixed(0) : '?';
  console.debug(`[speech] t+${dt}ms ${label}`);
}

function beginSession(reason) {
  sessionStart = performance.now();
  resultCount  = 0;
  if (isDebugEnabled()) console.debug(`[speech] ==== session start (${reason}) ====`);
}

/* ============ source display ============ */

let _sourceEl          = null;
let _lastSource        = '';
let _lastSourcePending = false;

function getSourceEl() {
  if (!_sourceEl) _sourceEl = document.getElementById('display-source');
  return _sourceEl;
}

/* The wrapping symbols flag "still being recognised / not yet sent". A pending
   (interim) line shows them; once the sentence is finalised and the translation
   is sent, the symbols are stripped so they read as a "sending" cue. */
function updateSource(text, pending = false) {
  const el = getSourceEl();
  if (!el || (text === _lastSource && pending === _lastSourcePending)) return;

  /* Prefix hold: after a final (which is never rendered — see onresult), the
     on-device model replays the in-progress sentence from its first word in
     the next result slot. While a pending update is only a shorter prefix of
     what's already on screen, keep the longer text — the display then only
     moves forward within a sentence, and resumes updating as soon as the
     replay catches up with or diverges from it. */
  if (pending && _lastSource && normForHold(_lastSource).startsWith(normForHold(text))) {
    return;
  }

  /* Trace of the moment the source line is actually rendered — the counterpart
     to the onresult trace below, for diagnosing display timing (e.g. an interim
     flashing back after a final). */
  if (isDebugEnabled()) console.debug(
    `[speech] render @${performance.now().toFixed(0)}ms pending=${pending} text="${text}"`
  );
  el.textContent = pending ? decorateSource(text) : text;
  _lastSource = text;
  _lastSourcePending = pending;
  keepSourceTailVisible(el);
  publishSource(text, pending);  /* raw — obs.js applies the symbols for the overlay */
}

/* Case/whitespace-insensitive comparison basis for the prefix hold above. */
function normForHold(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/* A sentence was finalised (translation sent): mark the line on screen as sent
   by re-rendering it without the wrapping symbols. The final text itself is
   never displayed — see the note in onresult. */
function markSourceSent() {
  if (_lastSource && _lastSourcePending) updateSource(_lastSource, false);
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

/* ============ idle clear ============ */

/* A finalised sentence is the last thing that will ever be drawn for it, so
   without this the line just sits there — through a break, on stream, in the
   OBS overlay — until somebody speaks again. Once a sentence has been sent and
   nothing new is recognised for a while, wipe every line.

   Timing starts at the final, not at any recognition event. An interim that
   never finalises is still going to be flushed by the silence guard below, and
   that flush redraws the source line; clearing on interims would blank the
   display only for the same text to reappear a few seconds later. Waiting for
   the final means there is nothing left in flight to come back.

   Deliberately not co-ordinated with translation latency: a translation slower
   than this window is late whatever the display does, and holding the subtitles
   open for it would only hide the fact. */
let idleClearTimer = null;

function cancelIdleClear() {
  if (idleClearTimer) { clearTimeout(idleClearTimer); idleClearTimer = null; }
}

function armIdleClear() {
  cancelIdleClear();
  const seconds = Number(settings.subClearIdleSec);
  if (!Number.isFinite(seconds) || seconds <= 0) return;  /* 0 = keep the last line */
  markSession(`idle clear armed ${seconds}s`);
  idleClearTimer = setTimeout(() => {
    idleClearTimer = null;
    markSession('idle clear FIRED');
    clearAllSubtitles();
  }, seconds * 1000);
}

/* Every subtitle line at once — the source here, the targets in the controller.
   previousText goes with them: after a gap this long the next sentence is a new
   topic, and carrying the old line over as translation context misleads more
   than it helps. */
function clearAllSubtitles() {
  cancelIdleClear();
  clearSource();
  clearTargets();
  previousText = '';
}

/* Re-arming on change rather than letting a pending timer run out on the old
   value: the setting is adjusted by watching the preview, so it should take
   effect on the line currently on screen. */
function onClearIdleChanged() {
  if (idleClearTimer) armIdleClear();
}

/* ============ filter hook ============ */

function filterSource(text, lang) {
  return applyFilter(normalizeRecognised(text, lang));
}

/* ============ Web Speech adapter ============ */

async function decideProcessLocally(lang) {
  /* On-device is Chrome-only; everything else, Edge included, is a cloud
     recogniser. The answer doubles as the continuous switch below, and the
     processLocally property itself is only assigned on Chrome. */
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

  rec.unspokenPunctuation = true;
  rec.interimResults      = true;
  rec.lang                = lang;
  /* Continuous only where there is no connection to lose. A cloud recogniser's
     socket dies on its own after roughly a minute — on Edge as a `network`
     error raised seconds after it had already stopped returning results, so
     the speech in between is gone with no event to react to. Per-utterance
     sessions hand the teardown back to the engine's own endpointing instead:
     it closes at a pause it has just detected, and the restart costs ~200ms of
     audio inside that same pause. The on-device model has no socket to lose
     and runs the session unbroken. */
  rec.continuous          = processLocally;
  rec.maxAlternatives     = 1;
  if ('phrases' in rec) rec.phrases = [];

  if (isDebugEnabled()) console.debug('[speech] configured', {
    lang, processLocally, continuous: rec.continuous,
  });
}

function setupRecognition() {
  if (!SpeechRecognitionImpl) return null;
  const rec = new SpeechRecognitionImpl();

  let silenceTimer     = null;
  let finalTranscript  = '';
  let interimTranscript = '';

  /* Continuous sessions only — this is the backstop for a session that never
     ends on its own. A per-utterance session already closes at the engine's own
     endpoint, so a second guard here would only race it, and that holds equally
     for Edge and for Chrome on a cloud recogniser: both run per-utterance now.
     The test used to read isChrome, from when Chrome was always continuous;
     rec.continuous is the condition it was actually describing. */
  const SILENCE_TIMEOUT = 10000;

  const resetSilenceTimer = () => {
    if (!rec.continuous) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    markSession(`silence armed ${SILENCE_TIMEOUT}ms`);
    silenceTimer = setTimeout(() => {
      markSession(`silence FIRED after ${SILENCE_TIMEOUT}ms interim="${interimTranscript}"`);
      if (interimTranscript.trim()) {
        const text = filterSource(
          interimTranscript.replace(/[、。？\s]+/g, ' ').trim(),
          rec.lang
        );
        if (text) {
          sendTranslationRequest(text, previousText, rec.lang);
          previousText = text;
          updateSource(text);
          /* This flush is the sentence's final — it never reaches onresult, so
             arm here or the flushed line would stay on screen for good. */
          armIdleClear();
        }
      }
      rec.abort();
    }, SILENCE_TIMEOUT);
  };

  /* Diagnostic-only lifecycle handlers: no behaviour, just the timeline. */
  rec.onstart       = () => markSession('onstart');
  rec.onaudiostart  = () => markSession('onaudiostart');
  rec.onspeechstart = () => markSession('onspeechstart');
  rec.onspeechend   = () => markSession('onspeechend');
  rec.onsoundend    = () => markSession('onsoundend');
  rec.onaudioend    = () => markSession('onaudioend');
  rec.onnomatch     = () => markSession('onnomatch');

  /* Startup watchdog. Sound is reaching the recogniser but nothing has come
     back yet, so restart and hope the next session comes up healthy.

     This is not a "the model might be slow" grace period: a healthy on-device
     model delivers its first result ~1ms after onsoundstart. It exists because
     the session right after an install() is reliably dead — available() reports
     ready, the first session then produces nothing at all, and the restart this
     fires is what gets recognition going. So the window wants to be short: the
     margin over a healthy model is already enormous, and every extra second is
     dead air the user sits through after installing a pack.

     A model that stays silent across restarts is not recoverable from here —
     that one needs the pack deleted and reinstalled (with Chrome's processes
     killed first, or the files are locked). Firing aborts silently: with no
     result yet there is nothing to flush, and flushing a fragment would send
     half a word off to be translated.

     Continuous implies an on-device model, which implies Chrome (see
     decideProcessLocally), so rec.continuous alone gates this. */
  const STARTUP_TIMEOUT = 3000;
  let startupTimer = null;

  const clearStartupTimer = () => {
    if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  };

  rec.onsoundstart = () => {
    markSession('onsoundstart');
    if (!rec.continuous || resultCount > 0) return;
    clearStartupTimer();
    markSession(`startup watchdog armed ${STARTUP_TIMEOUT}ms`);
    startupTimer = setTimeout(() => {
      markSession(`startup watchdog FIRED — no result in ${STARTUP_TIMEOUT}ms, restarting`);
      rec.abort();
    }, STARTUP_TIMEOUT);
  };

  rec.onresult = (event) => {
    resultCount++;
    /* Traced for the first few results only: what matters is how long the
       model takes to say anything at all after onsoundstart. */
    if (resultCount <= 3) markSession(`onresult #${resultCount}`);
    clearStartupTimer();

    interimTranscript = '';
    finalTranscript   = '';
    let hasFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) { finalTranscript += t; hasFinal = true; }
      else                          { interimTranscript += t; }
    }

    /* Armed off the interim this event actually carried — reading it before the
       parse loop above meant the previous round's leftover value decided it,
       so nothing was armed until the second result of a session. */
    if (interimTranscript.trim()) resetSilenceTimer();

    /* Trace of every recognition event as it arrives, before any filtering. */
    if (isDebugEnabled()) console.debug(
      `[speech] event #${resultCount} t+${(performance.now() - sessionStart).toFixed(0)}ms ` +
      `resultIndex=${event.resultIndex} results=${event.results.length} hasFinal=${hasFinal} ` +
      `interim="${interimTranscript}" final="${finalTranscript}"`
    );

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

    /* The final text itself is never rendered. The new on-device model can
       deliver a final long after the *next* sentence's interims started
       flowing, so rendering it would briefly stomp the live line and make the
       text jump. The source line is interim-driven only; a final just strips
       the pending symbols off whatever is on screen ("sent" cue). */
    const interimText = filterSource(
      interimTranscript.replace(/[、。？\s]+/g, ' ').trim(),
      rec.lang
    );
    if (interimText)   updateSource(interimText, true);
    else if (hasFinal) markSourceSent();

    /* Interim first. One event can carry both a final (the sentence just
       closed) and an interim (the next one already flowing), and speech in
       progress always wins — testing hasFinal first would arm a countdown the
       same event has already contradicted. Read off the raw transcript, not the
       filtered text: a blacklisted word blanks the display but the speaker is
       still talking. */
    if (interimTranscript.trim()) cancelIdleClear();
    else if (hasFinal)            armIdleClear();
  };

  rec.onend = () => {
    markSession('onend');
    clearStartupTimer();
    if (silenceTimer) clearTimeout(silenceTimer);
    finalTranscript   = '';
    interimTranscript = '';
    autoRestart();
  };

  rec.onerror = (event) => {
    markSession(`onerror ${event.error}`);
    clearStartupTimer();
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
      beginSession(`autoRestart delay=${options.delay}ms`);
      recognition.start();
      options.delay = 0;
    } catch {
      markSession('start() threw — previous instance still tearing down');
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
  cancelIdleClear();
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
    beginSession('handleStart');
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
  /* Stop means "taking a break", so the display goes with it rather than
     freezing the last line on screen (and in the overlay) for the duration. */
  clearAllSubtitles();
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
  subscribe('subClearIdleSec', onClearIdleChanged);
  subscribe('subSourcePrefix', redecorateSource);
  subscribe('subSourceSuffix', redecorateSource);
}

export function stopSpeech() { handleStop(); }
