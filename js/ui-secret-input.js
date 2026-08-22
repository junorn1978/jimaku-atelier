/**
 * @file ui-secret-input.js
 * @description Reveal/hide toggle for inputs whose value should not sit on
 * screen — the OBS WebSocket password and the custom translation URL, which
 * often carries an API key in its path.
 *
 * These are deliberately NOT `type="password"`. A password field is claimed by
 * the browser's password manager, which offers to save it, syncs it, and
 * autofills it into places it does not belong — worse for a URL or a service
 * token than showing it. Masking is done in CSS with `-webkit-text-security`
 * instead (see .secret-input-wrap), which hides the characters without telling
 * the browser this is a credential.
 *
 * Markup contract:
 *   <div class="secret-input-wrap" data-secret-visible="false">
 *     <input class="text-input secret-input" ...>
 *     <button class="secret-toggle" aria-pressed="false">…two icons…</button>
 *   </div>
 * Optional data-secret-show / data-secret-hide override the button's i18n keys.
 */

import { subscribe } from './store.js';
import { t } from './i18n.js';

/** Wire every masked input inside `root`. Safe to call on a subtree. */
export function wireSecretInputs(root = document) {
  root.querySelectorAll('.secret-input-wrap').forEach(wireOne);
}

function wireOne(wrap) {
  const btn = wrap.querySelector('.secret-toggle');
  if (!btn || wrap.dataset.secretWired === 'true') return;
  wrap.dataset.secretWired = 'true';

  const sync = () => {
    const visible = wrap.dataset.secretVisible === 'true';
    const key = visible
      ? (wrap.dataset.secretHide || 'secret.hide')
      : (wrap.dataset.secretShow || 'secret.show');
    const label = t(key);
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(visible));
  };

  sync();
  subscribe('uiLang', sync);

  btn.addEventListener('click', () => {
    wrap.dataset.secretVisible = wrap.dataset.secretVisible === 'true' ? 'false' : 'true';
    sync();
  });
}
