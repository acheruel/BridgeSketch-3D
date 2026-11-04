import * as T from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { VEHICLE_BUILDERS, VEHICLE_SPECS, buildTractor } from './car-models.mjs';

// 0.6.6: procedural vehicles with realistic proportions (car-models.mjs) replace the Kenney Car Kit meshes.
export const vehicleKinds = Object.freeze(['sedan', 'suv', 'hatchback', 'pickup', 'van', 'truck', 'semi', 'double']);
// Four of each ordinary vehicle for every road train.
export function trafficKind(index) {
  const slot = Math.abs(Math.trunc(index)) % 29;
  return slot === 28 ? 'double' : vehicleKinds[slot % (vehicleKinds.length - 1)];
}
const surface = (color, roughness = 0.5, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness });

// Clear-coated paint (0.7.0). One MeshPhysicalMaterial program is shared by every paint colour; set to false to fall
// back to a plain glossy MeshStandardMaterial if a very weak GPU ever struggles. Note: with scene.environment, three
// ignores material.envMapIntensity (scene.environmentIntensity rules), so reflectivity is tuned with colour/metalness.
const CLEARCOAT = true;
const coat = (color, flake = 0) =>
  CLEARCOAT
    ? new T.MeshPhysicalMaterial({
        color,
        roughness: 0.42 - 0.14 * flake,
        metalness: 0.05 + 0.4 * flake,
        clearcoat: 0.85,
        clearcoatRoughness: 0.07,
      })
    : surface(color, 0.3, 0.2 + 0.4 * flake);

const finishes = {
  paint: coat('#2a5a8c', 0.5),
  // Tyres are almost black so the bright rims and body read against them.
  rubber: surface('#0f1316', 0.96),
  // Black plastic trim and bumpers.
  trim: surface('#2a3135', 0.52, 0.12),
  // Chrome: low roughness, high metalness → mirrors the sky environment.
  metal: surface('#c6cdcf', 0.22, 0.8),
  // Dark tinted privacy glass; metal-ish reflectance (≈10–15 %) gives a crisp, bluish sky reflection by day.
  glass: surface('#4d6671', 0.05, 0.85),
  cargo: surface('#dfe5e5', 0.46, 0.06),
  headlamp: surface('#f4f2e4', 0.08, 0.2),
  taillamp: surface('#a8201a', 0.2, 0.1),
  amber: surface('#e0a233', 0.3, 0.1),
  // Roof boxes and racks.
  carrier: surface('#1c2225', 0.42, 0.25),
};
const LAMPS = { head: 0.16, tail: 0.3 };
finishes.headlamp.emissive.set('#ffdf9d');
finishes.headlamp.emissiveIntensity = LAMPS.head;
finishes.taillamp.emissive.set('#a52310');
finishes.taillamp.emissiveIntensity = LAMPS.tail; // brake/tail lenses keep a faint glow by day
// Night driving (0.6.0): headlamps and tail lamps glow after dusk (emissive only: no extra lights or passes).
export function setVehicleLights(level) {
  finishes.headlamp.emissiveIntensity = LAMPS.head + 3.2 * level;
  finishes.taillamp.emissiveIntensity = LAMPS.tail + 2.25 * level;
}

