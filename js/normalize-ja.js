/**
 * @file normalize-ja.js
 * @description Removes the word-separating spaces Chrome's on-device (SODA)
 * Japanese model puts between tokens. Japanese is written without spaces, but
 * the local model emits them at every token boundary — per mora in interim
 * results ("あ、 そ う だ ね"), per morpheme in finals ("それ は そう。"). Left
 * alone they leak into the subtitle, break the filter/blacklist rules (which
 * are written as normal Japanese words such as おちんちん, and never match
 * お ち ん ち ん), and inflate what gets sent to the translation engines.
 *
 * Spaces are only dropped where at least one side is a Japanese character, so
 * embedded Latin phrases keep their own spacing: "Apex Legends の 話" collapses
 * to "Apex Legendsの話", not "ApexLegendsの話".
 *
 * The cloud engine does not add these spaces, so for a cloud session this is a
 * no-op — it is keyed off the language, not off processLocally, which means it
 * also survives a silent fallback between the two paths mid-session.
 */

/* Character classes that are written without spaces around them:
   CJK punctuation and 々 (3000-303F), hiragana (3040-309F), katakana plus the
   ー chōonpu (30A0-30FF), kanji ext-A (3400-4DBF) and the main block
   (4E00-9FFF), fullwidth forms (FF01-FF60) and halfwidth katakana (FF66-FF9F). */
const JA_CHARS =
  '\\u3000-\\u303F\\u3040-\\u309F\\u30A0-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uFF01-\\uFF60\\uFF66-\\uFF9F';

/* Whitespace that touches a Japanese character on either side. Two alternatives
   rather than one lookbehind+lookahead pair, so a run at the very start or end
   of the string is dropped too. */
const JA_ADJACENT_SPACE = new RegExp(`(?<=[${JA_CHARS}])\\s+|\\s+(?=[${JA_CHARS}])`, 'g');

/**
 * Join the token spaces in Japanese recognition output.
 *
 * @param {string} text recognised text, already punctuation-stripped by the caller
 * @returns {string} text with Japanese token spaces removed
 */
export function joinJapaneseSpaces(text) {
  if (!text) return text ?? '';
  return text
    .replace(/\s+/g, ' ')          /* collapse runs first so one pass is enough */
    .replace(JA_ADJACENT_SPACE, '')
    .trim();
}

/**
 * Language-gated wrapper for the recognition pipeline: applies the join for
 * Japanese and passes every other language through untouched.
 *
 * @param {string} text recognised text
 * @param {string} [lang] BCP 47 tag of the recognition language (e.g. 'ja-JP')
 * @returns {string}
 */
export function normalizeRecognised(text, lang) {
  if (!lang || !lang.toLowerCase().startsWith('ja')) return text ?? '';
  return joinJapaneseSpaces(text);
}
