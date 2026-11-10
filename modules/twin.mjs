// BridgeSketch 3D · twin bridges: two complete, independent bridges in one scene.
// 0.6.9 gave bridge B a handful of its own values and borrowed the rest from bridge A. 0.7.0: B is a full configuration.
// « Add bridge B » copies bridge A once; from then on every parameter of each bridge is its own.
//
// config.twin = null | { spacing, shift, turn, role, bridge }
//   bridge  every bridge parameter of the OTHER bridge (all configuration keys except the scene keys below);
//   role    which bridge the twin is: 'B' (the main configuration is bridge A) or 'A' (the main configuration is
//           bridge B, the one being edited). Bridge A always owns the site: its spans define the crossings and, on an
//           imported terrain, the placement of the pair. swapTwin() exchanges the two, so the whole parameters panel,
//           the section, the profile and the exports work on either bridge without knowing about the other;
//   spacing, shift, turn  where the twin sits in the frame of the main bridge: its origin `shift` m along the main axis
//           and `spacing` m to the right of it (looking from start to end), turned `turn` degrees clockwise from above.
import { validate, defaults } from './geometry.mjs';

const RAD = Math.PI / 180,
  num = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);
// One scene for both bridges: site, sky, light, weather, rendering and traffic display.
export const SCENE_KEYS = ['version', 'environment', 'terrainMode', 'terrainShape', 'sceneWidth', 'background', 'timeOfDay', 'timeFlow',
  'seed', 'waterStyle', 'skyMode', 'skyModel', 'renderQuality', 'fog', 'weather', 'bloom', 'birds', 'showTraffic', 'movingTraffic',
  'trainStyle', 'twin'];
const pick = (c, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(c, k)).map(k => [k, structuredClone(c[k])]));
export const bridgeKeys = () => Object.keys(defaults).filter(k => !SCENE_KEYS.includes(k));
export const bridgeOf = c => pick(c, bridgeKeys());
const sceneOf = c => pick(c, SCENE_KEYS.filter(k => k !== 'twin'));

// Sanitized twin, or null. Throws a readable error naming the bridge when the twin is not buildable.
export function cleanTwin(t, c) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const role = t.role === 'A' ? 'A' : 'B';
  let bridge = t.bridge;
  if (!bridge || typeof bridge !== 'object') {
    // 0.6.9 files: B had its own width, spans, deck type, skew, grade and elevation, and followed A for the rest.
    bridge = { ...bridgeOf(c), name: `${c.name || 'Bridge'} · B`.slice(0, 60) };
    if (Array.isArray(t.spans) && t.spans.length)
      bridge.spans = t.spans.slice(0, 8).map((length, i) => ({ ...(c.spans[i] ?? c.spans.at(-1)), length: num(length, 10, 150, 25) }));
    for (const k of ['width', 'material', 'skew', 'grade', 'elevation']) if (t[k] !== undefined) bridge[k] = t[k];
    if (t.grade !== undefined && t.grade !== c.grade) bridge.profile = 'constant';
    if (bridge.width < c.width) delete bridge.laneCount;
    if (bridge.material === 'box') bridge.girders = bridge.width < 7 ? 1 : 2;
  }
  let full;
  try {
    full = validate({ ...bridge, ...sceneOf(c), twin: null });
  } catch (e) {
    throw Error(`Bridge ${role}: ${e.message}`);
  }
  return {
    spacing: num(t.spacing, -400, 400, c.width + 3),
    shift: num(t.shift, -400, 400, 0),
    turn: num(t.turn, -90, 90, 0),
    role,
    bridge: bridgeOf(full),
  };
}

// « Add bridge B »: an exact copy of the main bridge, 3 m clear on its right.
export function newTwin(c) {
  return { spacing: c.width + 3, shift: 0, turn: 0, role: 'B', bridge: { ...bridgeOf(c), name: `${c.name || 'Bridge'} · B`.slice(0, 60) } };
}

// Full configuration of the twin (the scene keys come from the main configuration).
export function twinConfig(c) {
  if (!c.twin) return null;
  return validate({ ...c.twin.bridge, ...sceneOf(c), twin: null });
}

// The same pair seen from the other bridge: the twin becomes the main configuration, and the other way round.
export function swapTwin(c) {
  const t = c.twin;
  if (!t) return c;
  return validate({ ...twinConfig(c), twin: { ...inverseTwin(t), role: t.role === 'A' ? 'B' : 'A', bridge: bridgeOf(c) } });
}
// The placement of the main bridge seen from the twin (what `twin` becomes after a swap).
export function inverseTwin(t) {
  const [shift, spacing] = aToTwin(t, 0, 0);
  return { spacing, shift, turn: -t.turn || 0 };
}
// Which bridge the main configuration is ('A' without a twin).
export const mainRole = c => (c.twin?.role === 'A' ? 'B' : 'A');

// Twin's local scene frame -> main scene frame (same convention as THREE rotation.y = -turn).
export function twinToA(t, x, z) {
  const q = -t.turn * RAD,
    co = Math.cos(q),
    si = Math.sin(q);
  return [t.shift + x * co + z * si, t.spacing - x * si + z * co];
}
export function aToTwin(t, x, z) {
  const q = -t.turn * RAD,
    co = Math.cos(q),
    si = Math.sin(q),
    dx = x - t.shift,
    dz = z - t.spacing;
  return [dx * co - dz * si, dx * si + dz * co];
}
// Placement of the twin on an imported terrain, from the placement of the main bridge (same vertical datum).
export function twinPlacement(pl, t) {
  const a = pl.azimuth * RAD,
    dE = Math.sin(a),
    dN = Math.cos(a);
  return {
    cx: pl.cx + t.shift * dE + t.spacing * dN,
    cy: pl.cy + t.shift * dN - t.spacing * dE,
    azimuth: (((pl.azimuth + t.turn) % 360) + 360) % 360,
    zOffset: pl.zOffset,
  };
}
// Clear distance between the two decks, measured square to the main axis at the twin's origin (negative = overlap).
export const twinClearance = (c, b) => Math.abs(c.twin.spacing) - c.width / 2 - b.width / 2;
// An imported terrain stores the placement of bridge A. Placement of the main configuration, whichever bridge it is.
export const mainPlacement = (placementA, c) => (c.twin?.role === 'A' ? twinPlacement(placementA, inverseTwin(c.twin)) : placementA);
// The pair with bridge A as the main configuration (placement tools always work in A's frame).
export const pairFromA = c => (c.twin?.role === 'A' ? swapTwin(c) : c);
