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

/**
 * Pick the interface language for someone who has never chosen one.
 *
 * This lives in the defaults rather than in main.js because _load() merges the
 * saved settings *over* these defaults: afterwards `uiLang` always holds a
 * value, and "never chose" is indistinguishable from "chose Japanese". Making
 * the default itself the detected value gets the precedence right without a
 * second flag to maintain — the detection applies only until the language
 * switcher writes uiLang, and the stored choice wins from then on.
 * resetSettings() re-detects, which is what a reset should do.
 *
 * Only the three locales in data/i18n/ are ever returned. Simplified Chinese is
 * deliberately not mapped onto zh-TW; it falls through to English like any
 * other unsupported language.
 *
 * @returns {'ja'|'zh-TW'|'en'}
 */
function _detectUiLang() {
  /* navigator.languages is ordered by preference, so the first tag matching a
     locale we ship is the answer — ['zh-TW', 'en-US', 'ja'] has to give zh-TW
     rather than the ja sitting further down the list. */
  const tags = navigator.languages?.length ? navigator.languages
             : navigator.language          ? [navigator.language]
             : [];

  for (const raw of tags) {
    const tag = String(raw).toLowerCase();
    if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
    /* Traditional script only: zh-TW, the explicit Hant subtag, and the two
       regions that write in it. Bare `zh`, zh-CN, zh-Hans and zh-SG are not
       Traditional, so they are not zh-TW — they fall through with the rest. */
    if (tag === 'zh-tw' || tag === 'zh-hk' || tag === 'zh-mo'
        || tag.startsWith('zh-hant')) return 'zh-TW';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return 'en';
}

const _defaults = Object.freeze({
  // --- UI ---
  /* Not a literal — see _detectUiLang() above. */
  uiLang:             _detectUiLang(),

  // --- First-run guidance (js/tour.js) ---
  /* The "?" in the toolbar is the only way into the walkthrough, so something
     has to point at the "?" itself to begin with. Two records rather than one
     flag, because the ring retires for either of two reasons: the tour was
     opened (tourSeen), or three launches went by and nobody reached for it
     (launchCount, which stops counting once it is past the threshold). */
  tourSeen:           false,
  launchCount:        0,

  // --- Layout (capture mode): collapse the bottom control panel so the output fills the window ---
  /* Collapsing is driven by clicking the background (anywhere outside the
     control card). panelLocked freezes that gesture so a mis-click mid-stream
     cannot drop the panel in or out of the capture; it does not freeze the
     state itself, so the OBS tab's "enter capture mode" button still works. */
  panelCollapsed:     false,      // bottom settings/control panel
  panelLocked:        false,      // ignore background clicks while true
  activeTab:          'languages', // active settings tab: 'languages' | 'style' | 'filter' | 'obs'

  // --- Language selection ---
  sourceLangId:       '',
  target1LangId:      'none',
  target2LangId:      'none',

  // --- OBS integration route ---
  /* Which way subtitles reach the streaming software. The two routes need
     almost nothing in common, so the OBS tab shows one or the other rather
     than offering controls that don't apply to the chosen route. */
  obsMode:            'websocket', // 'websocket' | 'capture'

  // --- Translation engine ---
  translationMode:    'gtx',     // 'gtx' | 'translator' | 'prompt' | 'link'
  customTranslateUrl: '',
  /* The Prompt API engine is archived rather than deleted: measured on Chrome
     150 it costs ~800ms per line per target and its output is unreliable
     outside en/ja/es/de/fr. It only joins the engine picker when this is on,
     so the code stays reachable — and verifiable — without being offered. */
  enableBrowserAI:    false,

  // --- Manual text translation ---
  manualTargetLangId: '',
  manualTargetFollowsUiLang: true,

  // --- Subtitle style ---
  subAlign:           'center',
  subBg:              '#00FF00',
  subOverflow:        'normal',  // 'normal' | 'shrink' (max 2 lines)
  subShowSource:      true,
  subSourceSingleLine: false,

  /* Seconds of recognition silence after a finalised sentence before every
     subtitle line is wiped. Timing starts at the final rather than at any
     recognition event: an interim that never finalises is still going to be
     flushed by the silence guard in speech.js, and that flush redraws the
     source line — clearing on interims would blank the display only to have
     the text reappear seconds later. 0 leaves the last line on screen. */
  subClearIdleSec:    7,

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
  /* The built-in list is switched on, never copied into blacklistRules. Those
     words must not reach the editable list: it renders as plain text in a panel
     that can end up on camera, which is the one place explicit words must not
     be. Keeping them out also means the list ships with the app instead of
     freezing in whatever localStorage held the day the user imported it. */
  blacklistUseDefaults: true,

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
