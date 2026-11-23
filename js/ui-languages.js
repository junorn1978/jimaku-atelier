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
 * the output pane: the source line's wrap symbols and one-line limit, plus
 * alignment and background. Deliberately unheaded: every row is labelled, and
 * the row a title would cost is needed for the fourth control.
 *
 * Bottom — two columns matching the matrix's sides: the Chrome-only offline
 * recognition pack on the recognition side, and HOW to translate on the other
 * (one row: heading, picker, whatever the chosen engine needs). The version
 * signature that used to close this row lives only in the settings dialog's
 * About section now. The columns are sized to their contents rather
 * than split evenly, and everything is inlined (.col-head) since this is the
 * shortest tab in the app. The
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
import { settings, subscribe, LINKS } from './store.js';
import { applyTo, t, getLanguage } from './i18n.js';
import { isChrome } from './env.js';
import { setupLanguagePackButton, isCloudOnly } from './language-pack.js';
import { wireSecretInputs } from './ui-secret-input.js';
import { onSttState } from './stt-custom.js';
import { isPromptSupported, getPromptAvailability,
         preparePromptSession, destroyPromptSession,
         isPromptLangSupported } from './translate-prompt.js';
import { isTranslatorSupported, prepareTranslators,
         pendingTranslatorDownloads, downloadTranslator } from './translate-translator.js';
import { getPlamoSupport, loadPlamo, unloadPlamo } from './translate-plamo.js';
import { PLAMO_MODELS, getPlamoModel, plamoModelBytes, formatBytes,
         getPlamoStatus, downloadPlamo, deletePlamo } from './plamo-store.js';
import { wirePairList } from './ui-filter.js';
import { wireHoverTip } from './hover-tip.js';
import { wireSubtitlePresets } from './subtitle-presets.js';
import { decoControlsHtml, wireDeco } from './ui-deco.js';

/* Ranges for the per-line appearance controls, inherited along with them from
   the Style tab, which this tab absorbed. */
const SIZE_MIN   = 14;
const SIZE_MAX   = 48;
const STROKE_MIN = 0;
const STROKE_MAX = 10;
/* The cloud styles' cloud and rim (js/subtitle-cloud.js) scale with the font
   size, so their steps are finer and go further than the plain outline's. */
const BUBBLE_MAX = 15;

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
          <span class="outline-colors">
            <span class="color-cell">
              <input type="color" class="visually-hidden" data-bind="${key('Stroke')}" list="palette-text">
              <button type="button" class="color-swatch" data-color-trigger></button>
              <output class="color-value"></output>
            </span>
            <span class="color-cell">
              <input type="color" class="visually-hidden" data-bind="${key('Rim')}" list="palette-text">
              <button type="button" class="color-swatch" data-color-trigger></button>
              <output class="color-value"></output>
            </span>
          </span>
          <div class="slider-group">
            <input type="range" min="${SIZE_MIN}" max="${SIZE_MAX}" data-bind="${key('Size')}">
            <output class="slider-value"></output>
          </div>
          <!-- One width per style; only the one in use shows, and a hidden
               grid item takes no cell, so the column is the same either way. -->
          <div class="slider-group outline-stroke-only">
            <input type="range" min="${STROKE_MIN}" max="${STROKE_MAX}" data-bind="${key('StrokeW')}">
            <output class="slider-value"></output>
          </div>
          <div class="slider-group outline-cloud-only">
            <input type="range" min="${STROKE_MIN}" max="${BUBBLE_MAX}" data-bind="${key('BubbleW')}">
            <output class="slider-value"></output>
          </div>
          <!-- The rim width, one per style like the widths before it: px past
               the stroke for the plain outline, steps for the clouds. The
               cloud's source line setting is subRimW (js/store.js). -->
          <div class="slider-group outline-stroke-only">
            <input type="range" min="0" max="${STROKE_MAX}" data-bind="${key('StrokeRimW')}">
            <output class="slider-value"></output>
          </div>
          <div class="slider-group outline-cloud-only">
            <input type="range" min="0" max="${BUBBLE_MAX}" data-bind="${prefix === 'source' ? 'subRimW' : key('RimW')}">
            <output class="slider-value"></output>
          </div>`;
}

/* A slider column's header: its name, and the link that ties the two
   translation lines to the source line's value, the way a linked width and
   height move together. A checkbox under the icon, so it binds like any other
   switch. */
const LINK_ICON = `
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path class="link-on" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path class="link-on" d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                <path class="link-off" d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path class="link-off" d="M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                <path class="link-off" d="M8 2v3M2 8h3M16 22v-3M22 16h-3"/>
              </svg>`;

/* The Languages tab's group headings carry a small glyph each, in the
   heading's own dim colour: a way to tell the groups apart at a glance
   without giving either card a colour of its own. */
const ICON_LINES = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
const ICON_ENGINE = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>`;

function linkHead(labelKey, linkKey, extraClass = '') {
  return `
          <span class="link-head ${extraClass}">
            <span data-i18n="${labelKey}"></span>
            <label class="link-toggle" data-i18n-title="style.linkToSource" title="原文に合わせる">
              <input type="checkbox" class="visually-hidden" data-bind="${linkKey}"
                     data-i18n-aria-label="style.linkToSource" aria-label="原文に合わせる">${LINK_ICON}
            </label>
          </span>`;
}

/* The slider links (store.js LINKS): while one is on, the translation lines'
   values are kept equal to the source line's, and their sliders are disabled
   to show they are following. Kept equal in the store rather than resolved on
   read, so every reader — this window, the subtitle window, the OBS overlay,
   the presets — just takes each line's own value. Turning a link on copies
   the source line's value over; turning it off leaves each where it is, so
   nothing jumps. */
function wireLinks(container) {
  for (const [link, [base, ...followers]] of Object.entries(LINKS)) {
    const inputs = followers.flatMap(key =>
      [...container.querySelectorAll(`input[data-bind="${key}"]`)]);
    const follow = () => {
      if (!settings[link]) return;
      for (const key of followers) {
        if (settings[key] !== settings[base]) settings[key] = settings[base];
      }
    };
    const paint = () => {
      for (const input of inputs) input.disabled = !!settings[link];
    };
    subscribe(base, follow);
    subscribe(link, () => { follow(); paint(); });
    follow();
    paint();
  }
}

/**
 * The compact face of one engine's status line (see engineStatusLine): a chip
 * naming a steady state in a word or two, and the tip holding its sentence
 * (opened on hover too, by js/hover-tip.js).
 */
function statusChip(engine) {
  return `
              <button type="button" class="engine-status-chip" id="engine-${engine}-chip"
                      popovertarget="engine-${engine}-tip" hidden
                      data-i18n-title="lang.engine.status.more" title="詳細">
                <span class="engine-status-dot" aria-hidden="true"></span>
                <span class="engine-status-label"></span>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4"/>
                  <path d="M12 8h.01"/>
                </svg>
              </button>
              <div class="help-popover engine-status-tip" id="engine-${engine}-tip" popover="hint"></div>`;
}

/* Which engine messages show as a chip, and as what: [short label, tone]. The
   tone colours the chip's dot — ok green, warn amber, error red, info the
   accent (something to do, with its button beside the chip). */
const COMPACT_STATUS = {
  'lang.engine.translator.note':         ['lang.engine.status.caveat',         'warn'],
  'lang.engine.translator.needDownload': ['lang.engine.status.needDownload',   'info'],
  'lang.engine.translator.unavailable':  ['lang.engine.status.langUnsupported', 'error'],
  'lang.engine.translator.blocked':      ['lang.engine.status.failed',         'error'],
  'lang.engine.translator.failed':       ['lang.engine.status.failed',         'error'],
  'lang.engine.translator.unsupported':  ['lang.engine.status.unavailable',    'error'],
  'lang.engine.prompt.ready':            ['lang.engine.status.ready',          'ok'],
  'lang.engine.prompt.failed':           ['lang.engine.status.failed',         'error'],
  'lang.engine.prompt.langUnsupported':  ['lang.engine.status.langUnsupported', 'error'],
  'lang.engine.plamo.ready':             ['lang.engine.status.ready',          'ok'],
  'lang.engine.plamo.needDownload':      ['lang.engine.status.needDownload',   'info'],
  'lang.engine.plamo.partial':           ['lang.engine.status.needDownload',   'info'],
  'lang.engine.plamo.busy':              ['lang.engine.status.needDownload',   'warn'],
  'lang.engine.plamo.failed':            ['lang.engine.status.failed',         'error'],
  'lang.engine.plamo.downloadFailed':    ['lang.engine.status.failed',         'error'],
};

