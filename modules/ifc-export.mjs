// BridgeSketch 3D · IFC export (0.6.6, audited in 0.6.8: every mesh of the model is exported). A plain STEP writer, no library: the bridge is rebuilt without batching and
// every structural member becomes an IFC element with its own class, name, material, colour and property set.
//
// Three schemas:
// · IFC2X3 (Coordination View 2.0): Revit 2022, 2023 and 2026 open it as a project (File › Open › IFC). Faceted
//   B-rep geometry; elements land in the matching Revit categories as non-editable shapes.
// · IFC4 (Reference View): Revit links it (Insert › Link IFC). Triangulated face sets, smaller files.
// · IFC4X3_ADD2: the infrastructure schema, with IfcBridge, bridge parts (superstructure, abutments, piers) and
//   IfcBearing; for Civil 3D, Tekla or an IFC viewer. The Revit 2026 help lists IFC 2x3 and IFC 4 only.
//
// Coordinates: the project frame of the road profile (File › Road profile…), metres, Z up; X east, Y north.
import * as T from 'three';
import { alignmentStation, stations, totalLength, steelFinishes } from './geometry.mjs';
import { concreteFinishes } from './materials.mjs';
import { FRONT_FACE, projectFrame } from './road-profile.mjs';

export const IFC_SCHEMAS = {
  IFC2X3: { label: 'IFC 2x3', file: 'IFC2X3', view: 'CoordinationView_V2.0' },
  IFC4: { label: 'IFC 4', file: 'IFC4', view: 'ReferenceView_V1.2' },
  IFC4X3: { label: 'IFC 4.3', file: 'IFC4X3_ADD2', view: 'ReferenceView' },
};

// ─── STEP text helpers ────────────────────────────────────────────────────────────────────────────────────
const GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
// IFC GlobalId: 128 random bits in 22 base-64 characters (the first one carries the top 2 bits).
export function ifcGuid(random = () => crypto.getRandomValues(new Uint8Array(16))) {
  let n = 0n;
  for (const b of random()) n = (n << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 22; i++) {
    out = GUID_CHARS[Number(n & 63n)] + out;
    n >>= 6n;
  }
  return out;
}
// ISO 10303-21 string: quotes doubled, backslashes escaped, anything beyond ASCII as \X2\hhhh\X0\.
export function stepString(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0);
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (code >= 32 && code < 127) out += ch;
    else if (code > 0xffff) {
      const hi = Math.floor((code - 0x10000) / 0x400) + 0xd800,
        lo = ((code - 0x10000) % 0x400) + 0xdc00;
      out += `\\X2\\${hi.toString(16).toUpperCase()}${lo.toString(16).toUpperCase()}\\X0\\`;
    } else if (code >= 127) out += `\\X2\\${code.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
  }
  return `'${out.replace(/\\X0\\\\X2\\/g, '')}'`;
}
// Reals always carry a decimal point; 4 decimals (0.1 mm) for coordinates.
export const real = (v, digits = 6) => {
  if (!Number.isFinite(v)) throw Error('IFC export: invalid number.');
  const r = Number(v.toFixed(digits));
  const s = String(Object.is(r, -0) ? 0 : r);
  return /[.eE]/.test(s) ? s : s + '.';
};
const enumv = e => `.${e}.`;
const list = items => `(${items.join(',')})`;

class StepWriter {
  constructor() {
    this.lines = [];
    this.n = 0;
  }
  add(entity, ...args) {
    const id = ++this.n;
    this.lines.push(`#${id}=${entity}(${args.join(',')});`);
    return `#${id}`;
  }
}

