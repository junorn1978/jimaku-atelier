/**
 * @file store.js
 * @description Application-wide settings store. A flat object behind a Proxy
 * that persists every write to localStorage and notifies subscribers.
 *
 * Usage:
 *   import { settings, subscribe } from './store.js';
 *   settings.uiLang = 'en';
 *   subscribe('uiLang', (val) => console.log('language is now', val));
 *
 * Two windows can hold the store at once — the app and its second window
 * (js/channel.js) — and the store is one object in localStorage. Two things
 * keep them from undoing each other:
 *  - a write stores only the key that changed, into what localStorage holds
 *    now, rather than this window's whole copy, which would put back whatever
 *    the other window changed since this one loaded;
 *  - a change the other window stores reaches this one's copy and subscribers
 *    (the storage event), so a shared setting changed in one is live in both.
 * The second window keeps the settings that belong to one input (PER_CHANNEL)
 * in an object of its own; everything else is shared.
 */

import { isDebugEnabled } from './logger.js';
import { CHANNEL } from './channel.js';

const STORAGE_KEY = 'rtl-settings-v1';
const CH2_STORAGE_KEY = 'rtl-settings-v1-ch2';

/* What the second window sets for itself: the input, what it is recognised
   as and translated into, and how its subtitles look and stay — a guest's
   subtitles can be another language, another colour, another place. The
   panel's layout too, as the two windows are sized apart. Everything else
   (interface, translation engine, filters, OBS connection) is one setting
   for both, changed from either. */
const PER_CHANNEL = new Set([
  'micDeviceId', 'micDeviceLabel', 'segmentMode', 'sttEngine', 'customSttUrl',
  'useSttTranslations',
  'sourceLangId', 'target1LangId', 'target2LangId',
  'subAlign', 'subLineGap', 'subBg', 'subOverflow', 'subShowSource', 'subSourceSingleLine', 'subClearIdleSec',
  'subOutline', 'subRimW', 'subTarget1RimW', 'subTarget2RimW', 'subRimLinked',
  'subSizeLinked', 'subStrokeWLinked', 'subBubbleWLinked',
  'subSourceStrokeRimW', 'subTarget1StrokeRimW', 'subTarget2StrokeRimW', 'subStrokeRimLinked',
  'subSourceRim', 'subTarget1Rim', 'subTarget2Rim',
  'subSourceBubbleW', 'subTarget1BubbleW', 'subTarget2BubbleW',
  'subSourceColor', 'subSourceStroke', 'subSourceStrokeW', 'subSourceSize',
  'subSourcePrefix', 'subSourceSuffix',
  'subDecoLeftOn', 'subDecoLeftImg', 'subDecoLeftAngle', 'subDecoLeftSize', 'subDecoLeftX', 'subDecoLeftY',
  'subDecoRightOn', 'subDecoRightImg', 'subDecoRightAngle', 'subDecoRightSize', 'subDecoRightX', 'subDecoRightY',
  'subTarget1Color', 'subTarget1Stroke', 'subTarget1StrokeW', 'subTarget1Size',
  'subTarget2Color', 'subTarget2Stroke', 'subTarget2StrokeW', 'subTarget2Size',
  'panelCollapsed', 'panelLocked', 'panelHeight', 'activeTab', 'filterView',
]);

/* The second window starts from the first one's values, except the device:
   it is opened to listen to another one. */
