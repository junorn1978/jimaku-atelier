/**
 * @file ui-style.js
 * @description Subtitle settings that apply to the whole display rather than to
 * one line: a three-column row grouping the source controls (wrap symbols
 * inline with the heading, single-line limit below), the display settings
 * (align / bg), and the overflow mode. Form controls bind via [data-bind] in
 * the shared ui-bind helper.
 *
 * Per-line appearance (text colour, stroke colour, size, stroke width) is NOT
 * here — it moved into ui-languages.js, next to each line's language select,
 * because setting up one subtitle line otherwise meant switching tabs back and
 * forth.
 *
 * The block is appended into its own tab panel (#tab-style) as a
 * `.style-section`; its compact CSS is scoped to `.style-section`.
 */

export function mountStyleTab(container) {
  if (!container) return;

  const section = document.createElement('div');
  section.className = 'style-section';
  section.innerHTML = `
    <div class="panel-cols">
    <section class="panel-col">
      <div class="style-wrap-head">
        <h3 class="section-title" data-i18n="style.sourceWrap">原文符號</h3>
        <div class="symbol-inputs">
          <input type="text" class="text-input" data-bind="subSourcePrefix"
                 data-i18n-placeholder="style.sourcePrefix.ph" data-i18n-title="style.sourcePrefix" title="左記号"
                 autocomplete="off" spellcheck="false" autocorrect="off" maxlength="8">
          <input type="text" class="text-input" data-bind="subSourceSuffix"
                 data-i18n-placeholder="style.sourceSuffix.ph" data-i18n-title="style.sourceSuffix" title="右記号"
                 autocomplete="off" spellcheck="false" autocorrect="off" maxlength="8">
        </div>
      </div>

      <div class="form-row">
        <span class="form-row-label" data-i18n="style.sourceSingleLine">原文を1行に制限</span>
        <label class="toggle">
          <input type="checkbox" data-bind="subSourceSingleLine">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    </section>

    <section class="panel-col">
      <h3 class="section-title" data-i18n="style.display">字幕表示</h3>

      <div class="form-row">
        <span class="form-row-label" data-i18n="style.align">横位置</span>
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

      <div class="form-row">
        <span class="form-row-label" data-i18n="style.bg">背景色</span>
        <span class="color-cell">
          <input type="color" class="color-input" data-bind="subBg">
          <output class="color-value"></output>
        </span>
      </div>
    </section>

    <section class="panel-col">
      <h3 class="section-title" data-i18n="style.behavior">字幕動作</h3>

      <div class="form-row form-row-stack">
        <span class="form-row-label" data-i18n="style.overflow">翻訳字幕の行数</span>
        <div class="seg-switch" role="group">
          <label><input type="radio" name="subOverflow" value="normal" data-bind="subOverflow"><span data-i18n="style.overflow.normal">制限なし</span></label>
          <label><input type="radio" name="subOverflow" value="shrink" data-bind="subOverflow"><span data-i18n="style.overflow.shrink">2行 流動</span></label>
        </div>
      </div>
    </section>
    </div>
  `;

  container.appendChild(section);
}