// ─── Classification ───────────────────────────────────────────────────────────────────────────────────────
// 0.6.8: every mesh of the model is exported (see the audit in dist/tests/check.mjs); the only exclusions are the
// non-physical helpers listed in NON_PHYSICAL.
// [pattern, IFC class, predefined type per schema (2x3 / 4 / 4.3), part: 'super' (superstructure) or 'sub']
const PROXY = [null, 'ELEMENT', 'ELEMENT'];
const RULES = [
  [/^Road marking/, 'IfcBuildingElementProxy', PROXY, 'super'],
  [/^Wheel curb/, 'IfcBuildingElementProxy', PROXY, 'super'],
  [/^Slope protection/, 'IfcBuildingElementProxy', PROXY, 'sub'],
  [/^Street light pole/, 'IfcBuildingElementProxy', PROXY, 'super'],
  [/^LED luminaire|^Handrail LED/, 'IfcLightFixture', [null, 'NOTDEFINED', 'NOTDEFINED'], 'super'],
  [/^Gusset bolts/, 'IfcMechanicalFastener', [null, 'BOLT', 'BOLT'], 'super'],
  [/formliner/i, 'IfcCovering', ['CLADDING', 'CLADDING', 'CLADDING'], 'sub'],
  [/^Approach slab/, 'IfcSlab', ['BASESLAB', 'BASESLAB', 'APPROACH_SLAB'], 'sub'],
  [/^Approach pavement/, 'IfcSlab', ['BASESLAB', 'BASESLAB', 'PAVING'], 'sub'],
  [/^Median island/, 'IfcSlab', ['FLOOR', 'FLOOR', 'SIDEWALK'], 'super'],
  [/^Deck slab|^Solid slab|^Concrete deck haunch/, 'IfcSlab', ['FLOOR', 'FLOOR', 'FLOOR'], 'super'],
  [/^Wearing surface/, 'IfcCovering', ['FLOORING', 'FLOORING', 'FLOORING'], 'super'],
  [/^Sidewalk/, 'IfcSlab', ['FLOOR', 'FLOOR', 'SIDEWALK'], 'super'],
  [/^Centre median/, 'IfcRailing', ['GUARDRAIL', 'GUARDRAIL', 'GUARDRAIL'], 'super'],
  [/^Concrete barrier|^Railing|^Barrier rail|^W-beam/, 'IfcRailing', ['GUARDRAIL', 'GUARDRAIL', 'GUARDRAIL'], 'super'],
  [/Box girder part|^Span \d+ girder|^Continuous girder|box girder|^Box girder \d/, 'IfcBeam', [null, 'BEAM', 'GIRDER_SEGMENT'], 'super'],
  [/diaphragm|K-bracing/i, 'IfcBeam', [null, 'BEAM', 'DIAPHRAGM'], 'super'],
  [/^Tie beam|^Portal tie beam|^End cross-girder|^Floor beam|^Spandrel cross-beam/, 'IfcBeam', [null, 'BEAM', 'BEAM'], 'super'],
  [/^Cross-frames/, 'IfcMember', [null, 'BRACE', 'BRACE'], 'super'],
  [/^Web stiffeners/, 'IfcPlate', [null, 'SHEET', 'STIFFENER_PLATE'], 'super'],
  [/^Truss (top|bottom) chord/, 'IfcMember', [null, 'CHORD', 'CHORD'], 'super'],
  [/^Truss (end )?post/, 'IfcMember', [null, 'POST', 'POST'], 'super'],
  [/^Truss diagonal|^Floor beam outrigger/, 'IfcMember', [null, 'MEMBER', 'MEMBER'], 'super'],
  [/footing|springing/i, 'IfcFooting', ['PAD_FOOTING', 'PAD_FOOTING', 'PAD_FOOTING'], 'sub'],
  [/^Strutted frame leg/, 'IfcColumn', [null, 'COLUMN', 'COLUMN'], 'sub'],
  [/strut/i, 'IfcMember', [null, 'STRUT', 'STRUT'], 'super'],
  [/brac|brace/i, 'IfcMember', [null, 'BRACE', 'BRACE'], 'super'],
  [/^Arch rib/, 'IfcMember', [null, 'MEMBER', 'ARCH_SEGMENT'], 'super'],
  [/^Hanger/, 'IfcMember', [null, 'MEMBER', 'SUSPENDER'], 'super'],
  [/^Bearing pad/, 'IfcBearing', ['ELASTOMERIC', 'ELASTOMERIC', 'ELASTOMERIC'], 'sub'],
  [/^Bearing plinth/, 'IfcBuildingElementProxy', PROXY, 'sub'],
  [/^Pier cap|^Hammerhead flare/, 'IfcBeam', [null, 'BEAM', 'PIERCAP'], 'sub'],
  [/^Return wall|^MSE approach wall/, 'IfcWall', [null, 'SOLIDWALL', 'RETAININGWALL'], 'sub'],
  [/^Abutment seat|backwall|^Girder screen|^Pier wall|^Wingwall/, 'IfcWall', [null, 'SOLIDWALL', 'SOLIDWALL'], 'sub'],
  [/^Strutted frame leg|^Spandrel column|^Crown block/, 'IfcColumn', [null, 'COLUMN', 'COLUMN'], 'sub'],
  [/column|^Hammerhead stem|^Portal leg|^V pier arm|pier end$/i, 'IfcColumn', [null, 'COLUMN', 'PIERSTEM'], 'sub'],
];
const FALLBACK = ['IfcBuildingElementProxy', PROXY, 'sub'];
const SCHEMA_INDEX = { IFC2X3: 0, IFC4: 1, IFC4X3: 2 };

// Display colours (sRGB) by material key of the BridgeSketch materials.
const MATERIAL_INFO = {
  concrete: { name: 'Concrete', colour: '#a5a397' },
  edge: { name: 'Concrete', colour: '#aaa99e' },
  asphalt: { name: 'Asphalt', colour: '#30363a' },
  steel: { name: 'Structural steel', colour: '#64707a' },
  steelFascia: { name: 'Structural steel', colour: '#64707a' },
  railing: { name: 'Galvanised steel', colour: '#9ba6a6' },
  guardrail: { name: 'Galvanised steel', colour: '#9da6a1' },
  sdc: { name: 'Painted steel', colour: '#d6dad8' },
  dark: { name: 'Elastomer', colour: '#253037' },
  stone: { name: 'Stone riprap', colour: '#8c8a84' },
  white: { name: 'Road marking paint', colour: '#ebe6cf' },
  yellow: { name: 'Road marking paint', colour: '#eec45f' },
  lens: { name: 'Luminaire glass', colour: '#2a2e33' },
};

// Objects of the model that are not building elements and are therefore not exported: the road traffic, and the
// light helpers (additive light pools, lamp glow sprites, point lights).
const NON_PHYSICAL = /^(Traffic|Light pools|Lamp glow|Lamp light)$/;

// « West approach railing » → « Approach railing » style helper: first letter in lower case.
const lower = text => text.charAt(0).toLowerCase() + text.slice(1);