/**
 * An engine's status line has two faces. What is in flux — a countdown,
 * progress, a model loading — is short and written out in the row. Every
 * other message is a sentence, and the row beside the picker has room for a
 * few words and the engine's buttons, not for a sentence: written out it
 * wrapped the buttons onto two-line text, or the whole row into a column one
 * character wide. Those shrink to a chip naming the state in a word or two,
 * coloured by tone so a failure still reads as one at a glance, with the
 * sentence in its tip.
 * The <p> keeps the full sentence either way, only visually hidden behind the
 * chip, so its live region still announces it.
 * Returns show(text, keys): text '' hides the line; keys are the message's
 * i18n key(s), looked up in COMPACT_STATUS for the chip face.
 */
function engineStatusLine(container, engine) {
  const status = container.querySelector(`#engine-${engine}-status`);
  const chip   = container.querySelector(`#engine-${engine}-chip`);
  const tip    = container.querySelector(`#engine-${engine}-tip`);
  const label  = chip.querySelector('.engine-status-label');

  const closeTip = wireHoverTip(chip, tip);

  return (text, keys = []) => {
    const compact = [].concat(keys).map(k => COMPACT_STATUS[k]).find(Boolean);
    const asChip = !!(text && compact);
    status.hidden = !text;
    status.textContent = text || '';
    status.classList.toggle('visually-hidden', asChip);
    chip.hidden = !asChip;
    if (asChip) {
      chip.dataset.tone = compact[1];
      label.textContent = t(compact[0]);
      tip.textContent = text;
    } else {
      closeTip();
    }
  };
}

/**
 * Fills two tabs: the Languages tab (`container`) and the Appearance tab
 * (`appearance`). They are mounted together because the engine and the line
 * matrix were one tab until recently and still share setup (the presets, the
 * slider links, the language names the matrix shows).
 */
