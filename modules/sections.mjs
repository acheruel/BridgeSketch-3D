// BridgeSketch 3D · Cross-sections and generic solids: swept sections, chamfers, skew-plane plates, walls.
import * as T from 'three';
import { crossAt, crossfallSection, frame, profile, stations, supportStation, girderTop, girderDepth } from './geometry.mjs';

// NEBT nominal metric geometry: top 1200, bottom 810, web 180 mm.
// ponytail: small fillets are sampled curves for viewing; shop-detail accuracy needs the owner's exact drawing revision.
export function nebtSection(h) {
  const shape = new T.Shape();
  shape.moveTo(-0.6, 0);
  shape.lineTo(0.6, 0);
  shape.lineTo(0.6, -0.065);
  shape.quadraticCurveTo(0.6, -0.085, 0.58, -0.085);
  shape.lineTo(0.29, -0.135);
  shape.quadraticCurveTo(0.09, -0.155, 0.09, -0.335);
  shape.lineTo(0.09, -h + 0.42);
  shape.quadraticCurveTo(0.09, -h + 0.26, 0.23, -h + 0.22);
  shape.lineTo(0.34, -h + 0.185);
  shape.quadraticCurveTo(0.405, -h + 0.16, 0.405, -h + 0.1);
  shape.lineTo(0.405, -h + 0.02);
  shape.lineTo(0.385, -h);
  shape.lineTo(-0.385, -h);
  shape.lineTo(-0.405, -h + 0.02);
  shape.lineTo(-0.405, -h + 0.1);
  shape.quadraticCurveTo(-0.405, -h + 0.16, -0.34, -h + 0.185);
  shape.lineTo(-0.23, -h + 0.22);
  shape.quadraticCurveTo(-0.09, -h + 0.26, -0.09, -h + 0.42);
  shape.lineTo(-0.09, -0.335);
  shape.quadraticCurveTo(-0.09, -0.155, -0.29, -0.135);
  shape.lineTo(-0.58, -0.085);
  shape.quadraticCurveTo(-0.6, -0.085, -0.6, -0.065);
  shape.closePath();
  const p = shape.getPoints(5);
  p.pop();
  return p.map(v => [v.x, v.y]);
}

export function steelSection(h, w) {
  return [
    [-0.25, 0],
    [0.25, 0],
    [0.25, -0.05],
    [w / 2, -0.05],
    [w / 2, -h + 0.05],
    [0.25, -h + 0.05],
    [0.25, -h],
    [-0.25, -h],
    [-0.25, -h + 0.05],
    [-w / 2, -h + 0.05],
    [-w / 2, -0.05],
    [-0.25, -0.05],
  ];
}

export function boxSection(h, top, bottom = top - h / 2, plate = 0.05, web = 0.014) {
  // Top flanges keep a constant position; the web slope adapts to the local depth.
  const bottomWeb = bottom / 2,
    topWeb = top / 2 - 0.25;
  if (topWeb < bottomWeb - 0.001 || bottomWeb <= web + 0.05) return null;
  return {
    topLeft: rect(-topWeb - 0.25, -topWeb + 0.25, 0, -plate),
    topRight: rect(topWeb - 0.25, topWeb + 0.25, 0, -plate),
    bottom: [
      [-bottom / 2, -h + plate],
      [bottom / 2, -h + plate],
      [bottom / 2, -h],
      [-bottom / 2, -h],
    ],
    left: [
      [-topWeb, -plate],
      [-topWeb + web, -plate],
      [-bottomWeb + web, -h + plate],
      [-bottomWeb, -h + plate],
    ],
    right: [
      [bottomWeb, -h + plate],
      [bottomWeb - web, -h + plate],
      [topWeb - web, -plate],
      [topWeb, -plate],
    ],
  };
}

export const rect = (a, b, top, bottom) => [
  [a, top],
  [b, top],
  [b, bottom],
  [a, bottom],
];

