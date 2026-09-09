/**
 * @file tour.js
 * @description The walkthrough behind the "?" in the toolbar, and the ring that
 * points at the "?" itself on the first few launches.
 *
 * Nothing here plays on its own. The app opens with no tour, no modal and no
 * banner — the only first-run behaviour is that one button glows. Someone who
 * already knows the app never has to dismiss anything, and someone who is lost
 * still has somewhere to go. The glow is the whole cost of that trade, so it is
 * paid off as soon as either half stops being true: the tour was opened, or
 * three launches went by without anyone reaching for it.
 *
 * The steps lean on the two things this app cannot show by being looked at:
 * that the panel is collapsed by clicking the background, and that the lock is
 * there to protect that gesture mid-stream. The rest is the order a first run
 * has to happen in anyway, because js/speech.js keeps Start disabled until a
 * recognition language is chosen. Everything a tab already explains for itself
 * is left to that tab — the OBS step points at the tab rather than restating
 * what is inside it.
 */

import { settings, subscribe } from './store.js';
import { t } from './i18n.js';

/** Launches the ring keeps appearing for, if the tour is never opened. */
const HINT_LAUNCHES = 3;

/** Spotlight padding, card-to-spotlight gap, viewport margin. All px. */
const PAD = 8;
const GAP = 14;
const MARGIN = 12;

const $ = (sel) => document.querySelector(sel);

/* Tabs are switched by clicking their button rather than by writing
   settings.activeTab: js/ui-tabs.js writes that key but does not subscribe to
   it, so the store is the record of which tab is open, not the control. */
const showTab = (name) => document.getElementById(`tab-btn-${name}`)?.click();

/* Steps living in the settings body need the panel open and the right tab
   showing. Cheap enough to re-assert on each of them rather than reason about
   which direction the user arrived from. */
const inLanguages = () => { settings.panelCollapsed = false; showTab('languages'); };

/**
 * @typedef {object} Step
 * @property {string} key  i18n prefix: tour.<key>.title / tour.<key>.body
 * @property {() => Element|Element[]|null|undefined} [target]
 *           What to cut out of the dim. An array is reduced to the one box that
 *           holds all of them, which is how adjacent rows get lit as a pair.
 * @property {'top'|'bottom'|'left'|'right'} [place]  Preferred card side.
 * @property {() => void} [before]  Put the UI where the step can be seen.
 * @property {boolean} [interactive]  Let clicks through to the app underneath.
 * @property {(advance: () => void) => (() => void)} [gate]
 *           Watch for the user doing the thing; returns its own disposer.
 */

/** @type {Step[]} */
const STEPS = [
  {
    key: 'source',
    target: () => $('[data-bind="sourceLangId"]')?.closest('.lang-matrix-row'),
    place: 'top',
    before: inLanguages,
  },
  {
    key: 'targets',
    /* Both rows at once: the point of the step is that the second one is
       optional, which only reads if the pair is lit together. */
    target: () => [
      $('[data-bind="target1LangId"]')?.closest('.lang-matrix-row'),
      $('[data-bind="target2LangId"]')?.closest('.lang-matrix-row'),
    ],
    place: 'top',
    before: inLanguages,
  },
  {
    key: 'engine',
    target: () => $('.lang-engine .seg-switch'),
    place: 'top',
    before: inLanguages,
  },
  {
    key: 'start',
    target: () => $('.speech-switch'),
    place: 'top',
    before: inLanguages,
  },
  {
    /* Points at the tab instead of opening it and paraphrasing what is inside.
       The OBS tab already carries the mode descriptions and a numbered
       procedure (obs.help.step1..4), so the useful thing to say here is where
       that lives — and being sent somewhere is easier to act on than being
       shown somewhere. inLanguages() also guarantees the tab is not already
       the open one, without which "click here" has nothing to ask for. */
    key: 'obs',
    target: () => document.getElementById('tab-btn-obs'),
    place: 'top',
    before: inLanguages,
  },
  {
    /* The one step worth performing rather than describing: the gesture has no
       visible trigger, so reading about it teaches much less than doing it
       once. The blocker steps aside here alone, and the real handler in
       js/ui-layout.js does the work — the tour only watches the store. */
    key: 'collapse',
    target: () => $('.output-pane'),
    place: 'bottom',
    interactive: true,
    before: () => { settings.panelCollapsed = false; },
    gate: (advance) => subscribe('panelCollapsed', (v) => { if (v === true) advance(); }),
  },
  {
    /* Reached with the panel collapsed, if the previous step was performed —
       which is the state the lock is for, so it explains itself. */
    key: 'lock',
    target: () => $('#toggle-lock'),
    place: 'top',
  },
];

