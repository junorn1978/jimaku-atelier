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

/* Edge's recogniser only accepts a 16kHz track; 48kHz mono yields nothing.
   (Measured in the hamham extension, 2026-09-27.) Chrome takes the native rate. */
const EDGE_SAMPLE_RATE = 16000;

/**
 * Opens the device and builds the graph.
 * @param {object} opts
 * @param {string}   [opts.deviceId]  '' / undefined → the system default
 * @param {Function} [opts.onPause]   what the recogniser hears went quiet
 * @param {Function} [opts.onSpeech]  …is speech (repeats while it is)
 * @param {Function} [opts.onGap]     a quiet stretch just ended, (ms) — diagnostics
 * @param {Function} [opts.onEnded]   the device went away
 * @returns {Promise<{ track: MediaStreamTrack, label: string, deviceId: string,
 *   fellBack: boolean, hold: Function, release: Function, close: Function }>}
 */
export async function openAudioInput({ deviceId = '', onPause, onSpeech, onGap, onEnded } = {}) {
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

  let stream;
  let fellBack = false;
  if (deviceId) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } } });
    } catch (err) {
      /* The chosen device is gone (unplugged, renamed). Fall back rather than
         refuse to start; the caller tells the user. Permission errors are not
         a missing device and go straight up. */
      if (err?.name !== 'OverconstrainedError' && err?.name !== 'NotFoundError') throw err;
      fellBack = true;
    }
  }
  if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: base });

  const source = stream.getAudioTracks()[0];
  const ctx = new AudioContext(isEdge ? { sampleRate: EDGE_SAMPLE_RATE } : undefined);
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    await ctx.audioWorklet.addModule(WORKLET_URL);
  } catch (err) {
    source.stop();
    ctx.close();
    throw err;
  }

  const node = new AudioWorkletNode(ctx, 'speech-input', { outputChannelCount: [1] });
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 1;
  ctx.createMediaStreamSource(stream).connect(node).connect(dest);

  node.port.onmessage = ({ data }) => {
    if (data.type === 'pause')  onPause?.();
    if (data.type === 'speech') onSpeech?.();
    if (data.type === 'gap')    onGap?.(data.ms);
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
