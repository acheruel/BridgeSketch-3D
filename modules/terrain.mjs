// BridgeSketch 3D · Site: crossings, terrain, approach fills and slopes, river, vegetation and buildings.
import * as T from 'three';
import { kenneyGeometry, kenneySize, buildingStyles } from './kenney-scene.mjs';
import { makeTrain } from './trains.mjs';
import { alignmentStation, crossAt, frame, girderDepth, profile, totalLength, stations, supportStation, waterGroups } from './geometry.mjs';
import { beam, box, seeded, soffitAt } from './sections.mjs';
import { roadsideGuardrail } from './railings.mjs';
import { positionVehicle, vehicle } from './traffic.mjs';
import { trafficKind } from './vehicles.mjs';
import { tuftGeometry, flowerGeometry, scatterMeadow, grassBudget, grassKinds } from './grass.mjs';
import { addShrubs, addTrees } from './trees.mjs';
import { effectiveQuality, renderSettings } from './quality.mjs';
import { RAIL_BED } from './geometry.mjs';
import { buildRoads, buildSkirt, buildTerrainGeometry, buildWater, demEarth, demFloor, demGround, demKey, demSite, roadDistance, scatterForest } from './dem.mjs';

// 0.6.8: imported terrain (DTM/DSM from QuickerAtlas) as a session overlay. Set by buildBridge from its `dem` option; while
// set, terrainSampler returns the DTM with the bridge corridor carved out, and addEnvironment builds the imported site.
let activeDem = null;
export const setActiveDem = dem => {
  activeDem = dem ?? null;
};
export const getActiveDem = () => activeDem;
// 0.6.9: footprint of bridge B (deck and approaches) in this scene frame: imported roads, trees and grass keep off it.
let twinZone = null;
export const setTwinZone = f => {
  twinZone = f ?? null;
};
// Footing bottom under a support on the imported ground (null on the procedural terrain).
export const supportEarth = (c, station, abutment) => (activeDem ? demEarth(c, activeDem, station, abutment) : null);

export function crossing(c, s, angle, width, elevation, type) {
  const f = frame(c, s),
    a = (angle * Math.PI) / 180,
    dx = f.tx * Math.cos(a) + f.nx * Math.sin(a),
    dz = f.tz * Math.cos(a) + f.nz * Math.sin(a);
  return { x: f.x, z: f.z, dx, dz, nx: -dz, nz: dx, width, elevation, type, yaw: -Math.atan2(dz, dx) };
}

export function coordinates(o, x, z) {
  const dx = x - o.x,
    dz = z - o.z;
  return { along: dx * o.dx + dz * o.dz, across: dx * o.nx + dz * o.nz };
}

export function world(o, along, across, y) {
  return [o.x + o.dx * along + o.nx * across, y, o.z + o.dz * along + o.nz * across];
}

// River centreline offset along its course. With the profile-following terrain the river meanders more widely
// (about ±6 m over a 200 m wavelength), so the channel no longer reads as a straight cut.
export function riverWiggle(t, c) {
  if (c?.terrainShape === 'profile')
    return Math.sin(t * 0.031 + 0.8) * 5.2 + Math.sin(t * 0.083) * 1.3 + Math.sin(t * 0.17) * 0.35;
  return Math.sin(t * 0.045) * 2.4 + Math.sin(t * 0.1) * 0.7;
}

export function obstacleTour(c) {
  const ss = stations(c),
    middle = totalLength(c) / 2;
  const index = c.spans.reduce(
    (best, span, i) =>
      Math.abs((ss[i] + ss[i + 1]) / 2 - middle) < Math.abs((ss[best] + ss[best + 1]) / 2 - middle) ? i : best,
    0,
  );
  const span = c.spans[index],
    station = (ss[index] + ss[index + 1]) / 2,
    bridge = frame(c, station);
  let obstacle = crossing(c, station, span.angle, span.width, span.elevation, span.obstacle);
  if (span.obstacle === 'water') {
    const g = waterGroups(c).find(g => g.startIndex <= index && g.endIndex >= index),
      first = c.spans[g.startIndex],
      last = c.spans[g.endIndex];
    const start = g.start + Math.max(1, (first.length - first.width) / 2),
      end = g.end - Math.max(1, (last.length - last.width) / 2);
    const width =
      g.startIndex === g.endIndex
        ? Math.min(first.width, first.length - 2)
        : (end - start) * Math.sin((g.angle * Math.PI) / 180);
    obstacle = crossing(c, (start + end) / 2, g.angle, width, g.elevation, 'water');
  }
  const atBridge = coordinates(obstacle, bridge.x, bridge.z),
    water = span.obstacle === 'water';
  const across = water
    ? T.MathUtils.clamp(
        atBridge.across - riverWiggle(atBridge.along, c),
        -obstacle.width / 2 + 1.3,
        obstacle.width / 2 - 1.3,
      )
    : span.obstacle === 'road'
      ? obstacle.width / 4
      : obstacle.width >= 7
        ? 1.8
        : 0;
  const underside = soffitAt(c, index, station),
    eye = Math.max(
      0.12,
      Math.min(water ? 1.3 : span.obstacle === 'rail' ? 2.2 : 1.65, (underside - span.elevation) * 0.4),
    );
  const reach = Math.max(
    32,
    c.width / Math.sin((span.angle * Math.PI) / 180) + 16,
    (profile(c, station) - span.elevation) * 1.7,
  );
  return {
    index,
    type: span.obstacle,
    reach,
    pose(distance) {
      const along = atBridge.along + distance;
      return {
        position: world(obstacle, along, across + (water ? riverWiggle(along, c) : 0), span.elevation + eye),
        target: [bridge.x, underside - 0.1, bridge.z],
      };
    },
  };
}

// Crossing roads (0.6.0): 2 % crown each way from the centreline, carriageway 0.5 m above the surrounding ground,
// 1 m gravel shoulders, 3H:1V fore-slopes to shallow drainage ditches (0.3 m deep, 0.8 m flat bottom) and 3H:1V
// back-slopes up to the ground. Levels are relative to the crossing elevation (road crown).
export const ROAD_CROWN = 0.02,
  ROAD_RAISE = 0.5;
export function roadBed(width, d) {
  const w2 = width / 2,
    edge = -ROAD_CROWN * w2,
    ground = -ROAD_RAISE,
    ditch = ground - 0.3,
    top = edge - 0.06,
    d1 = w2 + 1,
    d2 = d1 + (top - ditch) * 3,
    d3 = d2 + 0.8,
    d4 = d3 + 0.9;
  if (d <= w2) return { y: edge - 0.25, reach: d4 };
  if (d <= d1) return { y: edge - 0.02 - 0.04 * (d - w2), reach: d4 };
  if (d <= d2) return { y: top - (d - d1) / 3, reach: d4 };
  if (d <= d3) return { y: ditch, reach: d4 };
  if (d <= d4) return { y: ditch + (d - d3) / 3, reach: d4 };
  return { y: ground, reach: d4 };
}