// A section swept along the actual alignment. Every edge meets the support skew plane.
export function chamferSection(points) {
  return points.flatMap((p, i) => {
    const prev = points[(i + points.length - 1) % points.length],
      next = points[(i + 1) % points.length],
      l0 = Math.hypot(p[0] - prev[0], p[1] - prev[1]) || 1,
      l1 = Math.hypot(p[0] - next[0], p[1] - next[1]) || 1,
      d0 = Math.min(0.015, l0 * 0.45),
      d1 = Math.min(0.015, l1 * 0.45);
    return [
      [p[0] + ((prev[0] - p[0]) * d0) / l0, p[1] + ((prev[1] - p[1]) * d0) / l0],
      [p[0] + ((next[0] - p[0]) * d1) / l1, p[1] + ((next[1] - p[1]) * d1) / l1],
    ];
  });
}

// crossU: undefined → every vertex follows the deck crossfall at its own u (deck elements are sheared, so their
// verticals stay vertical); a number → the whole section is lifted rigidly by the crossfall at that u (girders);
// false → no crossfall (terrain-referenced solids).
export function sweep(c, a, b, section, mat, height = profile, segments, crossU) {
  const rawSection = typeof section === 'function' ? section : () => section;
  const sectionAt = mat.userData.chamfer && height === profile ? station => chamferSection(rawSection(station)) : rawSection;
  // 0.6.6: the 0.4 m step of variable-depth bridges only where the section or its height can follow the depth
  // (girders, slabs, boxes, haunches); barriers, sidewalks, slab and pavement keep the plain step.
  const followsDepth = c.variableDepth && (typeof section === 'function' || height !== profile),
    steps = segments ?? Math.max(1, Math.ceil((b - a) / (followsDepth ? 0.4 : c.curved ? 1.5 : 3))),
    pos = [],
    uv = [],
    indices = [];
  const samples = Array.from({ length: steps + 1 }, (_, j) => a + ((b - a) * j) / steps);
  if (followsDepth && segments !== 1)
    for (const station of stations(c)) if (station > a && station < b) samples.push(station);
  samples.sort((a, b) => a - b);
  const unique = samples.filter((s, i) => i === 0 || s - samples[i - 1] > 1e-7),
    count = unique.length - 1;
  let shapes = unique.map(sectionAt);
  if (crossU === undefined && c.crossfall === 'crown') {
    // A varying box width can move an edge across the centre line: retain the same ring topology.
    const splitEdges = new Set(),
      centre = c.crownOffset ?? 0;
    for (const shape of shapes)
      shape.forEach((p, i) => {
        if ((p[0] - centre) * (shape[(i + 1) % shape.length][0] - centre) < 0) splitEdges.add(i);
      });
    shapes = shapes.map(shape => crossfallSection(c, shape, splitEdges));
  }
  const n = shapes[0].length;
  const rings = unique.map((station, j) =>
    shapes[j].map(([u, v]) => {
      const s = supportStation(c, station, u),
        p = frame(c, s, u);
      return [p.x, height(c, s, v, u) + v + (crossU === false ? 0 : crossAt(c, crossU ?? u)), p.z];
    }),
  );
  // Separate section faces keep corners sharp, shared longitudinal vertices smooth the haunch.
  for (let k = 0; k < n; k++) {
    const offset = pos.length / 3;
    for (let j = 0; j <= count; j++)
      for (const q of [k, (k + 1) % n]) {
        pos.push(...rings[j][q]);
        uv.push(unique[j] / 4, q / 4);
      }
    for (let j = 0; j < count; j++) {
      const p = offset + j * 2;
      indices.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
  }
  // End caps close every swept solid; each triangle is turned to face outward.
  const centre = r => r.reduce((a, p) => a.map((v, k) => v + p[k] / r.length), [0, 0, 0]);
  for (const [ring, neighbour] of [
    [0, Math.min(1, count)],
    [count, Math.max(0, count - 1)],
  ]) {
    const offset = pos.length / 3,
      shape = shapes[ring],
      a = centre(rings[ring]),
      b = centre(rings[neighbour]),
      out = a.map((v, k) => v - b[k]);
    for (let k = 0; k < n; k++) {
      pos.push(...rings[ring][k]);
      uv.push(shape[k][0] / 4, shape[k][1] / 4);
    }
    T.ShapeUtils.triangulateShape(
      shape.map(([u], k) => new T.Vector2(u, rings[ring][k][1])),
      [],
    ).forEach(([x, y, z]) => {
      const p = rings[ring][x],
        q = rings[ring][y],
        r = rings[ring][z],
        e = q.map((v, k) => v - p[k]),
        f = r.map((v, k) => v - p[k]);
      const normal = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]],
        facing = normal[0] * out[0] + normal[1] * out[1] + normal[2] * out[2];
      indices.push(...(facing < 0 ? [z, y, x] : [x, y, z]).map(k => k + offset));
    });
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const mesh = new T.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function clipMeshAtCut(mesh, target, start, cap = false) {
  mesh.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(mesh);
  if (start ? bounds.min.x >= target - 1e-6 : bounds.max.x <= target + 1e-6) return;
  if (start ? bounds.max.x < target : bounds.min.x > target) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    return;
  }
  const geometry = mesh.geometry,
    position = geometry.attributes.position,
    tex = geometry.attributes.uv,
    index = geometry.index,
    values = [],
    uv = [];
  const read = k => {
    const i = index ? index.getX(k) : k,
      p = new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    return { p: [p.x, p.y, p.z], uv: tex ? [tex.getX(i), tex.getY(i)] : [0, 0] };
  };
  const distance = v => (start ? target - v.p[0] : v.p[0] - target);
  for (let i = 0, n = index ? index.count : position.count; i < n; i += 3) {
    const face = [read(i), read(i + 1), read(i + 2)],
      clipped = [];
    for (let j = 0; j < 3; j++) {
      const p = face[j],
        q = face[(j + 1) % 3],
        dp = distance(p),
        dq = distance(q);
      if (dp <= 1e-7) clipped.push(p);
      if (dp > 1e-7 !== dq > 1e-7) {
        const t = dp / (dp - dq);
        clipped.push({ p: p.p.map((v, k) => v + t * (q.p[k] - v)), uv: p.uv.map((v, k) => v + t * (q.uv[k] - v)) });
      }
    }
    for (let j = 1; j < clipped.length - 1; j++)
      for (const v of [clipped[0], clipped[j], clipped[j + 1]]) {
        values.push(...v.p);
        uv.push(...v.uv);
      }
  }
  if (cap) {
    // ponytail: convex cut caps; triangulate separate contours if concave solids ever need caps.
    // Keep every cut edge, including collinear triangle intersections.
    const nodes = new Map(),
      edges = new Map(),
      key = p => p.map(v => Math.round(v * 1e5)).join(',');
    for (let i = 0; i < values.length; i += 9)
      for (let j = 0; j < 3; j++) {
        const a = i + j * 3,
          b = i + ((j + 1) % 3) * 3,
          p = values.slice(a, a + 3),
          q = values.slice(b, b + 3);
        if (Math.abs(p[0] - target) > 1e-6 || Math.abs(q[0] - target) > 1e-6) continue;
        const pk = key(p), qk = key(q);
        if (pk === qk) continue;
        nodes.set(pk, { p, uv: uv.slice((a / 3) * 2, (a / 3) * 2 + 2) });
        nodes.set(qk, { p: q, uv: uv.slice((b / 3) * 2, (b / 3) * 2 + 2) });
        const edge = [pk, qk].sort().join('|'),
          saved = edges.get(edge);
        if (saved) saved.count++;
        else edges.set(edge, { a: pk, b: qk, count: 1 });
      }
    const boundary = [...edges.values()].filter(e => e.count === 1),
      keys = [...new Set(boundary.flatMap(e => [e.a, e.b]))],
      centre = keys.reduce((c, k) => c.map((v, i) => v + nodes.get(k).p[i] / keys.length), [0, 0, 0]),
      centreUV = keys.reduce((c, k) => c.map((v, i) => v + nodes.get(k).uv[i] / keys.length), [0, 0]);
    for (const edge of boundary) {
      const p = nodes.get(edge.a),
        q = nodes.get(edge.b),
        normal = (p.p[1] - centre[1]) * (q.p[2] - centre[2]) - (p.p[2] - centre[2]) * (q.p[1] - centre[1]),
        ordered = (start ? normal > 0 : normal < 0) ? [q, p] : [p, q];
      values.push(...centre, ...ordered[0].p, ...ordered[1].p);
      uv.push(...centreUV, ...ordered[0].uv, ...ordered[1].uv);
    }
  }
  const cut = new T.BufferGeometry();
  cut.setAttribute('position', new T.Float32BufferAttribute(values, 3));
  cut.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  cut.computeVertexNormals();
  geometry.dispose();
  mesh.geometry = cut;
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrixWorld(true);
}

