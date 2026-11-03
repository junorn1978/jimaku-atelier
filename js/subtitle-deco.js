/**
 * @file subtitle-deco.js
 * @description Pictures hung on the source line's corners: one at the top
 * left of its first character, one at the top right of its last. Each corner
 * has its own picture (the user's own, chosen in the Languages tab —
 * js/ui-deco.js), its own angle, size and offset, and either can be on alone.
 *
 * Shared by the three documents that draw subtitles: the app window's output
 * pane (js/output.js), the subtitle window (js/subtitle-window-page.js) and
 * overlay.html. Nothing here reads the settings store — the subtitle window and
 * the overlay have none — so each side hands mountSubtitleDeco() a plain
 * config: { left, right } of { on, src, angle, size, x, y }.
 *
 * The pictures are not put inside the source line:
 *  - the line can clip itself (one-line mode) and scroll to its tail, which
 *    would cut the picture or carry it away;
 *  - the cloud outlines are an SVG filter over the line's whole box, so a
 *    picture inside it would be wrapped in cloud as well.
 * They sit in the line's container instead (position: relative, isolation:
 * isolate, set by each page's CSS), at z-index -1 — behind every line, without
 * touching how the lines stack against each other. Their place is measured off
 * the text: Range.getClientRects() gives a box per line fragment, and of those
 * that are visible inside the element (not scrolled out of a clipped line), the
 * first row's left edge and the last row's right edge are the two corners.
 *
 * Sizes are a percentage of the line's font size, so a picture keeps its
 * proportion to the text when the size slider moves. Angles are degrees,
 * applied as given: each corner has its own, so nothing is mirrored.
 *
 * Nothing touches the DOM at import.
 */

export const DECO_SIDES = ['left', 'right'];

/* Size: % of the source line's font size. Angle: degrees, clockwise. */
export const DECO_SIZE_MIN  = 50;
export const DECO_SIZE_MAX  = 400;
export const DECO_SIZE_STEP = 10;
export const DECO_ANGLE_MIN = -180;
export const DECO_ANGLE_MAX = 180;
/* Offset from where the picture hangs by default, as % of the font size like
   the size, so a picture stays put against the text when the font grows. X
   is positive to the right, Y positive upward. */
export const DECO_OFFSET_MIN  = -300;
export const DECO_OFFSET_MAX  = 300;
export const DECO_OFFSET_STEP = 5;

/* The settings keys behind one corner (js/store.js). */
export const decoKeys = (side) => {
  const cap = side === 'right' ? 'Right' : 'Left';
  return {
    on:    `subDeco${cap}On`,
    img:   `subDeco${cap}Img`,
    angle: `subDeco${cap}Angle`,
    x:     `subDeco${cap}X`,
    y:     `subDeco${cap}Y`,
    size:  `subDeco${cap}Size`,
  };
};

/** Every settings key a picture depends on: what to re-send on a change. */
export const DECO_KEYS = DECO_SIDES.flatMap(side => Object.values(decoKeys(side)));

/** The config mountSubtitleDeco() takes, read off a settings object. A corner
 *  without a picture is off whatever its switch says. */
export function decoFromSettings(s) {
  const out = {};
  for (const side of DECO_SIDES) {
    const k = decoKeys(side);
    const src = typeof s[k.img] === 'string' ? s[k.img] : '';
    out[side] = {
      on:    !!s[k.on] && !!src,
      src,
      angle: Number(s[k.angle]) || 0,
      x:     Number(s[k.x]) || 0,
      y:     Number(s[k.y]) || 0,
      size:  Number(s[k.size]) || 100,
    };
  }
  return out;
}

/**
 * A short fingerprint of a picture (FNV-1a over its data URL), so the OBS
 * overlay can tell whether the picture it holds is still the current one
 * without the picture itself riding along with every subtitle update.
 * @param {string} src
 * @returns {string} '' for no picture
 */
