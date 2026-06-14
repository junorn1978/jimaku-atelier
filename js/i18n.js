/**
 * @file i18n.js
 * @description Interface translation. Loads ./data/i18n/<lang>.json on demand
 * and applies entries to elements marked with the following attributes:
 *   - data-i18n             → textContent
 *   - data-i18n-title       → title attribute
 *   - data-i18n-placeholder → data-placeholder attribute (used by CSS ::before
 *                              on empty subtitle lines)
 */

import { isDebugEnabled } from './logger.js';

const _cache = new Map();
let _current = 'ja';
let _dict    = {};

async function _load(lang) {
  if (_cache.has(lang)) return _cache.get(lang);
  const res = await fetch(`./data/i18n/${lang}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`[i18n] failed to load ${lang} (HTTP ${res.status})`);
  const dict = await res.json();
  _cache.set(lang, dict);
  return dict;
}

function _apply(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = _dict[key];
    if (val == null) return;
    if (el.tagName === 'TITLE') document.title = val;
    else el.textContent = val;
  });

  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    const val = _dict[key];
    if (val != null) el.title = val;
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    const val = _dict[key];
    if (val == null) return;
    /* <input>/<textarea> use the native attribute; everything else falls
       through to data-placeholder for CSS ::before to consume (subtitle
       lines render their placeholder this way). */
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = val;
    } else {
      el.dataset.placeholder = val;
    }
  });
}

/**
 * Switch interface language. Loads dictionary if needed and re-applies
 * translations across the document.
 * @param {string} lang
 */
export async function setLanguage(lang) {
  try {
    _dict = await _load(lang);
    _current = lang;
    document.documentElement.lang = lang;
    _apply();
    if (isDebugEnabled()) console.debug(`[i18n] switched to ${lang}`);
  } catch (err) {
    if (isDebugEnabled()) console.error('[i18n] setLanguage failed:', err);
    throw err;
  }
}

/** Translate a single key. Returns the key itself when missing (debug-friendly). */
export function t(key) {
  return _dict[key] ?? key;
}

export function getLanguage() {
  return _current;
}

/**
 * Re-apply current translations to a sub-tree (for dynamically inserted DOM).
 * @param {ParentNode} root
 */
export function applyTo(root) {
  if (!root) return;
  _apply(root);
}
