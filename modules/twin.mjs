// BridgeSketch 3D · several complete, independent bridges in one scene.
// 0.6.9 gave bridge B a handful of its own values and borrowed the rest from bridge A. 0.7.0: B is a full configuration.
// 0.8.0: up to four bridges (A, B, C, D).
//
// config.twin = null | { main, others }
//   main    which bridge the main configuration is ('A' … 'D'): the whole parameters panel, the section, the profile and
//           the exports work on the main configuration. switchTo() makes another bridge the main one.
//   others  the other bridges, 1 to 3: { role, bridge, spacing, shift, turn }
//     bridge  every bridge parameter (all configuration keys except the scene keys below);
//     spacing, shift, turn  where that bridge sits in the frame of the main bridge: its origin `shift` m along the main
//             axis and `spacing` m to the right of it (looking from start to end), turned `turn` degrees clockwise.
// Bridge A always owns the site: its spans define the crossings and, on an imported terrain, the placement of the group.
// 0.7 files hold one twin { role, bridge, spacing, shift, turn } (role = the twin's own role): cleanTwin() reads them.
import { validate, defaults } from './geometry.mjs';

const RAD = Math.PI / 180,
  num = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback),
  angle = a => {
    const r = ((((Number(a) || 0) + 180) % 360) + 360) % 360 - 180;
    return Math.abs(r) < 1e-9 ? 0 : r;
  };
export const ROLES = ['A', 'B', 'C', 'D'];
export const ROLE_COLOURS = { A: '#102d41', B: '#A8480A', C: '#0072B2', D: '#00785A' };
// 0.8.0: bridges can stand far apart on a large imported site.
export const REACH = 2000;
// One scene for every bridge: site, sky, light, weather, rendering and traffic display.
export const SCENE_KEYS = ['version', 'environment', 'terrainMode', 'terrainShape', 'sceneWidth', 'background', 'timeOfDay', 'timeFlow',
  'seed', 'forestDensity', 'groundGrass', 'mist', 'waterStyle', 'skyMode', 'skyModel', 'renderQuality', 'fog', 'weather', 'bloom', 'birds', 'showTraffic', 'movingTraffic',
  'trainStyle', 'twin'];
const pick = (c, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(c, k)).map(k => [k, structuredClone(c[k])]));
export const bridgeKeys = () => Object.keys(defaults).filter(k => !SCENE_KEYS.includes(k));
export const bridgeOf = c => pick(c, bridgeKeys());
const sceneOf = c => pick(c, SCENE_KEYS.filter(k => k !== 'twin'));

// The 0.6.9 twin: own width, spans, deck type, skew, grade and elevation; the rest followed A.
function legacyBridge(t, c) {
  const bridge = { ...bridgeOf(c), name: `${c.name || 'Bridge'} · B`.slice(0, 60) };
  if (Array.isArray(t.spans) && t.spans.length)
    bridge.spans = t.spans.slice(0, 8).map((length, i) => ({ ...(c.spans[i] ?? c.spans.at(-1)), length: num(length, 10, 150, 25) }));
  for (const k of ['width', 'material', 'skew', 'grade', 'elevation']) if (t[k] !== undefined) bridge[k] = t[k];
  if (t.grade !== undefined && t.grade !== c.grade) bridge.profile = 'constant';
  if (bridge.width < c.width) delete bridge.laneCount;
  if (bridge.material === 'box') bridge.girders = bridge.width < 7 ? 1 : 2;
  return bridge;
}

// Sanitized group, or null. Throws a readable error naming the bridge when one is not buildable.
export function cleanTwin(t, c) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  let main, list;
  if (Array.isArray(t.others)) {
    main = ROLES.includes(t.main) ? t.main : 'A';
    list = t.others;
  } else {
    // 0.7: a single twin, `role` = its own role ('A' while bridge B was being edited).
    main = t.role === 'A' ? 'B' : 'A';
    list = [{ ...t, role: t.role === 'A' ? 'A' : 'B' }];
  }
  const used = new Set([main]),
    others = [];
  for (const o of list.slice(0, ROLES.length - 1)) {
    if (!o || typeof o !== 'object') continue;
    const role = ROLES.includes(o.role) && !used.has(o.role) ? o.role : ROLES.find(r => !used.has(r));
    used.add(role);
    const bridge = o.bridge && typeof o.bridge === 'object' ? o.bridge : legacyBridge(o, c);
    let full;
    try {
      full = validate({ ...bridge, ...sceneOf(c), twin: null });
    } catch (e) {
      throw Error(`Bridge ${role}: ${e.message}`);
    }
    others.push({
      role,
      spacing: num(o.spacing, -REACH, REACH, c.width + 3),
      shift: num(o.shift, -REACH, REACH, 0),
      turn: angle(o.turn),
      bridge: bridgeOf(full),
    });
  }
  if (!others.length) return null;
  others.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  // Bridge A owns the site: a group without A (hand-edited file) calls its main bridge A.
  if (main !== 'A' && !others.some(o => o.role === 'A')) main = 'A';
  return { main, others };
}