export function mountLanguagesTab(container, appearance) {
  if (!container) return;

  const langs = getAllLanguages();
  const targetOptions =
    `<option value="none" data-i18n="lang.none">翻訳しない</option>` +
    langs.map(l => `<option value="${l.id}" data-i18n="lang.name.${l.id}">${escapeAttr(l.label)}</option>`).join('');
  const sourceOptions =
    `<option value="" data-i18n="lang.choose">言語を選択</option>` +
    langs.map(l => `<option value="${l.id}" data-i18n="lang.name.${l.id}">${escapeAttr(l.label)}</option>`).join('');

  container.innerHTML = `
    <div class="lang-layout">
      <!-- Two grouped cards of equal width, the way grouped settings are laid
           out: a small heading above each card, rows of "name on the left,
           control on the right" divided by hairlines. On the left what the
           three subtitle lines say (and the offline recognition pack, about
           the source line), on the right how the translations are made. Both
           cards share one surface: colour is kept for state (the status dot,
           the red delete), not for telling the groups apart. Each line's
           appearance is the Appearance tab (the second template below). -->
      <section class="lang-group lang-lines" aria-labelledby="lang-lines-title">
        <h3 class="group-title" id="lang-lines-title">${ICON_LINES}<span data-i18n="lang.lines">字幕の言語</span></h3>
        <div class="group-card">
          <div class="group-row lang-line-row">
            <span class="lang-field-label" data-i18n="lang.source">音声認識</span>
            <select class="select select-compact" data-bind="sourceLangId">${sourceOptions}</select>
          </div>
          <div class="group-row lang-line-row">
            <span class="lang-field-label" data-i18n="lang.target1">翻訳 1</span>
            <select class="select select-compact" data-bind="target1LangId">${targetOptions}</select>
          </div>
          <div class="group-row lang-line-row">
            <span class="lang-field-label" data-i18n="lang.target2">翻訳 2</span>
            <select class="select select-compact" data-bind="target2LangId">${targetOptions}</select>
          </div>

      <!-- Offline recognition pack, under the language pickers since it is
           about recognising the source line. Chrome-only, and behind the
           experimental switch in the settings dialog, so for most people this
           row does not exist. Heading inline with the button. -->
      <section class="group-row lang-sub" id="offline-pack-row" hidden>
        <div class="col-head">
          <h3 class="section-title" data-i18n="lang.offline.label">オフライン音声認識パック</h3>
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
        </div>
      </section>

      <!-- How to translate, as the second group: the picker, the chosen
           engine's state and what it needs, then its settings. It used to be
           the matrix's last row, squeezed into the width the appearance
           columns left. -->
      <section class="lang-group lang-engine" aria-labelledby="engine-card-title">
        <h3 class="group-title" id="engine-card-title">${ICON_ENGINE}<span data-i18n="lang.engine">翻訳エンジン</span></h3>
        <div class="group-card">
        <div class="group-row engine-picker-row">
            <span class="lang-field-label" data-i18n="lang.engine.picker">エンジン</span>
            <!-- A pop-up button rather than a segmented switch: with three
                 engines and a fourth behind a setting, of uneven name lengths,
                 picked once and then left, the switch only took the width the
                 status line and its buttons beside it need. An engine that
                 cannot run is a disabled option; the status line says why.
                 The last option is never offered: it only names the
                 translation server (lang.advanced) while that is on, so the
                 picker shows what is actually translating. Picking an engine
                 from here turns the server off, as before. -->
            <select class="select select-compact engine-select" id="engine-select" data-bind="translationMode"
                    data-i18n-aria-label="lang.engine" aria-label="翻訳エンジン">
              <option value="gtx" data-i18n="lang.engine.gtx">Google 翻訳</option>
              <option value="translator" id="engine-translator-option" data-i18n="lang.engine.translator">ブラウザ翻訳</option>
              <option value="prompt" id="engine-prompt-option" data-i18n="lang.engine.prompt">ブラウザ AI</option>
              <option value="plamo" id="engine-plamo-option" data-i18n="lang.engine.plamo">AI 翻訳（PLaMo 3・GPU）</option>
              <option value="link" hidden disabled data-i18n="lang.advanced.link">翻訳サーバー</option>
            </select>
            <!-- Stands in for the picker while the recognition server
                 translates (lang.advanced): no engine is used then, not even
                 the translation server, so there is nothing to pick. A second
                 select rather than an option of the first, which is bound to
                 translationMode and would be set back to the engine. -->
            <select class="select select-compact engine-select" id="engine-stt-select" disabled hidden
                    data-i18n-aria-label="lang.engine" aria-label="翻訳エンジン">
              <option data-i18n="lang.engine.stt.active">音声認識サーバーの翻訳を使用中</option>
            </select>
        </div>

          <!-- Row 2: the chosen engine's state (a chip, or progress written out)
               and what it needs beside it — the model size, a download. Empty
               for Google, so the row goes (CSS :has). -->
            <div class="group-row engine-inline">
              <p class="manual-status" id="engine-translator-status" role="status" aria-live="polite" hidden></p>${statusChip('translator')}
              <!-- Downloads are the user's to start, so a missing model is
                   offered here instead of fetched on the pick. -->
              <button type="button" class="btn" id="engine-translator-download" data-i18n="lang.engine.translator.download" hidden>ダウンロード</button>
              <p class="manual-status" id="engine-prompt-status" role="status" aria-live="polite" hidden></p>${statusChip('prompt')}
              <!-- PLaMo: the size picker shows on the pick, since it decides
                   what the download button fetches. The credit is the
                   license's "Built with PLaMo" notice (art. 4), linked to
                   the license itself. -->
              <p class="manual-status" id="engine-plamo-status" role="status" aria-live="polite" hidden></p>${statusChip('plamo')}
              <select class="select select-compact plamo-model-select" id="engine-plamo-model" data-bind="plamoModel"
                      data-i18n-aria-label="lang.engine.plamo.model" aria-label="PLaMo モデル" hidden>
                ${PLAMO_MODELS.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}
              </select>
              <!-- Labelled from code: "download" or "resume". -->
              <button type="button" class="btn" id="engine-plamo-download" hidden></button>
              <!-- While the translation server is on, the picker beside has
                   nothing selected; this says where the lines go instead.
                   Picking an engine turns the server off. -->
              <p class="manual-status" id="engine-link-note" data-i18n="lang.engine.link.active" hidden>上級者向けの翻訳サーバーで翻訳しています</p>
            </div>

            <!-- Row 3: the engine's settings, then removing the model at the
                 far end — apart from the everyday buttons and quiet (red text),
                 since it means downloading gigabytes again, but in plain sight:
                 it is also the way out of a model that will not load. -->
            <div class="group-row engine-actions">
              <!-- The options only mean something to a loaded model, so they
                   show with the delete button rather than on the pick. -->
              <button type="button" class="btn ai-options-btn" id="engine-ai-options"
                      popovertarget="popover-ai-options"
                      data-i18n="lang.engine.plamo.options" hidden>AI 翻訳オプション</button>
              <div class="help-popover ai-options-popover" id="popover-ai-options" popover>
                <section class="advanced-section ai-glossary">
                  <h4 class="advanced-title" data-i18n="lang.engine.plamo.glossary.title">用語の訳し方</h4>
                  <p class="advanced-desc" data-i18n="lang.engine.plamo.glossary.desc"></p>
                  <div class="filter-list-wrap">
                    <div class="filter-list" id="ai-glossary-list"></div>
                    <button type="button" class="btn filter-add" id="ai-glossary-add" data-i18n="filter.add">+ 追加</button>
                  </div>
                </section>
              </div>

              <button type="button" class="text-btn danger" id="engine-plamo-delete" data-i18n="lang.engine.plamo.delete" hidden>モデルを削除</button>
            </div>
        </div>
        <!-- The license's "Built with PLaMo" notice (art. 4), linked to the
             license itself: a footnote under the card, the way grouped
             settings carry their small print. -->
        <p class="group-foot">
          <a class="plamo-credit" id="engine-plamo-credit" target="_blank" rel="noopener" hidden>Built with PLaMo</a>
        </p>
      </section>

      <!-- On the headings' line, at the right edge: a setting of the whole
           tab, not of either group. -->
      <div class="lang-tools">
              <!-- Servers of the user's own, for recognition and translation.
                   Tab-wide rather than in the engine card: a recognition server
                   replaces the recogniser too, so it belongs to neither group.
                   Kept behind a button because only someone who runs a server can
                   use either, and their fields and notes crowded the tab for
                   everyone else. The button carries the state the popover hides:
                   lit while either is on, with the recognition server's
                   connection as a dot — a stream going silent because that
                   server is down has to be visible without opening anything. -->
              <button type="button" class="advanced-btn" id="btn-advanced"
                      popovertarget="popover-advanced" data-active="false"
                      data-i18n-title="lang.advanced.hint" title="上級者向け">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>
                <span data-i18n="lang.advanced">自前のサーバー</span>
                <span class="advanced-note" data-i18n="lang.advanced.note">・上級者向け</span>
                <span class="stt-status-dot" aria-hidden="true" hidden></span>
              </button>

              <div class="help-popover advanced-popover" id="popover-advanced" popover>
                <section class="advanced-section">
                  <div class="advanced-head">
                    <h4 class="advanced-title" data-i18n="lang.advanced.stt">音声認識サーバー</h4>
                    <label class="toggle">
                      <input type="checkbox" id="adv-stt-toggle">
                      <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    </label>
                  </div>
                  <p class="advanced-desc" data-i18n="lang.advanced.stt.desc"></p>
                  <!-- Masked like the translation URL below: a server reached
                       from outside usually carries its token in the query. -->
                  <div class="secret-input-wrap" data-secret-visible="false"
                       data-secret-show="lang.engine.link.url.show"
                       data-secret-hide="lang.engine.link.url.hide">
                    <input type="url" class="text-input secret-input" placeholder="ws://127.0.0.1:9000"
                           data-bind="customSttUrl" autocomplete="off" spellcheck="false">
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
                  <label class="advanced-option">
                    <span data-i18n="lang.advanced.stt.useTranslations">サーバーが返した翻訳を使う</span>
                    <span class="toggle toggle-compact">
                      <input type="checkbox" data-bind="useSttTranslations">
                      <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    </span>
                  </label>
                  <div class="advanced-foot">
                    <p class="stt-status" id="stt-status" role="status" aria-live="polite" data-phase="idle">
                      <span class="stt-status-dot" aria-hidden="true"></span>
                      <span class="stt-status-text"></span>
                    </p>
                    <a class="advanced-link" href="docs/custom-stt.html"
                       target="_blank" rel="noopener" data-i18n="lang.advanced.stt.spec">接続仕様とサンプル</a>
                  </div>
                </section>

                <!-- Inert while the recognition server translates: nothing is
                     sent here then, so it shows as off without being switched
                     off, and is back as it was once that ends. -->
                <section class="advanced-section" id="adv-link-section">
                  <div class="advanced-head">
                    <h4 class="advanced-title" data-i18n="lang.advanced.link">翻訳サーバー</h4>
                    <label class="toggle">
                      <input type="checkbox" id="adv-link-toggle">
                      <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    </label>
                  </div>
                  <p class="advanced-desc" data-i18n="lang.advanced.link.desc"></p>
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
                  <div class="format-help-examples">
                    <span data-i18n="lang.engine.link.help.examples">そのまま使えるサンプル：</span>
                    <button type="button" class="btn" data-example="minimal" data-i18n="lang.engine.link.example.btn.minimal">最小</button>
                    <button type="button" class="btn" data-example="openai">OpenAI</button>
                    <button type="button" class="btn" data-example="gemini">Gemini</button>
                    <button type="button" class="btn" id="btn-url-format" data-i18n="lang.engine.link.help.btn">形式の説明</button>
                  </div>
                </section>
              </div>
      </div>
    </div>
  `;

  if (appearance) appearance.innerHTML = `
    <div class="lang-grid">
      <!-- One row per subtitle line, carrying its appearance. The line's
           language is set on the Languages tab and named here, read-only, at
           the head of its row, so a row still says which line it is drawing.
           A line that is not translated has nothing to style: its row says
           so and links back to the Languages tab. Column headers are written
           once; each row is a display:contents wrapper so its cells join the
           outer grid and every control of the same kind lines up vertically. -->
      <div class="lang-top">
      <div class="lang-matrix">
        <div class="lang-matrix-head">
          <!-- The corner over the label and language columns is empty: the
               show-source switch moved into the display menu, at the head of
               the source settings it governs. -->
          <span></span>
          <span></span>
          <span data-i18n="style.textColor">文字色</span>
          <!-- Two colours per line in every style: the outline (or, under a
               cloud outline, js/subtitle-cloud.js, the cloud) and the rim
               around it. The width sizes the stroke or the cloud: the headers
               say which. -->
          <span>
            <span class="outline-stroke-only" data-i18n="style.strokeColors">縁取り / 外枠</span>
            <span class="outline-cloud-only" data-i18n="style.bubbleColors">バブル / 外枠</span>
          </span>
          <!-- Each slider column's header carries a link (linkHead): on, the
               translation lines take the source line's value. The width
               column holds one per outline style, as each keeps its own
               widths, and so does the rim column. -->
          ${linkHead('style.fontSize', 'subSizeLinked')}
          <span>
            ${linkHead('style.strokeWidth', 'subStrokeWLinked', 'outline-stroke-only')}
            ${linkHead('style.bubbleSize', 'subBubbleWLinked', 'outline-cloud-only')}
          </span>
          <span>
            ${linkHead('style.rimWidth', 'subStrokeRimLinked', 'outline-stroke-only')}
            ${linkHead('style.rimWidth', 'subRimLinked', 'outline-cloud-only')}
          </span>
        </div>

        <div class="lang-matrix-row" data-line="source">
          <span class="lang-field-label" data-i18n="lang.source">音声認識</span>
          <span class="lang-name" data-lang-of="sourceLangId"></span>
          ${styleCells('source')}
          <p class="line-unused-note">
            <span data-i18n="style.lineUnused">翻訳しない設定です。</span>
            <button type="button" class="link-btn" data-goto-tab="languages" data-i18n="style.lineUnused.add">言語タブで追加</button>
          </p>
        </div>

        <div class="lang-matrix-row" data-line="target1">
          <span class="lang-field-label" data-i18n="lang.target1">翻訳 1</span>
          <span class="lang-name" data-lang-of="target1LangId"></span>
          ${styleCells('target1')}
          <p class="line-unused-note">
            <span data-i18n="style.lineUnused">翻訳しない設定です。</span>
            <button type="button" class="link-btn" data-goto-tab="languages" data-i18n="style.lineUnused.add">言語タブで追加</button>
          </p>
        </div>

        <div class="lang-matrix-row" data-line="target2">
          <span class="lang-field-label" data-i18n="lang.target2">翻訳 2</span>
          <span class="lang-name" data-lang-of="target2LangId"></span>
          ${styleCells('target2')}
          <p class="line-unused-note">
            <span data-i18n="style.lineUnused">翻訳しない設定です。</span>
            <button type="button" class="link-btn" data-goto-tab="languages" data-i18n="style.lineUnused.add">言語タブで追加</button>
          </p>
        </div>
      </div>
      </div>

      <!-- The colour presets (js/subtitle-presets.js), under the matrix,
           since a preset sets every line's colours at once. Nothing on the
           row applies a set in one click — a stray click used to throw away
           colours just tuned. The row shows the look in use (the themes
           pop-up: its colours and name, "edited" once it matches no set);
           applying goes through the menu, and is undoable for a moment;
           saving to マイテーマ is its own button. -->
      <section class="sub-preset-row" aria-labelledby="sub-preset-label">
        <span class="lang-field-label" id="sub-preset-label" data-i18n="style.preset">配色</span>
        <button type="button" class="btn sub-preset-themes" popovertarget="sub-preset-menu">
          <span class="sub-preset-dots sub-preset-current-dots" aria-hidden="true"></span>
          <span class="sub-preset-current-name"></span>
          <span class="sub-preset-modified" data-i18n="style.preset.modified" hidden>・変更あり</span>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
        </button>

        <!-- Saving the look in use to one of the three slots: two clicks, each
             slot showing what it holds so an overwrite is seen before it is
             made. Lit while the look is unsaved (matches no set). -->
        <button type="button" class="sub-preset-save-btn" popovertarget="sub-preset-save-menu">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <span data-i18n="style.preset.saveTo">マイテーマに保存</span>
        </button>
        <div class="sub-preset-save-menu" id="sub-preset-save-menu" popover
             data-i18n-aria-label="style.preset.saveTo" aria-label="マイテーマに保存">
          <span class="sub-preset-head" data-i18n="style.preset.saveTo.head">保存先（いまの配色で上書き）</span>
          <div class="sub-preset-save-list"></div>
        </div>

        <!-- After a set is applied from the menu: what was applied, and the way
             back to the colours it replaced, for a few seconds. -->
        <p class="sub-preset-notice" role="status" aria-live="polite" hidden>
          <span class="sub-preset-notice-text"></span>
          <button type="button" class="link-btn sub-preset-undo" data-i18n="style.preset.undo">元に戻す</button>
        </p>
        <div class="sub-preset-menu" id="sub-preset-menu" popover
             data-i18n-aria-label="style.preset.title" aria-label="字幕の配色">
          <!-- The outline setting itself, and the switch between the two lists
               of sets below (js/subtitle-presets.js). The rim width that sat
               beside it is each line's own now, in the matrix. -->
          <div class="sub-outline-bar">
            <div class="seg-switch sub-outline-switch" role="group"
                 data-i18n-aria-label="style.outline" aria-label="縁取りの種類">
              <label><input type="radio" name="subOutline" value="stroke" data-bind="subOutline"><span data-i18n="style.outline.stroke">縁取り</span></label>
              <label><input type="radio" name="subOutline" value="bubble" data-bind="subOutline"><span data-i18n="style.outline.bubble">バブル</span></label>
              <label><input type="radio" name="subOutline" value="gooey" data-bind="subOutline"><span data-i18n="style.outline.gooey">もこもこ</span></label>
            </div>
          </div>
          <span class="sub-preset-head" data-i18n="style.preset.title">字幕の配色</span>
          <div class="sub-preset-grid"></div>
          <span class="sub-preset-head" data-i18n="style.preset.custom.menuHead">マイテーマ</span>
          <div class="sub-preset-mine"></div>
        </div>

        <!-- The layout menu: the source line's switch and settings, and the
             two that act on the whole display (alignment, chroma-key
             background), behind a button beside the themes rather than as a
             standing card beside the matrix: they are set once and judged by
             looking, and the card took the width the matrix needs. Same
             button, same menu dress as the themes, so the row has one way of
             opening things. Named for the layout — whether the source shows,
             its lines, alignment, background — rather than for the source
             line, since more layout settings will join it; the brackets and
             pictures, which are looks, may move to the themes later. -->
        <button type="button" class="btn sub-source-btn" popovertarget="sub-source-menu">
          <span data-i18n="style.displayMenu">レイアウト</span>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>
        </button>
        <div class="sub-source-menu lang-extras" id="sub-source-menu" popover
             data-i18n-aria-label="style.displayMenu" aria-label="レイアウト">
        <!-- Two groups, because the four settings are two kinds of thing: the
             first pair only touches the source line, the second pair the whole
             display. Laid out as four identical rows they read as one list of
             unrelated odds and ends.
             The source group is headed once, so its row labels drop the
             repeated "source" word. Its heading carries the show-source switch,
             the way a settings group is switched on from its own header; the
             rows under it dim while the line is hidden (CSS :has()) but stay
             editable, so they can be set up before the line is turned on.
             A two-state picker rather than a bare toggle: it names both states
             instead of leaving one implied. -->
        <div class="lang-extras-group lang-extras-source">
        <label class="lang-extras-heading">
          <span data-i18n="style.showSource">原文を表示</span>
          <span class="toggle toggle-compact">
            <input type="checkbox" id="lang-show-source" data-bind="subShowSource">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </span>
        </label>
        <span class="lang-extras-label" data-i18n="style.sourceLines">行数</span>
        <div class="seg-switch" role="group">
          <label><input type="radio" name="subSourceSingleLine" value="false" data-bind="subSourceSingleLine"><span data-i18n="style.sourceLines.all">制限なし</span></label>
          <label><input type="radio" name="subSourceSingleLine" value="true" data-bind="subSourceSingleLine"><span data-i18n="style.sourceLines.one">1行</span></label>
        </div>

        <span class="lang-extras-label" data-i18n="style.sourceWrap">囲み記号</span>
        <div class="symbol-inputs">
          <input type="text" class="text-input" data-bind="subSourcePrefix"
                 data-i18n-placeholder="style.sourcePrefix.ph" data-i18n-title="style.sourcePrefix" title="左記号"
                 autocomplete="off" spellcheck="false" autocorrect="off" maxlength="8">
          <input type="text" class="text-input" data-bind="subSourceSuffix"
                 data-i18n-placeholder="style.sourceSuffix.ph" data-i18n-title="style.sourceSuffix" title="右記号"
                 autocomplete="off" spellcheck="false" autocorrect="off" maxlength="8">
        </div>

        <!-- Pictures on the first and last characters' top corners
             (js/subtitle-deco.js, js/ui-deco.js): a button per corner, each
             opening that corner's own picture, switch, angle and size. -->
        ${decoControlsHtml()}
        </div>

        <!-- The whole-display pair shares one row: both controls are short, so
             stretching each across its own row only padded them with air. -->
        <div class="lang-extras-group lang-extras-display">
        <div class="lang-extras-pair">
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
        <div class="lang-extras-pair">
        <span class="lang-extras-label" data-i18n="style.bg">背景色</span>
        <span class="color-pick">
          <input type="color" class="visually-hidden" data-bind="subBg" list="palette-bg">
          <button type="button" class="btn color-trigger-text" data-color-trigger>
            <output class="color-value"></output>
          </button>
        </span>
        </div>

        <!-- The space between the three lines, on a row of its own under the
             pair: a slider wants more width than half the row. Same slider
             and readout as the matrix's. -->
        <div class="lang-extras-pair lang-extras-gap">
        <span class="lang-extras-label" data-i18n="style.lineGap">行の間隔</span>
        <div class="slider-group">
          <input type="range" min="0" max="40" data-bind="subLineGap"
                 data-i18n-aria-label="style.lineGap" aria-label="行の間隔">
          <output class="slider-value"></output>
        </div>
        </div>
        </div>
        </div>
      </section>
    </div>
  `;

  /* Style the radios as a segmented switch by overlaying span as the visible
     button. The styling lives in CSS (.seg-switch label / input). */

  /* "格式說明" opens the URL-format help dialog (static markup in index.html). */
  container.querySelector('#btn-url-format')?.addEventListener('click', (e) => {
    e.target.closest('[popover]')?.hidePopover();
    document.getElementById('dialog-url-format')?.showModal();
  });

  wireExampleButtons(container);
  wireSecretInputs(container);
  if (appearance) {
    wireSubtitlePresets(appearance.querySelector('.sub-preset-row'));
    wireDeco(appearance);
    wireLinks(appearance);
    wireLineNames(appearance, langs);
  }
  setupAdvanced(container);
  setupOfflinePack(container);
  markCloudOnlySources(container);
  setupTranslatorEngine(container);
  setupPromptEngine(container);
  const aiOptions = setupAiOptions(container);
  setupPlamoEngine(container, aiOptions);
  dropRetiredHymtCache();
}

