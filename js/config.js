/**
 * @file config.js
 * @description Loads ./data/config.json once at startup. Keeps the gtx
 * endpoint / API key / client tag in a single user-editable JSON so forks
 * can swap them without touching code. The bundled gtx key is the public
 * "te_lib" client key, so the file is committed for out-of-the-box use.
 */

import { isDebugEnabled } from './logger.js';

let _data = null;

export async function loadConfig(url = './data/config.json') {
  if (_data) return _data;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`[config] load failed: HTTP ${res.status}`);
  _data = await res.json();
  if (isDebugEnabled()) console.debug('[config] loaded');
  return _data;
}

/**
 * gtx provider config.
 * @returns {{ endpoint: string, apiKey: string, clientTag: string } | null}
 */
export function getGtxConfig() {
  return _data?.gtx ?? null;
}
