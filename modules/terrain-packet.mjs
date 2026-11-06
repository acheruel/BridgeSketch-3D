// BridgeSketch 3D · 0.6.8: `bs3d-terrain` v1 packet from QuickerAtlas (see TERRAIN-PACKET.md). Pure functions, no DOM and no
// three.js, so Node can test them. Packet frame: x east, y north, metres on the ground; z in metres, NaN = no data.
// Scene frame: the bridge midpoint is the origin, the alignment runs along +X and the left-hand normal is +Z (frame()
// in geometry.mjs). A placement maps one onto the other: { cx, cy, azimuth, zOffset } where (cx, cy) is the packet point
// that becomes the bridge midpoint, `azimuth` the compass bearing (degrees clockwise from north) of the bridge direction
// (west abutment -> east abutment is 90), and scene y = packet z + zOffset.
import { frame, profile, totalLength } from './geometry.mjs';

export const PACKET_TYPE = 'bs3d-terrain',
  PACKET_VERSION = 1,
  MAX_CELLS = 1.5e6;

// Origins allowed to send a packet by postMessage (the contract): the published apps and local hosts.
export const ALLOWED_ORIGINS = ['https://acheruel.github.io'];
export function originAllowed(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1';
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* base64 <-> Float32Array (little endian)                                                         */
/* ---------------------------------------------------------------------------------------------- */

const toBase64 = bytes => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = text => {
  if (typeof Buffer !== 'undefined') {
    const b = Buffer.from(text, 'base64');
    return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  const s = atob(text),
    bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
};

// Float32Array -> base64 of its little-endian bytes.
export function encodeGrid(values) {
  const f = values instanceof Float32Array ? values : Float32Array.from(values),
    out = new Uint8Array(f.length * 4),
    view = new DataView(out.buffer);
  for (let i = 0; i < f.length; i++) view.setFloat32(i * 4, f[i], true);
  return toBase64(out);
}

// base64 string, ArrayBuffer, typed array or plain array -> Float32Array.
export function decodeGrid(data) {
  if (data instanceof Float32Array) return data;
  if (Array.isArray(data)) return Float32Array.from(data);
  let bytes;
  if (typeof data === 'string') bytes = fromBase64(data.replace(/^data:[^,]*,/, '').trim());
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else throw Error('Unreadable elevation grid.');
  if (bytes.length % 4) throw Error('The elevation grid is not a whole number of 32-bit floats.');
  const out = new Float32Array(bytes.length / 4),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* Validation                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

const finite = v => typeof v === 'number' && Number.isFinite(v),
  pt = p => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]);

// Checks a packet and returns a normalised copy: grids as Float32Array, optional parts defaulted, malformed zones
// dropped. Throws an Error with a readable message when the packet cannot be used.
export function validatePacket(p) {
  if (!p || typeof p !== 'object') throw Error('This is not a terrain packet.');
  if (p.type !== PACKET_TYPE) throw Error(`Unexpected packet type "${p.type}" (expected ${PACKET_TYPE}).`);
  if (p.version !== PACKET_VERSION) throw Error(`Unsupported terrain packet version ${p.version} (this app reads version 1).`);
  const g = p.grid;
  if (!g || !Number.isInteger(g.cols) || !Number.isInteger(g.rows) || g.cols < 2 || g.rows < 2)
    throw Error('The terrain grid needs at least 2 × 2 cells.');
  if (g.cols * g.rows > MAX_CELLS) throw Error(`The terrain grid is too large (${g.cols} × ${g.rows} > 1.5 million cells).`);
  if (!finite(g.cell) || g.cell <= 0 || g.cell > 100) throw Error('Invalid grid cell size.');
  if (!finite(g.x0) || !finite(g.y0)) throw Error('Invalid grid origin.');
  if (p.mnt == null) throw Error('The packet has no bare-earth grid (mnt).');
  const mnt = decodeGrid(p.mnt);
  if (mnt.length !== g.cols * g.rows) throw Error(`The elevation grid has ${mnt.length} values, ${g.cols * g.rows} expected.`);
  let valid = 0;
  for (let i = 0; i < mnt.length; i++) if (Number.isFinite(mnt[i])) valid++;
  if (valid < 4) throw Error('The elevation grid holds no data.');
  let mns = null;
  if (p.mns != null) {
    mns = decodeGrid(p.mns);
    if (mns.length !== mnt.length) throw Error('The surface grid (mns) does not match the bare-earth grid.');
  }
  if (p.center != null && !(finite(p.center.lat) && finite(p.center.lon))) throw Error('Invalid block centre.');
  let axis = null;
  if (p.bridge?.axis != null) {
    const a = p.bridge.axis;
    if (!Array.isArray(a) || a.length < 2 || !pt(a[0]) || !pt(a[1])) throw Error('Invalid bridge axis.');
    if (Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]) < 1e-6) throw Error('The bridge axis has no length.');
    axis = [
      [a[0][0], a[0][1]],
      [a.at(-1)[0], a.at(-1)[1]],
    ];
  }
  const zones = [];
  for (const z of Array.isArray(p.zones) ? p.zones : []) {
    if (!z || typeof z !== 'object') continue;
    if (z.type === 'river' || z.type === 'water' || z.type === 'forest') {
      if (Array.isArray(z.polygon) && z.polygon.length >= 3 && z.polygon.every(pt))
        zones.push({ type: z.type, source: z.source ?? 'user', polygon: z.polygon.map(q => [q[0], q[1]]) });
    } else if (z.type === 'road') {
      if (Array.isArray(z.line) && z.line.length >= 2 && z.line.every(pt))
        zones.push({
          type: 'road',
          source: z.source ?? 'user',
          line: z.line.map(q => [q[0], q[1]]),
          width: finite(z.width) && z.width > 0 ? Math.min(40, z.width) : 7,
        });
    }
  }
  const image =
    p.image && typeof p.image.dataUrl === 'string' && /^data:image\//.test(p.image.dataUrl)
      ? { dataUrl: p.image.dataUrl, attribution: String(p.image.attribution ?? '') }
      : null;
  return {
    type: PACKET_TYPE,
    version: PACKET_VERSION,
    source: String(p.source ?? ''),
    created: String(p.created ?? ''),
    center: p.center ? { lat: p.center.lat, lon: p.center.lon } : null,
    grid: { cols: g.cols, rows: g.rows, cell: g.cell, x0: g.x0, y0: g.y0 },
    mnt,
    mns,
    image,
    zones,
    bridge: axis ? { axis, structure: p.bridge.structure ?? null } : null,
    attribution: Array.isArray(p.attribution) ? p.attribution.map(String) : [],
  };
}