// ─── Collect the bridge members ───────────────────────────────────────────────────────────────────────────
// model: buildBridge(c, materials, { batch: false, site: false, lights: true }); materials: the shared material set.
// Returns the elements (one per group of meshes); the array's `skipped` lists the meshes left out, with the reason.
export function collectElements(c, model, materials) {
  const key = new Map(Object.entries(materials).map(([k, v]) => [v, k])),
    L = totalLength(c),
    ss = stations(c),
    spanOf = s => Math.max(0, Math.min(c.spans.length - 1, ss.findIndex((v, i) => i > 0 && s <= v + 1e-6) - 1)),
    supportOf = s => ss.reduce((best, v, j) => (Math.abs(v - s) < Math.abs(ss[best] - s) ? j : best), 0),
    groups = new Map(),
    skipped = [];
  model.root.updateMatrixWorld(true);
  const v = new T.Vector3(),
    m4 = new T.Matrix4();
  // One physical piece: a mesh (or one instance of an InstancedMesh) with its world matrix.
  const take = (o, matrix, name, mat, instance = -1) => {
    const pos = o.geometry.attributes.position,
      index = o.geometry.index,
      count = index ? index.count : pos.count,
      world = new Float64Array(pos.count * 3);
    let cx = 0,
      cz = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      world.set([v.x, v.y, v.z], i * 3);
      cx += v.x / pos.count;
      cz += v.z / pos.count;
    }
    if (!world.every(Number.isFinite)) {
      skipped.push({ name, reason: 'non-finite coordinates' });
      return;
    }
    const station = alignmentStation(c, cx, cz),
      side = sideOf(c, cx, cz),
      sideName = side < 0 ? 'left' : 'right',
      zone = station < -0.5 ? 'start' : station > L + 0.5 ? 'end' : 'bridge',
      span = spanOf(station),
      // « Railing left » on the bridge, « West approach railing left » beyond the abutments.
      lab = (base, ...tail) =>
        [zone === 'bridge' ? base : `${zone === 'start' ? 'West' : 'East'} approach ${lower(base)}`, ...tail].join(' ');
    // `label` names the IFC element, `group` merges meshes into one element (null: one element per mesh) and
    // `rule` picks the IFC class in RULES (the label when it is not set).
    let label = name,
      group = null,
      rule = null;
    if (o.userData.ifcGroup) group = label = o.userData.ifcGroup;
    else if (name === 'Wheel curb') (group = label = lab(name, sideName)), (rule = 'Wheel curb');
    else if (/^Railing (rail|post|base plate|picket)$|^SDC baluster$/.test(name)) (group = label = lab('Railing', sideName)), (rule = 'Railing');
    else if (/^Barrier rail/.test(name)) (group = label = lab('Barrier rail 311A', sideName)), (rule = 'Barrier rail');
    else if (/^W-beam/.test(name)) (group = label = lab('W-beam guardrail', sideName)), (rule = 'W-beam');
    else if (/^Concrete barrier/.test(name)) (group = label = lab(name, sideName)), (rule = name);
    else if (name === 'Road marking') (group = label = lab(`Road marking ${mat === 'yellow' ? 'yellow' : 'white'}`)), (rule = 'Road marking');
    else if (name === 'Wearing surface') label = zone === 'bridge' ? `Wearing surface span ${span + 1}` : name;
    else if (name === 'Sidewalk') (label = zone === 'bridge' ? `Sidewalk ${sideName} span ${span + 1}` : lab(name, sideName)), (rule = 'Sidewalk');
    else if (name === 'Centre median') {
      const island = c.medianType === 'sidewalk';
      rule = island ? 'Median island' : name;
      label = zone === 'bridge' ? `${rule} span ${span + 1}` : lab(rule);
    } else if (name === 'Approach pavement') {
      rule = mat === 'asphalt' ? 'Approach pavement' : 'Approach slab';
      group = label = zone === 'bridge' ? rule : `${zone === 'start' ? 'West' : 'East'} ${lower(rule)}`;
    } else if (name === 'Slope in front of abutment') {
      rule = 'Slope protection';
      label = `Slope protection ${supportOf(station) === 0 ? 'west' : 'east'}`;
    } else if (name === 'Gusset bolt') group = label = `Gusset bolts span ${span + 1}`;
    else if (/^Steel angle brace|^Bracing gusset/.test(name)) group = label = `Cross-frames span ${span + 1}`;
    else if (/^Web stiffener/.test(name)) group = label = `Web stiffeners span ${span + 1}`;
    else if (/^Support diaphragm|^K-bracing/.test(name)) group = label = `Support bracing axis ${supportOf(station)}`;
    else if (/^Box girder part/.test(name)) group = label = 'Prestressed box girder';
    else if (/^Box girder diaphragm/.test(name)) group = label = `Box girder diaphragm axis ${supportOf(station)}`;
    else if (!name && o.parent?.name === 'Concrete deck haunches') group = label = 'Concrete deck haunches';
    else if (!name) {
      // Not expected: a mesh nobody named still reaches the IFC (as a proxy), never silently disappears.
      group = label = `Unnamed ${MATERIAL_INFO[mat]?.name.toLowerCase() ?? mat} element`;
      rule = 'Unnamed';
    }
    // Instanced street lights: the pole, the luminaire (head and lens) of one lamp stay together.
    if (instance >= 0) group = label = rule = name === 'Street light poles' ? `Street light pole ${instance + 1}` : `LED luminaire ${instance + 1}`;
    if (name === 'Handrail LED') group = label = rule = `Handrail LED ${sideName}`;
    rule ??= label;
    const found = RULES.find(([pattern]) => pattern.test(rule)) ?? [null, ...FALLBACK];
    // Approaches are works around the bridge, not superstructure.
    const part =
      found[3] === 'super' && zone !== 'bridge' && /^(Wheel curb|Railing|Barrier rail|W-beam|Concrete barrier|Road marking|Sidewalk|Median island|Centre median)/.test(rule)
        ? 'sub'
        : found[3];
    if (!group) group = `${label}#${o.id}${instance >= 0 ? '.' + instance : ''}`;
    if (!groups.has(group))
      groups.set(group, {
        name: label,
        role: roleOf(label),
        cls: found[1],
        types: found[2],
        part,
        mat,
        side: /\b(left|right)\b/.test(label) ? sideName : null,
        zone,
        colour: colourOf(c, mat, o.material),
        station,
        across: c.curved ? 0 : cz,
        support: supportOf(station),
        span,
        meshes: [],
      });
    const tris = [];
    for (let i = 0; i < count; i++) tris.push(index ? index.getX(i) : i);
    groups.get(group).meshes.push({ world, tris, src: o, mat, colour: colourOf(c, mat, o.material), flip: matrix.determinant() < 0 });
  };
  const visit = o => {
    if (NON_PHYSICAL.test(o.name)) {
      skipped.push({ name: o.name, reason: 'non-physical helper', src: o });
      return;
    }
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4);
        take(o, m4.clone().premultiply(o.matrixWorld), o.name, materialKey(o), i);
      }
      return;
    }
    if (o.isMesh) {
      take(o, o.matrixWorld, o.name || '', materialKey(o));
      return;
    }
    if (o.isLine || o.isPoints) skipped.push({ name: o.name, reason: 'not a solid', src: o });
    for (const child of o.children) visit(child);
  };
  function materialKey(o) {
    if (key.has(o.material)) return key.get(o.material);
    if (/^LED lenses$/.test(o.name)) return 'lens';
    return 'concrete';
  }
  visit(model.deck);
  visit(model.structure);
  // Street lights and handrail LEDs (buildBridge(..., { lights: true })).
  if (model.lighting?.group) visit(model.lighting.group);
  // The riprap slope in front of an abutment is the only part of the site that belongs to the bridge works.
  for (const o of model.setting?.children ?? []) if (o.isMesh && o.name === 'Slope in front of abutment') visit(o);
  return Object.assign([...groups.values()], { skipped });
}

