/**
 * @file ui-deco.js
 * @description The Languages tab's controls for the corner pictures
 * (js/subtitle-deco.js): a row in the source-line group with one button per
 * corner, each opening a menu with that corner's switch, picture, angle,
 * size and X / Y offset.
 *
 * The switch and sliders are plain data-bind controls (js/ui-bind.js); this
 * module adds what binding cannot do — reading a picture file into a setting,
 * and showing the picture back. The markup goes into the tab's template
 * (decoControlsHtml), so it is in the DOM before bindInputs() runs.
 *
 * A chosen picture is scaled down to MAX_SIDE on its longer side and stored as
 * a data URL: it lives in the settings (localStorage) and goes to the OBS
 * overlay through OBS (see DECO_DATA_REALM), so it is kept to tens of KB. A
 * picture is never drawn larger than the source font size times
 * DECO_SIZE_MAX / 100 — under 200px at the largest font — so MAX_SIDE still
 * leaves room for a high-density screen. WebP keeps transparency at a fraction
 * of PNG's size; PNG is the fallback where WebP cannot be encoded.
 */

import { settings, subscribe, getDefault } from './store.js';
import { t } from './i18n.js';
import {
  DECO_SIDES, decoKeys,
  DECO_SIZE_MIN, DECO_SIZE_MAX, DECO_SIZE_STEP, DECO_ANGLE_MIN, DECO_ANGLE_MAX,
  DECO_OFFSET_MIN, DECO_OFFSET_MAX, DECO_OFFSET_STEP,
} from './subtitle-deco.js';

const MAX_SIDE = 320;

function sideHtml(side) {
  const k = decoKeys(side);
  return `
    <button type="button" class="btn deco-btn" data-deco-side="${side}"
            popovertarget="deco-menu-${side}" style="anchor-name: --deco-${side}"
            data-i18n-title="style.deco.${side}.title">
      <span class="deco-btn-thumb" aria-hidden="true"><img alt="" hidden></span>
      <span data-i18n="style.deco.${side}"></span>
    </button>
    <div class="deco-menu" id="deco-menu-${side}" popover style="position-anchor: --deco-${side}"
         data-i18n-aria-label="style.deco.${side}.title">
      <div class="deco-menu-head">
        <span class="deco-menu-title" data-i18n="style.deco.${side}.title"></span>
        <label class="toggle toggle-compact" data-i18n-title="style.deco.show">
          <input type="checkbox" data-bind="${k.on}">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
      <div class="deco-menu-body">
        <!-- The picture at its angle; clicking it chooses another. -->
        <button type="button" class="deco-preview" data-deco-pick data-i18n-title="style.deco.pick">
          <img alt="" hidden>
          <span class="deco-preview-empty" data-i18n="style.deco.empty"></span>
        </button>
        <div class="deco-menu-controls">
          <span class="deco-label" data-i18n="style.deco.angle"></span>
          <span class="slider-group">
            <input type="range" min="${DECO_ANGLE_MIN}" max="${DECO_ANGLE_MAX}" step="1" data-bind="${k.angle}">
            <output class="slider-value"></output>
          </span>
          <span class="deco-label" data-i18n="style.deco.size"></span>
          <span class="slider-group">
            <input type="range" min="${DECO_SIZE_MIN}" max="${DECO_SIZE_MAX}" step="${DECO_SIZE_STEP}" data-bind="${k.size}">
            <output class="slider-value"></output>
          </span>
          <span class="deco-label" data-i18n="style.deco.x" data-i18n-title="style.deco.x.title"></span>
          <span class="slider-group">
            <input type="range" min="${DECO_OFFSET_MIN}" max="${DECO_OFFSET_MAX}" step="${DECO_OFFSET_STEP}" data-bind="${k.x}">
            <output class="slider-value"></output>
          </span>
          <span class="deco-label" data-i18n="style.deco.y" data-i18n-title="style.deco.y.title"></span>
          <span class="slider-group">
            <input type="range" min="${DECO_OFFSET_MIN}" max="${DECO_OFFSET_MAX}" step="${DECO_OFFSET_STEP}" data-bind="${k.y}">
            <output class="slider-value"></output>
          </span>
          <div class="deco-actions">
            <button type="button" class="btn" data-deco-pick data-i18n="style.deco.pick"></button>
            <button type="button" class="btn" data-deco-remove data-i18n="style.deco.remove"></button>
            <button type="button" class="btn" data-deco-reset data-i18n="style.deco.reset"
                    data-i18n-title="style.deco.reset.title"></button>
          </div>
        </div>
      </div>
      <p class="deco-note" data-i18n="style.deco.note"></p>
      <input type="file" accept="image/*" hidden data-deco-file>
    </div>`;
}

