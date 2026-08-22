/**
 * @file ui-layout.js
 * @description Layout toggles driven from the header.
 *
 *  - "toggle-panel" collapses the control card's tab body so the subtitle
 *    preview fills the window — handy for window-capture software (OBS, etc.)
 *    without needing the WebSocket overlay. The card's toolbar stays visible,
 *    so start/stop remains reachable while collapsed. The state persists via
 *    the settings store and is restored on load.
 *  - "toggle-manual" opens/closes the manual text-translation slide-up overlay.
 *    It's a secondary tool, so its open state is ephemeral (always starts
 *    closed on load) and is not persisted.
 */

import { settings, subscribe } from './store.js';
import { getLang } from './languages.js';
import { t } from './i18n.js';

/** Header button → store key → body class driving the CSS collapse. */
const TOGGLES = [
  { btnId: 'toggle-panel', key: 'panelCollapsed', cls: 'panel-collapsed' },
];

export function initLayoutToggles() {
  for (const { btnId, key, cls } of TOGGLES) {
    const btn = document.getElementById(btnId);
    if (!btn) continue;

    const set = (collapsed) => {
      settings[key] = collapsed;
      document.body.classList.toggle(cls, collapsed);
      btn.classList.toggle('is-active', collapsed);
      btn.setAttribute('aria-pressed', String(collapsed));
    };

    /* Restore persisted state on load. */
    set(settings[key] === true);

    btn.addEventListener('click', () => set(!document.body.classList.contains(cls)));
  }

  initToolbarStatus();
  initManualPanel();
}

/* Collapsed mode hides the tab body, and the language routing goes with it.
   This readout takes the tab picker's place so "am I translating into the right
   language?" is still answerable while the preview is being captured. It is
   deliberately not interactive — see the note in index.html. */
function initToolbarStatus() {
  const el = document.getElementById('toolbar-status');
  if (!el) return;

  /* 'none' is a real stored value for an unused target line, not a language. */
  const name = (id) => (!id || id === 'none' ? '' : (getLang(id)?.label || id));

  const render = () => {
    const source  = name(settings.sourceLangId);
    const targets = [settings.target1LangId, settings.target2LangId].map(name).filter(Boolean);

    const text = !source ? t('toolbar.status.noSource')
               : targets.length ? `${source} → ${targets.join(' · ')}`
               : source;

    el.textContent = text;
    /* The cell truncates with an ellipsis when the window is narrow; the title
       keeps the full routing reachable. */
    el.title = text;
  };

  render();
  /* uiLang only affects the "nothing selected" wording, but it still has to
     re-render — the labels themselves come from language_config.json. */
  ['sourceLangId', 'target1LangId', 'target2LangId', 'uiLang'].forEach(k => subscribe(k, render));
}

/* Manual text-translation overlay: opened from the header button, closed by its
   own close button (mounted by ui-manual-translate.js) or the header toggle. */
function initManualPanel() {
  const btn = document.getElementById('toggle-manual');
  const closeBtn = document.getElementById('manual-close');
  const cls = 'manual-open';

  const set = (open) => {
    document.body.classList.toggle(cls, open);
    if (btn) {
      btn.classList.toggle('is-active', open);
      btn.setAttribute('aria-pressed', String(open));
    }
  };

  /* Always start closed — the overlay is a secondary tool. */
  set(false);

  btn?.addEventListener('click', () => set(!document.body.classList.contains(cls)));
  closeBtn?.addEventListener('click', () => set(false));
}
