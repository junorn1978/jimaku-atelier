/**
 * @file ui-mic.js
 * @description The microphone button next to start/stop and the panel it
 * opens: which device to use, a level test, and how cloud recognition splits
 * sentences (greyed out while a recognition server does that itself). The choice is stored as micDeviceId (+ its label); speech.js
 * opens that device and starts the recogniser on it.
 *
 * It lives on the toolbar rather than in the settings dialog because it is
 * what gets checked right before pressing start, and a gear is easy to never
 * open. The button carries a dot when something needs attention — the picked
 * device is unplugged, or the last test found a problem — so the panel does
 * not have to be opened to find out.
 *
 * The device list is rebuilt each time the panel opens rather than kept live:
 * labels only exist once microphone permission has been granted, which happens
 * on the first start.
 */

import { settings, subscribe } from './store.js';
import { t } from './i18n.js';
import { openLevelMeter, PAUSE_GATE_DB, PAUSE_DROP_DB } from './audio-input.js';
import { isDebugEnabled } from './logger.js';

/* The browser's aliases for "whatever Windows says" — the first option already
   means that, so listing them again would only offer the same thing twice. */
const ALIASES = new Set(['default', 'communications']);

/* What the button's dot reports. Both reset when the device changes: a new
   device has not been tested, and is not the one that went missing. */
const status = { missing: false, testTone: '' };
let _button = null;

function renderButton() {
  if (!_button) return;
  const label = settings.micDeviceLabel || t('settings.mic.systemDefault');
  /* The button's own text already says what it opens; the tooltip only adds
     which device that is. The accessible name keeps both, visible text first. */
  _button.title = label;
  _button.setAttribute('aria-label', `${t('settings.mic.button')}: ${label}`);
  /* Missing outranks a test result: until the device is back, the test says
     nothing about what recognition is actually listening to. */
  _button.dataset.alert = status.missing ? 'warn' : (status.testTone === 'bad' ? 'bad' : '');
}

export function mountMicPanel(button, panel) {
  if (!button || !panel) return;
  _button = button;
  mountPicker(panel.querySelector('.mic-select'), panel);
  mountTest(panel.querySelector('.mic-test'), panel);
  mountSegment(panel.querySelector('.mic-segment'));
  subscribe('micDeviceLabel', renderButton);
  /* The tooltip is the device name (translated only for "system default"), so
     it cannot be a data-i18n attribute; built when it is about to be read
     instead, which also follows a language switch without listening for one. */
  button.addEventListener('pointerenter', renderButton);
  button.addEventListener('focus', renderButton);
  renderButton();
}

/* ============ sentence splitting ============ */

/* Only the browser's recogniser is split by this; a recognition server decides
   its own sentences. Greyed out rather than hidden while one is in use, with
   the description saying why — a setting that vanished would read as lost. */
function mountSegment(row) {
  const desc = row?.querySelector('p');
  if (!row || !desc) return;
  const labels = row.querySelectorAll('.seg-switch label');

  const sync = () => {
    const custom = settings.sttEngine === 'custom';
    for (const label of labels) {
      label.classList.toggle('is-disabled', custom);
      label.querySelector('input').disabled = custom;
    }
    desc.dataset.i18n = custom ? 'settings.segment.desc.custom' : 'settings.segment.desc';
    desc.textContent = t(desc.dataset.i18n);
  };
  sync();
  subscribe('sttEngine', sync);
}

/* ============ device picker ============ */

function mountPicker(select, panel) {
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
       where it left off; recognition meanwhile falls back to the default.
       Without permission there are no ids to compare against, so nothing can
       be called missing yet. */
    status.missing = !!id && devices.length > 0 && !devices.some(d => d.deviceId === id);
    if (id && !devices.some(d => d.deviceId === id)) {
      opts.push(option(id, t('settings.mic.missing').replace('{label}', label || id.slice(0, 8))));
    }
    select.replaceChildren(...opts);
    select.value = id;
    renderButton();
  }

  select.addEventListener('change', () => {
    settings.micDeviceLabel = select.value ? select.selectedOptions[0]?.textContent || '' : '';
    settings.micDeviceId = select.value;
  });

  navigator.mediaDevices.addEventListener?.('devicechange', refresh);
  subscribe('micDeviceId', () => {
    status.testTone = '';
    refresh();
  });
  panel.addEventListener('toggle', (e) => { if (e.newState === 'open') refresh(); });
  refresh();
}

