/**
 * @file obs.js
 * @description OBS WebSocket v5 bridge. The main app connects to OBS and
 * broadcasts subtitle text + style via `BroadcastCustomEvent` (rtl_subtitle_update).
 * overlay.html instances (added as OBS browser sources) subscribe to general
 * events on the same socket and render whatever they receive.
 *
 * Connection is reactive — it follows settings.obsEnabled / obsUrl /
 * obsPassword. Style changes also trigger a re-broadcast so overlays update
 * immediately without waiting for the next subtitle frame.
 */

import { isDebugEnabled } from './logger.js';
import { settings, subscribe } from './store.js';
import { decorateSource } from './source-decoration.js';

const DEFAULT_WS_URL    = 'ws://127.0.0.1:4455';
const RECONNECT_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 5000;

let socket          = null;
let reconnectTimer  = null;
let authenticated   = false;
let requestCounter  = 0;

let currentUrl      = '';
let currentPassword = '';

let latestSource        = '';
let latestSourcePending = false;
let latestTarget1   = '';
let latestTarget2   = '';
let pendingPublish  = false;
let pendingAutoSetup = false;

/* ============ connection-state broadcast (for the OBS tab UI) ============ */

/* phase: 'disabled' | 'connecting' | 'connected' | 'retrying'
   code:  WebSocket close code (number) for 'retrying', or a string token
          ('badurl') for a pre-handshake failure; null otherwise. The reason
          code carries through the retry loop so the UI keeps showing why. */
let connState = { phase: 'disabled', code: null };
const connListeners = new Set();

function setConnState(phase, code = null) {
  if (connState.phase === phase && connState.code === code) return;
  connState = { phase, code };
  connListeners.forEach(fn => {
    try { fn(connState); } catch (err) { if (isDebugEnabled()) console.error('[obs] conn listener threw:', err); }
  });
}

/** Subscribe to connection-state changes. Fires immediately with the current
 *  state and returns an unsubscribe function. */
export function onConnectionState(cb) {
  connListeners.add(cb);
  try { cb(connState); } catch { /* ignore */ }
  return () => connListeners.delete(cb);
}

/* ============ auth helpers (OBS WS uses SHA-256 + base64) ============ */

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function sha256Base64(text) {
  const data = new TextEncoder().encode(text);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return toBase64(new Uint8Array(buf));
}

async function buildAuthToken(password, salt, challenge) {
  if (!password || !salt || !challenge) return '';
  const secret = await sha256Base64(password + salt);
  return sha256Base64(secret + challenge);
}

/* ============ socket lifecycle ============ */

function safeClose() {
  if (!socket) return;
  try {
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    socket.close();
  } catch { /* ignore */ }
  socket = null;
  authenticated = false;
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  clearReconnect();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureConnection();
  }, RECONNECT_DELAY_MS);
}

function sendRaw(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try { socket.send(JSON.stringify(payload)); } catch { /* ignore */ }
}

function sendIdentify(token = '') {
  /* eventSubscriptions: 0 — we only send events, never receive them. */
  const d = { rpcVersion: 1, eventSubscriptions: 0 };
  if (token) d.authentication = token;
  sendRaw({ op: 1, d });
}

function handleHello(d) {
  const auth = d?.authentication;
  if (!auth) { sendIdentify(''); return; }
  buildAuthToken(currentPassword, auth.salt, auth.challenge)
    .then(t => sendIdentify(t))
    .catch(() => sendIdentify(''));
}

