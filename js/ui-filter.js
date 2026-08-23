/**
 * @file ui-filter.js
 * @description Word-replacement UI, split into two columns: replacement rules
 * on the left and the blacklist on the right, each with its own enable toggle.
 * Appended into its own tab panel (#tab-filter) as a `.filter-section`; the
 * section fills the panel and only the rule lists scroll (see styles.css).
 *
 * The blacklist column is masked (-webkit-text-security) behind one switch for
 * the whole column, and re-masks itself when recording starts — this panel can
 * end up on camera, and a list of explicit words is the last thing that should
 * be legible there. The built-in words are never rendered at all; they are a
 * toggle (blacklistUseDefaults), not entries in the list.
 *
 * Each rule row is rendered as (source input, →, target input, delete).
 * On every keystroke we write a fresh array back to settings.filterRules so
 * filter.js sees the change and recompiles. The DOM is the source of truth
 * while the user is typing — we never re-render mid-edit (which would steal
 * focus). Re-renders only happen on add / delete.
 */

import { settings, subscribe } from './store.js';
import { applyTo, t } from './i18n.js';

const TRASH_SVG = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 6h18"/>
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
    <line x1="10" y1="11" x2="10" y2="17"/>
    <line x1="14" y1="11" x2="14" y2="17"/>
  </svg>
