// BridgeSketch 3D · Procedural vehicles (0.6.6). Realistic proportions at a low triangle count, instead of the
// toy-like kit cars: lofted bodies with rounded sections and real wheel arches, a greenhouse with tumblehome, a
// windscreen raked at about 30°, painted roof and pillars, tinted glass, alloy wheels on tyres with sidewalls,
// light clusters, grilles, mirrors, plates and sill cladding. Trucks: rounded cabs, chrome grilles, steps, tanks and
// exhaust stacks. Local axes: +X forward, +Y up, Z across; origin on the ground at the centre of the footprint.
// Every part is emitted through put(material, geometry), then baked into one geometry per material and shared by all
// the vehicles of a type (vehicles.mjs).
import * as T from 'three';

// Overall sizes (metres), roof height for roof boxes and racks, and the wheel layout.
export const VEHICLE_SPECS = {
  sedan: { length: 4.78, width: 1.84, height: 1.45 },
  hatchback: { length: 4.3, width: 1.8, height: 1.47 },
  suv: { length: 4.72, width: 1.92, height: 1.72 },
  pickup: { length: 5.82, width: 2.03, height: 1.95 },
  van: { length: 5.6, width: 2.05, height: 2.55 },
  truck: { length: 7.6, width: 2.45, height: 3.45 },
  semi: { length: 13.3, width: 2.6, height: 3.9 },
};

// ---- Small helpers ------------------------------------------------------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// Piecewise curve through [x, y] points (x increasing), eased between points.
function curve(points) {
  return x => {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++)
      if (x <= points[i][0]) {
        const [x0, y0] = points[i - 1],
          [x1, y1] = points[i];
        return lerp(y0, y1, smooth((x - x0) / (x1 - x0)));
      }
    return points.at(-1)[1];
  };
}
// Rounded box (edges bevelled with radius r), centred on (x, y, z).
function rbox(w, h, d, r = 0.04, x = 0, y = 0, z = 0) {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const shape = new T.Shape(),
    a = w / 2 - r,
    b = h / 2 - r;
  shape.moveTo(-a, -h / 2);
  shape.lineTo(a, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -b);
  shape.lineTo(w / 2, b);
  shape.quadraticCurveTo(w / 2, h / 2, a, h / 2);
  shape.lineTo(-a, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, b);
  shape.lineTo(-w / 2, -b);
  shape.quadraticCurveTo(-w / 2, -h / 2, -a, -h / 2);
  const g = new T.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - 2 * r),
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r * 0.98,
    bevelOffset: -r * 0.98,
    bevelSegments: 2,
    curveSegments: 3,
  });
  g.translate(x, y, z - d / 2 + r);
  return g;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new T.BoxGeometry(w, h, d).translate(x, y, z);

