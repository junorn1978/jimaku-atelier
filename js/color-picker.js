/**
 * @file color-picker.js
 * @description Replaces the browser's native colour dialog with an in-page
 * palette: an HSV field, a hue slider, a hex box, and the quick colours the
 * app cares about — all in one popover, styled like the rest of the panel.
 *
 * The native dialog is a separate OS window. Two problems with it here: it
 * cannot be styled (a bright system dialog over a dark panel while streaming),
 * and it sits outside the page, so a window-capture of the app catches it in
 * odd states. The palette below stays inside the page.
 *
 * The <input type="color"> elements stay in the DOM as the values themselves —
 * they are what [data-bind] is attached to. This module only hides them and
 * drives them: every change writes the input and dispatches a bubbling 'input'
 * event, which is exactly what ui-bind.js already listens for, so the settings
 * store and the live preview need no knowledge of any of this.
 *
 * Markup contract (authored, not injected — the triggers sit inside grid cells
 * whose layout the picker must not disturb):
 *
 *   <span class="color-cell">
 *     <input type="color" class="visually-hidden" data-bind="…" list="…">
 *     <button type="button" data-color-trigger class="color-swatch"></button>
 *     <output class="color-value"></output>
 *   </span>
 *
 * The trigger finds its input inside its own parent; quick colours come from
 * the <datalist> named by that input's `list` attribute.
 */

import { subscribe } from './store.js';
import { applyTo, t } from './i18n.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/* ============ colour maths ============ */

/** @returns {string|null} '#RRGGBB' uppercase, or null when unparseable. */
function normalizeHex(value) {
  const raw = String(value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.split('').map(c => c + c).join('')}`.toUpperCase();
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toUpperCase()}` : null;
}

/* HSV rather than HSL because the square-plus-slider layout maps onto it
   directly: x is saturation, y is value, and the slider is hue. */
