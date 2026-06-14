/**
 * @file ui-filter.js
 * @description Filter tab UI, split into two columns: word-replacement rules
 * on the left and the blacklist on the right, each with its own enable toggle.
 *
 * Each rule row is rendered as (source input, →, target input, delete).
 * On every keystroke we write a fresh array back to settings.filterRules so
 * filter.js sees the change and recompiles. The DOM is the source of truth
 * while the user is typing — we never re-render mid-edit (which would steal
 * focus). Re-renders only happen on add / delete.
 */

import { settings } from './store.js';
import { applyTo } from './i18n.js';
import { DEFAULT_BLACKLIST } from './filter.js';

const TRASH_SVG = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 6h18"/>
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
    <line x1="10" y1="11" x2="10" y2="17"/>
    <line x1="14" y1="11" x2="14" y2="17"/>
  </svg>
`;

export function mountFilterTab(container) {
  if (!container) return;

  container.innerHTML = `
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
        <div class="filter-list" id="filter-rules-list"></div>
        <button type="button" class="btn filter-add" id="filter-add-rule" data-i18n="filter.add">+ 追加</button>
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
        <div class="filter-list" id="blacklist-list"></div>
        <div class="blacklist-actions">
          <button type="button" class="btn filter-add" id="blacklist-add" data-i18n="blacklist.add">+ 追加</button>
          <button type="button" class="btn blacklist-defaults" id="blacklist-load-defaults" data-i18n="blacklist.loadDefaults">既定語を読み込む</button>
        </div>
      </section>
    </div>
  `;

  const listEl = container.querySelector('#filter-rules-list');
  const addBtn = container.querySelector('#filter-add-rule');

  renderRules(listEl);

  addBtn.addEventListener('click', () => {
    const rules = [...(settings.filterRules || []), { source: '', target: '' }];
    settings.filterRules = rules;
    renderRules(listEl);
    /* Move focus to the new row's source input for fast entry. */
    listEl.lastElementChild?.querySelector('.filter-source')?.focus();
  });

  /* --- blacklist --- */
  const blEl       = container.querySelector('#blacklist-list');
  const blAddBtn   = container.querySelector('#blacklist-add');
  const blLoadBtn  = container.querySelector('#blacklist-load-defaults');

  renderBlacklist(blEl);

  blAddBtn.addEventListener('click', () => {
    settings.blacklistRules = [...(settings.blacklistRules || []), ''];
    renderBlacklist(blEl);
    blEl.lastElementChild?.querySelector('.filter-source')?.focus();
  });

  blLoadBtn.addEventListener('click', () => {
    /* Append defaults that aren't already present (case-insensitive). */
    const current = (settings.blacklistRules || []).filter(w => typeof w === 'string');
    const seen = new Set(current.map(w => w.trim().toLowerCase()).filter(Boolean));
    const added = DEFAULT_BLACKLIST.filter(w => !seen.has(w.toLowerCase()));
    if (added.length === 0) return;
    settings.blacklistRules = [...current, ...added];
    renderBlacklist(blEl);
  });
}

function renderBlacklist(listEl) {
  const words = settings.blacklistRules || [];

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