// ---- Paint palettes (0.7.0) ------------------------------------------------------------------------------------
// Real traffic is dominated by white, black, grey and silver with a few colour accents. Each entry:
// [hex, weight, metallic flake 0–1, trailer hex, livery-stripe hex (null = the paint colour)].
const CAR_PALETTE = [
  ['#e3e6e5', 24, 0.1], // white
  ['#16191b', 15, 0.3], // black
  ['#53595d', 12, 0.6], // graphite
  ['#b6bcbf', 13, 0.7], // silver
  ['#848c91', 7, 0.6], // grey
  ['#2a5a8c', 7, 0.5], // blue
  ['#1d2f4d', 3, 0.5], // navy
  ['#a9262b', 6, 0.35], // red
  ['#63202c', 2, 0.4], // burgundy
  ['#2f5c47', 3, 0.4], // green
  ['#c8b995', 3, 0.45], // champagne
  ['#6b4b37', 1.5, 0.4], // brown
  ['#d77a2b', 1.5, 0.2], // orange
  ['#dfb83c', 1, 0.1], // yellow
];
const COMMERCIAL_PALETTE = [
  ['#e8ebea', 42, 0.05, '#e8ecec', '#2b5b8f'], // white cab and trailer, blue stripe
  ['#e8ebea', 8, 0.05, '#d3d9db', '#a9262b'], // white cab, light-grey trailer, red stripe
  ['#b6bcbf', 8, 0.6, '#e1e6e7', '#2f5c47'], // silver cab, green stripe
  ['#2a5a8c', 11, 0.3, '#dfe6ea', null], // blue cab, white trailer
  ['#2a5a8c', 4, 0.3, '#2a5a8c', '#e8ebea'], // blue cab and trailer
  ['#a9262b', 8, 0.2, '#e6e8e8', null], // red cab, white trailer
  ['#a9262b', 3, 0.2, '#a9262b', '#e8ebea'], // red cab and trailer
  ['#2f6b4f', 5, 0.2, '#e1e6e5', null], // green
  ['#dfb83c', 3, 0.1, '#e6e8e8', '#16191b'], // yellow
  ['#16191b', 3, 0.3, '#d6dcdd', '#a9262b'], // black
  ['#d77a2b', 2, 0.1, '#e6e8e8', null], // orange
  ['#53595d', 3, 0.6, '#cfd5d7', '#2a5a8c'], // graphite
];
// Cyclists wear vivid jerseys instead of car paint.
const JERSEY_PALETTE = ['#d23b32', '#2f6fb5', '#e8c52f', '#2e9a62', '#e5e8e6', '#e0702a', '#7a4cb0', '#16191b'].map(c => [c, 1]);
const palettes = {
  car: CAR_PALETTE,
  commercial: COMMERCIAL_PALETTE,
  cyclist: JERSEY_PALETTE,
};
const cumulative = list => {
  let total = 0;
  return list.map(entry => (total += entry[1]));
};
const cumulativeWeights = Object.fromEntries(Object.entries(palettes).map(([k, list]) => [k, cumulative(list)]));
const paintCache = new Map(),
  solidCache = new Map(),
  cargoCache = new Map();
const solidPaint = hex => {
  if (!solidCache.has(hex)) solidCache.set(hex, coat(hex, 0.1));
  return solidCache.get(hex);
};
const cargoPaint = hex => {
  if (!cargoCache.has(hex)) cargoCache.set(hex, surface(hex, 0.46, 0.06));
  return cargoCache.get(hex);
};

