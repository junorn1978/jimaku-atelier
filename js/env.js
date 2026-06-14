/**
 * @file env.js
 * @description Browser environment detection shared across modules. Chrome and
 * Edge are distinguished because on-device speech features (processLocally and
 * offline language-pack install) are Chrome-only.
 */

const { isChrome, isEdge } = (() => {
  if (typeof navigator === 'undefined') return { isChrome: false, isEdge: false };
  const ua = navigator.userAgent || '';
  const brands = navigator.userAgentData?.brands?.map(b => b.brand) || [];
  const isEdge = brands.some(b => /Edge|Microsoft\s?Edge/i.test(b)) || /Edg\//.test(ua);
  const isChrome = !isEdge && (brands.some(b => /Google Chrome/i.test(b)) || /Chrome\//.test(ua));
  return { isChrome, isEdge };
})();

export { isChrome, isEdge };
