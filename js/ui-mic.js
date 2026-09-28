/**
 * @file ui-mic.js
 * @description Microphone picker in the settings dialog. Stores the choice as
 * micDeviceId (+ its label); speech.js opens that device and starts the
 * recogniser on it.
 *
 * The list is rebuilt whenever the dialog opens rather than kept live: device
 * labels only exist once microphone permission has been granted, which happens
 * on the first start, and the dialog is the only place the list is read.
 */

import { settings, subscribe } from './store.js';
import { t } from './i18n.js';

/* The browser's aliases for "whatever Windows says" — the first option already
   means that, so listing them again would only offer the same thing twice. */
const ALIASES = new Set(['default', 'communications']);

export function mountMicPicker(select) {
  if (!select || !navigator.mediaDevices?.enumerateDevices) return;

  const option = (value, text, disabled = false) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    o.disabled = disabled;
    return o;
  };

  async function refresh() {
    let devices = [];
    try {
      devices = (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === 'audioinput' && d.deviceId && !ALIASES.has(d.deviceId));
    } catch { /* leave the list at the default entry */ }

    const id = settings.micDeviceId;
    const label = settings.micDeviceLabel;

    /* Device ids are per-site and can be reset (cleared site data); the label
       survives that, so a saved device that vanished is looked up by name
       before being declared missing. Writing the setting re-runs refresh. */
    if (id && label && !devices.some(d => d.deviceId === id)) {
      const same = devices.find(d => d.label === label);
      if (same) { settings.micDeviceId = same.deviceId; return; }
    }

    const opts = [option('', t('settings.mic.systemDefault'))];
    for (const d of devices) opts.push(option(d.deviceId, d.label || t('settings.mic.unnamed')));
    if (!devices.length) opts.push(option('-', t('settings.mic.needPermission'), true));
    /* Kept selected while it is unplugged, so plugging it back in picks up
       where it left off; recognition meanwhile falls back to the default. */
    if (id && !devices.some(d => d.deviceId === id)) {
      opts.push(option(id, t('settings.mic.missing').replace('{label}', label || id.slice(0, 8))));
    }
    select.replaceChildren(...opts);
    select.value = id;
  }

  select.addEventListener('change', () => {
    settings.micDeviceLabel = select.value ? select.selectedOptions[0]?.textContent || '' : '';
    settings.micDeviceId = select.value;
  });

  navigator.mediaDevices.addEventListener?.('devicechange', refresh);
  subscribe('micDeviceId', refresh);

  /* <dialog> has no open event to listen for; its open attribute is the signal. */
  const dialog = select.closest('dialog');
  if (dialog) {
    new MutationObserver(() => { if (dialog.open) refresh(); })
      .observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }
  refresh();
}