export function terrainSampler(c) {
  if (activeDem) return demGround(c, activeDem);
  const ss = stations(c),
    obstacles = c.spans.flatMap((s, i) =>
      s.obstacle === 'water' ? [] : [crossing(c, (ss[i] + ss[i + 1]) / 2, s.angle, s.width, s.elevation, s.obstacle)],
    );
  // Open ground (terrain vague): a gently rolling surface at the span elevation, blended into the neighbours.
  const lumpy = (x, z) => 0.18 * Math.sin(x * 0.21 + z * 0.13) * Math.cos(z * 0.17 - x * 0.07) + 0.1 * Math.sin(x * 0.53 - z * 0.41) - 0.28;
  for (const g of waterGroups(c)) {
    const first = c.spans[g.startIndex],
      last = c.spans[g.endIndex],
      start = g.start + Math.max(1, (first.length - first.width) / 2),
      end = g.end - Math.max(1, (last.length - last.width) / 2);
    obstacles.push(
      crossing(
        c,
        (start + end) / 2,
        g.angle,
        g.startIndex === g.endIndex
          ? Math.min(first.width, first.length - 2)
          : (end - start) * Math.sin((g.angle * Math.PI) / 180),
        g.elevation,
        'water',
      ),
    );
  }
  const natural = (x, z) => {
    let y = 0.22 + 0.25 * Math.sin(x * 0.053) * Math.cos(z * 0.072);
    for (const o of obstacles) {
      const p = coordinates(o, x, z),
        distance = Math.abs(p.across - (o.type === 'water' ? riverWiggle(p.along, c) : 0)),
        blend = T.MathUtils.clamp((o.width / 2 + 3 - distance) / 3, 0, 1);
      // Banks rise at least 0.2 m above the water so the extended river surface meets them in a natural shoreline.
      if (o.type === 'water') {
        const lift = T.MathUtils.clamp((o.width / 2 + 7 - distance) / 4, 0, 1);
        y += (Math.max(y, o.elevation + 0.2) - y) * lift;
      }
      if (o.type === 'road') {
        const bed = roadBed(o.width, distance),
          k = T.MathUtils.smoothstep(bed.reach + 6 - distance, 0, 6);
        y = y * (1 - k) + (o.elevation + bed.y) * k;
        continue;
      }
      if (o.type === 'land') {
        const k = T.MathUtils.smoothstep(o.width / 2 + 12 - distance, 0, 12);
        y = y * (1 - k) + (o.elevation + lumpy(x, z) * T.MathUtils.smoothstep(o.width / 2 + 4 - distance, 0, 8)) * k;
        continue;
      }
      y = y * (1 - blend) + (o.elevation - (o.type === 'water' ? 0.65 : 0.12)) * blend;
    }
    return y;
  };
  if (c.terrainShape !== 'profile') return natural;
  // « Terrain follows the road profile »: the ground on both sides of the approaches is at road level (no
  // embankment); a valley is cut under the bridge. Its walls are 2H:1V slopes parallel to each abutment line
  // (support skew, from the seat level at the abutment face) and parallel to each crossing (road, railway, river
  // banks), down to the natural valley floor. Nothing rises above the road or into the structure.
  const L = totalLength(c),
    deepest = c.material === 'slab' ? (c.variableDepth ? c.pierDepth : c.slabDepth) : c.variableDepth ? c.pierDepth : c.depth,
    seatDrop = c.asphalt + c.deck + c.haunch + deepest + 0.45;
  // Smooth 1D value noise (0–1) for irregular banks and valley walls.
  const hash = n => {
      const v = Math.sin(n * 127.1 + c.seed * 3.7) * 43758.5453;
      return v - Math.floor(v);
    },
    noise = t => {
      const i = Math.floor(t),
        f = t - i,
        k = f * f * (3 - 2 * f);
      return hash(i) * (1 - k) + hash(i + 1) * k;
    };
  return (x, z) => {
    const floor = natural(x, z),
      s = alignmentStation(c, x, z),
      f = frame(c, Math.max(0, Math.min(L, s))),
      u = (x - f.x) * f.nx + (z - f.z) * f.nz,
      start = supportStation(c, 0, u) + 0.9,
      end = supportStation(c, L, u) - 0.9;
    // MSE walls retain the approach fill; surrounding ground stays at the valley floor beside them.
    if (c.approachWalls === 'mse' && (s <= start - 0.9 || s >= end + 0.9)) return floor;
    let y = profile(c, s) - 0.25;
    if (s > start - 0.9 && s < end + 0.9) {
      // Valley walls: straight and tidy beside the bridge, gently undulating away from it.
      const away = T.MathUtils.smoothstep(Math.abs(u), c.width / 2 + 4, c.width / 2 + 30),
        wobble = away * 6 * (noise(u * 0.045 + 11) - 0.5),
        inside = Math.max(0, Math.min(s - start + wobble, end - s + wobble));
      y = Math.min(y, Math.min(profile(c, start), profile(c, end)) - seatDrop - inside / 2);
    }
    for (const o of obstacles) {
      const p = coordinates(o, x, z),
        signed = p.across - (o.type === 'water' ? riverWiggle(p.along, c) : 0),
        d = Math.abs(signed);
      if (o.type === 'water') {
        // Meandering banks: the shoreline wanders inside the channel, a low beach, then a berm of varying
        // width and a 2H:1V valley side, each bank on its own rhythm.
        const bank = (signed < 0 ? 0 : 50) + p.along * 0.035,
          shore = o.width / 2 - 4.5 * noise(bank) + 1.2 * noise(bank * 2.7 + 5) - 0.3,
          berm = 3 + 14 * noise((signed < 0 ? 90 : 140) + p.along * 0.016) + 4 * noise(bank * 0.9 + 21),
          out = d - shore;
        if (out > 0) y = Math.min(y, o.elevation + 0.2 + Math.min(out, 4) * 0.08 + Math.max(0, out - berm) / 2);
        else y = Math.min(y, o.elevation - 0.65 + Math.max(0, 1 + out) * 0.85);
        continue;
      }
      if (o.type === 'road') {
        const bed = roadBed(o.width, d);
        y = Math.min(y, o.elevation + bed.y + Math.max(0, d - bed.reach) / 2);
        continue;
      }
      if (o.type === 'land') {
        y = Math.min(y, o.elevation + 0.3 + Math.max(0, d - o.width / 2) / 2);
        continue;
      }
      y = Math.min(y, o.elevation - 0.12 + Math.max(0, d - o.width / 2 - 1.5) / 2);
    }
    return Math.max(floor, y);
  };
}

// Front spill slope: 2H:1V from the abutment face (0.9 m ahead of its support
// line) down to the ground. If the crossing leaves too little room, the toe
// stops short of it and the slope starts lower on the wall, keeping 2H:1V.
export function frontSlopeFit(c, end) {
  if (!c.frontSlope || c.approachWalls === 'mse') return { reach: 0, top: 0 };
  const first = end === 0,
    span = first ? c.spans[0] : c.spans.at(-1),
    toward = first ? 1 : -1,
    ground = terrainSampler(c),
    k = first ? 0 : c.spans.length - 1,
    side = first ? 0.5 : -0.5,
    half = c.width / 2;
  // The slope may start lower on the wall (frontSlopeDrop) to keep clear of the crossing.
  const seat =
    Math.min(...[-half, 0, half].map(u => soffitAt(c, k, supportStation(c, end, u) + side, u))) - 0.225 - (c.frontSlopeDrop ?? 0);
  const room =
    activeDem
      ? span.length * 0.45
      : span.obstacle === 'water'
      ? span.length * 0.4
      : Math.max(1.4, (span.length - span.width / Math.sin((span.angle * Math.PI) / 180)) / 2 - 1);
  const height = d => {
    const f = frame(c, supportStation(c, end, 0) + toward * d, 0);
    return ground(f.x, f.z);
  };
  const excess = d => seat - Math.max(0, d - 0.9) / 2 - height(d);
  if (excess(room) > 0) return { reach: room, top: height(room) + (room - 0.9) / 2 };
  let lo = 0.9,
    hi = room;
  if (excess(lo) <= 0) return { reach: 0.9, top: seat };
  for (let n = 0; n < 30; n++) {
    const mid = (lo + hi) / 2;
    if (excess(mid) > 0) lo = mid;
    else hi = mid;
  }
  return { reach: hi, top: seat };
}

