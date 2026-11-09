// BridgeSketch 3D · 0.6.9: bridge B, a second, independent bridge on the same imported site (twin bridges).
// config.twin = null | { spacing, shift, turn, width, spans: [m…], material, skew, grade, elevation }.
// Bridge A is the main configuration. B copies A once (« Add a parallel bridge »), then keeps its own deck width,
// spans, deck type, skew, grade and profile elevation; every other setting (railings, colours, lanes…) follows A,
// as the panel says. Placement: B's origin sits `shift` m along A and `spacing` m to the right of A's axis
// (looking from A's start to its end), turned `turn` degrees clockwise seen from above.
import { validate } from './geometry.mjs';

const RAD = Math.PI / 180,
  num = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);
export const twinMaterials = ['concrete', 'steel', 'slab', 'box', 'psbox'];

// Sanitized twin, or null. Unknown keys are dropped, numbers clamped; validate() checks B as a whole.
export function cleanTwin(t, c) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const spans = (Array.isArray(t.spans) ? t.spans : c.spans.map(s => s.length))
    .map(v => num(typeof v === 'object' ? v?.length : v, 10, 150, NaN))
    .filter(Number.isFinite)
    .slice(0, 8);
  return {
    spacing: num(t.spacing, -200, 200, c.width + 3),
    shift: num(t.shift, -300, 300, 0),
    turn: num(t.turn, -45, 45, 0),
    width: num(t.width, 4, 40, c.width),
    spans: spans.length ? spans : c.spans.map(s => s.length),
    material: twinMaterials.includes(t.material) ? t.material : c.material,
    skew: num(t.skew, -45, 45, c.skew),
    grade: num(t.grade, -6, 6, c.grade),
    elevation: num(t.elevation, -30, 60, c.elevation),
  };
}

// « Add a parallel bridge from bridge A »: explicit one-time copy, 3 m clear between the decks.
export function newTwin(c) {
  return cleanTwin({ spacing: c.width + 3, shift: 0, turn: 0, width: c.width, spans: c.spans.map(s => s.length),
    material: c.material, skew: c.skew, grade: c.grade, elevation: c.elevation }, c);
}

// Full configuration of bridge B. Throws a readable error (prefixed « Bridge B ») when B is not buildable.
export function twinConfig(c) {
  const t = c.twin;
  if (!t) return null;
  const spans = t.spans.map((length, i) => ({ ...(c.spans[i] ?? c.spans.at(-1)), length }));
  const raw = { ...structuredClone(c), twin: null, name: `${c.name || 'Bridge'} · B`.slice(0, 60), width: t.width, spans,
    material: t.material, skew: t.skew, grade: t.grade, elevation: t.elevation,
    profile: t.grade !== c.grade ? 'constant' : c.profile };
  // B keeps A's lane count only if its deck is as wide; a narrower deck falls back to the automatic lane count.
  if (t.width < c.width) delete raw.laneCount;
  if (t.material === 'box') raw.girders = t.width < 7 ? 1 : 2;
  try {
    return validate(raw);
  } catch (e) {
    throw Error('Bridge B: ' + e.message);
  }
}

// B's local scene frame -> A's scene frame (same convention as THREE rotation.y = -turn).
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
// Placement of B on the packet: origin under (shift, spacing) of A, azimuth turned clockwise, same vertical datum.
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
// Clear distance between two straight parallel decks (negative = they overlap).
export const twinClearance = (c, b) => Math.abs(c.twin.spacing) - c.width / 2 - b.width / 2;