/* The Appearance tab names each line's language at the head of its row,
   read-only — the pickers are on the Languages tab. A translation line set to
   "none" draws nothing, so its row hides its controls and offers the way to
   the Languages tab instead (.is-unused). The names follow the store, and the
   interface language for their wording. */
function wireLineNames(appearance, langs) {
  const labelOf = (id) => {
    if (!id) return t('lang.choose');
    if (id === 'none') return t('lang.none');
    const key = `lang.name.${id}`;
    const text = t(key);
    return text !== key ? text : (langs.find(l => l.id === id)?.label ?? id);
  };

  const cells = [...appearance.querySelectorAll('.lang-name[data-lang-of]')];
  const paint = () => {
    for (const cell of cells) {
      const id = settings[cell.dataset.langOf];
      cell.textContent = labelOf(id);
      const row = cell.closest('.lang-matrix-row');
      row?.classList.toggle('is-unused', cell.dataset.langOf !== 'sourceLangId' && (!id || id === 'none'));
    }
  };
  for (const key of ['sourceLangId', 'target1LangId', 'target2LangId', 'uiLang']) subscribe(key, paint);
  paint();

  appearance.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-goto-tab]');
    if (!btn) return;
    const line = btn.closest('.lang-matrix-row')?.dataset.line;
    document.getElementById(`tab-btn-${btn.dataset.gotoTab}`)?.click();
    /* Land on the picker that would bring this line back. */
    const bind = { target1: 'target1LangId', target2: 'target2LangId' }[line];
    if (bind) document.querySelector(`#tab-languages select[data-bind="${bind}"]`)?.focus();
  });
}