// Shared surfaces drive both the visible fill and scenery exclusion. Every radial
// generator falls one metre for two metres of horizontal run, to actual terrain.
export function approachSurfaces(c, extent = 0) {
  const L = totalLength(c),
    half = c.width / 2 - 0.55,
    ground = terrainSampler(c),
    surfaces = [];
  surfaces.extent = extent;
  surfaces.corners = [];
  surfaces.ranges = [];
  const apex = (station, u) => {
    const s = supportStation(c, station, u),
      f = frame(c, s, u);
    return { f, p: [f.x, profile(c, s) - 0.17 + crossAt(c, u), f.z] };
  };
  const toe = (p, dx, dz) => {
    let lo = 0,
      hi = Math.max(1, 2 * (p[1] - Math.min(-6, ...c.spans.map(s => s.elevation - 1), activeDem ? demFloor(activeDem) - 1 : Infinity)) + 4);
    for (let i = 0; i < 28; i++) {
      const r = (lo + hi) / 2;
      if (p[1] - r / 2 > ground(p[0] + dx * r, p[2] + dz * r)) lo = r;
      else hi = r;
    }
    return [p[0] + dx * hi, p[1] - hi / 2, p[2] + dz * hi];
  };
  for (const [end, toward] of [
    [0, 1],
    [L, -1],
  ]) {
    const f = frame(c, end),
      k = Math.tan((c.skew * Math.PI) / 180);
    const intrusion = p => toward * ((p[0] - f.x) * (f.tx - k * f.nx) + (p[2] - f.z) * (f.tz - k * f.nz));
    const corners = [],
      frontReach = frontSlopeFit(c, end).reach;
    for (const side of [-1, 1]) {
      if (c.approachWalls === 'mse') {
        const corner = { end, side, station: end, ...apex(end, half * side), ring: [] };
        corners.push(corner);
        surfaces.corners.push(corner);
        continue;
      }
      const cone = setback => {
        const station = end - toward * setback,
          { p, f } = apex(station, half * side),
          ring = [];
        for (let i = 0; i <= 24; i++) {
          const angle = (i * Math.PI) / 48;
          ring.push(
            toe(
              p,
              side * f.nx * Math.cos(angle) + toward * f.tx * Math.sin(angle),
              side * f.nz * Math.cos(angle) + toward * f.tz * Math.sin(angle),
            ),
          );
        }
        return { end, side, station, p, ring, intrusion: Math.max(...ring.map(intrusion)) };
      };
      // Move the crest back, never flatten the 2:1 slope: its foremost toe
      // lands on the abutment plane, including skew and curved alignment.
      let lo = 0,
        hi = 8;
      while (cone(hi).intrusion > frontReach && hi < 512) hi *= 2;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (cone(mid).intrusion > frontReach) lo = mid;
        else hi = mid;
      }
      const corner = cone(hi);
      corners.push(corner);
      surfaces.corners.push(corner);
    }
    let outer = end - toward * Math.max(c.approach + 18, ...corners.map(p => Math.abs(p.station - end) + 8));
    if (extent) {
      const target = end === 0 ? -extent / 2 : extent / 2,
        at = frame(c, outer);
      outer += (target - at.x) / Math.max(0.1, at.tx);
      const edgeX = [-c.width / 2, c.width / 2].map(u => frame(c, supportStation(c, outer, u), u).x);
      const shortfall = end === 0 ? Math.max(...edgeX) - target : target - Math.min(...edgeX);
      outer += ((end === 0 ? -1 : 1) * Math.max(0, shortfall + 0.05)) / Math.max(0.1, at.tx);
    }
    const a = Math.min(outer, end),
      b = Math.max(outer, end);
    surfaces.ranges.push([a, b]);
    const local = [];
    for (let s = a; s < b; s += 1) {
      const t = Math.min(b, s + 1);
      const us = [-half, half];
      if (c.crossfall === 'crown' && c.crownOffset > -half && c.crownOffset < half) us.splice(1, 0, c.crownOffset);
      for (let j = 0; j < us.length - 1; j++)
        local.push([apex(s, us[j]).p, apex(s, us[j + 1]).p, apex(t, us[j + 1]).p, apex(t, us[j]).p]);
    }
    for (const corner of c.approachWalls === 'mse' ? [] : corners) {
      const side = corner.side,
        a = Math.min(outer, corner.station),
        b = Math.max(outer, corner.station);
      for (let s = a; s < b; s += 1) {
        const p = apex(s, half * side),
          q = apex(Math.min(b, s + 1), half * side);
        local.push([p.p, q.p, toe(q.p, q.f.nx * side, q.f.nz * side), toe(p.p, p.f.nx * side, p.f.nz * side)]);
      }
      for (let i = 0; i < 24; i++) {
        const cone = [corner.p, corner.ring[i], corner.ring[i + 1]];
        cone.finish = c.approachConeMaterial;
        local.push(cone);
      }
    }
    // Clip numerical/curve overshoot at the same abutment plane.
    for (const face of local) {
      const clipped = [];
      const limit = face.finish ? frontReach : 0;
      for (let i = 0; i < face.length; i++) {
        const p = face[i],
          q = face[(i + 1) % face.length],
          dp = intrusion(p) - limit,
          dq = intrusion(q) - limit;
        if (dp <= 1e-7) clipped.push(p);
        if (dp > 1e-7 !== dq > 1e-7) {
          const t = dp / (dp - dq);
          clipped.push(p.map((v, j) => v + t * (q[j] - v)));
        }
      }
      let bounded = clipped;
      if (extent) {
        const target = end === 0 ? -extent / 2 : extent / 2,
          next = [];
        for (let i = 0; i < bounded.length; i++) {
          const p = bounded[i],
            q = bounded[(i + 1) % bounded.length],
            dp = end === 0 ? target - p[0] : p[0] - target,
            dq = end === 0 ? target - q[0] : q[0] - target;
          if (dp <= 1e-7) next.push(p);
          if (dp > 1e-7 !== dq > 1e-7) {
            const t = dp / (dp - dq);
            next.push(p.map((v, j) => v + t * (q[j] - v)));
          }
        }
        bounded = next;
      }
      if (bounded.length >= 3) {
        bounded.finish = face.finish ?? 'grass';
        surfaces.push(bounded);
      }
    }
  }
  return surfaces;
}

export function roadFootprints(c, fills = approachSurfaces(c), includeBridge = true) {
  const L = totalLength(c),
    polygons = [],
    half = c.width / 2;
  for (const [a, b] of includeBridge ? [...fills.ranges, [0, L]] : fills.ranges) {
    const n = Math.ceil(b - a);
    for (let i = 0; i < n; i++) {
      const s = a + ((b - a) * i) / n,
        t = a + ((b - a) * (i + 1)) / n;
      const p = [
        [s, -half],
        [s, half],
        [t, half],
        [t, -half],
      ].map(([v, u]) => frame(c, supportStation(c, v, u), u));
      polygons.push({
        p,
        minX: Math.min(...p.map(v => v.x)),
        maxX: Math.max(...p.map(v => v.x)),
        minZ: Math.min(...p.map(v => v.z)),
        maxZ: Math.max(...p.map(v => v.z)),
      });
    }
  }
  for (const points of fills) {
    const p = points.map(([x, y, z]) => ({ x, z }));
    polygons.push({
      p,
      minX: Math.min(...p.map(v => v.x)),
      maxX: Math.max(...p.map(v => v.x)),
      minZ: Math.min(...p.map(v => v.z)),
      maxZ: Math.max(...p.map(v => v.z)),
    });
  }
  return polygons;
}

export function intersectsRoad(polygons, x, z, radius = 0) {
  for (const { p, minX, maxX, minZ, maxZ } of polygons) {
    if (x < minX - radius || x > maxX + radius || z < minZ - radius || z > maxZ + radius) continue;
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j],
        b = p[i],
        dx = b.x - a.x,
        dz = b.z - a.z,
        t = T.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      if (Math.hypot(x - a.x - t * dx, z - a.z - t * dz) <= radius + 0.02) return true;
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

// Reserve the whole strip between adjacent road/rail crossings, including
// differently angled crossings and curved bridge alignments.
export function crossingCorridors(c, extent = totalLength(c) + 2 * c.approach + 36, halfZ = c.sceneWidth / 2) {
  const ss = stations(c),
    strips = c.spans.flatMap((span, i) => {
      if (span.obstacle === 'water' || span.obstacle === 'land') return [];
      const o = crossing(c, (ss[i] + ss[i + 1]) / 2, span.angle, span.width, span.elevation, span.obstacle),
        reach = Math.hypot(extent, 2 * halfZ);
      let polygon = [
        [-reach, -1],
        [reach, -1],
        [reach, 1],
        [-reach, 1],
      ].map(([s, side]) => {
        const p = world(o, s, side * (o.width / 2 + 2), 0);
        return { x: p[0], z: p[2] };
      });
      for (const [axis, limit, sign] of [
        ['x', extent / 2, 1],
        ['x', -extent / 2, -1],
        ['z', halfZ, 1],
        ['z', -halfZ, -1],
      ]) {
        const out = [];
        for (let j = 0; j < polygon.length; j++) {
          const a = polygon[j],
            b = polygon[(j + 1) % polygon.length],
            da = sign * (a[axis] - limit),
            db = sign * (b[axis] - limit);
          if (da <= 0) out.push(a);
          if (da <= 0 !== db <= 0) {
            const t = da / (da - db);
            out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
          }
        }
        polygon = out;
      }
      return [polygon];
    }),
    zones = [];
  for (let i = 0; i < strips.length - 1; i++) {
    const points = [...strips[i], ...strips[i + 1]].sort((a, b) => a.x - b.x || a.z - b.z),
      cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x),
      lower = [],
      upper = [];
    for (const p of points) {
      while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
      lower.push(p);
    }
    for (const p of [...points].reverse()) {
      while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
      upper.push(p);
    }
    const p = [...lower.slice(0, -1), ...upper.slice(0, -1)];
    if (p.length < 3) continue;
    zones.push({
      p,
      minX: Math.min(...p.map(v => v.x)),
      maxX: Math.max(...p.map(v => v.x)),
      minZ: Math.min(...p.map(v => v.z)),
      maxZ: Math.max(...p.map(v => v.z)),
    });
  }
  return zones;
}

