/**
 * @file logger.js
 * @description Debug-mode toggle backed by localStorage. Modules check
 * isDebugEnabled() before emitting noisy console output.
 */

const STORAGE_KEY       = 'rtl-debug';
const PROBE_STORAGE_KEY = 'rtl-debug-probe';

function readFlag(key) {
  try { return localStorage.getItem(key) === 'true'; }
  catch { return false; }
}

function writeFlag(key, on) {
  try { localStorage.setItem(key, String(on)); }
  catch { /* private mode etc. */ }
}

let _enabled = readFlag(STORAGE_KEY);
let _probe   = readFlag(PROBE_STORAGE_KEY);

export function isDebugEnabled() {
  return _enabled;
}

export function setDebugEnabled(on) {
  _enabled = !!on;
  writeFlag(STORAGE_KEY, _enabled);
}

/* The audio probe (js/speech.js → js/audio-worklet.js): what the recogniser is
   fed, a line every few hundred ms for the whole session. Needed when a
   session hears speech and returns nothing, but it buries every other line and
   keeps the worklet measuring, so it has a switch of its own under the debug
   log. Only takes effect while the debug log is on. */
export function isProbeEnabled() {
  return _enabled && _probe;
}

export function isProbeSettingOn() {
  return _probe;
}

export function setProbeEnabled(on) {
  _probe = !!on;
  writeFlag(PROBE_STORAGE_KEY, _probe);
}
