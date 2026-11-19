/**
 * @file translate-plamo.js
 * @description In-browser translation with Preferred Networks' PLaMo 3
 * Translate (2B or 0.8B), a model trained for translation only, run by
 * onnxruntime-web on WebGPU. Routed from controller.js when
 * settings.translationMode === 'plamo'. Ported from the sister project's
 * extension, where it measured 0.2–0.5s per line on an RTX 20-series card.
 *
 * Why this model: it has native fields for preceding context and a glossary, which the prompt format carries as structure rather than as
 * instructions the model may echo back.
 *
 * From outside, none of it vendored:
 *   - onnxruntime-web and @huggingface/tokenizers from jsDelivr, at exact
 *     versions, imported only when the engine first loads. ONNX Runtime
 *     fetches its WebAssembly (~27 MB) from beside its own module there.
 *   - The model, downloaded ahead into OPFS by js/plamo-store.js.
 * Transformers.js is not used: it has no PLaMo 3
 * architecture, and this conversion's attention takes seqlens_k /
 * total_sequence_length inputs of its own. So the decoding loop is written
 * here: tokenise → PFML3 prompt → greedy decoding, KV cache kept on the GPU.
 *
 * Design:
 *   - WebGPU with shader-f16 only: the conversion is q4f16 and there is no
 *     other variant to fall back on.
 *   - Single-threaded WASM: GitHub Pages sends no COOP/COEP, so the page is
 *     not cross-origin isolated. The heavy work is on the GPU either way.
 *   - One model, one generation at a time, latest-wins: a new
 *     request stops the one in flight at its next token.
 *   - Context window 2048 tokens (the model's sliding window, which the
 *     conversion does not mask past). One subtitle line and the line before
 *     it come nowhere near.
 *   - Characters missing from the vocabulary are spelled out as <0xXX> byte
 *     tokens first: the JS Unigram has no byte fallback (tokenizers.js#26)
 *     and would turn them into <unk>. Korean shows it worst — 467 of 11172
 *     syllables are in the vocabulary; 「오늘 방송」 came out as 「吳 Tuesday」.
 *   - Any failure displays nothing rather than falling back, like the other
 *     on-device engines.
 */

import { isDebugEnabled } from './logger.js';
import { getPlamoModel, getPlamoStatus, readPlamoFile } from './plamo-store.js';
import { settings } from './store.js';

const ORT_URL        = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs';
const TOKENIZERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/tokenizers@0.2.0/dist/tokenizers.min.mjs';

const STOP_TOKENS    = new Set([1, 16]); /* <|plamo:bos|>, <|plamo:tag|> — generation_config's eos */
const MAX_NEW_TOKENS = 256;
const CONTEXT_LIMIT  = 2048;

/* Glossary entries (settings.hymtGlossary, edited in the options popover of
   ui-languages.js) for this target language whose source occurs in the line,
   ignoring case. Entries with either side left blank, or no language picked,
   are still being filled in and are skipped. */
function matchTerms(text, targetLangId) {
  const rules = Array.isArray(settings.hymtGlossary) ? settings.hymtGlossary : [];
  const haystack = text.toLowerCase();
  return rules
    .filter(r => r?.lang === targetLangId)
    .map(r => ({ source: String(r.source ?? '').trim(), target: String(r.target ?? '').trim() }))
    .filter(r => r.source && r.target && haystack.includes(r.source.toLowerCase()));
}

let libs    = null;   /* { ort, Tokenizer } once imported */
let engine  = null;   /* { value, session, tokenizer, vocab, layers, kvHeads, headDim } */
let loading = null;   /* { value, promise } of the load in flight */
let wanted  = null;   /* the model asked for; null once unloadPlamo() is called */

let active   = null;  /* { stopped } token of the generation in flight */
let inflight = null;  /* that generation's promise */

/* ---------------------------------------------------------------- support */

let supportCheck = null;

/** Whether this device can run the engine: WebGPU with shader-f16. */
export function getPlamoSupport() {
  supportCheck ??= (async () => {
    try {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      return { ok: !!adapter?.features.has('shader-f16') };
    } catch {
      return { ok: false };
    }
  })();
  return supportCheck;
}

/* ---------------------------------------------------------------- lifecycle */

async function loadLibs() {
  if (libs) return libs;
  const ort = await import(ORT_URL);
  /* Not cross-origin isolated (see the header): say so, or ort tries
     threads, fails and warns on every session. */
  ort.env.wasm.numThreads = 1;
  const { Tokenizer } = await import(TOKENIZERS_URL);
  libs = { ort, Tokenizer };
  return libs;
}

