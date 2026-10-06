/**
 * @file subtitle-window.js
 * @description The app window's side of the subtitle window
 * (subtitle-window.html, obs.mode.window): opening and closing it, knowing
 * whether one is up, and keeping it in step with the output pane.
 *
 * Keeping it in step is done by mirroring the output pane's DOM rather than by
 * hooking the code that writes subtitles. speech.js, controller.js, output.js
 * and i18n.js all write to that pane or to <html>, and between them decide
 * everything a subtitle line looks like — text, colours, sizes, which lines
 * show, the overflow modes, the font that follows the UI language. Watching
 * the result covers all of them, including whatever writes it next, and makes
 * the subtitle window the preview by construction instead of by discipline.
 *
 * The mirror runs whatever the OBS route is: posting to a channel nobody
 * listens on costs nothing, and it means a window opened from any route, or
 * left open across a reload, is never stale.
 */

import { isDebugEnabled } from './logger.js';
import { CHANNEL_NAME, WINDOW_NAME, GEOMETRY_KEY } from './subtitle-window-protocol.js';

const DEFAULT_WIDTH  = 1280;
const DEFAULT_HEIGHT = 240;

/* Backup for 'bye', which a crashed or killed window never sends. Only runs
   while we hold a reference, i.e. for a window this page opened. */
const CLOSED_POLL_MS = 1000;

/* Tokens from styles.css that css/subtitle-display.css spends. The subtitle
   window does not load styles.css, so they travel with the state. */
const SHARED_TOKENS = ['--space-2', '--space-5'];

/* The .subtitle-display attributes css/subtitle-display.css keys on. */
const MIRRORED_ATTRS = [
  'data-sub-overflow', 'data-sub-show-source', 'data-sub-source-single',
  'data-target1-lang', 'data-target2-lang',
];

const root = document.documentElement;
let channel = null;
let display = null;
let lineEls = null;

let win        = null;   // reference, only for a window this page opened
let pollTimer  = null;
let isOpen     = false;
let postQueued = false;

const stateListeners = new Set();

/* ============ open / closed state ============ */

function setOpen(open) {
  if (isOpen === open) return;
  isOpen = open;
  if (!open) stopPoll();
  stateListeners.forEach(fn => {
    try { fn(isOpen); } catch (err) { if (isDebugEnabled()) console.error('[subwin] listener threw:', err); }
  });
}

/** Subscribe to open/closed changes. Fires immediately with the current state
 *  and returns an unsubscribe function. */
export function onSubtitleWindowState(cb) {
  stateListeners.add(cb);
  try { cb(isOpen); } catch { /* ignore */ }
  return () => stateListeners.delete(cb);
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => {
    if (!win || win.closed) { win = null; stopPoll(); setOpen(false); }
  }, CLOSED_POLL_MS);
}

function stopPoll() {
  clearInterval(pollTimer);
  pollTimer = null;
}

/* ============ open / close ============ */

function readGeometry() {
  try {
    const g = JSON.parse(localStorage.getItem(GEOMETRY_KEY) || 'null');
    if (g && g.width > 0 && g.height > 0) return g;
  } catch { /* fall through to the default */ }
  return null;
}

/** Open the subtitle window, or bring the one already open to the front.
 *  Must run inside a user gesture, or the popup blocker eats it. */
export function openSubtitleWindow() {
  if (win && !win.closed) { win.focus(); return; }

  const g = readGeometry();
  const features = [
    'popup',
    `width=${g?.width ?? DEFAULT_WIDTH}`,
    `height=${g?.height ?? DEFAULT_HEIGHT}`,
  ];
  if (g && Number.isFinite(g.left) && Number.isFinite(g.top)) {
    features.push(`left=${g.left}`, `top=${g.top}`);
  }

  /* A window that is open but not ours (opened before this page reloaded)
     shares the name, so this call would navigate it to the same URL — a
     reload, which is harmless, and it hands us the reference back. */
  win = window.open('subtitle-window.html', WINDOW_NAME, features.join(','));
  if (!win && isDebugEnabled()) console.warn('[subwin] window.open was blocked');
  /* Open is reported by the window's hello, not here: it has not loaded yet. */
}

export function closeSubtitleWindow() {
  if (win && !win.closed) win.close();
  /* Also covers a window this page did not open (no reference). It was opened
     by script, so it is allowed to close itself. */
  channel?.postMessage({ type: 'close' });
  win = null;
  setOpen(false);
}

/* ============ mirror ============ */

function snapshot() {
  const vars = {};
  for (let i = 0; i < root.style.length; i++) {
    const name = root.style[i];
    if (name.startsWith('--sub-')) vars[name] = root.style.getPropertyValue(name);
  }
  const computed = getComputedStyle(root);
  for (const name of SHARED_TOKENS) vars[name] = computed.getPropertyValue(name).trim();

  const attrs = {};
  for (const name of MIRRORED_ATTRS) {
    const value = display.getAttribute(name);
    if (value != null) attrs[name] = value;
  }

  return {
    type:  'state',
    lang:  root.lang,
    vars,
    attrs,
    lines: {
      source:  lineEls.source?.textContent  ?? '',
      target1: lineEls.target1?.textContent ?? '',
      target2: lineEls.target2?.textContent ?? '',
    },
  };
}

/* Interim results rewrite the source line many times a second, and one change
   can trip several mutation records, so posts are coalesced to one per task.
   A microtask rather than a timer or rAF: those are throttled, or stop, while
   this window is hidden, and the subtitle window has to keep moving then. */
function queuePost() {
  if (postQueued) return;
  postQueued = true;
  queueMicrotask(() => {
    postQueued = false;
    channel.postMessage(snapshot());
  });
}

/* ============ init ============ */

export function initSubtitleWindow() {
  display = document.querySelector('.subtitle-display');
  lineEls = {
    source:  document.getElementById('display-source'),
    target1: document.getElementById('display-target-1'),
    target2: document.getElementById('display-target-2'),
  };
  if (!display || typeof BroadcastChannel !== 'function') return;

  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = ({ data }) => {
    if (data?.type === 'hello') {
      setOpen(true);
      if (win && !pollTimer) startPoll();
      queuePost();
    }
    /* Also sent when the window only reloads; its next hello reopens. */
    else if (data?.type === 'bye') setOpen(false);
  };

  const observer = new MutationObserver(queuePost);
  observer.observe(root, { attributes: true, attributeFilter: ['style', 'lang'] });
  observer.observe(display, {
    attributes: true, attributeFilter: MIRRORED_ATTRS,
    childList: true, characterData: true, subtree: true,
  });

  /* A window left open across this page's reload answers this, and the hello
     handler sends it the current state. */
  channel.postMessage({ type: 'ping' });

  window.addEventListener('pagehide', () => channel.postMessage({ type: 'bye' }));
}