export function boxGirder(c, a, b, u, mat) {
  const group = new T.Group();
  group.name = 'Hollow steel box';
  for (const plate of ['topLeft', 'topRight', 'bottom', 'left', 'right']) {
    const section = station => {
      const d = girderDepth(c, supportStation(c, station, u), u);
      return boxSection(d, c.boxTopWidth, c.boxBottomWidth, 0.05, c.web)[plate].map(([x, y]) => [x + u, y]);
    };
    const mesh = sweep(c, a, b, section, mat, (_, s) => girderTop(c, 0, s, u));
    mesh.name = 'Box ' + plate;
    group.add(mesh);
  }
  return group;
}

export function slabMesh(c, a, b, mat) {
  return sweep(
    c,
    a,
    b,
    chamferSection(rect(-c.width / 2, c.width / 2, -c.asphalt, -c.asphalt - c.slabDepth)),
    mat,
    (_, s, v, u) => profile(c, s) + (v < -c.asphalt - c.slabDepth / 2 ? c.slabDepth - girderDepth(c, s, u) : 0),
  );
}

export function box(parent, mat, x, y, z, w, h, d, yaw = 0) {
  let geometry;
  if (mat.userData.chamfer && Math.min(w, h, d) > 0.06) {
    const bevel = 0.015,
      shape = new T.Shape(),
      a = w / 2 - bevel,
      b = h / 2 - bevel;
    shape.moveTo(-a + bevel, -b);
    for (const [px, py] of [
      [a - bevel, -b],
      [a, -b + bevel],
      [a, b - bevel],
      [a - bevel, b],
      [-a + bevel, b],
      [-a, b - bevel],
      [-a, -b + bevel],
    ])
      shape.lineTo(px, py);
    shape.closePath();
    geometry = new T.ExtrudeGeometry(shape, {
      depth: d - 2 * bevel,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: 1,
    });
    geometry.translate(0, 0, -d / 2 + bevel);
  } else geometry = new T.BoxGeometry(w, h, d);
  const o = new T.Mesh(geometry, mat);
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

// 0.6.6: bearing plinth (bloc d'assise) cast on the seat: 15 mm chamfers on the top edges and the vertical
// corners only; the bottom edges meet the seat square, with no chamfer.
export function plinth(parent, mat, x, y, z, w, h, d, yaw = 0) {
  const b = mat.userData.chamfer && Math.min(w, d) > 0.06 && h > 0.05 ? 0.015 : 0,
    outline = inset =>
      b
        ? [
            [-w / 2 + inset + b, -d / 2 + inset],
            [w / 2 - inset - b, -d / 2 + inset],
            [w / 2 - inset, -d / 2 + inset + b],
            [w / 2 - inset, d / 2 - inset - b],
            [w / 2 - inset - b, d / 2 - inset],
            [-w / 2 + inset + b, d / 2 - inset],
            [-w / 2 + inset, d / 2 - inset - b],
            [-w / 2 + inset, -d / 2 + inset + b],
          ]
        : [
            [-w / 2, -d / 2],
            [w / 2, -d / 2],
            [w / 2, d / 2],
            [-w / 2, d / 2],
          ],
    rings = [
      outline(0).map(([px, pz]) => [px, -h / 2, pz]),
      outline(0).map(([px, pz]) => [px, h / 2 - b, pz]),
      ...(b ? [outline(b).map(([px, pz]) => [px, h / 2, pz])] : []),
    ];
  const pos = [],
    n = rings[0].length;
  const quad = (p, q, r, t) => pos.push(...p, ...q, ...r, ...p, ...r, ...t);
  for (let j = 0; j < rings.length - 1; j++)
    for (let k = 0; k < n; k++) {
      const l = (k + 1) % n;
      // Counter-clockwise outline seen from above: (k → l) then up gives an outward face.
      quad(rings[j][k], rings[j + 1][k], rings[j + 1][l], rings[j][l]);
    }
  const top = rings.at(-1),
    bottom = rings[0];
  for (let k = 1; k < n - 1; k++) {
    pos.push(...top[0], ...top[k + 1], ...top[k]);
    pos.push(...bottom[0], ...bottom[k], ...bottom[k + 1]);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  const o = new T.Mesh(geometry, mat);
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  o.castShadow = o.receiveShadow = true;
  parent.add(o);
  return o;
}

export function supportBasis(c, s, u = 0) {
  const step = 0.1,
    station = supportStation(c, s, u),
    p = frame(c, station, u),
    lo = frame(c, supportStation(c, s, u - step), u - step),
    hi = frame(c, supportStation(c, s, u + step), u + step);
  const ax = hi.x - lo.x,
    az = hi.z - lo.z,
    len = Math.hypot(ax, az) || 1;
  return { ...p, ax: ax / len, az: az / len, angle: -Math.atan2(az, ax) };
}

// Vertical prism: local X follows the support, local Y always stays vertical.
export function wallBetween(parent, mat, a, b, thickness, bottom, top) {
  const dx = b[0] - a[0],
    dz = b[2] - a[2];
  return box(
    parent,
    mat,
    (a[0] + b[0]) / 2,
    (bottom + top) / 2,
    (a[2] + b[2]) / 2,
    Math.hypot(dx, dz),
    top - bottom,
    thickness,
    -Math.atan2(dz, dx),
  );
}

export function beam(parent, mat, a, b, w, d) {
  const va = new T.Vector3(...a),
    vb = new T.Vector3(...b),
    delta = vb.clone().sub(va);
  const o = box(parent, mat, ...va.clone().add(vb).multiplyScalar(0.5).toArray(), w, delta.length(), d);
  o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  return o;
}

export function point(c, s, u, y) {
  const f = frame(c, s, u);
  return [f.x, y, f.z];
}

export function supportPoint(c, s, u, y) {
  return point(c, supportStation(c, s, u), u, y);
}

export // Flat plate lying in the skewed support plane through station s, outlined in (u, y).
function skewPlate(parent, mat, c, s, outline, thickness, name) {
  const layers = [-thickness / 2, thickness / 2].map(t =>
      outline.map(([u, y]) => {
        const p = supportPoint(c, s, u, y),
          f = frame(c, supportStation(c, s, u), u);
        return [p[0] + f.tx * t, y, p[2] + f.tz * t];
      }),
    ),
    n = outline.length,
    triangles = [];
  const all = [...layers[0], ...layers[1]],
    centre = all.reduce((a, p) => a.map((v, k) => v + p[k] / all.length), [0, 0, 0]);
  const tri = (p, q, r) => {
    const e = q.map((v, k) => v - p[k]),
      f = r.map((v, k) => v - p[k]),
      normal = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]],
      mid = [0, 1, 2].map(k => (p[k] + q[k] + r[k]) / 3 - centre[k]);
    triangles.push(
      ...p,
      ...(normal[0] * mid[0] + normal[1] * mid[1] + normal[2] * mid[2] < 0 ? [...r, ...q] : [...q, ...r]),
    );
  };
  for (const layer of layers) for (let k = 1; k < n - 1; k++) tri(layer[0], layer[k], layer[k + 1]);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    tri(layers[0][k], layers[0][j], layers[1][j]);
    tri(layers[0][k], layers[1][j], layers[1][k]);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(triangles, 3));
  geometry.computeVertexNormals();
  const mesh = new T.Mesh(geometry, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

export function profiledSupportWall(parent, mat, c, station, u0, u1, thickness, bottomAt, topAt, cuts = []) {
  const triangles = [],
    steps = Math.max(1, Math.ceil((u1 - u0) / 0.4)),
    ring = u => {
      const p = supportBasis(c, station, u),
        d = thickness / 2;
      if (!mat.userData.chamfer)
        return [
          [p.x - p.tx * d, topAt(u, -d), p.z - p.tz * d],
          [p.x + p.tx * d, topAt(u, d), p.z + p.tz * d],
          [p.x + p.tx * d, bottomAt(u, d), p.z + p.tz * d],
          [p.x - p.tx * d, bottomAt(u, -d), p.z - p.tz * d],
        ];
      const bevel = 0.015,
        at = (along, y) => [p.x + p.tx * along, y, p.z + p.tz * along];
      return [
        at(-d + bevel, topAt(u, -d + bevel)),
        at(d - bevel, topAt(u, d - bevel)),
        at(d, topAt(u, d) - bevel),
        at(d, bottomAt(u, d) + bevel),
        at(d - bevel, bottomAt(u, d - bevel)),
        at(-d + bevel, bottomAt(u, -d + bevel)),
        at(-d, bottomAt(u, -d) + bevel),
        at(-d, topAt(u, -d) - bevel),
      ];
    };
  const face = (a, b, d, e) => {
    triangles.push(...a, ...b, ...d, ...a, ...d, ...e);
  };
  const us = [...new Set([...Array.from({ length: steps + 1 }, (_, j) => u0 + ((u1 - u0) * j) / steps), ...cuts])]
    .filter(u => u >= u0 && u <= u1)
    .sort((a, b) => a - b);
  let previous = ring(us[0]);
  for (const u of us.slice(1)) {
    const next = ring(u);
    for (let k = 0; k < previous.length; k++)
      face(previous[k], next[k], next[(k + 1) % previous.length], previous[(k + 1) % previous.length]);
    previous = next;
  }
  // End faces are oriented from their own geometry, so tapered caps never lose a face.
  for (const [u, inner] of [
    [u0, u0 + (u1 - u0) * 0.01],
    [u1, u1 - (u1 - u0) * 0.01],
  ]) {
    const r = ring(u),
      o = ring(inner),
      mid = q => q.reduce((a, p) => a.map((v, k) => v + p[k] / q.length), [0, 0, 0]),
      a = mid(r),
      b = mid(o),
      out = a.map((v, k) => v - b[k]);
    for (let k = 1; k < r.length - 1; k++) {
      const p = r[0],
        q = r[k],
        t = r[k + 1],
        e = q.map((v, i) => v - p[i]),
        f = t.map((v, i) => v - p[i]),
        n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]];
      triangles.push(...p, ...(n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? [...t, ...q] : [...q, ...t]));
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(triangles, 3));
  geometry.computeVertexNormals();
  const mesh = new T.Mesh(geometry, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function soffitAt(c, i, s, u = 0) {
  return girderTop(c, i, s, u) + crossAt(c, u) - girderDepth(c, s, u);
}

// Plate in the skewed support plane between u0 and u1 whose top and bottom follow the deck crossfall
// (top(u) / bottom(u) are levels before crossfall). Split at the crown line so every piece stays convex.
export function crossPlate(parent, mat, c, s, u0, u1, top, bottom, thickness, name) {
  const cuts = [u0, u1];
  if (c.crossfall === 'crown' && c.crownOffset > u0 && c.crownOffset < u1) cuts.splice(1, 0, c.crownOffset);
  const pieces = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k],
      b = cuts[k + 1],
      at = (u, y) => [u, y(u) + crossAt(c, u)];
    pieces.push(skewPlate(parent, mat, c, s, [at(a, top), at(b, top), at(b, bottom), at(a, bottom)], thickness, name));
  }
  return pieces;
}

export function bearingY(c, i, station, u = 0) {
  const actual = supportStation(c, station, u);
  return soffitAt(c, i, actual, u);
}

export function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
