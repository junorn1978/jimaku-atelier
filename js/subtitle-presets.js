/**
 * @file subtitle-presets.js
 * @description Colour presets for the subtitle lines: one click writes a whole
 * set of text colours, outline colours and widths, and rims into the settings —
 * and the outline style, plain or one of the clouds (js/subtitle-cloud.js).
 * Every set has the same shape whatever its style (see `line`); the style
 * only decides which width settings its numbers go to.
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
 *
 * The themes menu shows one style's sets at a time, under a switch that is the
 * outline setting itself: switching it changes the look at once and brings up
 * the sets made for that style. A plain set's colours seldom make a good
 * cloud, which is why the two lists are kept apart.
 *
 * Three more slots hold the user's own sets (settings.subCustomPresets), saved
 * from the current values with the same fields as a built-in one, outline
 * style included; they are listed under both styles. The scene
 * link can pick them too; an empty slot picked there leaves the colours as
 * they are. Modelled on the sister project's マイテーマ, which keeps colours
 * only; these keep the widths and rims as well, since the built-in sets here do.
 */

import { settings, subscribe } from './store.js';
import { t } from './i18n.js';
import { isCloudOutline } from './subtitle-cloud.js';

/* [settings-key middle part, preset slot] for each subtitle line. */
const LINES = [['Source', 'src'], ['Target1', 't1'], ['Target2', 't2']];

/* One shape for every set, whatever its outline: each line's text colour,
   its outline colour (the cloud's, under a cloud style), the outline's width,
   and the rim around the outline — its colour and width. The widths are in
   the outline's own units (px for the plain stroke and its rim, the 0–15
   steps for a cloud and its rim, js/subtitle-cloud.js). A rim width of 0 is
   no rim, and a line without one needs no rim colour (null). */
const line = (color, stroke, w, rim = null, rimW = 0) => ({ color, stroke, w, rim, rimW });

/* `default` is the store's own defaults — "back to how it was". */
export const PRESETS = [
  { id: 'default',   outline: 'stroke',
    src: line('#FFFFFF', '#000000', 4), t1: line('#FFFFFF', '#000000', 4), t2: line('#FFFFFF', '#000000', 4) },
  { id: 'standard',  outline: 'stroke',
    src: line('#FFFFFF', '#000000', 4), t1: line('#FFE873', '#000000', 4), t2: line('#9FD4FF', '#000000', 4) },
  { id: 'game',      outline: 'stroke',
    src: line('#FFFFFF', '#0A0F2C', 6), t1: line('#FFD400', '#0A0F2C', 6), t2: line('#4FE3FF', '#0A0F2C', 6) },
  { id: 'cute',      outline: 'stroke',
    src: line('#FFFFFF', '#5A1E3C', 4), t1: line('#FF8FB1', '#5A1E3C', 4), t2: line('#B79CFF', '#5A1E3C', 4) },
  { id: 'pastel',    outline: 'stroke',
    src: line('#7A2E55', '#FFFFFF', 5), t1: line('#9B3F8A', '#FFFFFF', 5), t2: line('#4B4BA8', '#FFFFFF', 5) },
  { id: 'imp',       outline: 'stroke',
    src: line('#FFFFFF', '#241A2E', 5), t1: line('#CDA8FF', '#241A2E', 5), t2: line('#FF7EB9', '#241A2E', 5) },
  { id: 'berrymilk', outline: 'stroke',
    src: line('#FFFFFF', '#C8336F', 5), t1: line('#FFC2DA', '#A82A5E', 5), t2: line('#FFF1A8', '#A82A5E', 5) },
  { id: 'contrast',  outline: 'stroke',
    src: line('#FFFFFF', '#000000', 7), t1: line('#FFFF00', '#000000', 7), t2: line('#7FDBFF', '#000000', 7) },
  { id: 'retro',     outline: 'stroke',
    src: line('#F3E6C8', '#3B2414', 5), t1: line('#F2B45A', '#3B2414', 5), t2: line('#E89A7C', '#3B2414', 5) },

  { id: 'bubbleSticker',  outline: 'bubble',
    src: line('#FF4FA3', '#FFFFFF', 1, '#FA5151', 4), t1: line('#38BDF8', '#FFFFFF', 1, '#28C1DF', 4), t2: line('#CD9AFD', '#FFFFFF', 1, '#CD9AFD', 4) },
  { id: 'bubbleLavender', outline: 'bubble',
    src: line('#1A1A1A', '#C1B6FF', 11, '#C8337A', 7), t1: line('#1A1A1A', '#B4CBFF', 11, '#C8337A', 7), t2: line('#1A1A1A', '#F2A7C9', 11, '#C8337A', 7) },
  { id: 'bubbleCandy',    outline: 'bubble',
    src: line('#FFFFFF', '#FF7FB0', 6, '#FFFFFF', 3), t1: line('#FFFFFF', '#B58CFF', 6, '#FFFFFF', 3), t2: line('#FFFFFF', '#FF9E6B', 6, '#FFFFFF', 3) },
  { id: 'bubbleSoda',     outline: 'bubble',
    src: line('#0B2545', '#8FD3FF', 6, '#FFFFFF', 8), t1: line('#0B2545', '#BFE6FF', 6, '#FFFFFF', 8), t2: line('#0B2545', '#FFD6E8', 6, '#FFFFFF', 8) },
  { id: 'bubbleLemon',    outline: 'bubble',
    src: line('#3B2414', '#FFE27A', 6, '#E07A2E', 6), t1: line('#3B2414', '#FFF3B0', 6, '#E07A2E', 6), t2: line('#3B2414', '#FFC9A3', 6, '#E07A2E', 6) },
  { id: 'bubbleNight',    outline: 'bubble',
    src: line('#FFFFFF', '#2A2350', 6, '#B79CFF', 4), t1: line('#FFE873', '#2A2350', 6, '#B79CFF', 4), t2: line('#9FD4FF', '#2A2350', 6, '#B79CFF', 4) },

  { id: 'gooeyPeach', outline: 'gooey',
    src: line('#4A1F12', '#FFB38A', 6, '#FFFFFF', 8), t1: line('#4A1F12', '#FFD0A8', 6, '#FFFFFF', 8), t2: line('#4A1F12', '#FFC2D4', 6, '#FFFFFF', 8) },
  { id: 'gooeyGrape', outline: 'gooey',
    src: line('#FFFFFF', '#7B4FC9', 6, '#F5D0FF', 6), t1: line('#FFFFFF', '#9A6BE0', 6, '#F5D0FF', 6), t2: line('#FFFFFF', '#C25AA8', 6, '#F5D0FF', 6) },
  { id: 'gooeyInk',   outline: 'gooey',
    src: line('#FFFFFF', '#1C1C24', 4, '#FFD400', 8), t1: line('#FFE873', '#1C1C24', 4, '#FFD400', 8), t2: line('#9FD4FF', '#1C1C24', 4, '#FFD400', 8) },
];

