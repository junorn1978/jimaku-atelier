/**
 * @file preview.js
 * @description Projects subtitle-related settings onto the document's CSS
 * custom properties and data attributes, so the live preview reflects every
 * change immediately. Keep this module pure: input is settings, output is DOM.
 */

import { settings, subscribe } from './store.js';
import { setupCinemaScroll } from './subtitle-render.js';

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

/* The cinema scroll itself lives in subtitle-render.js, shared with overlay.html
   so the preview and the OBS output move identically. This side supplies the
   only thing that differs: where the current overflow mode is read from. */
const isShrink = () => settings.subOverflow === 'shrink';

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
  /* Arrow, not a bare reference: .map() passes (element, index, array), so
     passing setupCinemaScroll directly would hand it the index as isShrink. */
  const reevals = ['display-target-1', 'display-target-2']
    .map(elId => document.getElementById(elId))
    .filter(Boolean)
    .map(el => setupCinemaScroll(el, isShrink));
  /* A mode switch doesn't mutate text, so re-evaluate after the CSS height
     change settles. */
  subscribe('subOverflow', () => setTimeout(() => reevals.forEach(fn => fn()), 50));
}
