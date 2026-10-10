/**
 * @file channel.js
 * @description Which window this is: the app (1), or the second window
 * (index.html?ch=2) that recognises another input of its own — a guest's
 * microphone, a call's audio — and puts it out separately. Two at most: a
 * third would be one more thing to keep apart on stream than people manage.
 *
 * The second window is a whole second app rather than a second lane inside
 * this one. Each window recognises, translates and keeps its own state the
 * way one always has; what has to be kept apart is only what the two share
 * by being one origin: the settings (store.js), the subtitle window's channel
 * and name (subtitle-window-protocol.js), and OBS's events and sources (obs.js,
 * overlay.html). Two windows each running start(track) do not stop each other
 * (measured on Chrome 155, 2026-10-09).
 *
 * The subtitle window reads its own URL too: the app opens it with the same
 * ?ch=2, so both sides of one pair agree without asking.
 */

export const CHANNEL = new URLSearchParams(location.search).get('ch') === '2' ? 2 : 1;

/* A name of something both windows would otherwise share. The first window's
   names are the ones used before there was a second, so nothing set up then
   has to be set up again. */
export function perChannel(name) {
  return CHANNEL === 2 ? `${name}-ch2` : name;
}