const NOT_COPIED = new Set(['micDeviceId', 'micDeviceLabel']);

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
  /* 'system' follows the OS / browser preference (js/theme.js). */
  uiTheme:            'system',   // 'system' | 'dark' | 'light'

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
  /* Height of the expanded panel in px, dragged by its top grip (ui-layout.js).
     null is the CSS default (--control-panel-h), which is also the minimum. */
  panelHeight:        null,
  activeTab:          'languages', // active settings tab: 'languages' | 'style' | 'filter' | 'obs'
  /* Which list the word-replacement tab shows (ui-filter.js): 'rules' | 'blacklist'. */
  filterView:         'rules',

  // --- Microphone (see ui-mic.js) ---
  /* '' is the system default. The label rides along so a device whose id was
     reset (cleared site data) can still be found by name. */
  micDeviceId:        '',
  micDeviceLabel:     '',
  /* How cloud recognition splits sentences. 'auto': we end sessions at the
     speaker's pauses. 'engine': the recogniser ends each utterance itself —
     for background music loud enough to hide the pauses (see speech.js). */
  segmentMode:        'auto',

  // --- Speech recognition engine ---
  /* 'webspeech': the browser's recogniser. 'custom': a server the user runs,
     reached over WebSocket at customSttUrl (docs/custom-stt.html). */
  sttEngine:          'webspeech', // 'webspeech' | 'custom'
  customSttUrl:       '',
  /* Whether the server translates, in place of the translation engine. On, a
     sentence it returns no translations for has none shown. Off, it is sent
     no targetLangs, and any it returns anyway are ignored. */
  useSttTranslations: true,

  // --- Language selection ---
  sourceLangId:       '',
  target1LangId:      'none',
  target2LangId:      'none',

  // --- OBS integration route ---
  /* Which way subtitles reach the streaming software. The two routes need
     almost nothing in common, so the OBS tab shows one or the other rather
     than offering controls that don't apply to the chosen route. */
  obsMode:            'websocket', // 'websocket' | 'window' | 'capture'
  /* The OBS tab's steps sit behind its "?", which pulses like the toolbar's
     tour button until it has been opened once. */
  obsHelpSeen:        false,
  /* Auto Setup puts the four sources in a scene of their own (RTL-Subtitles)
     and adds that scene to the live one, so the source list gains one row
     instead of four. Off: the sources go straight into the live scene. */
  obsNestSources:     true,

  // --- Translation engine ---
  /* 'gtx' is Google translate-pa translateHtml, not translate_a/single —
     a historical name kept because it is stored; see translate-gtx.js. */
  translationMode:    'gtx',     // 'gtx' | 'translator' | 'prompt' | 'hymt' | 'link'
  customTranslateUrl: '',
  /* Terms the HY-MT engine is told how to translate, through the model's own
     terminology template (js/translate-hymt.js). Each term applies only
     when translating into its own language. */
  hymtGlossary:       [],        // [{ source: 'スバル', target: '大空昴', lang: 'zh-TW' }]
  /* The Prompt API engine is archived rather than deleted: measured on Chrome
     150 it costs ~800ms per line per target and its output is unreliable
     outside en/ja/es/de/fr. It only joins the engine picker when this is on,
     so the code stays reachable — and verifiable — without being offered. */
  enableBrowserAI:    false,
  /* The Chrome offline recognition pack download button (Languages tab). Off
     by default: the on-device models are still changing heavily (see the note
     on setupOfflinePack in ui-languages.js). Turning it off only hides the
     button — an installed pack stays in the browser and keeps being used, and
     is removed from Chrome's accessibility settings, not from here. */
  showOfflinePack:    false,

  // --- Manual text translation ---
  manualTargetLangId: '',
  manualTargetFollowsUiLang: true,

  // --- Subtitle style ---
  subAlign:           'center',
  /* px between the subtitle lines (source, translation 1, translation 2):
     the gap of the display's column, in the app, the subtitle window and
     overlay.html alike. */
  subLineGap:         8,
  subBg:              '#0E1016', // the app window's background, following the theme while left at a theme default (js/theme.js); the subtitle window is fixed #00FF00
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

  /* How the lines are outlined: 'stroke' is the plain outline; the cloud
     styles (js/subtitle-cloud.js: 'bubble', 'gooey') set the text on a cloud
     in the outline colour, ringed by the line's rim colour, and share the
     cloud sizes and the rim. Each style keeps its own widths
     (sub*StrokeW for the plain outline, sub*BubbleW for the cloud), so
     switching back and forth finds both as they were. Cloud and rim widths
     are steps of 0–15 that scale with the font size.
     Each line has its own rim width; subRimW is the source line's, the name
     kept from when it was one value for all three. While subRimLinked is on
     the two translation lines follow it (js/ui-languages.js keeps them equal),
     so every reader just takes each line's own value. */
  subOutline:         'stroke',  // 'stroke' | 'bubble' | 'gooey'
  subRimW:            3,
  subTarget1RimW:     3,
  subTarget2RimW:     3,
  subRimLinked:       true,
  /* The same link for the font sizes and the two outline widths (the
     matrix's other slider columns): on, the translation lines take the source
     line's value. On by default, the three lines' defaults being equal; see
     LINKS for settings saved before the links existed. */
  subSizeLinked:      true,
  subStrokeWLinked:   true,
  subBubbleWLinked:   true,
  /* The plain outline's rim: a second ring outside the stroke, in the same
     rim colour the clouds use, drawn by js/subtitle-cloud.js's stroke filter.
     Its widths are its own, like the stroke's (px, not the clouds' steps),
     and 0 — no rim — by default, so the plain outline looks as it always did. */
  subSourceStrokeRimW:  0,
  subTarget1StrokeRimW: 0,
  subTarget2StrokeRimW: 0,
  subStrokeRimLinked:   true,
  subSourceRim:       '#FFFFFF',
  subTarget1Rim:      '#FFFFFF',
  subTarget2Rim:      '#FFFFFF',
  subSourceBubbleW:   6,
  subTarget1BubbleW:  6,
  subTarget2BubbleW:  6,

  subSourceColor:     '#FFFFFF',
  subSourceStroke:    '#000000',
  subSourceStrokeW:   4,
  subSourceSize:      22,

  // Wrapping symbols placed around the recognised (STT) source text.
  subSourcePrefix:    '【  ',     // left symbol, e.g. '【'
  subSourceSuffix:    ' 】',      // right symbol, e.g. '】'

  /* Pictures hung on the source line's corners (js/subtitle-deco.js): the
     first character's top left and the last one's top right, each with its
     own picture, angle, size and offset. The picture is the user's own, scaled down
     and stored as a data URL (js/ui-deco.js); '' is none, and a corner
     without one stays off whatever its switch says. Size is a percentage of
     the source font size, angle degrees clockwise, the X / Y offset % of the
     font size from where the picture hangs by default (right and up positive). Not part of the colour
     presets (js/subtitle-presets.js): a picture is not a colour. */
  subDecoLeftOn:      false,
  subDecoLeftImg:     '',
  subDecoLeftAngle:   -15,
  subDecoLeftSize:    180,
  subDecoLeftX:       0,
  subDecoLeftY:       0,
  subDecoRightOn:     false,
  subDecoRightImg:    '',
  subDecoRightAngle:  15,
  subDecoRightSize:   180,
  subDecoRightX:      0,
  subDecoRightY:      0,

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
  /* Scene link (js/obs-scene-link.js): switching OBS's program scene starts
     or stops recognition. Shared, so a break scene stops the second window
     too. Rules hold only scenes that are not 'start' — { name: 'stop' |
     'none' } — so a scene added later starts; replaced whole, never mutated. */
  obsSceneLink:       false,
  obsSceneRules:      {},
  /* The same link's colour side: { sceneName: presetId } from
     js/subtitle-presets.js. A scene not listed leaves the colours as they
     are. Shared like the rules, so both app windows switch to the preset;
     replaced whole, never mutated. */
  obsScenePresets:    {},

  /* The user's own colour presets (js/subtitle-presets.js): three slots, each
     null or { outline, rimW?, src, t1, t2 } of { color, stroke, w, rim, rimW? } —
     the shape of a built-in preset, w being the width of its own style. A
     line's rimW is its own rim width; the top-level one (the source line's)
     stands in for all three in slots saved before the lines had their own. Shared by both windows, like the scene link that can pick them;
     each window applies a slot to its own lines. Replaced whole. */
  subCustomPresets:   [null, null, null],
});