// Closed loft through rounded sections. section(x) → { bottom, top, half, rTop, rBottom, topHalf? } (topHalf: half
// width at the top for a tapered greenhouse). Material per face: pick(face centre, normal) → material name.
function loft(put, xs, section, pick, cornerSteps = 3) {
  const ring = x => {
    const s = section(x),
      topHalf = s.topHalf ?? s.half,
      rt = Math.min(s.rTop, topHalf * 0.9, (s.top - s.bottom) * 0.45),
      rb = Math.min(s.rBottom, s.half * 0.9, (s.top - s.bottom) * 0.45),
      pts = [];
    const arc = (cz, cy, r, a0, a1) => {
      for (let k = 0; k <= cornerSteps; k++) {
        const a = lerp(a0, a1, k / cornerSteps);
        pts.push([cz + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    // Counter-clockwise seen from the front (+X): right bottom → right top → left top → left bottom.
    arc(s.half - rb, s.bottom + rb, rb, -Math.PI / 2, 0);
    arc(topHalf - rt, s.top - rt, rt, 0, Math.PI / 2);
    arc(-topHalf + rt, s.top - rt, rt, Math.PI / 2, Math.PI);
    arc(-s.half + rb, s.bottom + rb, rb, Math.PI, 1.5 * Math.PI);
    return pts.map(([z, y]) => [x, y, z]);
  };
  const rings = xs.map(ring),
    n = rings[0].length,
    out = new Map();
  const tri = (a, b, c) => {
    const e = b.map((v, k) => v - a[k]),
      f = c.map((v, k) => v - a[k]),
      nrm = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]],
      len = Math.hypot(...nrm) || 1,
      centre = [0, 1, 2].map(k => (a[k] + b[k] + c[k]) / 3),
      mat = pick(centre, nrm.map(v => v / len));
    if (!out.has(mat)) out.set(mat, []);
    out.get(mat).push(...a, ...b, ...c);
  };
  for (let j = 0; j < rings.length - 1; j++)
    for (let k = 0; k < n; k++) {
      const a = rings[j][k],
        b = rings[j][(k + 1) % n],
        c = rings[j + 1][(k + 1) % n],
        d = rings[j + 1][k];
      // Rings run from the rear (low x) to the front: this winding faces outward.
      tri(a, d, c);
      tri(a, c, b);
    }
  // End caps (convex sections): fans facing -X at the rear and +X at the front.
  for (const [ring, front] of [
    [rings[0], false],
    [rings.at(-1), true],
  ]) {
    const centre = [ring[0][0], ring.reduce((s, p) => s + p[1], 0) / n, 0];
    for (let k = 0; k < n; k++) {
      const a = ring[k],
        b = ring[(k + 1) % n];
      if (front) tri(centre, b, a);
      else tri(centre, a, b);
    }
  }
  for (const [mat, pos] of out) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    // Smooth shading across the section, sharp at the caps: weld by position, then compute normals.
    put(mat, smoothNormals(g));
  }
}
// Indexed, position-welded copy with smooth vertex normals; creases sharper than ~50° keep separate normals.
function smoothNormals(g) {
  const p = g.attributes.position,
    faces = p.count / 3,
    normals = new Float32Array(p.count * 3),
    faceN = [];
  for (let f = 0; f < faces; f++) {
    const v = [0, 1, 2].map(k => new T.Vector3().fromBufferAttribute(p, f * 3 + k)),
      nrm = new T.Vector3().subVectors(v[1], v[0]).cross(new T.Vector3().subVectors(v[2], v[0])).normalize();
    faceN.push(nrm);
  }
  const byPos = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!byPos.has(key)) byPos.set(key, []);
    byPos.get(key).push(i);
  }
  for (const list of byPos.values())
    for (const i of list) {
      const own = faceN[Math.floor(i / 3)],
        sum = new T.Vector3();
      for (const j of list) {
        const other = faceN[Math.floor(j / 3)];
        if (own.dot(other) > 0.64) sum.add(other);
      }
      sum.normalize();
      normals.set([sum.x, sum.y, sum.z], i * 3);
    }
  g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  return g;
}
// Sample stations: a base step, finer around the wheel arches and near the ends.
function stations(x0, x1, step, fine = []) {
  const xs = new Set();
  for (let x = x0; x < x1; x += step) xs.add(Number(x.toFixed(4)));
  xs.add(x1);
  for (const [c, r] of fine) for (let k = -10; k <= 10; k++) xs.add(Number((c + (r * k) / 10).toFixed(4)));
  for (let k = 1; k < 5; k++) {
    xs.add(Number((x0 + 0.06 * k).toFixed(4)));
    xs.add(Number((x1 - 0.06 * k).toFixed(4)));
  }
  return [...xs].filter(x => x >= x0 && x <= x1).sort((a, b) => a - b);
}

