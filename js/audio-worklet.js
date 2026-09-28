/**
 * @file audio-worklet.js
 * @description Audio-thread half of audio-input.js. Passes the microphone
 * through to the recogniser's track, and on the way:
 *
 *  - detects pauses, so speech.js can end a session where nobody is talking;
 *  - can hold the output (silence to the recogniser, real audio queued) and
 *    later release the queue, catching up by dropping quiet blocks.
 *
 * Runs per 128-frame block on the audio thread, so none of it depends on
 * main-thread timers.
 */

/* Pause detection (ported from the hamham extension, tuned there on stream
   audio with background music): a pause is the level staying pauseMs below
   whichever is higher — a fixed gate, or dropDb under the recent speech level.
   The speech level follows speech with a time constant, not a per-block
   factor: a per-block factor sinks it to the music's level within ~0.1s, and
   then nothing is ever 12dB below it. */
const GATE_DB        = -50;
const DROP_DB        = 12;
const PAUSE_SEC      = 0.35;
const LEVEL_SEC      = 0.05;   // RMS smoothing
const SPEECH_SEC     = 1.5;    // speech-level tracking
const HEARTBEAT_SEC  = 0.5;    // 'speech' repeats this often while talking

/* Catch-up after a release: a queued block is dropped only when it sits inside
   a quiet stretch at least this long, so gaps between syllables survive and
   speech itself is never shortened. */
const SKIP_QUIET_SEC = 0.1;
const QUEUE_SEC      = 10;     // past this the oldest audio is lost

const BLOCK = 128;

class InputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const blockSec = BLOCK / sampleRate;
    this.blockSec    = blockSec;
    this.levelCoef   = 1 - Math.exp(-blockSec / LEVEL_SEC);
    this.speechCoef  = 1 - Math.exp(-blockSec / SPEECH_SEC);
    this.gate        = 10 ** (GATE_DB / 20);
    this.drop        = 10 ** (-DROP_DB / 20);
    this.meanSquare  = 0;
    this.speechLevel = 0.05;
    this.quietSec    = 0;
    this.paused      = true;
    this.sinceBeat   = 0;

    /* Ring buffer of whole blocks, each with the quiet time it was captured at. */
    this.capacity = Math.ceil(QUEUE_SEC / blockSec);
    this.samples  = new Float32Array(this.capacity * BLOCK);
    this.quietAt  = new Float32Array(this.capacity);
    this.head     = 0;   // oldest queued block
    this.count    = 0;
    this.mono     = new Float32Array(BLOCK);

    this.holding  = false;
    this.lost     = 0;   // blocks dropped because the queue was full

    this.port.onmessage = ({ data }) => {
      if (data === 'hold')    this.holding = true;
      if (data === 'release') this.holding = false;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const out   = outputs[0][0];
    const mono  = this.mono;

    mono.fill(0);
    if (input && input.length) {
      const k = 1 / input.length;
      for (const ch of input) for (let i = 0; i < BLOCK; i++) mono[i] += ch[i] * k;
    }

    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += mono[i] * mono[i];
    this.meanSquare += (sum / BLOCK - this.meanSquare) * this.levelCoef;
    this.detect(Math.sqrt(this.meanSquare));

    /* Fast path: nothing queued and nothing held — straight through. */
    if (!this.holding && this.count === 0) {
      out.set(mono);
      return true;
    }

    this.enqueue(mono);
    if (this.holding) {
      out.fill(0);
      return true;
    }

    this.dequeue(out);
    if (this.count > 0 && this.quietAt[this.head] >= SKIP_QUIET_SEC && this.lastQuiet >= SKIP_QUIET_SEC) {
      this.dequeue(out);
    }
    if (this.count === 0) this.port.postMessage({ type: 'drained', lost: this.lost });
    return true;
  }

  enqueue(block) {
    if (this.count === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
      this.count--;
      this.lost++;
    }
    const slot = (this.head + this.count) % this.capacity;
    this.samples.set(block, slot * BLOCK);
    this.quietAt[slot] = this.quietSec;
    this.count++;
  }

  dequeue(out) {
    const slot = this.head;
    out.set(this.samples.subarray(slot * BLOCK, slot * BLOCK + BLOCK));
    this.lastQuiet = this.quietAt[slot];
    this.head = (this.head + 1) % this.capacity;
    this.count--;
  }

  detect(rms) {
    const threshold = Math.max(this.gate, this.speechLevel * this.drop);
    if (rms >= threshold) {
      this.speechLevel += (rms - this.speechLevel) * this.speechCoef;
      this.quietSec = 0;
      this.sinceBeat += this.blockSec;
      if (this.paused || this.sinceBeat >= HEARTBEAT_SEC) {
        this.paused = false;
        this.sinceBeat = 0;
        this.port.postMessage({ type: 'speech' });
      }
      return;
    }
    this.quietSec += this.blockSec;
    if (!this.paused && this.quietSec >= PAUSE_SEC) {
      this.paused = true;
      this.port.postMessage({ type: 'pause' });
    }
  }
}

registerProcessor('speech-input', InputProcessor);
