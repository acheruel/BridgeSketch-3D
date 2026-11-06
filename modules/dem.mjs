// BridgeSketch 3D · 0.6.8: terrain from an imported DTM (bs3d-terrain packet, see terrain-packet.mjs). This module turns
// { packet, placement } into (a) a ground-height function in the scene frame, with the bridge corridor carved out of the
// DTM so the approach fills, road cuts and abutments sit on it, and (b) the meshes: a multi-resolution height field,
// water surfaces from the water zones, road ribbons and forest placement. terrain.mjs wires them into addEnvironment.
import * as T from 'three';
import { crossAt, frame, profile, supportStation, totalLength } from './geometry.mjs';
import { packetToScene, sceneToPacket } from './terrain-packet.mjs';

const RAD = Math.PI / 180,
  clamp = (v, a, b) => (v < a ? a : v > b ? b : v),
  smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

/* ---------------------------------------------------------------------------------------------- */
/* Per-packet data (cached): grid without holes, water rasters                                      */
/* ---------------------------------------------------------------------------------------------- */

const prepared = new WeakMap();
let nextId = 1;

// NaN cells take the mean of their valid neighbours, pass after pass; what is left after 80 passes takes the grid mean.
function fillHoles(z, cols, rows) {
  let missing = [];
  for (let i = 0; i < z.length; i++) if (!Number.isFinite(z[i])) missing.push(i);
  if (!missing.length) return z;
  const out = Float32Array.from(z);
  for (const i of missing) out[i] = NaN;
  for (let pass = 0; pass < 80 && missing.length; pass++) {
    const fill = [],
      rest = [];
    for (const i of missing) {
      const c = i % cols,
        r = (i - c) / cols;
      let sum = 0,
        n = 0;
      if (c > 0 && out[i - 1] === out[i - 1]) (sum += out[i - 1]), n++;
      if (c < cols - 1 && out[i + 1] === out[i + 1]) (sum += out[i + 1]), n++;
      if (r > 0 && out[i - cols] === out[i - cols]) (sum += out[i - cols]), n++;
      if (r < rows - 1 && out[i + cols] === out[i + cols]) (sum += out[i + cols]), n++;
      if (n) fill.push(i, sum / n);
      else rest.push(i);
    }
    for (let k = 0; k < fill.length; k += 2) out[fill[k]] = fill[k + 1];
    missing = rest;
  }
  if (missing.length) {
    let sum = 0,
      n = 0;
    for (let i = 0; i < out.length; i++) if (out[i] === out[i]) (sum += out[i]), n++;
    for (const i of missing) out[i] = n ? sum / n : 0;
  }
  return out;
}

export function prepare(packet) {
  let p = prepared.get(packet);
  if (p) return p;
  const filled = fillHoles(packet.mnt, packet.grid.cols, packet.grid.rows);
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] < lo) lo = filled[i];
    if (filled[i] > hi) hi = filled[i];
  }
  p = { filled, lo, hi, water: new Map(), id: nextId++ };
  prepared.set(packet, p);
  return p;
}

export function demKey(dem) {
  const pl = dem.placement;
  return `${prepare(dem.packet).id}|${pl.cx.toFixed(3)},${pl.cy.toFixed(3)},${pl.azimuth.toFixed(4)},${pl.zOffset.toFixed(3)}`;
}

/* ---------------------------------------------------------------------------------------------- */
/* Water zones: raster of signed distance to the shore (+ inside) and water level                   */
/* ---------------------------------------------------------------------------------------------- */

function insidePolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j],
      b = poly[i];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Distance (in cells) from every cell to the nearest cell flagged in `seed` (chamfer 1 / √2).
function chamfer(seed, nx, ny) {
  const d = new Float32Array(nx * ny).fill(1e9),
    R2 = Math.SQRT2;
  for (let i = 0; i < d.length; i++) if (seed[i]) d[i] = 0;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[k - nx] + 1);
        if (i > 0) v = Math.min(v, d[k - nx - 1] + R2);
        if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + R2);
      }
      d[k] = v;
    }
  for (let j = ny - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let v = d[k];
      if (i < nx - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < ny - 1) {
        v = Math.min(v, d[k + nx] + 1);
        if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + R2);
        if (i > 0) v = Math.min(v, d[k + nx - 1] + R2);
      }
      d[k] = v;
    }
  return d;
}

