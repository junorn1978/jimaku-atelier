/**
 * @file ui-settings-dialog.js
 * @description Renders the application-level settings dialog. These controls
 * are intentionally separate from the sidebar tabs, which own subtitle,
 * language, filter, and OBS workflow settings.
 */

import { applyTo, t } from './i18n.js';
import { isDebugEnabled, setDebugEnabled } from './logger.js';
import { resetSettings } from './store.js';

/** Shown in the About section — the only place the version appears in the UI. */
const APP_VERSION = 'v1.7.1';

export function mountSettingsDialog(container) {
  if (!container) return;

  container.innerHTML = `
    <section class="dialog-section">
      <h3 data-i18n="settings.mic.title">マイク</h3>
      <dl class="about-list">
        <div>
          <dt data-i18n="settings.mic.default">既定のマイク</dt>
          <dd id="default-mic-name" data-i18n="header.mic.unknown">未選択</dd>
        </div>
      </dl>
    </section>

    <!-- Kept for reference rather than for use: the two-line scrolling mode
         misbehaves with long translations. It lives here instead of in a tab so
         the UI stops offering it to everyday users, while the code stays around
         as a working example for the project this one archives techniques for. -->
    <section class="dialog-section">
      <div class="dialog-setting-row">
        <div>
          <h3 data-i18n="style.overflow">翻訳字幕の行数</h3>
          <p data-i18n="style.overflow.deprecated">非推奨</p>
        </div>
        <div class="seg-switch" role="group">
          <label><input type="radio" name="subOverflow" value="normal" data-bind="subOverflow"><span data-i18n="style.overflow.normal">制限なし</span></label>
          <label><input type="radio" name="subOverflow" value="shrink" data-bind="subOverflow"><span data-i18n="style.overflow.shrink">2行 流動</span></label>
        </div>
      </div>
    </section>

    <section class="dialog-section">
      <div class="dialog-setting-row">
        <div>
          <h3 data-i18n="settings.debug.title">Debug log</h3>
          <p data-i18n="settings.debug.desc">Show detailed logs in the browser console.</p>
        </div>
        <label class="toggle">
          <input type="checkbox" id="settings-debug-toggle">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    </section>

    <section class="dialog-section">
      <div class="dialog-setting-row">
        <div>
          <h3 data-i18n="settings.reset.title">Reset settings</h3>
          <p data-i18n="settings.reset.desc">Restore all local settings to defaults and reload the app.</p>
        </div>
        <button type="button" class="btn danger" id="settings-reset-btn"
                data-i18n="settings.reset.button">Reset</button>
      </div>
    </section>

    <section class="dialog-section">
      <h3 data-i18n="settings.about.title">About</h3>
      <dl class="about-list">
        <div>
          <dt data-i18n="settings.about.app">App</dt>
          <!-- The toolbar has no room for a watermark, so the app's identity
               and version live here. Bump APP_VERSION on release. -->
          <dd><span data-i18n="app.title">字幕アトリエ</span>
              <span class="about-version">${APP_VERSION}</span></dd>
        </div>
        <div>
          <dt data-i18n="settings.about.storage">Storage</dt>
          <dd data-i18n="settings.about.storage.value">Settings are saved in this browser only.</dd>
        </div>
        <div>
          <dt data-i18n="settings.about.engines">Engines</dt>
          <dd data-i18n="settings.about.engines.value">Web Speech, Google Translate, Custom URL</dd>
        </div>
      </dl>
    </section>
  `;

  applyTo(container);

  const debugToggle = container.querySelector('#settings-debug-toggle');
  if (debugToggle) {
    debugToggle.checked = isDebugEnabled();
    debugToggle.addEventListener('change', () => setDebugEnabled(debugToggle.checked));
  }

  container.querySelector('#settings-reset-btn')?.addEventListener('click', () => {
    if (!confirm(t('settings.reset.confirm'))) return;
    resetSettings();
    location.reload();
  });
}
