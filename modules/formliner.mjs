// BridgeSketch 3D · Architectural formliner (0.6.6): vertical ribs of varied widths cast on the visible faces of the
// abutments (front wall, return or wing walls, girder screens), 40 mm proud of the face, as on many recent
// overpasses. Real geometry, so the ribs cast their own shadows and read in grazing light.
import * as T from 'three';

export const FORMLINER_DEPTH = 0.04;
// One 1.30 m liner module: [rib width, gap] pairs in metres, an irregular rhythm of narrow and wide flutes.
const MODULE = [
  [0.14, 0.05],
  [0.06, 0.04],
  [0.22, 0.06],
  [0.09, 0.05],
  [0.04, 0.03],
  [0.17, 0.07],
  [0.07, 0.04],
  [0.12, 0.05],
];

// Rib intervals [t0, t1] along a face of the given length, keeping a plain margin at both ends.
export function ribIntervals(length, margin = 0.12, phase = 0) {
  const ribs = [],
    end = length - margin;
  let t = margin,
    k = Math.abs(Math.trunc(phase)) % MODULE.length;
  while (t < end - 0.02) {
    const [w, gap] = MODULE[k];
    ribs.push([t, Math.min(end, t + w)]);
    t += w + gap;
    k = (k + 1) % MODULE.length;
  }
  return ribs;
}

// face: { length, at(t) → [x, z] on the face, out(t) → unit [nx, nz] away from the concrete, bottom(t), top(t) }.
// The ribs stop `band` below the top of the face (a smooth cap band) and run down to the bottom given.
export function formlinerFace(parent, mat, face, { band = 0.2, phase = 0, depth = FORMLINER_DEPTH, name = 'Formliner ribs' } = {}) {
  if (!(face.length > 0.4)) return null;
  const pos = [];
  const corner = (t, y, d) => {
    const [x, z] = face.at(t),
      [nx, nz] = face.out(t);
    return [x + nx * d, y, z + nz * d];
  };
  // Each rib is a convex box: every triangle is turned to face away from its centre.
  const tri = (a, b, c, centre) => {
    const e = b.map((v, k) => v - a[k]),
      f = c.map((v, k) => v - a[k]),
      n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]],
      dir = [0, 1, 2].map(k => (a[k] + b[k] + c[k]) / 3 - centre[k]);
    pos.push(...a, ...(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] < 0 ? [...c, ...b] : [...b, ...c]));
  };
  for (const [t0, t1] of ribIntervals(face.length, 0.12, phase)) {
    const b0 = face.bottom(t0),
      b1 = face.bottom(t1),
      h0 = face.top(t0) - band,
      h1 = face.top(t1) - band;
    if (h0 - b0 < 0.15 || h1 - b1 < 0.15) continue;
    // Corners: inner face (d = 0, on the wall surface) and outer face (d = depth).
    const p = [
        corner(t0, b0, 0),
        corner(t1, b1, 0),
        corner(t1, h1, 0),
        corner(t0, h0, 0),
        corner(t0, b0, depth),
        corner(t1, b1, depth),
        corner(t1, h1, depth),
        corner(t0, h0, depth),
      ],
      centre = [0, 1, 2].map(k => p.reduce((sum, q) => sum + q[k], 0) / 8);
    // Front, both sides, top and bottom; the back face lies against the wall and is not drawn.
    for (const [a, b, c, d] of [
      [4, 5, 6, 7],
      [0, 4, 7, 3],
      [5, 1, 2, 6],
      [7, 6, 2, 3],
      [0, 1, 5, 4],
    ]) {
      tri(p[a], p[b], p[c], centre);
      tri(p[a], p[c], p[d], centre);
    }
  }
  if (!pos.length) return null;
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  const mesh = new T.Mesh(geometry, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}