/** A preset's outline style; a slot saved before there was a choice is plain. */
export const outlineOf = (preset) => isCloudOutline(preset?.outline) ? preset.outline : 'stroke';

const isCloud = (preset) => outlineOf(preset) !== 'stroke';

/* The settings a set's widths go to: each style keeps its own outline and rim
   widths (js/store.js), so a set writes its own style's and leaves the
   other's as they were. The cloud's source-line rim is subRimW. */
const widthKey = (preset, name) => `sub${name}${isCloud(preset) ? 'BubbleW' : 'StrokeW'}`;
const rimKey = (preset, name) => isCloud(preset)
  ? (name === 'Source' ? 'subRimW' : `sub${name}RimW`)
  : `sub${name}StrokeRimW`;

const KEYS = ['subOutline', ...LINES.flatMap(([name]) =>
  [`sub${name}Color`, `sub${name}Stroke`, `sub${name}Rim`,
   widthKey({}, name), widthKey({ outline: 'bubble' }, name),
   rimKey({}, name), rimKey({ outline: 'bubble' }, name)])];

/** The user's slots, by id; their index is their place in subCustomPresets. */
export const CUSTOM_SLOTS = ['custom1', 'custom2', 'custom3'];

const isHex = (v) => typeof v === 'string' && /^#[0-9A-F]{6}$/.test(v);

/* The version of a slot saved in the shape above (currentPreset). */
const SAVED_VERSION = 2;

/* A saved slot in the shape above, or null when it is empty or no longer
   makes sense. A slot from before the shape (no v) is read the way it was
   written: a cloud slot's rim width was the set's (rimW), unless the line
   carried its own; a plain slot had no rim — the rimW it kept was the
   cloud's, which is not the plain outline's rim. */