// True for an object, or any ancestor, that is a non-physical helper (traffic, light pools, glow sprites).
export function isNonPhysical(o) {
  for (let q = o; q; q = q.parent) if (NON_PHYSICAL.test(q.name)) return true;
  return false;
}

// The role of an element: its name without side, span, axis or approach qualifiers (the IFC ObjectType).
const roleOf = name =>
  name
    .replace(/^(West|East) approach /, 'Approach ')
    .replace(/ (left|right)\b/g, '')
    .replace(/ (span|axis) \d+$/i, '')
    .replace(/ \d+$/, '')
    .replace(/ (west|east)$/, '');

// Display colour of an element: the chosen steel paint and concrete finish rather than the lit material colour.
function colourOf(c, mat, material) {
  if (mat === 'steel') return steelFinishes[c.steelColor] ?? c.steelColor;
  if (mat === 'steelFascia') return c.fasciaColor === 'same' ? (steelFinishes[c.steelColor] ?? c.steelColor) : (steelFinishes[c.fasciaColor] ?? c.fasciaColor);
  if (mat === 'concrete' || mat === 'edge') return concreteFinishes[c.concreteFinish] ?? MATERIAL_INFO.concrete.colour;
  return MATERIAL_INFO[mat]?.colour ?? (material?.color ? '#' + material.color.getHexString() : '#a5a397');
}

function sideOf(c, x, z) {
  const s = alignmentStation(c, x, z),
    // Lateral offset from the centre line, signed like u (+ to the right of increasing stations).
    L = totalLength(c);
  if (!c.curved) return Math.sign(z) || 1;
  const t = (Math.max(0, Math.min(L, s)) - L / 2) / c.radius,
    cx = c.radius * Math.sin(t),
    cz = c.direction * c.radius * (1 - Math.cos(t)),
    nx = -c.direction * Math.sin(t),
    nz = Math.cos(t);
  return Math.sign((x - cx) * nx + (z - cz) * nz) || 1;
}