let _root = null;
let _spot = null;
let _card = null;
let _els  = {};
let _i    = -1;
/** What the tour moved and has to put back: tab and collapse state. */
let _entry = null;
/** Disposer for the current step's gate, if it has one. */
let _gate = null;
let _ro   = null;

/* -------- open / close -------- */

function open() {
  if (_root) return;

  /* Asked for once is enough — the ring has done its job whether or not the
     tour is finished, so this is set on open rather than on completion. */
  settings.tourSeen = true;
  document.getElementById('open-tour')?.classList.remove('is-hinting');

  _entry = {
    activeTab: settings.activeTab,
    panelCollapsed: settings.panelCollapsed,
  };

  build();
  go(0);
}

function close() {
  if (!_root) return;

  _gate?.();
  _gate = null;
  _ro?.disconnect();
  _ro = null;
  window.removeEventListener('resize', layout);
  document.removeEventListener('keydown', onKey, true);

  _root.remove();
  _root = _spot = _card = null;
  _els = {};
  _i = -1;

  /* Put the app back where it was found. The tour opens the panel and switches
     tabs to reach its targets; leaving the user somewhere they never navigated
     to would be its own small confusion. */
  settings.panelCollapsed = _entry.panelCollapsed;
  showTab(_entry.activeTab);
  _entry = null;

  document.getElementById('open-tour')?.focus();
}

function build() {
  _root = document.createElement('div');
  _root.className = 'tour-root';
  _root.innerHTML = `
    <div class="tour-blocker"></div>
    <div class="tour-spot"></div>
    <div class="tour-card" role="dialog" aria-modal="true"
         aria-labelledby="tour-card-title" tabindex="-1">
      <p class="tour-progress"></p>
      <h2 class="tour-title" id="tour-card-title"></h2>
      <p class="tour-body"></p>
      <div class="tour-actions">
        <button type="button" class="btn tour-skip"></button>
        <button type="button" class="btn tour-back"></button>
        <button type="button" class="btn primary tour-next"></button>
      </div>
    </div>`;
  document.body.appendChild(_root);

  _spot = _root.querySelector('.tour-spot');
  _card = _root.querySelector('.tour-card');
  _els = {
    progress: _root.querySelector('.tour-progress'),
    title:    _root.querySelector('.tour-title'),
    body:     _root.querySelector('.tour-body'),
    skip:     _root.querySelector('.tour-skip'),
    back:     _root.querySelector('.tour-back'),
    next:     _root.querySelector('.tour-next'),
  };

  _els.skip.addEventListener('click', close);
  _els.back.addEventListener('click', () => go(_i - 1));
  _els.next.addEventListener('click', () => go(_i + 1));

  window.addEventListener('resize', layout);
  document.addEventListener('keydown', onKey, true);

  /* The collapse gesture resizes both of these, and the spotlight has to
     follow rather than stay where the element used to be. */
  _ro = new ResizeObserver(layout);
  ['.control-card', '.output-pane'].forEach(sel => {
    const el = $(sel);
    if (el) _ro.observe(el);
  });
}

/* -------- steps -------- */

function go(i) {
  if (i < 0) return;
  if (i >= STEPS.length) { close(); return; }

  _gate?.();
  _gate = null;

  _i = i;
  const step = STEPS[i];
  step.before?.();

  _root.classList.toggle('is-interactive', step.interactive === true);
  /* Guard on _i: a gate can fire long after its step was left behind, and
     advancing from a step nobody is on would jump the tour. */
  if (step.gate) _gate = step.gate(() => { if (_i === i) go(i + 1); });

  render();
  /* Two frames: before() may have swapped a tab or dropped the panel, and the
     target's new box does not exist until that has been laid out. */
  requestAnimationFrame(() => requestAnimationFrame(layout));
  _card.focus();
}

/** Text only — split from layout() so a mid-tour language switch can re-run it. */
function render() {
  if (!_root || _i < 0) return;
  const step = STEPS[_i];
  _els.progress.textContent = `${_i + 1} / ${STEPS.length}`;
  _els.title.textContent = t(`tour.${step.key}.title`);
  _els.body.textContent  = t(`tour.${step.key}.body`);
  _els.skip.textContent  = t('tour.skip');
  _els.back.textContent  = t('tour.back');
  _els.next.textContent  = _i === STEPS.length - 1 ? t('tour.done') : t('tour.next');
  _els.back.hidden = _i === 0;
}

