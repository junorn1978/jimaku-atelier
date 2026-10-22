/**
 * @file ui-obs-status.js
 * @description The live OBS connection status line, so the user can tell
 * whether the link to OBS actually works without opening the console. Shown
 * in the app window's OBS tab and in the OBS window (obs-settings.html); each
 * reports its own page's connection.
 *
 * Markup contract:
 *   <div class="obs-conn">
 *     <p class="obs-conn-status" role="status" aria-live="polite" data-phase="disabled">
 *       <span class="obs-conn-dot" aria-hidden="true"></span>
 *       <span class="obs-conn-text"></span>
 *     </p>
 *     <p class="obs-conn-hint"></p>
 *   </div>
 */

import { subscribe } from './store.js';
import { t } from './i18n.js';
import { onConnectionState } from './obs.js';

export function wireConnStatus(container) {
  const el   = container.querySelector('.obs-conn-status');
  const text = container.querySelector('.obs-conn-text');
  const hint = container.querySelector('.obs-conn-hint');
  if (!el || !text || !hint) return;

  let current = { phase: 'disabled', code: null };

  const render = () => {
    el.dataset.phase = current.phase;
    text.textContent = connStatusText(current);

    /* Port-check guidance only helps when we can't reach the server — not for
       a wrong-password failure (4009), which has nothing to do with the port.
       The element keeps its reserved height even when empty, so showing/hiding
       the text never pushes the rest of the tab up or down. */
    const showHint = current.phase === 'retrying' && current.code !== 4009;
    hint.textContent = showHint ? t('obs.status.hint.checkPort') : '';
  };

  onConnectionState((state) => { current = state; render(); });
  /* Re-render in the new UI language without waiting for a state change. */
  subscribe('uiLang', render);
}

/* Map a connection state to a localized message. The close code lets us tell
   "server unreachable" (1006) from "wrong password" (4009) etc. */
function connStatusText({ phase, code }) {
  if (phase === 'disabled')   return t('obs.status.disabled');
  if (phase === 'connecting') return t('obs.status.connecting');
  if (phase === 'connected')  return t('obs.status.connected');

  /* phase === 'retrying' — show why it failed plus that it keeps retrying. */
  return `${failReason(code)} ${t('obs.status.retrying.suffix')}`;
}

function failReason(code) {
  if (code === 'badurl') return t('obs.status.failed.badurl');
  if (code === 1006)     return t('obs.status.failed.unreachable');
  if (code === 4009)     return t('obs.status.failed.auth');
  return `${t('obs.status.failed.generic')}${code != null ? ` (${code})` : ''}`;
}