export function decoImageId(src) {
  if (!src) return '';
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}-${src.length.toString(36)}`;
}

/* The OBS overlay is another browser and cannot read this one's storage, so
   the pictures reach it through OBS itself: the app stores each in a
   persistent-data slot of obs-websocket (SetPersistentData), and the subtitle
   update carries only each picture's id (decoImageId). An overlay holding a
   different id reads the slot (GetPersistentData). The slots are per app
   window (js/channel.js) and per corner. */
export const DECO_DATA_REALM = 'OBS_WEBSOCKET_DATA_REALM_GLOBAL';
export const decoSlotName = (ch, side) => `rtl-subtitle-deco-${ch === 2 ? 2 : 1}-${side}`;

/* Where the character's corner lands on the picture, as a share of its width
   and height (for the left corner; the right one takes 1 - X): a little in from
   the edge, so the picture reads as hanging on the character rather than
   standing beside it. */
const ANCHOR_X = 0.6;
const ANCHOR_Y = 0.55;

/* Lowest the picture's top may go in the viewport. The subtitle sits close to
   the window's top, and a picture hung on the first row would otherwise lose
   its head off the top edge; it is pushed down to tuck further behind the
   text instead. */
const TOP_MIN = 4;

/**
 * Hang the pictures in `host`, following `textEl`'s text.
 * @param {{ textEl: HTMLElement, host: HTMLElement, placeholder?: boolean }} params
 *   textEl: the source line. host: an ancestor that is its positioned
 *   container. placeholder: while the line is empty and showing its CSS
 *   placeholder (the app window's preview only), measure that text instead, so
 *   the pictures can be set up before anything is recognised.
 * @returns {{ set(config: object): void, refresh(): void }}
 */
export function mountSubtitleDeco({ textEl, host, placeholder = false }) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;

  const sides = {};
  for (const side of DECO_SIDES) {
    const img = doc.createElement('img');
    img.className = `subtitle-deco subtitle-deco-${side}`;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.decoding = 'async';
    img.draggable = false;
    img.hidden = true;
    img.addEventListener('load', () => refresh());
    img.addEventListener('error', () => { img.hidden = true; });
    host.prepend(img);
    sides[side] = { img, on: false, src: '', angle: 0, size: 100, x: 0, y: 0 };
  }

  /* The placeholder is ::before content, which a Range cannot measure. A copy
     of the line holding the placeholder as real text, laid over the line and
     invisible, stands in for it. Same classes, so the same font, size and
     alignment rules reach it. */
  let ghost = null;
  const ghostFor = () => {
    if (!ghost) {
      ghost = doc.createElement('div');
      ghost.className = textEl.className;
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, {
        position: 'absolute', visibility: 'hidden', pointerEvents: 'none', margin: '0',
      });
      host.append(ghost);
    }
    return ghost;
  };
  const ownNodes = (node) => node === ghost || Object.values(sides).some(s => s.img === node);

  /* The element whose text is measured right now: the line, or the stand-in
     while the line shows its placeholder. */
  const measured = () => {
    if (textEl.textContent.trim()) {
      if (ghost) ghost.hidden = true;
      return textEl;
    }
    if (!placeholder) return null;
    const text = textEl.dataset.placeholder || '';
    const content = win.getComputedStyle(textEl, '::before').content;
    if (!text || !content || content === 'none' || content === 'normal') {
      if (ghost) ghost.hidden = true;
      return null;
    }
    const g = ghostFor();
    if (g.className !== textEl.className) g.className = textEl.className;
    if (g.textContent !== text) g.textContent = text;
    g.hidden = false;
    g.style.left  = `${textEl.offsetLeft}px`;
    g.style.top   = `${textEl.offsetTop}px`;
    g.style.width = `${textEl.offsetWidth}px`;
    return g;
  };

  /* Boxes of the visible line fragments, in viewport coordinates. */
  const visibleRects = (el) => {
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return [];
    const range = doc.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()]
      .filter(r => r.width > 0 && r.height > 0)
      /* Rows scrolled out of a clipped line are not used; one at least half in
         view counts as visible. */
      .filter(r => r.top + r.height / 2 >= box.top && r.top + r.height / 2 <= box.bottom);
  };

  let scheduled = false;

  const place = () => {
    scheduled = false;
    const wanted = DECO_SIDES.filter(side => sides[side].on && sides[side].src);
    const el = wanted.length ? measured() : null;
    const rects = el ? visibleRects(el) : [];
    const fontSize = el ? parseFloat(win.getComputedStyle(el).fontSize) || 20 : 20;
    const hostBox = host.getBoundingClientRect();

    for (const side of DECO_SIDES) {
      const s = sides[side];
      const img = s.img;
      if (!rects.length || !s.on || !s.src || !img.complete || !img.naturalWidth) {
        img.hidden = true;
        continue;
      }
      /* Left: the top row's left end. Right: the bottom row's right end. A
         row can come as several boxes (inline children), so all boxes at that
         row's height are taken together. */
      const left = side === 'left';
      const rowTop = left ? Math.min(...rects.map(r => r.top)) : Math.max(...rects.map(r => r.top));
      const row = rects.filter(r => Math.abs(r.top - rowTop) < r.height / 2);
      const cornerX = left ? Math.min(...row.map(r => r.left)) : Math.max(...row.map(r => r.right));
      const cornerY = Math.min(...row.map(r => r.top));

      const width  = fontSize * s.size / 100;
      const height = width * img.naturalHeight / img.naturalWidth;
      const ax = left ? ANCHOR_X : 1 - ANCHOR_X;
      /* The user's offset after the top-edge floor, so a picture can still be
         moved up past it on purpose. */
      const top = Math.max(cornerY - height * ANCHOR_Y, TOP_MIN) - fontSize * s.y / 100;

      img.style.width = `${width}px`;
      img.style.left  = `${cornerX - hostBox.left - width * ax + fontSize * s.x / 100}px`;
      img.style.top   = `${top - hostBox.top}px`;
      img.style.transform = `rotate(${s.angle}deg)`;
      img.hidden = false;
    }
  };

  /* Interim results rewrite the line many times a second: measure at most
     once a frame. */
  const refresh = () => {
    if (scheduled) return;
    scheduled = true;
    win.requestAnimationFrame(place);
  };

  new MutationObserver(refresh)
    .observe(textEl, { childList: true, characterData: true, subtree: true });
  textEl.addEventListener('scroll', refresh, { passive: true });
  /* The overlay's lines rise into place as they appear (a transform
     animation): measure again where they stop. */
  textEl.addEventListener('animationend', refresh);
  const resize = new ResizeObserver(refresh);
  resize.observe(textEl);
  resize.observe(host);
  win.addEventListener('resize', refresh);
  doc.fonts?.addEventListener?.('loadingdone', refresh);

  /* Size, face, alignment and line height change through style and class
     attributes and the --sub-* variables on the root — none of which the
     observers above see. The pictures' own styles are written by place(), so
     changes to them are skipped, or this would measure every frame forever. */
  const attrs = new MutationObserver((records) => {
    if (records.some(r => !ownNodes(r.target))) refresh();
  });
  attrs.observe(doc.documentElement, { attributes: true });
  if (doc.body) attrs.observe(doc.body, { attributes: true });
  attrs.observe(host, { attributes: true, subtree: true });

  return {
    set(config) {
      for (const side of DECO_SIDES) {
        const c = config?.[side] || {};
        const s = sides[side];
        s.on    = !!c.on;
        s.src   = typeof c.src === 'string' ? c.src : '';
        s.angle = Number(c.angle) || 0;
        s.x     = Number(c.x) || 0;
        s.y     = Number(c.y) || 0;
        s.size  = Number(c.size) || 100;
        /* Only on a real change: assigning the same data URL again restarts
           the load and blinks the picture. */
        if (s.src && s.img.getAttribute('src') !== s.src) s.img.src = s.src;
        if (!s.src && s.img.hasAttribute('src')) s.img.removeAttribute('src');
      }
      refresh();
    },
    refresh,
  };
}