export const mainRole = c => c.twin?.main ?? 'A';
export const others = c => c.twin?.others ?? [];
// Roles in use, in order (A first).
export const rolesOf = c => [mainRole(c), ...others(c).map(o => o.role)].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b));
// Full configuration of another bridge (the scene keys come from the main configuration).
export function otherConfig(c, role) {
  const o = others(c).find(q => q.role === role);
  return o ? validate({ ...o.bridge, ...sceneOf(c), twin: null }) : null;
}
// Full configuration of any bridge of the group.
export const bridgeConfig = (c, role) => (role === mainRole(c) ? validate({ ...c, twin: null }) : otherConfig(c, role));
// Placement of a bridge in the frame of the main bridge (null for the main bridge itself).
export const placementOf = (c, role) => {
  const o = others(c).find(q => q.role === role);
  return o ? { spacing: o.spacing, shift: o.shift, turn: o.turn } : null;
};

// Bridge frame -> main frame (same convention as THREE rotation.y = -turn).
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
// The main bridge seen from a bridge placed at t.
export function inverseTwin(t) {
  const [shift, spacing] = aToTwin(t, 0, 0);
  return { spacing, shift, turn: angle(-t.turn) };
}
// A placement o (in the main frame) seen from the bridge placed at p.
export function relativeTo(p, o) {
  const [shift, spacing] = aToTwin(p, o.shift, o.spacing);
  return { spacing, shift, turn: angle(o.turn - p.turn) };
}

// The same group seen from another bridge: that bridge becomes the main configuration.
export function switchTo(c, role) {
  const t = c.twin,
    target = t?.others.find(o => o.role === role);
  if (!target) return c;
  const p = placementOf(c, role);
  return validate({
    ...otherConfig(c, role),
    twin: {
      main: role,
      others: [
        { role: t.main, bridge: bridgeOf(c), ...inverseTwin(p) },
        ...t.others.filter(o => o !== target).map(o => ({ ...o, ...relativeTo(p, o) })),
      ],
    },
  });
}
// 0.7 name: with two bridges, the other one.
export const swapTwin = c => (c.twin ? switchTo(c, others(c)[0].role) : c);
// The group with bridge A as the main configuration (placement tools always work in A's frame).
export const pairFromA = c => switchTo(c, 'A');

// Placement of a bridge on an imported terrain, from the placement of the main bridge (same vertical datum).
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
// An imported terrain stores the placement of bridge A. Placement of the main configuration, whichever bridge it is.
export const mainPlacement = (placementA, c) => {
  const a = mainRole(c) === 'A' ? null : placementOf(c, 'A');
  return a ? twinPlacement(placementA, inverseTwin(a)) : placementA;
};

// « Add a bridge »: a copy of the main bridge, 3 m clear beside the outermost bridge on its right. Null when full.
export function addBridge(c) {
  const used = rolesOf(c),
    role = ROLES.find(r => !used.includes(r));
  if (!role) return null;
  // right edge of the group, square to the main axis
  const edge = Math.max(c.width / 2, ...others(c).map(o => o.spacing + (o.bridge.width ?? c.width) / 2));
  const entry = { role, spacing: edge + 3 + c.width / 2, shift: 0, turn: 0, bridge: { ...bridgeOf(c), name: (c.name ? `${c.name} · ${role}` : `Bridge ${role}`).slice(0, 60) } };
  return validate({ ...c, twin: { main: mainRole(c), others: [...others(c), entry] } });
}
// Remove a bridge (never A, which owns the site). Removing the bridge being edited switches to A first.
export function removeBridge(c, role) {
  if (role === 'A' || !rolesOf(c).includes(role)) return c;
  const from = mainRole(c) === role ? pairFromA(c) : c,
    rest = others(from).filter(o => o.role !== role);
  return validate({ ...from, twin: rest.length ? { main: mainRole(from), others: rest } : null });
}
// Copy parameters between bridges: `keys` of bridge `from` become those of bridge `to` (all bridge keys by default).
export function copyBetween(c, from, to, keys = bridgeKeys()) {
  const source = bridgeConfig(c, from);
  if (!source || from === to || !rolesOf(c).includes(to)) return c;
  const values = pick(source, keys.filter(k => bridgeKeys().includes(k) && k !== 'name'));
  if (to === mainRole(c)) return validate({ ...c, ...values });
  return validate({ ...c, twin: { ...c.twin, others: others(c).map(o => (o.role === to ? { ...o, bridge: { ...o.bridge, ...values } } : o)) } });
}
// New placements given in A's frame ({ B: { spacing, shift, turn }, … }), whichever bridge is being edited.
export function placeFromA(c, placements) {
  const a = pairFromA(c),
    next = validate({ ...a, twin: a.twin && { ...a.twin, others: a.twin.others.map(o => ({ ...o, ...(placements[o.role] ?? {}) })) } });
  return switchTo(next, mainRole(c));
}
// Clear distance between two decks, measured square to the first axis at the second one's origin (negative = overlap).
export const clearanceOf = (a, b, p) => Math.abs(p.spacing) - a.width / 2 - b.width / 2;
