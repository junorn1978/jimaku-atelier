/**
 * @file audio-worklet.js
 * @description Audio-thread half of audio-input.js. Passes the microphone
 * through to the recogniser's track, and on the way:
 *
 *  - can hold the output (silence to the recogniser, real audio queued) and
 *    later release the queue;
 *  - catches up on what the queue costs in latency: plays it at SPEEDUP
 *    (WSOLA, pitch kept) and skips quiet stretches. Skipping alone is not
 *    enough — a speaker who never pauses leaves nothing to skip, and every
 *    session switch then adds another 0.5–0.8s for good (ported from the hamham
 *    extension, where 3 minutes of non-stop talk drifted from 0.23s to 1.89s
 *    behind with skipping only, and stayed at 0.13–0.21s with the speed-up);
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

/* Catch-up: a queued block is skipped only when it sits inside a quiet
   stretch at least this long, so gaps between syllables survive. */
const SKIP_QUIET_SEC = 0.1;
const QUEUE_SEC      = 10;     // past this the oldest audio is lost

/* More than TARGET_LAG_SEC queued: play at SPEEDUP until back within it.
   1.25 is what the hamham extension measured recognition to still cope with,
   fast-talking streamers included. */
const SPEEDUP        = 1.25;
const TARGET_LAG_SEC = 0.15;
/* WSOLA: 20ms frames at 50% overlap; each seam is placed where the waveform
   fits best within ±SEARCH_SEC. */
