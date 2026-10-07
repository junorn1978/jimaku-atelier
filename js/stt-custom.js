/**
 * @file stt-custom.js
 * @description The connection to a user-run speech recognition server, per
 * docs/custom-stt.html (rtl-stt/1): one WebSocket, PCM and pause hints out,
 * partial / final results in. Display, filtering and translation stay in
 * speech.js and controller.js — this module only speaks the protocol.
 *
 * A dropped connection is retried every RETRY_MS while the run lasts; audio
 * produced while it is down is discarded rather than queued, since a backlog
 * replayed late would only arrive as stale subtitles.
 */

import { isDebugEnabled } from './logger.js';

const PROTOCOL = 'rtl-stt/1';
const RETRY_MS = 2000;

/* ============ connection state, for the settings UI ============ */

/* { phase: 'idle' | 'connecting' | 'connected' | 'ready' | 'retrying' | 'failed', detail } */
let _state = { phase: 'idle', detail: '' };
const _stateListeners = new Set();

function setState(phase, detail = '') {
  _state = { phase, detail };
  _stateListeners.forEach(fn => fn(_state));
}

/** Calls fn now and on every change; returns an unsubscribe function. */
export function onSttState(fn) {
  _stateListeners.add(fn);
  fn(_state);
  return () => _stateListeners.delete(fn);
}

/* ============ URL ============ */

/* Bare host[:port][/path] gets ws:// for this machine and the LAN, wss://
   otherwise — the same guess translate-link.js makes for http. */
export function normalizeSttUrl(input) {
  let url = String(input ?? '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) url = url.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(url)) {
    const local = /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url);
    url = `${local ? 'ws' : 'wss'}://${url}`;
  }
  return new URL(url).href;
}

/* ============ connection ============ */

/**
 * Opens the connection and keeps it open until close().
 * @param {object}   opts
 * @param {string}   opts.url
 * @param {object}   opts.config     { sourceLang, sourceLocale, targetLangs }
 * @param {Function} opts.onPartial  (text)
 * @param {Function} opts.onFinal    (text, translations | null, lang | null)
 * @returns {{ sendAudio: Function, pause: Function, configure: Function, close: Function }}
 */
export function connectCustomStt({ url, config, onPartial, onFinal }) {
  let ws      = null;
  let closed  = false;
  let retry   = null;
  let current = config;

  /* Audio goes as it is (a binary frame), control messages as JSON. */
  const send = (msg) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg instanceof ArrayBuffer ? msg : JSON.stringify(msg));
  };
  const sendConfig = () => send({
    type: 'config', protocol: PROTOCOL, ...current, sampleRate: 16000, format: 'pcm_s16le',
  });

  const scheduleRetry = (detail) => {
    if (closed || retry) return;
    setState('retrying', detail);
    retry = setTimeout(() => { retry = null; open(); }, RETRY_MS);
  };

  const onMessage = ({ data }) => {
    if (typeof data !== 'string') return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg?.type === 'partial' && typeof msg.text === 'string') onPartial(msg.text);
    else if (msg?.type === 'final' && typeof msg.text === 'string') {
      onFinal(msg.text,
        Array.isArray(msg.translations) ? msg.translations : null,
        typeof msg.lang === 'string' && msg.lang ? msg.lang : null);
    }
    else if (msg?.type === 'ready') setState('ready');
    else if (msg?.type === 'error') {
      if (isDebugEnabled()) console.warn('[stt] server error:', msg.message);
      setState(_state.phase, String(msg.message ?? ''));
    }
  };

  function open() {
    if (closed) return;
    setState('connecting');
    let sock;
    try {
      sock = new WebSocket(url);
    } catch (err) {
      /* A malformed URL throws here rather than failing the connection, and
         retrying it would only throw again. */
      setState('failed', String(err.message ?? err));
      return;
    }
    sock.binaryType = 'arraybuffer';
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      setState('connected');
      sendConfig();
    };
    sock.onmessage = (e) => { if (ws === sock) onMessage(e); };
    sock.onclose = (e) => {
      if (ws !== sock) return;
      ws = null;
      if (isDebugEnabled()) console.debug('[stt] closed', e.code, e.reason);
      /* The close code is for the debug log only: 1006 is all a refused or
         dropped connection ever reports, so it tells the streamer nothing. */
      scheduleRetry(e.reason);
    };
    /* onclose follows every error; the retry is decided there. */
    sock.onerror = () => {};
  }

  open();

  return {
    sendAudio(buf) { send(buf); },
    pause()        { send({ type: 'pause' }); },
    configure(next) {
      current = next;
      sendConfig();
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(retry);
      const sock = ws;
      ws = null;
      if (sock?.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({ type: 'stop' }));
        sock.close(1000);
      } else {
        sock?.close();
      }
      setState('idle');
    },
  };
}