/* ============ level test ============ */

/* Speech and background measured one after the other, then judged by the same
   thresholds the pause detector uses. Recognition finds the ends of sentences
   by the level dropping PAUSE_DROP_DB below speech; if the background alone
   does not sit that far below, pauses are never seen and every line runs to
   the 20s cap. That is invisible from the output — subtitles just come late —
   so this is where a streamer finds out, and learns what to change. */

/* Each phase is measured for `ms` after its first `settle` ms, which are
   ignored: reacting to the prompt. Stopping takes longer than starting — the
   sentence in progress gets finished — and a voice that trails into the
   background measurement passes it off as background, so the quiet phase
   waits well past the switch. */
const VOICE_PHASE = { ms: 5000, settle: 600 };
const QUIET_PHASE = { ms: 3000, settle: 2500 };
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

function mountTest(root, panel) {
  if (!root) return;
  const button    = root.querySelector('.mic-test-btn');
  const step      = root.querySelector('.mic-test-step');
  const live      = root.querySelector('.mic-test-live .level-fill');
  const result    = root.querySelector('.mic-test-result');
  const bars      = root.querySelector('.mic-test-bars');
  const verdict   = root.querySelector('.mic-test-verdict');
  const switchBtn = root.querySelector('.mic-test-switch');
  if (!button) return;

  let running = null;   // { cancel } while a test is in progress

  const isRecording = () => document.getElementById('btn-speech')?.dataset.recording === 'true';
  const show = (state) => { root.dataset.state = state; };   // idle | running | done

  /* Background too loud for the pause detector: the one case where changing
     how sentences are split helps (see speech.js). Offered right under the
     advice, and only while that mode is not already on. A custom STT server
     splits sentences itself, so the switch would do nothing there. */
  const offerSwitch = (kind) => {
    switchBtn.hidden = !(kind === 'noisy' && settings.segmentMode !== 'engine' && settings.sttEngine !== 'custom');
  };

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
    offerSwitch(kind);
    status.testTone = VERDICT_TONE[kind];
    renderButton();
    button.textContent = t('settings.mic.test.again');
    show('done');
  }

  function fail(key) {
    bars.hidden = true;
    switchBtn.hidden = true;
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

    const measure = async (labelKey, { ms, settle }) => {
      step.textContent = t(labelKey);
      const values = [];
      const raw = [];
      const start = performance.now();
      while (!cancelled && performance.now() - start < settle + ms) {
        const db = meter.read();
        live.style.width = barWidth(db);
        if (performance.now() - start >= settle) {
          values.push(db);
          raw.push(meter.readRaw());
        }
        await new Promise(r => setTimeout(r, SAMPLE_MS));
      }
      return { values, raw };
    };

    try {
      /* Speech: the level while talking, not the loudest peak — roughly where
         the detector's speech tracking settles. Background: near its loudest,
         since a pause needs all of it under the line, not most of it. */
      const voice = await measure('settings.mic.test.speak', VOICE_PHASE);
      const quiet = await measure('settings.mic.test.quiet', QUIET_PHASE);
      if (cancelled) return;
      /* The verdict goes by what the detector reads; the raw microphone
         alongside shows what the denoiser bought. */
      if (isDebugEnabled()) {
        const fmt = (v, q) => `voice ${percentile(v, 0.75).toFixed(1)} / background ${percentile(q, 0.9).toFixed(1)} dB`;
        console.info(`[mic-test] denoised=${meter.denoised()} judged: ${fmt(voice.values, quiet.values)} · raw: ${fmt(voice.raw, quiet.raw)}`);
      }
      showResult(percentile(voice.values, 0.75), percentile(quiet.values, 0.9));
    } finally {
      meter.close();
      running = null;
      button.disabled = false;
      if (cancelled) show('idle');
    }
  }

  button.addEventListener('click', run);
  switchBtn.addEventListener('click', () => {
    settings.segmentMode = 'engine';
    switchBtn.hidden = true;
  });

  /* Closing the panel ends a test in progress — the microphone should not stay
     open behind it. A finished result stays, so reopening still shows it. */
  panel.addEventListener('toggle', (e) => {
    if (e.newState === 'closed') running?.cancel();
  });
  /* A different device makes the old result about the wrong microphone. */
  subscribe('micDeviceId', () => {
    button.textContent = t('settings.mic.test.button');
    show('idle');
  });
  show('idle');
}
