/**
 * @file ui-layout.js
 * @description Layout toggles driven from the header.
 *
 *  - "toggle-panel" collapses the bottom control panel (the settings tabs) so
 *    the subtitle preview fills the window — handy for window-capture software
 *    (OBS, etc.) without needing the WebSocket overlay. The state persists via
 *    the settings store and is restored on load.
 *  - "toggle-manual" opens/closes the manual text-translation slide-up overlay.
 *    It's a secondary tool, so its open state is ephemeral (always starts
 *    closed on load) and is not persisted.
 */

import { settings } from './store.js';

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

  initManualPanel();
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