function fromSaved(saved) {
  if (!saved) return null;
  const lines = {};
  for (const [, slot] of LINES) {
    const l = saved[slot];
    if (!isHex(l?.color) || !isHex(l?.stroke) || !Number.isFinite(l?.w)) return null;
    const rimW = saved.v >= SAVED_VERSION ? l.rimW
      : !isCloud(saved) ? 0
      : Number.isFinite(l.rimW) ? l.rimW : saved.rimW;
    if (!Number.isFinite(rimW)) return null;
    const rim = isHex(l.rim) ? l.rim : null;
    if (rimW > 0 && !rim) return null;
    lines[slot] = line(l.color, l.stroke, l.w, rim, rimW);
  }
  return { outline: outlineOf(saved), ...lines };
}

function customPreset(index) {
  const preset = fromSaved(settings.subCustomPresets?.[index]);
  return preset && { ...preset, id: CUSTOM_SLOTS[index] };
}

/* A built-in preset or a filled slot; undefined for an unknown id or an
   empty slot. */
function findPreset(id) {
  const index = CUSTOM_SLOTS.indexOf(id);
  return index >= 0 ? customPreset(index) ?? undefined : PRESETS.find(p => p.id === id);
}

/** A preset's name in the interface language, built-in or slot. */
export function presetName(id) {
  const index = CUSTOM_SLOTS.indexOf(id);
  return index >= 0
    ? t('style.preset.custom').replace('{n}', String(index + 1))
    : t(`style.preset.${id}`);
}

/**
 * Apply a preset by id — for the OBS scene link (js/obs-scene-link.js).
 * @returns {boolean} false when there is no such preset (one removed since
 *   the rule was saved) or the slot is empty, in which case nothing changes.
 */
export function applyPreset(id) {
  const preset = findPreset(id);
  if (preset) apply(preset);
  return !!preset;
}

/* A set writes its own style's widths and leaves the other style's alone:
   neither is part of the other's look. A line without a rim leaves the rim
   colour alone too, having none to give. */
function apply(preset) {
  settings.subOutline = outlineOf(preset);
  /* The links go first, each on only when the set's three values are equal:
     while one is on, the translation lines follow the source line's value
     (js/ui-languages.js), which would undo a set whose lines differ. */
  const equal = (part) => LINES.every(([, slot]) => preset[slot][part] === preset.src[part]);
  settings[isCloud(preset) ? 'subBubbleWLinked' : 'subStrokeWLinked'] = equal('w');
  settings[isCloud(preset) ? 'subRimLinked' : 'subStrokeRimLinked'] = equal('rimW');
  for (const [name, slot] of LINES) {
    const l = preset[slot];
    settings[`sub${name}Color`]  = l.color;
    settings[`sub${name}Stroke`] = l.stroke;
    settings[widthKey(preset, name)] = l.w;
    settings[rimKey(preset, name)]   = l.rimW;
    if (l.rim) settings[`sub${name}Rim`] = l.rim;
  }
}

/* The current values, in a preset's shape. Colours upper-cased: the colour
   inputs hand them over in lower case. */
function currentPreset() {
  const outline = outlineOf({ outline: settings.subOutline });
  return {
    v: SAVED_VERSION,
    outline,
    ...Object.fromEntries(LINES.map(([name, slot]) => [slot, line(
      String(settings[`sub${name}Color`]).toUpperCase(),
      String(settings[`sub${name}Stroke`]).toUpperCase(),
      Number(settings[widthKey({ outline }, name)]),
      String(settings[`sub${name}Rim`]).toUpperCase(),
      Number(settings[rimKey({ outline }, name)]),
    )])),
  };
}

function saveCustom(index) {
  const next = CUSTOM_SLOTS.map((_, i) => settings.subCustomPresets?.[i] ?? null);
  next[index] = currentPreset();
  settings.subCustomPresets = next;
}

/* A rim's colour counts only where the line has a rim to show it. */
function matches(preset) {
  return outlineOf({ outline: settings.subOutline }) === outlineOf(preset)
    && LINES.every(([name, slot]) => {
      const l = preset[slot];
      return String(settings[`sub${name}Color`]).toUpperCase()  === l.color
        && String(settings[`sub${name}Stroke`]).toUpperCase() === l.stroke
        && Number(settings[widthKey(preset, name)]) === l.w
        && Number(settings[rimKey(preset, name)])   === l.rimW
        && (!(l.rimW > 0) || String(settings[`sub${name}Rim`]).toUpperCase() === l.rim);
    });
}

/* The inside of a preset button: three dots for the three lines — each the
   line's text colour, ringed in its outline colour, since the outline decides
   the look as much as the fill (the pastel set is dark text on white) — then
   the name, drawn in the preset's second line (the first is white in most of
   them). So every button previews itself. A cloud set adds its rim to the
   dots, which also marks a cloud slot among the plain ones; so does a plain
   slot saved with a rim. An empty slot
   has no colours, and its name says so. */
