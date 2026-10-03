/**
 * @file audio-input.js
 * @description The microphone as a MediaStreamTrack the recogniser is started
 * on — recognition.start(track) instead of letting it open the default device
 * itself. Owning the audio is what makes three things possible:
 *
 *  - choosing the device;
 *  - knowing when the speaker pauses, independently of the recogniser, so a
 *    session can be ended where ending it loses nothing (see speech.js);
 *  - holding the audio back for a moment and replaying it, so the recogniser
 *    can finish what it already heard before its session is torn down.
 *
 * Measured on stream audio through a virtual cable (track-buffer-test,
 * 2026-09-28): a session restarted on a live track is listening again ~20ms
 * after abort(), against ~110ms when the recogniser opens the mic itself.
 *
 * Browser-side processing (echo cancellation, noise suppression, auto gain) is
 * off: the recogniser has its own front end and did no worse on the raw signal.
 */

import { isEdge } from './env.js';

const WORKLET_URL = new URL('./audio-worklet.js', import.meta.url);

/* The pause detector's thresholds (see audio-worklet.js): quiet is below
   PAUSE_DROP_DB under the speech level, and never above PAUSE_GATE_DB.
   Exported for the level test, which has to judge by the same numbers or its
   verdict would not describe what recognition actually does. */
export const PAUSE_GATE_DB = -50;
export const PAUSE_DROP_DB = 12;

const PROCESSING_OFF = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

/* The picked device, or the default one when it is gone (fellBack). Permission
   errors are not a missing device and go straight up. */
async function openStream(deviceId) {
  if (deviceId) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: { ...PROCESSING_OFF, deviceId: { exact: deviceId } } }), fellBack: false };
    } catch (err) {
      if (err?.name !== 'OverconstrainedError' && err?.name !== 'NotFoundError') throw err;
    }
  }
  return { stream: await navigator.mediaDevices.getUserMedia({ audio: PROCESSING_OFF }), fellBack: !!deviceId };
}

/* Edge's recogniser only accepts a 16kHz track; 48kHz mono yields nothing.
   (Measured in the hamham extension, 2026-09-27.) Chrome takes the native rate. */
const EDGE_SAMPLE_RATE = 16000;

/* The pause detector's denoiser (see audio-worklet.js). Fetched once and
   handed to each worklet as bytes; without it the detector reads the raw
   level. localStorage 'rtl-pause-denoise' = 'false' turns it off, for
   comparing the two on the same input. */
const RNNOISE_URL = new URL('./vendor/rnnoise.wasm', import.meta.url);
const DENOISE_KEY = 'rtl-pause-denoise';
let rnnoiseBytes = null;

function loadRnnoise() {
  try { if (localStorage.getItem(DENOISE_KEY) === 'false') return Promise.resolve(null); }
  catch { /* storage blocked: keep the default */ }
  rnnoiseBytes ??= fetch(RNNOISE_URL)
    .then(r => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null)
    .then((bytes) => { if (!bytes) rnnoiseBytes = null; return bytes; });   // a failure is retried next time
  return rnnoiseBytes;
}

/* The microphone through the worklet into a track of its own. On failure the
   context is closed; the caller stops the microphone. */
async function buildGraph(stream, { reportLevel = false } = {}) {
  const ctx = new AudioContext(isEdge ? { sampleRate: EDGE_SAMPLE_RATE } : undefined);
  let rnnoise;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    [rnnoise] = await Promise.all([loadRnnoise(), ctx.audioWorklet.addModule(WORKLET_URL)]);
  } catch (err) {
    ctx.close();
    throw err;
  }

  const node = new AudioWorkletNode(ctx, 'speech-input', {
    outputChannelCount: [1],
    processorOptions: { gateDb: PAUSE_GATE_DB, dropDb: PAUSE_DROP_DB, rnnoise, reportLevel },
  });
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 1;
  ctx.createMediaStreamSource(stream).connect(node).connect(dest);
  return { ctx, node, dest };
}