/* -------- geometry -------- */

function layout() {
  if (!_root || _i < 0) return;
  const step = STEPS[_i];

  const rects = [].concat(step.target?.() || [])
    .filter(el => el instanceof Element)
    .map(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
    })
    .filter(r => r.right > r.left && r.bottom > r.top);

  if (!rects.length) {
    /* Target missing or not rendered: dim everything and centre the card
       rather than spotlight a stale box. */
    _spot.hidden = true;
    place(null);
    return;
  }

  const u = rects.reduce((a, b) => ({
    top:    Math.min(a.top, b.top),
    left:   Math.min(a.left, b.left),
    bottom: Math.max(a.bottom, b.bottom),
    right:  Math.max(a.right, b.right),
  }));

  const box = {
    top:    u.top - PAD,
    left:   u.left - PAD,
    bottom: u.bottom + PAD,
    right:  u.right + PAD,
  };
  box.width  = box.right - box.left;
  box.height = box.bottom - box.top;

  _spot.hidden = false;
  _spot.style.top    = `${box.top}px`;
  _spot.style.left   = `${box.left}px`;
  _spot.style.width  = `${box.width}px`;
  _spot.style.height = `${box.height}px`;

  place(box, step.place);
}

/** Park the card beside the spotlight, falling back around it and then to the
    centre of the window when the preferred side has no room. */
function place(box, prefer = 'bottom') {
  const c  = _card.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = null;
  let left = null;

  if (box) {
    const fits = {
      bottom: box.bottom + GAP + c.height <= vh - MARGIN,
      top:    box.top    - GAP - c.height >= MARGIN,
      right:  box.right  + GAP + c.width  <= vw - MARGIN,
      left:   box.left   - GAP - c.width  >= MARGIN,
    };
    const order = prefer === 'top'   ? ['top', 'bottom', 'right', 'left']
                : prefer === 'left'  ? ['left', 'right', 'top', 'bottom']
                : prefer === 'right' ? ['right', 'left', 'top', 'bottom']
                :                      ['bottom', 'top', 'right', 'left'];

    for (const side of order) {
      if (!fits[side]) continue;
      if (side === 'bottom' || side === 'top') {
        top  = side === 'bottom' ? box.bottom + GAP : box.top - GAP - c.height;
        left = box.left + (box.width - c.width) / 2;
      } else {
        left = side === 'right' ? box.right + GAP : box.left - GAP - c.width;
        top  = box.top + (box.height - c.height) / 2;
      }
      break;
    }
  }

  if (top === null) {
    top  = (vh - c.height) / 2;
    left = (vw - c.width) / 2;
  }

  _card.style.top  = `${clamp(top,  MARGIN, vh - c.height - MARGIN)}px`;
  _card.style.left = `${clamp(left, MARGIN, vw - c.width  - MARGIN)}px`;

  /* Sliding between steps is the point of the transition; sliding in from the
     corner on the very first one is just the un-positioned box animating to
     where it always belonged. Arm it a frame after the first placement lands,
     so step 1 appears where it is and every step after it travels. */
  if (!_root.classList.contains('is-placed')) {
    requestAnimationFrame(() => _root?.classList.add('is-placed'));
  }
}

/* hi < lo happens when the card is taller than the window; pinning to lo keeps
   its head on screen, which is the half with the text. */
const clamp = (v, lo, hi) => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));

/* -------- keyboard -------- */

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(_i + 1); return; }
  if (e.key === 'ArrowLeft' && _i > 0) { e.preventDefault(); go(_i - 1); }
}

/* -------- wiring -------- */

export function initTour() {
  const btn = document.getElementById('open-tour');
  if (!btn) return;

  btn.addEventListener('click', open);

  /* Counting stops once it is past the threshold, so this costs a handful of
     writes over the app's life rather than one on every launch forever. */
  if (settings.launchCount <= HINT_LAUNCHES) settings.launchCount += 1;
  if (!settings.tourSeen && settings.launchCount <= HINT_LAUNCHES) {
    btn.classList.add('is-hinting');
  }

  /* The card holds rendered strings rather than data-i18n attributes, so
     applyTo() cannot reach it — a language switch mid-tour has to redraw. And
     then re-place it: the new text is a different height, so the card it was
     positioned for no longer exists. */
  subscribe('uiLang', () => { render(); layout(); });
}
