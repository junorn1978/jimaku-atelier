/**
 * @file env.js
 * @description Browser environment detection shared across modules. Chrome and
 * Edge are distinguished because on-device speech features (processLocally and
 * offline language-pack install) are Chrome-only.
 *
 * Phones and tablets are not supported at all (js/main.js turns them away).
 * They are told apart by the user agent alone: a browser set to request the
 * desktop site, or one spoofing its UA, gets through, and that is left to the
 * user who changed it. userAgentData.mobile is false on Android tablets, so
 * "Android" in the UA string is what catches those.
 */

const { isChrome, isEdge } = (() => {
  if (typeof navigator === 'undefined') return { isChrome: false, isEdge: false };
  const ua = navigator.userAgent || '';
  const brands = navigator.userAgentData?.brands?.map(b => b.brand) || [];
  const isEdge = brands.some(b => /Edge|Microsoft\s?Edge/i.test(b)) || /Edg\//.test(ua);
  const isChrome = !isEdge && (brands.some(b => /Google Chrome/i.test(b)) || /Chrome\//.test(ua));
  return { isChrome, isEdge };
})();

const isMobile = (() => {
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
})();

export { isChrome, isEdge, isMobile };
