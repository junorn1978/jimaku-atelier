/**
 * @file ui-obs.js
 * @description OBS UI: route picker, and per route its few settings and its one
 * action — WebSocket (enable toggle, URL/password, Auto Setup behind a confirm),
 * the subtitle window (key colour, open/close) and window capture (background
 * colour, enter capture mode). Step-by-step instructions live in a "?" popover.
 * Appended into its own tab panel (#tab-obs) as an `.obs-section`.
 */

import { settings, subscribe } from './store.js';
import { applyTo, t } from './i18n.js';
import { triggerAutoSetup, onConnectionState } from './obs.js';
import { wireSecretInputs } from './ui-secret-input.js';
import { openSubtitleWindow, closeSubtitleWindow, onSubtitleWindowState } from './subtitle-window.js';

const MODES = ['websocket', 'window', 'capture'];

/* OBS's chroma key default, the same green the subtitle window is fixed to. */
const CAPTURE_KEY = '#00FF00';

export function mountObsTab(container) {
  if (!container) return;

  const section = document.createElement('div');
  section.className = 'obs-section';
  section.innerHTML = `
    <!-- One column, the same skeleton for every route: picker, one sentence on
         what the route is, then its settings. The route's action sits at the
         head's right end, in the same spot whichever route is showing. The
         three routes share almost nothing, so the switch swaps the body and
         the action rather than greying out what doesn't apply. -->
    <div class="obs-mode-head">
      <div class="seg-switch" role="group" data-i18n-aria-label="obs.mode" aria-label="連携方式">
        <label><input type="radio" name="obsMode" value="websocket" data-bind="obsMode"><span data-i18n="obs.mode.ws">WebSocket</span></label>
        <label><input type="radio" name="obsMode" value="window" data-bind="obsMode"><span data-i18n="obs.mode.window">字幕ウィンドウ</span></label>
        <label><input type="radio" name="obsMode" value="capture" data-bind="obsMode"><span data-i18n="obs.mode.capture">ウィンドウキャプチャ</span></label>
      </div>

      <!-- The steps are only needed while setting a route up, so they wait in
           a popover instead of taking standing room in a height-starved panel.
           One popover; it shows the block for the route that is selected. -->
      <button type="button" class="icon-btn obs-help-btn" popovertarget="popover-obs-help"
              data-i18n-title="obs.help.title" title="使い方"
              data-i18n-aria-label="obs.help.title" aria-label="使い方">?</button>
      <div class="help-popover obs-help-popover" id="popover-obs-help" popover>
        <div class="obs-help" data-mode="websocket">
          <ol class="help-steps">
            <li data-i18n="obs.help.step1"></li>
            <li data-i18n="obs.help.step2"></li>
            <li data-i18n="obs.help.step3"></li>
            <li data-i18n="obs.help.step4"></li>
          </ol>
          <ul class="help-notes">
            <li data-i18n="obs.help.nestNote"></li>
          </ul>
        </div>
        <div class="obs-help" data-mode="window" hidden>
          <ol class="help-steps">
            <li data-i18n="obs.window.step1"></li>
            <li data-i18n="obs.window.step2"></li>
            <li data-i18n="obs.window.step3"></li>
          </ol>
          <ul class="help-notes">
            <li data-i18n="obs.window.hint"></li>
            <li data-i18n="obs.window.note2"></li>
            <li data-i18n="obs.window.note3"></li>
            <li data-i18n="obs.capture.note3"></li>
          </ul>
        </div>
        <div class="obs-help" data-mode="capture" hidden>
          <ol class="help-steps">
            <li data-i18n="obs.capture.step1"></li>
            <li data-i18n="obs.capture.step2"></li>
            <li data-i18n="obs.capture.step3"></li>
            <li data-i18n="obs.capture.step4"></li>
            <li data-i18n="obs.capture.step5"></li>
          </ol>
          <ul class="help-notes">
            <li data-i18n="obs.capture.enter.hint"></li>
            <li data-i18n="obs.capture.note2"></li>
            <li data-i18n="obs.capture.note3"></li>
            <li data-i18n="obs.capture.note4"></li>
          </ul>
        </div>
      </div>

      <div class="obs-action">
        <button type="button" class="btn primary" id="obs-auto-setup" data-mode="websocket"
                data-i18n="obs.autoSetup">OBS に自動追加</button>
        <button type="button" class="btn primary" id="obs-window-toggle" data-mode="window" hidden
                data-i18n="obs.window.open">字幕ウィンドウを開く</button>
        <button type="button" class="btn primary" id="obs-capture-enter" data-mode="capture" hidden
                data-i18n="obs.capture.enter">キャプチャモードにする</button>
      </div>

      <!-- Auto Setup writes into the user's live OBS scene, so it asks first.
           A small bubble on the button rather than a modal: it is a yes/no
           about the thing just clicked. -->
      <div class="help-popover obs-confirm-popover" id="popover-obs-confirm" popover>
        <p class="obs-confirm-text" id="obs-confirm-text"></p>
        <div class="obs-confirm-actions">
          <button type="button" class="btn" id="obs-confirm-cancel" data-i18n="obs.autoSetup.cancel">キャンセル</button>
          <button type="button" class="btn primary" id="obs-confirm-ok" data-i18n="obs.autoSetup.ok">追加する</button>
        </div>
      </div>
    </div>

    <p class="obs-mode-desc" id="obs-mode-desc"></p>

    <div class="obs-body" id="obs-mode-websocket">
      <div class="obs-ws-row">
        <div class="form-row">
          <span class="form-row-label" data-i18n="obs.enabled">WS 接続</span>
          <label class="toggle">
            <input type="checkbox" data-bind="obsEnabled">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <label class="obs-field obs-field-url">
          <span class="form-row-label" data-i18n="obs.url">URL</span>
          <input type="text" class="text-input" data-bind="obsUrl"
                 placeholder="ws://127.0.0.1:4455"
                 autocomplete="off" spellcheck="false" autocorrect="off">
        </label>
        <div class="obs-field obs-field-password">
          <span class="form-row-label" data-i18n="obs.password">Password</span>
          <div class="secret-input-wrap" data-secret-visible="false"
                 data-secret-show="obs.password.show" data-secret-hide="obs.password.hide">
            <input type="text" class="text-input secret-input" data-bind="obsPassword"
                   autocomplete="off" spellcheck="false" autocorrect="off"
                   autocapitalize="off" inputmode="text">
            <button type="button" class="icon-btn secret-toggle" aria-pressed="false">
              <svg class="icon-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                <path d="M1 1l22 22"/>
              </svg>
              <svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <label class="obs-nest">
        <span class="toggle">
          <input type="checkbox" data-bind="obsNestSources">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </span>
        <span class="form-row-label" data-i18n="obs.nest">字幕ソースを専用シーン「RTL-Subtitles」にまとめる</span>
      </label>
      <div class="obs-conn">
        <p class="obs-conn-status" id="obs-conn-status" role="status" aria-live="polite" data-phase="disabled">
          <span class="obs-conn-dot" aria-hidden="true"></span>
          <span class="obs-conn-text"></span>
        </p>
        <p class="obs-conn-hint" id="obs-conn-hint"></p>
      </div>
    </div>

    <!-- The subtitle window's background is fixed green, not the background
         setting, so there is nothing to pick here — only the colour to give
         OBS. -->
    <div class="obs-body" id="obs-mode-window" hidden>
      <div class="obs-setting-row">
        <span class="form-row-label" data-i18n="obs.window.key">キー色</span>
        <p class="key-color">
          <span class="key-color-swatch" aria-hidden="true"></span>
          <code>#00FF00</code>
        </p>
        <p class="obs-inline-hint" data-i18n="obs.window.note1">字幕の色に緑を使わないでください。</p>
      </div>
    </div>

    <div class="obs-body" id="obs-mode-capture" hidden>
      <div class="obs-setting-row">
        <span class="form-row-label" data-i18n="obs.capture.bg">背景色</span>
        <!-- Bound to the same setting as the languages tab: this is the colour
             the chroma key will remove, so it belongs in the capture workflow
             too. A button rather than a filled swatch — a swatch painted in the
             key colour is itself keyed out of a window capture. -->
        <span class="color-pick">
          <input type="color" class="visually-hidden" data-bind="subBg" list="palette-bg">
          <button type="button" class="btn color-trigger-text" data-color-trigger>
            <output class="color-value"></output>
          </button>
        </span>
        <p class="obs-inline-hint" data-i18n="obs.capture.note1">字幕に背景色と同じ色を使わないでください。</p>
      </div>
    </div>
  `;

  container.appendChild(section);

  wireSecretInputs(section);
  wireConnStatus(section);
  wireModeSwitch(section);
  wireAutoSetup(section);
  wireHelpHint(section);

  /* After applyTo: the button carries a data-i18n default, and applyTo would
     otherwise put "open" back on it while the window is open. render() owns
     its label from here on, so the attribute comes off too. */
  applyTo(section);
  section.querySelector('#obs-window-toggle')?.removeAttribute('data-i18n');
  wireSubtitleWindow(section);
}

