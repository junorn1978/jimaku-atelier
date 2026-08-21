/**
 * @file ui-manual-translate.js
 * @description Manual text translation tool. It lives as a slide-up overlay
 * over the subtitle preview, opened on demand from the header (see ui-layout.js),
 * since it's a secondary tool. It follows the active translation engine but
 * keeps its target language independent from the live subtitle target slots.
 */

import { getLanguage, t } from './i18n.js';
import { getAllLanguages } from './languages.js';
import { settings, subscribe } from './store.js';
import { translateManualText } from './controller.js';

const UI_LANG_TARGETS = Object.freeze({
  ja: 'ja-JP',
  'zh-TW': 'zh-TW',
  en: 'en-US',
});

let _sourceEl = null;
let _resultEl = null;
let _buttonEl = null;
let _statusEl = null;

export function mountManualTranslate(container) {
  if (!container) return;

  ensureDefaultTarget();

  const options = getAllLanguages()
    .map(l => `<option value="${escapeAttr(l.id)}" data-i18n="lang.name.${l.id}">${escapeAttr(l.label)}</option>`)
    .join('');

  container.innerHTML = `
    <div class="manual-panel-head">
      <span class="manual-panel-title" data-i18n="manual.title">テキスト翻訳</span>
      <button type="button" class="icon-btn" id="manual-close"
              data-i18n-title="dialog.close" data-i18n-aria-label="dialog.close"
              title="閉じる" aria-label="閉じる">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <div class="manual-translate-texts">
      <label class="manual-field">
        <span data-i18n="manual.source">入力原文</span>
        <textarea id="manual-source-text" class="text-input manual-textarea"
                  data-i18n-placeholder="manual.source.ph"
                  autocomplete="off" spellcheck="false"></textarea>
      </label>
      <label class="manual-field">
        <span data-i18n="manual.result">翻訳文</span>
        <textarea id="manual-result-text" class="text-input manual-textarea"
                  data-i18n-placeholder="manual.result.ph"
                  readonly></textarea>
      </label>
    </div>

    <div class="manual-translate-toolbar">
      <div class="manual-actions">
        <label class="manual-target">
          <span class="visually-hidden" data-i18n="manual.target">翻訳先</span>
          <select class="select" id="manual-target-lang" data-bind="manualTargetLangId">
            ${options}
          </select>
        </label>
        <button type="button" class="btn primary" id="manual-translate-btn">
          <span data-i18n="manual.translate">翻訳</span>
        </button>
      </div>
    </div>
    <div class="manual-status" id="manual-translate-status" role="status" aria-live="polite"></div>
  `;

  _sourceEl = container.querySelector('#manual-source-text');
  _resultEl = container.querySelector('#manual-result-text');
  _buttonEl = container.querySelector('#manual-translate-btn');
  _statusEl = container.querySelector('#manual-translate-status');

  container.querySelector('#manual-target-lang')?.addEventListener('change', () => {
    settings.manualTargetFollowsUiLang = false;
  });

  _buttonEl?.addEventListener('click', runManualTranslate);
  _sourceEl?.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runManualTranslate();
    }
  });

  subscribe('uiLang', () => {
    if (!settings.manualTargetFollowsUiLang) return;
    settings.manualTargetLangId = defaultTargetForUiLang();
  });
}

async function runManualTranslate() {
  const text = _sourceEl?.value?.trim() || '';
  if (!text) {
    setStatus(t('manual.error.empty'), 'error');
    return;
  }

  const targetLangId = settings.manualTargetLangId || defaultTargetForUiLang();
  setBusy(true);
  setStatus(t('manual.status.translating'));

  try {
    const result = await translateManualText(text, targetLangId);
    if (_resultEl) _resultEl.value = result?.text || '';
    setStatus('');
  } catch (err) {
    if (_resultEl) _resultEl.value = '';
    setStatus(err?.message || t('manual.error.failed'), 'error');
  } finally {
    setBusy(false);
  }
}

function ensureDefaultTarget() {
  const ids = new Set(getAllLanguages().map(l => l.id));
  if (!settings.manualTargetLangId || !ids.has(settings.manualTargetLangId)) {
    settings.manualTargetLangId = defaultTargetForUiLang();
  }
}

function defaultTargetForUiLang() {
  return UI_LANG_TARGETS[getLanguage()] || 'en-US';
}

function setBusy(isBusy) {
  if (_buttonEl) _buttonEl.disabled = isBusy;
  if (_sourceEl) _sourceEl.readOnly = isBusy;
}

function setStatus(text, type = '') {
  if (!_statusEl) return;
  _statusEl.textContent = text || '';
  _statusEl.dataset.type = type;
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
