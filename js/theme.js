/**
 * @file theme.js
 * @description Interface colour theme. Resolves settings.uiTheme ('system' |
 * 'dark' | 'light') to a concrete theme, writes it to <html data-theme>, and
 * follows the OS / browser preference live while the setting is 'system'.
 * The palettes themselves are tokens in css/styles.css.
 *
 * The page background is the one colour that is not a token: it is a user
 * setting (settings.subBg), and in window-capture mode it is the key colour
 * OBS removes. So it follows the theme only while it still holds one of the
 * themes' own defaults. Anything else — a key colour above all — was chosen
 * by the user and is left alone.
 */

import { settings, subscribe } from './store.js';

/* Each theme's default page background. The dark one is also the store's
   default for subBg, which is what a fresh install starts from. */
export const THEME_BG = Object.freeze({
  dark:  '#0E1016',
  light: '#E6D3A8',
});

const root = document.documentElement;
const prefersLight = window.matchMedia('(prefers-color-scheme: light)');

function resolve(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  return prefersLight.matches ? 'light' : 'dark';
}

function apply() {
  const theme = resolve(settings.uiTheme);
  root.dataset.theme = theme;

  const bg = String(settings.subBg || '').toUpperCase();
  const isThemeDefault = Object.values(THEME_BG).includes(bg);
  if (isThemeDefault && bg !== THEME_BG[theme]) settings.subBg = THEME_BG[theme];
}

export function initTheme() {
  apply();
  subscribe('uiTheme', apply);
  /* Only matters while the setting is 'system'; apply() re-resolves either
     way, and a fixed choice resolves to itself. */
  prefersLight.addEventListener('change', apply);
}
