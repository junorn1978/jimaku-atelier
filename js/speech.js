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
import { keepTailVisible } from './subtitle-render.js';
import { openAudioInput } from './audio-input.js';

/* ============ environment ============ */

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

/* ============ module state ============ */

let recognition  = null;
let isActive     = false;
let previousText = '';

/* Which recogniser this run uses, decided per start: the on-device model or
   the cloud one. Both listen to our own audio track (input); what differs is
   how their sessions are run — see configureRecognition and the session
   rotation below. */
let usingLocal   = false;
/* Cloud only, from settings.segmentMode: the engine ends each utterance itself
   instead of us ending sessions at pauses. See configureRecognition. */
let engineSegments = false;
let input        = null;
let inputHooks   = null;   // { onPause, onSpeech }, from setupRecognition

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
     replay catches up with or diverges from it.
     On-device only: a cloud session starts every sentence from nothing, so a
     new one that happens to open with the last one's words would be held back
     for no reason. */
  if (usingLocal && pending && _lastSource && normForHold(_lastSource).startsWith(normForHold(text))) {
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
  keepTailVisible(el);
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
   local output updates live (the OBS overlay re-syncs via obs.js). */
function redecorateSource() {
  const el = getSourceEl();
  if (el && _lastSource) {
    el.textContent = _lastSourcePending ? decorateSource(_lastSource) : _lastSource;
    keepTailVisible(el);
  }
}

function clearSource() {
  const el = getSourceEl();
  if (el) { el.textContent = ''; el.scrollTop = 0; }
  _lastSource = '';
  _lastSourcePending = false;
  publishSource('');
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
   value: the setting is adjusted by watching the output, so it should take
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
  /* Continuous on both recognisers. The on-device model runs one session
     unbroken. The cloud one is continuous too, but never left running: a
     cloud session goes quiet on its own after a minute or two, so it is ended
     and restarted at the speaker's pauses (see session rotation below).
     It used to be per-utterance (continuous=false), handing the teardown to
     the engine's own endpointing. The engine ends a session mid-sentence on
     slower speech, and the words spoken before the next session is up were
     simply gone: on the same 3 minutes of an English stream, Chrome kept 852
     characters that way against 1311 with rotation at pauses.

     Per-utterance survives as the 'engine' segment mode, for loud background
     music. Our pause detector only sees level; the engine's endpointing tells
     speech from music. With BGM ~12dB under the voice (a stream whose music
     was mixed into the same input), per-utterance kept 476 characters against
     367 — and making our sessions shorter did not close that gap (370), so it
     is the mode, not the session length. The words lost at each engine-chosen
     end are now covered: audio is held from onaudioend to the next session. */
  engineSegments          = !processLocally && settings.segmentMode === 'engine';
  rec.continuous          = !engineSegments;
  rec.maxAlternatives     = 1;
  if ('phrases' in rec) rec.phrases = [];

  if (isDebugEnabled()) console.debug('[speech] configured', {
    lang, processLocally, continuous: rec.continuous, engineSegments,
  });
  return processLocally;
}

function setupRecognition() {
  if (!SpeechRecognitionImpl) return null;
  const rec = new SpeechRecognitionImpl();

  let silenceTimer     = null;
  let finalTranscript  = '';
  let interimTranscript = '';

  /* Set when we abort a session ourselves, having flushed what it had. A
     result can still arrive between abort() and onend; left in, it refills the
     interim and onend's flush sends the same line a second time (seen on a
     live stream). Results from a session we have ended are ignored. */
  let aborting = false;
  const abortSession = () => {
    aborting = true;
    rec.abort();
  };

  /* Sends the pending interim as if it were the sentence's final. Used wherever
     a session is ended on purpose: abort() discards whatever the recogniser had
     not finalised, so what is on screen is all that is left of it. */
  const flushInterim = () => {
    const raw = interimTranscript;
    interimTranscript = '';
    if (!raw.trim()) return;
    const text = filterSource(raw.replace(/[、。？\s]+/g, ' ').trim(), rec.lang);
    if (!text) return;
    if (isDebugEnabled()) console.info('[speech] flush →', text);
    sendTranslationRequest(text, previousText, rec.lang);
    previousText = text;
    updateSource(text);
    /* This flush is the sentence's final — it never reaches onresult, so arm
       here or the flushed line would stay on screen for good. */
    armIdleClear();
  };

  /* On-device only — this is the backstop for a session that never ends on its
     own. A cloud session is ended at the speaker's pauses (rotation below),
     which already covers everything this would. */
  const SILENCE_TIMEOUT = 10000;

  const resetSilenceTimer = () => {
    if (!usingLocal) return;
    if (silenceTimer) clearTimeout(silenceTimer);
    markSession(`silence armed ${SILENCE_TIMEOUT}ms`);
    silenceTimer = setTimeout(() => {
      markSession(`silence FIRED after ${SILENCE_TIMEOUT}ms interim="${interimTranscript}"`);
      flushInterim();
      abortSession();
    }, SILENCE_TIMEOUT);
  };

  /* ---- session rotation (cloud) ----

     A cloud session is ended and restarted by us, at the speaker's pauses as
     reported by audio-input.js, instead of by the engine. Two things were
     learned measuring this on stream audio (track-buffer-test, 2026-09-28):

     - Where a session ends is what loses words, not how long the restart takes.
       Cut mid-speech, 0.3–1s of the old session's tail is gone — audio the
       engine had received but not yet turned into an interim, which abort()
       throws away. That held with a 20ms restart just as with a 110ms one. Cut
       at a pause, nothing was lost.
     - When a cut mid-speech cannot be avoided, feeding the engine silence
       first lets it finish: interims kept changing for up to ~750ms (median
       ~300ms) after the audio stopped. Meanwhile the real audio is queued and
       replayed into the next session, so the silence costs latency, not words.

     Every cut holds the audio from just before abort() until the next session
     reports onaudiostart, so the ~20ms restart gap loses nothing either. The
     pauses themselves are detected on what the recogniser hears, not on the
     microphone (see audio-worklet.js): after a drain it runs behind the
     speaker, and a pause in the room is then mid-word to the recogniser.

     Parameters are the ones those tests ran with, except the drain settle,
     widened after a live stream showed interims 500ms apart. */
  const ROTATE_MIN_AGE_MS = 3000;    // at a pause, rotate once the session is this old
  /* Some speakers barely pause: on one live stream, 9 sessions in 5 minutes
     ran to the cap, with no 350ms pause but plenty of 100–250ms breaths
     between phrases. Past this age a 150ms breath is taken instead — six of
     those nine would have ended there — with a drain, since 150ms does not
     give the engine time to finish the way a full pause does. Speakers who do
     pause are unaffected: 90% of their sessions end before this. */
  const ROTATE_SHORT_AGE_MS = 10000;
  const ROTATE_CAP_MS     = 20000;   // no pause in sight: rotate anyway (with a drain)
  /* Talking, yet not a single result for this long: the session is dead (seen
     on Edge as a 7s session that returned nothing). Timed from onstart, so it
     has to cover the cloud's whole startup: on a 1h50m cloud run (2026-10-03,
     virtual cable) onstart → onsoundstart took 0.5–2s and onsoundstart → first
     result was under 1.5s in 99% of sessions — about 4.5s at the slow end.
     2000 was tried on that run and cut 25% of the sessions, nearly all of them
     before they had answered. Was 8000 (a healthy cloud session once took ~6s
     over music); 6000 keeps a margin over the 4.5s. */
  const STALL_MS          = 6000;
  const DRAIN_SETTLE_MS   = 500;     // drain ends once interims stop changing this long…
  const DRAIN_MAX_MS      = 1000;    // …or after this, whichever is first

  let sessionStartedAt = 0;
  let lastResultAt     = 0;
  let lastInterimAt    = 0;
  let finalDuringDrain = false;
  let rotating         = false;
  let lastLagSec       = 0;
  const LAG_LOG_SEC    = 0.2;
  let drainTimer       = null;

  const cancelDrain = () => {
    if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
  };

  const cutSession = () => {
    cancelDrain();
    markSession(`rotate cut interim="${interimTranscript}"`);
    flushInterim();
    abortSession();
  };

  const rotate = (reason) => {
    if (rotating || !isActive || usingLocal || engineSegments || !sessionStartedAt) return;
    rotating = true;
    const now = performance.now();
    markSession(`rotate (${reason}) age=${(now - sessionStartedAt).toFixed(0)}ms`);

    /* Held until the next session's onaudiostart, whatever the reason. A pause
       is already silence reaching the engine and a stall has nothing in flight,
       so those are cut at once; a breath or a cut mid-speech waits for the
       engine. */
    input?.hold();
    if (reason !== 'cap' && reason !== 'short') {
      cutSession();
      return;
    }
    finalDuringDrain = false;
    drainTimer = setInterval(() => {
      const t = performance.now();
      if (finalDuringDrain
          || t - Math.max(lastInterimAt, now) >= DRAIN_SETTLE_MS
          || t - now >= DRAIN_MAX_MS) cutSession();
    }, 20);
  };

  inputHooks = {
    onPause() {
      if (sessionStartedAt && performance.now() - sessionStartedAt >= ROTATE_MIN_AGE_MS) rotate('pause');
    },
    onShortPause() {
      if (sessionStartedAt && performance.now() - sessionStartedAt >= ROTATE_SHORT_AGE_MS) rotate('short');
    },
    onSpeech() {
      if (!sessionStartedAt) return;
      const now = performance.now();
      if (now - sessionStartedAt >= ROTATE_CAP_MS) rotate('cap');
      else if (now - lastResultAt >= STALL_MS)     rotate('stall');
    },
    /* The input was replaced mid-run: end this session so the next one starts
       on the new track. Between sessions there is nothing to do — the restart
       already in flight reads the new input. */
    restart() {
      if (!sessionStartedAt || rotating) return;
      rotating = true;
      markSession('rotate (input switched)');
      cutSession();
    },
    onDenoise(on, error) {
      markSession(on ? 'pause detector: denoised' : `pause detector: raw (denoiser failed: ${error})`);
    },
    onProbe({ atMs, outDb, judgedDb, speech, heldMs, lagMs, skippedMs, droppedMs }) {
      const db = (v) => (v < -100 ? '—' : v.toFixed(0));
      markSession(`fed @${atMs}ms: out ${db(outDb)}dB detector ${db(judgedDb)}dB ${speech ? 'speech' : 'quiet'}`
        + (heldMs ? ` held ${heldMs}ms` : '') + (lagMs ? ` lag ${lagMs}ms` : '')
        + (skippedMs ? ` skipped ${skippedMs}ms` : '') + (droppedMs ? ` dropped ${droppedMs}ms` : ''));
    },
    onGap(ms, queuedMs) {
      markSession(`gap ${ms}ms age=${sessionStartedAt ? (performance.now() - sessionStartedAt).toFixed(0) : '-'}ms queued=${queuedMs}ms`);
    },
    /* Only while there is something to see. Talking without a pause keeps the
       queue at the worklet's 0.15s target until the next quiet stretch, which
       would otherwise log every second; one line still marks the drop below. */
    onLag(sec, rate) {
      if (sec >= LAG_LOG_SEC || lastLagSec >= LAG_LOG_SEC) markSession(`lag ${sec.toFixed(2)}s${rate > 1 ? ` (catching up at ${rate}×)` : ''}`);
      lastLagSec = sec;
    },
  };

  rec.onstart = () => {
    markSession('onstart');
    sessionStartedAt = lastResultAt = performance.now();
  };
  /* The next session is listening: let any audio held during a drain through. */
  rec.onaudiostart = () => {
    markSession('onaudiostart');
    input?.release();
    if (isDebugEnabled()) input?.probe(PROBE_WINDOWS);
  };

  /* Diagnostic-only lifecycle handlers: no behaviour, just the timeline. */
  rec.onspeechstart = () => markSession('onspeechstart');
  rec.onspeechend   = () => markSession('onspeechend');
  rec.onsoundend    = () => markSession('onsoundend');
  /* Per-utterance: the engine has stopped taking audio for this session and
     will end it; hold what comes next until the following session is up
     (onaudiostart releases it). With the mic track that gap is ~60ms,
     up to ~140ms, and it falls right where the next utterance may begin. */
  rec.onaudioend = () => {
    markSession('onaudioend');
    if (engineSegments && isActive && !aborting) input?.hold();
  };
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

     On-device only. A cloud session can legitimately take seconds to return
     its first result, and a dead one is caught by the stall check above. */
  const STARTUP_TIMEOUT = 3000;
  let startupTimer = null;

  const clearStartupTimer = () => {
    if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  };

  rec.onsoundstart = () => {
    markSession('onsoundstart');
    if (!usingLocal || resultCount > 0) return;
    clearStartupTimer();
    markSession(`startup watchdog armed ${STARTUP_TIMEOUT}ms`);
    startupTimer = setTimeout(() => {
      markSession(`startup watchdog FIRED — no result in ${STARTUP_TIMEOUT}ms, restarting`);
      rec.abort();
    }, STARTUP_TIMEOUT);
  };

  rec.onresult = (event) => {
    if (aborting) return;
    resultCount++;
    /* Traced for the first few results only: what matters is how long the
       model takes to say anything at all after onsoundstart. */
    if (resultCount <= 3) markSession(`onresult #${resultCount}`);
    clearStartupTimer();
    lastResultAt = performance.now();

    const previousInterim = interimTranscript;
    interimTranscript = '';
    finalTranscript   = '';
    let hasFinal = false;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) { finalTranscript += t; hasFinal = true; }
      else                          { interimTranscript += t; }
    }
    if (interimTranscript !== previousInterim) lastInterimAt = lastResultAt;
    if (hasFinal) finalDuringDrain = true;

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
    cancelDrain();
    if (silenceTimer) clearTimeout(silenceTimer);
    /* A session can end with text still pending — the engine ended it (a
       network error, a no-speech timeout), not us. That interim is never going
       to become a final, and dropping it drops speech the user saw on screen;
       on 3 minutes of English stream this was 4 lines. Our own cuts have
       flushed already, and after the stop button nothing should be sent. */
    if (isActive) flushInterim();
    aborting          = false;
    sessionStartedAt  = 0;
    rotating          = false;
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

function startRecognition() {
  recognition.start(input.track);
}

/* What the recogniser is fed, logged through each session (debug only), to
   read against what it returned. It is how a session fed loud speech for
   seconds yet returning nothing was told apart from one fed silence — the
   cloud recogniser, not our audio (2026-10-03). Every 250ms over the start,
   where the first result's delay is decided; every second after. */
const PROBE_WINDOWS = { fineSec: 3, fineMs: 250, ms: 1000 };

function autoRestart(options = { delay: 0 }) {
  if (!isActive) return;
  setTimeout(() => {
    try {
      beginSession(`autoRestart delay=${options.delay}ms`);
      startRecognition();
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

  /* Opening the microphone doubles as the permission prompt (and is what lets
     the settings dialog list devices by name). Both recognisers are started on
     this track, from the device picked in settings — the on-device model hears
     it the same as the cloud one (checked in the hamham extension). */
  try {
    usingLocal = await configureRecognition(recognition, lang);
    input = await openInput();
  } catch (err) {
    if (isDebugEnabled()) console.warn('[speech] mic unavailable:', err);
    closeInput();
    document.querySelector('.subtitle-display')?.classList.remove('is-recording');
    return;
  }

  isActive = true;
  updateButtons();

  try {
    beginSession('handleStart');
    startRecognition();
  } catch (err) {
    if (isDebugEnabled()) console.error('[speech] start failed:', err);
    isActive = false;
    closeInput();
    updateButtons();
  }
}

function openInput() {
  return openAudioInput({
    deviceId: settings.micDeviceId,
    ...inputHooks,
    onEnded: handleInputEnded,
  }).then((opened) => {
    if (opened.fellBack) markSession(`picked mic missing, using default: ${opened.label}`);
    return opened;
  });
}

function closeInput() {
  input?.close();
  input = null;
}

/* Reopens the input from the current settings and moves recognition onto it.
   Returns false when no device could be opened. */
async function switchInput(reason) {
  if (!isActive) return true;
  markSession(`switching input (${reason})`);
  let next;
  try {
    next = await openInput();
  } catch (err) {
    if (isDebugEnabled()) console.warn('[speech] reopening mic failed:', err);
    return false;
  }
  if (!isActive) { next.close(); return true; }
  const old = input;
  input = next;
  old?.close();
  inputHooks.restart();
  return true;
}

/* Switching how sentences are split mid-run: continuous can only change
   between sessions, so end this one (sending what it has) and let the restart
   pick the new mode up. The on-device model is not affected. */
function onSegmentModeChanged() {
  if (!isActive || usingLocal) return;
  engineSegments = settings.segmentMode === 'engine';
  recognition.continuous = !engineSegments;
  markSession(`segment mode → ${settings.segmentMode}`);
  inputHooks.restart();
}

/* The device went away mid-run (unplugged, disabled). Carry on with whatever
   the settings now resolve to — the default device, if the picked one is the
   one that went — and stop only when there is no microphone left at all. */
async function handleInputEnded() {
  if (!(await switchInput('device ended'))) handleStop();
}

function handleStop() {
  if (!isActive) return;
  isActive = false;
  if (recognition) recognition.abort();
  closeInput();
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
  subscribe('micDeviceId', () => switchInput('picked in settings'));
  subscribe('segmentMode', onSegmentModeChanged);
  subscribe('subClearIdleSec', onClearIdleChanged);
  subscribe('subSourcePrefix', redecorateSource);
  subscribe('subSourceSuffix', redecorateSource);
}

export function stopSpeech() { handleStop(); }
