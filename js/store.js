/**
 * @file store.js
 * @description Application-wide settings store. A flat object behind a Proxy
 * that persists every write to localStorage and notifies subscribers.
 *
 * Usage:
 *   import { settings, subscribe } from './store.js';
 *   settings.uiLang = 'en';
 *   subscribe('uiLang', (val) => console.log('language is now', val));
 */

import { isDebugEnabled } from './logger.js';

const STORAGE_KEY = 'rtl-settings-v1';

const _defaults = Object.freeze({
  // --- UI ---
  uiLang:             'ja',

  // --- Layout (capture mode): collapse the bottom control panel so the preview fills the window ---
  panelCollapsed:     false,      // bottom settings/control panel
  activeTab:          'languages', // active settings tab: 'languages' | 'style' | 'filter' | 'obs'

  // --- Language selection ---
  sourceLangId:       '',
  target1LangId:      'none',
  target2LangId:      'none',

  // --- Translation engine ---
  translationMode:    'gtx',     // 'gtx' | 'prompt' | 'link'
  customTranslateUrl: '',

  // --- Manual text translation ---
  manualTargetLangId: '',
  manualTargetFollowsUiLang: true,

  // --- Subtitle style ---
  subAlign:           'center',
  subBg:              '#00FF00',
  subOverflow:        'normal',  // 'normal' | 'shrink' (max 2 lines)
  subShowSource:      true,
  subSourceSingleLine: false,

  subSourceColor:     '#FFFFFF',
  subSourceStroke:    '#000000',
  subSourceStrokeW:   4,
  subSourceSize:      24,

  // Wrapping symbols placed around the recognised (STT) source text.
  subSourcePrefix:    '【  ',     // left symbol, e.g. '【'
  subSourceSuffix:    ' 】',      // right symbol, e.g. '】'

  subTarget1Color:    '#FFFFFF',
  subTarget1Stroke:   '#000000',
  subTarget1StrokeW:  4,
  subTarget1Size:     22,

  subTarget2Color:    '#FFFFFF',
  subTarget2Stroke:   '#000000',
  subTarget2StrokeW:  4,
  subTarget2Size:     22,

  // --- Filter (keyword replace) ---
  filterEnabled:      false,
  filterRules:        [],        // [{ source: 'pattern', target: 'replacement' }]

  // --- Blacklist (mask matched words with length-matched asterisks) ---
  blacklistEnabled:   false,
  blacklistRules:     [],        // ['word', ...]  → masked to '****'

  // --- OBS bridge ---
  obsEnabled:         false,
  obsUrl:             'ws://127.0.0.1:4455',
  obsPassword:        '',
});

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ..._defaults };
    return { ..._defaults, ...JSON.parse(raw) };
  } catch (err) {
    if (isDebugEnabled()) console.warn('[store] load failed, using defaults:', err);
    return { ..._defaults };
  }
}

function _save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    if (isDebugEnabled()) console.warn('[store] save failed:', err);
  }
}

const _data = _load();

/** @type {Map<string, Set<Function>>} */
const _listeners = new Map();

function _notify(key, value) {
  _listeners.get(key)?.forEach(fn => {
    try { fn(value, key); }
    catch (err) { if (isDebugEnabled()) console.error(`[store] listener for ${key} threw:`, err); }
  });
  _listeners.get('*')?.forEach(fn => {
    try { fn(value, key); }
    catch (err) { if (isDebugEnabled()) console.error('[store] wildcard listener threw:', err); }
  });
}

export const settings = new Proxy(_data, {
  set(target, key, value) {
    if (target[key] === value) return true;
    target[key] = value;
    _save(target);
    _notify(key, value);
    return true;
  },
  deleteProperty() {
    /* settings are append-only; deletion is a programming error */
    return false;
  },
});

/**
 * Subscribe to changes on a single key (or '*' for any change).
 * @param {string} key
 * @param {(value: any, key: string) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function subscribe(key, callback) {
  if (!_listeners.has(key)) _listeners.set(key, new Set());
  _listeners.get(key).add(callback);
  return () => _listeners.get(key).delete(callback);
}

/** Reset all settings to defaults. Does NOT fire subscribers (caller should reload page). */
export function resetSettings() {
  Object.keys(_data).forEach(k => { delete _data[k]; });
  Object.assign(_data, _defaults);
  _save(_data);
}

/** Read-only access to defaults (e.g., for "reset this field" UI). */
export function getDefault(key) {
  return _defaults[key];
}
