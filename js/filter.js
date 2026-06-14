/**
 * @file filter.js
 * @description Plain-text keyword substitution applied to both the recognised
 * source text and the translated output. Rules live in settings.filterRules
 * as an array of `{ source, target }`; matching is case-insensitive substring
 * (regex special characters in source are auto-escaped).
 *
 * A separate blacklist (settings.blacklistRules, an array of plain words) masks
 * each match with as many '*' as the match is long (おちんちん → *****). Because
 * speech.js filters the recognised text *before* sending it to translation, a
 * masked source word stays masked through the translation too, so the blacklist
 * only needs source-language words.
 *
 * Compiled rules are cached and rebuilt whenever the relevant settings change.
 */

import { settings, subscribe } from './store.js';
import { isDebugEnabled } from './logger.js';

/**
 * Starter blacklist (Japanese explicit terms). Loaded on demand via the UI's
 * "load defaults" button; fully editable afterwards. Kept to distinctive,
 * longer words to minimise false positives.
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
  const words = Array.isArray(settings.blacklistRules) ? settings.blacklistRules : [];
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

export function initFilter() {
  rebuild();
  rebuildBlacklist();
  subscribe('filterEnabled',    rebuild);
  subscribe('filterRules',      rebuild);
  subscribe('blacklistEnabled', rebuildBlacklist);
  subscribe('blacklistRules',   rebuildBlacklist);
}