// Prism along a crossing: section points (across, y above the crossing elevation), extruded over ±halfLength.
const rect4 = (a, b, y) => [
  [a, y + 0.004],
  [b, y + 0.004],
  [b, y - 0.006],
  [a, y - 0.006],
];
function addPrism(parent, mat, o, halfLength, section) {
  const position = [],
    n = section.length,
    at = (t, [a, y]) => world(o, t, a, o.elevation + y);
  const tri = (p, q, r) => position.push(...p, ...q, ...r);
  for (let k = 0; k < n; k++) {
    const a = section[k],
      b = section[(k + 1) % n];
    tri(at(-halfLength, a), at(halfLength, a), at(halfLength, b));
    tri(at(-halfLength, a), at(halfLength, b), at(-halfLength, b));
  }
  for (const t of [-halfLength, halfLength])
    for (let k = 1; k < n - 1; k++) tri(at(t, section[0]), at(t, section[k]), at(t, section[k + 1]));
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  // Face every triangle away from the prism axis (sections may come in either winding).
  const p = g.attributes.position,
    centre = new T.Vector3(),
    v = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
  const axis = world(o, 0, section.reduce((s, q) => s + q[0], 0) / n, o.elevation + section.reduce((s, q) => s + q[1], 0) / n);
  for (let i = 0; i < p.count; i += 3) {
    for (let j = 0; j < 3; j++) v[j].fromBufferAttribute(p, i + j);
    const normal = new T.Vector3().subVectors(v[1], v[0]).cross(new T.Vector3().subVectors(v[2], v[0]));
    centre.copy(v[0]).add(v[1]).add(v[2]).divideScalar(3);
    const along = (centre.x - axis[0]) * o.dx + (centre.z - axis[2]) * o.dz,
      out = new T.Vector3(centre.x - axis[0] - along * o.dx, centre.y - axis[1], centre.z - axis[2] - along * o.dz);
    if (Math.abs(along) > halfLength - 1e-3) out.set(o.dx * Math.sign(along), 0, o.dz * Math.sign(along));
    if (normal.dot(out) < 0) {
      const x = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, ...x);
    }
  }
  const uv = [];
  for (let i = 0; i < p.count; i++) uv.push(p.getX(i) / 4, p.getZ(i) / 4);
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const mesh = new T.Mesh(g, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'Crossing road';
  parent.add(mesh);
  return mesh;
}

// Instanced copies grouped in square tiles (tile metres); each tile gets its own bounding sphere for culling.
// Settings that never move the ground, fills, supports or roads; any other change rescatters the meadow.
const cosmeticKeys = new Set([
  'version', 'name', 'steelColor', 'fasciaColor', 'barrierType', 'leftRailing', 'rightRailing', 'sidewalkRailing',
  'approachBarrier', 'lighting', 'lightSpacing', 'lightColor', 'lightSides', 'showTraffic', 'movingTraffic',
  'waterStyle', 'skyMode', 'renderQuality', 'fog', 'weather', 'background', 'timeOfDay', 'timeFlow', 'trainStyle',
  'centreLine', 'concreteFinish', 'girderScreens', 'skyModel', 'birds',
  // Pier details: the meadow clearance around supports depends only on the support lines.
  'pierType', 'columns', 'columnShape', 'columnDiameter', 'columnThickness', 'columnSpread', 'bentWidth',
  'bentThickness', 'bentEndThickness', 'bentTaperStart', 'hammerheadWidth', 'hammerheadThickness', 'wallThickness',
  'wallEnds', 'hammerheadShape', 'hammerheadCapWidth', 'hammerheadCapDepth', 'hammerheadCapEndDepth', 'portalBatter',
  'portalBeam', 'vAngle', 'vArmThickness', 'vCap', 'hammerheadFlare', 'bloom',
]);
let meadowCache = { key: null, value: null };
const meadowCacheKey = (c, tier) =>
  tier + (activeDem ? demKey(activeDem) : '') + JSON.stringify(Object.entries(c).filter(([k]) => !cosmeticKeys.has(k)));

function instancedTiles(parent, geometry, material, items, tile, transform, colour) {
  const tiles = new Map(),
    meshes = [],
    dummy = new T.Object3D();
  for (const item of items) {
    const key = Math.floor(item.x / tile) + ',' + Math.floor(item.z / tile);
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(item);
  }
  for (const group of tiles.values()) {
    const mesh = new T.InstancedMesh(geometry, material, group.length);
    group.forEach((item, i) => {
      transform(dummy, item);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (colour) mesh.setColorAt(i, colour(item));
    });
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    parent.add(mesh);
    meshes.push(mesh);
  }
  if (!meshes.length) geometry.dispose();
  return meshes;
}

