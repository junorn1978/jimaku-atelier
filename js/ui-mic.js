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
import { openLevelMeter, PAUSE_GATE_DB, PAUSE_DROP_DB } from './audio-input.js';

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

/* ============ level test ============ */

/* Speech and background measured one after the other, then judged by the same
   thresholds the pause detector uses. Recognition finds the ends of sentences
   by the level dropping PAUSE_DROP_DB below speech; if the background alone
   does not sit that far below, pauses are never seen and every line runs to
   the 20s cap. That is invisible from the output — subtitles just come late —
   so this is where a streamer finds out, and learns what to change. */

const PHASE_MS  = 3000;
const SETTLE_MS = 600;     // ignored at the start of each phase: reacting to the prompt
const SAMPLE_MS = 50;
const GOOD_DB   = PAUSE_DROP_DB + 3;   // margin for the background getting louder later
const SILENT_DB = -60;
const SCALE_DB  = 70;      // bars run from -70 dBFS to 0

const percentile = (values, p) => {
  if (!values.length) return -Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

/* Which advice applies, in the order a streamer should fix things: first that
   anything is heard at all, then the microphone, then the background. */
function judge(voiceDb, backgroundDb) {
  const gap = voiceDb - backgroundDb;
  if (voiceDb < SILENT_DB && backgroundDb < SILENT_DB) return 'silent';
  if (gap < 3)                  return 'noChange';
  if (voiceDb < PAUSE_GATE_DB)  return 'quiet';
  if (gap < PAUSE_DROP_DB)      return 'noisy';
  if (gap < GOOD_DB)            return 'borderline';
  return 'good';
}

const VERDICT_TONE = { silent: 'bad', noChange: 'bad', quiet: 'bad', noisy: 'bad', borderline: 'warn', good: 'ok' };

const barWidth = (db) => `${Math.max(0, Math.min(100, (db + SCALE_DB) / SCALE_DB * 100))}%`;
/* Digital silence reads as -120 dB; a number that low only looks like a
   measurement. Anything under the silence floor is shown as nothing. */
const audible = (db) => Number.isFinite(db) && db >= SILENT_DB;
const fmtDb = (db) => (audible(db) ? `${Math.round(db)} dB` : '—');

export function mountMicTest(root) {
  if (!root) return;
  const button  = root.querySelector('.mic-test-btn');
  const step    = root.querySelector('.mic-test-step');
  const live    = root.querySelector('.mic-test-live .level-fill');
  const result  = root.querySelector('.mic-test-result');
  const bars    = root.querySelector('.mic-test-bars');
  const verdict = root.querySelector('.mic-test-verdict');
  if (!button) return;

  let running = null;   // { cancel } while a test is in progress

  const isRecording = () => !document.getElementById('btn-stop')?.disabled;
  const show = (state) => { root.dataset.state = state; };   // idle | running | done

  function showResult(voiceDb, backgroundDb) {
    const kind = judge(voiceDb, backgroundDb);
    const gap = audible(voiceDb) ? voiceDb - Math.max(backgroundDb, SILENT_DB) : NaN;
    bars.hidden = kind === 'silent';   // two empty bars would say nothing the advice does not
    result.querySelector('.mic-test-voice .level-fill').style.width = barWidth(voiceDb);
    result.querySelector('.mic-test-voice .level-value').textContent = fmtDb(voiceDb);
    result.querySelector('.mic-test-bg .level-fill').style.width = barWidth(backgroundDb);
    result.querySelector('.mic-test-bg .level-value').textContent = fmtDb(backgroundDb);
    /* Where the background has to stay under for pauses to be seen. */
    result.querySelector('.mic-test-bg .level-mark').style.left = barWidth(voiceDb - PAUSE_DROP_DB);
    result.querySelector('.mic-test-bg').classList.toggle('is-over', voiceDb - backgroundDb < PAUSE_DROP_DB);
    result.querySelector('.mic-test-gap').textContent = t('settings.mic.test.gap')
      .replace('{gap}', Number.isFinite(gap) ? Math.round(gap) : '—')
      .replace('{need}', PAUSE_DROP_DB);
    verdict.textContent = t(`settings.mic.test.verdict.${kind}`);
    verdict.dataset.tone = VERDICT_TONE[kind];
    button.textContent = t('settings.mic.test.again');
    show('done');
  }

  function fail(key) {
    bars.hidden = true;
    verdict.textContent = t(key);
    verdict.dataset.tone = 'bad';
    show('done');
  }

  async function run() {
    if (running) return;
    if (isRecording()) { fail('settings.mic.test.busy'); return; }

    let meter;
    try {
      meter = await openLevelMeter(settings.micDeviceId);
    } catch {
      fail('settings.mic.test.error');
      return;
    }

    let cancelled = false;
    running = { cancel: () => { cancelled = true; } };
    button.disabled = true;
    show('running');

    const measure = async (labelKey) => {
      step.textContent = t(labelKey);
      const values = [];
      const start = performance.now();
      while (!cancelled && performance.now() - start < PHASE_MS) {
        const db = meter.read();
        live.style.width = barWidth(db);
        if (performance.now() - start >= SETTLE_MS) values.push(db);
        await new Promise(r => setTimeout(r, SAMPLE_MS));
      }
      return values;
    };

    try {
      /* Speech: the level while talking, not the loudest peak — roughly where
         the detector's speech tracking settles. Background: near its loudest,
         since a pause needs all of it under the line, not most of it. */
      const voice = await measure('settings.mic.test.speak');
      const quiet = await measure('settings.mic.test.quiet');
      if (!cancelled) showResult(percentile(voice, 0.75), percentile(quiet, 0.9));
    } finally {
      meter.close();
      running = null;
      button.disabled = false;
    }
  }

  button.addEventListener('click', run);

  /* Closing the dialog ends a test in progress — the microphone should not
     stay open behind a closed dialog — and reopening starts from the button. */
  const dialog = root.closest('dialog');
  if (dialog) {
    new MutationObserver(() => {
      if (dialog.open) return;
      running?.cancel();
      button.textContent = t('settings.mic.test.button');
      show('idle');
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }
  show('idle');
}