/** The row for the source-line group's grid: a label cell and a control cell. */
export function decoControlsHtml() {
  return `
    <span class="lang-extras-label" data-i18n="style.deco"></span>
    <div class="deco-buttons">${DECO_SIDES.map(sideHtml).join('')}</div>`;
}

/**
 * Read an image file, scale it to fit MAX_SIDE, and return it as a data URL.
 * Through an <img> rather than createImageBitmap, so SVG files load as well.
 * @param {File} file
 * @returns {Promise<string>}
 */
async function readPicture(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('image has no size');
    const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL('image/webp', 0.9);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function showImg(img, src) {
  img.hidden = !src;
  if (src && img.getAttribute('src') !== src) img.src = src;
  if (!src) img.removeAttribute('src');
}

/** Wire the controls decoControlsHtml() put inside `container`. */
export function wireDeco(container) {
  for (const side of DECO_SIDES) {
    const k = decoKeys(side);
    const btn  = container.querySelector(`.deco-btn[data-deco-side="${side}"]`);
    const menu = container.querySelector(`#deco-menu-${side}`);
    if (!btn || !menu) continue;

    const file      = menu.querySelector('[data-deco-file]');
    const toggle    = menu.querySelector(`input[data-bind="${k.on}"]`);
    const preview   = menu.querySelector('.deco-preview img');
    const empty     = menu.querySelector('.deco-preview-empty');
    const thumb     = btn.querySelector('.deco-btn-thumb img');
    const removeBtn = menu.querySelector('[data-deco-remove]');
    const resetBtn  = menu.querySelector('[data-deco-reset]');
    /* What "reset" puts back: how the picture sits, not which picture or
       whether it shows. */
    const placeKeys = [k.angle, k.size, k.x, k.y];
    const note      = menu.querySelector('.deco-note');

    const setNote = (key) => {
      note.dataset.i18n = key;
      note.textContent = t(key);
      note.classList.toggle('is-error', key === 'style.deco.error');
    };

    const render = () => {
      const src = settings[k.img] || '';
      showImg(preview, src);
      showImg(thumb, src);
      empty.hidden = !!src;
      /* No picture, nothing to switch on or remove. */
      toggle.disabled = !src;
      removeBtn.disabled = !src;
      resetBtn.disabled = placeKeys.every(key => settings[key] === getDefault(key));
      btn.classList.toggle('is-on', !!src && !!settings[k.on]);
      const angle = `${Number(settings[k.angle]) || 0}deg`;
      menu.style.setProperty('--deco-angle', angle);
      btn.style.setProperty('--deco-angle', angle);
    };
    for (const key of [k.img, k.on, ...placeKeys]) subscribe(key, render);
    render();

    menu.querySelectorAll('[data-deco-pick]').forEach(b => b.addEventListener('click', () => file.click()));

    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      /* Cleared, so choosing the same file again still fires change. */
      file.value = '';
      if (!chosen) return;
      try {
        settings[k.img] = await readPicture(chosen);
        /* Choosing a picture is asking to see it. */
        settings[k.on] = true;
        setNote('style.deco.note');
      } catch {
        setNote('style.deco.error');
      }
    });

    resetBtn.addEventListener('click', () => {
      for (const key of placeKeys) settings[key] = getDefault(key);
    });

    removeBtn.addEventListener('click', () => {
      settings[k.on] = false;
      settings[k.img] = '';
      setNote('style.deco.note');
    });
  }
}
