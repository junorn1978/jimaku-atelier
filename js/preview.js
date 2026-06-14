/**
 * @file preview.js
 * @description Projects subtitle-related settings onto the document's CSS
 * custom properties and data attributes, so the live preview reflects every
 * change immediately. Keep this module pure: input is settings, output is DOM.
 */

import { settings, subscribe } from './store.js';

const root = document.documentElement;
const px = (v) => `${Number(v) || 0}px`;
const id = (v) => v;

/* setting key → [css var name, value formatter] */
const _cssVarMap = {
  subAlign:          ['--sub-align',           id],
  subBg:             ['--sub-bg',              id],

  subSourceColor:    ['--sub-source-color',    id],
  subSourceStroke:   ['--sub-source-stroke',   id],
  subSourceStrokeW:  ['--sub-source-stroke-w', px],
  subSourceSize:     ['--sub-source-size',     px],

  subTarget1Color:   ['--sub-target1-color',    id],
  subTarget1Stroke:  ['--sub-target1-stroke',   id],
  subTarget1StrokeW: ['--sub-target1-stroke-w', px],
  subTarget1Size:    ['--sub-target1-size',     px],

  subTarget2Color:   ['--sub-target2-color',    id],
  subTarget2Stroke:  ['--sub-target2-stroke',   id],
  subTarget2StrokeW: ['--sub-target2-stroke-w', px],
  subTarget2Size:    ['--sub-target2-size',     px],
};

function applyVar(key, value) {
  const entry = _cssVarMap[key];
  if (!entry) return;
  const [cssVar, fmt] = entry;
  root.style.setProperty(cssVar, fmt(value));
}

function applyOverflow(value) {
  document.querySelector('.subtitle-display')
         ?.setAttribute('data-sub-overflow', value || 'normal');
}

function applyShowSource(value) {
  document.querySelector('.subtitle-display')
         ?.setAttribute('data-sub-show-source', value === false ? 'false' : 'true');
}

function applySourceSingleLine(value) {
  document.querySelector('.subtitle-display')
         ?.setAttribute('data-sub-source-single', value === true ? 'true' : 'false');
}

function applyTargetLang(slot, value) {
  document.querySelector('.subtitle-display')
         ?.setAttribute(`data-target${slot}-lang`, value || 'none');
}

/* === translation "cinema" scroll (shrink / 2-line mode) ===
   When a translation overflows the 2-line window, hold briefly so it can be
   read, then advance one line at a time until the tail is shown. Timings are
   mirrored in overlay.html so the preview matches the OBS output. */
const SCROLL_READ_DELAY_MS    = 3000;
const SCROLL_STEP_INTERVAL_MS = 2000;
const SCROLL_STEP_ANIM_MS     = 800;

function smoothScrollToSlowly(el, to, duration) {
  const start = el.scrollTop;
  const change = to - start;
  const t0 = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    el.scrollTop = start + change * (t * (2 - t)); /* easeOut */
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setupCinemaScroll(el) {
  let session = null;

  const step = () => {
    if (settings.subOverflow !== 'shrink') return;
    const cs = getComputedStyle(el);
    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const max = el.scrollHeight - el.clientHeight;
    if (el.scrollTop < max - 1) {
      smoothScrollToSlowly(el, Math.min(el.scrollTop + lineH, max), SCROLL_STEP_ANIM_MS);
      session = setTimeout(step, SCROLL_STEP_INTERVAL_MS);
    }
  };

  const reeval = () => {
    clearTimeout(session);
    session = null;
    if (settings.subOverflow === 'shrink' && el.scrollHeight > el.clientHeight) {
      session = setTimeout(step, SCROLL_READ_DELAY_MS);
    } else {
      el.scrollTop = 0;
    }
  };

  new MutationObserver(reeval).observe(el, { childList: true, characterData: true, subtree: true });
  return reeval;
}

export function initPreviewBinding() {
  /* Initial sync from store. */
  for (const key of Object.keys(_cssVarMap)) applyVar(key, settings[key]);
  applyOverflow(settings.subOverflow);
  applyShowSource(settings.subShowSource);
  applySourceSingleLine(settings.subSourceSingleLine);
  applyTargetLang(1, settings.target1LangId);
  applyTargetLang(2, settings.target2LangId);

  /* Reactive updates. */
  for (const key of Object.keys(_cssVarMap)) {
    subscribe(key, (val) => applyVar(key, val));
  }
  subscribe('subOverflow', applyOverflow);
  subscribe('subShowSource', applyShowSource);
  subscribe('subSourceSingleLine', applySourceSingleLine);
  subscribe('target1LangId', (val) => applyTargetLang(1, val));
  subscribe('target2LangId', (val) => applyTargetLang(2, val));

  /* Cinema scroll for the two translation lines (only acts in shrink mode). */
  const reevals = ['display-target-1', 'display-target-2']
    .map(elId => document.getElementById(elId))
    .filter(Boolean)
    .map(setupCinemaScroll);
  /* A mode switch doesn't mutate text, so re-evaluate after the CSS height
     change settles. */
  subscribe('subOverflow', () => setTimeout(() => reevals.forEach(fn => fn()), 50));
}
