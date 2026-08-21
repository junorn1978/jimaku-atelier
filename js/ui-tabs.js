/**
 * @file ui-tabs.js
 * @description Settings-panel vertical tab rail (言語 / スタイル / 単語置換 / OBS).
 * The tab buttons and panels are static markup in index.html; this module only
 * wires switching. Panels toggle via the plain `hidden` attribute (re-asserted
 * in the CSS utilities layer, so it wins over any display rule), buttons get
 * `.is-active` + WAI-ARIA tab semantics with roving tabindex, and the active
 * tab name persists in the settings store (`settings.activeTab`).
 */

import { settings } from './store.js';

const TAB_NAMES = ['languages', 'style', 'filter', 'obs'];

export function initSettingsTabs() {
  const tablist = document.querySelector('.settings-tabs');
  if (!tablist) return;

  const buttons = [...tablist.querySelectorAll('[role="tab"]')];
  const panels = TAB_NAMES.map(name => document.getElementById(`tab-${name}`));

  function activate(name, { focus = false } = {}) {
    if (!TAB_NAMES.includes(name)) name = 'languages';

    buttons.forEach(btn => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
      btn.tabIndex = active ? 0 : -1;
      if (active && focus) btn.focus();
    });
    panels.forEach(panel => { if (panel) panel.hidden = panel.id !== `tab-${name}`; });

    settings.activeTab = name;
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => activate(btn.dataset.tab));
  });

  /* ARIA tabs pattern (vertical tablist): Up/Down move + activate, Home/End
     jump to the ends. */
  tablist.addEventListener('keydown', (e) => {
    const current = TAB_NAMES.indexOf(settings.activeTab);
    let next = -1;

    switch (e.key) {
      case 'ArrowUp':   next = (current - 1 + TAB_NAMES.length) % TAB_NAMES.length; break;
      case 'ArrowDown': next = (current + 1) % TAB_NAMES.length; break;
      case 'Home':       next = 0; break;
      case 'End':        next = TAB_NAMES.length - 1; break;
      default: return;
    }
    e.preventDefault();
    activate(TAB_NAMES[next], { focus: true });
  });

  /* Restore the last active tab; falls back to 'languages' inside activate()
     if the stored value is stale/corrupt. */
  activate(settings.activeTab);
}