function hexToHsv(hex) {
  const norm = normalizeHex(hex) || '#FFFFFF';
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta) {
    if      (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else                h = 60 * ((r - g) / delta + 4);
  }

  return { h: h < 0 ? h + 360 : h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex({ h, s, v }) {
  const chroma = v * s;
  const sector = h / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const m = v - chroma;

  let rgb;
  if      (sector < 1) rgb = [chroma, x, 0];
  else if (sector < 2) rgb = [x, chroma, 0];
  else if (sector < 3) rgb = [0, chroma, x];
  else if (sector < 4) rgb = [0, x, chroma];
  else if (sector < 5) rgb = [x, 0, chroma];
  else                 rgb = [chroma, 0, x];

  return `#${rgb.map(c => Math.round((c + m) * 255).toString(16).padStart(2, '0')).join('')}`
    .toUpperCase();
}

/* ============ module state ============ */

let elements      = null;
let activeInput   = null;
let activeTrigger = null;
let hsv = { h: 0, s: 0, v: 1 };

/* ============ popover (one, shared by every trigger) ============ */

/* Built once and reused: a palette per swatch would be nine copies of the same
   DOM, and only one can ever be open. */
function buildPopover() {
  const el = document.createElement('div');
  el.className = 'color-popover';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.i18nAriaLabel = 'color.title';

  /* data-i18n rather than t() at build time: setLanguage() re-applies across
     the whole document, and this lives in <body>, so it re-translates itself
     when the interface language changes. */
  el.innerHTML = `
    <div class="color-popover-head" data-i18n="color.title">カラーパレット</div>

    <div class="color-field" role="slider" tabindex="0"
         data-i18n-aria-label="color.field" aria-valuemin="0" aria-valuemax="100">
      <span class="color-field-cursor"></span>
    </div>

    <label class="color-popover-label">
      <span data-i18n="color.hue">色相</span>
      <input type="range" class="color-hue" min="0" max="359" step="1"
             data-i18n-aria-label="color.hue">
    </label>

    <div class="color-popover-row">
      <span class="color-preview" aria-hidden="true"></span>
      <label class="color-popover-label color-hex-label">
        <span data-i18n="color.hex">カラーコード</span>
        <input type="text" class="color-hex" maxlength="7" spellcheck="false"
               autocomplete="off" autocorrect="off" data-i18n-aria-label="color.hex">
      </label>
    </div>

    <div class="color-presets-label" data-i18n="color.presets">クイックカラー</div>
    <div class="color-presets"></div>
  `;

  document.body.append(el);
  /* main.js already ran its document-wide pass before this module was called,
     so the popover has to translate itself once on the way in. Later interface
     language switches reach it for free — setLanguage() re-applies across the
     whole document, and this is in <body>. */
  applyTo(el);

  return {
    root:         el,
    field:        el.querySelector('.color-field'),
    cursor:       el.querySelector('.color-field-cursor'),
    hue:          el.querySelector('.color-hue'),
    preview:      el.querySelector('.color-preview'),
    hex:          el.querySelector('.color-hex'),
    presetsLabel: el.querySelector('.color-presets-label'),
    presets:      el.querySelector('.color-presets'),
  };
}

/* ============ trigger ============ */

/* The swatch on the trigger button, plus its accessible name. The background
   colour's trigger deliberately paints no swatch (see ui-languages.js: it would
   be filled with the exact chroma-key colour, so a keyed window-capture punches
   a hole through the control) — it carries the hex as its visible label
   instead, and text survives the key, so there the name goes on `title`. */
function syncTrigger(input) {
  const trigger = input.parentElement?.querySelector('[data-color-trigger]');
  if (!trigger) return;

  const color = normalizeHex(input.value) || '#FFFFFF';
  trigger.style.setProperty('--selected-color', color);

  const label = `${t('color.open')}: ${color}`;
  if (trigger.classList.contains('color-trigger-text')) trigger.title = label;
  else trigger.setAttribute('aria-label', label);
}

/* ============ rendering ============ */

function render() {
  const color = hsvToHex(hsv);

  elements.field.style.setProperty('--field-hue', `hsl(${hsv.h}, 100%, 50%)`);
  elements.cursor.style.left = `${hsv.s * 100}%`;
  elements.cursor.style.top  = `${(1 - hsv.v) * 100}%`;
  elements.field.setAttribute('aria-valuenow', String(Math.round(hsv.s * 100)));
  elements.field.setAttribute('aria-valuetext',
    `S ${Math.round(hsv.s * 100)}% / V ${Math.round(hsv.v * 100)}%`);

  elements.hue.value = String(Math.round(hsv.h));
  elements.preview.style.backgroundColor = color;
  elements.hex.value = color;

  elements.presets.querySelectorAll('.color-preset').forEach(swatch => {
    swatch.classList.toggle('is-selected', swatch.dataset.color === color);
  });
}

/* Writes through to the hidden <input type="color">. The dispatched event is
   the whole integration: ui-bind.js listens for 'input' on the same element, so
   the store, the preview and the OBS overlay all update from here. */
function apply() {
  if (!activeInput) return;
  activeInput.value = hsvToHex(hsv);
  syncTrigger(activeInput);
  render();
  activeInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function setColor(color) {
  const normalized = normalizeHex(color);
  if (!normalized) return false;
  hsv = hexToHsv(normalized);
  apply();
  return true;
}

/* Quick colours come from the <datalist> the input points at, so which colours
   an input offers is decided in the markup rather than here — the background
   wants chroma-key greens, the text colours do not. */
function renderPresets() {
  elements.presets.replaceChildren();

  const options = activeInput?.list ? [...activeInput.list.options] : [];
  options.forEach(option => {
    const color = normalizeHex(option.value);
    if (!color) return;
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-preset';
    swatch.dataset.color = color;
    swatch.title = color;
    swatch.setAttribute('aria-label', color);
    swatch.style.setProperty('--preset-color', color);
    swatch.addEventListener('click', () => setColor(color));
    elements.presets.append(swatch);
  });

  const empty = options.length === 0;
  elements.presetsLabel.hidden = empty;
  elements.presets.hidden = empty;
}

/* ============ open / close / position ============ */

/* position:fixed and placed by hand rather than anchored in CSS: this opens
   from a collapsible card pinned to the bottom of the window, so the palette
   has to flip above the trigger whenever there is no room below it. */
function positionPopover() {
  if (!activeTrigger) return;

  const rect = activeTrigger.getBoundingClientRect();
  const gap = 8;
  const { offsetWidth: width, offsetHeight: height } = elements.root;

  const left = clamp(rect.left + rect.width / 2 - width / 2, gap,
                     window.innerWidth - width - gap);
  const below = rect.bottom + gap;
  const opensBelow = below + height <= window.innerHeight - gap;
  const top = opensBelow ? below : Math.max(gap, rect.top - height - gap);

  elements.root.style.left = `${left}px`;
  elements.root.style.top  = `${top}px`;
  /* Grow out of the swatch that was clicked rather than out of thin air. */
  const originX = clamp(rect.left + rect.width / 2 - left, 0, width);
  elements.root.style.transformOrigin = `${originX}px ${opensBelow ? '0' : '100%'}`;
}

function close({ restoreFocus = false } = {}) {
  if (!activeInput) return;
  const previous = activeTrigger;
  activeTrigger?.setAttribute('aria-expanded', 'false');
  elements.root.classList.remove('is-open');
  elements.root.setAttribute('aria-hidden', 'true');
  activeInput = null;
  activeTrigger = null;
  if (restoreFocus) previous?.focus();
}

function open(input, trigger) {
  if (activeInput === input) { close(); return; }   /* second click closes */

  activeTrigger?.setAttribute('aria-expanded', 'false');
  activeInput = input;
  activeTrigger = trigger;
  hsv = hexToHsv(input.value);

  renderPresets();
  render();
  trigger.setAttribute('aria-expanded', 'true');
  elements.root.classList.add('is-open');
  elements.root.setAttribute('aria-hidden', 'false');
  positionPopover();
}

/* ============ input handling ============ */

function wirePopover() {
  const { field, hue, hex } = elements;

  const updateFromPointer = (event) => {
    const rect = field.getBoundingClientRect();
    hsv.s = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    hsv.v = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
    apply();
  };

  /* Pointer capture so a drag that leaves the square keeps tracking, the way
     every other colour field behaves. */
  field.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    field.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  });
  field.addEventListener('pointermove', (event) => {
    if (field.hasPointerCapture(event.pointerId)) updateFromPointer(event);
  });
  field.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    if      (event.key === 'ArrowLeft')  hsv.s = clamp(hsv.s - step, 0, 1);
    else if (event.key === 'ArrowRight') hsv.s = clamp(hsv.s + step, 0, 1);
    else if (event.key === 'ArrowUp')    hsv.v = clamp(hsv.v + step, 0, 1);
    else if (event.key === 'ArrowDown')  hsv.v = clamp(hsv.v - step, 0, 1);
    else return;
    event.preventDefault();
    apply();
  });

  hue.addEventListener('input', () => { hsv.h = Number(hue.value); apply(); });

  /* Applied only at full length, so half-typed values don't drag the subtitle
     through every colour on the way ("#F" → "#FF0000" → …). */
  hex.addEventListener('input', () => {
    const normalized = normalizeHex(hex.value);
    hex.classList.toggle('is-invalid', !normalized);
    if (normalized && hex.value.length === 7) setColor(normalized);
  });
  hex.addEventListener('blur', () => {
    hex.classList.remove('is-invalid');
    if (!setColor(hex.value)) render();   /* unparseable → put the real value back */
  });
  hex.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (setColor(hex.value)) field.focus();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!activeInput) return;
    if (elements.root.contains(event.target)) return;
    if (activeTrigger?.contains(event.target)) return;
    close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeInput) {
      event.preventDefault();
      close({ restoreFocus: true });
    }
  });

  window.addEventListener('resize', () => { if (activeInput) positionPopover(); });
  /* Capture phase: the scroll that matters is the settings panel's, not the
     window's, and those events don't bubble. */
  window.addEventListener('scroll', () => { if (activeInput) positionPopover(); }, true);
}

/* ============ public API ============ */

/**
 * Wire every authored [data-color-trigger] to the shared palette. Call once,
 * after the tabs are mounted and bindInputs() has seeded their values.
 */
export function initColorPickers() {
  const triggers = [...document.querySelectorAll('[data-color-trigger]')];
  if (!triggers.length) return;

  elements = buildPopover();
  wirePopover();

  triggers.forEach(trigger => {
    const input = trigger.parentElement?.querySelector('input[type="color"]');
    if (!input) return;

    syncTrigger(input);
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();   /* the document listener above would close it again */
      open(input, trigger);
    });

    /* The store is also written from elsewhere (a reset, an import), and
       ui-bind.js updates the input without dispatching — so follow the setting
       rather than the element to keep the swatch honest. */
    const key = input.dataset.bind;
    if (key) subscribe(key, () => { if (input !== activeInput) syncTrigger(input); });
  });
}