function waterRaster(packet, zone) {
  const P = prepare(packet);
  let r = P.water.get(zone);
  if (r) return r;
  const g = packet.grid,
    wc = Math.max(2, g.cell),
    xs = zone.polygon.map(p => p[0]),
    ys = zone.polygon.map(p => p[1]),
    margin = 10,
    bx0 = Math.min(...xs) - margin,
    by0 = Math.min(...ys) - margin,
    nx = Math.max(2, Math.ceil((Math.max(...xs) + margin - bx0) / wc)),
    ny = Math.max(2, Math.ceil((Math.max(...ys) + margin - by0) / wc));
  // Scanline fill of the polygon (cell centres).
  const mask = new Uint8Array(nx * ny),
    rowsX = Array.from({ length: ny }, () => []);
  for (let i = 0, j = zone.polygon.length - 1; i < zone.polygon.length; j = i++) {
    const a = zone.polygon[j],
      b = zone.polygon[i];
    if (a[1] === b[1]) continue;
    const lo = Math.max(0, Math.ceil((Math.min(a[1], b[1]) - by0) / wc - 0.5)),
      hi = Math.min(ny - 1, Math.floor((Math.max(a[1], b[1]) - by0) / wc - 0.5));
    for (let row = lo; row <= hi; row++) {
      const y = by0 + (row + 0.5) * wc;
      if (a[1] > y !== b[1] > y) rowsX[row].push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
  }
  for (let row = 0; row < ny; row++) {
    const list = rowsX[row].sort((p, q) => p - q);
    for (let k = 0; k + 1 < list.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((list[k] - bx0) / wc - 0.5)),
        i1 = Math.min(nx - 1, Math.floor((list[k + 1] - bx0) / wc - 0.5));
      for (let i = i0; i <= i1; i++) mask[row * nx + i] = 1;
    }
  }
  const outside = mask.map(v => 1 - v),
    dIn = chamfer(outside, nx, ny),
    dOut = chamfer(mask, nx, ny),
    sd = new Float32Array(nx * ny);
  let maxSd = 1,
    inCells = 0;
  for (let i = 0; i < sd.length; i++) {
    sd[i] = mask[i] ? (dIn[i] - 0.5) * wc : -(dOut[i] - 0.5) * wc;
    if (mask[i]) {
      inCells++;
      if (sd[i] > maxSd) maxSd = sd[i];
    }
  }
  // Level. Lake: flat, at the 3rd percentile of the DTM inside (the water is lower than the banks). River: the lowest DTM
  // within 12 m, blurred, which follows the slope of the channel.
  const at = (px, py) => {
    const c = Math.round((px - g.x0) / g.cell),
      row = Math.round((g.y0 - py) / g.cell);
    return c >= 0 && row >= 0 && c < g.cols && row < g.rows ? packet.mnt[row * g.cols + c] : NaN;
  };
  const samples = [];
  for (let k = 0; k < sd.length; k += 1) {
    if (!mask[k]) continue;
    const i = k % nx,
      row = (k - i) / nx,
      v = at(bx0 + (i + 0.5) * wc, by0 + (row + 0.5) * wc);
    if (Number.isFinite(v)) samples.push(v);
  }
  samples.sort((p, q) => p - q);
  const flat = samples.length ? samples[Math.floor(samples.length * 0.03)] : P.lo;
  const lev = new Float32Array(nx * ny).fill(flat);
  if (zone.type === 'river' && samples.length) {
    const R = Math.max(1, Math.ceil(12 / g.cell));
    for (let k = 0; k < lev.length; k++) {
      if (sd[k] < -9) continue;
      const i = k % nx,
        row = (k - i) / nx,
        c0 = Math.round((bx0 + (i + 0.5) * wc - g.x0) / g.cell),
        r0 = Math.round((g.y0 - (by0 + (row + 0.5) * wc)) / g.cell);
      let low = Infinity;
      for (let r = Math.max(0, r0 - R); r <= Math.min(g.rows - 1, r0 + R); r++)
        for (let c = Math.max(0, c0 - R); c <= Math.min(g.cols - 1, c0 + R); c++) {
          const v = packet.mnt[r * g.cols + c];
          if (v < low) low = v;
        }
      if (low < Infinity) lev[k] = low;
    }
    for (let pass = 0; pass < 3; pass++) {
      const copy = Float32Array.from(lev);
      for (let row = 1; row < ny - 1; row++)
        for (let i = 1; i < nx - 1; i++) {
          const k = row * nx + i;
          if (sd[k] < -9) continue;
          lev[k] = (copy[k] * 2 + copy[k - 1] + copy[k + 1] + copy[k - nx] + copy[k + nx]) / 6;
        }
    }
  }
  // Principal axis of the polygon (packet frame) and flow direction: towards the lower end of the level.
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length,
    my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxx = 0,
    sxy = 0,
    syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ax = Math.cos(ang),
    ay = Math.sin(ang);
  if (zone.type === 'river') {
    // Slope of the level along the axis (least squares over the inside cells).
    let st = 0,
      sl = 0,
      stt = 0,
      stl = 0,
      n = 0;
    for (let k = 0; k < lev.length; k += 3) {
      if (!mask[k]) continue;
      const i = k % nx,
        row = (k - i) / nx,
        t = (bx0 + (i + 0.5) * wc - mx) * ax + (by0 + (row + 0.5) * wc - my) * ay;
      st += t;
      sl += lev[k];
      stt += t * t;
      stl += t * lev[k];
      n++;
    }
    const slope = n > 2 ? (n * stl - st * sl) / Math.max(1e-9, n * stt - st * st) : 0;
    if (slope > 0) (ax = -ax), (ay = -ay);
  }
  r = { zone, wc, bx0, by0, bx1: bx0 + nx * wc, by1: by0 + ny * wc, nx, ny, mask, sd, lev, maxSd, flat, axis: [ax, ay], centre: [mx, my], inCells };
  P.water.set(zone, r);
  return r;
}

