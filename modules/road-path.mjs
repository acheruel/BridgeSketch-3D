// BridgeSketch 3D · roads of an imported site: pure geometry (no three.js, no DOM), tested by Node.
// 0.6.9: distance along a draped polyline, shared by road markings and vehicles.
// 0.7.1: roads take priority over the imported ground. Each road has its own smoothed longitudinal profile, slightly
// raised; the terrain is benched under it (cut only) and shoulders reach the ground where the road stands above it.
// A road that passes the end of a bridge approach continues that approach (approachLink): same width, markings, traffic.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  smooth = t => {
    const k = clamp(t, 0, 1);
    return k * k * (3 - 2 * k);
  };

export const ROAD_RAISE = 0.12, // road surface above its smoothed ground line
  BENCH_DROP = 0.14, // the benched terrain stays this far under the road surface
  BENCH_MARGIN = 2, // flat bench beyond the pavement edge
  BENCH_BLEND = 5; // then back to the natural ground over this distance

// Points every `step` m along a polyline (both ends kept), with the distance from the start.
export function resample(line, step = 2) {
  const pts = [],
    dist = [];
  let run = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, y0] = line[i],
      [x1, y1] = line[i + 1],
      len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      pts.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
      dist.push(run + (len * k) / n);
    }
    run += len;
  }
  if (line.length) {
    pts.push([line.at(-1)[0], line.at(-1)[1]]);
    dist.push(run);
  }
  return { pts, dist, length: run };
}

// Longitudinal profile of a road: the ground under its centre line, smoothed over about ±10 m (three passes of a ±4 m
// moving average at a 2 m step) and raised by ROAD_RAISE. heightAt(x, y) is the bare ground.
export function roadProfile(line, heightAt, { step = 2, raise = ROAD_RAISE, passes = 3, reach = 2 } = {}) {
  const r = resample(line, step),
    n = r.pts.length;
  let lev = r.pts.map(([x, y]) => heightAt(x, y));
  for (let p = 0; p < passes; p++) {
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0,
        count = 0;
      for (let k = Math.max(0, i - reach); k <= Math.min(n - 1, i + reach); k++) {
        if (Number.isFinite(lev[k])) {
          sum += lev[k];
          count++;
        }
      }
      next[i] = count ? sum / count : lev[i];
    }
    lev = next;
  }
  return { pts: r.pts, dist: r.dist, length: r.length, lev: lev.map(v => v + raise) };
}

// Spatial index over road strips: strips = [{ pts: [[x, y]], lev: [level], half }]. Returns
//   nearest(x, y) -> { d, lev, half, strip, t } for the closest centre line within reach, or null;
//   bench(x, y, h) -> the ground height with every road bench cut in (never above h).
export function roadIndex(strips, { cell = 16, margin = BENCH_MARGIN, blend = BENCH_BLEND, drop = BENCH_DROP } = {}) {
  const grid = new Map(),
    key = (i, j) => i * 73856093 + j * 19349663;
  strips.forEach((strip, index) => {
    const reach = strip.half + margin + blend;
    for (let i = 0; i < strip.pts.length - 1; i++) {
      const [ax, ay] = strip.pts[i],
        [bx, by] = strip.pts[i + 1],
        seg = { ax, ay, dx: bx - ax, dy: by - ay, l0: strip.lev[i], l1: strip.lev[i + 1], half: strip.half, index, i };
      for (let cx = Math.floor((Math.min(ax, bx) - reach) / cell); cx <= Math.floor((Math.max(ax, bx) + reach) / cell); cx++)
        for (let cy = Math.floor((Math.min(ay, by) - reach) / cell); cy <= Math.floor((Math.max(ay, by) + reach) / cell); cy++) {
          const k = key(cx, cy);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(seg);
        }
    }
  });
  const near = (x, y) => grid.get(key(Math.floor(x / cell), Math.floor(y / cell)));
  return {
    empty: !grid.size,
    nearest(x, y) {
      const list = near(x, y);
      if (!list) return null;
      let best = null;
      for (const s of list) {
        const t = clamp(((x - s.ax) * s.dx + (y - s.ay) * s.dy) / (s.dx * s.dx + s.dy * s.dy || 1), 0, 1),
          d = Math.hypot(x - s.ax - t * s.dx, y - s.ay - t * s.dy);
        if (!best || d - s.half < best.d - best.half) best = { d, lev: s.l0 + (s.l1 - s.l0) * t, half: s.half, strip: s.index, t: s.i + t };
      }
      return best;
    },
    bench(x, y, h) {
      const list = near(x, y);
      if (!list) return h;
      for (const s of list) {
        const t = clamp(((x - s.ax) * s.dx + (y - s.ay) * s.dy) / (s.dx * s.dx + s.dy * s.dy || 1), 0, 1),
          e = Math.hypot(x - s.ax - t * s.dx, y - s.ay - t * s.dy) - s.half - margin;
        if (e >= blend) continue;
        const floor = s.l0 + (s.l1 - s.l0) * t - drop,
          target = e <= 0 ? floor : floor + (h - floor) * smooth(e / blend);
        if (target < h) h = target;
      }
      return h;
    },
  };
}