// Deterministic 0–1 hash of an integer (and a salt), so a given scene always shows the same traffic.
export function vehicleRandom(n, salt = 0) {
  let h = ((Math.trunc(n) | 0) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Shared, cached paint material for a vehicle; `seed` is any integer (the same seed always gives the same colour).
// Commercial paints also carry the matching trailer and livery-stripe materials in userData.
export function vehiclePaint(seed, type = 'sedan') {
  const set = type === 'cyclist' ? 'cyclist' : ['van', 'truck', 'semi', 'double'].includes(type) ? 'commercial' : 'car',
    weights = cumulativeWeights[set],
    r = vehicleRandom(seed, 11) * weights.at(-1);
  const index = Math.max(
    0,
    weights.findIndex(w => r < w),
  );
  const key = `${set}${index}`;
  if (!paintCache.has(key)) {
    const [hex, , flake = 0, cargo, stripe] = palettes[set][index];
    const paint = set === 'cyclist' ? surface(hex, 0.62, 0.05) : coat(hex, flake);
    if (cargo) paint.userData.cargo = cargoPaint(cargo);
    if (stripe) paint.userData.stripe = solidPaint(stripe);
    paintCache.set(key, paint);
  }
  return paintCache.get(key);
}

// Resolves a part's material name; callers may still override any of them with `vehicle_<name>` entries.
function resolver(paint, materials) {
  const cargo = paint.userData.cargo ?? finishes.cargo,
    livery = paint.userData.stripe ?? paint;
  return name =>
    name === 'paint'
      ? paint
      : (materials[`vehicle_${name}`] ??
        (name === 'cargo' ? cargo : name === 'livery' ? livery : finishes[name]));
}

const cyclistFinishes = {
  skin: surface('#bb8865', 0.87),
  trousers: surface('#263d52', 0.88),
  helmet: surface('#d76b42', 0.48),
  spoke: surface('#87999d', 0.66, 0.35),
};
const templates = new Map();

export function vehicleDimensions(type) {
  if (type === 'cyclist') return { length: 1.75, width: 0.68, height: 1.8, halfLength: 0.95, halfWidth: 0.37 };
  const d =
    type === 'double' ? { length: DOUBLE.length, width: 2.6, height: DOUBLE.height } : VEHICLE_SPECS[type === 'car' ? 'sedan' : type];
  if (!d) throw new Error(`Unknown vehicle: ${type}`);
  return {
    length: d.length,
    width: d.width,
    height: d.height,
    halfLength: d.length / 2 + 0.08,
    halfWidth: d.width / 2 + 0.06,
  };
}

// Procedural bodies (semi trailer, double) are baked once into one merged geometry per material and shared by every
// instance: dozens of boxes and wheels become a handful of draw calls.
function bakeParts(build) {
  const buckets = new Map();
  const put = (material, geometry, x = 0, y = 0, z = 0, spin = false) => {
    if (spin) geometry.rotateX(Math.PI / 2); // cylinders: axis Y → Z (wheels)
    geometry.translate(x, y, z);
    // One attribute layout for the merge: positions and normals, no index, no UVs.
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.clearGroups();
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material).push(geometry);
  };
  build(put);
  return [...buckets].map(([material, geos]) => {
    const geometry = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    return { material, geometry };
  });
}
const baked = new Map();
const bakedParts = (key, build) => {
  if (!baked.has(key)) baked.set(key, bakeParts(build));
  return baked.get(key);
};
// Instances share the template geometry (disposeModel skips meshes flagged sharedGeometry).
function addPart(group, part, material, label) {
  const mesh = new T.Mesh(part.geometry, material(part.material));
  mesh.name = `${label} ${part.material}`;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.sharedGeometry = true;
  group.add(mesh);
  return mesh;
}

// Double (train routier, 0.6.0): long-nose tractor with sleeper and two 8.2 m pup trailers joined by a converter
// dolly; 18.0 m from the steer axle to the last axle, 4.15 m from the asphalt to the top of the trailers.
export const DOUBLE = { length: 21.6, height: 4.15, frontAxle: 1.3, lastAxle: 19.3 };
function buildDouble(put) {
  const L = DOUBLE.length,
    x = d => L / 2 - d; // distance from the front bumper → local x (+X forward)
  const box = (mat, d0, d1, y0, y1, w, z = 0) =>
    put(mat, new T.BoxGeometry(d1 - d0, y1 - y0, w), x((d0 + d1) / 2), (y0 + y1) / 2, z);
  const wheel = (d, z, dual = false) => {
    const r = 0.52,
      t = dual ? 0.56 : 0.3;
    put('rubber', new T.CylinderGeometry(r, r, t, 18), x(d), r, z, true);
    put('metal', new T.CylinderGeometry(0.3, 0.3, t + 0.01, 14), x(d), r, z + Math.sign(z) * 0.005, true);
  };
  // Tractor (0.6.6: the procedural long-nose tractor with sleeper of car-models.mjs).
  buildTractor(put, L / 2);
  // Trailer 1 (5.2–13.4) on the fifth wheel, converter dolly with draw bar, trailer 2 (13.4–21.6).
  const trailer = (d0, d1, axle) => {
    box('cargo', d0, d1, 1.25, DOUBLE.height, 2.6); // dry-van box
    box('trim', d0 + 0.1, d1 - 0.1, 1.02, 1.25, 1.9); // chassis
    for (const z of [-1.301, 1.301]) {
      box('livery', d0 + 0.3, d1 - 0.3, 1.45, 1.6, 0.02, z);
      for (let d = d0 + 0.8; d < d1 - 0.3; d += 1.2) box('amber', d, d + 0.1, 1.33, 1.4, 0.03, z * 1.005); // markers
      box('taillamp', d1 - 0.02, d1 + 0.01, 1.3, 1.46, 0.34, z * 0.7);
      wheel(axle - 0.6, z * 0.92, true);
      wheel(axle + 0.6, z * 0.92, true);
      box('rubber', axle + 1.14, axle + 1.16, 0.35, 0.95, 0.5, z * 0.92); // mud flap
    }
    box('trim', d1 - 0.01, d1 + 0.01, 1.3, DOUBLE.height - 0.05, 0.03); // rear door seam
    box('metal', d1 - 0.25, d1 - 0.1, 0.5, 0.66, 2.1); // underrun bar
  };
  trailer(5.2, 13.4, 12.2);
  box('trim', 13.4, 14.5, 0.62, 0.72, 0.25); // dolly draw bar
  box('trim', 14.0, 15.3, 0.75, 1.0, 1.9); // dolly frame
  trailer(13.4, 21.6, DOUBLE.lastAxle - 0.6);
  for (const z of [-1.08, 1.08]) wheel(14.65, z * 0.92, true);
}

// Semi trailer behind the Kenney tractor (local x: the trailer runs from -6.65 to 2.05).
function buildSemiTrailer(put) {
  const box = (mat, x, y, z, w, h, d) => put(mat, new T.BoxGeometry(w, h, d), x, y, z);
  box('cargo', -2.3, 2.44, 0, 8.7, 2.66, 2.52);
  box('trim', -2.3, 1.01, 0, 8.6, 0.22, 1.94);
  for (const side of [-1, 1]) {
    box('metal', -2.3, 1.17, side * 1.27, 8.65, 0.1, 0.05); // lower rail
    box('metal', -2.3, 3.73, side * 1.27, 8.65, 0.08, 0.05); // roof rail
    box('livery', -2.3, 1.46, side * 1.268, 8.5, 0.15, 0.014);
    for (let x = -6.45; x < 2; x += 1.05) {
      box('metal', x, 2.46, side * 1.269, 0.015, 2.4, 0.008); // panel seam
      box('amber', x, 1.22, side * 1.3, 0.11, 0.065, 0.025); // side marker
    }
    for (const x of [-5.75, -4.55]) {
      put('rubber', new T.CylinderGeometry(0.5, 0.5, 0.28, 20), x, 0.5, side * 1.16, true);
      put('metal', new T.CylinderGeometry(0.3, 0.3, 0.293, 16), x, 0.5, side * 1.16, true);
      put('trim', new T.CylinderGeometry(0.11, 0.11, 0.31, 12), x, 0.5, side * 1.16, true);
    }
    box('rubber', -6.35, 0.38, side * 1.16, 0.02, 0.6, 0.45); // mud flap
    box('taillamp', -6.669, 1.17, side * 0.92, 0.032, 0.16, 0.34);
    box('metal', -6.669, 2.47, side * 0.66, 0.024, 2.2, 0.038); // door locking bar
  }
  box('trim', -6.657, 2.44, 0, 0.02, 2.46, 0.025); // rear door seam
  box('metal', -6.56, 0.53, 0, 0.12, 0.16, 2.12); // underrun bar
}

export function createVehicleModel(type, paintMaterial, materials = {}) {
  if (type === 'cyclist') return createCyclistModel(paintMaterial);
  if (type === 'double') {
    const group = new T.Group(),
      material = resolver(paintMaterial ?? finishes.paint, materials);
    group.name = 'double';
    group.userData = { ...vehicleDimensions('double'), source: 'BridgeSketch 3D procedural double', units: 'metres', forwardAxis: '+X' };
    for (const part of bakedParts('double', buildDouble)) addPart(group, part, material, 'double');
    return group;
  }
  if (type === 'car') type = 'sedan';
  const dimensions = vehicleDimensions(type),
    group = new T.Group(),
    material = resolver(paintMaterial ?? finishes.paint, materials);
  group.name = type;
  group.userData = { ...dimensions, source: 'BridgeSketch 3D procedural vehicle', units: 'metres', forwardAxis: '+X' };
  for (const part of bakedParts(type, VEHICLE_BUILDERS[type])) addPart(group, part, material, type);
  if (type === 'semi') for (const part of bakedParts('semi-trailer', buildSemiTrailer)) addPart(group, part, material, type);
  return group;
}

// ---- Accessories and contact shadow (0.7.0) ---------------------------------------------------------------------
// Roof boxes (sedan, hatchback) and a ladder/pipe rack (van): shared geometry, one extra mesh on a minority of
// vehicles. `r` is a 0–1 deterministic random; the accessory appears when r < chance.
const ROOF = {
  sedan: { chance: 0.16, x: -0.3, y: 1.46, kind: 'box' },
  hatchback: { chance: 0.14, x: -0.35, y: 1.48, kind: 'box' },
  van: { chance: 0.35, x: -0.6, y: 2.56, kind: 'rack' },
};
const roofGeometry = {};
function roofParts(kind) {
  if (roofGeometry[kind]) return roofGeometry[kind];
  const parts = [];
  if (kind === 'box') {
    parts.push(new T.BoxGeometry(0.85, 0.24, 0.76).translate(0, 0.1, 0));
    parts.push(new T.BoxGeometry(0.64, 0.06, 0.6).translate(0, 0.25, 0)); // tapered lid
  } else {
    for (const z of [-0.38, 0.38]) parts.push(new T.BoxGeometry(2.6, 0.05, 0.05).translate(0, 0.0, z)); // rails
    for (const dx of [-1.1, -0.37, 0.37, 1.1]) parts.push(new T.BoxGeometry(0.05, 0.05, 0.86).translate(dx, 0.05, 0));
    for (const z of [-0.2, 0.2]) parts.push(new T.CylinderGeometry(0.045, 0.045, 2.9, 8).rotateZ(Math.PI / 2).translate(0, 0.13, z)); // pipes
  }
  roofGeometry[kind] = mergeGeometries(parts, false);
  parts.forEach(g => g.dispose());
  return roofGeometry[kind];
}
export function addRoofAccessory(group, type, r) {
  const spec = ROOF[type];
  if (!spec || r >= spec.chance) return null;
  const mesh = new T.Mesh(roofParts(spec.kind), finishes.carrier);
  mesh.name = `${type} roof ${spec.kind === 'box' ? 'box' : 'rack'}`;
  mesh.position.set(spec.x, spec.y, 0);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.sharedGeometry = true;
  group.add(mesh);
  return mesh;
}

// Fake ambient-occlusion blob under each vehicle: one shared 64 px soft rounded-rectangle alpha map, shared unit
// quad and shared material (no lights, no extra pass, one extra draw call per vehicle). It is a child of the vehicle,
// so it follows the deck position, grade and crossfall bank exactly like the body.
let shadowKit;
function contactShadowKit() {
  if (shadowKit) return shadowKit;
  const N = 64,
    pixels = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 - 1,
        y = ((j + 0.5) / N) * 2 - 1,
        d = Math.sqrt(Math.sqrt(x ** 4 + y ** 4)), // squircle distance: rounded-rectangle footprint
        t = Math.min(1, Math.max(0, (d - 0.3) / 0.7)),
        a = (1 - t * t * (3 - 2 * t)) ** 1.8,
        k = (j * N + i) * 4;
      pixels[k] = pixels[k + 1] = pixels[k + 2] = 255;
      pixels[k + 3] = Math.round(255 * a);
    }
  const map = new T.DataTexture(pixels, N, N, T.RGBAFormat, T.UnsignedByteType);
  map.magFilter = T.LinearFilter;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  shadowKit = {
    geometry: new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    material: new T.MeshBasicMaterial({
      color: '#07090b',
      map,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    }),
  };
  shadowKit.material.name = 'Contact shadow';
  return shadowKit;
}
export function createContactShadow(length, width) {
  const { geometry, material } = contactShadowKit(),
    mesh = new T.Mesh(geometry, material);
  mesh.name = 'Contact shadow';
  mesh.scale.set(length * 1.02 + 0.5, 1, width * 0.98 + 0.4);
  // 4.5 cm above the vehicle origin (road surface + 2.5 cm) clears the 2–4 % crossfall under a 2 m wide quad.
  mesh.position.set(0, 0.045, 0);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.userData.sharedGeometry = true;
  return mesh;
}

