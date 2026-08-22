/**
 * @file ui-obs.js
 * @description OBS UI: WebSocket enable toggle, URL/password inputs, drag links
 * (drag onto OBS to create a browser source), and a one-click Auto Setup button.
 * Appended into its own tab panel (#tab-obs) as an `.obs-section`.
 */

import { settings, subscribe } from './store.js';
import { applyTo, t } from './i18n.js';
import { triggerAutoSetup, getOverlayUrl, onConnectionState } from './obs.js';
import { wireSecretInputs } from './ui-secret-input.js';

/* Grip dots: mark the drag chips as draggable at a glance, so they don't
   read as push buttons. */
const GRIP_SVG = `
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="5.5" r="1.7"/><circle cx="15" cy="5.5" r="1.7"/>
    <circle cx="9" cy="12"  r="1.7"/><circle cx="15" cy="12"  r="1.7"/>
    <circle cx="9" cy="18.5" r="1.7"/><circle cx="15" cy="18.5" r="1.7"/>
  </svg>
`;

export function mountObsTab(container) {
  if (!container) return;

  const section = document.createElement('div');
  section.className = 'obs-section';
  section.innerHTML = `
    <!-- The two routes share almost nothing: WebSocket needs a connection and
         source creation, window capture needs neither. Showing both at once
         would leave half the tab inapplicable whichever route you picked, so
         the switch swaps the whole body rather than just the instructions. -->
    <div class="obs-mode-head">
      <div class="seg-switch" role="group" data-i18n-aria-label="obs.mode" aria-label="連携方式">
        <label><input type="radio" name="obsMode" value="websocket" data-bind="obsMode"><span data-i18n="obs.mode.ws">WebSocket</span></label>
        <label><input type="radio" name="obsMode" value="capture" data-bind="obsMode"><span data-i18n="obs.mode.capture">ウィンドウキャプチャ</span></label>
      </div>
      <p class="obs-mode-desc" id="obs-mode-desc"></p>
    </div>

    <div class="panel-cols" id="obs-mode-websocket">
      <section class="panel-col">
        <h3 class="section-title" data-i18n="obs.connection">接続設定</h3>
        <div class="form-row">
          <span class="form-row-label" data-i18n="obs.enabled">WS 接続</span>
          <label class="toggle">
            <input type="checkbox" data-bind="obsEnabled">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <div class="obs-conn">
          <p class="obs-conn-status" id="obs-conn-status" role="status" aria-live="polite" data-phase="disabled">
            <span class="obs-conn-dot" aria-hidden="true"></span>
            <span class="obs-conn-text"></span>
          </p>
          <p class="obs-conn-hint" id="obs-conn-hint"></p>
        </div>

        <div class="obs-conn-fields">
        <div class="form-row form-row-stack">
          <span class="form-row-label" data-i18n="obs.url">URL</span>
          <input type="text" class="text-input" data-bind="obsUrl"
                 placeholder="ws://127.0.0.1:4455"
                 autocomplete="off" spellcheck="false" autocorrect="off">
        </div>

        <div class="form-row form-row-stack">
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
      </section>

      <section class="panel-col">
        <h3 class="section-title" data-i18n="obs.sources">ソース作成</h3>
        <div class="obs-drag-grid">
          <a class="btn obs-drag-link" id="obs-drag-all"
             draggable="true" data-i18n-title="obs.drag.all.tip">
            ${GRIP_SVG}<span data-i18n="obs.drag.all">全表示</span></a>
          <a class="btn obs-drag-link" id="obs-drag-source"
             draggable="true" data-i18n-title="obs.drag.source.tip">
            ${GRIP_SVG}<span data-i18n="obs.drag.source">音声</span></a>
          <a class="btn obs-drag-link" id="obs-drag-target1"
             draggable="true" data-i18n-title="obs.drag.target1.tip">
            ${GRIP_SVG}<span data-i18n="obs.drag.target1">翻訳 1</span></a>
          <a class="btn obs-drag-link" id="obs-drag-target2"
             draggable="true" data-i18n-title="obs.drag.target2.tip">
            ${GRIP_SVG}<span data-i18n="obs.drag.target2">翻訳 2</span></a>
        </div>
        <button type="button" class="btn primary" id="obs-auto-setup"
                data-i18n="obs.autoSetup">OBS 自動構築</button>
        <p class="form-hint" data-i18n="obs.autoSetup.hint">
          現在のシーンに4つの字幕ソースを自動で追加します。
        </p>
      </section>

      <section class="panel-col">
        <h3 class="section-title" data-i18n="obs.help.title">使い方</h3>
        <ol class="help-steps">
          <li data-i18n="obs.help.step1">OBS で WebSocket Server を有効にします。</li>
          <li data-i18n="obs.help.step2">URL とパスワードを確認し、WS 接続をオンにします。</li>
          <li data-i18n="obs.help.step3">OBS 自動構築を押すか、上のリンクを OBS のソース一覧へドラッグします。</li>
          <li data-i18n="obs.help.step4">音声認識を開始すると、字幕が OBS に同期されます。</li>
        </ol>
        <p class="form-hint" data-i18n="obs.help.note">
          ソース作成は自動構築とドラッグのどちらか一方で十分です。
        </p>
      </section>
    </div>

    <div class="panel-cols" id="obs-mode-capture" hidden>
      <section class="panel-col">
        <h3 class="section-title" data-i18n="obs.capture.bg">背景色</h3>
        <!-- Bound to the same setting as the languages tab. Two entry points
             for one value is fine here: this is the colour the chroma key will
             remove, so it belongs in the capture workflow as much as it does in
             the subtitle appearance settings. A button rather than a filled
             swatch — a swatch painted in the key colour is itself keyed out of
             a window capture. -->
        <label class="btn color-pick">
          <input type="color" class="visually-hidden" data-bind="subBg">
          <output class="color-value"></output>
        </label>
        <p class="form-hint" data-i18n="obs.capture.bg.hint">
          クロマキーで抜く色です。
        </p>
      </section>

      <!-- The OBS-side work comes first on purpose: the last step collapses
           this panel, which takes these instructions with it. -->
      <section class="panel-col">
        <h3 class="section-title" data-i18n="obs.help.title">使い方</h3>
        <ol class="help-steps">
          <li data-i18n="obs.capture.step1">OBS に［ウィンドウキャプチャ］を追加します。</li>
          <li data-i18n="obs.capture.step2">［クロマキー］フィルタを追加します。</li>
          <li data-i18n="obs.capture.step3">下のボタンでキャプチャモードにします。</li>
        </ol>
        <button type="button" class="btn primary" id="obs-capture-enter"
                data-i18n="obs.capture.enter">キャプチャモードにする</button>
        <p class="form-hint" data-i18n="obs.capture.enter.hint">
          コントロールパネルを畳みます。
        </p>
      </section>

      <section class="panel-col">
        <h3 class="section-title" data-i18n="obs.capture.notes">注意</h3>
        <ul class="help-notes">
          <li data-i18n="obs.capture.note1">字幕に背景色と同じ色を使わないでください。</li>
          <li data-i18n="obs.capture.note2">ウィンドウを最小化しないでください。</li>
          <li data-i18n="obs.capture.note3">縁が残る場合はクロマキーの類似性を上げてください。</li>
          <li data-i18n="obs.capture.note4">ブラウザのズームは字幕の文字サイズとは別です。</li>
        </ul>
      </section>
    </div>
  `;

  container.appendChild(section);

  /* Drag link hrefs depend on current URL/password; refresh when they change. */
  const refreshDragLinks = () => {
    section.querySelector('#obs-drag-all')    .href = getOverlayUrl('all');
    section.querySelector('#obs-drag-source') .href = getOverlayUrl('source');
    section.querySelector('#obs-drag-target1').href = getOverlayUrl('target1');
    section.querySelector('#obs-drag-target2').href = getOverlayUrl('target2');
  };
  refreshDragLinks();
  subscribe('obsUrl',      refreshDragLinks);
  subscribe('obsPassword', refreshDragLinks);

  section.querySelector('#obs-auto-setup').addEventListener('click', triggerAutoSetup);
  wireSecretInputs(section);
  wireConnStatus(section);
  wireModeSwitch(section);

  applyTo(section);
}

/* Swap the tab body between the two integration routes, and describe the
   trade-off of whichever one is showing. */
function wireModeSwitch(container) {
  const ws      = container.querySelector('#obs-mode-websocket');
  const capture = container.querySelector('#obs-mode-capture');
  const desc    = container.querySelector('#obs-mode-desc');
  if (!ws || !capture || !desc) return;

  const render = () => {
    const mode = settings.obsMode === 'capture' ? 'capture' : 'websocket';
    ws.hidden      = mode !== 'websocket';
    capture.hidden = mode !== 'capture';
    desc.textContent = t(mode === 'capture' ? 'obs.mode.capture.desc' : 'obs.mode.ws.desc');
  };

  render();
  subscribe('obsMode', render);
  subscribe('uiLang', render);

  /* The last step of the capture route. Deliberately the same state the
     toolbar's panel button toggles — this is the button you reach for while
     reading the steps, not a second mechanism. */
  container.querySelector('#obs-capture-enter')?.addEventListener('click', () => {
    settings.panelCollapsed = true;
  });
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

