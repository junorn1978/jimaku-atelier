/**
 * @file subtitle-presets.js
 * @description Colour presets for the subtitle lines: one click writes a whole
 * set of text colours, outline colours and outline widths into the settings —
 * and the outline style, since the cloud outlines (js/subtitle-cloud.js) have
 * sets of their own, which also carry each line's rim colour.
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
 * only; these keep the outline width as well, since the built-in sets here do.
 */

import { settings, subscribe } from './store.js';
import { t } from './i18n.js';
import { isCloudOutline } from './subtitle-cloud.js';

/* [settings-key middle part, preset slot] for each subtitle line. */
const LINES = [['Source', 'src'], ['Target1', 't1'], ['Target2', 't2']];

const line = (color, stroke, w) => ({ color, stroke, w });
/* stroke is the cloud's colour, w its size, rim the ring around it; the
   set's rimW is the ring's width, shared by its three lines. */
const cloud = (color, stroke, w, rim) => ({ color, stroke, w, rim });

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

  { id: 'bubbleSticker',  outline: 'bubble', rimW: 4,
    src: cloud('#FF4FA3', '#FFFFFF', 1, '#FA5151'), t1: cloud('#38BDF8', '#FFFFFF', 1, '#28C1DF'), t2: cloud('#CD9AFD', '#FFFFFF', 1, '#CD9AFD') },
  { id: 'bubbleLavender', outline: 'bubble', rimW: 4,
    src: cloud('#1A1A1A', '#8A80C8', 8, '#C8337A'), t1: cloud('#1A1A1A', '#A99BE8', 8, '#C8337A'), t2: cloud('#1A1A1A', '#F2A7C9', 8, '#C8337A') },
  { id: 'bubbleCandy',    outline: 'bubble', rimW: 3,
    src: cloud('#FFFFFF', '#FF7FB0', 6, '#FFFFFF'), t1: cloud('#FFFFFF', '#B58CFF', 6, '#FFFFFF'), t2: cloud('#FFFFFF', '#FF9E6B', 6, '#FFFFFF') },
  { id: 'bubbleSoda',     outline: 'bubble', rimW: 3,
    src: cloud('#0B2545', '#8FD3FF', 6, '#FFFFFF'), t1: cloud('#0B2545', '#BFE6FF', 6, '#FFFFFF'), t2: cloud('#0B2545', '#FFD6E8', 6, '#FFFFFF') },
  { id: 'bubbleLemon',    outline: 'bubble', rimW: 3,
    src: cloud('#3B2414', '#FFE27A', 6, '#E07A2E'), t1: cloud('#3B2414', '#FFF3B0', 6, '#E07A2E'), t2: cloud('#3B2414', '#FFC9A3', 6, '#E07A2E') },
  { id: 'bubbleNight',    outline: 'bubble', rimW: 3,
    src: cloud('#FFFFFF', '#2A2350', 6, '#B79CFF'), t1: cloud('#FFE873', '#2A2350', 6, '#B79CFF'), t2: cloud('#9FD4FF', '#2A2350', 6, '#B79CFF') },

  { id: 'gooeyPeach', outline: 'gooey', rimW: 3,
    src: cloud('#4A1F12', '#FFB38A', 6, '#FFFFFF'), t1: cloud('#4A1F12', '#FFD0A8', 6, '#FFFFFF'), t2: cloud('#4A1F12', '#FFC2D4', 6, '#FFFFFF') },
  { id: 'gooeyGrape', outline: 'gooey', rimW: 3,
    src: cloud('#FFFFFF', '#7B4FC9', 6, '#F5D0FF'), t1: cloud('#FFFFFF', '#9A6BE0', 6, '#F5D0FF'), t2: cloud('#FFFFFF', '#C25AA8', 6, '#F5D0FF') },
  { id: 'gooeyInk',   outline: 'gooey', rimW: 2,
    src: cloud('#FFFFFF', '#1C1C24', 6, '#FFD400'), t1: cloud('#FFE873', '#1C1C24', 6, '#FFD400'), t2: cloud('#9FD4FF', '#1C1C24', 6, '#FFD400') },
];

/** A preset's outline style; sets from before there was a choice are plain. */
export const outlineOf = (preset) => isCloudOutline(preset?.outline) ? preset.outline : 'stroke';

