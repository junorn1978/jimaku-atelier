/**
 * @file languages.js
 * @description Loads ./data/language_config.json and exposes a normalized
 * lookup. Each language entry is merged with project-level defaults so callers
 * never have to fall back manually.
 */

import { isDebugEnabled } from './logger.js';

let _config = null;
const _byId = new Map();

/**
 * Load and normalize the language config. Idempotent.
 * @param {string} [url]
 */
export async function loadLanguages(url = './data/language_config.json') {
  if (_config) return _config;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`[languages] load failed: HTTP ${res.status}`);

  _config = await res.json();
  _byId.clear();

  const defaults = _config.defaults ?? {};
  for (const item of _config.languages ?? []) {
    _byId.set(item.id, {
      ...item,
      gtxCode:          item.gtxCode          ?? item.id,
      /* English natural-language name for the Chrome Prompt API engine — small
         on-device models recognise "Traditional Chinese" far better than a code
         like "zh-TW". Falls back to label so callers never get undefined. */
      promptName:       item.promptName       ?? item.label,
      /* BCP 47 tag for the built-in Translator API. Mostly the same as
         gtxCode, but Chinese differs: the Translator API wants zh / zh-Hant
         where Google translate uses zh-CN / zh-TW. */
      translatorCode:   item.translatorCode   ?? item.gtxCode ?? item.id,
      chunkSize:        item.chunkSize        ?? defaults.chunkSize        ?? 40,
      displayTimeRules: item.displayTimeRules ?? defaults.displayTimeRules ?? [],
    });
  }

  if (isDebugEnabled()) console.debug(`[languages] loaded ${_byId.size} entries`);
  return _config;
}

/**
 * Get a normalized language object by id (e.g., 'ja-JP'). Returns null if not found.
 * @param {string} id
 */
export function getLang(id) {
  return _byId.get(id) ?? null;
}

/** All loaded language entries, in config order. */
export function getAllLanguages() {
  return Array.from(_byId.values());
}
