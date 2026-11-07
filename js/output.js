/**
 * @file output.js
 * @description Projects subtitle-related settings onto the document's CSS
 * custom properties and data attributes, so the app window reflects every
 * change immediately. Keep this module pure: input is settings, output is DOM.
 *
 * What this module paints is what the viewer sees: in window-capture mode
 * (obs.mode.capture) OBS captures this window and keys out --sub-bg. It also
 * doubles as the surface the user styles against, which is a second job rather
 * than a lesser one. See css/subtitle-core.css for the two output paths.
 */

import { settings, subscribe } from './store.js';
import { setupCinemaScroll } from './subtitle-render.js';
import { installCloudFilters, syncCloudFromVars, isCloudOutline, strokeRimFilterId } from './subtitle-cloud.js';
import { mountSubtitleDeco, decoFromSettings, DECO_KEYS } from './subtitle-deco.js';

const root = document.documentElement;
const px = (v) => `${Number(v) || 0}px`;
const id = (v) => v;

/* setting key → [css var name, value formatter] */
const _cssVarMap = {
  subAlign:          ['--sub-align',           id],
  subBg:             ['--sub-bg',              id],
  /* Each line's rim width; subRimW is the source line's (js/store.js). */
  subRimW:           ['--sub-source-rim-w',    id],
  subTarget1RimW:    ['--sub-target1-rim-w',   id],
  subTarget2RimW:    ['--sub-target2-rim-w',   id],
  /* The plain outline's rim, in px past the stroke (js/subtitle-cloud.js);
     applyStrokeRim also writes the filter each line wears for it. */
  subSourceStrokeRimW:  ['--sub-source-stroke-rim-w',  id],
  subTarget1StrokeRimW: ['--sub-target1-stroke-rim-w', id],
  subTarget2StrokeRimW: ['--sub-target2-stroke-rim-w', id],

  subSourceColor:    ['--sub-source-color',    id],
  subSourceStroke:   ['--sub-source-stroke',   id],
  subSourceStrokeW:  ['--sub-source-stroke-w', px],
  subSourceRim:      ['--sub-source-rim',      id],
  subSourceBubbleW:  ['--sub-source-bubble-w',  px],
  subSourceSize:     ['--sub-source-size',     px],

  subTarget1Color:   ['--sub-target1-color',    id],
  subTarget1Stroke:  ['--sub-target1-stroke',   id],
  subTarget1StrokeW: ['--sub-target1-stroke-w', px],
  subTarget1Rim:     ['--sub-target1-rim',      id],
  subTarget1BubbleW: ['--sub-target1-bubble-w', px],
  subTarget1Size:    ['--sub-target1-size',     px],

  subTarget2Color:   ['--sub-target2-color',    id],
  subTarget2Stroke:  ['--sub-target2-stroke',   id],
  subTarget2StrokeW: ['--sub-target2-stroke-w', px],
  subTarget2Rim:     ['--sub-target2-rim',      id],
  subTarget2BubbleW: ['--sub-target2-bubble-w', px],
  subTarget2Size:    ['--sub-target2-size',     px],
};

function applyVar(key, value) {
  const entry = _cssVarMap[key];
  if (!entry) return;
  const [cssVar, fmt] = entry;
  root.style.setProperty(cssVar, fmt(value));
}

/* The keys the cloud filters are drawn from (js/subtitle-cloud.js reads
   them back off the root's custom properties). */
const CLOUD_KEYS = ['subRimW', 'subTarget1RimW', 'subTarget2RimW', ...['Source', 'Target1', 'Target2']
  .flatMap(line => ['Stroke', 'BubbleW', 'Size', 'Rim', 'StrokeRimW'].map(part => `sub${line}${part}`))];

/* A line wears the plain outline's rim filter only while it has a rim, so a
   plain outline without one goes through no filter at all. A --sub-*
   property like the rest, so the subtitle window receives it with them. */
const STROKE_RIM_LINES = { subSourceStrokeRimW: 'source', subTarget1StrokeRimW: 'target1', subTarget2StrokeRimW: 'target2' };
function applyStrokeRim(key, value) {
  const line = STROKE_RIM_LINES[key];
  root.style.setProperty(`--sub-${line}-stroke-filter`,
    Number(value) > 0 ? `url(#${strokeRimFilterId(line)})` : 'none');
}

/* On the display for css/subtitle-display.css (and the subtitle window, which
   mirrors it), and on the root for the panel, whose colour and width columns
   change their meaning with it. */
function applyOutline(value) {
  const outline = isCloudOutline(value) ? value : 'stroke';
  document.querySelector('.subtitle-display')?.setAttribute('data-sub-outline', outline);
  root.dataset.subOutline = outline;
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

/* Each line's language, for the cloud outlines' per-language font
   (css/subtitle-display.css). */
function applySourceLang(value) {
  document.querySelector('.subtitle-display')
         ?.setAttribute('data-source-lang', value || 'none');
}

function applyTargetLang(slot, value) {
  document.querySelector('.subtitle-display')
         ?.setAttribute(`data-target${slot}-lang`, value || 'none');
}

/* The cinema scroll itself lives in subtitle-render.js, shared with overlay.html
   so the two output paths move identically. This side supplies the only thing
   that differs: where the current overflow mode is read from. */
const isShrink = () => settings.subOverflow === 'shrink';

export function initOutputBinding() {
  /* Initial sync from store. */
  for (const key of Object.keys(_cssVarMap)) applyVar(key, settings[key]);
  installCloudFilters();
  syncCloudFromVars(root.style);
  applyOutline(settings.subOutline);
  applyOverflow(settings.subOverflow);
  applyShowSource(settings.subShowSource);
  applySourceSingleLine(settings.subSourceSingleLine);
  applySourceLang(settings.sourceLangId);
  applyTargetLang(1, settings.target1LangId);
  applyTargetLang(2, settings.target2LangId);

  /* Reactive updates. */
  for (const key of Object.keys(_cssVarMap)) {
    subscribe(key, (val) => applyVar(key, val));
  }
  for (const key of CLOUD_KEYS) subscribe(key, () => syncCloudFromVars(root.style));
  for (const key of Object.keys(STROKE_RIM_LINES)) {
    applyStrokeRim(key, settings[key]);
    subscribe(key, (val) => applyStrokeRim(key, val));
  }
  subscribe('subOutline', applyOutline);
  subscribe('subOverflow', applyOverflow);
  subscribe('subShowSource', applyShowSource);
  subscribe('subSourceSingleLine', applySourceSingleLine);
  subscribe('sourceLangId', applySourceLang);
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

  /* The pictures on the source line's corners (js/subtitle-deco.js). With
     the placeholder measured too, so they can be set up before anything is
     recognised. */
  const sourceEl = document.getElementById('display-source');
  const display  = document.querySelector('.subtitle-display');
  if (sourceEl && display) {
    const deco = mountSubtitleDeco({ textEl: sourceEl, host: display, placeholder: true });
    const syncDeco = () => deco.set(decoFromSettings(settings));
    for (const key of DECO_KEYS) subscribe(key, syncDeco);
    syncDeco();
  }
}
