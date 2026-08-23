/**
 * @file controller.js
 * @description Translation request queue and target-subtitle display buffer.
 *
 * Responsibilities:
 *   - Limit concurrent translation requests (MAX_CONCURRENT).
 *   - Route each request to gtx / translator / prompt / link based on
 *     settings.translationMode.
 *   - Stage results in per-target buffers and replay them in sequence order,
 *     respecting a minimum display time so fast successive responses don't
 *     flash past the viewer.
 *
 * Source subtitle text is updated directly by speech.js; this controller only
 * touches #display-target-1 and #display-target-2.
 */

import { isDebugEnabled } from './logger.js';
import { settings, subscribe } from './store.js';
import { getLang } from './languages.js';
import { translateGtx } from './translate-gtx.js';
import { translateLink } from './translate-link.js';
import { translatePrompt } from './translate-prompt.js';
import { translateTranslator } from './translate-translator.js';
import { applyFilter } from './filter.js';
import { publishTargets } from './obs.js';

/* ============ concurrency-limited queue ============ */

const MAX_CONCURRENT = 5;
const queue    = [];
let   inFlight = 0;

function enqueue(task) {
  const { promise, resolve, reject } = Promise.withResolvers();
  queue.push({ task, resolve, reject });
  pump();
  return promise;
}

function pump() {
  while (inFlight < MAX_CONCURRENT && queue.length > 0) {
    runTask(queue.shift());
  }
}

async function runTask(item) {
  inFlight++;
  try {
    item.resolve(await item.task());
  } catch (err) {
    if (isDebugEnabled()) console.error('[controller] task failed:', err.message);
    item.reject(err);
  } finally {
    inFlight--;
    pump();
  }
}

/* ============ sequence + buffers ============ */

let sequenceCounter = 0;

/* Bumped on every resetController(). In-flight translations from a previous
   session compare their captured epoch against this and drop themselves if
   stale — otherwise old results would land in the freshly-cleared display
   right after the user clicks Start. */
let sessionEpoch = 0;

const TARGET_KEYS    = ['target1', 'target2'];
const displayBuffers  = { target1: [], target2: [] };
const currentDisplays = { target1: null, target2: null };

let _cachedSpans   = null;
let bufferInterval = null;

function getTargetSpans() {
  if (!_cachedSpans) {
    _cachedSpans = {
      target1: document.getElementById('display-target-1'),
      target2: document.getElementById('display-target-2'),
    };
  }
  return _cachedSpans;
}

function clearTarget(key) {
  displayBuffers[key].length = 0;
  currentDisplays[key] = null;
  const spans = getTargetSpans();
  const span = spans[key];
  if (span) span.textContent = '';
  publishTargets(spans.target1?.textContent || '', spans.target2?.textContent || '');
}

/* Wipe a target slot's buffer when the user switches it to 'none'. */
subscribe('target1LangId', (val) => { if (!val || val === 'none') clearTarget('target1'); });
subscribe('target2LangId', (val) => { if (!val || val === 'none') clearTarget('target2'); });

function isRecording() {
  /* Use the stop button's disabled state as the single source of truth. While
     speech.js is running it enables stop; on stop, it disables stop. */
  return !document.getElementById('btn-stop')?.disabled;
}

function bufferPush(data, minDisplayTime, sequenceId, targetLangIds) {
  if (!isRecording()) return;

  /* The request snapshot may be stale — the user can switch a slot to
     'none' (or to a different language) while a translation is in flight.
     Compare each slot against the live setting and drop mismatches. */
  const current = [settings.target1LangId, settings.target2LangId];

  targetLangIds.forEach((langId, index) => {
    if (!langId || langId === 'none') return;
    if (current[index] !== langId) return;

    const key = TARGET_KEYS[index];
    if (!key) return;

    const text = data.translations?.[index] || '';
    displayBuffers[key].push({
      text,
      minDisplayTime,
      sequenceId,
      timestamp: Date.now(),
    });
  });

  processBuffers();
  if (!bufferInterval) bufferInterval = setInterval(processBuffers, 500);
}

function processBuffers() {
  const now = Date.now();
  const spans = getTargetSpans();
  let visualUpdate = false;

  TARGET_KEYS.forEach(key => {
    const span = spans[key];
    if (!span) return;

    const buffer = displayBuffers[key];
    if (buffer.length === 0) return;

    /* Drop items older than 10s — these are stragglers from slow backends
       and would feel out-of-sync with the source if displayed late. */
    let validStart = 0;
    while (validStart < buffer.length && now - buffer[validStart].timestamp >= 10000) validStart++;
    if (validStart > 0) buffer.splice(0, validStart);

    if (buffer.length > 1)  buffer.sort((a, b) => (a.sequenceId ?? 0) - (b.sequenceId ?? 0));
    if (buffer.length > 10) buffer.splice(0, buffer.length - 10);
    if (buffer.length === 0) return;

    /* Hold current display until minDisplayTime elapses. */
    const cur = currentDisplays[key];
    if (cur && now - cur.startTime < cur.minDisplayTime * 1000) return;

    const lastSeq = cur?.sequenceId ?? -1;
    const idx = buffer.findIndex(item => item.sequenceId > lastSeq);
    if (idx === -1) return;

    const next = buffer.splice(idx, 1)[0];

    currentDisplays[key] = {
      text:           next.text,
      startTime:      now,
      minDisplayTime: next.minDisplayTime,
      sequenceId:     next.sequenceId,
    };

    span.textContent = next.text;
    visualUpdate = true;
  });

  if (visualUpdate) {
    publishTargets(spans.target1?.textContent || '', spans.target2?.textContent || '');
  }
}

