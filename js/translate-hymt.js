/**
 * @file translate-hymt.js
 * @description In-browser translation with Tencent's HY-MT1.5-1.8B, a model
 * trained for translation only, run by Transformers.js on WebGPU. Routed from
 * controller.js when settings.translationMode === 'hymt'.
 *
 * Why it is here: it is the one engine that runs entirely in the page, needs
 * no key and no relay, and does not go through English. Measured 2026-10-23
 * on an NVIDIA Turing 6 GB card, ja→zh-TW, q4f16: 569ms per line on average,
 * every line under 1s; ~700ms with a Live2D game running on the same GPU.
 * Its weak spot is streaming slang (スパチャ came out as nonsense).
 *
 * Three things come from outside, none of them vendored:
 *   - Transformers.js (~0.6 MB) from jsDelivr, imported only when this engine
 *     is picked, at an exact version so the CDN can never change it under us;
 *   - ONNX Runtime's WebAssembly (~17–28 MB), which Transformers.js fetches
 *     from jsDelivr itself;
 *   - the model (q4f16 ~1.2 GB, q4 ~1.4 GB) from Hugging Face — far past
 *     GitHub's file limit, so there is no question of shipping it.
 * The browser caches all three; after the first download a load takes seconds.
 *
 * Design:
 *   - WebGPU only. The quantised weights use an operator ONNX Runtime has no
 *     CPU (WASM) kernel for, and fp16 failed on WASM too, so there is no CPU
 *     fallback: without WebGPU the engine is simply unavailable.
 *   - q4f16 where the adapter has shader-f16 (smaller and faster), q4 where
 *     it does not.
 *   - Downloading is the user's decision — 1.2 GB is not something to start
 *     on a click that only meant to pick an engine. ui-languages.js asks for
 *     it with a button; loadHymt() is what both the button and a load from
 *     cache call.
 *   - The model holds GPU memory while loaded, so it is released as soon as
 *     another engine is picked.
 *   - One model, one inference at a time, latest-wins: a new request
 *     interrupts the generation in flight (it is already stale for live
 *     subtitles), waits for it to unwind, then runs. Like the Prompt API
 *     engine, any failure displays nothing rather than falling back.
 */

import { isDebugEnabled } from './logger.js';
import { getLang } from './languages.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
const MODEL_ID = 'onnx-community/HY-MT1.5-1.8B-ONNX';

/* Download size per variant, for the message that asks before downloading. */
export const HYMT_SIZE = { q4f16: '1.2 GB', q4: '1.4 GB' };

/* A subtitle line translates to a few dozen tokens; this only stops a
   runaway generation. */
const MAX_NEW_TOKENS = 256;

let lib       = null;   /* the Transformers.js module, once imported */
let generator = null;   /* the loaded pipeline */
let loading   = null;   /* in-flight load, shared by concurrent callers */
let wanted    = false;  /* false once unloadHymt() is called mid-load */

let activeStop = null;  /* stopping criteria of the generation in flight */
let inflight   = null;  /* that generation's promise */

/* ---------------------------------------------------------------- support */

let supportCheck = null;

/**
 * Whether this device can run the engine, and with which weights.
 * @returns {Promise<{ok: true, dtype: 'q4f16'|'q4'} | {ok: false}>}
 */
export function getHymtSupport() {
  supportCheck ??= (async () => {
    try {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return { ok: false };
      return { ok: true, dtype: adapter.features.has('shader-f16') ? 'q4f16' : 'q4' };
    } catch {
      return { ok: false };
    }
  })();
  return supportCheck;
}

/** Whether the weights are already in the browser's cache, so loading needs
 *  no download (and no asking). Looks in every cache rather than one by
 *  name, so a change in Transformers.js's cache naming cannot hide them. */
export async function isHymtDownloaded(dtype) {
  if (!('caches' in self)) return false;
  const file = `/onnx/model_${dtype}.onnx_data`;
  try {
    for (const name of await caches.keys()) {
      const keys = await (await caches.open(name)).keys();
      if (keys.some(req => req.url.includes(MODEL_ID) && req.url.endsWith(file))) return true;
    }
  } catch { /* storage blocked: treat as not downloaded */ }
  return false;
}

/* ---------------------------------------------------------------- lifecycle */

/**
 * Load the model, downloading it first if it is not cached.
 * @param {string} dtype
 * @param {(loaded: number, total: number) => void} [onProgress]  bytes, summed over files
 * @returns {Promise<{ok: true} | {ok: false, reason: 'failed'|'cancelled'}>}
 */
