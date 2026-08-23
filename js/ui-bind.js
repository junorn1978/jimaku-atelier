/**
 * @file ui-bind.js
 * @description Two-way binding between form controls and the settings store.
 *
 * Mark any <input>, <select>, <textarea> with [data-bind="settingKey"] and call
 * bindInputs(root). Each element pulls its initial value from settings, writes
 * back on change, and stays in sync if the setting is mutated elsewhere.
 *
 * For range inputs, an adjacent <output class="slider-value"> sibling will be
 * kept in sync automatically (display only). Color inputs do the same with an
 * <output class="color-value"> anywhere in the same parent (uppercase hex
 * readout).
 */

import { settings, subscribe } from './store.js';

const _radioGroups = new Map(); /* key → Set<HTMLInputElement> */

export function bindInputs(root = document) {
  root.querySelectorAll('[data-bind]').forEach(bindOne);
}

function bindOne(el) {
  const key = el.dataset.bind;
  if (!key) return;

  /* Give the field a name so the browser stops warning about un-fillable form
     fields. Harmless here (no form submission) and leaves shared radio-group
     names untouched. */
  if (!el.id && !el.name) el.name = key;

  switch (true) {
    case el.type === 'radio':    return bindRadio(el, key);
    case el.type === 'checkbox': return bindCheckbox(el, key);
    case el.type === 'range':
    case el.type === 'number':   return bindNumeric(el, key);
    case el.tagName === 'SELECT':return bindSelect(el, key);
    default:                     return bindText(el, key); /* text, color, url, etc. */
  }
}

/* A radio's value is always a string, but some settings are booleans — a
   two-state segmented picker is sometimes a better-looking stand-in for a
   toggle. Coerce on the way into the store so consumers comparing with === true
   keep working. Reads are unaffected: they already compare as strings. */
function coerceRadioValue(current, raw) {
  return typeof current === 'boolean' ? raw === 'true' : raw;
}

function bindRadio(el, key) {
  /* Group radios by their shared settings key. We only attach one subscriber
     per group to avoid redundant DOM writes. */
  el.checked = String(settings[key]) === String(el.value);
  el.addEventListener('change', () => {
    if (el.checked) settings[key] = coerceRadioValue(settings[key], el.value);
  });

  if (!_radioGroups.has(key)) {
    _radioGroups.set(key, new Set());
    subscribe(key, (val) => {
      _radioGroups.get(key)?.forEach(r => { r.checked = String(r.value) === String(val); });
    });
  }
  _radioGroups.get(key).add(el);
}

function bindCheckbox(el, key) {
  el.checked = !!settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; });
  subscribe(key, (val) => { el.checked = !!val; });
}

function bindNumeric(el, key) {
  syncNumeric(el, settings[key]);
  el.addEventListener('input', () => {
    settings[key] = Number(el.value);
    updateSliderOutput(el);
  });
  subscribe(key, (val) => syncNumeric(el, val));
  updateSliderOutput(el);
}

function syncNumeric(el, val) {
  if (String(el.value) !== String(val ?? '')) el.value = val ?? '';
}

function updateSliderOutput(el) {
  if (el.type !== 'range') return;
  const out = el.nextElementSibling;
  if (out?.classList.contains('slider-value')) out.textContent = el.value;
}

function bindSelect(el, key) {
  if (el.value !== String(settings[key] ?? '')) el.value = settings[key] ?? '';
  el.addEventListener('change', () => { settings[key] = el.value; });
  subscribe(key, (val) => { if (el.value !== String(val ?? '')) el.value = val ?? ''; });
}

function bindText(el, key) {
  if (el.value !== String(settings[key] ?? '')) el.value = settings[key] ?? '';
  el.addEventListener('input', () => {
    settings[key] = el.value;
    updateColorOutput(el);
  });
  subscribe(key, (val) => {
    if (el.value !== String(val ?? '')) el.value = val ?? '';
    updateColorOutput(el);
  });
  updateColorOutput(el);
}

function updateColorOutput(el) {
  if (el.type !== 'color') return;
  /* Looked up through the parent rather than as the next sibling: the palette's
     trigger button sits between the input and its readout. */
  const out = el.parentElement?.querySelector('.color-value');
  if (out) out.textContent = el.value.toUpperCase();
}