// Weld one mesh (0.1 mm) into project coordinates; each mesh stays its own shell, so touching members never share
// an edge. A closed mesh is made manifold and outward-facing: triangles are re-oriented across shared edges, and
// the shell is turned inside out when its signed volume is negative (mirrored or negatively scaled meshes).
export function weldMesh({ world, tris, flip = false }, toProject, mirrored = false) {
  const points = [],
    lookup = new Map(),
    local = new Map(),
    triangles = [];
  const id = i => {
    if (local.has(i)) return local.get(i);
    const p = toProject(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]),
      k = p.map(v => Math.round(v * 1e4)).join(',');
    let n = lookup.get(k);
    if (n === undefined) {
      n = points.length;
      points.push(p);
      lookup.set(k, n);
    }
    local.set(i, n);
    return n;
  };
  const turned = flip !== mirrored;
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = id(tris[i]),
      b = id(turned ? tris[i + 2] : tris[i + 1]),
      c = id(turned ? tris[i + 1] : tris[i + 2]);
    if (a !== b && b !== c && a !== c) triangles.push([a, b, c]);
  }
  // Closed when every edge is shared by exactly two triangles.
  const edges = new Map();
  triangles.forEach(([a, b, c], t) => {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = p < q ? `${p}_${q}` : `${q}_${p}`;
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push(t);
    }
  });
  const closed = triangles.length > 3 && [...edges.values()].every(t => t.length === 2);
  let repaired = 0;
  if (closed) {
    // Orient every triangle like its neighbours (flood fill over the shared edges).
    const seen = new Uint8Array(triangles.length),
      queue = [0];
    seen[0] = 1;
    const directed = (t, p, q) => {
      const [a, b, c] = triangles[t];
      return (a === p && b === q) || (b === p && c === q) || (c === p && a === q);
    };
    let ok = true;
    for (let h = 0; h < queue.length; h++) {
      const t = queue[h],
        [a, b, c] = triangles[t];
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const other = edges.get(p < q ? `${p}_${q}` : `${q}_${p}`).find(x => x !== t);
        if (seen[other]) {
          // Already placed: the two triangles must run the shared edge in opposite directions.
          if (directed(other, p, q)) ok = false;
          continue;
        }
        seen[other] = 1;
        if (directed(other, p, q)) {
          const [x, y, z] = triangles[other];
          triangles[other] = [x, z, y];
          repaired++;
        }
        queue.push(other);
      }
    }
    if (queue.length !== triangles.length) ok = false;
    if (ok) {
      // Signed volume (divergence theorem); negative means the normals point inwards.
      let volume = 0;
      for (const [a, b, c] of triangles) {
        const [p, q, r] = [points[a], points[b], points[c]];
        volume +=
          (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
      }
      if (volume < 0) for (let t = 0; t < triangles.length; t++) triangles[t] = [triangles[t][0], triangles[t][2], triangles[t][1]];
      return { points, triangles, closed: true, volume: Math.abs(volume), repaired };
    }
    return { points, triangles, closed: false, volume: 0, repaired };
  }
  return { points, triangles, closed: false, volume: 0, repaired };
}

// Coplanar, edge-connected triangles merge into one polygon when their region has a single boundary loop (no
// hole); other regions keep their triangles. Loops follow the triangles' winding.
export function planarFaces(points, triangles) {
  const plane = triangles.map(([a, b, c]) => {
    const p = points[a],
      e = points[b].map((v, k) => v - p[k]),
      f = points[c].map((v, k) => v - p[k]),
      n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]],
      len = Math.hypot(...n) || 1;
    const unit = n.map(v => v / len);
    return { n: unit, d: unit[0] * p[0] + unit[1] * p[1] + unit[2] * p[2] };
  });
  const parent = triangles.map((_, i) => i),
    find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byEdge = new Map();
  triangles.forEach((t, i) =>
    t.forEach((a, k) => {
      const b = t[(k + 1) % 3],
        key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!byEdge.has(key)) byEdge.set(key, []);
      byEdge.get(key).push(i);
    }),
  );
  for (const tris of byEdge.values()) {
    if (tris.length !== 2) continue;
    const [i, j] = tris,
      p = plane[i],
      q = plane[j];
    if (p.n[0] * q.n[0] + p.n[1] * q.n[1] + p.n[2] * q.n[2] > 0.999999 && Math.abs(p.d - q.d) < 2e-4) parent[find(i)] = find(j);
  }
  const regions = new Map();
  triangles.forEach((_, i) => {
    const r = find(i);
    if (!regions.has(r)) regions.set(r, []);
    regions.get(r).push(i);
  });
  const faces = [];
  for (const members of regions.values()) {
    if (members.length === 1) {
      faces.push(triangles[members[0]]);
      continue;
    }
    // Directed boundary edges: those whose reverse is not in the region.
    const directed = new Set();
    for (const i of members) for (let k = 0; k < 3; k++) directed.add(`${triangles[i][k]}>${triangles[i][(k + 1) % 3]}`);
    const next = new Map();
    let ok = true;
    for (const e of directed) {
      const [a, b] = e.split('>');
      if (directed.has(`${b}>${a}`)) continue;
      if (next.has(a)) ok = false;
      next.set(a, b);
    }
    const start = next.keys().next().value,
      loop = [];
    let at = start;
    while (ok && at !== undefined && loop.length <= next.size) {
      loop.push(Number(at));
      at = next.get(at);
      if (at === start) break;
    }
    if (ok && at === start && loop.length === next.size && loop.length >= 3) faces.push(loop);
    else for (const i of members) faces.push(triangles[i]);
  }
  return faces;
}

