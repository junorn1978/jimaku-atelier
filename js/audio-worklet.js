/**
 * @file audio-worklet.js
 * @description Audio-thread half of audio-input.js. Passes the microphone
 * through to the recogniser's track, and on the way:
 *
 *  - can hold the output (silence to the recogniser, real audio queued) and
 *    later release the queue, catching up by dropping quiet blocks;
 *  - detects pauses in what the recogniser is hearing, so speech.js can end a
 *    session where nobody is talking.
 *
 * Pauses are detected on the output, not the microphone. The two differ by
 * whatever is still queued, and a pause in the room while the recogniser is
 * a second behind is, to the recogniser, the middle of a word: ending the
 * session there cut words in half (live stream test, 2026-09-28).
 *
 * Runs per 128-frame block on the audio thread, so none of it depends on
 * main-thread timers.
 */

/* Level tracking (ported from the hamham extension, tuned there on stream
   audio with background music): quiet is the level below whichever is higher
   — a fixed gate, or dropDb under the recent speech level. Both come in from
   audio-input.js, which the level test shares them with. The speech level
   follows speech with a time constant, not a per-block factor: a per-block
   factor sinks it to the music's level within ~0.1s, and then nothing is ever
   12dB below it. */
const LEVEL_SEC      = 0.05;   // RMS smoothing
const SPEECH_SEC     = 1.5;    // speech-level tracking

const PAUSE_SEC      = 0.35;   // quiet this long is a pause
const SHORT_SEC      = 0.15;   // …and this long a short one (a breath between phrases)
const HEARTBEAT_SEC  = 0.5;    // 'speech' repeats this often while talking
const GAP_REPORT_SEC = 0.1;    // quiet stretches from this long are reported (diagnostics)

/* Catch-up after a release: a queued block is dropped only when it sits inside
   a quiet stretch at least this long, so gaps between syllables survive and
   speech itself is never shortened. */
const SKIP_QUIET_SEC = 0.1;
const QUEUE_SEC      = 10;     // past this the oldest audio is lost

const BLOCK = 128;

/* Smoothed level and how long it has been quiet. Used twice: on the input, to
   tag queued blocks for catch-up; on the output, for the pause events. */
class LevelTracker {
  constructor(blockSec, gateDb, dropDb) {
    this.blockSec   = blockSec;
    this.levelCoef  = 1 - Math.exp(-blockSec / LEVEL_SEC);
    this.speechCoef = 1 - Math.exp(-blockSec / SPEECH_SEC);
    this.gate       = 10 ** (gateDb / 20);
    this.drop       = 10 ** (-dropDb / 20);
    this.meanSquare = 0;
    this.speechLevel = 0.05;
    this.quietSec   = 0;
  }

  /* Returns true while the block counts as speech. */
  update(block) {
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += block[i] * block[i];
    this.meanSquare += (sum / BLOCK - this.meanSquare) * this.levelCoef;
    const rms = Math.sqrt(this.meanSquare);
    if (rms >= Math.max(this.gate, this.speechLevel * this.drop)) {
      this.speechLevel += (rms - this.speechLevel) * this.speechCoef;
      this.quietSec = 0;
      return true;
    }
    this.quietSec += this.blockSec;
    return false;
  }
}

class InputProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions: { gateDb, dropDb } }) {
    super();
    const blockSec = BLOCK / sampleRate;
    this.blockSec = blockSec;
    this.inLevel  = new LevelTracker(blockSec, gateDb, dropDb);
    this.outLevel = new LevelTracker(blockSec, gateDb, dropDb);
    this.paused    = true;
    this.shortSent = true;
    this.sinceBeat = 0;

    /* Ring buffer of whole blocks, each with the input's quiet time at capture. */
    this.capacity = Math.ceil(QUEUE_SEC / blockSec);
    this.samples  = new Float32Array(this.capacity * BLOCK);
    this.quietAt  = new Float32Array(this.capacity);
    this.head     = 0;   // oldest queued block
    this.count    = 0;
    this.lastQuiet = 0;
    this.mono     = new Float32Array(BLOCK);

    this.holding  = false;

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
    this.inLevel.update(mono);

    if (!this.holding && this.count === 0) {
      /* Fast path: nothing queued and nothing held — straight through. */
      out.set(mono);
    } else {
      this.enqueue(mono);
      if (this.holding) {
        /* The recogniser hears nothing it should react to, and neither does
           the pause detector: its clock stops until the audio flows again. */
        out.fill(0);
        return true;
      }
      this.dequeue(out);
      if (this.count > 0 && this.lastQuiet >= SKIP_QUIET_SEC && this.quietAt[this.head] >= SKIP_QUIET_SEC) {
        this.dequeue(out);
      }
    }

    this.detect(out);
    return true;
  }

  enqueue(block) {
    if (this.count === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }
    const slot = (this.head + this.count) % this.capacity;
    this.samples.set(block, slot * BLOCK);
    this.quietAt[slot] = this.inLevel.quietSec;
    this.count++;
  }

  dequeue(out) {
    const slot = this.head;
    out.set(this.samples.subarray(slot * BLOCK, slot * BLOCK + BLOCK));
    this.lastQuiet = this.quietAt[slot];
    this.head = (this.head + 1) % this.capacity;
    this.count--;
  }

  detect(block) {
    const level = this.outLevel;
    const quietBefore = level.quietSec;
    if (level.update(block)) {
      if (quietBefore >= GAP_REPORT_SEC) {
        this.port.postMessage({
          type: 'gap',
          ms: Math.round(quietBefore * 1000),
          queuedMs: Math.round(this.count * this.blockSec * 1000),
        });
      }
      this.shortSent = false;
      this.sinceBeat += this.blockSec;
      if (this.paused || this.sinceBeat >= HEARTBEAT_SEC) {
        this.paused = false;
        this.sinceBeat = 0;
        this.port.postMessage({ type: 'speech' });
      }
      return;
    }
    if (!this.shortSent && level.quietSec >= SHORT_SEC) {
      this.shortSent = true;
      this.port.postMessage({ type: 'shortPause' });
    }
    if (!this.paused && level.quietSec >= PAUSE_SEC) {
      this.paused = true;
      this.port.postMessage({ type: 'pause' });
    }
  }
}

registerProcessor('speech-input', InputProcessor);