const FRAME_SEC      = 0.02;
const SEARCH_SEC     = 0.005;
const LAG_REPORT_SEC = 1;      // while queueing, the lag is reported this often (diagnostics)

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
    this.mono      = new Float32Array(BLOCK);
    this.holding   = false;

    /* Sample ring buffer. w / rd are running write / read positions in
       samples; each written block also records how long the input had been
       quiet, which is what catch-up skips by. */
    this.blocksCap = Math.ceil(QUEUE_SEC / blockSec);
    this.capacity  = this.blocksCap * BLOCK;
    this.samples   = new Float32Array(this.capacity);
    this.quietAt   = new Float32Array(this.blocksCap);
    this.w         = 0;
    this.rd        = 0;
    /* Once audio is queued, output comes from WSOLA until the queue is caught
       up and quiet; only then does it go back to passing straight through. */
    this.queueing  = false;

    /* WSOLA */
    this.hop      = Math.round(FRAME_SEC * sampleRate / 2);   // output samples per frame
    this.frameLen = this.hop * 2;
    this.search   = Math.round(SEARCH_SEC * sampleRate);
    this.window   = new Float32Array(this.frameLen);
    for (let i = 0; i < this.frameLen; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frameLen);   // sums to 1 at 50% overlap
    }
    this.ola     = new Float32Array(this.hop);                  // last frame's second half, awaiting the next
    this.outBuf  = new Float32Array(this.frameLen + BLOCK);     // synthesised, not yet sent
    this.outLen  = 0;
    this.prevPos = -1;   // where the last frame was read from; -1 = no continuity (start, skip, overflow)
    this.rdFrac  = 0;    // fractional read position while sped up
    this.sinceLagReport = 0;

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

    if (!this.holding && !this.queueing) {
      /* Fast path: nothing queued and nothing held — straight through. */
      out.set(mono);
      this.detect(out);
      return true;
    }

    this.queueing = true;
    this.enqueue(mono);
    this.reportLag();
    if (this.holding) {
      /* The recogniser hears nothing it should react to, and neither does
         the pause detector: its clock stops until the audio flows again. */
      out.fill(0);
      return true;
    }

    /* Caught up, and everything still queued is quiet (the room has been
       quiet longer than the queue is long): drop it and pass straight
       through again, at zero lag. */
    const lag = this.lagSec();
    if (lag < TARGET_LAG_SEC && this.inLevel.quietSec >= Math.max(SKIP_QUIET_SEC, lag + this.blockSec)) {
      this.resetQueue();
      out.set(mono);
    } else {
      this.render(out);
    }
    this.detect(out);
    return true;
  }

  lagSec() {
    return (this.w - this.rd) / sampleRate;
  }

  at(i) {
    return this.samples[i % this.capacity];
  }

  enqueue(block) {
    this.samples.set(block, this.w % this.capacity);
    this.quietAt[(this.w / BLOCK) % this.blocksCap] = this.inLevel.quietSec;
    this.w += BLOCK;
    if (this.w - this.rd > this.capacity - BLOCK) {
      /* Full: the oldest audio goes, and the seam there cannot be matched. */
      this.rd = this.w - this.capacity + BLOCK;
      this.prevPos = -1;
    }
  }

  resetQueue() {
    this.rd       = this.w;
    this.rdFrac   = 0;
    this.outLen   = 0;
    this.ola.fill(0);
    this.prevPos  = -1;
    this.queueing = false;
    this.sinceLagReport = 0;
    this.port.postMessage({ type: 'lag', sec: 0, rate: 1 });
  }

  isQuietAt(pos) {
    return this.quietAt[Math.floor(pos / BLOCK) % this.blocksCap] >= SKIP_QUIET_SEC;
  }

  /* One block of synthesised output; silence while there is not yet enough
     queued for a frame (just after queueing starts). */
  render(out) {
    while (this.outLen < BLOCK && this.synthFrame()) {}
    if (this.outLen < BLOCK) {
      out.fill(0);
      return;
    }
    out.set(this.outBuf.subarray(0, BLOCK));
    this.outBuf.copyWithin(0, BLOCK, this.outLen);
    this.outLen -= BLOCK;
  }

  /* Synthesises one frame (hop output samples). False when too little is queued. */
  synthFrame() {
    const hop  = this.hop;
    const need = this.frameLen + this.search * 2;
    if (this.w - this.rd < need) return false;

    const behind = this.lagSec() > TARGET_LAG_SEC;
    const rate   = behind ? SPEEDUP : 1;

    /* Behind: quiet stretches are skipped whole. */
    if (behind) {
      while (this.w - this.rd >= need + BLOCK && this.isQuietAt(this.rd) && this.isQuietAt(this.rd + BLOCK)) {
        this.rd += BLOCK;
        this.prevPos = -1;
      }
    }

    /* Sped up: pick the start within [rd, rd + 2*search] that best continues
       the last frame. At 1× it is always rd, and the overlapped Hann frames
       add back up to the original exactly. */
    let pos = this.rd;
    if (rate > 1 && this.prevPos >= 0) {
      const ref = this.prevPos + hop;
      let best = -Infinity;
      for (let k = 0; k <= this.search * 2; k += 2) {
        let c = 0;
        for (let i = 0; i < hop; i += 2) c += this.at(this.rd + k + i) * this.at(ref + i);
        if (c > best) { best = c; pos = this.rd + k; }
      }
    }

    const outBuf = this.outBuf;
    const win    = this.window;
    for (let i = 0; i < hop; i++) {
      outBuf[this.outLen + i] = this.ola[i] + this.at(pos + i) * win[i];
      this.ola[i] = this.at(pos + hop + i) * win[hop + i];
    }
    this.outLen += hop;
    this.prevPos = pos;

    const advance = hop * rate + this.rdFrac;
    const whole   = Math.floor(advance);
    this.rdFrac   = advance - whole;
    this.rd      += whole;
    return true;
  }

  reportLag() {
    this.sinceLagReport += this.blockSec;
    if (this.sinceLagReport < LAG_REPORT_SEC) return;
    this.sinceLagReport = 0;
    const sec = this.lagSec();
    this.port.postMessage({ type: 'lag', sec, rate: sec > TARGET_LAG_SEC ? SPEEDUP : 1 });
  }

  detect(block) {
    const level = this.outLevel;
    const quietBefore = level.quietSec;
    if (level.update(block)) {
      if (quietBefore >= GAP_REPORT_SEC) {
        this.port.postMessage({
          type: 'gap',
          ms: Math.round(quietBefore * 1000),
          queuedMs: Math.round(this.lagSec() * 1000),
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
