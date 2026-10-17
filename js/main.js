/**
 * @file main.js
 * @description Application entry point. Loads infrastructure (i18n, language
 * config), mounts each tab's UI, applies form-to-store bindings, kicks off the
 * output projection, and wires document-level interactions.
 */

import { settings, subscribe, renotify } from './store.js';
import { setLanguage, getLanguage, applyTo } from './i18n.js';
import { loadLanguages } from './languages.js';
import { isDebugEnabled } from './logger.js';
import { initOutputBinding } from './output.js';
import { initTheme } from './theme.js';
import { bindInputs } from './ui-bind.js';
import { initColorPickers } from './color-picker.js';
import { mountLanguagesTab } from './ui-languages.js';
import { mountFilterTab } from './ui-filter.js';
import { mountObsTab, mountSubtitleWindowButton } from './ui-obs.js';
import { mountManualTranslate } from './ui-manual-translate.js';
import { mountSettingsDialog } from './ui-settings-dialog.js';
import { initSpeech } from './speech.js';
import { initFilter } from './filter.js';
import { initObs } from './obs.js';
import { initSubtitleWindow } from './subtitle-window.js';
import { initLayoutToggles } from './ui-layout.js';
import { initSettingsTabs } from './ui-tabs.js';
import { initTour } from './tour.js';
import { mountMicPanel } from './ui-mic.js';
import { mountSecondWindowButton } from './second-window.js';
import { isMobile } from './env.js';

async function init() {
  /* First, before anything awaits: the page is cloaked while booting, but the
     window background is not, and a light-theme user would otherwise see it
     flash dark. */
  initTheme();

  /* Phones and tablets stop here (see js/env.js), before anything asks for a
     permission or starts a recogniser that only restarts in a loop there. */
  if (isMobile) {
    showUnsupported();
    return;
  }

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
  mountMicPanel(document.getElementById('mic-btn'), document.getElementById('mic-panel'));
  mountSubtitleWindowButton(document.getElementById('subwin-btn'));
  mountSecondWindowButton(document.getElementById('second-window-btn'));

  /* New DOM was just injected — re-apply translations and hook up bindings. */
  applyTo(document);
  bindInputs(document);

  /* After bindInputs: the palette reads each hidden colour input's seeded
     value to paint its trigger. */
  initColorPickers();

  /* Project subtitle settings onto CSS variables. */
  initOutputBinding();

  /* Mirror the output pane to the subtitle window, if one is or gets opened.
     After initOutputBinding, so the first state it sends is already styled. */
  initSubtitleWindow();

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

/* -------- unsupported device -------- */

/* In all three interface languages at once rather than through i18n: a first
   visit has no chosen language yet, and the notice needs no fetch to show. */
const UNSUPPORTED_TEXT = [
  ['ja',    'このツールはパソコン版の Chrome / Edge 専用です。スマートフォン・タブレットには対応していません。パソコンで次のアドレスを開いてください。'],
  ['zh-TW', '本工具僅支援電腦版 Chrome / Edge，不支援手機與平板。請在電腦上開啟以下網址：'],
  ['en',    'This tool runs only in Chrome or Edge on a computer. Phones and tablets are not supported. Open this address on a computer:'],
];

function showUnsupported() {
  const card = document.createElement('div');
  card.className = 'unsupported-card';
  const title = document.createElement('h1');
  title.textContent = document.title;
  card.append(title);
  for (const [lang, text] of UNSUPPORTED_TEXT) {
    const p = document.createElement('p');
    p.lang = lang;
    p.textContent = text;
    card.append(p);
  }
  const url = document.createElement('p');
  url.className = 'unsupported-url';
  url.textContent = location.origin + location.pathname;
  card.append(url);
  document.body.replaceChildren(card);
  document.body.classList.add('is-unsupported');
}

/* -------- interface language switcher -------- */

function wireLangSwitcher() {
  /* The interface language is shared with the second window (js/channel.js):
     switched there, the store reports it here, and this window follows. Its
     other uiLang subscribers ran on that report already, with the dictionary
     not loaded yet, so they are told again once it is. A switch made here
     loads first and stores after, and passes straight through. */
  subscribe('uiLang', async (lang) => {
    if (!lang || lang === getLanguage()) return;
    await setLanguage(lang);
    syncLangSwitcher();
    renotify('uiLang');
  });

  const menu = document.getElementById('lang-menu');
  menu?.querySelectorAll('button[data-lang]').forEach(btn => {
    btn.addEventListener('click', async () => {
      menu.hidePopover();
      const lang = btn.dataset.lang;
      if (!lang || lang === getLanguage()) return;
      await setLanguage(lang);
      settings.uiLang = lang;
      syncLangSwitcher();
    });
  });
}

/* The toolbar button shows the active language's short form; the menu marks
   it as the checked item. */
function syncLangSwitcher() {
  const active = getLanguage();
  document.querySelectorAll('#lang-menu button[data-lang]').forEach(btn => {
    const on = btn.dataset.lang === active;
    btn.setAttribute('aria-checked', String(on));
    if (on) {
      const current = document.querySelector('#lang-btn .lang-btn-current');
      if (current) current.textContent = btn.dataset.short;
    }
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
