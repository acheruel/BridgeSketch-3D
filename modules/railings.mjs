// BridgeSketch 3D · Bridge railings on curbs or sidewalks and roadside W-beam guardrails.
import * as T from 'three';
import { crossAt, frame, profile, supportStation } from './geometry.mjs';
import { box, chamferSection, rect, sweep } from './sections.mjs';

// Post stations on a fixed grid (every `spacing` m from `origin`), so posts keep their spacing across span joints
// and on the approaches; end posts are added only where the railing run really stops.
export function postStations(a, b, spacing, run = {}) {
  const origin = run.origin ?? a,
    posts = [];
  for (let q = origin + Math.ceil((a - origin) / spacing - 1e-6) * spacing; q <= b + 1e-6; q += spacing) posts.push(q);
  if (run.capStart ?? true) {
    while (posts.length && posts[0] - a < 0.4) posts.shift();
    posts.unshift(a);
  }
  if (run.capEnd ?? true) {
    while (posts.length && b - posts.at(-1) < 0.4) posts.pop();
    posts.push(b);
  }
  return posts;
}

// Rectangular member from a to b whose width axis follows the road tangent (t): posts that lean across the deck.
function strut(parent, mat, a, b, t, w, d) {
  const start = new T.Vector3(...a),
    y = new T.Vector3(...b).sub(start),
    length = y.length();
  y.normalize();
  const x = new T.Vector3(t[0], 0, t[1]).addScaledVector(y, -(t[0] * y.x + t[1] * y.z)).normalize(),
    z = new T.Vector3().crossVectors(x, y);
  const mesh = new T.Mesh(new T.BoxGeometry(w, length, d), mat);
  mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
  mesh.position.copy(start).addScaledVector(y, length / 2);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
// 0.6.8: every railing member carries a name (« Railing rail », « Wheel curb »…): the IFC export classifies by name
// and groups the parts of one railing run.
const named = (parent, mesh, name) => {
  mesh.name = name;
  parent.add(mesh);
  return mesh;
};
// Clockwise octagon (u, y) for round tubes.
const tube = (u, y, r) => Array.from({ length: 8 }, (_, k) => [u + r * Math.cos((-k * Math.PI) / 4), y + r * Math.sin((-k * Math.PI) / 4)]);
import { CURB_HEIGHT, RAIL_311A, barrierHeight, barrierTopCentre, wheelCurb } from './deck-profiles.mjs';

export const guardrailSection = [
  [-0.04, 0.53],
  [0.035, 0.57],
  [0.05, 0.62],
  [-0.025, 0.68],
  [0.05, 0.74],
  [0.035, 0.8],
  [-0.04, 0.84],
  [-0.044, 0.836],
  [0.03, 0.797],
  [0.044, 0.741],
  [-0.031, 0.68],
  [0.044, 0.619],
  [0.03, 0.573],
  [-0.044, 0.534],
];

export // Steel railings stand on a concrete wheel curb at the deck edge. On a raised
// sidewalk the posts are anchored in the sidewalk itself: no wheel curb.
// baseOffset: sidewalk top above the road surface when the railing stands on a sidewalk, otherwise null.
function bridgeRailing(parent, m, c, a, b, edge, side, type, baseOffset = null, surface = profile, run = {}) {
  const onSidewalk = baseOffset !== null,
    curbTop = onSidewalk ? 0 : CURB_HEIGHT - c.asphalt,
    u = edge - side * (onSidewalk ? 0.12 : 0.18),
    height = type === '210A' ? 0.87 : 1.4,
    curb = wheelCurb(edge, side, c.asphalt);
  baseOffset ??= 0;
  if (!onSidewalk) named(parent, sweep(c, a, b, chamferSection(curb), m.edge, (_, q) => surface(c, q)), 'Wheel curb');
  if (type === 'SDC') {
    architecturalRailing(parent, m, c, a, b, edge, side, baseOffset + curbTop, run);
    return;
  }
  const rail = (y, w = 0.14, h = 0.12) => {
    const top = curbTop + y + h / 2,
      bottom = curbTop + y - h / 2,
      t = 0.006;
    for (const section of [
      rect(u - w / 2, u + w / 2, top, top - t),
      rect(u - w / 2, u + w / 2, bottom + t, bottom),
      rect(u - w / 2, u - w / 2 + t, top - t, bottom + t),
      rect(u + w / 2 - t, u + w / 2, top - t, bottom + t),
    ])
      named(parent, sweep(c, a, b, section, m.railing, (_, q) => profile(c, q) + baseOffset), 'Railing rail');
  };
  if (type === '20C') {
    rail(0.08, 0.08, 0.05);
    rail(1.38, 0.08, 0.05);
  } else {
    for (const y of [0.18, 0.51, 0.81]) rail(Math.min(y, height - 0.06));
    if (type === '210C') rail(1.38, 0.05, 0.05);
  }
  // Posts at 3000 mm on a grid shared by every span and approach segment.
  for (const q of postStations(a, b, 3, run)) {
    const s = supportStation(c, q, u),
      p = frame(c, s, u),
      y = profile(c, s) + crossAt(c, u) + baseOffset + curbTop,
      angle = -Math.atan2(p.tz, p.tx);
    box(parent, m.railing, p.x, y + height / 2, p.z, 0.09, height, 0.09, angle).name = 'Railing post';
    box(parent, m.dark, p.x, y + 0.02, p.z, 0.15, 0.035, 0.15, angle).name = 'Railing base plate';
  }
  if (type === '20C')
    for (let q = a + 0.1; q < b - 0.05; q += 0.1) {
      const s = supportStation(c, q, u),
        p = frame(c, s, u),
        angle = -Math.atan2(p.tz, p.tx);
      box(parent, m.railing, p.x, profile(c, s) + crossAt(c, u) + baseOffset + curbTop + 0.73, p.z, 0.018, 1.31, 0.018, angle).name = 'Railing picket';
    }
}

export function roadsideGuardrail(parent, m, c, a, b, u, road) {
  const local = road
    ? {
        ...c,
        curved: false,
        skew: 0,
        variableDepth: false,
        profile: 'constant',
        elevation: road.elevation,
        grade: 0,
        crossfall: 'crown',
        crownOffset: 0,
        spans: [{ length: 0 }],
      }
    : c;
  const side = Math.sign(u),
    path = (q, v = 0) => {
      const station = road ? q : supportStation(c, q, u),
        p = frame(local, station, u + v);
      return { x: p.x, y: profile(local, station) + crossAt(local, u + v), z: p.z, angle: -Math.atan2(p.tz, p.tx) };
    };
  const group = new T.Group(),
    section = guardrailSection.map(([x, y]) => [u + side * x, y]);
  if (side < 0) section.reverse();
  named(group, sweep(local, a, b, section, m.guardrail), 'W-beam rail');
  const count = Math.max(1, Math.ceil((b - a) / 1.9));
  for (let j = 0; j <= count; j++) {
    const q = a + ((b - a) * j) / count,
      p = path(q, side * 0.14);
    box(group, m.guardrail, p.x, p.y + 0.38, p.z, 0.1, 0.92, 0.13, p.angle).name = 'W-beam post';
    const block = path(q, side * 0.07);
    box(group, m.dark, block.x, block.y + 0.68, block.z, 0.12, 0.2, 0.12, block.angle).name = 'W-beam block';
    const bolt = path(q, -side * 0.045);
    box(group, m.railing, bolt.x, bolt.y + 0.68, bolt.z, 0.03, 0.025, 0.025, bolt.angle).name = 'W-beam bolt';
  }
  for (const q of [a, b]) {
    const p = path(q);
    box(group, m.guardrail, p.x, p.y + 0.68, p.z, 0.22, 0.34, 0.12, p.angle).name = 'W-beam terminal';
  }
  if (road) {
    group.position.set(road.x, 0, road.z);
    group.rotation.y = road.yaw;
  }
  group.updateMatrixWorld(true);
  for (const mesh of [...group.children]) {
    mesh.applyMatrix4(group.matrix);
    parent.add(mesh);
  }
}

// Type 311A (« 311 A+B »): a steel tube rail on short posts anchored in the top of a Type 311 concrete barrier.
export function barrierRail(parent, m, c, a, b, edge, side, base, run = {}) {
  const r = RAIL_311A,
    u = edge - side * barrierTopCentre('311A'),
    top = base + barrierHeight('311A'),
    railTop = top + r.rise,
    t = 0.008;
  for (const section of [
    rect(u - r.width / 2, u + r.width / 2, railTop, railTop - t),
    rect(u - r.width / 2, u + r.width / 2, railTop - r.depth + t, railTop - r.depth),
    rect(u - r.width / 2, u - r.width / 2 + t, railTop - t, railTop - r.depth + t),
    rect(u + r.width / 2 - t, u + r.width / 2, railTop - t, railTop - r.depth + t),
  ])
    named(parent, sweep(c, a, b, section, m.railing), 'Barrier rail');
  for (const q of postStations(a + 0.3, b - 0.3, r.spacing, run)) {
    const s = supportStation(c, q, u),
      p = frame(c, s, u),
      y = profile(c, s) + crossAt(c, u),
      angle = -Math.atan2(p.tz, p.tx),
      postHeight = r.rise - r.depth;
    box(parent, m.railing, p.x, y + top + postHeight / 2, p.z, r.post, postHeight, 0.1, angle).name = 'Barrier rail post';
    box(parent, m.dark, p.x, y + top + 0.012, p.z, 0.3, 0.025, 0.24, angle).name = 'Barrier rail base plate';
  }
}

// Architectural railing « Samuel-De Champlain » (SDC): 2.4 m high, leaning outwards (12°), flat-bar posts at
// 3 m, a 200 mm round top rail, a 100 mm handrail at 1.1 m and a bottom rail, fine vertical balusters between
// them; white-grey paint. base: level of the anchor (curb or sidewalk top) above the road surface.
export const SDC = { height: 2.4, lean: Math.tan((12 * Math.PI) / 180), spacing: 3, balusters: 17, handrail: 1.1 };
export function architecturalRailing(parent, m, c, a, b, edge, side, base, run = {}) {
  const u0 = edge - side * 0.2,
    at = h => u0 + side * h * SDC.lean,
    mat = m.sdc ?? m.railing,
    surface = (_, q) => profile(c, q) + base;
  for (const [h, r] of [
    [SDC.height - 0.1, 0.1],
    [SDC.handrail, 0.05],
    [0.14, 0.04],
  ])
    named(parent, sweep(c, a, b, tube(at(h), h, r), mat, surface, undefined, u0), 'Railing rail');
  // Handrail on the inner face for cyclists and pedestrians.
  named(parent, sweep(c, a, b, tube(at(SDC.handrail) - side * 0.09, SDC.handrail, 0.03), mat, surface, undefined, u0), 'Railing rail');
  const point = (q, h) => {
    const uu = at(h),
      s = supportStation(c, q, uu),
      f = frame(c, s, uu);
    return [f.x, profile(c, s) + crossAt(c, u0) + base + h, f.z];
  };
  const posts = postStations(a, b, SDC.spacing, run);
  for (const q of posts) {
    const f = frame(c, supportStation(c, q, u0), u0);
    strut(parent, mat, point(q, 0), point(q, SDC.height - 0.1), [f.tx, f.tz], 0.035, 0.2).name = 'Railing post';
    box(parent, m.dark, ...point(q, 0.015), 0.28, 0.03, 0.28, -Math.atan2(f.tz, f.tx)).name = 'Railing base plate';
  }
  // Include the neighbouring grid posts when this mesh covers only part of a bay (span joints).
  const origin = run.origin ?? a;
  if (!(run.capStart ?? true)) posts.unshift(origin + Math.floor((a - origin) / SDC.spacing) * SDC.spacing);
  if (!(run.capEnd ?? true)) posts.push(origin + Math.ceil((b - origin) / SDC.spacing) * SDC.spacing);
  for (let i = 1; i < posts.length; i++)
    for (let j = 1; j <= SDC.balusters; j++) {
      const q = posts[i - 1] + (posts[i] - posts[i - 1]) * j / (SDC.balusters + 1);
      if (q < a || q >= b || posts[i] - posts[i - 1] < 1e-6) continue;
      const f = frame(c, supportStation(c, q, u0), u0),
        bar = strut(parent, mat, point(q, 0.14), point(q, SDC.height - 0.18), [f.tx, f.tz], 0.012, 0.012);
      bar.name = 'SDC baluster';
    }
}
