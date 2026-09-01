/**
 * @file subtitle-render.js
 * @description Subtitle motion, shared by the two documents that draw subtitles:
 * the app window (js/preview.js, js/speech.js), which OBS takes by window
 * capture behind a chroma key, and overlay.html, which OBS takes as a WebSocket
 * browser source. Both are output, not one of each — see css/subtitle-core.css
 * for why that matters. This is the counterpart to that file: it holds the
 * shared values, this holds the shared behaviour.
 *
 * Both copies of this code used to be maintained by hand — preview.js and
 * overlay.html carried byte-identical implementations of the cinema scroll, and
 * speech.js and overlay.html carried byte-identical tail-scrolling. The comments
 * said "mirrored in overlay.html", but nothing enforced it, so the two could
 * drift — and since both of them go out on stream, that difference stays
 * invisible until someone is watching whichever one was left behind.
 *
 * Everything here is pure DOM motion: no store, no settings, no WebSocket. That
 * is what lets one implementation serve both sides. Where the two genuinely
 * differ — how each one knows the current overflow mode — the difference is
 * injected as a predicate rather than branched on here. The app window reads
 * its store, the overlay reads its last WebSocket payload, and neither has to
 * know about the other.
 *
 * Loaded by overlay.html as an ES module, which needs Chrome 61+; OBS has
 * shipped CEF 103 or newer since OBS 28, so any current OBS is far past it.
 */

/* Cinema scroll timings. A translation taller than the two-line window holds
   still long enough to be read, then advances one line at a time until the tail
   is shown. Shared so the preview and the overlay move in step. */
const SCROLL_READ_DELAY_MS    = 3000;
const SCROLL_STEP_INTERVAL_MS = 2000;
const SCROLL_STEP_ANIM_MS     = 800;

/**
 * Keep the newest line of a clipped element in view.
 *
 * Used for the source (STT) line in "newest line only" mode: the text wraps at
 * the full container width and overflows downward, and this scrolls to the
 * bottom so the last wrapped line is the visible one. Scrolling upward (rather
 * than replacing the line) is deliberate — it reads as "this sentence is still
 * going and got long", not as "the previous sentence ended".
 *
 * A no-op when the element is not clipped.
 *
 * @param {HTMLElement} el
 */
export function keepTailVisible(el) {
  if (el.scrollHeight > el.clientHeight) {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  } else {
    el.scrollTop = 0;
  }
}

function smoothScrollToSlowly(el, to, duration) {
  const start = el.scrollTop;
  const change = to - start;
  const t0 = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    el.scrollTop = start + change * (t * (2 - t)); /* easeOut */
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Attach the cinema scroll to one translation line and start watching it.
 *
 * @param {HTMLElement} el       the line to scroll
 * @param {() => boolean} isShrink reads the CURRENT overflow mode at call time.
 *   Injected because the two callers learn it differently — the preview from
 *   settings.subOverflow, the overlay from its last WebSocket payload — and it
 *   must be read live, not captured, since the mode changes while this runs.
 * @returns {() => void} re-evaluate; call it after a mode change, which does not
 *   mutate text and so does not trip the observer below.
 */
export function setupCinemaScroll(el, isShrink) {
  let session = null;

  const step = () => {
    if (!isShrink()) return;
    const cs = getComputedStyle(el);
    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const max = el.scrollHeight - el.clientHeight;
    if (el.scrollTop < max - 1) {
      smoothScrollToSlowly(el, Math.min(el.scrollTop + lineH, max), SCROLL_STEP_ANIM_MS);
      session = setTimeout(step, SCROLL_STEP_INTERVAL_MS);
    }
  };

  const reeval = () => {
    clearTimeout(session);
    session = null;
    if (isShrink() && el.scrollHeight > el.clientHeight) {
      session = setTimeout(step, SCROLL_READ_DELAY_MS);
    } else {
      el.scrollTop = 0;
    }
  };

  new MutationObserver(reeval).observe(el, { childList: true, characterData: true, subtree: true });
  return reeval;
}
