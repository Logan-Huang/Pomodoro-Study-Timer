// Scene registry: each theme paints its own landscape under the sky (see themes.js `scene`).
// Every scene compiles into its own small program (see shader.js) so compiles stay fast.
import { COMMON_GLSL } from './common.js';
import alpine from './alpine.js';
import glacier from './glacier.js';
import forest from './forest.js';
import coast from './coast.js';
import desert from './desert.js';
import sakura from './sakura.js';

export const SCENES = [alpine, glacier, forest, coast, desert, sakura];
export const SCENE_KEYS = SCENES.map((s) => s.key);

/** Normalizes a scene key; anything unknown (or 'none') means sky only. */
export function sceneKey(key) {
  return SCENE_KEYS.includes(key) ? key : 'none';
}

/** GLSL for one scene program: helpers + the scene + the sceneColor() entry used by main(). */
export function sceneSource(key) {
  const scene = SCENES.find((s) => s.key === key);
  if (!scene) return 'vec3 sceneColor(vec2 uv, vec3 sky) { return sky; }\n';
  return `${COMMON_GLSL}\n${scene.glsl}\nvec3 sceneColor(vec2 uv, vec3 sky) { return scene_${scene.key}(uv, sky); }\n`;
}