function paintItem(item, preset, name) {
  item.disabled = !preset;
  item.classList.toggle('is-empty', !preset);
  item.classList.toggle('is-cloud', !!preset && isCloud(preset));
  item.classList.toggle('has-rim', !!preset && !isCloud(preset)
    && LINES.some(([, slot]) => preset[slot].rimW > 0));
  item.style.setProperty('--p-color', preset?.t1.color ?? '');
  item.style.setProperty('--p-stroke', preset?.t1.stroke ?? '');
  item.style.setProperty('--p-rim', preset?.t1.rim ?? '');
  const dots = preset
    ? LINES.map(([, slot]) =>
        `<i style="--d-color:${preset[slot].color};--d-stroke:${preset[slot].stroke};--d-rim:${preset[slot].rim ?? ''}"></i>`).join('')
    : '';
  item.innerHTML = `<span class="sub-preset-dots" aria-hidden="true">${dots}</span>`
    + `<span class="sub-preset-name"></span>`;
  item.querySelector('.sub-preset-name').textContent = preset ? name : `${name}${t('style.preset.custom.empty')}`;
}

/**
 * Wire the Languages tab's preset row (markup in js/ui-languages.js): the
 * default set's button, and the themes button with its menu — every built-in
 * set, then the user's three slots, each with a save button.
 * Two fixed buttons rather than a strip of chips: a strip's width followed the
 * names in each interface language, and cutting it to fit clipped chips at
 * one width or another. The menu has room to grow.
 */
export function wireSubtitlePresets(row) {
  if (!row) return;
  const defaultBtn = row.querySelector('.sub-preset-default');
  const themesBtn  = row.querySelector('.sub-preset-themes');
  const menu       = row.querySelector('.sub-preset-menu');
  const grid       = menu.querySelector('.sub-preset-grid');
  const mine       = menu.querySelector('.sub-preset-mine');

  const builtIns = PRESETS.map(p => {
    const item = document.createElement('button');
    item.type = 'button';
    item.dataset.preset = p.id;
    return item;
  });
  grid.append(...builtIns);

  const slots = CUSTOM_SLOTS.map((id, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.dataset.preset = id;
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn sub-preset-save';
    /* The menu stays open, so what was just stored shows at once. */
    save.addEventListener('click', () => saveCustom(index));
    const cell = document.createElement('div');
    cell.className = 'sub-preset-slot';
    cell.append(item, save);
    mine.append(cell);
    return { item, save };
  });

  const items = [defaultBtn, ...builtIns, ...slots.map(s => s.item)];

  /* Pressed is whichever preset the current values match, so a colour changed
     by hand afterwards leaves none pressed. The themes button is lit while
     the look in use is one of its sets other than the default, which has its
     own button — so a theme in use is never left unmarked on the row. */
  const sync = () => {
    let themed = false;
    for (const item of items) {
      const preset = findPreset(item.dataset.preset);
      const on = !!preset && matches(preset);
      item.setAttribute('aria-pressed', String(on));
      if (on && item.dataset.preset !== 'default') themed = true;
    }
    themesBtn.classList.toggle('has-pressed', themed);
  };

  /* The menu lists the sets for the outline in use; the slots stay, as they
     can hold either. */
  const filter = () => {
    const outline = outlineOf({ outline: settings.subOutline });
    for (const item of builtIns) item.hidden = outlineOf(findPreset(item.dataset.preset)) !== outline;
  };

  /* Names and save labels follow the interface language; slots also follow
     what is saved in them. */
  const paint = () => {
    paintItem(defaultBtn, findPreset('default'), presetName('default'));
    for (const item of builtIns) paintItem(item, findPreset(item.dataset.preset), presetName(item.dataset.preset));
    slots.forEach(({ item, save }, index) => {
      paintItem(item, customPreset(index), presetName(CUSTOM_SLOTS[index]));
      save.textContent = t('style.preset.save');
      save.title = t('style.preset.save.title').replace('{name}', presetName(CUSTOM_SLOTS[index]));
    });
    sync();
  };

  for (const item of items) {
    item.addEventListener('click', () => {
      if (!applyPreset(item.dataset.preset)) return;
      if (menu.contains(item)) menu.hidePopover();
    });
  }

  subscribe('uiLang', paint);
  subscribe('subCustomPresets', paint);
  for (const key of KEYS) subscribe(key, sync);
  subscribe('subOutline', filter);
  filter();
  paint();
}