function ensureConnection() {
  if (!settings.obsEnabled) { disconnect(); return; }

  const url      = (settings.obsUrl || '').trim() || DEFAULT_WS_URL;
  const password = (settings.obsPassword || '').trim();

  if (socket
      && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      && currentUrl === url && currentPassword === password) {
    return;
  }

  safeClose();
  currentUrl      = url;
  currentPassword = password;

  /* First attempt shows "connecting"; once we've failed at least once, keep
     showing the failure reason + "retrying" through the loop (no flicker back
     to "connecting" on every 2s attempt). */
  if (connState.phase === 'retrying') setConnState('retrying', connState.code);
  else                                setConnState('connecting');

  try {
    socket = new WebSocket(url);
  } catch (err) {
    if (isDebugEnabled()) console.warn('[obs] socket create failed:', err);
    setConnState('retrying', 'badurl');
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    clearReconnect();
    if (isDebugEnabled()) console.debug('[obs] connected', url);
  };

  socket.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.op === 0)      handleHello(msg.d);
    else if (msg.op === 2) {
      authenticated = true;
      setConnState('connected');
      if (isDebugEnabled()) console.debug('[obs] authenticated');
      flushPending();
    }
  };

  socket.onerror = () => {
    if (isDebugEnabled()) console.warn('[obs] socket error');
  };

  socket.onclose = (event) => {
    socket = null;
    authenticated = false;
    if (isDebugEnabled()) console.debug('[obs] closed', { code: event?.code });
    if (settings.obsEnabled) {
      setConnState('retrying', event?.code ?? null);
      scheduleReconnect();
    } else {
      setConnState('disabled');
    }
  };
}

function disconnect() {
  clearReconnect();
  safeClose();
  setConnState('disabled');
}

/* ============ broadcast ============ */

function getStyleFor(key) {
  const cap = key.charAt(0).toUpperCase() + key.slice(1);
  return {
    color:       settings[`sub${cap}Color`],
    strokeColor: settings[`sub${cap}Stroke`],
    fontSize:    `${settings[`sub${cap}Size`]}px`,
    strokeSize:  `${settings[`sub${cap}StrokeW`]}px`,
  };
}

function publish() {
  if (!authenticated) {
    pendingPublish = true;
    ensureConnection();
    return;
  }
  pendingPublish = false;
  requestCounter++;

  sendRaw({
    op: 6,
    d: {
      requestType: 'BroadcastCustomEvent',
      requestId:   `rtl-broadcast-${requestCounter}`,
      requestData: {
        eventData: {
          type:       'rtl_subtitle_update',
          source:     latestSourcePending ? decorateSource(latestSource) : latestSource,
          target1:    latestTarget1,
          target2:    latestTarget2,
          alignment:  settings.subAlign,
          overflow:   settings.subOverflow,
          showSource: settings.subShowSource !== false,
          sourceSingleLine: settings.subSourceSingleLine === true,
          styles: {
            source:  getStyleFor('source'),
            target1: getStyleFor('target1'),
            target2: getStyleFor('target2'),
          },
        },
      },
    },
  });
}

function flushPending() {
  if (pendingPublish) publish();
  if (pendingAutoSetup) {
    pendingAutoSetup = false;
    setTimeout(() => executeAutoSetup(), 500);
  }
}

/* ============ public publish API ============ */

export function publishSource(text, pending = false) {
  latestSource = typeof text === 'string' ? text : '';
  latestSourcePending = !!pending;
  if (!settings.obsEnabled) return;
  ensureConnection();
  publish();
}

export function publishTargets(t1, t2) {
  latestTarget1 = typeof t1 === 'string' ? t1 : '';
  latestTarget2 = typeof t2 === 'string' ? t2 : '';
  if (!settings.obsEnabled) return;
  ensureConnection();
  publish();
}

/* ============ request/response helper (for auto-setup) ============ */

function sendSingleRequest(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error('Socket not open'));
      return;
    }
    const requestId = `rtl-req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const onMsg = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.op === 7 && msg.d.requestId === requestId) {
        socket.removeEventListener('message', onMsg);
        if (msg.d.requestStatus.result) resolve(msg.d.responseData);
        else reject(new Error(msg.d.requestStatus.comment || 'Request failed'));
      }
    };
    socket.addEventListener('message', onMsg);
    sendRaw({ op: 6, d: { requestType, requestId, requestData } });

    setTimeout(() => {
      socket.removeEventListener('message', onMsg);
      reject(new Error(`Request ${requestType} timeout`));
    }, REQUEST_TIMEOUT_MS);
  });
}

/* ============ overlay URL generation ============ */

function getBaseUrl() {
  return window.location.href
    .split('?')[0].split('#')[0]
    .replace(/index\.html$/, '')
    .replace(/\/$/, '');
}

export function getOverlayUrl(mode) {
  const url = (settings.obsUrl || '').trim() || DEFAULT_WS_URL;
  const pwd = (settings.obsPassword || '').trim();
  const modeParam = (mode && mode !== 'all') ? `&mode=${encodeURIComponent(mode)}` : '';
  return `${getBaseUrl()}/overlay.html#url=${encodeURIComponent(url)}&pwd=${encodeURIComponent(pwd)}${modeParam}`;
}

