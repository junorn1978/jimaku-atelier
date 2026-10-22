/**
 * @file obs-settings-page.js
 * @description The OBS window (obs-settings.html), opened from the OBS tab:
 * WebSocket connection, Auto Setup and the scene link. Kept out of the app
 * window because that one is often captured onto the stream, and this one
 * shows OBS's scene names and the password field.
 *
 * Everything here is a setting in the shared store, so the app windows see a
 * change through the storage event (js/store.js) and nothing else has to pass
 * between them. Opened from either app window, it changes the same settings.
 *
 * It holds a connection to OBS of its own — for the scene list and for Auto
 * Setup — but never broadcasts: it has no subtitles, and an empty update
 * would blank the overlays (initObs({ subtitles: false }), js/obs.js).
 */

import { settings, subscribe, renotify } from './store.js';
import { setLanguage, getLanguage, applyTo, t } from './i18n.js';
import { initTheme } from './theme.js';
import { bindInputs } from './ui-bind.js';
import { wireSecretInputs } from './ui-secret-input.js';
import { wireConnStatus } from './ui-obs-status.js';
import {
  initObs, triggerAutoSetup, onConnectionState, onSceneListChanged, fetchSceneNames,
} from './obs.js';
import { SCENE_ACTIONS, sceneAction, setSceneAction } from './obs-scene-link.js';

async function init() {
  initTheme();
  await setLanguage(settings.uiLang || 'en');

  applyTo(document);
  bindInputs(document);
  wireSecretInputs(document);
  wireConnStatus(document);
  wireAutoSetup();
  wireSceneList();
  followUiLanguage();

  initObs({ subtitles: false });
}

/* The interface language is switched in the app window; follow it here. */
function followUiLanguage() {
  subscribe('uiLang', async (lang) => {
    if (!lang || lang === getLanguage()) return;
    await setLanguage(lang);
    renotify('uiLang');
  });
}

/* Auto Setup adds sources to whatever scene is live in OBS, so a click only
   opens a confirm bubble; the bubble's own button does the work. The button
   is disabled while the WebSocket toggle is off — there is nothing it could
   reach. */
function wireAutoSetup() {
  const btn     = document.getElementById('obs-auto-setup');
  const confirm = document.getElementById('popover-obs-confirm');
  if (!btn || !confirm) return;

  const sync = () => { btn.disabled = !settings.obsEnabled; };
  sync();
  subscribe('obsEnabled', sync);

  /* The wording follows the nest option, read at the moment of asking. */
  const text = document.getElementById('obs-confirm-text');
  btn.addEventListener('click', () => {
    if (text) {
      text.textContent = t(settings.obsNestSources ? 'obs.autoSetup.confirm.nested' : 'obs.autoSetup.confirm');
    }
    try { confirm.showPopover(); } catch { /* already open */ }
  });
  document.getElementById('obs-confirm-cancel')?.addEventListener('click', () => {
    confirm.hidePopover();
  });
  document.getElementById('obs-confirm-ok')?.addEventListener('click', () => {
    confirm.hidePopover();
    triggerAutoSetup();
  });
}

/* ============ scene link ============ */

/* OBS's scenes, one row each with its action. Shown only while the link is
   on; fetched again when OBS connects or its scene list changes, when the
   rules change (the other app window's OBS window, or a rename carried over
   by an app window), and on the refresh button. */
function wireSceneList() {
  const body    = document.getElementById('obs-scene-body');
  const list    = document.getElementById('obs-scene-list');
  const status  = document.getElementById('obs-scene-status');
  const refresh = document.getElementById('obs-scene-refresh');
  if (!body || !list || !status) return;

  let connected = false;
  let names = null;          // null: not fetched (or failed); [] : OBS has none
  let statusKey = '';
  let fetchSeq = 0;

  const setStatus = (key) => {
    statusKey = key;
    status.textContent = key ? t(key) : '';
  };

  const renderRows = () => {
    list.replaceChildren(...(names || []).map(buildRow));
  };

  const load = async () => {
    if (!settings.obsSceneLink) return;
    if (!connected) {
      names = null;
      renderRows();
      setStatus('obs.sceneLink.status.offline');
      return;
    }
    const seq = ++fetchSeq;
    try {
      const fetched = await fetchSceneNames();
      if (seq !== fetchSeq) return;
      names = fetched;
      setStatus(names.length ? 'obs.sceneLink.status.hint' : 'obs.sceneLink.status.empty');
    } catch {
      if (seq !== fetchSeq) return;
      names = null;
      setStatus('obs.sceneLink.status.failed');
    }
    renderRows();
  };

  const syncEnabled = () => {
    body.hidden = !settings.obsSceneLink;
    load();
  };

  onConnectionState(({ phase }) => {
    const now = phase === 'connected';
    if (now === connected) return;
    connected = now;
    load();
  });
  onSceneListChanged(load);
  refresh?.addEventListener('click', load);
  subscribe('obsSceneLink', syncEnabled);
  /* A rule changed: redraw the rows from the list already fetched. */
  subscribe('obsSceneRules', renderRows);
  subscribe('uiLang', () => { setStatus(statusKey); renderRows(); });

  syncEnabled();
}

function buildRow(sceneName) {
  const action = sceneAction(sceneName);

  const row = document.createElement('li');
  row.className = 'obs-scene-row';
  row.dataset.action = action;

  const name = document.createElement('span');
  name.className = 'obs-scene-name';
  name.textContent = sceneName;
  name.title = sceneName;

  const select = document.createElement('select');
  select.className = 'select';
  select.setAttribute('aria-label', sceneName);
  for (const value of SCENE_ACTIONS) {
    select.add(new Option(t(`obs.sceneLink.action.${value}`), value, false, value === action));
  }
  select.addEventListener('change', () => {
    row.dataset.action = select.value;
    setSceneAction(sceneName, select.value);
  });

  row.append(name, select);
  return row;
}

/* Revealed from .finally(), as the app window is (js/main.js): a boot that
   throws half-way still shows whatever did mount. */
document.addEventListener('DOMContentLoaded', () => {
  init().finally(() => document.documentElement.classList.remove('is-booting'));
});
