/**
 * @file ui-languages.js
 * @description Everything about the three subtitle lines, in one place.
 *
 * Top — a matrix with one row per line (recognition / translation 1 /
 * translation 2). Each row carries that line's language AND its appearance:
 * text colour, stroke colour, size, stroke width. Language and appearance
 * describe the same object, so keeping them in separate tabs meant setting up
 * one line required switching back and forth. Rows are display:contents so
 * their cells join the outer grid and same-kind controls line up vertically.
 *
 * Beside the matrix, in the width it leaves — the settings you judge against
 * the preview: the source line's wrap symbols and one-line limit, plus
 * alignment and background. Deliberately unheaded: every row is labelled, and
 * the row a title would cost is needed for the fourth control.
 *
 * Bottom — two columns matching the matrix's sides: the Chrome-only offline
 * recognition pack on the recognition side, and HOW to translate on the other
 * (engine picker plus an .engine-detail region that absorbs the rest of the
 * column, so switching engines never resizes the tab). The columns are sized to
 * their contents rather than split evenly, and the engine inlines its heading
 * with the picker (.col-head) since this is the shortest tab in the app. The
 * verbose URL format help lives in a dialog (#dialog-url-format in index.html).
 *
 * This tab absorbed the old Style tab entirely; the only subtitle setting that
 * did not move here is the two-line overflow mode, which is deprecated and now
 * sits in the settings dialog.
 *
 * All form controls bind to the settings store via [data-bind]. The colour
 * inputs are hidden and driven by the in-page palette in js/color-picker.js;
 * each carries a `list` naming the <datalist> of quick colours it offers.
 */

import { getAllLanguages } from './languages.js';
import { settings, subscribe } from './store.js';
import { applyTo, t } from './i18n.js';
import { isChrome } from './env.js';
import { APP_VERSION } from './app-meta.js';
import { setupLanguagePackButton } from './language-pack.js';
import { wireSecretInputs } from './ui-secret-input.js';
import { isPromptSupported, getPromptAvailability,
         preparePromptSession, destroyPromptSession } from './translate-prompt.js';
import { isTranslatorSupported, prepareTranslators } from './translate-translator.js';

/* Ranges for the per-line appearance controls, inherited along with them from
   the Style tab, which this tab absorbed. */
const SIZE_MIN   = 14;
const SIZE_MAX   = 48;
const STROKE_MIN = 0;
const STROKE_MAX = 10;

/**
 * The four appearance cells of one subtitle line, in the matrix's column order.
 * `prefix` is the settings-key middle part: source | target1 | target2.
 */
function styleCells(prefix) {
  const key = (suffix) => `sub${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}${suffix}`;
  return `
          <span class="color-cell">
            <input type="color" class="visually-hidden" data-bind="${key('Color')}" list="palette-text">
            <button type="button" class="color-swatch" data-color-trigger></button>
            <output class="color-value"></output>
          </span>
          <span class="color-cell">
            <input type="color" class="visually-hidden" data-bind="${key('Stroke')}" list="palette-text">
            <button type="button" class="color-swatch" data-color-trigger></button>
            <output class="color-value"></output>
          </span>
          <div class="slider-group">
            <input type="range" min="${SIZE_MIN}" max="${SIZE_MAX}" data-bind="${key('Size')}">
            <output class="slider-value"></output>
          </div>
          <div class="slider-group">
            <input type="range" min="${STROKE_MIN}" max="${STROKE_MAX}" data-bind="${key('StrokeW')}">
            <output class="slider-value"></output>
          </div>`;
}