async function createEngine(value) {
  const model = getPlamoModel(value);
  const { ort, Tokenizer } = await loadLibs();
  const t0 = performance.now();
  const [graph, data, tokJson, tokCfg] = await Promise.all([
    readPlamoFile(model.value, 'model_q4f16.onnx').then(b => b.arrayBuffer()),
    readPlamoFile(model.value, 'model_q4f16.onnx_data').then(b => b.arrayBuffer()),
    readPlamoFile(model.value, 'tokenizer.json').then(b => b.text()).then(JSON.parse),
    readPlamoFile(model.value, 'tokenizer_config.json').then(b => b.text()).then(JSON.parse),
  ]);
  const session = await ort.InferenceSession.create(new Uint8Array(graph), {
    executionProviders: ['webgpu'],
    externalData: [{ path: 'model_q4f16.onnx_data', data: new Uint8Array(data) }],
    /* The KV cache stays on the GPU; only the logits are read back per step. */
    preferredOutputLocation: 'gpu-buffer',
  });
  const layers = session.inputNames.filter(n => /^past_key_values\.\d+\.key$/.test(n)).length;
  if (isDebugEnabled()) console.debug(`[plamo] ${model.label} loaded in ${Math.round(performance.now() - t0)}ms, ${layers} layers`);
  return {
    value: model.value, session, layers,
    tokenizer: new Tokenizer(tokJson, tokCfg),
    vocab: new Set(tokJson.model.vocab.map(([piece]) => piece)),
    kvHeads: model.kvHeads, headDim: model.headDim,
  };
}

async function releaseEngine() {
  const old = engine;
  engine = null;
  try { await old?.session.release(); }
  catch (err) { if (isDebugEnabled()) console.warn('[plamo] release failed:', err); }
}

/**
 * Load a downloaded model, releasing any other one first so two never hold
 * GPU memory at once.
 * @returns {Promise<{ok: true} | {ok: false, reason: 'notDownloaded'|'failed'|'cancelled'}>}
 */
export function loadPlamo(value) {
  value = getPlamoModel(value).value;
  wanted = value;
  if (engine?.value === value) return Promise.resolve({ ok: true });
  if (loading?.value === value) return loading.promise;

  const previous = loading?.promise;
  const promise = (async () => {
    try {
      if (previous) await previous;
      await stopInflight();
      await releaseEngine();
      if (wanted !== value) return { ok: false, reason: 'cancelled' };
      if (!(await getPlamoStatus(value)).complete) return { ok: false, reason: 'notDownloaded' };
      const e = await createEngine(value);
      /* Switched away or to the other size while this was loading. */
      if (wanted !== value) { try { await e.session.release(); } catch { /* ignore */ } return { ok: false, reason: 'cancelled' }; }
      engine = e;
      return { ok: true };
    } catch (err) {
      if (isDebugEnabled()) console.warn('[plamo] load failed:', err);
      return { ok: false, reason: 'failed' };
    } finally {
      if (loading?.promise === promise) loading = null;
    }
  })();
  loading = { value, promise };
  return promise;
}

async function stopInflight() {
  if (active) active.stopped = true;
  if (inflight) { try { await inflight; } catch { /* ignore */ } }
}

/** Release the model and its GPU memory. Safe in any state. */
export async function unloadPlamo() {
  wanted = null;
  await stopInflight();
  await releaseEngine();
}

/* ---------------------------------------------------------------- prompt */

/* PLaMo's language codes for this app's target languages. Cantonese has no
   code of its own; it gets Traditional Chinese, the nearest written form. */
function toPlamoLang(langId) {
  const lower = String(langId || '').toLowerCase();
  if (/^zh-(tw|hk|mo|hant)/.test(lower) || lower.startsWith('yue')) return 'zh-hant';
  if (lower.startsWith('zh')) return 'zh-hans';
  const base = lower.split('-')[0];
  return PLAMO_LANGS.has(base) ? base : null;
}

/* The 52 languages of the model card (Chinese split into zh-hant / zh-hans
   above). Portuguese is not among them. */
const PLAMO_LANGS = new Set(('ar az be bg bn ca ceb de en es et eu fa fr gu he hi hr hu hy id it ja jv ka kk km ko '
  + 'lt lv ml mr ms my ne nl pa pl ru si sk sl sr sw ta te th tl ur uz vi').split(' '));

/* The PFML3 format of the model's chat_template.jinja; the tokenizer's post
   processor adds bos. The source language is left for the model to tell:
   recognition may hear a language other than the one set.
   - context: the previous line, source text only. The model's own
     "previous translation pairs" form was tried in the sister project and
     pulled each line towards how the last one had been put; bare context
     read better.
   - glossary: only the terms that occur in this line. */
function buildPrompt(text, lang, context, terms) {
  const tag = (name) => `<|plamo:tag|>${name}`;
  let p = tag('dataset') + '<|plamo:msg|>translation';
  if (context) p += tag('context') + '<|plamo:msg|>' + context;
  if (terms.length) {
    p += tag('glossary') + terms.map(g => `<|plamo:index|>${g.source}<|plamo:item|>${g.target}`).join('');
  }
  return p + tag('input') + '<|plamo:msg|>' + text
    + tag('output') + '<|plamo:key|>lang<|plamo:val|>' + lang + '<|plamo:msg|>';
}

/* Recognised speech and glossary entries must not carry PFML's reserved
   markers, or they would break the prompt's structure. */
