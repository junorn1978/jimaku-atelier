/**
 * @file hover-tip.js
 * @description A tip that opens on hover as well as on click: the engine
 * status chips (js/ui-languages.js) and the ⓘ hints in the word-replacement
 * tab (js/ui-filter.js).
 *
 * The trigger is an ordinary popovertarget button, so a click (or Enter, or a
 * touch) opens and closes the tip with no help from here. This adds the
 * hover: the tip opens once the pointer has rested on the trigger for a beat
 * — sweeping across the row on the way somewhere else does not flash it —
 * and closes when the pointer leaves. A click while hover has it open pins it
 * instead of letting the invoker's toggle close it again.
 *
 * The tip should be popover="hint", so opening it by hover does not close the
 * mic panel or any other auto popover that happens to be open.
 */

const DELAY_MS = 300;

/**
 * @param {HTMLElement} trigger  the popovertarget button
 * @param {HTMLElement} tip      the popover it targets
 * @returns {() => void} cancel: drops a pending open and closes the tip
 */
export function wireHoverTip(trigger, tip) {
  let timer = null;
  let byHover = false;

  trigger.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' || tip.matches(':popover-open')) return;
    timer = setTimeout(() => { byHover = true; tip.showPopover({ source: trigger }); }, DELAY_MS);
  });
  trigger.addEventListener('pointerleave', () => {
    clearTimeout(timer);
    if (byHover && tip.matches(':popover-open')) tip.hidePopover();
  });
  trigger.addEventListener('click', (e) => {
    if (byHover) { e.preventDefault(); byHover = false; }
  });
  tip.addEventListener('toggle', (e) => { if (e.newState === 'closed') byHover = false; });

  return () => {
    clearTimeout(timer);
    if (tip.matches(':popover-open')) tip.hidePopover();
  };
}