/* The advanced popover's two switches are views of existing settings rather
   than settings of their own: the recognition server is sttEngine 'custom',
   the translation server is translationMode 'link'. So a user who picked the
   custom URL engine before it moved in here finds its switch already on, and
   picking an engine in the row turns the translation server off. */
function setupAdvanced(container) {
  const btn        = container.querySelector('#btn-advanced');
  const btnDot     = btn?.querySelector('.stt-status-dot');
  const sttToggle  = container.querySelector('#adv-stt-toggle');
  const linkToggle = container.querySelector('#adv-link-toggle');
  const linkPart   = container.querySelector('#adv-link-section');
  const note       = container.querySelector('#engine-link-note');
  const sttPicker  = container.querySelector('#engine-stt-select');
  const section    = container.querySelector('.lang-engine');
  const picker     = container.querySelector('#engine-select');
  const status     = container.querySelector('#stt-status');
  const text       = status?.querySelector('.stt-status-text');
  if (!btn || !btnDot || !sttToggle || !linkToggle || !linkPart || !note || !sttPicker || !section || !picker || !status || !text) return;

  /* The engine to go back to when the translation server is switched off:
     whatever was picked before it was switched on, else Google. */
  let lastEngine = settings.translationMode !== 'link' ? settings.translationMode : 'gtx';
  let sttState = { phase: 'idle', detail: '' };

  const sync = () => {
    const stt  = settings.sttEngine === 'custom';
    const link = settings.translationMode === 'link';
    const sttTranslates = stt && settings.useSttTranslations;
    sttToggle.checked  = stt;
    linkToggle.checked = link && !sttTranslates;
    linkPart.inert     = sttTranslates;
    btn.dataset.active = String(stt || link);
    btnDot.hidden = !stt;
    btnDot.dataset.phase = sttState.phase;
    note.hidden      = !link || sttTranslates;
    picker.hidden    = sttTranslates;
    sttPicker.hidden = !sttTranslates;
    section.dataset.sttTranslates = String(sttTranslates);
    picker.classList.toggle('is-overridden', link);
  };

  const renderStatus = () => {
    status.dataset.phase = sttState.phase;
    const label = t(`lang.stt.status.${sttState.phase}`);
    text.textContent = sttState.detail ? `${label}（${sttState.detail}）` : label;
    status.title = text.textContent;
    sync();
  };

  sttToggle.addEventListener('change', () => {
    settings.sttEngine = sttToggle.checked ? 'custom' : 'webspeech';
  });
  linkToggle.addEventListener('change', () => {
    settings.translationMode = linkToggle.checked ? 'link' : lastEngine;
  });
  subscribe('translationMode', (mode) => { if (mode !== 'link') lastEngine = mode; sync(); });
  subscribe('sttEngine', sync);
  subscribe('useSttTranslations', sync);
  onSttState((state) => { sttState = state; renderStatus(); });
  subscribe('uiLang', renderStatus);
}

/* Recognition languages that can only ever run on the cloud recogniser get a
   🌐 after their name in the source picker. A native <option> holds text
   only, so the marker is an emoji rather than an SVG icon; it rides along as
   data-i18n-suffix so a UI-language switch keeps it. Independent of the
   (off-by-default) offline-pack row: it answers "will this ever run
   locally", not "is a pack installed". */
const CLOUD_ONLY_MARK = ' 🌐';

async function markCloudOnlySources(container) {
  const select = container.querySelector('select[data-bind="sourceLangId"]');
  if (!select) return;
  for (const opt of select.options) {
    if (!opt.value || !(await isCloudOnly(opt.value))) continue;
    opt.dataset.i18nSuffix = CLOUD_ONLY_MARK;
    if (!opt.textContent.endsWith(CLOUD_ONLY_MARK)) opt.textContent += CLOUD_ONLY_MARK;
  }
}

/* Built-in Translator API engine. Models are per language pair, so picking the
   engine or changing a language can need one. Picking is not consent to
   download, though: a missing model is offered with a download button, and
   only that click (whose gesture create() needs anyway) starts it. Pairs
   already downloaded are warmed up straight away. */