`;

/* Same pair of icons as the OBS password field, and the same two i18n keys —
   this is the identical "you are about to put something on screen" gesture. */
const EYE_SVG = `
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
`;

export function mountFilterTab(container) {
  if (!container) return;

  const section = document.createElement('div');
  section.className = 'filter-section';
  section.innerHTML = `
    <div class="panel-cols cols-2">
      <section class="panel-col">
        <div class="form-row">
          <span class="form-row-label" data-i18n="filter.enabled">有効化</span>
          <label class="toggle">
            <input type="checkbox" data-bind="filterEnabled">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <h3 class="section-title" data-i18n="filter.rules">ルール</h3>
        <div class="filter-list-wrap">
          <div class="filter-list" id="filter-rules-list"></div>
          <button type="button" class="btn filter-add" id="filter-add-rule" data-i18n="filter.add">+ 追加</button>
        </div>
      </section>

      <section class="panel-col">
        <div class="form-row">
          <span class="form-row-label" data-i18n="blacklist.enabled">ブラックリスト</span>
          <label class="toggle">
            <input type="checkbox" data-bind="blacklistEnabled">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <p class="form-hint" data-i18n="blacklist.hint">登録した語は文字数ぶんの * で伏せ字になります。</p>

        <div class="form-row">
          <span class="form-row-label" data-i18n="blacklist.useDefaults">内蔵のNGワード</span>
          <label class="toggle">
            <input type="checkbox" data-bind="blacklistUseDefaults">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <p class="form-hint" data-i18n="blacklist.useDefaults.desc">内蔵リストを使います。</p>

        <!-- data-secret-visible drives the mask in CSS, matching the attribute
             js/ui-secret-input.js uses on single fields. Not wired through that
             module: it positions one toggle inside one input, and this switch
             covers a whole column. -->
        <div class="filter-list-wrap blacklist-mask" data-secret-visible="false">
          <div class="filter-list" id="blacklist-list"></div>
          <div class="blacklist-actions">
            <button type="button" class="btn filter-add" id="blacklist-add" data-i18n="blacklist.add">+ 追加</button>
            <button type="button" class="icon-btn secret-toggle" id="blacklist-reveal" aria-pressed="false">
              ${EYE_SVG}
            </button>
          </div>
        </div>
      </section>
    </div>
  `;

  container.appendChild(section);

  const listEl = section.querySelector('#filter-rules-list');
  const addBtn = section.querySelector('#filter-add-rule');

  renderRules(listEl);

  addBtn.addEventListener('click', () => {
    const rules = [...(settings.filterRules || []), { source: '', target: '' }];
    settings.filterRules = rules;
    renderRules(listEl);
    /* Move focus to the new row's source input for fast entry. */
    listEl.lastElementChild?.querySelector('.filter-source')?.focus();
  });

  /* --- blacklist --- */
  const blEl     = section.querySelector('#blacklist-list');
  const blAddBtn = section.querySelector('#blacklist-add');

  renderBlacklist(blEl);

  /* --- column mask (declared first: the add button reveals through it) --- */
  const maskWrap  = section.querySelector('.blacklist-mask');
  const revealBtn = section.querySelector('#blacklist-reveal');

  const syncReveal = () => {
    const visible = maskWrap.dataset.secretVisible === 'true';
    const label = t(visible ? 'secret.hide' : 'secret.show');
    revealBtn.title = label;
    revealBtn.setAttribute('aria-label', label);
    revealBtn.setAttribute('aria-pressed', String(visible));
  };
  const setMasked = (masked) => {
    maskWrap.dataset.secretVisible = masked ? 'false' : 'true';
    syncReveal();
  };

  syncReveal();
  subscribe('uiLang', syncReveal);
  revealBtn.addEventListener('click', () => {
    setMasked(maskWrap.dataset.secretVisible === 'true');
  });

  /* Going live re-hides the column. The failure this mask exists for is the
     panel being on camera, and the likeliest way there is revealing the words
     to edit one and forgetting to hide them again before hitting start. */
  document.getElementById('btn-start')?.addEventListener('click', () => setMasked(true));

  blAddBtn.addEventListener('click', () => {
    settings.blacklistRules = [...(settings.blacklistRules || []), ''];
    renderBlacklist(blEl);
    /* Reveal on add — but never while recording. Off air, the row that was just
       created is empty and about to be typed into, and a field the user cannot
       read is worse than the word showing for the seconds it takes to enter it.
       On air, that same convenience would uncover the whole column at the exact
       moment the panel must not be readable, so there it stays masked and the
       user has to reveal it deliberately. */
    if (!isRecording()) setMasked(false);
    blEl.lastElementChild?.querySelector('.filter-source')?.focus();
  });
}

/* Same test controller.js uses: while speech.js is running it enables the stop
   button, and disables it again on stop. */
function isRecording() {
  return !document.getElementById('btn-stop')?.disabled;
}

function renderBlacklist(listEl) {
  const words = settings.blacklistRules || [];

  /* Empty state: tell the user what lives here instead of showing a void. */
  if (words.length === 0) {
    listEl.innerHTML = `<p class="filter-empty" data-i18n="blacklist.empty"></p>`;
    applyTo(listEl);
    return;
  }

  listEl.innerHTML = words.map((word, i) => `
    <div class="filter-row blacklist-row" data-index="${i}">
      <input class="text-input filter-source"
             type="text" value="${escapeAttr(word ?? '')}"
             data-i18n-placeholder="blacklist.word.ph"
             autocomplete="off" spellcheck="false" autocorrect="off">
      <button type="button" class="icon-btn filter-delete"
              data-i18n-title="filter.delete" title="削除" aria-label="Delete">
        ${TRASH_SVG}
      </button>
    </div>
  `).join('');

  listEl.querySelectorAll('.filter-row').forEach(row => {
    const idx = Number(row.dataset.index);
    const input = row.querySelector('.filter-source');
    const del   = row.querySelector('.filter-delete');

    input.addEventListener('input', () => {
      const next = [...(settings.blacklistRules || [])];
      next[idx] = input.value;
      settings.blacklistRules = next;
      /* No re-render — typing input already shows the value. */
    });
    del.addEventListener('click', () => {
      settings.blacklistRules = (settings.blacklistRules || []).filter((_, i) => i !== idx);
      renderBlacklist(listEl);
    });
  });

  applyTo(listEl);
}

function renderRules(listEl) {
  const rules = settings.filterRules || [];

  /* Empty state: tell the user what lives here instead of showing a void. */
  if (rules.length === 0) {
    listEl.innerHTML = `<p class="filter-empty" data-i18n="filter.empty"></p>`;
    applyTo(listEl);
    return;
  }

  listEl.innerHTML = rules.map((rule, i) => `
    <div class="filter-row" data-index="${i}">
      <input class="text-input filter-source"
             type="text" value="${escapeAttr(rule.source ?? '')}"
             data-i18n-placeholder="filter.source.ph"
             autocomplete="off" spellcheck="false" autocorrect="off">
      <span class="filter-arrow" aria-hidden="true">→</span>
      <input class="text-input filter-target"
             type="text" value="${escapeAttr(rule.target ?? '')}"
             data-i18n-placeholder="filter.target.ph"
             autocomplete="off" spellcheck="false" autocorrect="off">
      <button type="button" class="icon-btn filter-delete"
              data-i18n-title="filter.delete" title="削除" aria-label="Delete">
        ${TRASH_SVG}
      </button>
    </div>
  `).join('');

  /* Wire up each freshly-rendered row. */
  listEl.querySelectorAll('.filter-row').forEach(row => {
    const idx = Number(row.dataset.index);
    const src = row.querySelector('.filter-source');
    const tgt = row.querySelector('.filter-target');
    const del = row.querySelector('.filter-delete');

    src.addEventListener('input', () => commitRule(idx, 'source', src.value));
    tgt.addEventListener('input', () => commitRule(idx, 'target', tgt.value));
    del.addEventListener('click', () => {
      const next = (settings.filterRules || []).filter((_, i) => i !== idx);
      settings.filterRules = next;
      renderRules(listEl);
    });
  });

  /* Apply placeholders + tooltips through the standard i18n pipeline. */
  applyTo(listEl);
}

function commitRule(idx, field, value) {
  const rules = [...(settings.filterRules || [])];
  if (!rules[idx]) return;
  rules[idx] = { ...rules[idx], [field]: value };
  settings.filterRules = rules;
  /* No re-render — the user's typing input already shows the value. */
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}