// Packet with base64 grids, as written in a .bs3dterrain file (tests and the file round trip use it).
export function serializePacket(p) {
  return JSON.stringify({
    ...p,
    mnt: encodeGrid(p.mnt),
    mns: p.mns ? encodeGrid(p.mns) : null,
  });
}

/* ---------------------------------------------------------------------------------------------- */
/* Grid access                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

// Extent of the cell centres: { x0, x1, y0, y1 } (x0 west, y1 north).
export function gridBounds(p) {
  const { cols, rows, cell, x0, y0 } = p.grid;
  return { x0, x1: x0 + (cols - 1) * cell, y0: y0 - (rows - 1) * cell, y1: y0 };
}

// Bilinear sample of a grid at packet point (x, y). NaN corners are skipped (weights renormalised); outside the grid or
// with four NaN corners the result is NaN. `which`: 'mnt' (default) or 'mns'.
export function sampleGrid(p, x, y, which = 'mnt') {
  const { cols, rows, cell, x0, y0 } = p.grid,
    z = which === 'mns' ? p.mns : p.mnt;
  if (!z) return NaN;
  const fx = (x - x0) / cell,
    fy = (y0 - y) / cell;
  if (!(fx >= 0 && fy >= 0 && fx <= cols - 1 && fy <= rows - 1)) return NaN;
  const c = Math.min(cols - 2, Math.floor(fx)),
    r = Math.min(rows - 2, Math.floor(fy)),
    tx = fx - c,
    ty = fy - r,
    i = r * cols + c;
  let sum = 0,
    weight = 0;
  for (const [index, w] of [
    [i, (1 - tx) * (1 - ty)],
    [i + 1, tx * (1 - ty)],
    [i + cols, (1 - tx) * ty],
    [i + cols + 1, tx * ty],
  ]) {
    const v = z[index];
    if (v === v && w > 0) {
      sum += v * w;
      weight += w;
    }
  }
  return weight > 1e-9 ? sum / weight : NaN;
}

/* ---------------------------------------------------------------------------------------------- */
/* Frames                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const RAD = Math.PI / 180;

// Scene (x, z) -> packet (x east, y north).
export function sceneToPacket(pl, x, z) {
  const a = pl.azimuth * RAD,
    dE = Math.sin(a),
    dN = Math.cos(a);
  return [pl.cx + x * dE + z * dN, pl.cy + x * dN - z * dE];
}
// Packet (x east, y north) -> scene (x, z).
export function packetToScene(pl, px, py) {
  const a = pl.azimuth * RAD,
    dE = Math.sin(a),
    dN = Math.cos(a),
    ex = px - pl.cx,
    ey = py - pl.cy;
  return [ex * dE + ey * dN, ex * dN - ey * dE];
}
// Ground height in the scene (m) at scene (x, z), before any corridor carving; NaN where the packet has no data.
export function sceneGround(packet, pl, x, z) {
  const [px, py] = sceneToPacket(pl, x, z);
  return sampleGrid(packet, px, py) + pl.zOffset;
}

/* ---------------------------------------------------------------------------------------------- */
/* Placement                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export function axisPlacement(packet) {
  const a = packet.bridge?.axis;
  if (a) {
    const dx = a[1][0] - a[0][0],
      dy = a[1][1] - a[0][1];
    return { cx: (a[0][0] + a[1][0]) / 2, cy: (a[0][1] + a[1][1]) / 2, azimuth: (((Math.atan2(dx, dy) / RAD) % 360) + 360) % 360 };
  }
  const b = gridBounds(packet);
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, azimuth: 90 };
}

// Vertical offset that makes the road profile meet the ground where the bridge ends: mean of (road surface - ground)
// at both abutments and at the far end of each approach (the fill top is 0.17 m under the profile line).
export function autoZOffset(packet, c, pl) {
  const L = totalLength(c),
    reach = Math.min(c.approach, 30),
    base = { ...pl, zOffset: 0 },
    diffs = [];
  for (const s of [-reach, 0, L, L + reach]) {
    const f = frame(c, s),
      g = sceneGround(packet, base, f.x, f.z);
    if (Number.isFinite(g)) diffs.push(profile(c, s) - 0.17 - g);
  }
  if (diffs.length) return diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const g = sampleGrid(packet, pl.cx, pl.cy);
  return Number.isFinite(g) ? profile(c, L / 2) - 0.17 - g : 0;
}

export function autoPlacement(packet, config) {
  const pl = axisPlacement(packet);
  return { ...pl, zOffset: autoZOffset(packet, config, pl) };
}

// Footprint of the bridge (and, by default, its approaches) in scene frame, as a closed outline: [[x, z], ...].
export function footprint(c, margin = 0, { approaches = true } = {}) {
  const L = totalLength(c),
    reach = (approaches ? c.approach + 18 : 0) + margin,
    half = c.width / 2 + margin,
    out = [];
  const n = 24;
  const at = (s, u) => {
    const f = frame(c, s, u);
    return [f.x, f.z];
  };
  for (let i = 0; i <= n; i++) out.push(at(-reach + ((L + 2 * reach) * i) / n, half));
  for (let i = n; i >= 0; i--) out.push(at(-reach + ((L + 2 * reach) * i) / n, -half));
  return out;
}

export function placementEqual(a, b) {
  return !!a && !!b && ['cx', 'cy', 'azimuth', 'zOffset'].every(k => Math.abs(a[k] - b[k]) < 1e-9);
}
