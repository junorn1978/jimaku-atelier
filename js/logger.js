/**
 * @file logger.js
 * @description Debug-mode toggle backed by localStorage. Modules check
 * isDebugEnabled() before emitting noisy console output.
 */

const STORAGE_KEY = 'rtl-debug';

let _enabled = (() => {
  try { return localStorage.getItem(STORAGE_KEY) === 'true'; }
  catch { return false; }
})();

export function isDebugEnabled() {
  return _enabled;
}

export function setDebugEnabled(on) {
  _enabled = !!on;
  try { localStorage.setItem(STORAGE_KEY, String(_enabled)); }
  catch { /* private mode etc. */ }
}
