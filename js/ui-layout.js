/**
 * @file ui-layout.js
 * @description Layout toggles for the control panel.
 *
 *  - Collapsing the control card's tab body lets the subtitle preview fill the
 *    window — handy for window-capture software (OBS, etc.) without needing the
 *    WebSocket overlay. The card's toolbar stays visible, so start/stop remains
 *    reachable while collapsed. It is toggled by clicking the background rather
 *    than a button: the whole area outside the card is pure display, so the
 *    gesture has nothing else to collide with and needs no target to aim at
 *    while the panel is collapsed to a thin strip. The state persists via the
 *    settings store and is restored on load.
 *  - "toggle-lock" freezes that gesture. Capture mode is a streaming state, and
 *    a background this large is easy to hit by accident; the lock is what makes
 *    click-anywhere safe to leave on. It only blocks the click — code that
 *    writes panelCollapsed (the OBS tab's capture button) still goes through.
 *  - "toggle-manual" opens/closes the manual text-translation slide-up overlay.
 *    It's a secondary tool, so its open state is ephemeral (always starts
 *    closed on load) and is not persisted.
 */

import { settings, subscribe } from './store.js';
import { getLang } from './languages.js';
import { t } from './i18n.js';

/* Everything the background click must keep its hands off: the card itself,
   the manual overlay floating over the preview, any open dialog (a click on a
   modal's backdrop targets the <dialog>), and the colour popover, which is
   mounted on <body> and so would otherwise read as background. */
const FOREGROUND = '.control-card, .manual-translate-panel, dialog, .color-popover';

/** Pointer travel (px) above which a click is treated as a drag, not a tap. */
const DRAG_SLOP = 6;

export function initLayoutToggles() {
  initPanelCollapse();
  initPanelLock();
  initToolbarStatus();
  initManualPanel();
}

/* The body class is driven by the setting rather than by the click, so anything
   else that writes the store — the OBS tab's capture-mode button, for one —
   collapses the panel too instead of only the gesture working. */
function initPanelCollapse() {
  const apply = (collapsed) => {
    document.body.classList.toggle('panel-collapsed', collapsed === true);
  };

  /* Restore persisted state on load, then follow it. */
  apply(settings.panelCollapsed);
  subscribe('panelCollapsed', apply);

  const isBackground = (node) =>
    node instanceof Element && !node.closest(FOREGROUND);

  /* Where the press started matters as much as where it ended: a drag that
     begins on a slider inside the card and finishes over the preview is not a
     background click, and neither is a text selection swept across the
     subtitles. Both are ruled out by requiring one near-stationary press and
     release, both on the background.
     The colour popover is the other case worth remembering from the press: it
     closes on an outside click, and that click is aimed at dismissing it, not
     at the panel — collapsing the whole card on the way out of picking a
     colour is not what the user asked for. */
  let start = null;

  document.addEventListener('pointerdown', (e) => {
    start = isBackground(e.target)
      ? { x: e.clientX, y: e.clientY, dismissing: !!document.querySelector('.color-popover.is-open') }
      : null;
  });

  document.addEventListener('click', (e) => {
    const from = start;
    start = null;
    if (settings.panelLocked === true) return;
    if (!from || from.dismissing || !isBackground(e.target)) return;
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > DRAG_SLOP) return;
    settings.panelCollapsed = !settings.panelCollapsed;
  });
}

/* The lock lives on <body> as well as on the button: the cursor over the
   background has to say whether a click there still does anything. */
function initPanelLock() {
  const btn = document.getElementById('toggle-lock');

  const apply = (locked) => {
    document.body.classList.toggle('panel-locked', locked === true);
    btn?.classList.toggle('is-active', locked === true);
    btn?.setAttribute('aria-pressed', String(locked === true));
  };

  apply(settings.panelLocked);
  subscribe('panelLocked', apply);

  btn?.addEventListener('click', () => { settings.panelLocked = !settings.panelLocked; });
}

/* Collapsed mode hides the tab body, and the language routing goes with it.
   This readout takes the tab picker's place so "am I translating into the right
   language?" is still answerable while the preview is being captured. It is
   deliberately not interactive — see the note in index.html. */
function initToolbarStatus() {
  const el = document.getElementById('toolbar-status');
  if (!el) return;

  /* 'none' is a real stored value for an unused target line, not a language.
     Names come from the same lang.name.* keys the pickers use, so the readout
     follows the UI language; t() echoes the key back when it has no entry, which
     is the signal to fall back to the config's own label. */
  const name = (id) => {
    if (!id || id === 'none') return '';
    const key = `lang.name.${id}`;
    const localised = t(key);
    return localised === key ? (getLang(id)?.label || id) : localised;
  };

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
