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
 * (one row: heading, picker, whatever the chosen engine needs, and the
 * signature at the far end). The columns are sized to their contents rather
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
import { settings, subscribe } from './store.js';
import { applyTo, t } from './i18n.js';
import { isChrome } from './env.js';
import { APP_VERSION } from './app-meta.js';
import { setupLanguagePackButton, isCloudOnly } from './language-pack.js';
import { wireSecretInputs } from './ui-secret-input.js';
import { onSttState } from './stt-custom.js';
import { isPromptSupported, getPromptAvailability,
         preparePromptSession, destroyPromptSession,
         isPromptLangSupported } from './translate-prompt.js';
import { isTranslatorSupported, prepareTranslators,
         pendingTranslatorDownloads, downloadTranslator } from './translate-translator.js';
import { getHymtSupport, isHymtDownloaded, loadHymt, unloadHymt, deleteHymt,
         HYMT_SIZE } from './translate-hymt.js';
import { wirePairList } from './ui-filter.js';

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
          <!-- The show-source toggle sits in the header's empty corner: its
               label above the recognition label, the switch above the
               recognition select. Beside the select it widened the whole
               language column by its own width on every row. The two halves
               are in different grid cells, so they are tied with for/id. -->
          <span><label for="lang-show-source" class="lang-show-source-label" data-i18n="style.showSource">原文を表示</label></span>
          <span>
            <label class="toggle toggle-compact">
              <input type="checkbox" id="lang-show-source" data-bind="subShowSource">
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
          </span>
          <span data-i18n="style.textColor">文字色</span>
          <span data-i18n="style.strokeColor">縁取り色</span>
          <span data-i18n="style.fontSize">サイズ</span>
          <span data-i18n="style.strokeWidth">縁取り幅</span>
        </div>

        <div class="lang-matrix-row">
          <span class="lang-field-label" data-i18n="lang.source">音声認識</span>
          <div class="lang-control">
            <select class="select select-compact" data-bind="sourceLangId">${sourceOptions}</select>
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

      <!-- The settings you judge against the output, filling the space the
           matrix leaves: the source line's symbols and one-line limit,
           alignment, background. They belong beside the colours rather than a
           tab away, because they are adjusted the same way — by looking. -->
      <section class="lang-extras">
        <!-- Two groups, because the four settings are two kinds of thing: the
             first pair only touches the source line, the second pair the whole
             display. Laid out as four identical rows they read as one list of
             unrelated odds and ends.
             The source group is headed once, so its row labels drop the
             repeated "source" word. It dims while the source line is hidden
             (CSS :has() on the matrix toggle) but stays editable, so it can be
             set up before the line is turned on.
             A two-state picker rather than a bare toggle: it names both states
             instead of leaving one implied. -->
        <div class="lang-extras-group lang-extras-source">
        <span class="lang-extras-heading" data-i18n="style.group.source">原文</span>
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
        </div>
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
             it sits on the recognition side. Chrome-only; hidden elsewhere.
             Heading inline with the button, like the engine beside it: stacked,
             the button fell below the panel's bottom edge. -->
        <section class="panel-col lang-sub" id="offline-pack-row" hidden>
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

        <!-- How to translate: the picker, then whatever the chosen engine needs
             (a status line, the custom URL row), then the signature — one row. -->
        <section class="panel-col lang-engine">
          <div class="col-head">
            <h3 class="section-title" data-i18n="lang.engine">翻訳エンジン</h3>
            <!-- A pop-up button rather than a segmented switch: with three
                 engines and a fourth behind a setting, of uneven name lengths,
                 picked once and then left, the switch only took the width the
                 status line and its buttons beside it need. An engine that
                 cannot run is a disabled option; the status line says why.
                 The last option is never offered: it only names the
                 translation server (lang.advanced) while that is on, so the
                 picker shows what is actually translating. Picking an engine
                 from here turns the server off, as before. -->
            <select class="select engine-select" id="engine-select" data-bind="translationMode"
                    data-i18n-aria-label="lang.engine" aria-label="翻訳エンジン">
              <option value="gtx" data-i18n="lang.engine.gtx">Google 翻訳</option>
              <option value="translator" id="engine-translator-option" data-i18n="lang.engine.translator">ブラウザ翻訳</option>
              <option value="prompt" id="engine-prompt-option" data-i18n="lang.engine.prompt">ブラウザ AI</option>
              <option value="hymt" id="engine-hymt-option" data-i18n="lang.engine.hymt">AI 翻訳（GPU）</option>
              <option value="link" hidden disabled data-i18n="lang.advanced.link">翻訳サーバー</option>
            </select>

            <!-- Whatever the selected engine needs — a status line, the custom
                 URL row, or nothing — beside the picker, in the space the row
                 leaves free. The heading row wraps, so a narrow window moves
                 it underneath instead of squeezing it. -->
            <div class="engine-inline">
              <p class="manual-status" id="engine-translator-status" role="status" aria-live="polite" hidden></p>
              <!-- Downloads are the user's to start, so a missing model is
                   offered here instead of fetched on the pick. -->
              <button type="button" class="btn" id="engine-translator-download" data-i18n="lang.engine.translator.download" hidden>ダウンロード</button>
              <p class="manual-status" id="engine-prompt-status" role="status" aria-live="polite" hidden></p>
              <!-- HY-MT asks before its first download (over a gigabyte), so
                   its row carries a button beside the status line. -->
              <p class="manual-status" id="engine-hymt-status" role="status" aria-live="polite" hidden></p>
              <button type="button" class="btn" id="engine-hymt-download" data-i18n="lang.engine.hymt.download" hidden>ダウンロード</button>
              <!-- The options only mean something to a loaded model, so they
                   show with the delete button rather than on the pick. -->
              <button type="button" class="btn hymt-options-btn" id="engine-hymt-options"
                      popovertarget="popover-hymt-options"
                      data-i18n="lang.engine.hymt.options" hidden>AI 翻訳オプション</button>
              <div class="help-popover hymt-options-popover" id="popover-hymt-options" popover>
                <section class="advanced-section hymt-glossary">
                  <h4 class="advanced-title" data-i18n="lang.engine.hymt.glossary.title">用語の訳し方</h4>
                  <p class="advanced-desc" data-i18n="lang.engine.hymt.glossary.desc"></p>
                  <div class="filter-list-wrap">
                    <div class="filter-list" id="hymt-glossary-list"></div>
                    <button type="button" class="btn filter-add" id="hymt-glossary-add" data-i18n="filter.add">+ 追加</button>
                  </div>
                </section>
              </div>
              <button type="button" class="btn" id="engine-hymt-delete" data-i18n="lang.engine.hymt.delete" hidden>モデルを削除</button>
              <!-- While the translation server is on, the picker beside has
                   nothing selected; this says where the lines go instead.
                   Picking an engine turns the server off. -->
              <p class="manual-status" id="engine-link-note" data-i18n="lang.engine.link.active" hidden>上級者向けの翻訳サーバーで翻訳しています</p>
            </div>

            <!-- Servers of the user's own, for recognition and translation.
                 Kept out of the row because only someone who runs a server can
                 use either, and their fields and notes crowded the tab for
                 everyone else. The button carries the state the popover hides:
                 lit while either is on, with the recognition server's
                 connection as a dot — a stream going silent because that
                 server is down has to be visible without opening anything. -->
            <button type="button" class="btn advanced-btn" id="btn-advanced"
                    popovertarget="popover-advanced" data-active="false">
              <span class="stt-status-dot" aria-hidden="true" hidden></span>
              <span data-i18n="lang.advanced">上級者向け</span>
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
                <div class="advanced-foot">
                  <p class="stt-status" id="stt-status" role="status" aria-live="polite" data-phase="idle">
                    <span class="stt-status-dot" aria-hidden="true"></span>
                    <span class="stt-status-text"></span>
                  </p>
                  <a class="advanced-link" href="docs/custom-stt.html"
                     target="_blank" rel="noopener" data-i18n="lang.advanced.stt.spec">接続仕様とサンプル</a>
                </div>
              </section>

              <section class="advanced-section">
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

            <!-- Signature, at the far end of the engine row. Which version is
                 running is a real question while two machines are being kept
                 in sync. It lives in the tab body rather than the toolbar so
                 that .panel-collapsed takes it away with everything else: on
                 screen while setting up, gone before the window is captured.
                 It used to sit on a footer row of its own, which cost the
                 panel a row of empty height in every engine mode. -->
            <p class="app-signature">
              <span data-i18n="app.title">字幕アトリエ</span>
              <span class="app-signature-version">${APP_VERSION}</span>
            </p>
          </div>
        </section>
      </div>
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
  setupAdvanced(container);
  setupOfflinePack(container);
  markCloudOnlySources(container);
  setupTranslatorEngine(container);
  setupPromptEngine(container);
  setupHymtEngine(container);
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
  const note       = container.querySelector('#engine-link-note');
  const picker     = container.querySelector('#engine-select');
  const status     = container.querySelector('#stt-status');
  const text       = status?.querySelector('.stt-status-text');
  if (!btn || !btnDot || !sttToggle || !linkToggle || !note || !picker || !status || !text) return;

  /* The engine to go back to when the translation server is switched off:
     whatever was picked before it was switched on, else Google. */
  let lastEngine = settings.translationMode !== 'link' ? settings.translationMode : 'gtx';
  let sttState = { phase: 'idle', detail: '' };

  const sync = () => {
    const stt  = settings.sttEngine === 'custom';
    const link = settings.translationMode === 'link';
    sttToggle.checked  = stt;
    linkToggle.checked = link;
    btn.dataset.active = String(stt || link);
    btnDot.hidden = !stt;
    btnDot.dataset.phase = sttState.phase;
    note.hidden = !link;
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

  const render = () => {
    if (!messageKey) { status.hidden = true; status.textContent = ''; return; }
    const suffix = percent == null ? '' : ` ${percent}%`;
    status.hidden = false;
    status.textContent = [].concat(messageKey).map(k => t(k)).join(' ')
      .replace('{lang}', vars.lang ? t(`lang.name.${vars.lang}`) : '')
      .replace('{n}', String(vars.n ?? '')) + suffix;
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
     names the next one and how many are left, as the HamHam extension's
     "次へ (N)" did. */
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

  const renderMessage = () => {
    const key = shownKey();
    /* A hidden engine must not leave its status line behind — the availability
       check runs regardless of visibility, so it can produce a message for an
       option nobody can see. */
    status.hidden = !key || option.hidden;
    if (!key) { status.textContent = ''; return; }
    /* The countdown belongs inside the sentence, not tacked onto its end:
       Japanese wants "あと 5 秒" mid-string, English "Preparing in 5s". So the
       message owns a {s} placeholder and we substitute; on every other message
       (which carries no value) the replace is a no-op. */
    status.textContent = t(key).replace('{s}', value);
  };

  const setMessage = (key, slot = '') => {
    currentMessageKey = key;
    value = slot;
    renderMessage();
  };

  subscribe('uiLang', renderMessage);
  ['sourceLangId', 'target1LangId', 'target2LangId'].forEach(key => subscribe(key, renderMessage));

  /* `fallback` is only set once we KNOW the engine is unusable; during the
     async "checking" phase we just disable the option without stranding a
     valid prompt selection. */
  const disable = (msgKey, fallback) => {
    option.disabled = true;
    setMessage(msgKey);
    if (fallback && settings.translationMode === 'prompt') settings.translationMode = 'gtx';
  };

  const enable = () => {
    option.disabled = false;
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

/* In-browser HY-MT engine (js/translate-hymt.js). WebGPU only: without it the
   option stays disabled. Picking it loads the model from the browser's cache
   when it is there (a few seconds); the first download is over a gigabyte, so
   that waits for the button beside the status line instead of starting on
   the pick. Picking another engine releases the model and its GPU memory;
   the delete button beside a loaded model also removes it from the cache. */
function setupHymtEngine(container) {
  const option = container.querySelector('#engine-hymt-option');
  const status = container.querySelector('#engine-hymt-status');
  const downloadBtn = container.querySelector('#engine-hymt-download');
  const deleteBtn   = container.querySelector('#engine-hymt-delete');
  const optionsBtn  = container.querySelector('#engine-hymt-options');
  const options     = container.querySelector('#popover-hymt-options');
  if (!option || !status || !downloadBtn || !deleteBtn || !optionsBtn || !options) return;

  /* Each term is for one target language — the same name is written one way
     in Chinese and another in English, and both in one prompt would leave
     the model to guess. The picker offers the target pickers' languages; a
     new row starts on the first line's target (or the second's). */
  wirePairList(options.querySelector('#hymt-glossary-list'), options.querySelector('#hymt-glossary-add'), {
    key:      'hymtGlossary',
    empty:    'lang.engine.hymt.glossary.empty',
    sourcePh: 'lang.engine.hymt.glossary.source.ph',
    targetPh: 'lang.engine.hymt.glossary.target.ph',
    langOptions:
      `<option value="" data-i18n="lang.choose">言語を選択</option>` +
      getAllLanguages().map(l => `<option value="${l.id}" data-i18n="lang.name.${l.id}">${escapeAttr(l.label)}</option>`).join(''),
    defaultLang: () => [settings.target1LangId, settings.target2LangId].find(id => id && id !== 'none') ?? '',
  });

  /* Kept as a key plus its {s} value so a UI language switch can re-render. */
  let messageKey = null;
  let slot = '';
  const render = () => {
    status.hidden = !messageKey;
    status.textContent = messageKey ? t(messageKey).replace('{s}', slot) : '';
  };
  const setMessage = (key, value = '') => { messageKey = key; slot = value; render(); };
  subscribe('uiLang', render);

  /* Download while the model is not in the cache; the options and delete
     once it is loaded from there. */
  const showButton = (which) => {
    downloadBtn.hidden = which !== 'download';
    deleteBtn.hidden   = which !== 'delete';
    optionsBtn.hidden  = which !== 'delete';
    if (optionsBtn.hidden && options.matches(':popover-open')) options.hidePopover();
  };

  let dtype = null;

  /* Bumped on every pick, every switch away and every delete, so a load or
     cache check that finishes after the user has moved on stays out of the
     row. */
  let generation = 0;

  const offerDownload = () => {
    setMessage('lang.engine.hymt.needDownload', HYMT_SIZE[dtype]);
    showButton('download');
  };

  const load = async (mine) => {
    showButton(null);
    setMessage('lang.engine.hymt.preparing');
    const result = await loadHymt(dtype, (loaded, total) => {
      if (mine === generation) setMessage('lang.engine.hymt.downloading', `${Math.floor(loaded / total * 100)}%`);
    });
    if (mine !== generation) return;
    if (result.ok) { setMessage('lang.engine.hymt.ready'); showButton('delete'); return; }
    if (result.reason === 'cancelled') return;
    setMessage('lang.engine.hymt.failed');
    showButton('download');
  };

  const activate = async () => {
    const mine = ++generation;
    const cached = await isHymtDownloaded(dtype);
    if (mine !== generation) return;
    if (cached) load(mine);
    else offerDownload();
  };

  const deactivate = () => {
    generation++;
    showButton(null);
    setMessage(null);
    unloadHymt();
  };

  /* The click is the consent to download: it is only offered once the cache
     has been checked and found empty, or after a failed attempt. */
  downloadBtn.addEventListener('click', () => load(generation));

  /* Deleting keeps the engine picked and goes back to offering the download,
     so getting the model again is the same one click as the first time. */
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(t('lang.engine.hymt.deleteConfirm').replace('{s}', HYMT_SIZE[dtype]))) return;
    generation++;
    showButton(null);
    setMessage('lang.engine.hymt.deleting');
    await deleteHymt();
    if (settings.translationMode === 'hymt') offerDownload();
    else setMessage(null);
  });

  /* Disabled until the WebGPU check resolves, without stranding a restored
     selection: it only falls back once the engine is known to be unusable. */
  option.disabled = true;

  getHymtSupport().then((support) => {
    if (!support.ok) {
      /* On the option itself, like the Translator engine's (see there). */
      option.dataset.i18n = 'lang.engine.hymt.unsupported';
      option.textContent = t(option.dataset.i18n);
      if (settings.translationMode === 'hymt') settings.translationMode = 'gtx';
      return;
    }
    dtype = support.dtype;
    option.disabled = false;
    subscribe('translationMode', (mode) => (mode === 'hymt' ? activate() : deactivate()));
    if (settings.translationMode === 'hymt') activate();
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
