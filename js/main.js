/**
 * @file main.js
 * @description Application entry point. Loads infrastructure (i18n, language
 * config), mounts each tab's UI, applies form-to-store bindings, kicks off the
 * output projection, and wires document-level interactions.
 */

import { settings } from './store.js';
import { setLanguage, getLanguage, applyTo } from './i18n.js';
import { loadLanguages } from './languages.js';
import { isDebugEnabled } from './logger.js';
import { initOutputBinding } from './output.js';
import { bindInputs } from './ui-bind.js';
import { initColorPickers } from './color-picker.js';
import { mountLanguagesTab } from './ui-languages.js';
import { mountFilterTab } from './ui-filter.js';
import { mountObsTab } from './ui-obs.js';
import { mountManualTranslate } from './ui-manual-translate.js';
import { mountSettingsDialog } from './ui-settings-dialog.js';
import { initSpeech } from './speech.js';
import { initFilter } from './filter.js';
import { initObs } from './obs.js';
import { initLayoutToggles } from './ui-layout.js';
import { initSettingsTabs } from './ui-tabs.js';
import { initTour } from './tour.js';

async function init() {
  /* Language metadata is the only thing that has to be fetched before the UI
     can render; the gtx credentials are literals in translate-gtx.js. */
  await loadLanguages();
  await setLanguage(settings.uiLang || 'en');

  /* Ahead of the mounts: initFilter() migrates blacklists written by an older
     version, and the filter tab renders that list. */
  initFilter();

  /* Mount each settings tab into its own panel (static markup in index.html;
     switching is wired by initSettingsTabs below). */
  mountLanguagesTab(document.getElementById('tab-languages'));
  mountFilterTab(document.getElementById('tab-filter'));
  mountObsTab(document.getElementById('tab-obs'));
  mountManualTranslate(document.getElementById('manual-translate-panel'));
  mountSettingsDialog(document.querySelector('#dialog-settings .dialog-body'));

  /* New DOM was just injected — re-apply translations and hook up bindings. */
  applyTo(document);
  bindInputs(document);

  /* After bindInputs: the palette reads each hidden colour input's seeded
     value to paint its trigger. */
  initColorPickers();

  /* Project subtitle settings onto CSS variables. */
  initOutputBinding();

  /* Manage OBS WS connection lifecycle. */
  initObs();

  /* Start/stop buttons, mic info, recognition lifecycle. */
  initSpeech();

  /* Document-level interactions. */
  syncLangSwitcher();
  wireLangSwitcher();
  wireDialogs();
  initLayoutToggles();
  initSettingsTabs();

  /* Last: it reads the toolbar button it wires, and on the first launches it
     puts a ring on it. Nothing is opened here — the tour only ever runs when
     the user asks for it. */
  initTour();

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

/* The UI is cloaked until this finishes — see .is-booting in css/styles.css.
   Revealing from .finally() rather than from the end of init(): a boot that
   throws half-way has to hand over whatever did mount, not an empty window. */
document.addEventListener('DOMContentLoaded', () => {
  init().finally(() => document.documentElement.classList.remove('is-booting'));
});