/* Swap the body, the action and the help block to the selected route, and
   say in one sentence what that route is. */
function wireModeSwitch(container) {
  const descKeys = {
    websocket: 'obs.mode.ws.desc',
    window:    'obs.mode.window.desc',
    capture:   'obs.mode.capture.desc',
  };
  const desc = container.querySelector('#obs-mode-desc');
  const swapped = container.querySelectorAll('.obs-body, .obs-action [data-mode], .obs-help');
  if (!desc) return;

  const render = () => {
    const mode = MODES.includes(settings.obsMode) ? settings.obsMode : 'websocket';
    for (const el of swapped) {
      const own = el.dataset.mode ?? el.id.replace('obs-mode-', '');
      el.hidden = own !== mode;
    }
    desc.textContent = t(descKeys[mode]);
  };

  render();
  subscribe('obsMode', render);
  subscribe('uiLang', render);

  /* The capture route's action. It also sets the background to the key
     colour OBS's chroma key defaults to, so the filter needs no colour picked;
     a real setting change rather than a capture-only override, so the picker
     beside it shows it and can still move it off green. The collapse is
     deliberately the same state the background click toggles — not a second
     mechanism. */
  container.querySelector('#obs-capture-enter')?.addEventListener('click', () => {
    settings.subBg = CAPTURE_KEY;
    settings.panelCollapsed = true;
  });
}