const sanitize = (s) => String(s ?? '').replaceAll('<|plamo:', '<| plamo:');

const utf8 = new TextEncoder();

/* A character missing from the vocabulary becomes its UTF-8 byte tokens, as
   Rust tokenizers' byte_fallback would produce. */
function byteFallback(text, vocab) {
  let out = '';
  for (const ch of text) {
    if (vocab.has(ch)) { out += ch; continue; }
    for (const b of utf8.encode(ch)) out += `<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`;
  }
  return out;
}

function argmax(a) {
  let best = 0;
  let max = a[0];
  for (let i = 1; i < a.length; i++) if (a[i] > max) { max = a[i]; best = i; }
  return best;
}

/* ---------------------------------------------------------------- generate */

/** Returns null when `token.stopped` was set mid-way. */
async function generate(e, text, lang, context, terms, token) {
  const { ort } = libs;
  const { session, tokenizer, layers, kvHeads, headDim } = e;
  const fb = (s) => byteFallback(sanitize(s), e.vocab);
  const ids = tokenizer.encode(buildPrompt(
    fb(text), lang, context ? fb(context) : '',
    terms.map(g => ({ source: fb(g.source), target: fb(g.target) })),
  )).ids;
  /* A guard against a run-away repetition loop, not a speed control. */
  const maxNew = Math.min(MAX_NEW_TOKENS, CONTEXT_LIMIT - ids.length, ids.length * 3 + 32);
  if (maxNew < 8) return '';

  const empty = () => new ort.Tensor('float16', new Uint16Array(0), [1, kvHeads, 0, headDim]);
  let past = Array.from({ length: layers }, () => ({ key: empty(), value: empty() }));
  let pastLen = 0;
  let input = ids;
  const out = [];
  try {
    for (let step = 0; step <= maxNew; step++) {
      if (token.stopped) return null;
      const seq = input.length;
      const feeds = {
        input_ids:             new ort.Tensor('int64', BigInt64Array.from(input, BigInt), [1, seq]),
        seqlens_k:             new ort.Tensor('int32', Int32Array.of(pastLen + seq - 1), [1]),
        total_sequence_length: new ort.Tensor('int32', Int32Array.of(pastLen + seq), []),
      };
      for (let i = 0; i < layers; i++) {
        feeds[`past_key_values.${i}.key`]   = past[i].key;
        feeds[`past_key_values.${i}.value`] = past[i].value;
      }
      const r = await session.run(feeds);
      const logits = await r.logits.getData(true);
      for (const p of past) { p.key.dispose(); p.value.dispose(); }
      past = past.map((_, i) => ({ key: r[`present.${i}.key`], value: r[`present.${i}.value`] }));
      pastLen += seq;
      const next = argmax(logits);
      if (STOP_TOKENS.has(next)) break;
      out.push(next);
      input = [next];
    }
  } finally {
    for (const p of past) { p.key.dispose(); p.value.dispose(); }
  }
  return tokenizer.decode(out, { skip_special_tokens: true }).replace(/\s+/g, ' ').trim();
}

/* ---------------------------------------------------------------- translate */

/**
 * Translate one source line into each target. Matches the gtx/link contract.
 * @param {string} text
 * @param {string[]} targetLangIds  positions preserved; 'none'/'' yields ''
 * @param {string|null} [previousText]  the line before, as context
 * @returns {Promise<{translations: string[]} | null>}  null → display nothing
 */
export async function translatePlamo(text, targetLangIds, previousText = null) {
  if (!text?.trim()) return null;
  if (!engine) {
    /* Dropped after a GPU failure while still picked: load it again in the
       background, and show nothing for this line. */
    if (wanted && !loading) loadPlamo(wanted);
    return null;
  }

  if (active) active.stopped = true;
  const prev  = inflight;
  const token = { stopped: false };
  active = token;

  const run = (async () => {
    /* The stopped generation must unwind before the session is run again. */
    if (prev) { try { await prev; } catch { /* ignore */ } }
    const e = engine;
    if (token.stopped || !e) return null;

    const source  = text.trim();
    const context = previousText?.trim() && previousText.trim() !== source ? previousText.trim() : '';
    const translations = [];
    for (const tlId of targetLangIds) {
      if (!tlId || tlId === 'none') { translations.push(''); continue; }
      const lang = toPlamoLang(tlId);
      if (!lang) { translations.push(''); continue; }
      let result;
      try {
        result = await generate(e, source, lang, context, matchTerms(source, tlId), token);
      } catch (err) {
        /* After a lost GPU device the session is unusable: drop it, so the
           next pick of the engine loads it afresh. */
        if (engine === e) await releaseEngine();
        throw err;
      }
      if (result === null) return null;
      translations.push(result);
    }
    return { translations };
  })();
  inflight = run;

  try {
    return await run;
  } catch (err) {
    if (isDebugEnabled()) console.warn('[plamo] translate failed:', err?.message);
    return null;
  } finally {
    if (active === token) active = null;
    if (inflight === run) inflight = null;
  }
}
