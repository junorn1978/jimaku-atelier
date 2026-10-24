/**
 * @file subtitle-presets.js
 * @description Colour presets for the subtitle lines: one click writes a whole
 * set of text colours, outline colours and outline widths into the settings.
 *
 * A preset is data, not CSS. Applying one only writes the same settings keys
 * the Languages tab's matrix writes, so everything downstream — the output
 * pane, the subtitle window, the OBS overlay — follows without knowing
 * presets exist. That is also why there is no "current preset" setting: the
 * active one is whichever preset the current values happen to match, so a
 * colour changed by hand afterwards reads as "none of these" by itself.
 *
 * What a preset leaves alone, on purpose:
 *  - font sizes, which depend on the user's resolution and layout rather than
 *    on the look;
 *  - the background (subBg), which is the chroma-key colour in window-capture
 *    mode — a preset touching it would break the key.
 *
 * No preset uses green-leaning colours: the subtitle window is keyed on
 * #00FF00, and a mint or leaf green is eaten by the key as the similarity is
 * raised.
 *
 * Names are generic on purpose. Some presets are inspired by well-known
 * characters' colour schemes; their names and trademarks never appear here.
 */

import { settings, subscribe } from './store.js';

/* [settings-key middle part, preset slot] for each subtitle line. */
const LINES = [['Source', 'src'], ['Target1', 't1'], ['Target2', 't2']];

const line = (color, stroke, w) => ({ color, stroke, w });

/* `default` is the store's own defaults — "back to how it was". */
export const PRESETS = [
  { id: 'default',   src: line('#FFFFFF', '#000000', 4), t1: line('#FFFFFF', '#000000', 4), t2: line('#FFFFFF', '#000000', 4) },
  { id: 'standard',  src: line('#FFFFFF', '#000000', 4), t1: line('#FFE873', '#000000', 4), t2: line('#9FD4FF', '#000000', 4) },
  { id: 'game',      src: line('#FFFFFF', '#0A0F2C', 6), t1: line('#FFD400', '#0A0F2C', 6), t2: line('#4FE3FF', '#0A0F2C', 6) },
  { id: 'cute',      src: line('#FFFFFF', '#5A1E3C', 4), t1: line('#FF8FB1', '#5A1E3C', 4), t2: line('#B79CFF', '#5A1E3C', 4) },
  { id: 'pastel',    src: line('#7A2E55', '#FFFFFF', 5), t1: line('#9B3F8A', '#FFFFFF', 5), t2: line('#4B4BA8', '#FFFFFF', 5) },
  { id: 'imp',       src: line('#FFFFFF', '#241A2E', 5), t1: line('#CDA8FF', '#241A2E', 5), t2: line('#FF7EB9', '#241A2E', 5) },
  { id: 'berrymilk', src: line('#FFFFFF', '#C8336F', 5), t1: line('#FFC2DA', '#A82A5E', 5), t2: line('#FFF1A8', '#A82A5E', 5) },
  { id: 'contrast',  src: line('#FFFFFF', '#000000', 7), t1: line('#FFFF00', '#000000', 7), t2: line('#7FDBFF', '#000000', 7) },
  { id: 'retro',     src: line('#F3E6C8', '#3B2414', 5), t1: line('#F2B45A', '#3B2414', 5), t2: line('#E89A7C', '#3B2414', 5) },
];

const KEYS = LINES.flatMap(([name]) => [`sub${name}Color`, `sub${name}Stroke`, `sub${name}StrokeW`]);

/**
 * Apply a preset by id — for the OBS scene link (js/obs-scene-link.js).
 * @returns {boolean} false when no preset has that id (one removed since the
 *   rule was saved), in which case nothing changes.
 */
export function applyPreset(id) {
  const preset = PRESETS.find(p => p.id === id);
  if (preset) apply(preset);
  return !!preset;
}

function apply(preset) {
  for (const [name, slot] of LINES) {
    settings[`sub${name}Color`]   = preset[slot].color;
    settings[`sub${name}Stroke`]  = preset[slot].stroke;
    settings[`sub${name}StrokeW`] = preset[slot].w;
  }
}

function matches(preset) {
  return LINES.every(([name, slot]) =>
    String(settings[`sub${name}Color`]).toUpperCase()  === preset[slot].color &&
    String(settings[`sub${name}Stroke`]).toUpperCase() === preset[slot].stroke &&
    Number(settings[`sub${name}StrokeW`])              === preset[slot].w);
}

/**
 * The menu items, for the Languages tab's template. Each name is drawn in its
 * own preset's second line (the first is white in most of them), with three
 * dots for the three lines' text colours, so the menu previews itself.
 */
export function presetItemsHtml() {
  return PRESETS.map(p => `
              <button type="button" role="menuitemradio" aria-checked="false" data-preset="${p.id}"
                      style="--p-color:${p.t1.color};--p-stroke:${p.t1.stroke}">
                <span class="sub-preset-name" data-i18n="style.preset.${p.id}">${p.id}</span>
                <span class="sub-preset-dots" aria-hidden="true">${
                  LINES.map(([, slot]) => `<i style="background:${p[slot].color}"></i>`).join('')
                }</span>
              </button>`).join('');
}

/** Wire the menu built from presetItemsHtml(). */
export function wireSubtitlePresets(menu) {
  if (!menu) return;
  const items = [...menu.querySelectorAll('[data-preset]')];

  const sync = () => {
    for (const item of items) {
      const preset = PRESETS.find(p => p.id === item.dataset.preset);
      item.setAttribute('aria-checked', String(!!preset && matches(preset)));
    }
  };

  for (const item of items) {
    item.addEventListener('click', () => {
      const preset = PRESETS.find(p => p.id === item.dataset.preset);
      if (preset) apply(preset);
      menu.hidePopover();
    });
  }

  for (const key of KEYS) subscribe(key, sync);
  sync();
}