export function loadHymt(dtype, onProgress) {
  wanted = true;
  if (generator) return Promise.resolve({ ok: true });
  loading ??= (async () => {
    const files = new Map();
    try {
      lib ??= await import(TRANSFORMERS_URL);
      /* Without this it first looks for the model under /models/ on our own
         origin, which only produces 404s. */
      lib.env.allowLocalModels = false;
      const gen = await lib.pipeline('text-generation', MODEL_ID, {
        dtype,
        device: 'webgpu',
        progress_callback: (p) => {
          if (p.status !== 'progress' || !p.total) return;
          files.set(p.file, [p.loaded, p.total]);
          let loaded = 0, total = 0;
          for (const [l, t] of files.values()) { loaded += l; total += t; }
          onProgress?.(loaded, total);
        },
      });
      /* Switched away while this was loading: release it straight away. */
      if (!wanted) { await gen.dispose?.(); return { ok: false, reason: 'cancelled' }; }
      generator = gen;
      return { ok: true };
    } catch (err) {
      if (isDebugEnabled()) console.warn('[hymt] load failed:', err);
      return { ok: false, reason: 'failed' };
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Release the model and its GPU memory. Safe in any state. */
export async function unloadHymt() {
  wanted = false;
  activeStop?.interrupt();
  if (inflight) { try { await inflight; } catch { /* ignore */ } }
  const gen = generator;
  generator = null;
  try { await gen?.dispose?.(); }
  catch (err) { if (isDebugEnabled()) console.warn('[hymt] dispose failed:', err); }
}

/* ---------------------------------------------------------------- prompt */

/* HY-MT's own templates: the Chinese one when Chinese is involved, the English
   one otherwise. Only targets pick the template here — a Chinese source to a
   non-Chinese target would want the Chinese template with Chinese language
   names, which no target needs yet. Names are the ones the model card uses. */
const CHINESE_TARGETS = {
  'zh-TW':       '繁体中文',
  'zh-HK':       '繁体中文',
  'zh-CN':       '中文',
  'yue-Hant-HK': '粤语',
};

function buildPrompt(text, targetLangId) {
  const zh = CHINESE_TARGETS[targetLangId];
  if (zh) return `将以下文本翻译为${zh}，注意只需要输出翻译后的结果，不要额外解释：\n\n${text}`;
  const name = getLang(targetLangId)?.promptName || targetLangId;
  return `Translate the following segment into ${name}, without additional explanation.\n\n${text}`;
}

/* ---------------------------------------------------------------- translate */

async function translateOne(text, targetLangId, stop) {
  const out = await generator([{ role: 'user', content: buildPrompt(text, targetLangId) }], {
    max_new_tokens: MAX_NEW_TOKENS,
    do_sample: false,
    /* The model card's value. Greedy decoding without it can loop. */
    repetition_penalty: 1.05,
    stopping_criteria: stop,
  });
  if (stop?.interrupted) return null;
  return String(out[0]?.generated_text?.at(-1)?.content ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Translate one source line into each target. Matches the gtx/link contract.
 * @param {string} text
 * @param {string[]} targetLangIds  positions preserved; 'none'/'' yields ''
 * @returns {Promise<{translations: string[]} | null>}  null → display nothing
 */
export async function translateHymt(text, targetLangIds) {
  if (!text || !text.trim() || !generator) return null;

  activeStop?.interrupt();
  const prev = inflight;
  const stop = lib.InterruptableStoppingCriteria ? new lib.InterruptableStoppingCriteria() : null;
  activeStop = stop;

  const run = (async () => {
    /* The interrupted generation must finish unwinding before the model is
       asked again. Its result is irrelevant here. */
    if (prev) { try { await prev; } catch { /* ignore */ } }
    if (stop?.interrupted || !generator) return null;

    const translations = [];
    for (const tlId of targetLangIds) {
      if (!tlId || tlId === 'none') { translations.push(''); continue; }
      const result = await translateOne(text, tlId, stop);
      if (result === null) return null;
      translations.push(result);
    }
    return { translations };
  })();
  inflight = run;

  try {
    return await run;
  } catch (err) {
    if (isDebugEnabled()) console.warn('[hymt] translate failed:', err?.message);
    return null;
  } finally {
    if (activeStop === stop) activeStop = null;
    if (inflight === run) inflight = null;
  }
}