function setupTranslatorEngine(container) {
  const option      = container.querySelector('#engine-translator-option');
  const status      = container.querySelector('#engine-translator-status');
  const downloadBtn = container.querySelector('#engine-translator-download');
  if (!option || !status || !downloadBtn) return;

  /* Keep the message as a key (+ percentage) so a UI language switch can
     re-render it without redoing the work that produced it. */
  let messageKey = null;
  let percent    = null;

  const show = engineStatusLine(container, 'translator');

  /* Ready shows as the caveat's chip: the standing caveat is what the line
     says from then on, so the chip names it rather than "ready". */
  const render = () => {
    if (!messageKey) { show(''); return; }
    const suffix = percent == null ? '' : ` ${percent}%`;
    const text = [].concat(messageKey).map(k => t(k)).join(' ')
      .replace('{lang}', vars.lang ? t(`lang.name.${vars.lang}`) : '')
      .replace('{n}', String(vars.n ?? '')) + suffix;
    show(text, messageKey);
  };

  /* `vars`: {lang} is a language id, named in the UI language; {n} a count. */
  let vars = {};
  const setMessage = (key, pct = null, v = {}) => { messageKey = key; percent = pct; vars = v; render(); };
  subscribe('uiLang', render);

  if (!isTranslatorSupported()) {
    /* Said on the disabled option itself, not in the status line: the menu
       is where the engine is looked for, and a standing line about an engine
       nobody picked would only be noise beside the one in use. */
    option.disabled = true;
    option.dataset.i18n = 'lang.engine.translator.unsupportedOption';
    option.textContent = t(option.dataset.i18n);
    if (settings.translationMode === 'translator') settings.translationMode = 'gtx';
    return;
  }

  const REASON_KEYS = {
    unavailable: 'lang.engine.translator.unavailable',
    blocked:     'lang.engine.translator.blocked',
    failed:      'lang.engine.translator.failed',
    unsupported: 'lang.engine.translator.unsupported',
  };

  const selection = () => [settings.sourceLangId, [settings.target1LangId, settings.target2LangId]];
  const stillPicked = () => settings.translationMode === 'translator';

  /* Targets whose model is still to be downloaded, first in line first. One
     click downloads one (see pendingTranslatorDownloads for why); the row
     names the next one and how many are left ("次へ (N)"). */
  let queue = [];
  /* Only one check or download at a time; a language change meanwhile is
     remembered and checked again afterwards rather than dropped. */
  let busy = false;
  let restart = false;
  /* Set when a click downloaded something, so the ready line says so once. */
  let downloadedAny = false;

  const offerNext = () => {
    setMessage(queue.length > 1
      ? ['lang.engine.translator.needDownload', 'lang.engine.translator.remaining']
      : 'lang.engine.translator.needDownload', null, { lang: queue[0], n: queue.length });
    downloadBtn.hidden = false;
  };

  /* Without consent: works out the queue, offers its head, or — with nothing
     to download — warms up the installed pairs, which needs no gesture. */
  const check = async () => {
    if (!stillPicked()) return;
    if (busy) { restart = true; return; }
    busy = true;
    try {
      queue = await pendingTranslatorDownloads(...selection());
      if (!stillPicked()) return;
      if (queue.length) { offerNext(); return; }

      downloadBtn.hidden = true;
      setMessage('lang.engine.translator.preparing');
      const result = await prepareTranslators(...selection());
      if (!stillPicked()) { setMessage(null); return; }
      /* Once ready, the line keeps a standing caveat instead of going blank:
         on unpunctuated Japanese the model drops the tail of long lines. */
      if (result.ok) {
        setMessage(downloadedAny
          ? ['lang.engine.translator.ready', 'lang.engine.translator.note']
          : 'lang.engine.translator.note');
        downloadedAny = false;
      } else {
        setMessage(REASON_KEYS[result.reason] ?? REASON_KEYS.failed);
      }
    } finally {
      busy = false;
    }
    if (restart) { restart = false; await check(); }
  };

  /* The consent: downloads the head of the queue, then checks again, which
     offers the next one or finishes. Nothing is awaited before the download
     starts, so the click's activation is still live when create() needs it. */
  downloadBtn.addEventListener('click', async () => {
    if (busy || !queue.length) return;
    const target = queue[0];
    busy = true;
    downloadBtn.disabled = true;
    setMessage('lang.engine.translator.downloading', 0, { lang: target });

    /* The download carries on if another engine is picked meanwhile (it is
       still worth having), but its progress and outcome must not reappear
       beside that engine's own row. */
    let result;
    try {
      result = await downloadTranslator(settings.sourceLangId, target, (loaded) => {
        if (stillPicked()) setMessage('lang.engine.translator.downloading', Math.floor(loaded * 100), { lang: target });
      });
    } finally {
      busy = false;
      downloadBtn.disabled = false;
    }

    if (!stillPicked()) { setMessage(null); downloadBtn.hidden = true; return; }
    if (!result.ok) {
      setMessage(REASON_KEYS[result.reason] ?? REASON_KEYS.failed);
      /* An unsupported pair stays unsupported; anything else can be retried
         with the same button. */
      downloadBtn.hidden = result.reason === 'unavailable';
      return;
    }
    downloadedAny = true;
    restart = false;
    await check();
  });

  subscribe('translationMode', (mode) => {
    if (mode === 'translator') check();
    else { setMessage(null); downloadBtn.hidden = true; }
  });
  ['sourceLangId', 'target1LangId', 'target2LangId'].forEach(key => subscribe(key, () => check()));

  /* Restored from a previous session: pairs already downloaded warm up with no
     gesture; anything missing is offered, as on a pick. */
  if (settings.translationMode === 'translator') check();
}

/* Chrome Prompt API engine: usable only when the model reports 'available'.
   We never download it — that is the browser's job — so any other state is
   surfaced as "unavailable": the option is disabled, and if it was the selected
   engine we fall back to gtx.

   Selecting this engine warms the model up, because the first inference costs
   ~17s on a cold model and would otherwise swallow the user's first sentence.
   That warm-up holds the model in memory, so it must not start on a stray
   click: the countdown below gives the user a few seconds to pick something
   else, and switching away at any later point aborts or releases whatever the
   warm-up has reached. */