export function mountLanguagesTab(container) {
  if (!container) return;

  const langs = getAllLanguages();
  const targetOptions =
    `<option value="none" data-i18n="lang.none">翻訳しない</option>` +
    langs.map(l => `<option value="${l.id}" data-i18n="lang.name.${l.id}">${escapeAttr(l.label)}</option>`).join('');
  const sourceOptions =
    `<option value="" data-i18n="lang.choose">言語を選択</option>` +
    langs.map(l => `<option value="${l.id}" data-i18n="lang.name.${l.id}">${escapeAttr(l.label)}</option>`).join('');

  container.innerHTML = `
    <div class="lang-grid">
      <!-- One row per subtitle line, carrying BOTH its language and its
           appearance. They describe the same object, so splitting them across
           two tabs meant setting up a single line required switching back and
           forth. Column headers are written once; each row is a
           display:contents wrapper so its cells join the outer grid and every
           control of the same kind lines up vertically. -->
      <div class="lang-top">
      <div class="lang-matrix">
        <div class="lang-matrix-head">
          <span></span>
          <span></span>
          <span data-i18n="style.textColor">文字色</span>
          <span data-i18n="style.strokeColor">縁取り色</span>
          <span data-i18n="style.fontSize">サイズ</span>
          <span data-i18n="style.strokeWidth">縁取り幅</span>
        </div>

        <div class="lang-matrix-row">
          <span class="lang-field-label" data-i18n="lang.source">音声認識</span>
          <div class="lang-control">
            <select class="select select-compact" data-bind="sourceLangId">${sourceOptions}</select>
            <label class="toggle" data-i18n-title="style.showSource" title="原文を表示">
              <input type="checkbox" data-bind="subShowSource">
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
          </div>
          ${styleCells('source')}
        </div>

        <div class="lang-matrix-row">
          <span class="lang-field-label" data-i18n="lang.target1">翻訳 1</span>
          <div class="lang-control">
            <select class="select select-compact" data-bind="target1LangId">${targetOptions}</select>
          </div>
          ${styleCells('target1')}
        </div>

        <div class="lang-matrix-row">
          <span class="lang-field-label" data-i18n="lang.target2">翻訳 2</span>
          <div class="lang-control">
            <select class="select select-compact" data-bind="target2LangId">${targetOptions}</select>
          </div>
          ${styleCells('target2')}
        </div>
      </div>

      <!-- The settings you judge against the preview, filling the space the
           matrix leaves: the source line's symbols and one-line limit,
           alignment, background. They belong beside the colours rather than a
           tab away, because they are adjusted the same way — by looking. -->
      <section class="lang-extras">
        <!-- The two source-scoped settings first, then the two global ones.
             Within that pair the segmented picker leads, so it sits next to the
             other segmented control below and the odd one out (the two little
             symbol boxes) doesn't break the run.
             A two-state picker rather than a bare toggle: it names both states
             instead of leaving one implied, and it matches the width of the
             controls around it. -->
        <span class="lang-extras-label" data-i18n="style.sourceLines">原文の行数</span>
        <div class="seg-switch" role="group">
          <label><input type="radio" name="subSourceSingleLine" value="false" data-bind="subSourceSingleLine"><span data-i18n="style.sourceLines.all">制限なし</span></label>
          <label><input type="radio" name="subSourceSingleLine" value="true" data-bind="subSourceSingleLine"><span data-i18n="style.sourceLines.one">1行</span></label>
        </div>

        <span class="lang-extras-label" data-i18n="style.sourceWrap">原文符號</span>
        <div class="symbol-inputs">
          <input type="text" class="text-input" data-bind="subSourcePrefix"
                 data-i18n-placeholder="style.sourcePrefix.ph" data-i18n-title="style.sourcePrefix" title="左記号"
                 autocomplete="off" spellcheck="false" autocorrect="off" maxlength="8">
          <input type="text" class="text-input" data-bind="subSourceSuffix"
                 data-i18n-placeholder="style.sourceSuffix.ph" data-i18n-title="style.sourceSuffix" title="右記号"
                 autocomplete="off" spellcheck="false" autocorrect="off" maxlength="8">
        </div>

        <span class="lang-extras-label" data-i18n="style.align">横位置</span>
        <div class="seg-switch seg-switch-icons style-align-control" role="group">
          <label>
            <input type="radio" name="subAlign" value="left" data-bind="subAlign">
            <span data-i18n-title="style.align.left" title="左">
              <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                <line x1="2" y1="3.5"  x2="10" y2="3.5"/>
                <line x1="2" y1="7"    x2="12" y2="7"/>
                <line x1="2" y1="10.5" x2="8"  y2="10.5"/>
              </svg>
            </span>
          </label>
          <label>
            <input type="radio" name="subAlign" value="center" data-bind="subAlign">
            <span data-i18n-title="style.align.center" title="中">
              <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                <line x1="3" y1="3.5"  x2="11" y2="3.5"/>
                <line x1="1" y1="7"    x2="13" y2="7"/>
                <line x1="4" y1="10.5" x2="10" y2="10.5"/>
              </svg>
            </span>
          </label>
          <label>
            <input type="radio" name="subAlign" value="right" data-bind="subAlign">
            <span data-i18n-title="style.align.right" title="右">
              <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
                <line x1="4" y1="3.5"  x2="12" y2="3.5"/>
                <line x1="2" y1="7"    x2="12" y2="7"/>
                <line x1="6" y1="10.5" x2="12" y2="10.5"/>
              </svg>
            </span>
          </label>
        </div>

        <!-- Opened from a plain button rather than a filled swatch: the swatch
             would be painted in exactly the chroma-key colour, so capturing the
             window with a key filter punches a hole straight through the
             control. The hex label carries the value instead — text survives the
             key. js/color-picker.js recognises .color-trigger-text and skips
             the swatch it paints on every other trigger for the same reason.
             The quick colours here are the three that make sense as a key
             (green / blue / magenta) plus black and white — a different list
             from the text colours, which is why each input names its own. -->
        <span class="lang-extras-label" data-i18n="style.bg">背景色</span>
        <span class="color-pick">
          <input type="color" class="visually-hidden" data-bind="subBg" list="palette-bg">
          <button type="button" class="btn color-trigger-text" data-color-trigger>
            <output class="color-value"></output>
          </button>
        </span>
      </section>
      </div>

      <!-- Recognition-side settings on the left, translation-side on the right,
           matching the matrix rows above. The columns are deliberately unequal:
           the pack is a heading and two buttons, while the engine wants the
           width for its picker and URL field. The engine also inlines its
           heading with the picker, which costs no height because the picker is
           the taller of the two. -->
      <div class="panel-cols cols-2">
        <!-- Offline recognition pack: a property of the recognition language, so
             it sits on the recognition side. Chrome-only; hidden elsewhere. -->
        <section class="panel-col lang-sub" id="offline-pack-row" hidden>
          <h3 class="section-title" data-i18n="lang.offline.label">オフライン音声認識パック</h3>
          <div class="col-head">
            <button type="button" class="btn offline-pack-btn" id="btn-offline-pack">ダウンロード</button>

            <!-- Removal instructions live in a popover rather than as standing
                 text: they only matter once a pack is installed, and as a
                 permanent paragraph they were the tallest thing in the tab.
                 A popover (not a tooltip) stays open while the user follows the
                 steps in the browser's own settings. -->
            <button type="button" class="btn offline-help-toggle" id="btn-offline-help"
                    popovertarget="popover-offline-help"
                    data-i18n="lang.offline.help" hidden>削除方法</button>

            <div class="help-popover offline-popover" id="popover-offline-help" popover>
              <p class="offline-pack-info" id="offline-pack-info"></p>
            </div>

            <!-- Download result. In the top layer rather than in the column:
                 this section sits on the panel's bottom edge with no room left
                 under it, and as a paragraph the message was clipped away by
                 .tab-panel's overflow — it was never actually visible. Anchored
                 to the download button so it appears where the user just
                 clicked, costs the layout nothing, and fades rather than
                 blinking in. -->
            <div class="help-popover offline-status-popover" id="offline-pack-status"
                 popover role="status" aria-live="polite"></div>
          </div>
        </section>

        <!-- How to translate. The engine's own detail (status messages, the
             custom URL row) sits in a region that absorbs the rest of the
             column, so switching engines never resizes the tab. -->
        <section class="panel-col lang-engine">
          <div class="col-head">
            <h3 class="section-title" data-i18n="lang.engine">翻訳エンジン</h3>
            <div class="seg-switch" role="group">
              <label><input type="radio" name="translationMode" value="gtx"  data-bind="translationMode"><span data-i18n="lang.engine.gtx">Google 翻訳</span></label>
              <label id="engine-translator-label"><input type="radio" name="translationMode" value="translator" data-bind="translationMode"><span data-i18n="lang.engine.translator">ブラウザ翻訳</span></label>
              <label id="engine-prompt-label"><input type="radio" name="translationMode" value="prompt" data-bind="translationMode"><span data-i18n="lang.engine.prompt">ブラウザ AI</span></label>
              <label><input type="radio" name="translationMode" value="link" data-bind="translationMode"><span data-i18n="lang.engine.link">カスタム URL</span></label>
            </div>
          </div>
          <div class="engine-detail">
            <p class="manual-status" id="engine-translator-status" role="status" aria-live="polite" hidden></p>
            <p class="manual-status" id="engine-prompt-status" role="status" aria-live="polite" hidden></p>

            <!-- The tab's bottom edge, and the only strip of it that is the
                 same in every engine mode: .engine-detail reserves this height
                 whether or not an engine fills it, so a footer pinned here does
                 not move when the engine changes. -->
            <div class="engine-footer">
            <div class="lang-url-row" id="custom-url-row" hidden>
              <!-- Masked by default: this URL usually carries an API key in its
                   path or query, and the panel is on screen while streaming.
                   Not type="password" on purpose — see js/ui-secret-input.js. -->
              <div class="secret-input-wrap" data-secret-visible="false"
                   data-secret-show="lang.engine.link.url.show"
                   data-secret-hide="lang.engine.link.url.hide">
                <input type="url" class="text-input secret-input" placeholder="https://..."
                       data-bind="customTranslateUrl" autocomplete="off" spellcheck="false">
                <button type="button" class="icon-btn secret-toggle" aria-pressed="false">
                  <svg class="icon-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                    <path d="M1 1l22 22"/>
                  </svg>
                  <svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
              </div>

              <button type="button" class="btn url-examples-toggle" id="btn-url-examples"
                      popovertarget="popover-url-examples">
                <span data-i18n="lang.engine.link.help.more">範例與說明</span>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </button>

              <div class="help-popover url-popover" id="popover-url-examples" popover>
                <div class="format-help-examples">
                  <span data-i18n="lang.engine.link.help.examples">可直接使用的範例：</span>
                  <button type="button" class="btn" data-example="minimal" data-i18n="lang.engine.link.example.btn.minimal">最小</button>
                  <button type="button" class="btn" data-example="openai">OpenAI</button>
                  <button type="button" class="btn" data-example="gemini">Gemini</button>
                  <button type="button" class="btn" id="btn-url-format" data-i18n="lang.engine.link.help.btn">格式說明</button>
                </div>
              </div>
            </div>

              <!-- Signature. Which version is running is a real question while
                   two machines are being kept in sync, and answering it costs
                   an open of the settings dialog today. It lives in the tab
                   body rather than the toolbar so that .panel-collapsed takes
                   it away with everything else: on screen while setting up,
                   gone before the window is captured. -->
              <p class="app-signature">
                <span data-i18n="app.title">字幕アトリエ</span>
                <span class="app-signature-version">${APP_VERSION}</span>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  /* Style the radios as a segmented switch by overlaying span as the visible
     button. The styling lives in CSS (.seg-switch label / input). */

  const urlRow = container.querySelector('#custom-url-row');
  const syncUrlVisibility = (mode) => { urlRow.hidden = mode !== 'link'; };
  syncUrlVisibility(settings.translationMode);
  subscribe('translationMode', syncUrlVisibility);

  /* "格式說明" opens the URL-format help dialog (static markup in index.html). */
  container.querySelector('#btn-url-format')?.addEventListener('click', (e) => {
    e.target.closest('[popover]')?.hidePopover();
    document.getElementById('dialog-url-format')?.showModal();
  });

  wireExampleButtons(container);
  wireSecretInputs(container);
  setupOfflinePack(container);
  setupTranslatorEngine(container);
  setupPromptEngine(container);
}

/* Built-in Translator API engine. Unlike the Prompt API we do download models
   here — they are per language pair and downloading on demand is the intended
   flow — but create() only downloads while a user gesture is live. So the
   warm-up runs exactly on the gestures that can trigger it: picking this
   engine, and changing a source/target language while it is picked. */
function setupTranslatorEngine(container) {
  const label  = container.querySelector('#engine-translator-label');
  const radio  = label?.querySelector('input[value="translator"]');
  const status = container.querySelector('#engine-translator-status');
  if (!label || !radio || !status) return;

  /* Keep the message as a key (+ percentage) so a UI language switch can
     re-render it without redoing the work that produced it. */
  let messageKey = null;
  let percent    = null;

  const render = () => {
    if (!messageKey) { status.hidden = true; status.textContent = ''; return; }
    const suffix = percent == null ? '' : ` ${percent}%`;
    status.hidden = false;
    status.textContent = t(messageKey) + suffix;
  };

  const setMessage = (key, pct = null) => { messageKey = key; percent = pct; render(); };
  subscribe('uiLang', render);

  if (!isTranslatorSupported()) {
    radio.disabled = true;
    label.classList.add('is-disabled');
    setMessage('lang.engine.translator.unsupported');
    label.title = t('lang.engine.translator.unsupported');
    if (settings.translationMode === 'translator') settings.translationMode = 'gtx';
    return;
  }

  const REASON_KEYS = {
    unavailable: 'lang.engine.translator.unavailable',
    blocked:     'lang.engine.translator.blocked',
    failed:      'lang.engine.translator.failed',
    unsupported: 'lang.engine.translator.unsupported',
  };

  /* Only one warm-up runs at a time; a language change during a download is
     remembered and re-run afterwards rather than dropped. */
  let warming = false;
  let restart = false;

  const warmUp = async () => {
    if (settings.translationMode !== 'translator') return;
    if (warming) { restart = true; return; }
    warming = true;

    /* A download only reports progress once it actually starts; if the models
       are already there the user just sees "preparing" blink past. */
    let downloaded = false;
    setMessage('lang.engine.translator.preparing');

    try {
      const result = await prepareTranslators(
        settings.sourceLangId,
        [settings.target1LangId, settings.target2LangId],
        (loaded) => {
          downloaded = true;
          setMessage('lang.engine.translator.downloading', Math.floor(loaded * 100));
        },
      );
      if (result.ok) setMessage(downloaded ? 'lang.engine.translator.ready' : null);
      else           setMessage(REASON_KEYS[result.reason] ?? REASON_KEYS.failed);
    } finally {
      warming = false;
    }

    /* The selection changed mid-download. The gesture is long gone, so this
       only completes silently when the new pair is already downloaded — the
       user is told to re-pick the engine otherwise. */
    if (restart) { restart = false; await warmUp(); }
  };

  subscribe('translationMode', (mode) => {
    if (mode === 'translator') warmUp();
    else setMessage(null);
  });
  ['sourceLangId', 'target1LangId', 'target2LangId'].forEach(key => subscribe(key, warmUp));

  /* Restored from a previous session: the models may already be downloaded, in
     which case create() needs no gesture and this simply succeeds. */
  if (settings.translationMode === 'translator') warmUp();
}

/* Chrome Prompt API engine: usable only when the model reports 'available'.
   We never download it — that is the browser's job — so any other state is
   surfaced as "unavailable": the radio is disabled, and if it was the selected
   engine we fall back to gtx.

   Selecting this engine warms the model up, because the first inference costs
   ~17s on a cold model and would otherwise swallow the user's first sentence.
   That warm-up holds the model in memory, so it must not start on a stray
   click: the countdown below gives the user a few seconds to pick something
   else, and switching away at any later point aborts or releases whatever the
   warm-up has reached. */
function setupPromptEngine(container) {
  const label  = container.querySelector('#engine-prompt-label');
  const radio  = label?.querySelector('input[value="prompt"]');
  const status = container.querySelector('#engine-prompt-status');
  if (!label || !radio || !status) return;

  /* Availability changes asynchronously, while the UI language can change at
     any time. Keep the message key so the current state can be translated
     again without repeating the availability check. */
  let currentMessageKey = null;
  let value = '';

  const renderMessage = () => {
    if (!currentMessageKey) return;
    /* The countdown belongs inside the sentence, not tacked onto its end:
       Japanese wants "あと 5 秒" mid-string, English "Preparing in 5s". So the
       message owns a {s} placeholder and we substitute; on every other message
       (which carries no value) the replace is a no-op. */
    const message = t(currentMessageKey).replace('{s}', value);
    label.title = message;
    status.textContent = message;
  };

  const setMessage = (key, slot = '') => {
    currentMessageKey = key;
    value = slot;
    /* A hidden engine must not leave its status line behind — the availability
       check runs regardless of visibility, so it can produce a message for a
       radio nobody can see. */
    status.hidden = !key || label.hidden;
    if (!key) { status.textContent = ''; label.removeAttribute('title'); return; }
    renderMessage();
  };

  subscribe('uiLang', renderMessage);

  /* `fallback` is only set once we KNOW the engine is unusable; during the
     async "checking" phase we just disable the radio without stranding a valid
     prompt selection. */
  const disable = (msgKey, fallback) => {
    radio.disabled = true;
    label.classList.add('is-disabled');
    setMessage(msgKey);
    if (fallback && settings.translationMode === 'prompt') settings.translationMode = 'gtx';
  };

  const enable = () => {
    radio.disabled = false;
    label.classList.remove('is-disabled');
    setMessage(null);
  };

  /* --- warm-up state machine: idle → pending → warming → ready ----------- */

  /* Long enough to undo a mis-click before anything expensive happens. The
     countdown is what makes the delay legible — otherwise the status line just
     sits there and the engine looks broken. */
  const WARMUP_DELAY_S = 5;

  let countdownTimer = null;   /* pending: ticking towards the warm-up */
  let warmupAbort    = null;   /* warming: aborts the in-flight create()  */
  let warmed         = false;  /* ready:   a base session is held         */

  /* Undo whichever stage we are in. Called on every switch away, so it has to
     be safe from any state. */
  const cancelWarmUp = () => {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (warmupAbort)    { warmupAbort.abort(); warmupAbort = null; }
    /* Unconditional, not just when `warmed`: abort() can land after create()
       has already succeeded, which would leave a session holding the model
       with nothing tracking it. Releasing an idle engine is a no-op. */
    destroyPromptSession();
    warmed = false;
  };

  const startWarmUp = async () => {
    if (warmupAbort || warmed) return; /* already warming or warm */
    const controller = new AbortController();
    warmupAbort = controller;
    setMessage('lang.engine.prompt.preparing');

    const result = await preparePromptSession(controller.signal);

    if (warmupAbort !== controller) return; /* superseded or cancelled */
    warmupAbort = null;

    if (result.ok)                    { warmed = true; setMessage('lang.engine.prompt.ready'); }
    else if (result.reason !== 'aborted') setMessage('lang.engine.prompt.failed');
  };

  const scheduleWarmUp = () => {
    cancelWarmUp();
    let left = WARMUP_DELAY_S;
    setMessage('lang.engine.prompt.pending', String(left));
    countdownTimer = setInterval(() => {
      left -= 1;
      if (left > 0) { setMessage('lang.engine.prompt.pending', String(left)); return; }
      clearInterval(countdownTimer);
      countdownTimer = null;
      startWarmUp();
    }, 1000);
  };

  /* --- archived engine: only joins the picker when explicitly enabled ----- */

  /* Hidden rather than disabled: in this picker "disabled" already means "your
     browser or device can't run this", so a permanently greyed-out radio would
     be indistinguishable from a real failure. Hiding it also frees the width —
     the segmented switch just shows three options instead of four. */
  const syncVisibility = (on) => {
    label.hidden = !on;
    if (on) { setMessage(currentMessageKey, value); return; }
    cancelWarmUp();
    if (settings.translationMode === 'prompt') settings.translationMode = 'gtx';
    setMessage(null);
  };

  subscribe('enableBrowserAI', syncVisibility);
  syncVisibility(settings.enableBrowserAI);

  subscribe('translationMode', (mode) => {
    if (radio.disabled) return;
    if (mode === 'prompt') scheduleWarmUp();
    else { cancelWarmUp(); setMessage(null); }
  });

  if (!isPromptSupported()) {
    disable('lang.engine.prompt.unsupported', true);
    return;
  }

  /* Disable (no fallback yet) until the async availability check resolves. */
  disable('lang.engine.prompt.checking', false);
  getPromptAvailability().then((avail) => {
    if (avail !== 'available') { disable('lang.engine.prompt.unavailable', true); return; }
    enable();
    /* Restored from a previous session. There is no mis-click to guard against
       here, but the same delay keeps a 17s model load off the critical path
       while the page is still mounting. */
    if (settings.translationMode === 'prompt') scheduleWarmUp();
  }).catch(() => disable('lang.engine.prompt.unavailable', true));
}

function setupOfflinePack(container) {
  /* On-device packs are Chrome-only — leave the row hidden elsewhere. */
  if (!isChrome) return;
  const row    = container.querySelector('#offline-pack-row');
  const button = container.querySelector('#btn-offline-pack');
  const status = container.querySelector('#offline-pack-status');
  const info   = container.querySelector('#offline-pack-info');
  const help   = container.querySelector('#btn-offline-help');
  if (!row || !button || !status || !info) return;
  /* The whole block — button, name, status and info — lives below the source
     row and stays hidden on browsers without on-device packs. */
  row.hidden = false;
  setupLanguagePackButton({ button, status, info, help });
}

function wireExampleButtons(container) {
  const dialog = document.getElementById('dialog-link-example');
  const titleEl = document.getElementById('dialog-link-example-title');
  const codeEl  = document.getElementById('dialog-link-example-code');
  const stepsEl = document.getElementById('dialog-link-example-steps');
  const copyBtn = document.getElementById('dialog-link-example-copy');
  if (!dialog || !titleEl || !codeEl || !stepsEl || !copyBtn) return;

  const samples = {
    minimal: {
      titleKey: 'lang.engine.link.dialog.title.minimal',
      deps:     'pip install flask flask-cors',
      build:    buildMinimalExample,
    },
    openai: {
      titleKey: 'lang.engine.link.dialog.title.openai',
      deps:     'pip install flask flask-cors openai',
      needsKey: true,
      build:    buildOpenAiExample,
    },
    gemini: {
      titleKey: 'lang.engine.link.dialog.title.gemini',
      deps:     'pip install flask flask-cors google-genai',
      needsKey: true,
      build:    buildGeminiExample,
    },
  };

  container.querySelectorAll('[data-example]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sample = samples[btn.dataset.example];
      if (!sample) return;
      btn.closest('[popover]')?.hidePopover();
      titleEl.textContent = t(sample.titleKey);
      buildSteps(stepsEl, sample);
      codeEl.textContent  = sample.build();
      resetCopyBtn(copyBtn);
      dialog.showModal();
    });
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeEl.textContent);
      copyBtn.textContent = t('lang.engine.link.help.copied');
      copyBtn.classList.add('is-copied');
      clearTimeout(copyBtn._resetTimer);
      copyBtn._resetTimer = setTimeout(() => resetCopyBtn(copyBtn), 1500);
    } catch {
      /* clipboard may be blocked (insecure context, no permission) — leave label untouched. */
    }
  });
}

function resetCopyBtn(btn) {
  btn.textContent = t('lang.engine.link.help.copy');
  btn.classList.remove('is-copied');
}

/* Render the setup steps for the dialog. The run command and the URL are the
   same everywhere; the packages differ per engine, and the key step only
   appears for the engines that have one.
   That step is spelled out because the failure it prevents is silent from the
   app's side: a server left holding YOUR_API_KEY answers every request with an
   auth error, and all the user sees is subtitles that never translate. The
   placeholder is named here so there is something to search the code for. */
function buildSteps(el, { deps, needsKey = false }) {
  const keyStep = needsKey
    ? `<li>${t('lang.engine.link.steps.apiKey')}<code>YOUR_API_KEY</code></li>`
    : '';

  el.innerHTML = `
    <p class="example-steps-title">${t('lang.engine.link.steps.title')}</p>
    <ol>
      <li>${t('lang.engine.link.steps.install')}<code>${deps}</code></li>
      ${keyStep}
      <li>${t('lang.engine.link.steps.run')}<code>python server.py</code></li>
      <li>${t('lang.engine.link.steps.url')}<code>http://localhost:5000</code></li>
    </ol>`;
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* 範例內的程式碼註解依目前 UI 語言顯示（送給 AI 的 prompt 固定用日文）。 */
function exampleComments() {
  return {
    apiKey:       t('lang.engine.link.example.cmt.apiKey'),
    prompt:       t('lang.engine.link.example.cmt.prompt'),
    translateOne: t('lang.engine.link.example.cmt.translateOne'),
    parse:        t('lang.engine.link.example.cmt.parse'),
    align:        t('lang.engine.link.example.cmt.align'),
    callEngine:   t('lang.engine.link.example.cmt.callEngine'),
    plain:        t('lang.engine.link.example.cmt.plain'),
    clean:        t('lang.engine.link.example.cmt.clean'),
    reasoning:    t('lang.engine.link.example.cmt.reasoning'),
    parallel:     t('lang.engine.link.example.cmt.parallel'),
    timing:       t('lang.engine.link.example.cmt.timing'),
    timeout:      t('lang.engine.link.example.cmt.timeout'),
    timeoutUnit:  t('lang.engine.link.example.cmt.timeoutUnit'),
    perLangFail:  t('lang.engine.link.example.cmt.perLangFail'),
  };
}

function buildMinimalExample() {
  const c = exampleComments();
  return `from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.post('/translate')
def translate():
    data = request.get_json()
    text = data['text']
    targets = data['targetLangs']
    # ${c.callEngine}
    translations = [f'[{lang}] {text}' for lang in targets]
    return jsonify({'translations': translations})


if __name__ == '__main__':
    app.run(port=5000)`;
}

const SYSTEM_PROMPT_JA = `あなたはリアルタイム字幕の翻訳エンジンです。
入力テキストを指定された言語へ自然に翻訳してください。

出力ルール：
- JSON のみを出力：{"translation": "..."}
- 他のキー、Markdown、説明文は一切出力しない。
- 原文に主語が明示されていない場合、主語を補わない。`;

/* The same prompt with the envelope taken off. Measured on gpt-5.6-luna, the
   {"translation": "..."} wrapper costs ~12 output tokens, and output tokens are
   emitted one at a time: dropping it took the median round trip down by
   380-455ms across two runs, on top of what leaving out the strict schema
   already saved. translate_one returns a single string, so the JSON was a
   detour — the {'translations': [...]} the app receives is built by the server
   either way.
   The trade is in the shape of a failure, not its likelihood: a malformed JSON
   envelope loses the line silently, while a stray preamble goes on screen. Ten
   samples came back clean, and clean() below takes the cheap precaution. */
const SYSTEM_PROMPT_JA_PLAIN = `あなたはリアルタイム字幕の翻訳エンジンです。
入力テキストを指定された言語へ自然に翻訳してください。

出力ルール：
- 訳文だけを出力する。前置き、引用符、Markdown、説明は一切つけない。
- 原文に主語が明示されていない場合、主語を補わない。`;

function buildOpenAiExample() {
  const c = exampleComments();
  return `from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI
from concurrent.futures import ThreadPoolExecutor
import time

# ${c.apiKey}
API_KEY = 'YOUR_API_KEY'
MODEL = 'gpt-5.6-luna'

app = Flask(__name__)
CORS(app)
# ${c.timeout}
client = OpenAI(api_key=API_KEY, timeout=5.0, max_retries=0)

# ${c.prompt}
# ${c.plain}
SYSTEM_PROMPT = """${SYSTEM_PROMPT_JA_PLAIN}"""


# ${c.clean}
def clean(raw):
    text = (raw or '').strip()
    for open_q, close_q in (('"', '"'), ("'", "'"), ('「', '」'), ('『', '』')):
        if len(text) > 1 and text.startswith(open_q) and text.endswith(close_q):
            text = text[1:-1].strip()
    return text


# ${c.translateOne}
def translate_one(text, lang):
    try:
        resp = client.responses.create(
            model=MODEL,
            # ${c.reasoning}
            reasoning={'effort': 'none'},
            instructions=SYSTEM_PROMPT,
            input=f"翻訳先の言語: {lang}\\n原文:\\n{text}",
        )
        return clean(resp.output_text)
    except Exception as e:
        # ${c.perLangFail}
        print(f'[translate] {lang}: {e}', flush=True)
        return ''


# ${c.parallel}
def translate_all(text, targets):
    with ThreadPoolExecutor(max_workers=max(1, len(targets))) as pool:
        return list(pool.map(lambda lang: translate_one(text, lang), targets))


@app.post('/translate')
def translate():
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    targets = data.get('targetLangs') or []
    sequence_id = data.get('sequenceId')

    if not text or not isinstance(targets, list):
        return jsonify({'error': 'Invalid parameters', 'sequenceId': sequence_id}), 400

    try:
        # ${c.align}
        started = time.perf_counter()
        translations = translate_all(text, targets)
        # ${c.timing}
        print(f'[translate] {len(targets)} lang(s) {(time.perf_counter() - started) * 1000:.0f} ms', flush=True)
    except Exception as e:
        app.logger.error('[translate] %s', e)
        return jsonify({'error': 'Translation failed', 'sequenceId': sequence_id}), 500

    return jsonify({'translations': translations, 'sequenceId': sequence_id})


if __name__ == '__main__':
    app.run(port=5000)`;
}

function buildGeminiExample() {
  const c = exampleComments();
  return `from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from concurrent.futures import ThreadPoolExecutor
import json
import time

# ${c.apiKey}
API_KEY = 'YOUR_API_KEY'
MODEL = 'gemini-3.1-flash-lite'

app = Flask(__name__)
CORS(app)
# ${c.timeout}
# ${c.timeoutUnit}
client = genai.Client(api_key=API_KEY, http_options={'timeout': 5000})

# ${c.prompt}
SYSTEM_PROMPT = """${SYSTEM_PROMPT_JA}"""


# ${c.parse}
def safe_parse_translation(raw):
    data = json.loads(raw or '{}')
    text = data.get('translation', '')
    return text if isinstance(text, str) else ''


# ${c.translateOne}
def translate_one(text, lang):
    try:
        resp = client.models.generate_content(
            model=MODEL,
            contents=f"翻訳先の言語: {lang}\\n原文:\\n{text}",
            config={
                'system_instruction': SYSTEM_PROMPT,
                'response_mime_type': 'application/json',
                'temperature': 0.3,
            },
        )
        return safe_parse_translation(resp.text)
    except Exception as e:
        # ${c.perLangFail}
        print(f'[translate] {lang}: {e}', flush=True)
        return ''


# ${c.parallel}
def translate_all(text, targets):
    with ThreadPoolExecutor(max_workers=max(1, len(targets))) as pool:
        return list(pool.map(lambda lang: translate_one(text, lang), targets))


@app.post('/translate')
def translate():
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    targets = data.get('targetLangs') or []
    sequence_id = data.get('sequenceId')

    if not text or not isinstance(targets, list):
        return jsonify({'error': 'Invalid parameters', 'sequenceId': sequence_id}), 400

    try:
        # ${c.align}
        started = time.perf_counter()
        translations = translate_all(text, targets)
        # ${c.timing}
        print(f'[translate] {len(targets)} lang(s) {(time.perf_counter() - started) * 1000:.0f} ms', flush=True)
    except Exception as e:
        app.logger.error('[translate] %s', e)
        return jsonify({'error': 'Translation failed', 'sequenceId': sequence_id}), 500

    return jsonify({'translations': translations, 'sequenceId': sequence_id})


if __name__ == '__main__':
    app.run(port=5000)`;
}