// 0.6.8: the imported site: height-field mesh (draped with the satellite image when the packet has one), soil skirt and
// underside, water zones, road ribbons. Returns the water meshes.
function importedTerrain(c, m, parent, dem, ground, footprints) {
  const built = buildTerrainGeometry(c, dem, ground);
  let material = c.terrainMode === 'snow' ? m.snow : m.grass;
  if (dem.texture) {
    // The image already carries its own light and shade: toned down so the sun does not wash it out.
    material = new T.MeshStandardMaterial({ map: dem.texture, color: '#ffffff', roughness: 1, metalness: 0 });
    material.userData.ownedMaterial = true;
  }
  const terrain = new T.Mesh(built.geometry, material);
  terrain.name = 'Imported terrain';
  terrain.receiveShadow = true;
  terrain.userData.noBatch = true;
  parent.add(terrain);
  const base = built.minY - 2,
    centre = built.corners.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
  m.soil.userData.snow.value = c.terrainMode === 'snow' ? 1 : 0;
  const skirt = new T.Mesh(buildSkirt(built.sides, base, centre), m.soil);
  skirt.name = 'Terrain edge soil';
  skirt.receiveShadow = true;
  skirt.userData.noBatch = true;
  parent.add(skirt);
  const under = new T.BufferGeometry();
  under.setAttribute('position', new T.Float32BufferAttribute(built.corners.flatMap(([x, z]) => [x, base, z]), 3));
  under.setAttribute('uv', new T.Float32BufferAttribute(built.corners.flatMap(([x, z]) => [x / 4, z / 4]), 2));
  under.setIndex([0, 1, 2, 0, 2, 3]);
  under.computeVertexNormals();
  if (under.attributes.normal.getY(0) > 0) {
    under.setIndex([0, 2, 1, 0, 3, 2]);
    under.computeVertexNormals();
  }
  const slab = new T.Mesh(under, m.earth);
  slab.name = 'Terrain underside';
  slab.userData.noBatch = true;
  parent.add(slab);
  const waters = buildWater(c, dem, ground, m.water, parent);
  m.grass.userData.waterLevel.value = waters.length ? Math.min(...waters.map(w => w.userData.level)) : -1e4;
  const road = new T.MeshStandardMaterial({
    color: m.asphalt.color,
    map: m.asphalt.map,
    normalMap: m.asphalt.normalMap,
    roughness: m.asphalt.roughness,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  road.userData.ownedMaterial = true;
  const roads=buildRoads(c, dem, ground, road, parent, (x, z) => intersectsRoad(footprints, x, z, 2) || !!twinZone?.(x, z, 2));
  // 0.6.9: budgeted traffic on the actual imported polylines, never across clipped gaps.
  let count=0;
  for(const mesh of roads) {
    const route=mesh.userData.route,lanes=mesh.userData.lanes;
    if(route.halfLength<10 || route.width/lanes<2.6)continue;
    for(let lane=0;lane<lanes;lane++)for(let s=-route.halfLength+8;s<route.halfLength-8&&count<60;s+=45) {
      const u=-route.width/2+route.width*(lane+.5)/lanes;
      vehicle(parent,m,c,s,u,count%5===0?'van':'sedan',mesh.userData.oneway?mesh.userData.oneway>0:u>=0,route,{speed:30});count++;
    }
  }
  parent.userData.demTriangles = built.triangles;
  return waters;
}

// 0.6.9: approach fills alone, also for bridge B (built without its own site) on a shared imported terrain.
export function addFills(m, parent, fills, ground) {
  for (const finish of ['grass', 'stone', 'concrete']) {
    const fillPos = [];
    for (const p of fills.filter(face => face.finish === finish))
      for (let i = 1; i < p.length - 1; i++) {
        const a = p[0],
          b = p[i],
          d = p[i + 1],
          up = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
        fillPos.push(...a, ...(up >= 0 ? b : d), ...(up >= 0 ? d : b));
      }
    if (fillPos.length) {
      const fillGeometry = new T.BufferGeometry();
      fillGeometry.setAttribute('position', new T.Float32BufferAttribute(fillPos, 3));
      const uv = [];
      for (let i = 0; i < fillPos.length; i += 3) uv.push(fillPos[i] / 2, fillPos[i + 2] / 2);
      fillGeometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      fillGeometry.computeVertexNormals();
      const fill = new T.Mesh(fillGeometry, finish === 'stone' ? m.stone : finish === 'concrete' ? m.concrete : ground);
      fill.name = '2H:1V approach ' + finish;
      fill.receiveShadow = true;
      fill.castShadow = true;
      parent.add(fill);
    }
  }
}

export function addEnvironment(c, m, parent, fills) {
  // 0.6.8: D is the imported terrain, if any. Its scatter box (trees, meadow) is a fixed square round the bridge.
  const D = activeDem,
    // 0.6.9: vegetation covers the actual site; its fixed instance budget still limits rendering cost.
    siteCorners = D ? [[D.packet.grid.x0,D.packet.grid.y0], [D.packet.grid.x0+(D.packet.grid.cols-1)*D.packet.grid.cell,D.packet.grid.y0], [D.packet.grid.x0,D.packet.grid.y0-(D.packet.grid.rows-1)*D.packet.grid.cell], [D.packet.grid.x0+(D.packet.grid.cols-1)*D.packet.grid.cell,D.packet.grid.y0-(D.packet.grid.rows-1)*D.packet.grid.cell]].map(p=>demSite(D).toScene(...p)) : [],
    L = totalLength(c),
    ss = stations(c),
    points = fills.flat(),
    extent = D ? Math.max(30,...siteCorners.map(p=>2*Math.abs(p[0]))) : fills.extent || Math.max(L + 2 * c.approach + 36, ...points.map(p => 2 * Math.abs(p[0]) + 8)),
    halfZ = D ? Math.max(15,...siteCorners.map(p=>Math.abs(p[1]))) : Math.max(c.sceneWidth / 2, ...points.map(p => Math.abs(p[2]) + 8)),
    rng = seeded(c.seed),
    obstacles = [],
    waters = [],
    ground = c.terrainMode === 'snow' ? m.snow : m.grass,
    tier = effectiveQuality(c.renderQuality),
    season = c.terrainMode === 'snow' ? 'snow' : c.terrainMode === 'fall' ? 'fall' : 'summer',
    riverReach = Math.hypot(extent / 2, halfZ) + 8,
    riverSteps = Math.ceil(riverReach);
  addFills(m, parent, fills, ground);
  // 0.6.8: on imported terrain the DTM and its zones replace the crossings, the river and the procedural scenery.
  if (!D)
    c.spans.forEach((s, i) => {
      if (s.obstacle !== 'water')
        obstacles.push(crossing(c, (ss[i] + ss[i + 1]) / 2, s.angle, s.width, s.elevation, s.obstacle));
    });
  const terrainHeight = terrainSampler(c);
  for (const g of D ? [] : waterGroups(c)) {
    const first = c.spans[g.startIndex],
      last = c.spans[g.endIndex];
    const start = g.start + Math.max(1, (first.length - first.width) / 2),
      end = g.end - Math.max(1, (last.length - last.width) / 2);
    const width =
      g.startIndex === g.endIndex
        ? Math.min(first.width, first.length - 2)
        : (end - start) * Math.sin((g.angle * Math.PI) / 180);
    const o = crossing(c, (start + end) / 2, g.angle, width, g.elevation, 'water');
    obstacles.push(o);
    // The surface runs 2.5 m under each bank; the terrain draws the shoreline through the depth test.
    const pos = [],
      indices = [],
      across = 8,
      reach = width / 2 + 2.5;
    for (let j = 0; j <= riverSteps; j++)
      for (let k = 0; k <= across; k++) {
        const along = -riverReach + (j * 2 * riverReach) / riverSteps;
        pos.push(...world(o, along, -reach + (2 * reach * k) / across + riverWiggle(along, c), g.elevation));
      }
    for (let j = 0; j < riverSteps; j++)
      for (let k = 0; k < across; k++) {
        const i0 = j * (across + 1) + k,
          i1 = i0 + across + 1;
        indices.push(i0, i0 + 1, i1, i0 + 1, i1 + 1, i1);
      }
    const clipped = [];
    // Clip the river to the terrain boundary so no floating surface extends beyond the landscape.
    for (let i = 0; i < indices.length; i += 3) {
      let polygon = indices.slice(i, i + 3).map(k => pos.slice(k * 3, k * 3 + 3));
      for (const [axis, limit, sign] of [
        [0, extent / 2, 1],
        [0, -extent / 2, -1],
        [2, halfZ, 1],
        [2, -halfZ, -1],
      ]) {
        const output = [];
        for (let j = 0; j < polygon.length; j++) {
          const a = polygon[j],
            b = polygon[(j + 1) % polygon.length],
            insideA = sign * (a[axis] - limit) <= 0,
            insideB = sign * (b[axis] - limit) <= 0;
          if (insideA) output.push(a);
          if (insideA !== insideB) {
            const t = (limit - a[axis]) / (b[axis] - a[axis]);
            output.push(a.map((v, k) => v + t * (b[k] - v)));
          }
        }
        polygon = output;
      }
      for (let j = 1; j < polygon.length - 1; j++) clipped.push(...polygon[0], ...polygon[j], ...polygon[j + 1]);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(clipped, 3));
    const riverUV = [],
      shore = [],
      depth = [],
      flow = [];
    for (let k = 0; k < clipped.length; k += 3) {
      const p = coordinates(o, clipped[k], clipped[k + 2]);
      riverUV.push(p.along, p.across);
      shore.push((p.across - riverWiggle(p.along, c)) / (width / 2));
      depth.push(Math.max(0, g.elevation - terrainHeight(clipped[k], clipped[k + 2])));
      flow.push(o.dx, o.dz);
    }
    geo.setAttribute('uv', new T.Float32BufferAttribute(riverUV, 2));
    // Signed position across the river (-1 left bank, +1 right bank; beyond ±1 under the banks).
    geo.setAttribute('shore', new T.Float32BufferAttribute(shore, 1));
    // Water depth above the analytic terrain drives the shallow tint and the shoreline foam.
    geo.setAttribute('waterDepth', new T.Float32BufferAttribute(depth, 1));
    geo.setAttribute('flowDirection', new T.Float32BufferAttribute(flow, 2));
    geo.computeVertexNormals();
    const river = new T.Mesh(geo, m.water);
    river.name = 'Flowing river';
    river.receiveShadow = true;
    river.userData.level = g.elevation;
    river.userData.axis = { x: o.x, z: o.z, dx: o.dx, dz: o.dz, half: width / 2 };
    parent.add(river);
    waters.push(river);
  }
  if (D) waters.push(...importedTerrain(c, m, parent, D, terrainHeight, roadFootprints(c, fills)));
  else {
  const terrainGeo = new T.PlaneGeometry(
    extent,
    halfZ * 2,
    Math.min(240, Math.ceil(extent / 1.2)),
    Math.ceil((halfZ * 2) / 1.2),
  );
  terrainGeo.rotateX(-Math.PI / 2);
  const terrainPos = terrainGeo.attributes.position;
  for (let i = 0; i < terrainPos.count; i++) terrainPos.setY(i, terrainHeight(terrainPos.getX(i), terrainPos.getZ(i)));
  terrainGeo.computeVertexNormals();
  const terrain = new T.Mesh(terrainGeo, ground);
  terrain.name = 'Terrain surface';
  terrain.receiveShadow = true;
  parent.add(terrain);
  // Border skirt follows the terrain edge, keeping the diorama watertight visually.
  const base = Math.min(-1.5, ...c.spans.map(s => s.elevation - 1.5));
  // One continuous soil strip per edge, following the terrain line (no stretched grass texture).
  m.soil.userData.snow.value = c.terrainMode === 'snow' ? 1 : 0;
  const skirt = (from, to, outward) => {
    const n = Math.max(2, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 1.2)),
      position = [],
      depth = [];
    for (let i = 0; i < n; i++)
      for (const t of [i / n, (i + 1) / n]) {
        const x = from[0] + (to[0] - from[0]) * t,
          z = from[1] + (to[1] - from[1]) * t,
          y = terrainHeight(x, z);
        position.push(x, y, z, x, base, z);
        depth.push(0, y - base);
      }
    const index = [];
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      index.push(...(outward ? [k, k + 1, k + 2, k + 2, k + 1, k + 3] : [k, k + 2, k + 1, k + 2, k + 3, k + 1]));
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
    g.setAttribute('soilDepth', new T.Float32BufferAttribute(depth, 1));
    g.setIndex(index);
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, m.soil);
    mesh.name = 'Terrain edge soil';
    mesh.receiveShadow = true;
    parent.add(mesh);
  };
  skirt([-extent / 2, halfZ], [extent / 2, halfZ], true);
  skirt([extent / 2, -halfZ], [-extent / 2, -halfZ], true);
  skirt([extent / 2, halfZ], [extent / 2, -halfZ], true);
  skirt([-extent / 2, -halfZ], [-extent / 2, halfZ], true);
  for (const [a, b] of fills.ranges) {
    const start = a < 0,
      target = start ? -extent / 2 : extent / 2,
      points = fills.flatMap(face => face.filter(p => Math.abs(p[0] - target) < 0.002));
    for (const u of [-c.width / 2, c.width / 2]) {
      let station = start ? a : b;
      for (let k = 0; k < 5; k++) {
        const actual = supportStation(c, station, u),
          x = frame(c, actual, u).x,
          delta = 0.01,
          derivative = (frame(c, supportStation(c, station + delta, u), u).x - x) / delta;
        station += (target - x) / Math.max(0.1, derivative);
      }
      const actual = supportStation(c, station, u),
        p = frame(c, actual, u);
      points.push([target, profile(c, actual) - 0.17 + crossAt(c, u), p.z]);
    }
    points.sort((p, q) => p[2] - q[2]);
    const top = [];
    for (const p of points) {
      if (top.length && Math.abs(p[2] - top.at(-1)[2]) < 0.002) {
        if (p[1] > top.at(-1)[1]) top[top.length - 1] = p;
      } else top.push(p);
    }
    const section = top.map(p => [
      [target, p[1], p[2]],
      [target, base, p[2]],
    ]);
    const vertices = [],
      uv = [],
      depth = [];
    for (let j = 0; j < section.length - 1; j++) {
      const [p, q] = section[j],
        [r, t] = section[j + 1],
        face = start ? [p, t, r, p, q, t] : [p, r, t, p, t, q],
        tops = start ? [p, r, r, p, p, r] : [p, r, r, p, r, p];
      for (let k = 0; k < face.length; k++) {
        vertices.push(...face[k]);
        uv.push(face[k][2] / 2, face[k][1] / 2);
        depth.push(tops[k][1] - face[k][1]);
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('soilDepth', new T.Float32BufferAttribute(depth, 1));
    geometry.computeVertexNormals();
    const cap = new T.Mesh(geometry, m.soil);
    cap.name = 'Grass-covered approach cut';
    cap.receiveShadow = true;
    parent.add(cap);
  }
  box(parent, m.earth, 0, base - 0.2, 0, extent, 0.4, halfZ * 2);
  }
  let railIndex = 0;
  // Two or more crossing roads form a divided highway: each carriageway carries one direction (right-hand
  // traffic: the carriageway on the right of the travel direction runs forwards).
  const roads = obstacles.filter(o => o.type === 'road'),
    divided = roads.length >= 2,
    mid = roads.reduce((a, o) => [a[0] + o.x / roads.length, a[1] + o.z / roads.length], [0, 0]);
  for (const o of obstacles.filter(o => o.type === 'road' || o.type === 'rail')) {
    const halfLength = Math.max(
      1,
      Math.min(
        halfZ + 10,
        (extent / 2 - Math.abs(o.x) - (Math.abs(o.nx) * o.width) / 2) / Math.max(0.001, Math.abs(o.dx)),
        (halfZ - Math.abs(o.z) - (Math.abs(o.nz) * o.width) / 2) / Math.max(0.001, Math.abs(o.dz)),
      ),
    );
    o.halfLength = halfLength;
    if (o.type === 'road') {
      const w2 = o.width / 2,
        edge = -ROAD_CROWN * w2,
        crown = u => o.elevation - ROAD_CROWN * Math.abs(u);
      // Crowned carriageway and gravel shoulders, extruded along the crossing.
      addPrism(parent, m.asphalt, o, halfLength, [
        [-w2, edge],
        [0, 0],
        [w2, edge],
        [w2, edge - 0.45],
        [-w2, edge - 0.45],
      ]);
      for (const side of [-1, 1])
        addPrism(parent, m.sand, o, halfLength, [
          [side * w2, edge - 0.015],
          [side * (w2 + 1.05), edge - 0.065],
          [side * (w2 + 1.05), edge - 0.4],
          [side * w2, edge - 0.4],
        ]);
      const forward = divided ? (o.x - mid[0]) * o.nx + (o.z - mid[1]) * o.nz >= 0 : null,
        line = (u, mat, y = 0.013) => addPrism(parent, mat, o, halfLength, rect4(u - 0.05, u + 0.05, crown(u) - o.elevation + y));
      for (const side of [-1, 1]) {
        // Divided highway: yellow line on the left edge of each carriageway, white on the right.
        const left = divided && (forward ? side < 0 : side > 0);
        line(side * (w2 - 0.3), left ? m.yellow : m.white);
      }
      const dashes = mat => {
        for (let t = -halfLength; t < halfLength - 0.5; t += 9) {
          const dash = Math.min(3, halfLength - t);
          box(parent, mat, ...world(o, t + dash / 2, 0, o.elevation + 0.016), dash, 0.02, 0.1, o.yaw);
        }
      };
      if (divided) dashes(m.white);
      else if (c.centreLine === 'double') for (const du of [-0.1, 0.1]) line(du, m.yellow, 0.016);
      else dashes(m.yellow);
      roadsideGuardrail(parent, m, c, -halfLength, halfLength, o.width / 2 + 0.35, o);
      roadsideGuardrail(parent, m, c, -halfLength, halfLength, -o.width / 2 - 0.35, o);
      if (c.showTraffic && o.width >= 6.4)
        for (const t of [-halfLength * 0.6, halfLength * 0.6]) {
          const dir = divided ? forward : t < 0,
            lane = divided ? (t < 0 ? 1 : -1) * (dir ? 1 : -1) : dir ? 1 : -1,
            kind = t < 0 ? 'car' : trafficKind(Math.round(o.x * 7 + c.seed));
          vehicle(parent, m, c, t, (lane * o.width) / 4, kind, dir, o);
        }
    } else {
      box(parent, m.sand, ...world(o, 0, 0, o.elevation - 0.1), 2 * halfLength, 0.2, o.width, o.yaw);
      const tracks = o.width >= 7 ? [-1.8, 1.8] : [0];
      // Crushed-stone ballast bed, 0.5 m above the ground: 1.5H:1V shoulders, sleepers and rails on top.
      const bedTop = RAIL_BED,
        halfTop = Math.abs(tracks[0]) + 1.9,
        bed = [
          [-halfTop - 1.5 * bedTop, 0],
          [-halfTop, bedTop],
          [halfTop, bedTop],
          [halfTop + 1.5 * bedTop, 0],
        ],
        position = [];
      for (const [t0, t1] of [[-halfLength, halfLength]])
        for (let k = 0; k < bed.length - 1; k++) {
          const [a0, y0] = bed[k],
            [a1, y1] = bed[k + 1],
            p = (t, a, y) => world(o, t, a, o.elevation + y);
          position.push(...p(t0, a0, y0), ...p(t1, a0, y0), ...p(t1, a1, y1), ...p(t0, a0, y0), ...p(t1, a1, y1), ...p(t0, a1, y1));
        }
      const bedGeometry = new T.BufferGeometry();
      bedGeometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
      bedGeometry.computeVertexNormals();
      if (bedGeometry.attributes.normal.getY(0) < 0) {
        for (let i = 0; i < position.length; i += 9)
          for (const j of [0, 1, 2]) [position[i + 3 + j], position[i + 6 + j]] = [position[i + 6 + j], position[i + 3 + j]];
        bedGeometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
        bedGeometry.computeVertexNormals();
      }
      const ballast = new T.Mesh(bedGeometry, m.ballast);
      ballast.name = 'Railway ballast';
      ballast.receiveShadow = ballast.castShadow = true;
      parent.add(ballast);
      for (const offset of tracks) {
        for (let t = -halfLength + 0.2; t < halfLength - 0.2; t += 0.7)
          box(parent, m.trunk, ...world(o, t, offset, o.elevation + bedTop + 0.06), 0.22, 0.12, 2.5, o.yaw);
        for (const side of [-0.7175, 0.7175])
          box(parent, m.dark, ...world(o, 0, offset + side, o.elevation + bedTop + 0.16), 2 * halfLength, 0.16, 0.08, o.yaw);
      }
      if (c.showTraffic) {
        let traffic = parent.children.find(child => child.name === 'Traffic');
        if (!traffic) {
          traffic = new T.Group();
          traffic.name = 'Traffic';
          parent.add(traffic);
        }
        const style = c.trainStyle === 'mixed'
            ? ['diesel', 'bullet', 'city'][Math.floor(seeded(c.seed * 31 + railIndex * 7919 + 5)() * 3)]
            : c.trainStyle;
        const carCount = 4 + Math.floor(seeded(c.seed + railIndex * 1009 + 137)() * 9);
        const train = makeTrain(style, carCount, c.seed + railIndex * 17),
          forward = (railIndex + c.seed) % 2 === 0;
        train.userData.route = {
          s: (forward ? -0.33 : 0.33) * halfLength,
          u: tracks.length === 1 ? 0 : forward ? tracks[1] : tracks[0],
          type: 'train',
          forward,
          road: o,
          halfLength: train.userData.length / 2,
          halfWidth: train.userData.width / 2,
          verticalOffset: 0.22 + RAIL_BED,
          speed: 48,
          offscreenGap: 40,
        };
        positionVehicle(train, c);
        traffic.add(train);
      }
      railIndex++;
    }
  }
  const roadZones = roadFootprints(c, fills),
    corridorZones = D ? [] : crossingCorridors(c, extent, halfZ);
  // 0.6.8: imported site: off the water (and its banks), off the imported roads, inside the DTM.
  const site = D ? demSite(D) : null,
    demOccupied = (x, z, margin) =>
      !!site && (site.shore(x, z) > -margin || roadDistance(D, x, z) < margin * 0.4 || !site.inside(x, z, 1));
  const occupied = (x, z, margin = 2) => {
    for (const o of obstacles) {
      const p = coordinates(o, x, z);
      if (Math.abs(p.across - (o.type === 'water' ? riverWiggle(p.along, c) : 0)) < o.width / 2 + margin) return true;
    }
    return intersectsRoad(roadZones, x, z, margin) || demOccupied(x, z, margin) || !!twinZone?.(x, z, margin);
  };
  // Woodland (0.6.2): groves where a low-frequency noise field is high, packed at 3–5 m with a few clearings, and
  // scattered trees elsewhere. Crowns may approach a road or river closer inside a grove (2.2 m per scale unit);
  // shrubs fill the grove floors and edges. Budgets follow the render quality.
  const trees = [],
    shrubs = [],
    treeBudget = { performance: 260, balanced: 380, high: 520 }[tier] ?? 380,
    woodSeed = c.seed * 0.137,
    woodNoise = (x, z) => {
      const n = (a, b) => {
        const v = Math.sin(a * 127.1 + b * 311.7 + woodSeed * 74.7) * 43758.5453;
        return v - Math.floor(v);
      };
      const smooth = (x, z) => {
        const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
        return (n(ix, iz) * (1 - u) + n(ix + 1, iz) * u) * (1 - v) + (n(ix, iz + 1) * (1 - u) + n(ix + 1, iz + 1) * u) * v;
      };
      return smooth(x * 0.022, z * 0.022) * 0.7 + smooth(x * 0.07 + 9, z * 0.07) * 0.3;
    },
    spacingGrid = new Map(),
    tooClose = (x, z, gap) => {
      const i = Math.floor(x / 4), k = Math.floor(z / 4);
      for (let a = i - 2; a <= i + 2; a++)
        for (let b = k - 2; b <= k + 2; b++)
          for (const t of spacingGrid.get(a * 4096 + b) ?? []) if (Math.hypot(t.x - x, t.z - z) < gap) return true;
      return false;
    };
  for (let i = 0; i < treeBudget * 14 && !D && c.environment === 'rural' && trees.length < treeBudget; i++) {
    const x = (rng() - 0.5) * (extent - 8),
      z = (rng() - 0.5) * (2 * halfZ - 8),
      wood = T.MathUtils.smoothstep(woodNoise(x, z), 0.5, 0.66),
      scale = 1.1 + rng() * 1.5,
      radius = scale * (3.5 - 1.3 * wood) + 1;
    if (rng() > 0.1 + 0.9 * wood || tooClose(x, z, 3 + 2 * (1 - wood) + scale * 0.6)) continue;
    if (occupied(x, z, radius) || intersectsRoad(corridorZones, x, z, radius)) continue;
    const t = { x, z, y: terrainHeight(x, z), scale, rotation: rng() * Math.PI, wood };
    trees.push(t);
    const key = Math.floor(x / 4) * 4096 + Math.floor(z / 4);
    if (!spacingGrid.has(key)) spacingGrid.set(key, []);
    spacingGrid.get(key).push(t);
  }
  // 0.6.8: imported forest zones, thinning away from the bridge (twice the usual budget: the zones are real woods).
  if (D) trees.push(...scatterForest(c, D, terrainHeight, rng, { budget: treeBudget * 2, occupied: (x, z, margin) => occupied(x, z, margin) }));
  // Shrubs: under and around the grove trees, 1–2.4 m high, never on roads, banks or supports.
  for (const t of trees) {
    const n = t.wood > 0.4 ? 2 : rng() < 0.35 ? 1 : 0;
    for (let j = 0; j < n && shrubs.length < treeBudget * 1.2; j++) {
      const a = rng() * Math.PI * 2,
        d = 1.5 + rng() * 4.5,
        x = t.x + Math.cos(a) * d,
        z = t.z + Math.sin(a) * d;
      if (Math.abs(x) > extent / 2 - 2 || Math.abs(z) > halfZ - 2 || occupied(x, z, 2.5) || intersectsRoad(corridorZones, x, z, 2.5)) continue;
      shrubs.push({ x, z, y: terrainHeight(x, z), scale: 1 + rng() * 1.4, spread: 1 + rng() * 0.8, rotation: rng() * 6.28, hue: rng() });
    }
  }
  const instanced = (geo, mat, items, transform) => {
    if (!items.length) {
      geo.dispose();
      return;
    }
    const mesh = new T.InstancedMesh(geo, mat, items.length),
      dummy = new T.Object3D();
    items.forEach((item, i) => {
      transform(dummy, item);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const rocks = [];
  for (const o of obstacles.filter(o => o.type === 'water'))
    for (let along = -riverReach; along < riverReach; along += 1.8)
      for (const side of [-1, 1]) {
        const p = world(o, along, riverWiggle(along, c) + side * (o.width / 2 + 1.9 + rng() * 1.3), 0);
        if (Math.abs(p[0]) < extent / 2 - 1 && Math.abs(p[2]) < halfZ - 1)
          rocks.push({ x: p[0], z: p[2], y: terrainHeight(p[0], p[2]), s: 0.2 + rng() * 0.5, r: rng() * 6 });
      }
  instanced(new T.DodecahedronGeometry(1, 0), c.terrainMode === 'snow' ? m.snow : m.bankRock, rocks, (d, r) => {
    d.position.set(r.x, r.y, r.z);
    d.scale.set(r.s, r.s * 0.45, r.s * 0.8);
    d.rotation.set(0.2, r.r, 0.15);
  });
  // EZ-Tree species, instanced (trees.mjs); detail follows the render quality.
  for (const t of trees) t.hue = (rng() - 0.5) * 0.06;
  const forest = addTrees(parent, m, trees, rng, { quality: tier, season, near: renderSettings[tier].treeNear });
  if (forest) parent.userData.treeLod = forest.lod;
  addShrubs(parent, m, shrubs, season);
  // Budgeted meadow (grass.mjs): denser near the bridge and in clumps, never on the submerged banks.
  if (c.terrainMode !== 'snow') {
    const nearWater = (x, z) =>
      demOccupied(x, z, 2.3) ||
      obstacles.some(o => {
        if (o.type !== 'water') return false;
        const p = coordinates(o, x, z);
        return Math.abs(p.across - riverWiggle(p.along, c)) < o.width / 2 + 2.3;
      });
    // Grass continues on open ground and grass slopes; roads, stone/concrete faces and supports stay clear.
    const groundZones = roadFootprints(c, Object.assign(fills.filter(face => face.finish !== 'grass'), { ranges: fills.ranges }), false),
      // Approach triangles with their plan bounding boxes, precomputed once: the meadow samples them many thousand
      // times per rebuild.
      grassTriangles = fills
        .filter(face => face.finish === 'grass')
        .flatMap(face =>
          face.slice(1, -1).map((b, i) => {
            const a = face[0],
              d = face[i + 2];
            return {
              a, b, d,
              area: (b[0] - a[0]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[0] - a[0]),
              x0: Math.min(a[0], b[0], d[0]), x1: Math.max(a[0], b[0], d[0]),
              z0: Math.min(a[2], b[2], d[2]), z1: Math.max(a[2], b[2], d[2]),
            };
          }),
        )
        .filter(t => Math.abs(t.area) >= 1e-8),
      // 0.6.2: a 4 m grid over the triangles' plan bounds, so each lookup tests a few triangles instead of all.
      cell = 4,
      gridX0 = Math.min(0, ...grassTriangles.map(t => t.x0)),
      gridZ0 = Math.min(0, ...grassTriangles.map(t => t.z0)),
      grid = new Map(),
      gridKey = (i, k) => i * 65536 + k;
    for (const t of grassTriangles)
      for (let i = Math.floor((t.x0 - 1e-3 - gridX0) / cell); i <= Math.floor((t.x1 + 1e-3 - gridX0) / cell); i++)
        for (let k = Math.floor((t.z0 - 1e-3 - gridZ0) / cell); k <= Math.floor((t.z1 + 1e-3 - gridZ0) / cell); k++) {
          const key = gridKey(i, k);
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(t);
        }
    const grassHeight = (x, z) => {
        const local = grid.get(gridKey(Math.floor((x - gridX0) / cell), Math.floor((z - gridZ0) / cell)));
        if (local) for (const { a, b, d, area, x0, x1, z0, z1 } of local) {
          if (x < x0 - 1e-6 || x > x1 + 1e-6 || z < z0 - 1e-6 || z > z1 + 1e-6) continue;
          const bx = b[0] - a[0], bz = b[2] - a[2], dx = d[0] - a[0], dz = d[2] - a[2],
            u = ((x - a[0]) * dz - (z - a[2]) * dx) / area,
            v = (bx * (z - a[2]) - bz * (x - a[0])) / area;
          if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6)
            return a[1] + u * (b[1] - a[1]) + v * (d[1] - a[1]) + 0.025;
        }
        return terrainHeight(x, z);
      },
      supportLines = stations(c).slice(1, -1).map(s => {
        const points = [];
        for (let u = -c.width / 2 - 1; u <= c.width / 2 + 1; u += 0.5) points.push(frame(c, supportStation(c, s, u), u));
        const xs = points.map(p => p.x), zs = points.map(p => p.z);
        return { points, x0: Math.min(...xs) - 1.6, x1: Math.max(...xs) + 1.6, z0: Math.min(...zs) - 1.6, z1: Math.max(...zs) + 1.6 };
      }),
      nearSupport = (x, z) =>
        supportLines.some(
          ({ points, x0, x1, z0, z1 }) =>
            x >= x0 && x <= x1 && z >= z0 && z <= z1 && points.some(p => Math.hypot(p.x - x, p.z - z) < 1.6),
        ),
      clearGround = (x, z, margin) => {
        for (const o of obstacles) {
          if (o.type === 'land') continue;
          const p = coordinates(o, x, z);
          if (Math.abs(p.across - (o.type === 'water' ? riverWiggle(p.along, c) : 0)) < o.width / 2 + margin) return true;
        }
        return intersectsRoad(groundZones, x, z, margin) || nearSupport(x, z) || !!twinZone?.(x, z, margin);
      };
    // The scatter (about 40 000 tufts) dominates a rebuild: reuse it while nothing that shapes the ground changes.
    const meadowKey = meadowCacheKey(c, tier);
    if (meadowCache.key !== meadowKey) meadowCache = { key: meadowKey, value: scatterMeadow({
      extent,
      halfZ,
      rng: seeded(c.seed * 7919 + 17), // own stream: a cache hit leaves the scene random sequence unchanged
      seed: c.seed,
      budget: grassBudget[tier] ?? grassBudget.balanced,
      height: grassHeight,
      occupied: (x, z, margin) => clearGround(x, z, margin) || nearWater(x, z) ||
        (site?.grasses.length && !site.inGrass(x,z) && grassHeight(x,z) <= terrainHeight(x,z)+0.01),
      // Wet river banks grow sedges and reeds; 2H:1V slopes and embankments dry bunch grass.
      zone: (x, z) => {
        for (const o of obstacles) {
          if (o.type !== 'water') continue;
          const p = coordinates(o, x, z);
          const d = Math.abs(p.across - riverWiggle(p.along, c)) - o.width / 2,
            h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
          if (d < 5.5 && h - Math.floor(h) < 0.75 - d * 0.08) return 'tall';
        }
        const gx = grassHeight(x + 0.8, z) - grassHeight(x - 0.8, z),
          gz = grassHeight(x, z + 0.8) - grassHeight(x, z - 0.8);
        return Math.hypot(gx, gz) / 1.6 > 0.26 ? 'dry' : 'meadow';
      },
    }) };
    const meadow = meadowCache.value;
    const green = new T.Color(),
      dry = new T.Color('#e8d59a'),
      lawn = new T.Color('#b9d98a'),
      straw = new T.Color('#d9a95a'),
      rust = new T.Color('#b9713c');
    // Meadow tufts in square tiles, so the renderer can frustum-cull what is off screen; one set per species.
    for (const kind of grassKinds) {
      const items = meadow.items.filter(g => g.kind === kind);
      if (!items.length) continue;
      const blades = instancedTiles(parent, tuftGeometry(kind), m.grassBlade, items, 32, (d, g) => {
        d.position.set(g.x, g.y, g.z);
        const lawnScale = c.environment === 'urban' && kind === 'meadow' ? 0.55 : 1;
        d.scale.set(g.s, g.s * lawnScale * (season === 'fall' ? 0.85 : 1), g.s);
        d.rotation.y = g.r;
      }, g => {
        green.setRGB(0.84 + rng() * 0.16, 0.88 + rng() * 0.12, 0.78 + rng() * 0.18).lerp(dry, g.dry * (kind === 'dry' ? 0.25 : 0.4));
        if (c.environment === 'urban') green.lerp(lawn, 0.35);
        if (season === 'fall') green.lerp(g.dry > 0.55 || kind === 'dry' ? rust : straw, 0.5 + 0.3 * g.dry);
        return green;
      });
      for (const grass of blades) {
        grass.name = 'Meadow blades';
        grass.userData.kind = kind;
        grass.castShadow = false;
      }
    }
    const palette = ['#f4f1e6', '#f2cf55', '#b9a3dd', '#e98f7c'].map(color => new T.Color(color));
    const flowers =
      c.environment === 'urban' || season === 'fall'
        ? null
        : instanced(flowerGeometry(), m.grassBlade, meadow.flowers, (d, f) => {
            d.position.set(f.x, f.y, f.z);
            d.scale.setScalar(f.s);
            d.rotation.y = f.r;
          });
    if (flowers) {
      flowers.name = 'Meadow flowers';
      flowers.castShadow = false;
      meadow.flowers.forEach((f, i) => flowers.setColorAt(i, palette[f.kind]));
    }
  }
  if (c.environment === 'urban' && !D) {
    const buildings = Object.fromEntries(buildingStyles.map(name => [name, []]));
    for (let x = -extent / 2 + 14; x < extent / 2 - 9; x += 13)
      for (let z = -halfZ + 12; z < halfZ - 7; z += 15) {
        const name = buildingStyles[Math.floor(rng() * buildingStyles.length)],
          size = kenneySize(name),
          scale = 0.85 + rng() * 0.25,
          radius = (Math.hypot(size[0], size[2]) * scale) / 2 + 1;
        if (!occupied(x, z, radius) && !intersectsRoad(corridorZones, x, z, radius) && rng() > 0.15)
          buildings[name].push({ x, z, y: terrainHeight(x, z), scale });
      }
    for (const name of buildingStyles) {
      const mesh = instanced(
        kenneyGeometry(name),
        name.startsWith('building-type') ? m.suburban : m.commercial,
        buildings[name],
        (d, b) => {
          d.position.set(b.x, b.y, b.z);
          d.scale.setScalar(b.scale);
        },
      );
      if (mesh) mesh.name = `Kenney ${name}`;
    }
  }
  return waters;
}
