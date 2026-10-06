/**
 * @file subtitle-window-page.js
 * @description The subtitle window's side (subtitle-window.html). It owns no
 * state: it draws whatever the app window last sent and nothing else. The app
 * window does the recognition and translation; this window exists only so OBS
 * has something to capture that is the key colour all over, leaving the app
 * window free to wear whatever background the user likes.
 *
 * It does not read the settings store. Every value it draws comes from the app
 * window's DOM, so it cannot fall out of step with the preview — except the
 * background, which is fixed key green in subtitle-window.html.
 */

import { keepTailVisible, setupCinemaScroll } from './subtitle-render.js';
import { CHANNEL_NAME, GEOMETRY_KEY } from './subtitle-window-protocol.js';

const root    = document.documentElement;
const display = document.querySelector('.subtitle-display');
const lines = {
  source:  document.getElementById('display-source'),
  target1: document.getElementById('display-target-1'),
  target2: document.getElementById('display-target-2'),
};

const channel = new BroadcastChannel(CHANNEL_NAME);

/* ============ drawing ============ */

const isShrink = () => display.dataset.subOverflow === 'shrink';
/* Arrow, not a bare reference — see the same note in js/output.js. */
const reevals = [lines.target1, lines.target2].map(el => setupCinemaScroll(el, isShrink));

function applyState({ lang, vars, attrs, lines: text }) {
  if (lang && root.lang !== lang) root.lang = lang;

  for (const [name, value] of Object.entries(vars || {})) {
    root.style.setProperty(name, value);
  }

  const overflowBefore = display.dataset.subOverflow;
  for (const [name, value] of Object.entries(attrs || {})) {
    if (display.getAttribute(name) !== value) display.setAttribute(name, value);
  }

  for (const key of Object.keys(lines)) {
    const next = text?.[key] ?? '';
    if (lines[key].textContent !== next) lines[key].textContent = next;
  }
  keepTailVisible(lines.source);

  /* A mode switch changes heights without touching text, so the scroll
     observer does not see it. Same 50ms settle as js/output.js. */
  if (display.dataset.subOverflow !== overflowBefore) {
    setTimeout(() => reevals.forEach(fn => fn()), 50);
  }
}

function clearLines() {
  for (const el of Object.values(lines)) el.textContent = '';
}

channel.onmessage = ({ data }) => {
  switch (data?.type) {
    case 'state': applyState(data); break;
    case 'ping':  channel.postMessage({ type: 'hello' }); break;
    /* The app window closed or is reloading. Whatever is on screen now would
       stay on stream indefinitely, so take it down; a reloaded app sends a
       fresh state as soon as it is back. */
    case 'bye':   clearLines(); break;
    case 'close': window.close(); break;
  }
};

/* ============ geometry ============ */

/* Position and size go to localStorage so the next window opens where this
   one was. innerWidth/innerHeight because window.open's width/height are the
   content size, not the frame's. A move without a resize fires nothing, so
   pagehide records the final position as well. */
let geometryTimer = null;
function saveGeometry() {
  clearTimeout(geometryTimer);
  geometryTimer = null;
  try {
    localStorage.setItem(GEOMETRY_KEY, JSON.stringify({
      left: window.screenX, top: window.screenY,
      width: window.innerWidth, height: window.innerHeight,
    }));
  } catch { /* next window opens at the default size */ }
}
window.addEventListener('resize', () => {
  clearTimeout(geometryTimer);
  geometryTimer = setTimeout(saveGeometry, 300);
});

window.addEventListener('pagehide', () => {
  saveGeometry();
  channel.postMessage({ type: 'bye' });
});

/* Announce ourselves; the app answers with the current state. */
channel.postMessage({ type: 'hello' });