// ─── Writer ───────────────────────────────────────────────────────────────────────────────────────────────
// options: { schema, origin: { datum, x0, y0, bearing }, name, version, timestamp, guid }
export function exportIfc(c, model, materials, options = {}) {
  const schema = options.schema ?? 'IFC4',
    info = IFC_SCHEMAS[schema];
  if (!info) throw Error('Select IFC 2x3, IFC 4 or IFC 4.3.');
  const si = SCHEMA_INDEX[schema],
    guid = options.guid ?? ifcGuid,
    version = options.version ?? '',
    title = options.name || 'BridgeSketch 3D bridge',
    now = options.timestamp ?? new Date(),
    toProject = projectFrame(c, options.origin ?? {}),
    elements = collectElements(c, model, materials);
  if (!elements.length) throw Error('Nothing to export: the model has no structural members.');
  const w = new StepWriter(),
    S = stepString,
    $ = '$',
    ifc2x3 = schema === 'IFC2X3',
    ifc43 = schema === 'IFC4X3';
  // Owner history (mandatory in IFC 2x3).
  const person = w.add('IFCPERSON', $, S('BridgeSketch user'), $, $, $, $, $, $),
    org = w.add('IFCORGANIZATION', $, S('BridgeSketch 3D'), $, $, $),
    user = w.add('IFCPERSONANDORGANIZATION', person, org, $),
    app = w.add('IFCAPPLICATION', org, S(version || '0'), S('BridgeSketch 3D'), S('BridgeSketch3D')),
    created = Math.floor(now.getTime() / 1000),
    oh = w.add('IFCOWNERHISTORY', user, app, $, enumv('ADDED'), String(created), user, app, String(created));
  const point = p => w.add('IFCCARTESIANPOINT', list(p.map(v => real(v, 4)))),
    dir = d => w.add('IFCDIRECTION', list(d.map(v => real(v)))),
    origin3 = point([0, 0, 0]),
    zAxis = dir([0, 0, 1]),
    xAxis = dir([1, 0, 0]),
    axes = (at = origin3) => w.add('IFCAXIS2PLACEMENT3D', at, zAxis, xAxis);
  const world = axes(),
    context = w.add('IFCGEOMETRICREPRESENTATIONCONTEXT', $, S('Model'), '3', real(1e-5), world, dir([0, 1])),
    body = w.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', S('Body'), S('Model'), '*', '*', '*', '*', context, $, enumv('MODEL_VIEW'), $);
  const units = w.add(
    'IFCUNITASSIGNMENT',
    list([
      w.add('IFCSIUNIT', '*', enumv('LENGTHUNIT'), $, enumv('METRE')),
      w.add('IFCSIUNIT', '*', enumv('AREAUNIT'), $, enumv('SQUARE_METRE')),
      w.add('IFCSIUNIT', '*', enumv('VOLUMEUNIT'), $, enumv('CUBIC_METRE')),
      w.add('IFCSIUNIT', '*', enumv('PLANEANGLEUNIT'), $, enumv('RADIAN')),
    ]),
  );
  const project = w.add('IFCPROJECT', S(guid()), oh, S(title), S('Concept geometry from BridgeSketch 3D'), $, $, $, list([context]), units);
  // Spatial structure. Placements are identities: element coordinates are absolute project coordinates.
  const placement = (rel = null, z = 0) => w.add('IFCLOCALPLACEMENT', rel ?? $, z ? axes(point([0, 0, z])) : axes());
  const sitePlacement = placement(),
    site = w.add('IFCSITE', S(guid()), oh, S('Site'), $, $, sitePlacement, $, $, enumv('ELEMENT'), $, $, real(0), $, $);
  const deckLevel = options.origin?.datum ?? 30;
  let lowZ = Infinity;
  for (const e of elements)
    for (const m of e.meshes)
      for (let i = 0; i < m.world.length; i += 3) lowZ = Math.min(lowZ, toProject(m.world[i], m.world[i + 1], m.world[i + 2])[2]);
  const aggregate = (whole, parts) => w.add('IFCRELAGGREGATES', S(guid()), oh, $, $, whole, list(parts));
  aggregate(project, [site]);
  const facilityPlacement = placement(sitePlacement);
  const containers = {};
  const systemName = { girder: 'Girder bridge', frame: 'Rigid frame', strutted: 'Strutted frame', arch: 'Arch bridge', truss: 'Truss footbridge' }[c.structureSystem] ?? 'Bridge';
  let facility;
  if (ifc43) {
    const kind = { girder: 'GIRDER', frame: 'FRAMEWORK', strutted: 'FRAMEWORK', arch: 'ARCHED', truss: 'TRUSS' }[c.structureSystem] ?? 'NOTDEFINED';
    facility = w.add('IFCBRIDGE', S(guid()), oh, S(title), S(systemName), $, facilityPlacement, $, $, enumv('ELEMENT'), enumv(kind));
    aggregate(site, [facility]);
    const part = (name, type, usage = 'LONGITUDINAL') => {
      const at = placement(facilityPlacement);
      return { id: w.add('IFCBRIDGEPART', S(guid()), oh, S(name), $, $, at, $, $, enumv('ELEMENT'), enumv(usage), enumv(type)), at, z: 0 };
    };
    containers.super = part('Superstructure', 'SUPERSTRUCTURE');
    const sub = part('Substructure', 'SUBSTRUCTURE');
    aggregate(facility, [containers.super.id, sub.id]);
    const supports = stations(c).map((_, j) =>
      j === 0 || j === c.spans.length
        ? part(j === 0 ? 'Abutment West' : 'Abutment East', 'ABUTMENT', 'VERTICAL')
        : part(`Pier ${j}`, 'PIER', 'VERTICAL'),
    );
    aggregate(sub.id, supports.map(p => p.id));
    containers.support = supports;
  } else {
    facility = w.add('IFCBUILDING', S(guid()), oh, S(title), S(systemName), $, facilityPlacement, $, $, enumv('ELEMENT'), $, $, $);
    aggregate(site, [facility]);
    // Revit needs a building and levels: one level at the deck (west axis), one at the lowest footing.
    const storey = (name, z) => {
      const at = placement(facilityPlacement, z);
      return { id: w.add('IFCBUILDINGSTOREY', S(guid()), oh, S(name), $, $, at, $, $, enumv('ELEMENT'), real(z, 4)), at, z };
    };
    containers.super = storey('Superstructure', deckLevel);
    containers.sub = storey('Substructure', Math.floor(lowZ * 1000) / 1000);
    aggregate(facility, [containers.super.id, containers.sub.id]);
  }
  // Surface styles (one per colour) and materials.
  const styles = new Map(),
    styleFor = hex => {
      if (styles.has(hex)) return styles.get(hex);
      const colour = new T.Color(hex),
        rgb = w.add('IFCCOLOURRGB', $, real(colour.r, 4), real(colour.g, 4), real(colour.b, 4)),
        shading = ifc2x3 ? w.add('IFCSURFACESTYLESHADING', rgb) : w.add('IFCSURFACESTYLESHADING', rgb, real(0)),
        style = w.add('IFCSURFACESTYLE', S(hex), enumv('BOTH'), list([shading])),
        styleRef = ifc2x3 ? w.add('IFCPRESENTATIONSTYLEASSIGNMENT', list([style])) : style;
      styles.set(hex, styleRef);
      return styleRef;
    };
  const materialIds = new Map(),
    materialMembers = new Map(),
    materialFor = name => {
      if (!materialIds.has(name)) {
        materialIds.set(name, ifc2x3 ? w.add('IFCMATERIAL', S(name)) : w.add('IFCMATERIAL', S(name), $, S(name.includes('teel') ? 'Steel' : name)));
        materialMembers.set(name, []);
      }
      return name;
    };
  const contained = new Map();
  const finish = steelFinishes[c.steelColor] ? `AMS ${c.steelColor}` : c.steelColor;
  const counts = {};
  elements.sort((a, b) => a.station - b.station);
  // Mirrored frames would turn every shell inside out: probe the handedness of the model → project mapping.
  const probe = [toProject(0, 0, 0), toProject(1, 0, 0), toProject(0, 1, 0), toProject(0, 0, 1)],
    e1 = probe[1].map((q, k) => q - probe[0][k]),
    e2 = probe[2].map((q, k) => q - probe[0][k]),
    e3 = probe[3].map((q, k) => q - probe[0][k]),
    mirrored =
      e1[0] * (e2[1] * e3[2] - e2[2] * e3[1]) - e1[1] * (e2[0] * e3[2] - e2[2] * e3[0]) + e1[2] * (e2[0] * e3[1] - e2[1] * e3[0]) < 0;
  const stats = { solids: 0, shells: 0, repaired: 0, triangles: 0 };
  for (const e of elements) {
    // One welded shell per mesh; meshes of one colour share an IFC representation item (IFC 4) or are one B-rep
    // each (IFC 2x3).
    const parts = e.meshes.map(m => ({ ...weldMesh(m, toProject, mirrored), colour: m.colour })).filter(p => p.triangles.length);
    if (!parts.length) continue;
    for (const p of parts) {
      stats[p.closed ? 'solids' : 'shells']++;
      stats.repaired += p.repaired;
      stats.triangles += p.triangles.length;
    }
    const items = [];
    let kind;
    if (ifc2x3) {
      // Faceted B-rep per closed solid, or one shell-based surface model when the element has an open shell; shared
      // points, and coplanar triangles merge into polygons, which keeps the file about four times smaller.
      const shellOf = p => {
        const ids = p.points.map(q => point(q)),
          faces = planarFaces(p.points, p.triangles).map(loop =>
            w.add('IFCFACE', list([w.add('IFCFACEOUTERBOUND', w.add('IFCPOLYLOOP', list(loop.map(k => ids[k]))), '.T.')])),
          );
        return p.closed ? w.add('IFCCLOSEDSHELL', list(faces)) : w.add('IFCOPENSHELL', list(faces));
      };
      if (parts.every(p => p.closed)) {
        kind = 'Brep';
        for (const p of parts) items.push({ item: w.add('IFCFACETEDBREP', shellOf(p)), colour: p.colour });
      } else {
        kind = 'SurfaceModel';
        for (const p of parts) items.push({ item: w.add('IFCSHELLBASEDSURFACEMODEL', list([shellOf(p)])), colour: p.colour });
      }
    } else {
      kind = 'Tessellation';
      for (const colour of new Set(parts.map(p => p.colour))) {
        const mine = parts.filter(p => p.colour === colour),
          pts = [],
          tris = [];
        for (const p of mine) {
          const base = pts.length;
          for (const q of p.points) pts.push(q);
          for (const t of p.triangles) tris.push(t.map(k => String(k + base + 1)));
        }
        const coords = list(pts.map(p => list(p.map(v => real(v, 4))))),
          pointList = ifc43 ? w.add('IFCCARTESIANPOINTLIST3D', coords, $) : w.add('IFCCARTESIANPOINTLIST3D', coords);
        items.push({
          item: w.add('IFCTRIANGULATEDFACESET', pointList, $, mine.every(p => p.closed) ? '.T.' : '.F.', list(tris.map(t => list(t))), $),
          colour,
        });
      }
    }
    for (const { item, colour } of items) w.add('IFCSTYLEDITEM', item, list([styleFor(colour ?? '#a5a397')]), $);
    const shape = w.add(
      'IFCPRODUCTDEFINITIONSHAPE',
      $,
      $,
      list([w.add('IFCSHAPEREPRESENTATION', body, S('Body'), S(kind), list(items.map(i => i.item)))]),
    );
    // IFC 2x3 and 4 have no IfcBearing, IFC 2x3 no IfcLightFixture: building element proxies named after the role.
    let cls = e.cls,
      type = e.types[si];
    if ((cls === 'IfcBearing' && !ifc43) || (cls === 'IfcLightFixture' && ifc2x3)) {
      cls = 'IfcBuildingElementProxy';
      type = ifc2x3 ? null : 'ELEMENT';
    }
    const container = ifc43 && e.part === 'sub' ? containers.support[e.support] : containers[e.part];
    // Placed in its container; the offset cancels the level elevation, so coordinates stay absolute.
    const elementPlacement = placement(container.at, -container.z);
    counts[e.name] = (counts[e.name] ?? 0) + 1;
    const objectType = e.role,
      args = [S(guid()), oh, S(e.name), $, S(objectType), elementPlacement, shape, $];
    // Class-specific tail: predefined type (IFC 4 and 4.3 always; 2x3 only for the classes that have it) and the
    // nominal size of a fastener.
    if (cls === 'IfcMechanicalFastener') args.push($, $, ...(ifc2x3 ? [] : [enumv(type ?? 'NOTDEFINED')]));
    else if (!ifc2x3) args.push(enumv(type ?? 'NOTDEFINED'));
    else if (['IfcSlab', 'IfcFooting', 'IfcRailing', 'IfcCovering'].includes(cls)) args.push(enumv(type ?? 'NOTDEFINED'));
    else if (cls === 'IfcBuildingElementProxy') args.push($);
    const element = w.add(cls.toUpperCase(), ...args);
    if (!contained.has(container.id)) contained.set(container.id, []);
    contained.get(container.id).push(element);
    const materialName = materialFor(MATERIAL_INFO[e.mat]?.name ?? 'Concrete');
    materialMembers.get(materialName).push(element);
    // Property set: role, span or support, material and finish.
    const prop = (name, value) => w.add('IFCPROPERTYSINGLEVALUE', S(name), $, value, $),
      label = text => `IFCLABEL(${S(text)})`,
      props = [
        prop('Role', label(objectType)),
        prop(e.part === 'super' ? 'Span' : 'Support', e.part === 'super' ? `IFCINTEGER(${e.span + 1})` : label(e.support === 0 ? 'Abutment West' : e.support === c.spans.length ? 'Abutment East' : `Pier ${e.support}`)),
        prop('Chainage', `IFCLENGTHMEASURE(${real(e.station - FRONT_FACE, 3)})`),
        prop('Material', label(materialName)),
      ];
    if (e.side) props.push(prop('Side', label(e.side)));
    if (e.zone !== 'bridge') props.push(prop('Zone', label(e.zone === 'start' ? 'West approach' : 'East approach')));
    if (/steel/i.test(materialName) && e.mat.startsWith('steel')) props.push(prop('Paint', label(`${finish} · ${e.colour}`)));
    if (/^Abutment seat|^Return wall|^Wingwall|^Girder screen/.test(e.name))
      props.push(prop('Finish', label(c.abutmentFinish === 'formliner' ? 'Architectural formliner, vertical ribs 40 mm' : 'Smooth formwork')));
    const pset = w.add('IFCPROPERTYSET', S(guid()), oh, S('BridgeSketch_Element'), $, list(props));
    w.add('IFCRELDEFINESBYPROPERTIES', S(guid()), oh, $, $, list([element]), pset);
  }
  for (const [container, items] of contained)
    w.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', S(guid()), oh, $, $, list(items), container);
  for (const [name, items] of materialMembers)
    if (items.length) w.add('IFCRELASSOCIATESMATERIAL', S(guid()), oh, $, $, list(items), materialIds.get(name));
  // Bridge facts on the facility.
  const fact = (name, value) => w.add('IFCPROPERTYSINGLEVALUE', S(name), $, value, $);
  const bridgeSet = w.add(
    'IFCPROPERTYSET',
    S(guid()),
    oh,
    S('BridgeSketch_Bridge'),
    $,
    list([
      fact('StructuralSystem', `IFCLABEL(${S(systemName)})`),
      fact('Spans', `IFCLABEL(${S(c.spans.map(s => s.length).join(' + ') + ' m')})`),
      fact('TotalLength', `IFCLENGTHMEASURE(${real(totalLength(c), 3)})`),
      fact('DeckWidth', `IFCLENGTHMEASURE(${real(c.width, 3)})`),
      fact('Skew', `IFCLABEL(${S(c.skew + '°')})`),
      fact('Source', `IFCLABEL(${S('BridgeSketch 3D ' + version + ' · concept geometry, not a structural design')})`),
    ]),
  );
  w.add('IFCRELDEFINESBYPROPERTIES', S(guid()), oh, $, $, list([facility]), bridgeSet);
  const stamp = now.toISOString().slice(0, 19);
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION((${S(`ViewDefinition [${info.view}]`)}),'2;1');`,
    `FILE_NAME(${S(title)},${S(stamp)},(${S('BridgeSketch user')}),(${S('BridgeSketch 3D')}),${S('BridgeSketch 3D ' + version)},${S('BridgeSketch 3D')},'');`,
    `FILE_SCHEMA((${S(info.file)}));`,
    'ENDSEC;',
    'DATA;',
  ];
  return {
    text: [...header, ...w.lines, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n'),
    elements: Object.values(counts).reduce((a, b) => a + b, 0),
    counts,
    stats,
    skipped: elements.skipped,
  };
}
