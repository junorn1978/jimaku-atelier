/**
 * @file second-window.js
 * @description The mic panel's button that opens the second window
 * (index.html?ch=2, js/channel.js): another input — a guest's microphone, a
 * call's audio — recognised, translated and put out on its own. It starts
 * from this window's settings, except the device, and keeps its own from then
 * on (store.js).
 *
 * The second window has no such button: a third is not offered.
 */

import { CHANNEL } from './channel.js';
import { t } from './i18n.js';

const WINDOW_NAME = 'rtl-ch2';

function openSecondWindow() {
  const url = new URL(location.href);
  url.searchParams.set('ch', '2');
  url.hash = '';
  /* A window of its own (no tab strip), as big as this one. */
  const features = `popup,width=${window.outerWidth},height=${window.outerHeight}`;
  /* Asked for with no URL first: a second window already open is handed back
     as it is, where opening the URL into it would reload it — and stop what it
     is recognising. One that was not open comes back as about:blank. */
  const win = window.open('', WINDOW_NAME, features);
  if (!win) {
    alert(t('settings.second.blocked'));
    return;
  }
  if (win.location.href === 'about:blank') win.location.href = url.href;
  win.focus();
}

export function mountSecondWindowButton(btn) {
  if (!btn) return;
  if (CHANNEL === 2) {
    btn.closest('.mic-second')?.remove();
    return;
  }
  btn.addEventListener('click', openSecondWindow);
}