/* The steps are hidden behind "?", so the button wears the same pulsing ring
   as the toolbar's tour button (.is-hinting, css/tour.css) until it is opened
   once. */
function wireHelpHint(container) {
  const btn = container.querySelector('.obs-help-btn');
  const pop = container.querySelector('#popover-obs-help');
  if (!btn || !pop) return;

  btn.classList.toggle('is-hinting', !settings.obsHelpSeen);
  pop.addEventListener('toggle', (e) => {
    if (e.newState !== 'open') return;
    settings.obsHelpSeen = true;
    btn.classList.remove('is-hinting');
  });
}

/* Auto Setup adds sources to whatever scene is live in OBS, so a click only
   opens a confirm bubble; the bubble's own button does the work. The button
   is disabled while the WebSocket toggle is off — there is nothing it could
   reach. */
function wireAutoSetup(container) {
  const btn     = container.querySelector('#obs-auto-setup');
  const confirm = container.querySelector('#popover-obs-confirm');
  if (!btn || !confirm) return;

  const sync = () => { btn.disabled = !settings.obsEnabled; };
  sync();
  subscribe('obsEnabled', sync);

  /* The wording follows the nest option, read at the moment of asking. */
  const text = container.querySelector('#obs-confirm-text');
  btn.addEventListener('click', () => {
    if (text) {
      text.textContent = t(settings.obsNestSources ? 'obs.autoSetup.confirm.nested' : 'obs.autoSetup.confirm');
    }
    try { confirm.showPopover(); } catch { /* already open */ }
  });
  container.querySelector('#obs-confirm-cancel')?.addEventListener('click', () => {
    confirm.hidePopover();
  });
  container.querySelector('#obs-confirm-ok')?.addEventListener('click', () => {
    confirm.hidePopover();
    triggerAutoSetup();
  });
}

