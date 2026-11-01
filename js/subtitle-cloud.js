/**
 * @file subtitle-cloud.js
 * @description The cloud outlines (settings.subOutline other than 'stroke'):
 * each line's text sits on a thick cloud in its outline colour, ringed by a
 * thin rim in its rim colour. Neighbouring glyphs swell into one cloud and part
 * only where the text leaves a wide gap — after 、 and 。, between words.
 *
 * Why an SVG filter rather than -webkit-text-stroke: the stroke paints one
 * colour, its joins are mitred, so a thick one grows spikes on kana corners,
 * and stacking copies of the text for a second colour puts each glyph's rim
 * over its neighbour's cloud instead of merging them. The filter grows the
 * whole line's shape at once, so the union comes for free.
 *
 * The styles differ only in how the glyphs swell into the cloud (SHAPES);
 * the rim, the colours and the three settings they read (cloud size, rim
 * width, rim colour) are shared, so a look moves between styles intact.
 * Adding a style takes: a shape below and its name in CLOUD_OUTLINES; its
 * name in the i18n files (style.outline.<name>) and a segment in the themes
 * menu (js/ui-languages.js); its filter selectors in css/subtitle-display.css
 * and overlay.html; and, if it should have them, its sets in
 * js/subtitle-presets.js.
 *
 * Loaded by every document that draws subtitles: the app window (js/output.js),
 * the subtitle window (js/subtitle-window-page.js) and overlay.html. Each
 * installs its own copy of the filters, since url(#id) only resolves inside
 * the document, and feeds it the same numbers.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const CLOUD_OUTLINES = ['bubble', 'gooey'];

export const CLOUD_LINES = ['source', 'target1', 'target2'];

/** Whether an outline setting is one of the cloud styles. */
export const isCloudOutline = (outline) => CLOUD_OUTLINES.includes(outline);

export const cloudFilterId = (outline, line) => `sub-${outline}-${line}`;

/**
 * The cloud and its rim for one line, in px. Both follow the font size, so a
 * line keeps its look when it is resized; the two width settings (steps of
 * 0–15) only make the cloud plumper or slimmer and the rim thicker or
 * thinner. A rim of 0 is none; any other is at least a pixel, or it would
 * vanish on a small line.
 */
export function cloudGeometry(sizePx, width, rimWidth = 3) {
  return {
    radius: sizePx * (0.08 + 0.02 * width),
    rim:    rimWidth > 0 ? Math.max(1, sizePx * 0.02 * rimWidth) : 0,
  };
}

/* An alpha cut at one half with a short ramp: crisp, still antialiased. */
const CUT_HALF = '<feFuncA type="linear" slope="8" intercept="-3.5"/>';

/* How each style swells SourceAlpha into result="cloud", and how it follows
   the cloud's radius. */
const SHAPES = {
  /* Even and round: three rectangular dilations (wide, tall, and a square
     reaching the circle's diagonal) unioned into an octagon, then a small
     blur cut at half alpha to round what is left of its corners. Measured in
     the prototype at 0.6ms of GPU time per update on a 1920-wide line. */
  bubble: {
    markup: `
      <feMorphology in="SourceAlpha" operator="dilate" data-k="1 0.41" result="d1"/>
      <feMorphology in="SourceAlpha" operator="dilate" data-k="0.41 1" result="d2"/>
      <feMorphology in="SourceAlpha" operator="dilate" data-k="0.71 0.71" result="d3"/>
      <feMerge result="du"><feMergeNode in="d1"/><feMergeNode in="d2"/><feMergeNode in="d3"/></feMerge>
      <feGaussianBlur in="du" data-blur="cloud" result="db"/>
      <feComponentTransfer in="db" result="cloud">${CUT_HALF}</feComponentTransfer>`,
    update(filter, g) {
      filter.querySelectorAll('[data-k]').forEach((el) => {
        const [kx, ky] = el.dataset.k.split(' ').map(Number);
        el.setAttribute('radius', `${(g.radius * kx).toFixed(2)} ${(g.radius * ky).toFixed(2)}`);
      });
      filter.querySelector('[data-blur="cloud"]').setAttribute('stdDeviation', Math.max(1, g.radius * 0.25).toFixed(2));
    },
  },

  /* Lumpy: the glyphs blurred wide and cut low, so dense strokes swell
     further than thin ones and the outline wobbles like something squeezed
     from a tube. The low cut alone leaves a soft, wide edge, so a short blur
     cut at half alpha sharpens it again. The blur is as wide as the cloud's
     radius and cut at 3–6% alpha, which swells about as far as the bubble at
     the same setting. It costs more than the bubble: 1.7ms in the prototype
     with a blur six tenths this wide, and the wider one was not measured. */
  gooey: {
    markup: `
      <feGaussianBlur in="SourceAlpha" data-blur="goo" result="gb"/>
      <feComponentTransfer in="gb" result="gc"><feFuncA type="linear" slope="30" intercept="-0.9"/></feComponentTransfer>
      <feGaussianBlur in="gc" stdDeviation="1" result="gs"/>
      <feComponentTransfer in="gs" result="cloud">${CUT_HALF}</feComponentTransfer>`,
    update(filter, g) {
      filter.querySelector('[data-blur="goo"]').setAttribute('stdDeviation', g.radius.toFixed(2));
    },
  },
};