// A driveable path: pts = [[x, z]], lev = surface level at each point. sample(s, u) with s measured from the middle of
// the path (as the 0.6.9 routes) and u to the left of the direction of travel... the lateral axis is (-tz, tx).
export function roadPath(points, width, ground, levels = null) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths.at(-1) + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const length = lengths.at(-1);
  return {
    width,
    length,
    halfLength: length / 2,
    sample(s, u = 0) {
      const d = Math.max(0, Math.min(length, s + length / 2));
      let i = 1;
      while (i < lengths.length - 1 && lengths[i] < d) i++;
      const a = points[i - 1],
        b = points[i],
        seg = lengths[i] - lengths[i - 1] || 1,
        t = (d - lengths[i - 1]) / seg,
        tx = (b[0] - a[0]) / seg,
        tz = (b[1] - a[1]) / seg,
        x = a[0] + (b[0] - a[0]) * t - tz * u,
        z = a[1] + (b[1] - a[1]) * t + tx * u;
      return { x, z, tx, tz, y: levels ? levels[i - 1] + (levels[i] - levels[i - 1]) * t : ground(x, z) + 0.1 };
    },
  };
}

// Lanes of a road zone: explicit, or from the width (two lanes from 6 m).
export const roadLanes = road => road.lanes ?? (road.width >= 6 ? 2 : 1);

// Continuation of a bridge approach along a drawn road.
//   end:  { x, z, tx, tz } end of the approach pavement on the alignment, t pointing away from the bridge;
//   line: the road polyline in the same plane frame as `end`;
//   level(d): approach level extended at the end grade, d metres past the end; roadLevel(i): level of line point i.
// The road must pass within `reach` of the end and run within `angle` degrees of the bridge direction. The path leaves
// the approach on the bridge tangent and joins the road over a blend length; it follows the road to its far end.
// Returns { pts: [[x, z]], lev: [], dist: [], length, blend, from } or null.
export function approachLink(end, line, { reach = 14, angle = 40, step = 2 } = {}) {
  if (line.length < 2) return null;
  // nearest point of the road to the approach end
  let best = null;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i],
      [bx, bz] = line[i + 1],
      dx = bx - ax,
      dz = bz - az,
      l2 = dx * dx + dz * dz;
    if (l2 < 1e-9) continue;
    const t = clamp(((end.x - ax) * dx + (end.z - az) * dz) / l2, 0, 1),
      px = ax + t * dx,
      pz = az + t * dz,
      d = Math.hypot(end.x - px, end.z - pz);
    if (!best || d < best.d) best = { d, i, t, px, pz, dx: dx / Math.sqrt(l2), dz: dz / Math.sqrt(l2) };
  }
  if (!best || best.d > reach) return null;
  const along = best.dx * end.tx + best.dz * end.tz;
  if (Math.abs(along) < Math.cos((angle * Math.PI) / 180)) return null;
  // the part of the road that leaves the bridge, starting at the nearest point
  const forward = along > 0,
    rest = forward ? [[best.px, best.pz], ...line.slice(best.i + 1)] : [[best.px, best.pz], ...line.slice(0, best.i + 1).reverse()],
    road = resample(rest, step);
  if (road.length < 12) return null;
  const turn = Math.acos(clamp(Math.abs(along), -1, 1)),
    blend = Math.min(road.length, clamp(4 * best.d + 60 * turn, 24, 80)),
    pts = [],
    dist = [];
  let run = 0;
  road.pts.forEach(([qx, qz], k) => {
    const d = road.dist[k],
      w = smooth(d / blend),
      x = end.x + end.tx * d + (qx - end.x - end.tx * d) * w,
      z = end.z + end.tz * d + (qz - end.z - end.tz * d) * w;
    if (k) run += Math.hypot(x - pts.at(-1)[0], z - pts.at(-1)[1]);
    pts.push([x, z]);
    dist.push(run);
  });
  return { pts, dist, length: run, blend, roadDist: road.dist, roadPts: road.pts, from: { index: best.i, t: best.t, forward } };
}
export const linkBlend = smooth;