/* ============ routing ============ */

async function route(text, previousText, sourceLangId, targetLangIds, sequenceId) {
  const mode = settings.translationMode;

  if (mode === 'gtx') {
    return translateGtx(text, targetLangIds, sourceLangId);
  }
  if (mode === 'translator') {
    /* Built-in Translator API. Instances are warmed up from the language tab
       (a download needs user activation), so by the time subtitles flow this
       is a straight local call. */
    return translateTranslator(text, targetLangIds, sourceLangId);
  }
  if (mode === 'prompt') {
    /* On-device Prompt API. It serialises with latest-wins preemption itself,
       so we deliberately let it bypass the concurrency assumptions of the
       queue — only the most recent request survives. */
    return translatePrompt(text, targetLangIds, sourceLangId);
  }
  if (mode === 'link') {
    const url = settings.customTranslateUrl;
    if (!url) throw new Error('Custom URL not set');
    return translateLink(text, targetLangIds, sourceLangId, url, sequenceId, previousText);
  }
  throw new Error(`Unknown translation mode: ${mode}`);
}

function getTargetLangIds() {
  return [settings.target1LangId, settings.target2LangId];
}

function computeMinDisplayTime(text, sourceLangId) {
  /* Local providers (gtx) update at speech cadence, so 0 = replace ASAP.
     Custom backends may batch / be slower, so we hold each translation
     long enough to be readable. */
  if (settings.translationMode !== 'link') return 0;
  const rules = getLang(sourceLangId)?.displayTimeRules || [];
  return rules.find(r => text.length <= r.maxLength)?.time ?? 3;
}

/* ============ filter hook ============ */

function applyTargetFilter(translations /*, targetLangIds */) {
  return translations.map(t => (t ? applyFilter(t) : t));
}

/* ============ public API ============ */

/**
 * Main entry from speech.js. Enqueues a translation request and pushes the
 * result into the display buffer.
 */
export async function sendTranslationRequest(text, previousText, sourceLangId) {
  if (!text || !text.trim()) return;
  const epoch = sessionEpoch;

  return enqueue(async () => {
    if (epoch !== sessionEpoch) return;

    const sequenceId    = sequenceCounter++;
    const targetLangIds = getTargetLangIds();
    const active        = targetLangIds.filter(id => id && id !== 'none');
    if (active.length === 0) return;

    const minDisplayTime = computeMinDisplayTime(text, sourceLangId);
    const data = await route(text, previousText, sourceLangId, targetLangIds, sequenceId);
    if (!data) return;
    if (epoch !== sessionEpoch) return;

    /* Backend may signal an emergency stop (budget cap etc.). */
    if (data.stop) {
      document.getElementById('btn-stop')?.click();
      return;
    }

    data.sequenceId   = sequenceId;
    data.translations = applyTargetFilter(data.translations, targetLangIds);
    bufferPush(data, minDisplayTime, sequenceId, targetLangIds);
  });
}

/**
 * One-shot manual text translation. This powers the always-visible text
 * translation tool and deliberately does not touch subtitle displays or OBS.
 */
export async function translateManualText(text, targetLangId) {
  if (!text || !text.trim()) return null;

  return enqueue(async () => {
    const sequenceId = sequenceCounter++;
    const targetLangIds = [targetLangId];

    if (!targetLangId || targetLangId === 'none') {
      throw new Error('No target language selected');
    }

    const data = await route(text.trim(), null, 'auto', targetLangIds, sequenceId);
    if (!data) return null;

    const translations = applyTargetFilter(data.translations || [], targetLangIds);

    return {
      sequenceId,
      sourceText: text.trim(),
      targetLangId,
      label: getLang(targetLangId)?.label || targetLangId,
      text: translations[0] || '',
    };
  });
}

/**
 * Wipe both target slots mid-session. Called by speech.js when recognition has
 * been idle long enough that the subtitles are stale, and on stop.
 *
 * The epoch bump is what keeps the display empty afterwards: a translation that
 * was still in flight when this ran is stale by definition — anything slower
 * than the idle window has missed its moment — and without the bump it would
 * land in the cleared display as a lone translation with no source line above
 * it. The queue is left alone (unlike resetController): those tasks drop
 * themselves on the epoch check when they run.
 */
export function clearTargets() {
  sessionEpoch++;
  TARGET_KEYS.forEach(clearTarget);
}

/* On stop: drop pending work and clear display buffers. Called by speech.js. */
export function resetController() {
  sessionEpoch++;
  queue.forEach(item => item.reject(new Error('controller reset')));
  queue.length = 0;
  TARGET_KEYS.forEach(clearTarget);
}

window.addEventListener('beforeunload', () => {
  if (bufferInterval) clearInterval(bufferInterval);
  queue.forEach(item => item.reject(new Error('page closing')));
  queue.length = 0;
});