/* Which stored object holds `key` for this window. */
function _storeOf(key) {
  return CHANNEL === 2 && PER_CHANNEL.has(key) ? CH2_STORAGE_KEY : STORAGE_KEY;
}

function _read(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    if (isDebugEnabled()) console.warn(`[store] read of ${storageKey} failed:`, err);
    return null;
  }
}

function _write(storageKey, obj) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(obj));
  } catch (err) {
    if (isDebugEnabled()) console.warn('[store] save failed:', err);
  }
}

/** Each slider link of the matrix and the three lines' settings it ties, the
 *  source line's first (js/ui-languages.js keeps the other two equal to it). */
export const LINKS = {
  subRimLinked:     ['subRimW', 'subTarget1RimW', 'subTarget2RimW'],
  subSizeLinked:    ['subSourceSize', 'subTarget1Size', 'subTarget2Size'],
  subStrokeWLinked: ['subSourceStrokeW', 'subTarget1StrokeW', 'subTarget2StrokeW'],
  subBubbleWLinked: ['subSourceBubbleW', 'subTarget1BubbleW', 'subTarget2BubbleW'],
  subStrokeRimLinked: ['subSourceStrokeRimW', 'subTarget1StrokeRimW', 'subTarget2StrokeRimW'],
};

/* A link never switched by the user starts on, which would pull the
   translation lines to the source line's value at once. Settings saved before
   the links existed may hold three different values on purpose; for those the
   link reads as off until it is switched, so nothing changes under them. */
