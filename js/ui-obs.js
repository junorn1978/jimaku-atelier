/**
 * @file ui-obs.js
 * @description OBS UI: route picker, and per route its few settings and its one
 * action — WebSocket (connection status, open the OBS window), the subtitle
 * window (key colour, open/close) and window capture (background colour, enter
 * capture mode). Step-by-step instructions live in a "?" popover.
 * Appended into its own tab panel (#tab-obs) as an `.obs-section`.
 *
 * WebSocket's settings — connection, Auto Setup, the scene link — are not
 * here but in a window of their own (obs-settings.html,
 * js/obs-settings-page.js): this window is often captured onto the stream,
 * and those would put OBS's scene names and the password field on it.
 */

import { settings, subscribe } from './store.js';
import { applyTo, t } from './i18n.js';
import { CHANNEL, perChannel } from './channel.js';
import { wireConnStatus } from './ui-obs-status.js';
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
        <button type="button" class="btn primary" id="obs-settings-open" data-mode="websocket"
                data-i18n="obs.settings.open">OBS 連携ウィンドウを開く</button>
        <button type="button" class="btn primary" id="obs-window-toggle" data-mode="window" hidden
                data-i18n="obs.window.open">字幕ウィンドウを開く</button>
        <button type="button" class="btn primary" id="obs-capture-enter" data-mode="capture" hidden
                data-i18n="obs.capture.enter">キャプチャモードにする</button>
      </div>
    </div>

    <p class="obs-mode-desc" id="obs-mode-desc"></p>

    <div class="obs-body" id="obs-mode-websocket">
      <div class="obs-conn">
        <p class="obs-conn-status" role="status" aria-live="polite" data-phase="disabled">
          <span class="obs-conn-dot" aria-hidden="true"></span>
          <span class="obs-conn-text"></span>
        </p>
        <p class="obs-conn-hint"></p>
      </div>
      <p class="obs-inline-hint" data-i18n="obs.settings.note"></p>
      <p class="obs-inline-hint" id="obs-scene-link-on" data-i18n="obs.sceneLink.onNote" hidden></p>
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

  wireConnStatus(section.querySelector('#obs-mode-websocket'));
  wireModeSwitch(section);
  wireObsWindow(section);
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

/* The OBS window (obs-settings.html). Asked for with no URL first, as the
   second window is (js/second-window.js): one already open is handed back as
   it is rather than reloaded. Opened from the second window it carries ?ch=2,
   so its Auto Setup makes that window's sources. The tab also says when the
   scene link is on, since recognition then starts and stops by itself. */
const OBS_WINDOW_NAME = perChannel('rtl-obs-settings');

function openObsWindow() {
  const url = new URL('obs-settings.html', location.href);
  if (CHANNEL === 2) url.searchParams.set('ch', '2');
  const win = window.open('', OBS_WINDOW_NAME, 'popup,width=760,height=720');
  if (!win) {
    alert(t('obs.settings.blocked'));
    return;
  }
  if (win.location.href === 'about:blank') win.location.href = url.href;
  win.focus();
}

function wireObsWindow(container) {
  container.querySelector('#obs-settings-open')?.addEventListener('click', openObsWindow);

  const note = container.querySelector('#obs-scene-link-on');
  if (!note) return;
  const sync = () => { note.hidden = !settings.obsSceneLink; };
  sync();
  subscribe('obsSceneLink', sync);
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
