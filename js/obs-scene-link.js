/**
 * @file obs-scene-link.js
 * @description The scene link: when OBS switches its program scene, start or
 * stop recognition, per scene — 'start', 'stop' or 'none' (leave it as it is,
 * say from the game to the chat scene). A scene with no rule starts, a scene
 * added later included; settings.obsSceneRules holds only the others.
 *
 * Only a switch acts. Connecting to OBS does not look at the scene already
 * live, so opening the app never starts listening by itself. Studio mode's
 * preview switches are not program switches and do nothing.
 *
 * The rules and the switch are shared settings, so both app windows follow
 * the same scene: a break scene stops the second window's subtitles too. Each
 * window acts on its own recognition from its own OBS connection.
 *
 * A rename in OBS carries its rule along. Rules for scenes OBS no longer
 * lists are kept: with OBS closed, or another scene collection loaded, the
 * list is empty or different, and that is no reason to forget the settings.
 *
 * The rules are edited in the OBS window (js/obs-settings-page.js), not in
 * the app window, which is often captured onto the stream with its scene
 * names. This module holds what both need; initSceneLink() is the app
 * window's part.
 */

import { isDebugEnabled } from './logger.js';
import { settings } from './store.js';
import { onProgramSceneChanged, onSceneRenamed } from './obs.js';

export const SCENE_ACTIONS = ['start', 'stop', 'none'];
const DEFAULT_ACTION = 'start';

export function sceneAction(sceneName) {
  const action = settings.obsSceneRules?.[sceneName];
  return SCENE_ACTIONS.includes(action) ? action : DEFAULT_ACTION;
}

export function setSceneAction(sceneName, action) {
  const rules = { ...settings.obsSceneRules };
  if (action === DEFAULT_ACTION) delete rules[sceneName];
  else rules[sceneName] = action;
  settings.obsSceneRules = rules;
}

/* Both app windows (and an open OBS window, which does not call this) see the
   same rename; whichever stores first moves the rule, and the others find
   nothing under the old name. */
function moveRule(oldName, newName) {
  const rules = settings.obsSceneRules || {};
  if (!oldName || !newName || !(oldName in rules)) return;
  const next = { ...rules, [newName]: rules[oldName] };
  delete next[oldName];
  settings.obsSceneRules = next;
}

/**
 * The app window's side.
 * @param {{ start: () => Promise<unknown>, stop: () => void }} speech
 *   recognition's own start and stop (js/speech.js)
 */
export function initSceneLink({ start, stop }) {
  /* Switches come faster than a start can open the microphone. Only the last
     one counts: a stop that lands while a start is still opening runs once
     the start is done, rather than being dropped because nothing was running
     yet. */
  let wanted = null;
  let busy = false;

  async function follow() {
    if (busy) return;
    busy = true;
    try {
      while (wanted) {
        const next = wanted;
        wanted = null;
        if (next === 'start') await start();
        else stop();
      }
    } finally {
      busy = false;
    }
  }

  onProgramSceneChanged((sceneName) => {
    if (!settings.obsSceneLink || !sceneName) return;
    const action = sceneAction(sceneName);
    if (isDebugEnabled()) console.debug(`[obs-scene-link] ${sceneName} → ${action}`);
    if (action === 'none') return;
    wanted = action;
    follow();
  });

  onSceneRenamed(moveRule);
}