function _unlinkDiffering(data, saved) {
  for (const [link, keys] of Object.entries(LINKS)) {
    if (link in saved) continue;
    if (keys.some(k => data[k] !== data[keys[0]])) data[link] = false;
  }
}

function _load() {
  const shared = _read(STORAGE_KEY) || {};
  const data = { ..._defaults, ...shared };
  if (CHANNEL === 2) {
    let own = _read(CH2_STORAGE_KEY);
    if (!own) {
      own = {};
      for (const key of PER_CHANNEL) {
        if (!NOT_COPIED.has(key) && key in shared) own[key] = shared[key];
      }
      _write(CH2_STORAGE_KEY, own);
    }
    for (const key of PER_CHANNEL) data[key] = key in own ? own[key] : _defaults[key];
    _unlinkDiffering(data, own);
  } else {
    _unlinkDiffering(data, shared);
  }
  return data;
}

function _save(key, value) {
  const storageKey = _storeOf(key);
  const stored = _read(storageKey) || {};
  stored[key] = value;
  _write(storageKey, stored);
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
    _save(key, value);
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

/* Another window stored a change: take what it changed in the objects this
   window reads, and tell this window's subscribers as if it were set here.
   Compared as JSON, since the arrays (filter rules) arrive as new objects. */
window.addEventListener('storage', (e) => {
  if (e.storageArea !== localStorage) return;
  if (e.key !== STORAGE_KEY && e.key !== CH2_STORAGE_KEY) return;
  const stored = _read(e.key) || {};
  for (const key of Object.keys(_defaults)) {
    if (_storeOf(key) !== e.key) continue;
    const next = key in stored ? stored[key] : _defaults[key];
    if (JSON.stringify(_data[key]) === JSON.stringify(next)) continue;
    _data[key] = next;
    _notify(key, next);
  }
});

/** Tell `key`'s subscribers again, with the value it already has: for a change
 *  that something had to act on before the rest could follow (the interface
 *  language, switched from the other window, has to be loaded before anything
 *  re-renders in it). */
export function renotify(key) {
  _notify(key, _data[key]);
}

/** Reset all settings to defaults. Does NOT fire subscribers (caller should reload page).
 *  From the second window, the first window's own settings are left as they are. */
export function resetSettings() {
  Object.keys(_data).forEach(k => { delete _data[k]; });
  Object.assign(_data, _defaults);
  if (CHANNEL === 2) {
    const shared = _read(STORAGE_KEY) || {};
    const firstOwn = {};
    for (const key of PER_CHANNEL) if (key in shared) firstOwn[key] = shared[key];
    _write(STORAGE_KEY, firstOwn);
    _write(CH2_STORAGE_KEY, {});
  } else {
    _write(STORAGE_KEY, {});
  }
}

/** Read-only access to defaults (e.g., for "reset this field" UI). */
export function getDefault(key) {
  return _defaults[key];
}