const bilinear = (r, arr, px, py) => {
  const fx = clamp((px - r.bx0) / r.wc - 0.5, 0, r.nx - 1.001),
    fy = clamp((py - r.by0) / r.wc - 0.5, 0, r.ny - 1.001),
    i = Math.floor(fx),
    j = Math.floor(fy),
    tx = fx - i,
    ty = fy - j,
    k = j * r.nx + i;
  return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - ty) + (arr[k + r.nx] * (1 - tx) + arr[k + r.nx + 1] * tx) * ty;
};

/* ---------------------------------------------------------------------------------------------- */
/* Site: raw ground in the scene frame (DTM + water beds)                                           */
/* ---------------------------------------------------------------------------------------------- */

const siteCache = new WeakMap();

export function demSite(dem) {
  // Fast path (called per occupancy test): same placement numbers as the cached site.
  let site = siteCache.get(dem);
  const q = dem.placement;
  if (site && site.cx === q.cx && site.cy === q.cy && site.az === q.azimuth && site.zo === q.zOffset) return site;
  const key = demKey(dem);
  if (site?.key === key) return site;
  const { packet, placement: pl } = dem,
    g = packet.grid,
    P = prepare(packet),
    zf = P.filled,
    a = pl.azimuth * RAD,
    dE = Math.sin(a),
    dN = Math.cos(a),
    waters = packet.zones.filter(z => z.type === 'river' || z.type === 'water').map(z => waterRaster(packet, z)),
    forests = packet.zones.filter(z => z.type === 'forest'),
    roads = packet.zones.filter(z => z.type === 'road');
  // Packet-frame height (m), no offset: bilinear on the hole-free grid, clamped at the edge, then water beds.
  const heightAt = (px, py) => {
    const fx = clamp((px - g.x0) / g.cell, 0, g.cols - 1.0001),
      fy = clamp((g.y0 - py) / g.cell, 0, g.rows - 1.0001),
      c = Math.floor(fx),
      r = Math.floor(fy),
      tx = fx - c,
      ty = fy - r,
      i = r * g.cols + c;
    let h = (zf[i] * (1 - tx) + zf[i + 1] * tx) * (1 - ty) + (zf[i + g.cols] * (1 - tx) + zf[i + g.cols + 1] * tx) * ty;
    for (const w of waters) {
      if (px < w.bx0 || px > w.bx1 || py < w.by0 || py > w.by1) continue;
      const sd = bilinear(w, w.sd, px, py);
      if (sd < -8) continue;
      const lev = bilinear(w, w.lev, px, py),
        limit = sd >= 0 ? lev - 0.1 - Math.min(1.3, 0.3 * sd) : lev - 0.1 - sd;
      if (limit < h) h = limit;
    }
    return h;
  };
  const raw = (x, z) => heightAt(pl.cx + x * dE + z * dN, pl.cy + x * dN - z * dE) + pl.zOffset;
  const inside = (x, z, margin = 0) => {
    const px = pl.cx + x * dE + z * dN,
      py = pl.cy + x * dN - z * dE;
    return px >= g.x0 + margin && px <= g.x0 + (g.cols - 1) * g.cell - margin && py <= g.y0 - margin && py >= g.y0 - (g.rows - 1) * g.cell + margin;
  };
  const bbox = poly => {
    const xs = poly.map(p => p[0]),
      ys = poly.map(p => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const forestBoxes = forests.map(z => ({ zone: z, box: bbox(z.polygon) }));
  site = {
    key,
    packet,
    pl,
    raw,
    heightAt,
    inside,
    waters,
    forests: forestBoxes,
    roads,
    lo: P.lo + pl.zOffset,
    hi: P.hi + pl.zOffset,
    // Scene-frame helpers.
    toScene: (px, py) => packetToScene(pl, px, py),
    toPacket: (x, z) => sceneToPacket(pl, x, z),
    // Water depth sample: signed distance to the nearest water shore (+ inside), or -Infinity.
    shore(x, z) {
      const px = pl.cx + x * dE + z * dN,
        py = pl.cy + x * dN - z * dE;
      let best = -Infinity;
      for (const w of waters) {
        if (px < w.bx0 || px > w.bx1 || py < w.by0 || py > w.by1) continue;
        const sd = bilinear(w, w.sd, px, py);
        if (sd > best) best = sd;
      }
      return best;
    },
    inForest(x, z) {
      const px = pl.cx + x * dE + z * dN,
        py = pl.cy + x * dN - z * dE;
      for (const { zone, box } of forestBoxes)
        if (px >= box[0] && px <= box[2] && py >= box[1] && py <= box[3] && insidePolygon(zone.polygon, px, py)) return true;
      return false;
    },
  };
  Object.assign(site, { cx: pl.cx, cy: pl.cy, az: pl.azimuth, zo: pl.zOffset });
  siteCache.set(dem, site);
  return site;
}

/* ---------------------------------------------------------------------------------------------- */
/* Ground with the corridor carved                                                                  */
/* ---------------------------------------------------------------------------------------------- */

// The DTM stays as it is, except where the bridge and its approaches need room: terrain never rises above a level just
// under the fill top (approach roads in cut, with 1H:1V side slopes), and between the abutments it never rises above the
// bridge seat level (valley walls 2H:1V from the abutment faces, narrowing to nothing away from the deck). Where the DTM
// is lower than the road, the usual approach fills and 2H:1V cones land on it. The same shape as the « profile » terrain
// of the procedural scene, but a cap on the real ground instead of a replacement.
const groundCache = new WeakMap();
export function demGround(c, dem) {
  // One sampler per (config object, terrain): terrainSampler(c) is asked for many times while a scene is built.
  const key = demKey(dem),
    hit = groundCache.get(c);
  if (hit?.key === key) return hit.ground;
  const ground = makeGround(c, dem);
  groundCache.set(c, { key, ground });
  return ground;
}
function makeGround(c, dem) {
  const site = demSite(dem),
    raw = site.raw,
    L = totalLength(c),
    half = c.width / 2,
    deepest = c.material === 'slab' ? (c.variableDepth ? c.pierDepth : c.slabDepth) : c.variableDepth ? c.pierDepth : c.depth,
    seatDrop = c.asphalt + c.deck + c.haunch + deepest + 0.45,
    reach = c.approach + 18,
    LAT = 120;
  // Hot path (about 150 000 calls per rebuild): the alignment frames are computed here without allocation, and the support
  // lines (skew, curve) come from a table over u, linear in between.
  const A = frame(c, 0),
    B = frame(c, L),
    D = c.direction,
    R = c.radius,
    U0 = -(half + LAT),
    STEP = 0.5,
    table = [0, L].map(end => Array.from({ length: Math.ceil((2 * (half + LAT)) / STEP) + 2 }, (_, i) => supportStation(c, end, U0 + i * STEP))),
    support = (k, u) => {
      const f = (u - U0) / STEP,
        i = Math.min(table[k].length - 2, Math.max(0, Math.floor(f))),
        t = f - i;
      return table[k][i] + (table[k][i + 1] - table[k][i]) * t;
    };
  return (x, z) => {
    const h = raw(x, z);
    let s, u;
    if (!c.curved) {
      s = x + L / 2;
      u = z;
    } else {
      const before = (x - A.x) * A.tx + (z - A.z) * A.tz,
        after = (x - B.x) * B.tx + (z - B.z) * B.tz;
      s = before < 0 ? before : after > 0 ? L + after : Math.atan2(x, R - D * z) * R + L / 2;
      const t = (clamp(s, 0, L) - L / 2) / R,
        fx = R * Math.sin(t),
        fz = D * R * (1 - Math.cos(t));
      // Normal (-tz, tx) with t = (cos, d sin): n = (-d sin, cos).
      u = (x - fx) * -D * Math.sin(t) + (z - fz) * Math.cos(t);
    }
    const au = Math.abs(u);
    if (au > half + LAT) return h;
    const sup0 = support(0, u),
      supL = support(1, u),
      cu = clamp(u, -half, half),
      lateral = Math.max(0, au - (half + 0.5)),
      top = st => profile(c, st) - 0.32 + crossAt(c, cu);
    const f0 = sup0 + 0.9,
      f1 = supL - 0.9;
    let cap;
    if (s <= f0) {
      const sa = Math.max(s, sup0 - reach);
      cap = top(sa) + 0.5 * (sa - s) + lateral;
    } else if (s >= f1) {
      const sb = Math.min(s, supL + reach);
      cap = top(sb) + 0.5 * (s - sb) + lateral;
    } else {
      const inside = Math.min(s - f0, f1 - s),
        w = 1 - smooth(half + 1.5, half + 5.5 + 2 * seatDrop, au),
        road = top(s);
      cap = road - w * (seatDrop + inside / 2) + (1 - w) * lateral;
    }
    return h < cap ? h : cap;
  };
}

// Lowest ground level in the model area, for bounds that depend on how deep the terrain goes.
export const demFloor = dem => demSite(dem).lo;

// Level of the footing bottom under a support: 0.3 m under the lowest carved ground over `us` across the deck.
export function demEarth(c, dem, station, abutment) {
  const ground = demGround(c, dem),
    half = c.width / 2;
  let low = Infinity;
  // Abutments: just in front of the face (0.9 m from the support line, towards the span); piers: on the support line.
  const offsets = abutment ? [1.1, 1.8] : [0];
  for (const off of offsets)
    for (let n = 0; n <= 8; n++) {
      const u = -half + (c.width * n) / 8,
        toward = station <= 0 ? 1 : -1,
        p = frame(c, supportStation(c, station, u) + toward * off, u),
        v = ground(p.x, p.z);
      if (v < low) low = v;
    }
  return low - 0.3;
}

/* ---------------------------------------------------------------------------------------------- */
/* Terrain mesh                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

const TILE = 64,
  MAX_TRIANGLES = 400000;

// Multi-resolution height field over the whole packet: tiles of 64 cells at 1, 2 or 4 m steps by distance to the
// bridge axis; borders next to a coarser tile follow its edge so the mesh has no cracks.
export function buildTerrainGeometry(c, dem, ground, { maxTriangles = MAX_TRIANGLES } = {}) {
  const site = demSite(dem),
    { packet, pl } = site,
    g = packet.grid,
    nxC = g.cols - 1,
    nyC = g.rows - 1,
    tilesX = Math.ceil(nxC / TILE),
    tilesY = Math.ceil(nyC / TILE),
    L = totalLength(c);
  // Alignment polyline (packet frame) to rate the tiles by distance.
  const line = [],
    reach = c.approach + 40,
    n = Math.max(8, Math.ceil((L + 2 * reach) / 6));
  for (let i = 0; i <= n; i++) {
    const p = frame(c, -reach + ((L + 2 * reach) * i) / n);
    line.push(sceneToPacket(pl, p.x, p.z));
  }
  const kFor = (metres, cell) => Math.max(1, Math.round(metres / cell));
  const plan = scale => {
    const tiles = [];
    let count = 0;
    for (let ty = 0; ty < tilesY; ty++) {
      const row = [];
      for (let tx = 0; tx < tilesX; tx++) {
        const i0 = tx * TILE,
          i1 = Math.min(nxC, i0 + TILE),
          j0 = ty * TILE,
          j1 = Math.min(nyC, j0 + TILE),
          cx = g.x0 + ((i0 + i1) / 2) * g.cell,
          cy = g.y0 - ((j0 + j1) / 2) * g.cell,
          halfDiag = (Math.hypot(i1 - i0, j1 - j0) / 2) * g.cell;
        let d = Infinity;
        for (const p of line) d = Math.min(d, Math.hypot(p[0] - cx, p[1] - cy));
        d -= halfDiag;
        const k = d < 60 * scale ? kFor(1, g.cell) : d < 160 * scale ? kFor(2, g.cell) : kFor(4, g.cell);
        const t = { tx, ty, i0, i1, j0, j1, k };
        row.push(t);
        count += (Math.ceil((i1 - i0) / k) * Math.ceil((j1 - j0) / k)) * 2;
      }
      tiles.push(row);
    }
    return { tiles, count };
  };
  let scale = 1,
    p = plan(scale);
  for (let tries = 0; p.count > maxTriangles && tries < 10; tries++) p = plan((scale *= 0.7));
  const tiles = p.tiles;
  // Height cache over the full grid: shared by the vertices, the stitching and the normals.
  const H = new Float32Array(g.cols * g.rows).fill(NaN);
  const Hc = (i, j) => {
    const k = j * g.cols + i;
    let v = H[k];
    if (v !== v) {
      const [x, z] = packetToScene(pl, g.x0 + i * g.cell, g.y0 - j * g.cell);
      v = H[k] = ground(x, z);
    }
    return v;
  };
  const nodes = (a0, a1, k) => {
    const list = [];
    for (let a = a0; a < a1; a += k) list.push(a);
    list.push(a1);
    return list;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  // Height of node (i, j) of a tile, following the edge of a coarser neighbour.
  const nodeHeight = (t, i, j) => {
    const stitch = (nb, vertical) => {
      const kn = nb.k;
      if (kn <= t.k) return null;
      const a0 = vertical ? t.j0 : t.i0,
        a1 = vertical ? t.j1 : t.i1,
        a = vertical ? j : i,
        lo = a0 + Math.floor((a - a0) / kn) * kn,
        hi = Math.min(lo + kn, a1);
      if (a === lo) return null;
      const h = vertical ? [Hc(i, lo), Hc(i, hi)] : [Hc(lo, j), Hc(hi, j)];
      return lerp(h[0], h[1], (a - lo) / (hi - lo));
    };
    let v = null;
    if (i === t.i0 && t.tx > 0) v = stitch(tiles[t.ty][t.tx - 1], true);
    else if (i === t.i1 && t.tx < tilesX - 1) v = stitch(tiles[t.ty][t.tx + 1], true);
    if (v === null && j === t.j0 && t.ty > 0) v = stitch(tiles[t.ty - 1][t.tx], false);
    else if (v === null && j === t.j1 && t.ty < tilesY - 1) v = stitch(tiles[t.ty + 1][t.tx], false);
    return v === null ? Hc(i, j) : v;
  };
  const a = pl.azimuth * RAD,
    dE = Math.sin(a),
    dN = Math.cos(a);
  const position = [],
    normal = [],
    uv = [],
    index = [],
    border = { north: [], east: [], south: [], west: [] };
  let vertex = 0,
    triangles = 0,
    minY = Infinity;
  const imageU = px => (px - (g.x0 - g.cell / 2)) / (g.cols * g.cell),
    imageV = py => 1 - (g.y0 + g.cell / 2 - py) / (g.rows * g.cell);
  for (const row of tiles)
    for (const t of row) {
      const is = nodes(t.i0, t.i1, t.k),
        js = nodes(t.j0, t.j1, t.k),
        first = vertex;
      for (const j of js)
        for (const i of is) {
          const px = g.x0 + i * g.cell,
            py = g.y0 - j * g.cell,
            [x, z] = packetToScene(pl, px, py),
            y = nodeHeight(t, i, j),
            k = t.k;
          // Normal from the height field: central differences over the tile's own step.
          const ia = Math.max(0, i - k),
            ib = Math.min(g.cols - 1, i + k),
            ja = Math.max(0, j - k),
            jb = Math.min(g.rows - 1, j + k),
            gx = (Hc(ib, j) - Hc(ia, j)) / ((ib - ia) * g.cell),
            gy = -(Hc(i, jb) - Hc(i, ja)) / ((jb - ja) * g.cell),
            nl = Math.hypot(gx, gy, 1);
          position.push(x, y, z);
          // Packet-frame normal (-gx, -gy, 1) -> scene frame.
          normal.push((-gx * dE - gy * dN) / nl, 1 / nl, (-gx * dN + gy * dE) / nl);
          uv.push(imageU(px), imageV(py));
          if (y < minY) minY = y;
        }
      const w = is.length;
      for (let jj = 0; jj < js.length - 1; jj++)
        for (let ii = 0; ii < w - 1; ii++) {
          const v0 = first + jj * w + ii,
            v1 = v0 + 1,
            v2 = v0 + w,
            v3 = v2 + 1;
          // Scene-frame winding: (i, j) -> (i, j+1) -> (i+1, j) faces up (see terrain-packet frames).
          if ((ii + jj) % 2 === 0) index.push(v0, v2, v1, v1, v2, v3);
          else index.push(v0, v2, v3, v0, v3, v1);
          triangles += 2;
        }
      vertex += is.length * js.length;
      const at = (list, ia, ja) => list.push({ i: ia, j: ja, y: 0 });
      if (t.ty === 0) for (const i of is) at(border.north, i, 0);
      if (t.ty === tilesY - 1) for (const i of is) at(border.south, i, t.j1);
      if (t.tx === 0) for (const j of js) at(border.west, 0, j);
      if (t.tx === tilesX - 1) for (const j of js) at(border.east, t.i1, j);
      t.owned = true;
    }
  // Border polylines in scene space (outer edge heights are exact: no coarser neighbour there).
  const ring = list =>
    list.map(({ i, j }) => {
      const [x, z] = packetToScene(pl, g.x0 + i * g.cell, g.y0 - j * g.cell);
      return [x, Hc(i, j), z];
    });
  // North edge west -> east, east edge north -> south, south edge east -> west, west edge south -> north: a loop.
  const sides = [ring(border.north), ring(border.east), ring(border.south).reverse(), ring(border.west).reverse()];
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(vertex > 65535 ? new T.Uint32BufferAttribute(index, 1) : new T.Uint16BufferAttribute(index, 1));
  const corners = [
    [0, 0],
    [nxC, 0],
    [nxC, nyC],
    [0, nyC],
  ].map(([i, j]) => packetToScene(pl, g.x0 + i * g.cell, g.y0 - j * g.cell));
  return { geometry, sides, triangles, minY, corners, scale };
}

// Soil strip along the terrain edge down to `base`, closed loop in the plan order of `sides`.
export function buildSkirt(sides, base, centre) {
  const position = [],
    depth = [],
    index = [];
  let k = 0;
  for (const side of sides) {
    const start = k;
    for (const [x, y, z] of side) {
      position.push(x, y, z, x, base, z);
      depth.push(0, Math.max(0, y - base));
      k += 2;
    }
    for (let i = start; i < k - 2; i += 2) {
      const mx = (position[i * 3] + position[i * 3 + 6]) / 2 - centre[0],
        mz = (position[i * 3 + 2] + position[i * 3 + 8]) / 2 - centre[1],
        // Segment direction -> outward normal test against the radial direction.
        dx = position[i * 3 + 6] - position[i * 3],
        dz = position[i * 3 + 8] - position[i * 3 + 2],
        // Triangle (top0, bottom0, top1): normal = (b - a) x (c - a) = (0,-h,0) x (dx,.,dz) -> (-h*dz, 0, h*dx)
        outward = -dz * mx + dx * mz;
      if (outward >= 0) index.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
      else index.push(i, i + 2, i + 1, i + 2, i + 3, i + 1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('soilDepth', new T.Float32BufferAttribute(depth, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------------------------------------- */
/* Water                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

// One mesh per water zone, at the zone's level raster (flat for lakes, following the channel for rivers).
export function buildWater(c, dem, ground, material, parent) {
  const site = demSite(dem),
    { pl } = site,
    a = pl.azimuth * RAD,
    dE = Math.sin(a),
    dN = Math.cos(a),
    meshes = [];
  for (const w of site.waters) {
    const take = new Int32Array(w.nx * w.ny).fill(-1),
      position = [],
      uv = [],
      shore = [],
      flow = [],
      depth = [],
      index = [];
    // Flow direction in the scene frame (a vector rotates like a point about the origin).
    const fx = w.axis[0] * dE + w.axis[1] * dN,
      fz = w.axis[0] * dN - w.axis[1] * dE,
      river = w.zone.type === 'river';
    for (let j = 0; j < w.ny; j++)
      for (let i = 0; i < w.nx; i++) {
        const k = j * w.nx + i;
        if (w.sd[k] < -1.5) continue;
        const px = w.bx0 + (i + 0.5) * w.wc,
          py = w.by0 + (j + 0.5) * w.wc,
          [x, z] = packetToScene(pl, px, py),
          y = w.lev[k] + pl.zOffset;
        take[k] = position.length / 3;
        position.push(x, y, z);
        const along = x * fx + z * fz,
          across = -x * fz + z * fx;
        uv.push(river ? along : x, river ? across : z);
        shore.push(clamp(1 - Math.max(0, w.sd[k]) / Math.max(4, w.maxSd), 0, 1) * (river ? 1 : 0.4));
        flow.push(fx, fz);
        depth.push(Math.max(0, y - ground(x, z)));
      }
    for (let j = 0; j < w.ny - 1; j++)
      for (let i = 0; i < w.nx - 1; i++) {
        const k = j * w.nx + i,
          q = [take[k], take[k + 1], take[k + w.nx], take[k + w.nx + 1]];
        if (q.some(v => v < 0) || !(w.sd[k] > 0 || w.sd[k + 1] > 0 || w.sd[k + w.nx] > 0 || w.sd[k + w.nx + 1] > 0)) continue;
        // (i, j) -> (i, j+1) -> (i+1, j) faces up (same winding as the terrain).
        index.push(q[0], q[2], q[1], q[1], q[2], q[3]);
      }
    if (!index.length) continue;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(position, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setAttribute('shore', new T.Float32BufferAttribute(shore, 1));
    geo.setAttribute('waterDepth', new T.Float32BufferAttribute(depth, 1));
    geo.setAttribute('flowDirection', new T.Float32BufferAttribute(flow, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, material);
    mesh.name = 'Imported water';
    mesh.receiveShadow = true;
    const [cx, cz] = packetToScene(pl, w.centre[0], w.centre[1]);
    mesh.userData.level = w.flat + pl.zOffset;
    mesh.userData.axis = { x: cx, z: cz, dx: fx, dz: fz, half: Math.max(8, w.maxSd * 2 + 4) };
    parent.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

/* ---------------------------------------------------------------------------------------------- */
/* Roads                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

// Asphalt ribbons draped on the ground, left out where the bridge footprint or water is.
export function buildRoads(c, dem, ground, material, parent, skip) {
  const site = demSite(dem),
    { pl } = site,
    meshes = [];
  for (const road of site.roads) {
    const pts = [];
    // Resample the polyline every 1.5 m in the scene frame.
    const line = road.line.map(([px, py]) => packetToScene(pl, px, py));
    for (let i = 0; i < line.length - 1; i++) {
      const [x0, z0] = line[i],
        [x1, z1] = line[i + 1],
        len = Math.hypot(x1 - x0, z1 - z0),
        n = Math.max(1, Math.ceil(len / 1.5));
      for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
    }
    pts.push(line.at(-1));
    const half = road.width / 2;
    let strip = [];
    const flush = () => {
      if (strip.length >= 2) {
        const position = [],
          uv = [],
          index = [];
        strip.forEach(([x, z, nx, nz], i) => {
          for (const side of [-1, 1]) {
            const px = x + nx * half * side,
              pz = z + nz * half * side;
            position.push(px, ground(px, pz) + 0.1, pz);
            uv.push(px / 6, pz / 6);
          }
          if (i > 0) {
            const b = (i - 1) * 2;
            // Left of travel is the first vertex; keep the face up whatever the heading.
            index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
          }
        });
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.Float32BufferAttribute(position, 3));
        geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
        geo.setIndex(index);
        geo.computeVertexNormals();
        const n = geo.attributes.normal;
        if (n.getY(0) < 0) {
          const flipped = [];
          for (let i = 0; i < index.length; i += 3) flipped.push(index[i], index[i + 2], index[i + 1]);
          geo.setIndex(flipped);
          geo.computeVertexNormals();
        }
        const mesh = new T.Mesh(geo, material);
        mesh.name = 'Imported road';
        mesh.receiveShadow = true;
        mesh.userData.noBatch = true;
        parent.add(mesh);
        meshes.push(mesh);
      }
      strip = [];
    };
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i],
        [ax, az] = pts[Math.max(0, i - 1)],
        [bx, bz] = pts[Math.min(pts.length - 1, i + 1)],
        len = Math.hypot(bx - ax, bz - az) || 1;
      const blocked = skip(x, z) || site.shore(x, z) > -2 || !site.inside(x, z, 1);
      if (blocked) flush();
      else strip.push([x, z, -(bz - az) / len, (bx - ax) / len]);
    }
    flush();
  }
  return meshes;
}

/* ---------------------------------------------------------------------------------------------- */
/* Forest                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const area = poly => {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(s) / 2;
};

// Tree positions inside the forest zones, thinning with the distance from the bridge; sizes follow the canopy height
// (surface model minus ground) when the packet carries one.
export function scatterForest(c, dem, ground, rng, { budget, occupied, near = 150 }) {
  const site = demSite(dem),
    { packet, pl } = site,
    trees = [],
    cells = new Map();
  if (!site.forests.length) return trees;
  const weights = site.forests.map(f => area(f.zone.polygon)),
    total = weights.reduce((a, b) => a + b, 0);
  if (!total) return trees;
  const gap = 4.2;
  const taken = (x, z) => {
    const i = Math.floor(x / gap),
      k = Math.floor(z / gap);
    for (let a = i - 1; a <= i + 1; a++)
      for (let b = k - 1; b <= k + 1; b++) for (const t of cells.get(a * 8192 + b) ?? []) if (Math.hypot(t.x - x, t.z - z) < gap) return true;
    return false;
  };
  for (let n = 0; n < budget * 60 && trees.length < budget; n++) {
    let pick = rng() * total,
      f = 0;
    while (f < weights.length - 1 && pick > weights[f]) pick -= weights[f++];
    const { zone, box } = site.forests[f],
      px = box[0] + rng() * (box[2] - box[0]),
      py = box[1] + rng() * (box[3] - box[1]);
    if (!insidePolygon(zone.polygon, px, py)) continue;
    const [x, z] = packetToScene(pl, px, py);
    if (rng() > Math.exp(-Math.hypot(x, z) / near) || !site.inside(x, z, 2)) continue;
    if (site.shore(x, z) > -3 || taken(x, z) || occupied(x, z, 3)) continue;
    let scale = 1.1 + rng() * 1.5;
    if (packet.mns) {
      const i = Math.round((px - packet.grid.x0) / packet.grid.cell),
        j = Math.round((packet.grid.y0 - py) / packet.grid.cell),
        k = j * packet.grid.cols + i,
        canopy = packet.mns[k] - packet.mnt[k];
      if (Number.isFinite(canopy) && canopy > 2) scale = clamp(canopy / 7.5, 0.8, 3.2);
    }
    const t = { x, z, y: ground(x, z), scale, rotation: rng() * Math.PI, wood: 1 };
    trees.push(t);
    const key = Math.floor(x / gap) * 8192 + Math.floor(z / gap);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  return trees;
}

// Distance from (x, z) to the nearest imported road centre line, or Infinity (scene frame).
export function roadDistance(dem, x, z) {
  const site = demSite(dem);
  if (!site.roads.length) return Infinity;
  // 16 m hash of the segments (each registered in every cell its widened bounding box touches).
  if (!site.roadIndex) {
    const index = new Map();
    for (const road of site.roads) {
      const reach = road.width / 2 + 4;
      for (let i = 0; i < road.line.length - 1; i++) {
        const [ax, ay] = road.line[i],
          [bx, by] = road.line[i + 1],
          seg = { ax, ay, dx: bx - ax, dy: by - ay, reach: road.width / 2 };
        for (let cx = Math.floor((Math.min(ax, bx) - reach) / 16); cx <= Math.floor((Math.max(ax, bx) + reach) / 16); cx++)
          for (let cy = Math.floor((Math.min(ay, by) - reach) / 16); cy <= Math.floor((Math.max(ay, by) + reach) / 16); cy++) {
            const key = cx * 65536 + cy;
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(seg);
          }
      }
    }
    site.roadIndex = index;
  }
  const [px, py] = sceneToPacket(site.pl, x, z);
  let best = Infinity;
  for (const { ax, ay, dx, dy, reach } of site.roadIndex.get(Math.floor(px / 16) * 65536 + Math.floor(py / 16)) ?? []) {
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1),
      d = Math.hypot(px - ax - t * dx, py - ay - t * dy) - reach;
    if (d < best) best = d;
  }
  return best;
}