/**
 * Opens the device and builds the graph.
 * @param {object} opts
 * @param {string}   [opts.deviceId]  '' / undefined → the system default
 * @param {Function} [opts.onPause]   what the recogniser hears went quiet
 * @param {Function} [opts.onShortPause] …went quiet briefly (150ms, a breath)
 * @param {Function} [opts.onSpeech]  …is speech (repeats while it is)
 * @param {Function} [opts.onGap]     a quiet stretch just ended, (ms, queuedMs) — diagnostics
 * @param {Function} [opts.onLag]     how far behind the recogniser is, (sec, rate) — diagnostics;
 *   every second while audio is queued, and once with 0 when caught up
 * @param {Function} [opts.onDenoise] whether the pause detector is denoising, (on, error) — diagnostics
 * @param {Function} [opts.onProbe]   one window of a probe (see probe below) — diagnostics
 * @param {Function} [opts.onEnded]   the device went away
 * @returns {Promise<{ track: MediaStreamTrack, label: string, deviceId: string,
 *   fellBack: boolean, hold: Function, release: Function, probe: Function, close: Function }>}
 */
export async function openAudioInput({ deviceId = '', onPause, onShortPause, onSpeech, onGap, onLag, onDenoise, onProbe, onEnded } = {}) {
  /* A device that is gone (unplugged, renamed) falls back rather than refusing
     to start; the settings dialog shows it as not connected. */
  const { stream, fellBack } = await openStream(deviceId);

  const source = stream.getAudioTracks()[0];
  let graph;
  try {
    graph = await buildGraph(stream);
  } catch (err) {
    source.stop();
    throw err;
  }
  const { ctx, node, dest } = graph;

  node.port.onmessage = ({ data }) => {
    if (data.type === 'denoise') onDenoise?.(data.on, data.error);
    if (data.type === 'pause')  onPause?.();
    if (data.type === 'shortPause') onShortPause?.();
    if (data.type === 'speech') onSpeech?.();
    if (data.type === 'gap')    onGap?.(data.ms, data.queuedMs);
    if (data.type === 'lag')    onLag?.(data.sec, data.rate);
    if (data.type === 'probe')  onProbe?.(data);
  };

  let closed = false;
  source.addEventListener('ended', () => { if (!closed) onEnded?.(); });

  return {
    track:    dest.stream.getAudioTracks()[0],
    label:    source.label,
    deviceId: source.getSettings().deviceId || '',
    fellBack,
    hold:     () => node.port.postMessage('hold'),
    release:  () => node.port.postMessage('release'),
    /* Reports what the recogniser is fed from now on, in windows of fineMs
       for the first fineSec and of ms after; a new probe replaces the last. */
    probe:    (windows) => node.port.postMessage({ probe: windows }),
    close() {
      if (closed) return;
      closed = true;
      node.port.onmessage = null;
      source.stop();
      dest.stream.getTracks().forEach(t => t.stop());
      ctx.close();
    },
  };
}

/**
 * A level meter on the picked device, for the level test in settings. The same
 * graph as recognition, so it reads the level the pause detector goes by —
 * denoised when that is on. Its track goes nowhere.
 * @returns {Promise<{ read: () => number, readRaw: () => number, denoised: () => boolean,
 *   label: string, fellBack: boolean, close: Function }>}
 *   read() is the detector's level in dBFS, readRaw() the microphone's, both
 *   smoothed over ~50ms.
 */
export async function openLevelMeter(deviceId = '') {
  const { stream, fellBack } = await openStream(deviceId);
  const source = stream.getAudioTracks()[0];
  let graph;
  try {
    graph = await buildGraph(stream, { reportLevel: true });
  } catch (err) {
    source.stop();
    throw err;
  }
  const { ctx, node, dest } = graph;

  const toDb = (meanSquare) => 10 * Math.log10(meanSquare + 1e-12);
  let raw = 0, judged = 0, denoised = false;
  node.port.onmessage = ({ data }) => {
    if (data.type === 'level')   ({ raw, judged } = data);
    if (data.type === 'denoise') denoised = data.on;
  };

  return {
    label: source.label,
    fellBack,
    read:     () => toDb(judged),
    readRaw:  () => toDb(raw),
    denoised: () => denoised,
    close() {
      node.port.onmessage = null;
      source.stop();
      dest.stream.getTracks().forEach(t => t.stop());
      ctx.close();
    },
  };
}