function setupPromptEngine(container) {
  const option = container.querySelector('#engine-prompt-option');
  const status = container.querySelector('#engine-prompt-status');
  if (!option || !status) return;

  /* Availability changes asynchronously, while the UI language can change at
     any time. Keep the message key so the current state can be translated
     again without repeating the availability check. */
  let currentMessageKey = null;
  let value = '';

  /* A language the engine cannot handle (promptName: null, e.g. Cantonese)
     takes over the status line while this engine is picked; the warm-up state
     underneath is kept and shows again once the selection is supported. */
  const langUnsupported = () =>
    settings.translationMode === 'prompt' &&
    ![settings.sourceLangId, settings.target1LangId, settings.target2LangId].every(isPromptLangSupported);

  const shownKey = () => (langUnsupported() ? 'lang.engine.prompt.langUnsupported' : currentMessageKey);

  const show = engineStatusLine(container, 'prompt');

  const renderMessage = () => {
    const key = shownKey();
    /* Only while this engine is the one picked: the line sits in the engine
       row, beside whichever engine is in use, and the availability check runs
       whether or not anyone picked this one — its "unavailable" used to stand
       beside another engine's status. A hidden engine shows nothing either. */
    if (!key || option.hidden || settings.translationMode !== 'prompt') { show(''); return; }
    /* The countdown belongs inside the sentence, not tacked onto its end:
       Japanese wants "あと 5 秒" mid-string, English "Preparing in 5s". So the
       message owns a {s} placeholder and we substitute; on every other message
       (which carries no value) the replace is a no-op. */
    show(t(key).replace('{s}', value), key);
  };

  const setMessage = (key, slot = '') => {
    currentMessageKey = key;
    value = slot;
    renderMessage();
  };

  subscribe('uiLang', renderMessage);
  ['sourceLangId', 'target1LangId', 'target2LangId', 'translationMode'].forEach(key => subscribe(key, renderMessage));

  /* An engine that cannot run says so on its option, as the Translator and
     PLaMo ones do: the menu is where the engine is looked for, and a disabled
     option can never be picked to bring its status line up. The sentence
     saying why rides along as the option's tooltip. */
  const OPTION_KEYS = {
    'lang.engine.prompt.unavailable': 'lang.engine.prompt.unavailableOption',
    'lang.engine.prompt.unsupported': 'lang.engine.prompt.unsupportedOption',
  };
  const labelOption = (msgKey) => {
    option.dataset.i18n = OPTION_KEYS[msgKey] ?? 'lang.engine.prompt';
    option.textContent = t(option.dataset.i18n);
    if (OPTION_KEYS[msgKey]) {
      option.dataset.i18nTitle = msgKey;
      option.title = t(msgKey);
    } else {
      delete option.dataset.i18nTitle;
      option.removeAttribute('title');
    }
  };

  /* `fallback` is only set once we KNOW the engine is unusable; during the
     async "checking" phase we just disable the option without stranding a
     valid prompt selection. */
  const disable = (msgKey, fallback) => {
    option.disabled = true;
    labelOption(msgKey);
    setMessage(msgKey);
    if (fallback && settings.translationMode === 'prompt') settings.translationMode = 'gtx';
  };

  const enable = () => {
    option.disabled = false;
    labelOption(null);
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
     browser or device can't run this", so a permanently greyed-out option
     would be indistinguishable from a real failure. */
  const syncVisibility = (on) => {
    option.hidden = !on;
    if (on) { setMessage(currentMessageKey, value); return; }
    cancelWarmUp();
    if (settings.translationMode === 'prompt') settings.translationMode = 'gtx';
    setMessage(null);
  };

  subscribe('enableBrowserAI', syncVisibility);
  syncVisibility(settings.enableBrowserAI);

  subscribe('translationMode', (mode) => {
    if (option.disabled) return;
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

/* The PLaMo engine's options popover: for now only the glossary
   (settings.hymtGlossary). The button shows while the picked engine reports
   a loaded model: the engine calls the returned setter with its own name,
   and only the picked engine's report counts.

   Each term is for one target language — the same name is written one way
   in Chinese and another in English, and both in one prompt would leave
   the model to guess. The picker offers the target pickers' languages; a
   new row starts on the first line's target (or the second's). */
function setupAiOptions(container) {
  const btn     = container.querySelector('#engine-ai-options');
  const popover = container.querySelector('#popover-ai-options');
  if (!btn || !popover) return () => {};

  wirePairList(popover.querySelector('#ai-glossary-list'), popover.querySelector('#ai-glossary-add'), {
    key:      'hymtGlossary',
    empty:    'lang.engine.plamo.glossary.empty',
    sourcePh: 'lang.engine.plamo.glossary.source.ph',
    targetPh: 'lang.engine.plamo.glossary.target.ph',
    langOptions:
      `<option value="" data-i18n="lang.choose">言語を選択</option>` +
      getAllLanguages().map(l => `<option value="${l.id}" data-i18n="lang.name.${l.id}">${escapeAttr(l.label)}</option>`).join(''),
    defaultLang: () => [settings.target1LangId, settings.target2LangId].find(id => id && id !== 'none') ?? '',
  });

  const ready = { plamo: false };
  const sync = () => {
    btn.hidden = !ready[settings.translationMode];
    if (btn.hidden && popover.matches(':popover-open')) popover.hidePopover();
  };
  subscribe('translationMode', sync);
  return (engine, on) => { ready[engine] = on; sync(); };
}

/* In-browser PLaMo engine (js/translate-plamo.js, files in js/plamo-store.js).
   Needs WebGPU with shader-f16; without it the option stays disabled.
   Picking it loads the model when its files are already downloaded; the
   first download is over a gigabyte, so it waits for the button beside the
   status line instead of starting on the pick. Picking another engine
   releases the model and its GPU memory; the delete button beside a loaded
   model also removes its files. Beyond that:
   - The download is the store's own (OPFS, resumable), so its progress, a
     broken-off download ("continue") and a download running in another tab
     each have a message of their own. Switching away stops the download;
     the parts already written stay.
   - Two sizes, picked beside the status line. Changing it while the engine
     is picked starts over with that size: its own download state, its own
     load; the other size's files stay until deleted.
   - The first download waits for the PLaMo Community License dialog
     (index.html, #dialog-plamo-license), agreed to once per browser. */
function setupPlamoEngine(container, setOptionsReady) {
  const option      = container.querySelector('#engine-plamo-option');
  const status      = container.querySelector('#engine-plamo-status');
  const modelSelect = container.querySelector('#engine-plamo-model');
  const downloadBtn = container.querySelector('#engine-plamo-download');
  const deleteBtn   = container.querySelector('#engine-plamo-delete');
  const credit      = container.querySelector('#engine-plamo-credit');
  const dialog      = document.getElementById('dialog-plamo-license');
  if (!option || !status || !modelSelect || !downloadBtn || !deleteBtn || !credit) return;

  let messageKey = null;
  let slot = '';
  let downloadKey = 'lang.engine.plamo.download';
  const show = engineStatusLine(container, 'plamo');
  const render = () => {
    show(messageKey ? t(messageKey).replace('{s}', slot) : '', messageKey);
    downloadBtn.textContent = t(downloadKey);
  };
  const setMessage = (key, value = '') => { messageKey = key; slot = value; render(); };

  /* The license copy in the UI language where there is one (ja), English
     otherwise; the dialog's links follow the same rule. */
  const licenseLang = () => (getLanguage() === 'ja' ? 'ja' : 'en');
  const syncLicenseLinks = () => {
    const local = `docs/plamo/LICENSE.${licenseLang()}.txt`;
    credit.href = local;
    dialog?.querySelectorAll('[data-plamo-license-local]').forEach(a => { a.href = local; });
    dialog?.querySelectorAll('[data-plamo-license-official]').forEach(a => {
      a.href = `https://plamo.preferredai.jp/info/plamo-community-license-${licenseLang()}`;
    });
  };
  subscribe('uiLang', () => { render(); syncLicenseLinks(); });
  syncLicenseLinks();
  render();

  /* 'download' | 'delete' | null — the button beside the status line. */
  const showButton = (which) => {
    downloadBtn.hidden = which !== 'download';
    deleteBtn.hidden   = which !== 'delete';
    setOptionsReady('plamo', which === 'delete' && messageKey === 'lang.engine.plamo.ready');
  };
  const showPicked = (on) => { modelSelect.hidden = !on; credit.hidden = !on; };

  const model  = () => getPlamoModel(settings.plamoModel);
  const sizeOf = () => formatBytes(plamoModelBytes(model()));

  /* Bumped on every pick, switch away, size change and delete, so whatever
     finishes after the user has moved on stays out of the row. */
  let generation = 0;
  let downloadAbort = null;

  const stopDownload = () => { downloadAbort?.abort(); downloadAbort = null; };

  const offerDownload = (downloaded) => {
    if (downloaded > 0) {
      downloadKey = 'lang.engine.plamo.resume';
      setMessage('lang.engine.plamo.partial', `${formatBytes(downloaded)} / ${sizeOf()}`);
    } else {
      downloadKey = 'lang.engine.plamo.download';
      setMessage('lang.engine.plamo.needDownload', sizeOf());
    }
    showButton('download');
  };

  const load = async (mine) => {
    showButton(null);
    setMessage('lang.engine.plamo.preparing');
    const result = await loadPlamo(model().value);
    if (mine !== generation) return;
    if (result.ok) { setMessage('lang.engine.plamo.ready'); showButton('delete'); return; }
    if (result.reason === 'cancelled') return;
    if (result.reason === 'notDownloaded') { activate(); return; }
    /* Delete is the way out of a model that will not load: the next
       download fetches every part afresh. */
    setMessage('lang.engine.plamo.failed');
    showButton('delete');
  };

  const download = async (mine) => {
    stopDownload();
    const ctrl = new AbortController();
    downloadAbort = ctrl;
    showButton(null);
    setMessage('lang.engine.plamo.downloading', '');
    try {
      await downloadPlamo(model().value, {
        signal: ctrl.signal,
        onProgress: (done, total) => {
          if (mine !== generation) return;
          setMessage('lang.engine.plamo.downloading',
            `${formatBytes(done)} / ${formatBytes(total)} (${Math.floor(done / total * 100)}%)`);
        },
      });
    } catch (err) {
      if (mine !== generation || err?.name === 'AbortError') return;
      if (err?.code === 'busy') { setMessage('lang.engine.plamo.busy'); showButton('download'); return; }
      console.warn('[plamo] download failed:', err);
      downloadKey = 'lang.engine.plamo.resume';
      setMessage('lang.engine.plamo.downloadFailed');
      showButton('download');
      return;
    } finally {
      if (downloadAbort === ctrl) downloadAbort = null;
    }
    if (mine === generation) load(mine);
  };

  const activate = async () => {
    const mine = ++generation;
    stopDownload();
    showPicked(true);
    showButton(null);
    setMessage(null);
    const st = await getPlamoStatus(model().value).catch(() => ({ downloaded: 0, complete: false }));
    if (mine !== generation) return;
    if (st.complete) load(mine);
    else offerDownload(st.downloaded);
  };

  const deactivate = () => {
    generation++;
    stopDownload();
    showPicked(false);
    showButton(null);
    setMessage(null);
    unloadPlamo();
  };

  /* Resolves true once the license has been agreed to, now or before. */
  const askLicense = () => new Promise((resolve) => {
    if (settings.plamoLicenseAccepted || !dialog) { resolve(!!settings.plamoLicenseAccepted); return; }
    dialog.returnValue = '';
    dialog.addEventListener('close', () => {
      const ok = dialog.returnValue === 'agree';
      if (ok) settings.plamoLicenseAccepted = true;
      resolve(ok);
    }, { once: true });
    dialog.showModal();
  });
  dialog?.querySelector('#plamo-license-agree')?.addEventListener('click', () => dialog.close('agree'));

  /* The click is the consent to download — and the first time, the dialog's
     agree button is the consent to the license. */
  downloadBtn.addEventListener('click', async () => {
    const mine = generation;
    if (!(await askLicense()) || mine !== generation) return;
    download(mine);
  });

  deleteBtn.addEventListener('click', async () => {
    const m = model();
    if (!confirm(t('lang.engine.plamo.deleteConfirm').replace('{s}', `${m.label}, ${sizeOf()}`))) return;
    const mine = ++generation;
    showButton(null);
    setMessage('lang.engine.plamo.deleting');
    await unloadPlamo();
    try { await deletePlamo(m.value); }
    catch (err) {
      if (mine !== generation) return;
      setMessage(err?.code === 'busy' ? 'lang.engine.plamo.busy' : 'lang.engine.plamo.failed');
      showButton('delete');
      return;
    }
    if (mine !== generation) return;
    if (settings.translationMode === 'plamo') activate();
    else setMessage(null);
  });

  /* Disabled until the WebGPU check resolves, without stranding a restored
     selection: it only falls back once the engine is known to be unusable. */
  option.disabled = true;

  getPlamoSupport().then((support) => {
    if (!support.ok) {
      option.dataset.i18n = 'lang.engine.plamo.unsupported';
      option.textContent = t(option.dataset.i18n);
      if (settings.translationMode === 'plamo') settings.translationMode = 'gtx';
      return;
    }
    option.disabled = false;
    subscribe('translationMode', (mode) => (mode === 'plamo' ? activate() : deactivate()));
    subscribe('plamoModel', () => { if (settings.translationMode === 'plamo') activate(); });
    if (settings.translationMode === 'plamo') activate();
  });
}

/* Off by default, behind the experimental switch in the settings dialog
   (settings.showOfflinePack). First hidden 2026-09-26, when Chrome 156's packs
   stopped being predictable: the same build offered 'dictation' packs in one
   profile and reported them 'unavailable' in a freshly created one, and
   available() kept answering stale results within a page until it was
   reloaded (suspected per-profile field trials; unconfirmed).
   Briefly re-enabled for testing on 2026-10-03, then hidden again: the
   install() pack had split from the accessibility (Live Caption) model, with
   visibly different output, and the new model was too heavy for the dev PC.
   An installed model still wins over processLocally=false, as before —
   which is why the switch only hides the button, and removal stays in
   Chrome's accessibility settings. Make it default-on once the models
   settle; the layout handles the hidden row (it is the Edge state). */
function setupOfflinePack(container) {
  /* On-device packs are Chrome-only — leave the row hidden elsewhere. */
  if (!isChrome) return;
  const row    = container.querySelector('#offline-pack-row');
  const button = container.querySelector('#btn-offline-pack');
  const status = container.querySelector('#offline-pack-status');
  const info   = container.querySelector('#offline-pack-info');
  const help   = container.querySelector('#btn-offline-help');
  if (!row || !button || !status || !info) return;

  /* Wired on first show rather than at mount, so nobody who leaves the switch
     off pays for the available() probes. setupLanguagePackButton() attaches
     listeners and subscriptions, so it must run once only. */
  let wired = false;
  const sync = (on) => {
    row.hidden = !on;
    if (!on) {
      /* A hidden trigger leaves its popovers orphaned on screen. */
      for (const p of row.querySelectorAll('[popover]')) {
        if (p.matches(':popover-open')) p.hidePopover();
      }
      return;
    }
    if (!wired) { wired = true; setupLanguagePackButton({ button, status, info, help }); }
  };
  subscribe('showOfflinePack', sync);
  sync(settings.showOfflinePack);
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
  /* The browser's "access other apps on this device" prompt (see
     primeLocalAccess) comes out of nowhere unless it is announced here. A page
     served from this machine is never asked, so it is not mentioned there. */
  const servedLocally = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const permissionStep = servedLocally
    ? ''
    : `<li>${t('lang.engine.link.steps.permission')}</li>`;

  el.innerHTML = `
    <p class="example-steps-title">${t('lang.engine.link.steps.title')}</p>
    <ol>
      <li>${t('lang.engine.link.steps.install')}<code>${deps}</code></li>
      ${keyStep}
      <li>${t('lang.engine.link.steps.run')}<code>python server.py</code></li>
      <li>${t('lang.engine.link.steps.url')}<code>http://localhost:5000</code></li>
      ${permissionStep}
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
    serverDeadline: t('lang.engine.link.example.cmt.serverDeadline'),
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

/* The same prompt with the envelope taken off. Measured on gpt-5.6-luna (the
   example has since moved to gpt-6-luna without re-measuring), the
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
MODEL = 'gpt-6-luna'

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

/* This example keeps the JSON envelope that the OpenAI one drops, and that
   difference is deliberate — measured, not overlooked.

   On gemini-3.1-flash-lite the envelope costs 29-67ms (median of 5, twice),
   against a 153-262ms spread between the fastest and slowest call of the same
   variant: the saving is smaller than the noise it hides in. On gpt-5.6-luna
   the same change was worth 380-455ms, which is why only that one made it.
   Plain text buys speed with a worse failure: a malformed envelope drops the
   line, a stray preamble goes on screen. That trade pays at 400ms, not at 50.

   Thinking is left alone for the same reason. Gemini 3.x uses thinking_level
   (minimal/low/medium/high, NOT the older thinking_budget — mixing the two is
   a 400), and flash-lite already defaults to minimal: stating it explicitly
   measured -45ms then +17ms, a sign flip, i.e. nothing. thinking_level 'high'
   costs ~1780ms and ~550 thought tokens, so the setting is real — it is simply
   already where it should be.

   What this example does share with the OpenAI one is everything that is not
   provider-specific: the parallel fan-out, the short timeout, and per-language
   failure isolation. */
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
# ${c.serverDeadline}
client = genai.Client(api_key=API_KEY, http_options={
    'timeout': 5000,
    'headers': {'X-Server-Timeout': '10'},
})

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

/* HY-MT (Tencent HY-MT1.5 through Transformers.js) was removed in v1.40.0:
   its license excludes the EU, the UK and South Korea outright, output
   included, which a stream with viewers there cannot keep to. A browser that
   had downloaded it still holds 1.2-1.4 GB in the Cache API; this gives the
   space back. Only its files are touched, and a cache left empty by that is
   dropped. Once nothing is left it costs one cache listing per load. */
function dropRetiredHymtCache() {
  if (!('caches' in self)) return;
  (async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const keys  = await cache.keys();
      const hymt  = keys.filter(req => req.url.includes('HY-MT1.5'));
      if (!hymt.length) continue;
      await Promise.all(hymt.map(req => cache.delete(req)));
      if (hymt.length === keys.length) await caches.delete(name);
    }
  })().catch(() => { /* storage blocked: nothing to give back */ });
}
