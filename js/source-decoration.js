/**
 * @file source-decoration.js
 * @description Wraps the recognised (STT) source text with user-configured
 * left/right symbols (settings.subSourcePrefix / subSourceSuffix). The symbols
 * are a "still recognising / about to be sent" cue: callers only apply them to
 * pending (interim) text and show finalised text — which has already been sent
 * for translation — without them. Empty input stays empty so we never render
 * bare symbols around nothing.
 */

import { settings } from './store.js';

/**
 * @param {string} text raw recognised text
 * @returns {string} text wrapped with the configured symbols (or unchanged when empty)
 */
export function decorateSource(text) {
  if (!text) return text ?? '';
  const prefix = settings.subSourcePrefix || '';
  const suffix = settings.subSourceSuffix || '';
  return `${prefix}${text}${suffix}`;
}