/* The filter region reaches past the line's box by a share of its size. At
   the widest cloud and rim (15 and 15) they swell 0.68em past the glyphs, and
   60% of a one-line box (1.55em) is 0.93em, so nothing is cut top or bottom.
   The app's lines span the pane, so 5% is plenty sideways; overlay.html's
   lines shrink to their text and pad themselves for the cloud (see there).
   Everything after the shape is shared: the rim grown from the cloud, the two
   colours, and the text on top. */
const filterMarkup = (outline, line) => `
  <filter id="${cloudFilterId(outline, line)}" x="-5%" y="-60%" width="110%" height="220%" color-interpolation-filters="sRGB">
    ${SHAPES[outline].markup}
    <feMorphology in="cloud" operator="dilate" data-rim="" result="ru"/>
    <feGaussianBlur in="ru" data-blur="rim" result="rb"/>
    <feComponentTransfer in="rb" result="rim">${CUT_HALF}</feComponentTransfer>
    <feFlood data-flood="rim" result="rf"/>
    <feComposite in="rf" in2="rim" operator="in" result="rimC"/>
    <feFlood data-flood="cloud" result="cf"/>
    <feComposite in="cf" in2="cloud" operator="in" result="cloudC"/>
    <feMerge><feMergeNode in="rimC"/><feMergeNode in="cloudC"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;

/** Add every style's filter for the three lines to this document, once. */
export function installCloudFilters(doc = document) {
  if (doc.getElementById(cloudFilterId(CLOUD_OUTLINES[0], CLOUD_LINES[0]))) return;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  svg.innerHTML = `<defs>${CLOUD_OUTLINES.flatMap(outline =>
    CLOUD_LINES.map(line => filterMarkup(outline, line))).join('')}</defs>`;
  doc.body.prepend(svg);
}

/**
 * Point one line's filters, in every style, at its current size and colours.
 * All of them rather than the one in use, so a switch of style needs nothing
 * redrawn here.
 * @param {'source'|'target1'|'target2'} line
 * @param {{ size: number, width: number, rimWidth: number, cloud: string, rim: string }} style
 *   size in px; width and rimWidth the 0–15 steps the settings hold; cloud is
 *   the outline colour, rim the rim colour.
 */
export function updateCloudFilters(line, { size, width, rimWidth, cloud, rim }, doc = document) {
  if (!(size > 0)) return;
  const g = cloudGeometry(size, Number(width) || 0, Number.isFinite(rimWidth) ? rimWidth : 3);

  for (const outline of CLOUD_OUTLINES) {
    const filter = doc.getElementById(cloudFilterId(outline, line));
    if (!filter) continue;
    const set = (selector, name, value) =>
      filter.querySelectorAll(selector).forEach(el => el.setAttribute(name, value));

    SHAPES[outline].update(filter, g);
    set('[data-rim]', 'radius', g.rim.toFixed(2));
    set('[data-blur="rim"]', 'stdDeviation', Math.max(0.6, g.rim * 0.4).toFixed(2));
    /* No rim: its layer would still be the cloud's own shape, cut sharper, and
       show as a fringe along the cloud's antialiased edge. */
    set('[data-flood="rim"]', 'flood-opacity', g.rim > 0 ? 1 : 0);
    if (cloud) set('[data-flood="cloud"]', 'flood-color', cloud);
    if (rim)   set('[data-flood="rim"]', 'flood-color', rim);
  }
}

/* The CSS custom properties js/output.js writes, per line. */
const VAR_PREFIX = { source: '--sub-source', target1: '--sub-target1', target2: '--sub-target2' };

/**
 * Update every line's filters from the --sub-* properties on a style
 * declaration — the root's, where js/output.js writes them and where the
 * subtitle window receives them.
 */
export function syncCloudFromVars(style, doc = document) {
  const rimWidth = parseFloat(style.getPropertyValue('--sub-rim-w'));
  for (const line of CLOUD_LINES) {
    const p = VAR_PREFIX[line];
    updateCloudFilters(line, {
      size:  parseFloat(style.getPropertyValue(`${p}-size`)),
      width: parseFloat(style.getPropertyValue(`${p}-bubble-w`)),
      rimWidth,
      cloud: style.getPropertyValue(`${p}-stroke`).trim(),
      rim:   style.getPropertyValue(`${p}-rim`).trim(),
    }, doc);
  }
}