/* One button that opens or closes the subtitle window, labelled for whichever
   it will do — the label is the state, so there is no separate readout. The
   state comes from the window itself (js/subtitle-window.js), so a window
   closed from its own title bar, or left open across a reload of this page,
   reads correctly. */
function wireSubtitleWindow(container) {
  const btn = container.querySelector('#obs-window-toggle');
  if (!btn) return;

  let open = false;
  const render = () => {
    btn.textContent = t(open ? 'obs.window.close' : 'obs.window.open');
    btn.classList.toggle('primary', !open);
  };

  btn.addEventListener('click', () => {
    if (open) closeSubtitleWindow();
    else      openSubtitleWindow();
  });
  onSubtitleWindowState((state) => { open = state; render(); });
  subscribe('uiLang', render);
}

/* The toolbar's subtitle window button (index.html, #subwin-btn). Same toggle
   as the one in the OBS tab, but its label never changes — a toolbar button
   that swapped "open"/"close" would change width and shift its neighbours —
   so the state is carried by aria-pressed (lit while open) and the tooltip
   says what a click will do. */
export function mountSubtitleWindowButton(btn) {
  if (!btn) return;

  let open = false;
  const render = () => {
    btn.setAttribute('aria-pressed', String(open));
    btn.title = t(open ? 'obs.window.close' : 'obs.window.open');
  };

  btn.addEventListener('click', () => {
    if (open) closeSubtitleWindow();
    else      openSubtitleWindow();
  });
  onSubtitleWindowState((state) => { open = state; render(); });
  subscribe('uiLang', render);
}

/* Live connection status shown beside the WS toggle, so the user can tell
   whether the link to OBS actually works without opening the console. */
function wireConnStatus(container) {
  const el   = container.querySelector('#obs-conn-status');
  const text = container.querySelector('.obs-conn-text');
  const hint = container.querySelector('#obs-conn-hint');
  if (!el || !text || !hint) return;

  let current = { phase: 'disabled', code: null };

  const render = () => {
    el.dataset.phase = current.phase;
    text.textContent = connStatusText(current);

    /* Port-check guidance only helps when we can't reach the server — not for
       a wrong-password failure (4009), which has nothing to do with the port.
       The element keeps its reserved height even when empty, so showing/hiding
       the text never pushes the rest of the tab up or down. */
    const showHint = current.phase === 'retrying' && current.code !== 4009;
    hint.textContent = showHint ? t('obs.status.hint.checkPort') : '';
  };

  onConnectionState((state) => { current = state; render(); });
  /* Re-render in the new UI language without waiting for a state change. */
  subscribe('uiLang', render);
}

/* Map a connection state to a localized message. The close code lets us tell
   "server unreachable" (1006) from "wrong password" (4009) etc. */
function connStatusText({ phase, code }) {
  if (phase === 'disabled')   return t('obs.status.disabled');
  if (phase === 'connecting') return t('obs.status.connecting');
  if (phase === 'connected')  return t('obs.status.connected');

  /* phase === 'retrying' — show why it failed plus that it keeps retrying. */
  return `${failReason(code)} ${t('obs.status.retrying.suffix')}`;
}

function failReason(code) {
  if (code === 'badurl') return t('obs.status.failed.badurl');
  if (code === 1006)     return t('obs.status.failed.unreachable');
  if (code === 4009)     return t('obs.status.failed.auth');
  return `${t('obs.status.failed.generic')}${code != null ? ` (${code})` : ''}`;
}