/* ============ auto-setup (creates OBS browser sources) ============ */

const AUTO_SOURCES = [
  { name: 'RTL-Subtitle-All',           mode: 'all',     visible: true  },
  { name: 'RTL-Subtitle-Source',        mode: 'source',  visible: false },
  { name: 'RTL-Subtitle-Translation-1', mode: 'target1', visible: false },
  { name: 'RTL-Subtitle-Translation-2', mode: 'target2', visible: false },
];

const OVERLAY_CSS = 'body { background-color: rgba(0,0,0,0); margin: 0 auto; overflow: hidden; }';

export function triggerAutoSetup() {
  if (!settings.obsEnabled) {
    alert('Enable OBS WebSocket first.');
    return;
  }
  if (!authenticated) {
    pendingAutoSetup = true;
    ensureConnection();
    return;
  }
  executeAutoSetup();
}

async function executeAutoSetup() {
  try {
    const sceneInfo = await sendSingleRequest('GetCurrentProgramScene');
    const sceneName = sceneInfo.currentProgramSceneName || sceneInfo.sceneName;
    if (!sceneName) throw new Error('Cannot read current scene name');

    for (const src of AUTO_SOURCES) {
      const url = getOverlayUrl(src.mode);
      try {
        await sendSingleRequest('CreateInput', {
          sceneName,
          inputName: src.name,
          inputKind: 'browser_source',
          inputSettings: {
            url, width: 1280, height: 200, reroute_audio: false, css: OVERLAY_CSS,
          },
          sceneItemEnabled: src.visible,
        });
        if (isDebugEnabled()) console.debug('[obs] created source:', src.name);
      } catch (err) {
        /* Source already exists globally — add to current scene and refresh settings. */
        if (isDebugEnabled()) console.debug('[obs] source exists, updating:', src.name);
        try { await sendSingleRequest('CreateSceneItem', { sceneName, sourceName: src.name }); } catch { /* already in scene */ }
        try {
          await sendSingleRequest('SetInputSettings', {
            inputName: src.name,
            inputSettings: { url, width: 1280, height: 200, css: OVERLAY_CSS },
          });
          const idRes = await sendSingleRequest('GetSceneItemId', { sceneName, sourceName: src.name });
          await sendSingleRequest('SetSceneItemEnabled', {
            sceneName, sceneItemId: idRes.sceneItemId, sceneItemEnabled: src.visible,
          });
        } catch (e2) {
          if (isDebugEnabled()) console.warn('[obs] update existing source failed:', e2);
        }
      }
    }

    alert('OBS Auto Setup complete.\n4 browser sources added to the current scene; only "All" is visible by default.');
  } catch (err) {
    if (isDebugEnabled()) console.error('[obs] auto setup failed:', err);
    alert('OBS Auto Setup failed: ' + err.message);
  }
}

/* ============ init ============ */

const STYLE_KEYS = [
  'subAlign', 'subOverflow', 'subShowSource', 'subSourceSingleLine',
  'subSourcePrefix', 'subSourceSuffix',
  'subSourceColor',  'subSourceStroke',  'subSourceStrokeW',  'subSourceSize',
  'subTarget1Color', 'subTarget1Stroke', 'subTarget1StrokeW', 'subTarget1Size',
  'subTarget2Color', 'subTarget2Stroke', 'subTarget2StrokeW', 'subTarget2Size',
];

export function initObs() {
  /* Connection lifecycle driven by settings. */
  subscribe('obsEnabled', () => ensureConnection());
  subscribe('obsUrl',      () => { if (settings.obsEnabled) { safeClose(); ensureConnection(); } });
  subscribe('obsPassword', () => { if (settings.obsEnabled) { safeClose(); ensureConnection(); } });

  /* Any style change → re-broadcast so overlay stays in sync without
     waiting for the next subtitle update. */
  for (const k of STYLE_KEYS) {
    subscribe(k, () => { if (settings.obsEnabled && authenticated) publish(); });
  }

  if (settings.obsEnabled) ensureConnection();
}

window.addEventListener('beforeunload', () => disconnect());
