/**
 * @file main.js
 * @description Application entry point. Loads infrastructure (i18n, language
 * config), mounts each tab's UI, applies form-to-store bindings, kicks off the
 * preview projection, and wires document-level interactions.
 */

import { settings } from './store.js';
import { setLanguage, getLanguage, applyTo } from './i18n.js';
import { loadLanguages } from './languages.js';
import { loadConfig } from './config.js';
import { isDebugEnabled } from './logger.js';
import { initPreviewBinding } from './preview.js';
import { bindInputs } from './ui-bind.js';
import { mountLanguagesTab } from './ui-languages.js';
import { mountStyleTab } from './ui-style.js';
import { mountFilterTab } from './ui-filter.js';
import { mountObsTab } from './ui-obs.js';
import { mountManualTranslate } from './ui-manual-translate.js';
import { mountSettingsDialog } from './ui-settings-dialog.js';
import { initSpeech } from './speech.js';
import { initFilter } from './filter.js';
import { initObs } from './obs.js';
import { initLayoutToggles } from './ui-layout.js';

async function init() {
  /* Load static config first — UI rendering depends on it. */
  await Promise.all([
    loadLanguages(),
    loadConfig().catch(err => {
      /* config.json is required for gtx mode; surface the failure but keep
         the rest of the app usable (link mode still works). */
      if (isDebugEnabled()) console.warn('[main] config load failed:', err);
    }),
  ]);
  await setLanguage(settings.uiLang || 'ja');

  /* Mount each tab's content. */
  mountLanguagesTab(document.getElementById('tab-panel-languages'));
  mountStyleTab(document.getElementById('tab-panel-style'));
  mountFilterTab(document.getElementById('tab-panel-filter'));
  mountObsTab(document.getElementById('tab-panel-obs'));
  mountManualTranslate(document.getElementById('manual-translate-panel'));
  mountSettingsDialog(document.querySelector('#dialog-settings .dialog-body'));

  /* New DOM was just injected — re-apply translations and hook up bindings. */
  applyTo(document);
  bindInputs(document);

  /* Project subtitle settings onto CSS variables. */
  initPreviewBinding();

  /* Compile filter rules now that settings are loaded. */
  initFilter();

  /* Manage OBS WS connection lifecycle. */
  initObs();

  /* Start/stop buttons, mic info, recognition lifecycle. */
  initSpeech();

  /* Document-level interactions. */
  syncLangSwitcher();
  wireLangSwitcher();
  wireTabs();
  wireDialogs();
  initLayoutToggles();

  if (isDebugEnabled()) console.debug('[main] init complete');
}

/* -------- interface language switcher -------- */

function wireLangSwitcher() {
  document.querySelectorAll('.seg-switch button[data-lang]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang;
      if (!lang || lang === getLanguage()) return;
      await setLanguage(lang);
      settings.uiLang = lang;
      syncLangSwitcher();
    });
  });
}

function syncLangSwitcher() {
  const active = getLanguage();
  document.querySelectorAll('.seg-switch button[data-lang]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.lang === active);
  });
}

/* -------- tab switching -------- */

function wireTabs() {
  const tabs   = document.querySelectorAll('.tab-bar [role="tab"]');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab, tabs, panels));
  });
}

function activateTab(target, tabs, panels) {
  tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === target ? 'true' : 'false'));
  panels.forEach(p => { p.hidden = p.dataset.tab !== target; });
}

/* -------- dialogs -------- */

function wireDialogs() {
  document.getElementById('open-settings-dialog')?.addEventListener('click', () => {
    document.getElementById('dialog-settings')?.showModal();
  });

  /* Any element with [data-close-dialog] inside a <dialog> closes it. */
  document.querySelectorAll('[data-close-dialog]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('dialog')?.close());
  });

  /* Click on backdrop closes the dialog (native <dialog> doesn't do this by default). */
  document.querySelectorAll('dialog.app-dialog').forEach(dlg => {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
