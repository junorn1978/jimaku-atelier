/**
 * @file subtitle-window-protocol.js
 * @description What the app window (js/subtitle-window.js) and the subtitle
 * window (js/subtitle-window-page.js) agree on. Both sides import it, so a
 * renamed channel or key cannot leave one of them talking to nobody.
 *
 * Messages on the channel, all plain objects with a `type`:
 *
 *   app → window
 *     state  { lang, vars, attrs, lines }  everything the subtitle window draws
 *     ping                                  "is a subtitle window open?"
 *     bye                                   the app window is going away
 *     close                                 close yourself
 *
 *   window → app
 *     hello                                 opened, reloaded, or answering ping
 *     bye                                   the subtitle window is going away
 */

import { CHANNEL, perChannel } from './channel.js';

/* Everything here is per channel (js/channel.js): the second app window has a
   subtitle window of its own, opened with the same ?ch=2, and the two pairs
   must neither hear each other nor share a window or its place on screen. */

/* BroadcastChannel reaches every same-origin document in this browser profile,
   which is exactly the reach needed: the app and the window it opened. It does
   NOT reach OBS's browser sources (a separate browser), which is why
   overlay.html keeps its WebSocket. */
export const CHANNEL_NAME = perChannel('rtl-subtitle-window');

/* window.open target name. Reusing it means a second "open" finds the window
   that is already up instead of stacking another one. */
export const WINDOW_NAME = perChannel('rtl-subtitle-window');

/* Last position and size, written by the subtitle window, read by the app when
   it opens one. Kept apart from the settings store: the subtitle window does
   not load the store, and has no other reason to. */
export const GEOMETRY_KEY = perChannel('rtl-subtitle-window-geometry');

/* The subtitle window's page, carrying the channel along. */
export const WINDOW_URL = CHANNEL === 2 ? 'subtitle-window.html?ch=2' : 'subtitle-window.html';
