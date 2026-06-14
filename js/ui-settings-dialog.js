/**
 * @file ui-settings-dialog.js
 * @description Renders the application-level settings dialog. These controls
 * are intentionally separate from the sidebar tabs, which own subtitle,
 * language, filter, and OBS workflow settings.
 */

import { applyTo, t } from './i18n.js';
import { isDebugEnabled, setDebugEnabled } from './logger.js';
import { resetSettings } from './store.js';

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
          <dd data-i18n="app.title">字幕アトリエ</dd>
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