// ---- Wheels -----------------------------------------------------------------------------------------------------
// Tyre with rounded shoulders (lathe), dark wheel face, five alloy spokes, rim lip and hub; axle along Z.
function wheel(put, x, z, R, width, { dual = false, truck = false } = {}) {
  const side = Math.sign(z) || 1,
    rim = R * (truck ? 0.6 : 0.64),
    profile = [
      [rim * 0.98, -width / 2],
      [R - 0.035, -width / 2],
      [R, -width / 2 + 0.04],
      [R, width / 2 - 0.04],
      [R - 0.035, width / 2],
      [rim * 0.98, width / 2],
    ].map(([r, y]) => new T.Vector2(r, y));
  const tyre = new T.LatheGeometry(profile, 22).rotateX(Math.PI / 2).translate(x, R, z);
  put('rubber', tyre);
  const face = z + side * (width / 2 - 0.02);
  put('trim', new T.CylinderGeometry(rim, rim, width - 0.06, 18).rotateX(Math.PI / 2).translate(x, R, z));
  put('metal', new T.TorusGeometry(rim * 0.97, truck ? 0.022 : 0.018, 5, 22).translate(x, R, face));
  put('metal', new T.CylinderGeometry(rim * 0.22, rim * 0.22, 0.05, 10).rotateX(Math.PI / 2).translate(x, R, face));
  const spokes = truck ? 10 : 5;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2 + 0.3,
      len = rim * 0.78,
      g = box(truck ? 0.05 : rim * 0.2, len, 0.03).translate(0, rim * 0.2 + len / 2, 0).rotateZ(a);
    put('metal', g.translate(x, R, face - side * 0.005));
  }
  if (dual) wheel(put, x, z - side * (width + 0.02), R, width, { truck });
}
// Dark wheel-house liner behind a tyre: the arch shows depth instead of the body colour.
function wheelHouse(put, x, R, half, rise) {
  put('trim', new T.CylinderGeometry(R, R, half * 2 - 0.16, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(x, rise, 0));
}

// ---- Cars ---------------------------------------------------------------------------------------------------------
// p: lengths (m) from the front bumper; heights from the ground.
const CAR = {
  sedan: {
    L: 4.78, W: 1.84, wheelbase: 2.83, front: 0.95, R: 0.33, tyre: 0.215, sill: 0.33,
    nose: 0.66, hood: 0.94, belt: 0.99, deck: 1.02, tail: 0.86, roof: 1.45,
    screen: 1.55, roofFront: 2.3, roofRear: 3.35, rearGlass: 3.98, tumble: 0.2, kind: 'sedan',
  },
  hatchback: {
    L: 4.3, W: 1.8, wheelbase: 2.64, front: 0.88, R: 0.325, tyre: 0.205, sill: 0.33,
    nose: 0.68, hood: 0.95, belt: 1.0, deck: 1.04, tail: 1.0, roof: 1.47,
    screen: 1.45, roofFront: 2.2, roofRear: 3.75, rearGlass: 4.18, tumble: 0.19, kind: 'hatch',
  },
  suv: {
    L: 4.72, W: 1.92, wheelbase: 2.82, front: 0.92, R: 0.375, tyre: 0.235, sill: 0.45,
    nose: 0.82, hood: 1.1, belt: 1.15, deck: 1.17, tail: 1.15, roof: 1.72,
    screen: 1.45, roofFront: 2.1, roofRear: 4.25, rearGlass: 4.55, tumble: 0.17, kind: 'suv', cladding: true,
  },
};
function buildCar(put, p) {
  const X = d => p.L / 2 - d, // distance from the front bumper → x
    half = p.W / 2,
    axles = [p.front, p.front + p.wheelbase],
    arch = p.R + 0.07;
  // Plan shape: the corners round off over the last 0.4 m at each end.
  const plan = x => {
    const d = Math.max(0, Math.abs(x) - (p.L / 2 - 0.42)) / 0.42;
    return half * (0.84 + 0.16 * Math.sqrt(Math.max(0, 1 - d * d)));
  };
  // Upper line of the lower body: bumper → hood → base of the screen → beltline → boot lid / hatch → tail.
  const shoulder = curve(
    [
      [X(0), p.nose],
      [X(0.18), p.nose + 0.08],
      [X(p.screen - 0.05), p.hood],
      [X(p.screen + 0.1), p.belt],
      [X(p.rearGlass), p.deck],
      [X(p.L - 0.18), p.tail],
      [X(p.L), p.tail - 0.1],
    ].reverse(),
  );
  // Bottom line: sill height, opened over each wheel by a round arch; bumpers dip a little lower.
  const bottom = x => {
    let y = p.sill;
    const ends = Math.min(Math.abs(x - X(0)), Math.abs(x - X(p.L)));
    if (ends < 0.5) y = lerp(p.sill - 0.08, p.sill, ends / 0.5);
    for (const d of axles) {
      const dx = Math.abs(x - X(d));
      if (dx < arch) y = Math.max(y, p.R + Math.sqrt(arch * arch - dx * dx));
    }
    return y;
  };
  const xs = stations(X(p.L), X(0), 0.18, axles.map(d => [X(d), arch + 0.02]));
  loft(
    put,
    xs,
    x => ({ bottom: bottom(x), top: shoulder(x), half: plan(x), rTop: 0.1, rBottom: 0.07 }),
    () => 'paint',
  );
  // Greenhouse: screen raked about 30°, painted roof, glass all round with a tumblehome.
  const roofLine = curve(
    [
      [X(p.screen), p.belt - 0.02],
      [X(p.roofFront), p.roof - 0.03],
      [X(p.roofFront + 0.25), p.roof],
      [X(p.roofRear - 0.25), p.roof],
      [X(p.roofRear), p.roof - 0.03],
      [X(p.rearGlass), p.deck - 0.01],
    ].reverse(),
  );
  const cabinXs = stations(X(p.rearGlass), X(p.screen), 0.06),
    bx = (p.roofFront + p.roofRear) / 2 - 0.15,
    // Distance from the bumper of the screen's side edge at height y (the A pillar line).
    roofFrontEdge = y => lerp(p.screen, p.roofFront, Math.min(1, Math.max(0, (y - p.belt) / (p.roof - p.belt))));
  loft(
    put,
    cabinXs,
    x => ({
      bottom: shoulder(x) - 0.04,
      top: Math.max(shoulder(x) + 0.02, roofLine(x)),
      half: plan(x) - 0.06,
      topHalf: plan(x) - 0.06 - p.tumble,
      rTop: 0.09,
      rBottom: 0.02,
    }),
    // Painted roof, A pillars along the screen, C pillars (wide on a saloon) and a black B pillar.
    ([x, y], n) => {
      if (n[1] > 0.8 && y > p.roof - 0.12) return 'paint';
      if (Math.abs(n[2]) < 0.45) return 'glass';
      const d = p.L / 2 - x,
        edge = roofFrontEdge(y);
      if (d < p.roofFront + 0.12 && d > edge - 0.02 && d < edge + 0.11 && y > shoulder(x) + 0.04) return 'paint';
      if (d > p.rearGlass - (p.kind === 'sedan' ? 0.75 : 0.42)) return 'paint';
      if (Math.abs(d - bx) < 0.06) return 'trim';
      return 'glass';
    },
  );
  for (const side of [-1, 1]) {
    const x0 = X(p.rearGlass - 0.05),
      x1 = X(p.screen + 0.08);
    put('trim', box(x1 - x0, 0.03, 0.02, (x0 + x1) / 2, p.belt + 0.005, side * (half - 0.07)));
  }
  // Lights, grille, bumpers, plates, mirrors, cladding.
  for (const side of [-1, 1]) {
    // Slim light clusters on the fascia corners (dark housing, lens, amber indicator) and tail lamps on the tail panel.
    const fz = side * (plan(X(0)) - 0.28),
      fy = p.nose - 0.1;
    put('trim', rbox(0.05, 0.12, 0.46, 0.02, X(0) - 0.012, fy, fz));
    put('headlamp', rbox(0.04, 0.07, 0.36, 0.015, X(0) + 0.004, fy + 0.005, fz - side * 0.03));
    put('amber', box(0.03, 0.03, 0.08, X(0) + 0.004, fy - 0.03, side * (plan(X(0)) - 0.07)));
    const rz = side * (plan(X(p.L)) - 0.26);
    put('trim', rbox(0.05, 0.13, 0.5, 0.02, X(p.L) + 0.012, p.tail - 0.24, rz));
    put('taillamp', rbox(0.04, 0.09, 0.44, 0.015, X(p.L) - 0.004, p.tail - 0.24, rz));
    // Mirror on a short arm at the base of the A pillar.
    put('paint', rbox(0.12, 0.11, 0.2, 0.03, X(p.screen + 0.18), p.belt + 0.1, side * (plan(X(p.screen + 0.18)) + 0.03)));
    put('trim', box(0.08, 0.04, 0.12, X(p.screen + 0.18), p.belt + 0.05, side * (plan(X(p.screen + 0.18)) - 0.06)));
    if (p.cladding)
      for (const [d0, d1] of [
        [axles[0] + arch, axles[1] - arch],
        [0.15, axles[0] - arch],
        [axles[1] + arch, p.L - 0.15],
      ])
        put('trim', box(d1 - d0, 0.09, 0.03, X((d0 + d1) / 2), p.sill + 0.06, side * (plan(X((d0 + d1) / 2)) + 0.005)));
    // Door handles.
    for (const d of [p.screen + 0.75, bx + 0.45]) put('trim', box(0.16, 0.03, 0.02, X(d), p.belt - 0.12, side * (plan(X(d)) + 0.005)));
  }
  put('trim', rbox(0.05, 0.12, p.W * 0.4, 0.03, X(0) - 0.012, p.nose - 0.12, 0)); // grille
  put('trim', box(0.06, 0.1, p.W * 0.62, X(0.04), p.sill + 0.04, 0)); // lower intake
  put('cargo', box(0.02, 0.11, 0.52, X(-0.005), p.sill + 0.12, 0)); // front plate
  put('cargo', box(0.02, 0.15, 0.31, X(p.L + 0.005), p.tail - 0.42, 0)); // rear plate
  put('trim', box(0.05, 0.08, p.W * 0.8, X(p.L - 0.03), p.sill + 0.03, 0)); // rear diffuser
  // Wheel houses and wheels.
  for (const d of axles) {
    wheelHouse(put, X(d), arch - 0.01, half, p.R);
    for (const side of [-1, 1]) wheel(put, X(d), side * (half - p.tyre / 2 - 0.04), p.R, p.tyre);
  }
}

// ---- Pickup: crew cab and a 1.7 m box ------------------------------------------------------------------------------
function buildPickup(put) {
  const p = { L: 5.82, W: 2.03, wheelbase: 3.68, front: 1.0, R: 0.4, tyre: 0.26, sill: 0.55 },
    X = d => p.L / 2 - d,
    half = p.W / 2,
    axles = [p.front, p.front + p.wheelbase],
    arch = p.R + 0.08,
    cabBack = 3.55;
  const plan = x => {
    const d = Math.max(0, x - (p.L / 2 - 0.35)) / 0.35;
    return half * (0.88 + 0.12 * Math.sqrt(Math.max(0, 1 - d * d)));
  };
  const top = curve(
    [
      [X(0), 1.08],
      [X(0.15), 1.24],
      [X(1.75), 1.32],
      [X(1.95), 1.36],
      [X(p.L), 1.34],
    ].reverse(),
  );
  const bottom = x => {
    let y = p.sill;
    for (const d of axles) {
      const dx = Math.abs(x - X(d));
      if (dx < arch) y = Math.max(y, p.R + Math.sqrt(arch * arch - dx * dx));
    }
    return y;
  };
  loft(put, stations(X(p.L), X(0), 0.2, axles.map(d => [X(d), arch + 0.02])), x => ({ bottom: bottom(x), top: top(x), half: plan(x), rTop: 0.08, rBottom: 0.06 }), () => 'paint');
  // Cab greenhouse, near-vertical back light.
  const roof = curve(
    [
      [X(1.9), 1.3],
      [X(2.55), 1.9],
      [X(2.75), 1.95],
      [X(cabBack - 0.1), 1.95],
      [X(cabBack), 1.9],
    ].reverse(),
  );
  loft(
    put,
    stations(X(cabBack), X(1.9), 0.1),
    x => ({ bottom: top(x) - 0.04, top: Math.max(top(x) + 0.02, roof(x)), half: plan(x) - 0.06, topHalf: plan(x) - 0.2, rTop: 0.08, rBottom: 0.02 }),
    ([x, y], n) => (n[1] > 0.8 && y > 1.85 ? 'paint' : 'glass'),
  );
  // Bed: dark liner inside the box walls, tailgate.
  // Open box: the dark bed liner shows between the painted side rails.
  put('trim', box(p.L - cabBack - 0.22, 0.02, p.W - 0.24, X((cabBack + p.L) / 2 + 0.02), 1.345, 0));
  put('paint', box(0.06, 0.14, p.W - 0.08, X(p.L - 0.03), 1.3, 0));
  for (const side of [-1, 1]) {
    put('headlamp', rbox(0.06, 0.15, 0.36, 0.02, X(0.1), 1.1, side * (half - 0.28)));
    put('taillamp', box(0.05, 0.38, 0.12, X(p.L - 0.02), 1.06, side * (half - 0.08)));
    put('paint', rbox(0.14, 0.16, 0.24, 0.03, X(2.1), 1.45, side * (half + 0.08)));
    put('trim', box(1.9, 0.05, 0.12, X(2.85), 0.5, side * (half + 0.03))); // running board
    put('trim', box(0.16, 0.03, 0.02, X(2.55), 1.18, side * (half + 0.005)));
    put('trim', box(0.16, 0.03, 0.02, X(3.35), 1.18, side * (half + 0.005)));
  }
  put('metal', rbox(0.08, 0.36, p.W * 0.62, 0.03, X(0.04), 0.98, 0)); // chrome grille
  put('trim', rbox(0.04, 0.26, p.W * 0.56, 0.02, X(0.0), 0.98, 0));
  put('metal', rbox(0.16, 0.18, p.W - 0.05, 0.05, X(0.05), 0.62, 0)); // bumper
  put('metal', rbox(0.14, 0.14, p.W - 0.1, 0.04, X(p.L - 0.05), 0.68, 0));
  put('cargo', box(0.02, 0.15, 0.31, X(p.L + 0.01), 0.86, 0));
  for (const d of axles) {
    wheelHouse(put, X(d), arch - 0.01, half, p.R);
    for (const side of [-1, 1]) wheel(put, X(d), side * (half - p.tyre / 2 - 0.03), p.R, p.tyre);
  }
}

// ---- Van: high-roof panel van ---------------------------------------------------------------------------------------
function buildVan(put) {
  const p = { L: 5.6, W: 2.05, wheelbase: 3.66, front: 0.95, R: 0.36, tyre: 0.235, sill: 0.42, roof: 2.55 },
    X = d => p.L / 2 - d,
    half = p.W / 2,
    axles = [p.front, p.front + p.wheelbase],
    arch = p.R + 0.07;
  const plan = x => {
    const d = Math.max(0, x - (p.L / 2 - 0.4)) / 0.4;
    return half * (0.86 + 0.14 * Math.sqrt(Math.max(0, 1 - d * d)));
  };
  const top = curve(
    [
      [X(0), 0.95],
      [X(0.25), 1.12],
      [X(0.85), 1.25],
      [X(1.0), 1.3],
      [X(p.L), 1.3],
    ].reverse(),
  );
  const bottom = x => {
    let y = p.sill;
    for (const d of axles) {
      const dx = Math.abs(x - X(d));
      if (dx < arch) y = Math.max(y, p.R + Math.sqrt(arch * arch - dx * dx));
    }
    return y;
  };
  loft(put, stations(X(p.L), X(0), 0.2, axles.map(d => [X(d), arch + 0.02])), x => ({ bottom: bottom(x), top: top(x), half: plan(x), rTop: 0.06, rBottom: 0.06 }), () => 'paint');
  const roof = curve(
    [
      [X(0.95), 1.27],
      [X(1.75), p.roof - 0.05],
      [X(2.0), p.roof],
      [X(p.L - 0.05), p.roof],
      [X(p.L), p.roof - 0.04],
    ].reverse(),
  );
  // Glass on the screen and the cab doors only; the cargo box is painted.
  loft(
    put,
    stations(X(p.L), X(0.95), 0.2),
    x => ({ bottom: top(x) - 0.04, top: Math.max(top(x) + 0.02, roof(x)), half: plan(x) - 0.02, topHalf: plan(x) - 0.1, rTop: 0.14, rBottom: 0.02 }),
    ([x, y], n) => (n[1] > 0.7 ? 'paint' : x > X(2.15) && y < 2.05 && y > 1.32 ? 'glass' : x > X(1.2) && n[0] > 0.3 && y < 2.2 ? 'glass' : 'paint'),
  );
  for (const side of [-1, 1]) {
    put('headlamp', rbox(0.08, 0.14, 0.34, 0.03, X(0.18), 1.05, side * (half - 0.25)));
    put('taillamp', box(0.04, 0.42, 0.1, X(p.L), 1.2, side * (half - 0.07)));
    put('trim', rbox(0.12, 0.24, 0.12, 0.03, X(1.15), 1.95, side * (half + 0.12)));
    put('trim', box(0.02, 1.1, 0.012, X(2.2), 1.85, side * (plan(X(2.2)) - 0.005))); // sliding door seam
    put('trim', box(p.L - 1.3, 0.08, 0.025, X((1.0 + p.L) / 2), p.sill + 0.05, side * (half + 0.005))); // rub strip
  }
  put('trim', rbox(0.06, 0.24, p.W * 0.52, 0.03, X(0.04), 0.8, 0));
  put('trim', rbox(0.14, 0.2, p.W - 0.02, 0.05, X(0.06), 0.52, 0)); // bumper
  put('trim', rbox(0.12, 0.16, p.W - 0.02, 0.04, X(p.L - 0.05), 0.5, 0));
  put('trim', box(0.012, 1.7, 0.02, X(p.L + 0.006), 1.55, 0)); // rear door seam
  put('cargo', box(0.02, 0.15, 0.31, X(p.L + 0.01), 0.72, 0.4));
  for (const d of axles) {
    wheelHouse(put, X(d), arch - 0.01, half, p.R);
    for (const side of [-1, 1]) wheel(put, X(d), side * (half - p.tyre / 2 - 0.04), p.R, p.tyre);
  }
}

// ---- Trucks -------------------------------------------------------------------------------------------------------
// Conventional tractor (North American long nose) with a mid-roof sleeper and fairing. front: x of the bumper face.
export function buildTractor(put, front, { sleeper = true } = {}) {
  const X = d => front - d,
    W = 2.5,
    R = 0.52;
  put('metal', rbox(0.32, 0.42, W, 0.08, X(0.16), 0.66, 0)); // chrome bumper
  put('metal', rbox(0.1, 1.05, 1.15, 0.04, X(0.36), 1.4, 0)); // grille surround
  put('trim', box(0.06, 0.92, 1.0, X(0.33), 1.4, 0));
  for (let k = 0; k < 7; k++) put('metal', box(0.03, 0.025, 1.0, X(0.31), 1.0 + k * 0.13, 0)); // grille bars
  put('paint', rbox(2.1, 0.95, 1.5, 0.12, X(1.45), 1.48, 0)); // hood
  for (const side of [-1, 1]) {
    put('paint', rbox(1.25, 0.32, 0.42, 0.1, X(1.0), 1.1, side * 1.04)); // fender
    put('headlamp', rbox(0.06, 0.16, 0.34, 0.03, X(0.43), 1.32, side * 0.82));
    put('amber', box(0.04, 0.05, 0.16, X(2.5), 2.95, side * 1.0)); // cab roof marker
    put('metal', new T.CylinderGeometry(0.33, 0.33, 1.2, 14).rotateZ(Math.PI / 2).translate(X(3.6), 0.85, side * 1.1)); // fuel tank
    put('metal', new T.CylinderGeometry(0.08, 0.08, 2.6, 8).translate(X(sleeper ? 4.75 : 3.45), 2.55, side * 1.1)); // stack
    put('metal', rbox(0.12, 0.42, 0.06, 0.02, X(2.42), 2.35, side * 1.42)); // mirror
    put('trim', box(0.5, 0.06, 0.35, X(2.9), 0.55, side * 1.12)); // steps
    put('trim', box(0.5, 0.06, 0.35, X(2.9), 0.9, side * 1.12));
  }
  put('paint', rbox(1.6, 2.15, W - 0.05, 0.14, X(3.1), 2.07, 0)); // cab
  put('glass', rbox(0.06, 0.82, 2.2, 0.04, X(2.32), 2.48, 0)); // two-piece screen
  put('trim', box(0.07, 0.86, 0.06, X(2.31), 2.48, 0));
  for (const side of [-1, 1]) put('glass', rbox(0.8, 0.66, 0.04, 0.03, X(2.85), 2.52, side * (W / 2 - 0.02)));
  if (sleeper) {
    put('paint', rbox(1.3, 2.55, W - 0.05, 0.12, X(4.4), 2.27, 0)); // sleeper
    put('paint', rbox(1.9, 0.62, W - 0.2, 0.25, X(3.85), 3.42, 0)); // roof fairing
  }
  put('trim', box(sleeper ? 5.0 : 3.6, 0.3, 1.0, X(sleeper ? 3.2 : 2.5), 0.85, 0)); // frame
  put('trim', box(1.1, 0.12, 1.8, X(sleeper ? 5.75 : 4.3), 1.12, 0)); // fifth wheel
  wheel(put, X(1.0), 1.0, R, 0.31, { truck: true });
  wheel(put, X(1.0), -1.0, R, 0.31, { truck: true });
  for (const d of sleeper ? [5.35, 6.65] : [4.1, 5.4])
    for (const side of [-1, 1]) wheel(put, X(d), side * 1.06, R, 0.28, { dual: true, truck: true });
  return { length: sleeper ? 7.0 : 5.6 };
}
// Box truck: short cab-over-engine cab, chassis and an aluminium box with roller door.
function buildTruck(put) {
  const L = 7.6,
    X = d => L / 2 - d,
    R = 0.48;
  put('trim', rbox(0.18, 0.32, 2.4, 0.06, X(0.1), 0.62, 0)); // bumper
  put('paint', rbox(1.75, 1.9, 2.36, 0.16, X(0.95), 1.82, 0)); // cab
  put('glass', rbox(0.08, 0.8, 2.05, 0.05, X(0.08), 2.18, 0)); // screen
  put('trim', rbox(0.06, 0.34, 1.6, 0.04, X(0.07), 1.25, 0)); // grille
  for (const side of [-1, 1]) {
    put('headlamp', rbox(0.06, 0.16, 0.3, 0.03, X(0.08), 0.92, side * 0.9));
    put('glass', rbox(0.9, 0.7, 0.04, 0.04, X(0.75), 2.2, side * 1.18));
    put('metal', rbox(0.1, 0.4, 0.05, 0.02, X(0.05), 2.25, side * 1.3)); // mirror
    put('trim', box(0.4, 0.06, 0.25, X(0.95), 0.55, side * 1.12)); // step
    put('metal', new T.CylinderGeometry(0.25, 0.25, 0.9, 12).rotateZ(Math.PI / 2).translate(X(2.6), 0.75, side * 0.95)); // tank
    put('amber', box(0.12, 0.06, 0.03, X(4.5), 1.25, side * 1.24)); // side marker
    put('taillamp', box(0.04, 0.2, 0.25, X(L - 0.02), 1.15, side * 0.95));
  }
  put('trim', box(L - 1.2, 0.28, 1.0, X(L / 2 + 0.3), 0.75, 0)); // chassis
  put('cargo', rbox(5.6, 2.55, 2.48, 0.05, X(L - 2.8), 2.2, 0)); // box
  put('livery', box(5.3, 0.14, 2.5, X(L - 2.8), 1.4, 0));
  // Rear frame around the roller door (the door itself is the box's own face).
  for (const z of [-1.17, 1.17]) put('metal', box(0.03, 2.5, 0.08, X(L - 0.01), 2.2, z));
  put('metal', box(0.03, 0.1, 2.42, X(L - 0.01), 3.42, 0));
  for (let k = 1; k < 6; k++) put('metal', box(0.01, 0.015, 2.3, X(L + 0.01), 0.95 + k * 0.42, 0)); // roller door slats
  put('metal', box(0.12, 0.14, 2.1, X(L - 0.12), 0.52, 0)); // underrun bar
  wheel(put, X(1.15), 1.03, R, 0.29, { truck: true });
  wheel(put, X(1.15), -1.03, R, 0.29, { truck: true });
  for (const side of [-1, 1]) wheel(put, X(5.35), side * 1.07, R, 0.27, { dual: true, truck: true });
}

export const VEHICLE_BUILDERS = {
  sedan: put => buildCar(put, CAR.sedan),
  hatchback: put => buildCar(put, CAR.hatchback),
  suv: put => buildCar(put, CAR.suv),
  pickup: buildPickup,
  van: buildVan,
  truck: buildTruck,
  // Tractor in front of the 8.7 m semi-trailer (the trailer runs from x = -6.65 to 2.05).
  semi: put => buildTractor(put, 6.65),
};