// Low-poly road cyclist in the Kenney traffic scale. The frame, rider body and
// arms are static; wheels, cranks and legs are animated sub-groups driven by the
// distance travelled, so pedalling and wheel speed always match the motion.
const bikeFinishes = {
  tyre: surface('#15191c', 0.9),
  rim: surface('#c9d0d2', 0.28, 0.75),
  spoke: surface('#9aa6a9', 0.4, 0.6),
  chainring: surface('#7c868a', 0.35, 0.8),
  saddle: surface('#1d2327', 0.7),
  bar: surface('#2a3034', 0.5, 0.3),
  shoe: surface('#f2f2ee', 0.55),
  glove: surface('#20262a', 0.8),
  lens: surface('#1b2b33', 0.15, 0.4),
};
function rodMesh(material, radius, segments = 7) {
  const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, 1, segments), material);
  mesh.castShadow = true;
  return mesh;
}
function placeRod(mesh, a, b) {
  const from = new T.Vector3(...a),
    to = new T.Vector3(...b),
    delta = to.clone().sub(from),
    length = delta.length() || 1e-3;
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.multiplyScalar(1 / length));
  return mesh;
}
function createCyclistModel(jersey = finishes.paint) {
  const g = new T.Group(),
    { skin, trousers, helmet } = cyclistFinishes,
    frame = jersey,
    { tyre, rim, chainring, saddle, bar, shoe, glove, lens } = bikeFinishes;
  const rod = (name, a, b, r, mat, segments) => {
    const mesh = placeRod(rodMesh(mat, r, segments), a, b);
    mesh.name = name;
    g.add(mesh);
    return mesh;
  };
  const R = 0.34,
    rear = [-0.5, R, 0],
    front = [0.5, R, 0],
    bb = [-0.07, 0.3, 0],
    seatTop = [-0.22, 0.9, 0],
    headTop = [0.37, 0.88, 0],
    headLow = [0.4, 0.74, 0];
  // Wheels: tyre, rim and 16 spokes, rotating about the axle.
  const wheels = [];
  for (const [x, y] of [rear, front]) {
    const wheel = new T.Group();
    wheel.name = 'Bicycle wheel';
    wheel.position.set(x, y, 0);
    // Rim, hub and 16 spokes share one merged mesh per wheel to keep draw calls low.
    const t = new T.Mesh(new T.TorusGeometry(R - 0.02, 0.022, 6, 24), tyre),
      parts = [
        new T.TorusGeometry(R - 0.05, 0.012, 4, 24),
        new T.CylinderGeometry(0.03, 0.03, 0.1, 8).rotateX(Math.PI / 2),
      ];
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8,
        side = k % 2 ? 0.02 : -0.02,
        sp = placeRod(rodMesh(rim, 0.0035, 3), [0, 0, side], [Math.cos(a) * (R - 0.05), Math.sin(a) * (R - 0.05), 0]);
      sp.updateMatrix();
      parts.push(sp.geometry.clone().applyMatrix4(sp.matrix));
      sp.geometry.dispose();
    }
    const spokes = new T.Mesh(
      mergeGeometries(
        parts.map(g => (g.index ? g.toNonIndexed() : g)),
        false,
      ),
      rim,
    );
    parts.forEach(g => g.dispose());
    t.castShadow = true;
    wheel.add(t, spokes);
    g.add(wheel);
    wheels.push(wheel);
  }
  // Diamond frame, fork, seat post, saddle and drop handlebar.
  for (const [a, b] of [
    [bb, seatTop],
    [seatTop, headTop],
    [bb, headLow],
    [bb, rear],
    [[-0.2, 0.86, 0], rear],
  ])
    rod('Bicycle frame', a, b, 0.02, frame);
  for (const z of [-0.045, 0.045]) rod('Fork blade', [0.4, 0.74, z], [front[0], front[1], z], 0.013, frame);
  rod('Head tube', headLow, headTop, 0.024, frame);
  rod('Seat post', seatTop, [-0.25, 0.99, 0], 0.014, bar);
  rod('Saddle', [-0.35, 1.0, 0], [-0.15, 1.0, 0], 0.035, saddle);
  rod('Stem', headTop, [0.47, 0.96, 0], 0.016, bar);
  rod('Handlebar', [0.47, 0.96, -0.21], [0.47, 0.96, 0.21], 0.016, bar);
  for (const z of [-0.2, 0.2]) {
    rod('Bar drop', [0.47, 0.96, z], [0.55, 0.9, z], 0.015, bar);
    rod('Bar drop', [0.55, 0.9, z], [0.5, 0.83, z], 0.015, bar);
  }
  // Rider: leaning torso, arms to the hoods, helmeted head with glasses.
  const hip = [-0.24, 1.03, 0],
    shoulder = [0.17, 1.4, 0];
  rod('Cyclist torso', hip, shoulder, 0.13, jersey, 8);
  rod('Cyclist shorts', [-0.3, 1.02, 0], [-0.12, 1.08, 0], 0.135, trousers, 8);
  for (const side of [-1, 1]) {
    const s = [0.15, 1.38, side * 0.17],
      elbow = [0.3, 1.2, side * 0.21],
      hand = [0.49, 0.98, side * 0.2];
    rod('Cyclist upper arm', s, elbow, 0.045, jersey);
    rod('Cyclist forearm', elbow, hand, 0.037, skin);
    const h = new T.Mesh(new T.IcosahedronGeometry(0.045, 0), glove);
    h.position.set(...hand);
    g.add(h);
  }
  rod('Cyclist neck', [0.2, 1.43, 0], [0.26, 1.52, 0], 0.045, skin);
  const face = new T.Mesh(new T.IcosahedronGeometry(0.105, 1), skin);
  face.position.set(0.29, 1.58, 0);
  face.castShadow = true;
  g.add(face);
  const cap = new T.Mesh(new T.SphereGeometry(0.125, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), helmet);
  cap.position.set(0.27, 1.61, 0);
  cap.scale.set(1.25, 1, 1);
  cap.rotation.z = -0.25;
  cap.castShadow = true;
  g.add(cap);
  const glasses = new T.Mesh(new T.BoxGeometry(0.03, 0.035, 0.19), lens);
  glasses.position.set(0.385, 1.595, 0);
  g.add(glasses);
  // Animated drivetrain: chainring and cranks turn about the bottom bracket.
  const crank = new T.Group();
  crank.name = 'Crankset';
  crank.position.set(...bb);
  const ring = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.012, 18), chainring);
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.06;
  crank.add(ring);
  const armParts = [];
  for (const side of [-1, 1]) {
    const turn = new T.Matrix4().makeRotationZ(side > 0 ? 0 : Math.PI),
      arm = placeRod(rodMesh(bar, 0.012, 5), [0, 0, side * 0.07], [0.17, 0, side * 0.07]);
    arm.updateMatrix();
    armParts.push(
      arm.geometry.clone().applyMatrix4(arm.matrix).applyMatrix4(turn).toNonIndexed(),
      new T.BoxGeometry(0.1, 0.02, 0.08)
        .translate(0.17, 0, side * 0.12)
        .applyMatrix4(turn)
        .toNonIndexed(),
    );
    arm.geometry.dispose();
  }
  crank.add(new T.Mesh(mergeGeometries(armParts, false), bar));
  armParts.forEach(g => g.dispose());
  g.add(crank);
  const legs = new T.Group();
  legs.name = 'Cyclist legs';
  g.add(legs);
  const leg = side => ({
    side,
    thigh: legs.add(rodMesh(trousers, 0.062, 7)) && legs.children.at(-1),
    shin: legs.add(rodMesh(skin, 0.045, 7)) && legs.children.at(-1),
    foot: legs.add(new T.Mesh(new T.BoxGeometry(0.2, 0.06, 0.08), shoe)) && legs.children.at(-1),
  });
  const limbs = [leg(-1), leg(1)],
    thighLength = 0.46,
    shinLength = 0.47,
    hipPoint = [-0.22, 1.0];
  const pose = distance => {
    for (const w of wheels) w.rotation.z = -distance / R;
    const angle = -distance / R / 2.7;
    crank.rotation.z = angle;
    for (const limb of limbs) {
      const a = angle + (limb.side > 0 ? 0 : Math.PI),
        pedal = [bb[0] + Math.cos(a) * 0.17, bb[1] + Math.sin(a) * 0.17],
        ankle = [pedal[0] - 0.02, pedal[1] + 0.05];
      const dx = ankle[0] - hipPoint[0],
        dy = ankle[1] - hipPoint[1],
        d = Math.min(thighLength + shinLength - 0.002, Math.hypot(dx, dy));
      const along = (thighLength ** 2 - shinLength ** 2 + d * d) / (2 * d),
        h = Math.sqrt(Math.max(0, thighLength ** 2 - along ** 2)),
        ux = dx / Math.hypot(dx, dy),
        uy = dy / Math.hypot(dx, dy);
      const k1 = [hipPoint[0] + ux * along - uy * h, hipPoint[1] + uy * along + ux * h],
        k2 = [hipPoint[0] + ux * along + uy * h, hipPoint[1] + uy * along - ux * h],
        knee = k1[0] >= k2[0] ? k1 : k2;
      const z = limb.side * 0.1;
      placeRod(limb.thigh, [hipPoint[0], hipPoint[1], z], [knee[0], knee[1], z]);
      placeRod(limb.shin, [knee[0], knee[1], z], [ankle[0], ankle[1], z + limb.side * 0.01]);
      limb.foot.position.set(pedal[0] + 0.02, pedal[1] + 0.03, limb.side * 0.12);
      limb.foot.rotation.z = -0.15;
    }
  };
  pose(0);
  g.name = 'Cyclist';
  g.userData = {
    ...vehicleDimensions('cyclist'),
    source: 'BridgeSketch low-poly geometry',
    units: 'metres',
    forwardAxis: '+X',
    pose,
  };
  return g;
}
