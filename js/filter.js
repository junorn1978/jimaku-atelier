/**
 * @file filter.js
 * @description Plain-text keyword substitution applied to both the recognised
 * source text and the translated output. Rules live in settings.filterRules
 * as an array of `{ source, target }`; matching is case-insensitive substring
 * (regex special characters in source are auto-escaped).
 *
 * A separate blacklist masks each match with as many '*' as the match is long.
 * It has two halves that never mix: settings.blacklistRules holds the words the
 * user typed, and DEFAULT_BLACKLIST below is folded in at compile time whenever
 * settings.blacklistUseDefaults is on. The built-in words are deliberately not
 * copied into the user's list — see the note on that setting in store.js.
 *
 * Because speech.js filters the recognised text *before* sending it to
 * translation, a masked source word stays masked through the translation too,
 * so the blacklist only needs source-language words.
 *
 * Compiled rules are cached and rebuilt whenever the relevant settings change.
 */

import { settings, subscribe } from './store.js';
import { isDebugEnabled } from './logger.js';

/**
 * Built-in blacklist (Japanese explicit terms), switched on by
 * settings.blacklistUseDefaults. Never rendered anywhere in the UI — the point
 * of having it built in is that these words never have to be on screen.
 *
 * Japanese only on purpose: Chrome's recognition already censors English
 * profanity in its own results, so an English list here would mostly duplicate
 * work the model has done. Kept to distinctive, longer words to minimise false
 * positives, since there is no per-word switch to turn one off.
 */
export const DEFAULT_BLACKLIST = Object.freeze([
  'おちんちん', 'ちんちん', 'ちんこ', 'ちんぽ', 'まんこ',
  'ペニス', 'セックス', 'オナニー', 'フェラ', '射精',
  '中出し', 'クリトリス', 'ザーメン',
]);

let _compiled = [];
let _blacklist = [];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rebuild() {
  if (!settings.filterEnabled) {
    _compiled = [];
    return;
  }
  const rules = Array.isArray(settings.filterRules) ? settings.filterRules : [];
  _compiled = rules
    .filter(r => r && typeof r.source === 'string' && r.source.length > 0)
    .map(r => ({
      regex:  new RegExp(escapeRegex(r.source), 'gi'),
      target: r.target ?? '',
    }));

  if (isDebugEnabled()) console.debug(`[filter] rebuilt: ${_compiled.length} active rules`);
}

function rebuildBlacklist() {
  if (!settings.blacklistEnabled) {
    _blacklist = [];
    return;
  }
  const custom = Array.isArray(settings.blacklistRules) ? settings.blacklistRules : [];
  const words = settings.blacklistUseDefaults ? [...custom, ...DEFAULT_BLACKLIST] : custom;
  _blacklist = words
    .filter(w => typeof w === 'string' && w.length > 0)
    .map(w => {
      const esc = escapeRegex(w);
      /* Latin/alphanumeric words get word boundaries so a short word does not
         get masked inside a larger innocent one (e.g. "ass" in "class"). CJK
         text has no word boundaries, so those match as substrings. */
      const pattern = /^[A-Za-z0-9]+$/.test(w) ? `\\b${esc}\\b` : esc;
      return new RegExp(pattern, 'gi');
    });

  if (isDebugEnabled()) console.debug(`[filter] blacklist rebuilt: ${_blacklist.length} words`);
}

/**
 * Apply all enabled replacement rules and blacklist masking to `text`.
 * Safe to call with empty/nullish input.
 * @param {string} text
 * @returns {string}
 */
export function applyFilter(text) {
  if (!text) return text;
  let out = text;
  for (const { regex, target } of _compiled) {
    out = out.replace(regex, target);
  }
  for (const regex of _blacklist) {
    /* Spread to count code points so astral characters mask 1:1. */
    out = out.replace(regex, m => '*'.repeat([...m].length));
  }
  return out;
}

/**
 * One-time cleanup for lists written by the old "load defaults" button, which
 * copied the built-in words into the editable list. blacklistUseDefaults covers
 * them now, so drop them rather than leave them sitting in the panel as plain
 * text. Dropping a word the user happened to type themselves that matches a
 * built-in one costs nothing — it is still masked, just from the other half.
 *
 * Has to run before the filter tab renders, which is why initFilter() is called
 * ahead of the tab mounts in main.js.
 */
function dropCopiedDefaults() {
  const custom = Array.isArray(settings.blacklistRules) ? settings.blacklistRules : [];
  if (custom.length === 0) return;

  const builtIn = new Set(DEFAULT_BLACKLIST.map(w => w.toLowerCase()));
  const kept = custom.filter(w =>
    typeof w !== 'string' || !builtIn.has(w.trim().toLowerCase()));

  if (kept.length === custom.length) return;
  if (isDebugEnabled()) {
    console.debug(`[filter] dropped ${custom.length - kept.length} copied default word(s)`);
  }
  settings.blacklistRules = kept;
}

export function initFilter() {
  dropCopiedDefaults();
  rebuild();
  rebuildBlacklist();
  subscribe('filterEnabled',      rebuild);
  subscribe('filterRules',        rebuild);
  subscribe('blacklistEnabled',   rebuildBlacklist);
  subscribe('blacklistRules',     rebuildBlacklist);
  subscribe('blacklistUseDefaults', rebuildBlacklist);
}