const isCloud = (preset) => outlineOf(preset) !== 'stroke';

/* Which setting a preset's w goes to: the plain outline keeps its widths, the
   cloud styles share theirs. */
const widthKey = (preset, name) => `sub${name}${isCloud(preset) ? 'BubbleW' : 'StrokeW'}`;

const KEYS = ['subOutline', 'subRimW', ...LINES.flatMap(([name]) =>
  [`sub${name}Color`, `sub${name}Stroke`, `sub${name}StrokeW`, `sub${name}BubbleW`, `sub${name}Rim`])];

/** The user's slots, by id; their index is their place in subCustomPresets. */
export const CUSTOM_SLOTS = ['custom1', 'custom2', 'custom3'];

const isHex = (v) => typeof v === 'string' && /^#[0-9A-F]{6}$/.test(v);

/* A saved slot, or null when it is empty or no longer the right shape. A
   cloud slot needs its rims; a plain one saved before rims existed has none. */
function customPreset(index) {
  const saved = settings.subCustomPresets?.[index];
  const ok = saved && LINES.every(([, slot]) =>
    isHex(saved[slot]?.color) && isHex(saved[slot]?.stroke) && Number.isFinite(saved[slot]?.w)
    && (!isCloud(saved) || isHex(saved[slot]?.rim)))
    && (!isCloud(saved) || Number.isFinite(saved.rimW));
  return ok ? { ...saved, id: CUSTOM_SLOTS[index] } : null;
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

/* A plain set leaves the rims and the cloud sizes alone, and a cloud set the
   plain outline widths: neither is part of the other's look. */
function apply(preset) {
  const cloudSet = isCloud(preset);
  settings.subOutline = outlineOf(preset);
  if (cloudSet) settings.subRimW = preset.rimW;
  for (const [name, slot] of LINES) {
    settings[`sub${name}Color`]   = preset[slot].color;
    settings[`sub${name}Stroke`]  = preset[slot].stroke;
    settings[widthKey(preset, name)] = preset[slot].w;
    if (cloudSet) settings[`sub${name}Rim`] = preset[slot].rim;
  }
}

/* The current values, in a preset's shape. Colours upper-cased: the colour
   inputs hand them over in lower case. */
function currentPreset() {
  const outline = outlineOf({ outline: settings.subOutline });
  return {
    outline,
    rimW: Number(settings.subRimW),
    ...Object.fromEntries(LINES.map(([name, slot]) => [slot, cloud(
      String(settings[`sub${name}Color`]).toUpperCase(),
      String(settings[`sub${name}Stroke`]).toUpperCase(),
      Number(settings[widthKey({ outline }, name)]),
      String(settings[`sub${name}Rim`]).toUpperCase(),
    )])),
  };
}

function saveCustom(index) {
  const next = CUSTOM_SLOTS.map((_, i) => settings.subCustomPresets?.[i] ?? null);
  next[index] = currentPreset();
  settings.subCustomPresets = next;
}

/* The rims count only for a cloud set; a plain one never shows them. */
function matches(preset) {
  const cloudSet = isCloud(preset);
  return outlineOf({ outline: settings.subOutline }) === outlineOf(preset)
    && (!cloudSet || Number(settings.subRimW) === preset.rimW)
    && LINES.every(([name, slot]) =>
      String(settings[`sub${name}Color`]).toUpperCase()  === preset[slot].color &&
      String(settings[`sub${name}Stroke`]).toUpperCase() === preset[slot].stroke &&
      Number(settings[widthKey(preset, name)])           === preset[slot].w &&
      (!cloudSet || String(settings[`sub${name}Rim`]).toUpperCase() === preset[slot].rim));
}

/* The inside of a preset button: three dots for the three lines — each the
   line's text colour, ringed in its outline colour, since the outline decides
   the look as much as the fill (the pastel set is dark text on white) — then
   the name, drawn in the preset's second line (the first is white in most of
   them). So every button previews itself. A cloud set adds its rim to the
   dots, which also marks a cloud slot among the plain ones. An empty slot
   has no colours, and its name says so. */
function paintItem(item, preset, name) {
  item.disabled = !preset;
  item.classList.toggle('is-empty', !preset);
  item.classList.toggle('is-cloud', !!preset && isCloud(preset));
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
