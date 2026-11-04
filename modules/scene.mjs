// BridgeSketch 3D · Scene assembly: deck, girders, supports and batching. Re-exports the scene API.
export { vehicleKinds } from './vehicles.mjs';
export { makeMaterials } from './materials.mjs';
export {
  nebtSection,
  steelSection,
  boxSection,
  chamferSection,
  sweep,
  boxGirder,
  slabMesh,
  wallBetween,
} from './sections.mjs';
export { vehicle, animateTraffic } from './traffic.mjs';
export { guardrailSection } from './railings.mjs';
export {
  obstacleTour,
  frontSlopeFit,
  approachSurfaces,
  roadFootprints,
  intersectsRoad,
  crossingCorridors,
} from './terrain.mjs';
import * as T from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { trafficKind } from './vehicles.mjs';
import {
  frame,
  alignmentStation,
  profile,
  totalLength,
  stations,
  spacing,
  supportStation,
  girderTop,
  girderDepth,
  roadLayout,
  laneForward,
  steelFinishes,
  monolithicSupport,
  bearingPositions,
  crossAt,
  crossfallSection,
  isTruss,
  trussInset,
} from './geometry.mjs';
import { addArch, addPsbox, addStrutLeg, addTruss } from './systems.mjs';
import { addEnvironment, approachSurfaces, frontSlopeFit, terrainSampler } from './terrain.mjs';
import {
  beam,
  box,
  boxGirder,
  boxSection,
  chamferSection,
  clipMeshAtCut,
  crossPlate,
  nebtSection,
  plinth,
  profiledSupportWall,
  rect,
  skewPlate,
  slabMesh,
  soffitAt,
  steelSection,
  supportBasis,
  supportPoint,
  sweep,
  wallBetween,
} from './sections.mjs';
import { barrierRail, bridgeRailing, roadsideGuardrail } from './railings.mjs';
import { concreteBarrier, edgeWidth, isConcrete, sidewalkProfile, sidewalkTop } from './deck-profiles.mjs';
import { bracingMember, webOffset, webStiffener } from './steel-details.mjs';
import { vehicle } from './traffic.mjs';
import { buildLighting } from './lighting.mjs';
import { concreteFinishes } from './materials.mjs';
import { formlinerFace } from './formliner.mjs';

// Outer face of the abutment walls, inside the deck edge.
const ABUTMENT_SIDE = 0.075;

// 0.6.6: on two or more lanes in one direction, each lane to the left (towards the centre line) runs a little
// faster than the one on its right: 30 km/h on the right-hand lane, +15 % per lane. One speed per lane keeps the
// spacing, so vehicles never catch up with each other.
export function laneSpeed(c, lane, type = 'sedan') {
  if (type === 'cyclist') return 17;
  const forward = laneForward(c, lane),
    rank = c.laneCount === 1 ? 0 : forward ? c.laneCount - 1 - lane : lane;
  return 30 * (1 + 0.15 * rank);
}

// site: false leaves out the terrain, water, vegetation and lighting (the IFC export needs the bridge only).
export function buildBridge(c, m, { batch = true, site = true } = {}) {
  const preview = approachSurfaces(c),
    L0 = totalLength(c),
    extent = Math.max(L0 + 2 * c.approach + 36, ...preview.flat().map(p => 2 * Math.abs(p[0]) + 8)),
    fills = approachSurfaces(c, extent);
  // Paint is a dielectric satin finish; the albedo is calibrated (× 0.88) so a sunlit web at noon renders close
  // to the selected AMS / hex swatch instead of lighter (the scene's key + sky light sum exceeds 1).
  const paint = (mat, finish) => {
    mat.color.set(steelFinishes[finish] ?? finish).multiplyScalar(finish === 'weathered' ? 1 : 0.88);
    mat.metalness = finish === 'weathered' ? 0.03 : 0;
    mat.roughness = finish === 'weathered' ? 0.92 : 0.55;
    mat.envMapIntensity = 0.8;
    mat.userData.weathered.value = finish === 'weathered' ? 1 : 0;
  };
  paint(m.steel, c.steelColor);
  paint(m.steelFascia, c.fasciaColor === 'same' ? c.steelColor : c.fasciaColor);
  // Edge (fascia) girders can carry their own finish; interior girders keep the main one.
  const steelFor = g =>
    c.fasciaColor !== 'same' && (g === 0 || g === c.girders - 1) ? m.steelFascia : m.steel;
  // Concrete colour changes preserve the existing diffuse, normal and roughness maps.
  for (const mat of [m.concrete, m.edge]) mat.color.set(concreteFinishes[c.concreteFinish] ?? mat.userData.originalColor);
  const waterSpans = c.spans.filter(span => span.obstacle === 'water');
  m.grass.userData.waterLevel.value = waterSpans.length ? Math.min(...waterSpans.map(span => span.elevation)) : -1e4;
  m.grass.userData.lawn.value = c.environment === 'urban' ? 1 : 0;
  m.grass.userData.fall.value = m.soil.userData.fall.value = c.terrainMode === 'fall' ? 1 : 0;
  const root = new T.Group(),
    deck = new T.Group(),
    structure = new T.Group(),
    setting = new T.Group();
  root.name = 'BridgeSketch 3D';
  deck.name = 'Deck and barriers';
  structure.name = 'Girders and supports';
  setting.name = 'Environment';
  root.add(deck, structure, setting);
  const haunches = new T.Group();
  haunches.name = 'Concrete deck haunches';
  structure.add(haunches);
  const truss = isTruss(c),
    ss = stations(c),
    L = totalLength(c),
    half = c.width / 2,
    gspace = spacing(c),
    layout = roadLayout(c),
    leftSide = layout.left,
    rightSide = layout.right,
    roadMin = layout.roadMin,
    roadMax = layout.roadMax;
  const addSweep = (group, a, b, section, mat, height, segments, crossU) => {
    const o = sweep(c, a, b, section, mat, height, segments, crossU);
    group.add(o);
    return o;
  };
  const wearingStrips = layout.medianWidth
    ? [
        [roadMin, layout.medianMin],
        [layout.medianMax, roadMax],
      ]
    : [[roadMin, roadMax]];
  const addMedian = (a, b) => {
    if (!layout.medianWidth) return;
    // Medians stand on the structural slab; asphalt stops at their faces.
    const base = -c.asphalt,
      section =
        c.medianType === 'barrier'
          ? [
              [-0.3, base],
              [-0.3, 0.12],
              [-0.16, 0.42],
              [-0.12, 1.1],
              [0.12, 1.1],
              [0.16, 0.42],
              [0.3, 0.12],
              [0.3, base],
            ].map(([u, y]) => [u + layout.medianCentre, y])
          : rect(layout.medianMin, layout.medianMax, 0.2, base);
    const median = addSweep(deck, a, b, section, m.concrete);
    median.name = 'Centre median';
  };
  // raised: sidewalk top (m above the road) when the barrier stands on a sidewalk, otherwise null (slab).
  // run: post grid shared along the whole railing (origin at mid-bridge) and end posts only where it stops.
  const addBarrier = (a, b, edge, side, type, raised = null, base = -c.asphalt, run = {}) => {
    if (!isConcrete(type)) {
      bridgeRailing(deck, m, c, a, b, edge, side, type, raised, profile, run);
      return;
    }
    addSweep(deck, a, b, chamferSection(concreteBarrier(type, edge, side, raised ?? base)), m.edge).name = `Concrete barrier ${type}`;
    if (type === '311A') barrierRail(deck, m, c, a, b, edge, side, raised ?? base, run);
  };
  const innerOnApproach = c.approachBarrier === 'extend' && c.sidewalkRailing !== 'none';
  // Sidewalks: 280 mm above the slab at the road-side face (35 mm in 280 mm batter), rising 1 % outwards.
  // Behind a Type 301 barrier the sidewalk face is the barrier's vertical back.
  const sidewalkFace = side => {
    const road = side < 0 ? roadMin : roadMax;
    return c.sidewalkRailing === '301' ? road + side * layout.innerBarrier : road;
  };
  const addSidewalks = (a, b, base = -c.asphalt) => {
    for (const [side, on] of [
      [-1, leftSide],
      [1, rightSide],
    ])
      if (on)
        addSweep(
          deck,
          a,
          b,
          sidewalkProfile(c.asphalt, side * half, sidewalkFace(side), side, c.sidewalkRailing !== '301', base),
          m.concrete,
        ).name = 'Sidewalk';
  };
  const sidewalkAt = (side, u) => sidewalkTop(c.asphalt, sidewalkFace(side), u);
  // Dashed lane dividers (3 m dash, 6 m gap), continuous edge lines; opposing directions in yellow.
  const addMarkings = (a, b) => {
    const dividers = new Set(layout.dividers.map(d => Number(d.u.toFixed(6))));
    for (const u of layout.laneEdges)
      if (!dividers.has(Number(u.toFixed(6)))) addSweep(deck, a, b, rect(u - 0.05, u + 0.05, 0.011, 0.003), m.white);
    for (const d of layout.dividers) {
      // Opposing directions: a solid double yellow line (two 100 mm lines, 100 mm apart) when selected.
      if (d.opposing && c.centreLine === 'double') {
        for (const du of [-0.1, 0.1])
          addSweep(deck, a, b, rect(d.u + du - 0.05, d.u + du + 0.05, 0.011, 0.003), m.yellow);
        continue;
      }
      for (let s = Math.floor(a / 9) * 9; s < b; s += 9) {
        const s0 = Math.max(a, s),
          s1 = Math.min(b, s + 3);
        if (s1 - s0 > 0.2)
          addSweep(deck, s0, s1, rect(d.u - 0.05, d.u + 0.05, 0.011, 0.003), d.opposing ? m.yellow : m.white, undefined, 2);
      }
    }
  };
  // The five plates of a box stay one girder for the IFC export (userData.ifcGroup).
  const addBoxGirder = (group, a, b, u, g, label = `Box girder ${g + 1}`) => {
    const box = boxGirder(c, a, b, u, steelFor(g));
    for (const mesh of [...box.children]) {
      mesh.userData.ifcGroup = label;
      group.add(mesh);
    }
  };
  c.spans.forEach((span, i) => {
    const a = ss[i] + (c.continuous ? 0 : 0.025),
      b = ss[i + 1] - (c.continuous ? 0 : 0.025);
    if (c.material === 'slab') structure.add(slabMesh(c, a, b, m.concrete)).children.at(-1).name = `Solid slab span ${i + 1}`;
    else {
      // A truss deck spans between the bottom chords.
      const edge = truss ? half - trussInset(c) + 0.02 : half;
      addSweep(deck, a, b, rect(-edge, edge, -c.asphalt, -c.asphalt - c.deck), m.concrete).name = `Deck slab span ${i + 1}`;
    }
    // 65 mm asphalt covers the roadway only; curbs, barriers, sidewalks and medians sit on the slab.
    for (const [u0, u1] of wearingStrips)
      addSweep(deck, a, b, rect(u0, u1, 0, -c.asphalt), c.laneCount ? m.asphalt : m.concrete).name = 'Wearing surface';
    addSidewalks(a, b);
    // Edge barriers always continue past the abutments over the return walls, so the bridge spans never end a run.
    for (const side of [-1, 1])
      addBarrier(
        a,
        b,
        side * (truss ? half - trussInset(c) : half),
        side,
        side < 0 ? c.leftRailing : c.rightRailing,
        (side < 0 && leftSide) || (side > 0 && rightSide) ? sidewalkAt(side, side * half) : null,
        undefined,
        { origin: L / 2, capStart: false, capEnd: false },
      );
    if (c.sidewalkRailing !== 'none')
      for (const [side, on] of [
        [-1, leftSide],
        [1, rightSide],
      ]) {
        if (!on) continue;
        const u = (side < 0 ? roadMin : roadMax) + side * layout.innerBarrier;
        addBarrier(a, b, u, side, c.sidewalkRailing, c.sidewalkRailing === '301' ? null : sidewalkAt(side, u), undefined, {
          origin: L / 2,
          capStart: i === 0 && !innerOnApproach,
          capEnd: i === c.spans.length - 1 && !innerOnApproach,
        });
      }
    addMedian(a, b);
    addMarkings(a, b);
    for (let g = 0; g < (c.material === 'slab' || c.material === 'psbox' || truss ? 0 : c.girders); g++) {
      const u = -half + c.overhang + g * gspace;
      if (!(c.continuous && (c.material === 'steel' || c.material === 'box'))) {
        if (c.material === 'box') addBoxGirder(structure, a + 0.22, b - 0.22, u, g, `Span ${i + 1} box girder ${g + 1}`);
        else {
          const section =
            c.material === 'concrete'
              ? station => nebtSection(girderDepth(c, supportStation(c, station, u), u)).map(([x, y]) => [x + u, y])
              : steelSection(c.depth, c.web).map(([x, y]) => [x + u, y]);
          const top = (_, s, v, across) =>
            girderTop(c, i, s, u) + (c.material === 'steel' && v < -0.05 ? c.depth - girderDepth(c, s, across) : 0);
          const girder = addSweep(
            structure,
            a + 0.22,
            b - 0.22,
            section,
            c.material === 'concrete' ? m.concrete : steelFor(g),
            top,
            undefined,
            u,
          );
          girder.name = `Span ${i + 1} girder ${g + 1}`;
        }
      }
      // Level NEBT / I flanges and profile-following box flanges stay in contact with the concrete haunch.
      const haunchHeight = (_, s, v, uu) =>
        v > -0.5 ? profile(c, s) - c.asphalt - c.deck + crossAt(c, uu) : girderTop(c, i, s, u) + 1 + crossAt(c, c.material === 'box' ? uu : u);
      for (const side of c.material === 'box' ? [-1, 1] : [0]) {
        const section = station => {
          const flange =
            c.material === 'box'
              ? boxSection(
                  girderDepth(c, supportStation(c, station, u), u),
                  c.boxTopWidth,
                  c.boxBottomWidth,
                  0.05,
                  c.web,
                )[side < 0 ? 'topLeft' : 'topRight']
              : c.material === 'concrete'
                ? rect(-0.6, 0.6, 0, -0.05) // NEBT: the haunch covers the full 1200 mm top flange
                : rect(-0.25, 0.25, 0, -0.05);
          return crossfallSection(c, rect(u + flange[0][0], u + flange[1][0], 0, -1));
        };
        addSweep(
          haunches,
          a + (c.continuous ? 0 : 0.22),
          b - (c.continuous ? 0 : 0.22),
          section,
          m.concrete,
          haunchHeight,
          undefined,
          false,
        );
      }
    }
    // Steel: cross-frames at no more than 8 m in each span. NEBT: cast-in-place intermediate diaphragms per
    // MTQ Table 8.2-4 — none up to 15 m, one up to 30 m, two up to 45 m (one per 15 m), equally spaced.
    // Supports get full diaphragms below.
    const frames =
      c.material === 'concrete'
        ? Math.max(1, Math.ceil((c.spans[i].length - 1e-6) / 15))
        : Math.max(1, Math.ceil((b - a) / 8));
    for (let n = 1; n < frames && c.material !== 'slab' && c.material !== 'psbox' && !truss; n++) {
      const s = a + ((b - a) * n) / frames;
      for (let g = 0; g < c.girders - 1; g++) {
        const u = -half + c.overhang + g * gspace,
          top = Math.min(girderTop(c, i, s, u), girderTop(c, i, s, u + gspace)) - 0.13,
          bot = top - Math.min(girderDepth(c, s, u), girderDepth(c, s, u + gspace)) + 0.26,
          xu = crossAt(c, u),
          xv = crossAt(c, u + gspace);
        if (c.material === 'steel' || c.material === 'box') {
          const topInset = webOffset(c, i, s, u, top),
            bottomInset = webOffset(c, i, s, u, bot);
          const joints = [
            [u + topInset, top + xu],
            [u + gspace - topInset, top + xv],
            [u + bottomInset, bot + xu],
            [u + gspace - bottomInset, bot + xv],
          ];
          for (const [a, b, offset] of [
            [0, 1, 0],
            [2, 3, 0],
            [0, 3, -0.035],
            [2, 1, 0.035],
          ])
            bracingMember(
              structure,
              m.steel,
              supportPoint(c, s + offset, ...joints[a]),
              supportPoint(c, s + offset, ...joints[b]),
            );
          const f = frame(c, s);
          for (const [k, [v, y]] of joints.entries()) {
            const side = k % 2 === 0 ? 1 : -1,
              vertical = k < 2 ? -1 : 1,
              p = supportPoint(c, s, v, y),
              q = supportPoint(c, s, v + side * 0.32, y),
              r = supportPoint(c, s, v, y + vertical * 0.3),
              positions = [];
            for (const t of [-0.018, 0.018])
              for (const a of [p, q, r]) positions.push(a[0] + f.tx * t, a[1], a[2] + f.tz * t);
            const plate = new T.BufferGeometry();
            plate.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
            plate.setIndex([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5]);
            plate.computeVertexNormals();
            const mesh = new T.Mesh(plate, m.steel);
            mesh.castShadow = mesh.receiveShadow = true;
            mesh.name = 'Bracing gusset';
            structure.add(mesh);
            for (const [dv, dy] of [
              [0.07, 0.06],
              [0.19, 0.045],
              [0.05, 0.18],
            ]) {
              const p = supportPoint(c, s, v + side * dv, y + vertical * dy),
                bolt = new T.Mesh(new T.CylinderGeometry(0.023, 0.023, 0.052, 6), m.dark);
              bolt.position.set(...p);
              bolt.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(f.tx, 0, f.tz));
              bolt.name = 'Gusset bolt';
              structure.add(bolt);
            }
          }
        } else {
          // 250 mm concrete diaphragm between the webs, from the slab down to 250 mm above the bottom flange.
          const girderTopAt = Math.min(girderTop(c, i, s, u), girderTop(c, i, s, u + gspace));
          crossPlate(
            structure,
            m.concrete,
            c,
            s,
            u + 0.09,
            u + gspace - 0.09,
            () => girderTopAt + c.haunch,
            () => girderTopAt - Math.min(girderDepth(c, s, u), girderDepth(c, s, u + gspace)) + 0.25,
            0.25,
            'NEBT intermediate diaphragm',
          );
        }
      }
      // 14 mm connection stiffeners on the interior web faces of plate girders only.
      if (c.material === 'steel')
        for (let g = 0; g < c.girders; g++) {
          const u = -half + c.overhang + g * gspace;
          for (const face of [-1, 1])
            if (face < 0 ? g > 0 : g < c.girders - 1) webStiffener(structure, steelFor(g), c, i, s, u, face);
        }
    }
    if (c.showTraffic) {
      layout.laneCenters.forEach((u, lane) => {
        const type =
            c.trafficMode === 'cyclists'
              ? 'cyclist'
              : trafficKind(i * c.laneCount + lane + c.seed),
          s = a + (b - a) * (lane % 2 ? 0.65 : 0.35);
        vehicle(deck, m, c, s, u, type, laneForward(c, lane), undefined, { speed: laneSpeed(c, lane, type) });
      });
      // 0.6.6: a cyclist rides every sidewalk by default (the right-hand direction on each side).
      if (c.trafficMode !== 'cyclists')
        for (const [side, on] of [
          [-1, leftSide],
          [1, rightSide],
        ]) {
          if (!on) continue;
          const face = sidewalkFace(side),
            inner = face + side * (c.sidewalkRailing === '301' ? 0 : 0.1) + side * 0.15,
            outer = side * (half - edgeWidth(side < 0 ? c.leftRailing : c.rightRailing)) - side * 0.15,
            [min, max] = [inner, outer].sort((p, q) => p - q);
          if (max - min < 0.9) continue;
          const u = (min + max) / 2;
          vehicle(deck, m, c, a + (b - a) * (side < 0 ? 0.25 : 0.75), u, 'cyclist', side > 0, undefined, {
            path: { min, max, lift: sidewalkAt(side, u) },
          });
        }
    }
  });
  if (c.material === 'psbox') addPsbox(c, m, structure);
  if (truss) addTruss(c, m, structure);
  if (c.continuous && (c.material === 'steel' || c.material === 'box') && !truss)
    for (let g = 0; g < c.girders; g++) {
      const u = -half + c.overhang + g * gspace;
      if (c.material === 'box') addBoxGirder(structure, 0.25, L - 0.25, u, g);
      else
        addSweep(
          structure,
          0.25,
          L - 0.25,
          steelSection(c.depth, c.web).map(([x, y]) => [x + u, y]),
          steelFor(g),
          (_, s, v, across) => girderTop(c, 0, s, u) + (v < -0.05 ? c.depth - girderDepth(c, s, across) : 0),
          undefined,
          u,
        ).name = `Continuous girder ${g + 1}`;
    }
  const earthLevel = Math.min(-0.3, ...c.spans.map(s => s.elevation - 1));
  ss.forEach((s, j) => {
    const earth = earthLevel,
      interior = j > 0 && j < ss.length - 1,
      // Rigid frames and strutted-frame leg joints are monolithic: no bearings, the support meets the soffit.
      mono = monolithicSupport(c, j),
      integral = c.structureSystem === 'frame';
    const lines = interior
      ? c.continuous && ['steel', 'box', 'slab', 'psbox'].includes(c.material)
        ? [0]
        : [-0.55, 0.55]
      : [j === 0 ? 0.5 : -0.5];
    const spanOf = side => Math.max(0, Math.min(c.spans.length - 1, side < 0 ? j - 1 : j));
    // The common bearing seat stays level; individual plinths take up the crossfall and grade (100 mm minimum).
    const padBottom = (u, side) => soffitAt(c, spanOf(side), supportStation(c, s, u) + side, u) - (mono ? 0 : 0.075);
    const seatLevel = Math.min(...bearingPositions(c).flatMap(u => lines.map(side => padBottom(u, side)))) - 0.1;
    const seatLine = (u, side) => mono ? padBottom(u, side) + 0.05 : seatLevel;
    const seatAt = (u, offset = 0) => {
      if (lines.length === 1) return seatLine(u, lines[0]);
      const a = seatLine(u, lines[0]),
        b = seatLine(u, lines[1]),
        t = Math.max(0, Math.min(1, (offset - lines[0]) / (lines[1] - lines[0])));
      return a + (b - a) * t;
    };
    const seatMin = Math.min(...Array.from({ length: 9 }, (_, n) => seatAt(-half + 0.15 + ((c.width - 0.3) * n) / 8)));
    if (!interior) {
      // 0.6.2: the seat, the backwall, the return walls and the girder screens share one outer face (75 mm inside
      // the deck edge); they previously stepped by 75 to 100 mm along the side of the abutment.
      const abutment = profiledSupportWall(
        structure,
        m.concrete,
        c,
        s,
        -half + ABUTMENT_SIDE,
        half - ABUTMENT_SIDE,
        1.8,
        () => earth,
        u => seatAt(u),
      );
      abutment.name = 'Abutment seat';
      // Wing/return walls use the actual skewed support line and bridge tangent.
      const direction = j === 0 ? -1 : 1,
        liner = c.abutmentFinish === 'formliner';
      // 0.6.6: formliner on the front wall, from the ground to a 200 mm plain band under the bearing seat.
      if (liner) {
        const u0 = -half + ABUTMENT_SIDE,
          front = t => supportBasis(c, s, u0 + t);
        formlinerFace(
          structure,
          m.concrete,
          {
            length: c.width - 2 * ABUTMENT_SIDE,
            at: t => {
              const p = front(t);
              return [p.x - direction * p.tx * 0.9, p.z - direction * p.tz * 0.9];
            },
            out: t => {
              const p = front(t);
              return [-direction * p.tx, -direction * p.tz];
            },
            bottom: () => earth,
            top: t => seatAt(u0 + t),
          },
          { phase: j * 3, name: 'Abutment formliner' },
        );
      }
      const backwall = profiledSupportWall(
        structure,
        m.concrete,
        c,
        s + direction * 0.8,
        -half + ABUTMENT_SIDE,
        half - ABUTMENT_SIDE,
        0.4,
        u => seatAt(u),
        (u, offset) =>
          Math.max(seatAt(u) + 0.2, profile(c, supportStation(c, s + direction * 0.8, u) + offset) - 0.17 + crossAt(c, u)),
      );
      backwall.name = 'Profile-following backwall';
      if (c.frontSlope && c.approachWalls !== 'mse') {
        // 2H:1V spill slope from the abutment face to the ground, on the same toe line as the quarter cones.
        const fit = frontSlopeFit(c, s),
          reach = fit.reach + 2,
          end = s - direction * reach;
        const slope = sweep(
          c,
          Math.min(s, end),
          Math.max(s, end),
          rect(-half + ABUTMENT_SIDE, half - ABUTMENT_SIDE, 0, -1),
          c.frontSlopeMaterial === 'stone' ? m.stone : c.frontSlopeMaterial === 'concrete' ? m.concrete : m.grass,
          (_, station, v, u) =>
            v === 0 ? fit.top - Math.max(0, Math.abs(station - supportStation(c, s, u)) - 0.9) / 2 : earth + 1,
          Math.ceil(reach * 2),
        );
        slope.name = 'Slope in front of abutment';
        setting.add(slope);
      }
      for (const side of c.approachWalls === 'mse' ? [] : [-1, 1]) {
        const u = side * (half - ABUTMENT_SIDE - 0.225),
          p0 = supportPoint(c, s, u, 0),
          f = frame(c, supportStation(c, s, u), u),
          a = ((c.abutmentType === 'wing' ? c.wingAngle : 0) * Math.PI) / 180;
        const corner = fills.corners.find(p => p.end === s && p.side === side),
          length = Math.max(6, Math.abs(corner.station - s));
        if (c.abutmentType === 'return') {
          const end = s + direction * length,
            wall = sweep(
              c,
              Math.min(s, end),
              Math.max(s, end),
              chamferSection(rect(u - 0.225, u + 0.225, 0, earth)),
              m.concrete,
              (_, station, v) => (v > earth + 0.1 ? profile(c, station) - 0.17 : 0),
              Math.ceil(length),
            );
          wall.name = `Return wall ${j === 0 ? 'start' : 'end'} ${side < 0 ? 'left' : 'right'}`;
          structure.add(wall);
          if (liner) {
            const outer = u + side * 0.225,
              at = t => frame(c, supportStation(c, s + direction * t, outer), outer);
            formlinerFace(
              structure,
              m.concrete,
              {
                length,
                at: t => [at(t).x, at(t).z],
                out: t => [side * at(t).nx, side * at(t).nz],
                bottom: () => earth,
                top: t => profile(c, supportStation(c, s + direction * t, outer)) - 0.17 + crossAt(c, outer),
              },
              { band: 0.3, phase: j * 3 + side + 1, name: 'Return wall formliner' },
            );
          }
        } else {
          const vx = direction * f.tx * Math.cos(a) + side * f.nx * Math.sin(a),
            vz = direction * f.tz * Math.cos(a) + side * f.nz * Math.sin(a),
            p1 = [p0[0] + vx * length, 0, p0[2] + vz * length],
            top = Math.max(seatMin + 0.2, profile(c, s) - 0.17);
          wallBetween(structure, m.concrete, p0, p1, 0.45, earth, top);
          if (liner) {
            // Outer face: the wall normal that points away from the deck centre line.
            let [nx, nz] = [-vz, vx];
            if (nx * side * f.nx + nz * side * f.nz < 0) [nx, nz] = [-nx, -nz];
            formlinerFace(
              structure,
              m.concrete,
              {
                length,
                at: t => [p0[0] + vx * t + nx * 0.225, p0[2] + vz * t + nz * 0.225],
                out: () => [nx, nz],
                bottom: () => earth,
                top: () => top,
              },
              { band: 0.3, phase: j * 3 + side + 1, name: 'Wingwall formliner' },
            );
          }
        }
      }
      // Girder screens (cache-poutres): a concrete wall under each deck edge, from the seat to the slab, between the
      // abutment face and the backwall, so the girder ends and bearings are hidden in elevation.
      if (c.girderScreens && ['concrete', 'steel', 'box'].includes(c.material) && !truss)
        for (const side of [-1, 1]) {
          const flange = c.material === 'concrete' ? 0.6 : c.material === 'box' ? c.boxTopWidth / 2 : 0.25,
            girderFace = half - c.overhang + flange + 0.03,
            outer = half - ABUTMENT_SIDE,
            inner = Math.min(outer - 0.12, Math.max(outer - 0.3, girderFace)),
            [s0, s1] = [s - direction * 0.9, s + direction * 0.6].sort((p, q) => p - q);
          const screen = sweep(
            c,
            s0,
            s1,
            chamferSection(side < 0 ? rect(-outer, -inner, 0, -1) : rect(inner, outer, 0, -1)),
            m.concrete,
            (_, station, v, u) =>
              v > -0.5 ? profile(c, station) - c.asphalt - c.deck : seatAt(u) - 0.05 + 1 - crossAt(c, u),
            2,
          );
          screen.name = 'Girder screen (cache-poutre)';
          structure.add(screen);
          if (liner) {
            const at = t => frame(c, supportStation(c, s0 + t, side * outer), side * outer);
            formlinerFace(
              structure,
              m.concrete,
              {
                length: s1 - s0,
                at: t => [at(t).x, at(t).z],
                out: t => [side * at(t).nx, side * at(t).nz],
                bottom: () => seatAt(side * outer) - 0.05,
                top: t => profile(c, supportStation(c, s0 + t, side * outer)) - c.asphalt - c.deck + crossAt(c, side * outer),
              },
              { band: 0.1, phase: j + side, name: 'Girder screen formliner' },
            );
          }
        }
    } else if (c.structureSystem === 'strutted' && mono) {
      addStrutLeg(c, m, structure, j, earth);
    } else if (c.pierType === 'wall' || (integral && c.pierType === 'hammerhead')) {
      // Rounded or pointed (90° cutwater) ends stay within the original wall length.
      const t = c.wallThickness,
        shaped = c.pierType === 'wall' && c.wallEnds !== 'square',
        end = half - 0.15 - (shaped ? t / 2 : 0);
      const wall = profiledSupportWall(structure, m.concrete, c, s, -end, end, t, () => earth, seatAt);
      wall.name = 'Pier wall';
      if (shaped)
        for (const u of [-end, end]) {
          const f = supportBasis(c, s, u),
            top = Math.min(seatAt(u, -t / 2), seatAt(u, t / 2));
          pierNose(structure, m.concrete, f, earth, top, t, c.wallEnds);
        }
    } else {
      const bent = c.pierType !== 'hammerhead',
        capWidth = bent ? c.bentWidth : c.hammerheadThickness,
        // V pier without a cap: the arms carry the outer bearings directly (box and slab decks, as built).
        capped = !(c.pierType === 'vshape' && !c.vCap);
      // Outer columns at the chosen spacing (auto: 64 % of the deck), the others equally spaced. A portal has two
      // legs; a V pier two arms from one footing, opening by vAngle from the vertical (or reaching the outer
      // bearings when there is no cap).
      const columns = c.pierType === 'portal' ? 2 : c.columns,
        spread = c.columnSpread > 0 ? c.columnSpread : c.width * 0.64,
        outerBearing = Math.max(0.6, ...bearingPositions(c).map(Math.abs)),
        vTop = capped
          ? Math.tan((c.vAngle * Math.PI) / 180) * Math.max(1, seatAt(0) - c.bentThickness - earth - 0.6) +
            c.vArmThickness / 2
          : Math.min(half - 0.15 - c.vArmThickness / 2, outerBearing);
      // Cap: user-selected transverse start of the straight taper; zero retains the automatic column-face start.
      const tip = half - 0.15,
        autoStart =
          c.pierType === 'hammerhead'
            ? c.hammerheadWidth / 2 + (c.hammerheadShape === 'flared' ? c.hammerheadFlare : 0)
            : c.pierType === 'vshape'
              ? vTop + c.vArmThickness / 2
              : columns > 1
                ? spread / 2 + c.columnDiameter / 2
                : c.columnDiameter / 2,
        taperStart = Math.max(0, Math.min(tip - 0.3, c.bentTaperStart > 0 && bent ? c.bentTaperStart : autoStart));
      const capDepthAt = u => {
        if (integral || !capped) return 0;
        const t = Math.max(0, Math.min(1, (Math.abs(u) - taperStart) / Math.max(0.01, tip - taperStart)));
        return bent
          ? c.bentThickness + (c.bentEndThickness - c.bentThickness) * t
          : c.hammerheadCapDepth + (c.hammerheadCapEndDepth - c.hammerheadCapDepth) * t;
      };
      const capBottom = (u, offset) => seatAt(u, offset) - capDepthAt(u);
      if (!integral && capped) {
        const cap = profiledSupportWall(
          structure,
          m.concrete,
          c,
          s,
          -half + 0.15,
          half - 0.15,
          capWidth,
          capBottom,
          (u, offset) => seatAt(u, offset),
          [-taperStart, taperStart],
        );
        cap.name = 'Pier cap';
      }
      const capUnder = u => Math.max(capBottom(u, -capWidth / 2), capBottom(u, capWidth / 2));
      if (c.pierType === 'vshape') {
        // Two inclined arms from one footing to the cap soffit (or the bearing seats), meeting at the footing.
        // Horizontal end faces; the arm depth along the road is the cap width.
        const a = c.vArmThickness,
          depth = capWidth,
          f0 = supportBasis(c, s, 0);
        for (const side of [-1, 1]) {
          const u = side * vTop,
            ft = supportBasis(c, s, u),
            top = capped ? capUnder(u) + 0.05 : Math.min(seatAt(u, -depth / 2), seatAt(u, depth / 2)),
            arm = leg(
              structure,
              m.concrete,
              f0,
              new T.Vector3(f0.x + (f0.ax * side * a) / 2, earth + 0.3, f0.z + (f0.az * side * a) / 2),
              new T.Vector3(ft.x, top, ft.z),
              a,
              depth,
            );
          arm.name = 'V pier arm';
        }
        box(structure, m.concrete, f0.x, earth + 0.2, f0.z, 2 * a + 0.8, 0.6, depth + 0.6, f0.angle).name = 'V pier footing';
      }
      const us =
        c.pierType === 'vshape'
          ? []
          : c.pierType === 'hammerhead' || columns === 1
            ? [0]
            : Array.from({ length: columns }, (_, n) => -spread / 2 + (n * spread) / (columns - 1));
      for (const u of us) {
        // A column under the tapered part of a cap reaches the highest point of the soffit over its width (it
        // stopped at the soffit level on its axis: a gap on the outer half, 0.6.2).
        const reach = (c.pierType === 'hammerhead' ? c.hammerheadWidth : c.columnDiameter) / 2,
          f = supportBasis(c, s, u),
          height = Math.max(capUnder(u - reach), capUnder(u), capUnder(u + reach)) - earth;
        if (c.pierType === 'portal') {
          // Square or rectangular portal legs, inclined in the support plane: the batter is the inward offset of
          // each footing (negative: legs spread towards the ground). Horizontal top and bottom faces.
          const fb = supportBasis(c, s, u - Math.sign(u) * c.portalBatter),
            thickness = c.columnShape === 'rectangular' ? c.columnThickness : c.columnDiameter,
            post = leg(
              structure,
              m.concrete,
              f,
              new T.Vector3(fb.x, earth, fb.z),
              new T.Vector3(f.x, earth + height + 0.05, f.z),
              c.columnDiameter,
              thickness,
            );
          post.name = 'Portal leg';
          box(structure, m.concrete, fb.x, earth + 0.12, fb.z, c.columnDiameter + 0.3, 0.45, thickness + 0.3, f.angle).name = 'Column footing';
          continue;
        }
        if (c.pierType === 'hammerhead') {
          // Stem: local X follows the support line; skew is not added a second time. Oblong: rounded side faces.
          // Flared: a concave fillet joins the stem to the head soffit on each side.
          const w = c.hammerheadWidth,
            d = c.hammerheadThickness,
            oblong = c.hammerheadShape === 'oblong' && w > d;
          const stem = box(structure, m.concrete, f.x, earth + height / 2, f.z, oblong ? w - d : w, height, d, f.angle);
          stem.name = 'Hammerhead stem';
          if (oblong)
            for (const side of [-1, 1])
              pierNose(
                structure,
                m.concrete,
                { ...f, x: f.x + (f.ax * side * (w - d)) / 2, z: f.z + (f.az * side * (w - d)) / 2 },
                earth,
                earth + height,
                d,
                'round',
              );
          if (c.hammerheadShape === 'flared' && !integral) {
            const reach = Math.min(c.hammerheadFlare, tip - w / 2 - 0.2),
              rise = Math.min(reach * 1.2, height * 0.6);
            for (const side of [-1, 1]) {
              if (reach <= 0.1) break;
              const a = side < 0 ? -w / 2 - reach : w / 2 - 0.02,
                b = side < 0 ? -w / 2 + 0.02 : w / 2 + reach,
                fillet = profiledSupportWall(
                  structure,
                  m.concrete,
                  c,
                  s,
                  a,
                  b,
                  d,
                  (q, offset) => {
                    const t = Math.min(1, Math.max(0, (Math.abs(q) - w / 2) / reach));
                    return capBottom(q, offset) - rise * (1 - Math.sqrt(1 - (1 - t) ** 2));
                  },
                  (q, offset) => capBottom(q, offset) + 0.02,
                  Array.from({ length: 13 }, (_, k) => a + ((b - a) * k) / 12),
                );
              fillet.name = 'Hammerhead flare';
            }
          }
          box(structure, m.concrete, f.x, earth + 0.12, f.z, w + 0.3, 0.45, d + 0.3, f.angle).name = 'Column footing';
          continue;
        } else if (c.columnShape !== 'round') {
          // Square, or rectangular: width across the support line, thickness along the road.
          const thickness = c.columnShape === 'rectangular' ? c.columnThickness : c.columnDiameter,
            column = box(structure, m.concrete, f.x, earth + height / 2, f.z, c.columnDiameter, height, thickness, f.angle);
          column.name = c.columnShape === 'rectangular' ? 'Rectangular column' : 'Square column';
        } else {
          const column = new T.Mesh(
            new T.CylinderGeometry(c.columnDiameter / 2, c.columnDiameter / 2, height, 16),
            m.concrete,
          );
          column.position.set(f.x, earth + height / 2, f.z);
          column.name = 'Round column';
          column.castShadow = true;
          column.receiveShadow = true;
          structure.add(column);
        }
        const footprint = c.columnShape === 'rectangular' ? c.columnThickness : c.columnDiameter;
        box(structure, m.concrete, f.x, earth + 0.12, f.z, c.columnDiameter + 0.3, 0.45, footprint + 0.3, f.angle).name = 'Column footing';
      }
      if (c.pierType === 'portal' && c.portalBeam) {
        // Tie beam between the portal legs at mid-height.
        const f = supportBasis(c, s, 0),
          y = earth + 0.5 * (capUnder(0) - earth),
          inner = spread - c.columnDiameter - c.portalBatter;
        if (inner > 0.2) {
          const beam = box(structure, m.concrete, f.x, y, f.z, inner, Math.min(1.2, c.columnDiameter), c.columnDiameter * 0.8, f.angle);
          beam.name = 'Portal tie beam';
        }
      }
    }
    if (c.continuous && c.material === 'concrete' && interior) {
      const i = Math.min(j, c.spans.length - 1),
        d = girderDepth(c, s),
        y = girderTop(c, i, s) - d / 2;
      crossPlate(
        structure,
        m.concrete,
        c,
        s,
        -half + c.overhang - 0.6,
        half - c.overhang + 0.6,
        () => y + d / 2,
        () => y - d / 2,
        0.65,
        'Continuity diaphragm',
      );
    }
    for (const u of mono ? [] : bearingPositions(c))
      for (const side of lines) {
        const sg = supportStation(c, s, u) + side,
          f = frame(c, sg, u),
          underside = padBottom(u, side);
        // Fixed 75 mm elastomeric pads; plinth height varies to meet each beam on the common support seat.
        const bearing = supportBasis(c, s, u);
        box(structure, m.dark, f.x, underside + 0.0375, f.z, 0.55, 0.075, 0.48, bearing.angle - Math.PI / 2).name = 'Bearing pad';
        const height = Math.max(0.1, underside - seatAt(u, side));
        const block = plinth(
          structure,
          m.concrete,
          f.x,
          underside - height / 2,
          f.z,
          0.8,
          height,
          0.72,
          bearing.angle - Math.PI / 2,
        );
        block.name = 'Bearing plinth';
        block.userData.height = height;
      }
    if (c.material !== 'slab' && c.material !== 'psbox' && !truss)
      for (const side of lines) {
        const k = spanOf(side),
          line = s + side;
        // Three 14 mm bearing stiffeners at 150 mm on every plate-girder face; boxes have none.
        if (c.material === 'steel')
          for (let g = 0; g < c.girders; g++) {
            const u = -half + c.overhang + g * gspace;
            for (const face of [-1, 1])
              for (const d of [-0.15, 0, 0.15]) webStiffener(structure, steelFor(g), c, k, line + d, u, face);
          }
        // Internal 25 mm plate diaphragm inside each steel box at every bearing line, web to web.
        if (c.material === 'box')
          for (let g = 0; g < c.girders; g++) {
            const u = -half + c.overhang + g * gspace,
              st = supportStation(c, line, u),
              yt = girderTop(c, k, st, u) - 0.05,
              yb = girderTop(c, k, st, u) - girderDepth(c, st, u) + 0.05,
              inside = y => webOffset(c, k, line, u, y) - c.web;
            skewPlate(
              structure,
              m.steel,
              c,
              line,
              [
                [u - inside(yt), yt + crossAt(c, u - inside(yt))],
                [u + inside(yt), yt + crossAt(c, u + inside(yt))],
                [u + inside(yb), yb + crossAt(c, u + inside(yb))],
                [u - inside(yb), yb + crossAt(c, u - inside(yb))],
              ],
              0.025,
              'Box internal diaphragm',
            );
          }
        if (c.material === 'concrete' && c.continuous && interior) continue;
        for (let g = 0; g < c.girders - 1; g++) {
          const u = -half + c.overhang + g * gspace,
            v = u + gspace,
            su = supportStation(c, line, u),
            sv = supportStation(c, line, v);
          const top = Math.min(girderTop(c, k, su, u), girderTop(c, k, sv, v)),
            soffit = Math.max(girderTop(c, k, su, u) - girderDepth(c, su, u), girderTop(c, k, sv, v) - girderDepth(c, sv, v));
          if (c.material === 'concrete') {
            crossPlate(structure, m.concrete, c, line, u + 0.1, v - 0.1, () => top - 0.05, () => soffit + 0.3, 0.45, 'Concrete end diaphragm');
            continue;
          }
          const xu = crossAt(c, u),
            xv = crossAt(c, v);
          // Support bracing per MTQ Table 10.5-1: plate diaphragm, or K-bracing when the girder is deep
          // (h > 2.1 m, or 1.8 < h <= 2.1 m with S <= 2.7 m). Both keep 100 mm below the top of the
          // girders and at least 150 mm above their bottom; both cases can occur on one bridge.
          const h = top - soffit,
            kBracing = c.material === 'steel' && (h > 2.1 || (h > 1.8 && gspace <= 2.7)),
            yt = top - 0.1,
            yb = soffit + 0.15,
            at = y => [
              [u + webOffset(c, k, line, u, y), y + xu],
              [v - webOffset(c, k, line, v, y), y + xv],
            ],
            plateGirder = (y0, y1, name) => {
              skewPlate(structure, m.steel, c, line, [...at(y0), ...at(y1).reverse()], 0.016, name);
              for (const y of [y0, y1 + 0.025])
                skewPlate(structure, m.steel, c, line, [...at(y), ...at(y - 0.025).reverse()], 0.3, name + ' flange');
            };
          if (!kBracing) {
            plateGirder(yt, yb, 'Support diaphragm');
            continue;
          }
          // K-bracing: shallow plate girder at the bottom, top strut and two angles meeting at mid-span.
          const beamTop = Math.min(yb + Math.max(0.6, 0.3 * h), yt - 0.6),
            mid = (u + v) / 2,
            left = at(yt)[0][0],
            right = at(yt)[1][0];
          plateGirder(beamTop, yb, 'K-bracing bottom girder');
          const xm = (xu + xv) / 2;
          bracingMember(structure, m.steel, supportPoint(c, line, left, yt - 0.07 + xu), supportPoint(c, line, right, yt - 0.07 + xv));
          for (const [x, dx] of [
            [left, xu],
            [right, xv],
          ])
            bracingMember(structure, m.steel, supportPoint(c, line, x, yt - 0.07 + dx), supportPoint(c, line, mid + Math.sign(x - mid) * 0.12, beamTop + 0.03 + xm));
          skewPlate(
            structure,
            m.steel,
            c,
            line,
            [
              [mid - 0.3, beamTop + 0.3 + xm],
              [mid + 0.3, beamTop + 0.3 + xm],
              [mid + 0.3, beamTop + xm],
              [mid - 0.3, beamTop + xm],
            ],
            0.016,
            'K-bracing gusset',
          );
        }
      }
  });
  if (c.structureSystem === 'arch') addArch(c, m, structure, earthLevel, terrainSampler(c));
  // Return-wall length behind each abutment corner (also the length of the bridge barrier on the approach).
  const wallLength = (end, side) => {
    const corner = fills.corners.find(p => p.end === end && p.side === side);
    return Math.max(6, Math.abs(corner.station - end));
  };
  for (const [a, b] of fills.ranges) {
    const first = deck.children.length,
      start = a < 0,
      end = start ? 0 : L,
      dir = start ? -1 : 1;
    if (c.approachWalls === 'mse') {
      const mat = mseWallMaterial(m.concrete),
        ground = terrainSampler(c);
      for (const side of [-1, 1]) {
        const u = side * (half - 0.3),
          wall = sweep(
            c,
            a,
            b,
            rect(u - 0.225, u + 0.225, 0, -1),
            mat,
            (_, station, v, across) => {
              const f = frame(c, station, across);
              return v === 0 ? profile(c, station) - 0.17 + crossAt(c, across) : ground(f.x, f.z) - 0.25 + 1;
            },
            Math.ceil(b - a),
            false,
          );
        wall.name = 'MSE approach wall';
        const pos = wall.geometry.attributes.position,
          uv = wall.geometry.attributes.uv;
        for (let i = 0; i < pos.count; i++)
          uv.setXY(i, alignmentStation(c, pos.getX(i), pos.getZ(i)), pos.getY(i));
        clipMeshAtCut(wall, start ? -fills.extent / 2 : fills.extent / 2, start, true);
        structure.add(wall);
      }
    }
    // The sidewalk protection continues on the approaches only with the bridge railings; otherwise the
    // pavement runs up to the sidewalk face (no open strip where a Type 301 barrier stood on the deck).
    const paveEdge = side => (innerOnApproach ? (side < 0 ? roadMin : roadMax) : sidewalkFace(side));
    // Edge protection per side: the bridge railing over the return wall, then the approach choice (continued
    // railings — pedestrian bridges: wheel curb + 20C —, W-beam guardrail or nothing).
    const bridgeType = side => (side < 0 ? c.leftRailing : c.rightRailing),
      approachType = side =>
        c.approachBarrier === 'extend' ? (c.trafficMode === 'cyclists' ? '20C' : bridgeType(side)) : null,
      wallEnd = side => end + dir * wallLength(end, side),
      inWall = (side, q) => (start ? q >= wallEnd(side) - 1e-6 : q <= wallEnd(side) + 1e-6),
      edgeType = (side, q) => (inWall(side, q) ? bridgeType(side) : approachType(side));
    // Pavement stops at the barrier or wheel-curb face: concrete, not asphalt, under curbs and barriers.
    const cuts = [...new Set([a, b, wallEnd(-1), wallEnd(1)].filter(q => q >= a && q <= b))].sort((p, q) => p - q);
    for (let k = 0; k < cuts.length - 1; k++) {
      const p = cuts[k],
        q = cuts[k + 1],
        mid = (p + q) / 2;
      if (q - p < 1e-4) continue;
      const edgeOf = side => {
        if ((side < 0 && leftSide) || (side > 0 && rightSide)) return paveEdge(side);
        const type = edgeType(side, mid);
        return type ? side * (half - edgeWidth(type)) : side * half;
      };
      const lo = edgeOf(-1),
        hi = edgeOf(1);
      addSweep(deck, p, q, rect(lo, hi, 0, -0.17), c.laneCount ? m.asphalt : m.concrete).name = 'Approach pavement';
      if (lo > -half + 1e-6) addSweep(deck, p, q, rect(-half, lo, -c.asphalt, -0.17), m.concrete).name = 'Approach pavement';
      if (hi < half - 1e-6) addSweep(deck, p, q, rect(hi, half, -c.asphalt, -0.17), m.concrete).name = 'Approach pavement';
    }
    addSidewalks(a, b);
    if (innerOnApproach)
      for (const [side, on] of [
        [-1, leftSide],
        [1, rightSide],
      ]) {
        if (!on) continue;
        const u = (side < 0 ? roadMin : roadMax) + side * layout.innerBarrier;
        addBarrier(a, b, u, side, c.sidewalkRailing, c.sidewalkRailing === '301' ? null : sidewalkAt(side, u), undefined, {
          origin: L / 2,
          capStart: false,
          capEnd: false,
        });
      }
    addMarkings(a, b);
    addMedian(a, b);
    for (const side of [-1, 1]) {
      const onWalk = (side < 0 && leftSide) || (side > 0 && rightSide),
        raised = onWalk ? sidewalkAt(side, side * half) : null,
        w = wallEnd(side),
        continues = approachType(side) === bridgeType(side);
      // Over the return wall: the bridge railing, with its post grid.
      const [w0, w1] = start ? [Math.max(a, w), b] : [a, Math.min(b, w)];
      if (w1 > w0)
        addBarrier(w0, w1, side * half, side, bridgeType(side), raised, undefined, {
          origin: L / 2,
          capStart: start && !continues,
          capEnd: !start && !continues,
        });
      const [r0, r1] = start ? [a, Math.max(a, w)] : [Math.min(b, w), b];
      if (r1 - r0 < 0.05) continue;
      if (c.approachBarrier === 'guardrail' && c.trafficMode !== 'cyclists')
        roadsideGuardrail(deck, m, c, r0, r1, side * (half - 0.05));
      else if (approachType(side))
        addBarrier(r0, r1, side * half, side, approachType(side), raised, undefined, {
          origin: L / 2,
          capStart: !start && !continues,
          capEnd: start && !continues,
        });
    }
    const target = start ? -fills.extent / 2 : fills.extent / 2;
    for (const mesh of deck.children.slice(first)) if (mesh.isMesh) clipMeshAtCut(mesh, target, start);
  }
  const waters = site ? addEnvironment(c, m, setting, fills) : [];
  // Water marks on piers standing in the (first) river.
  const stain = m.concrete.userData.stain;
  if (stain) {
    const axis = waters[0]?.userData.axis;
    stain.level.value = axis ? waters[0].userData.level : -1e4;
    if (axis) {
      stain.centre.value.set(axis.x, axis.z);
      stain.along.value.set(axis.dx, axis.dz);
      stain.half.value = axis.half + 2;
    }
  }
  const lighting = c.lighting === 'none' || !site ? null : buildLighting(c, m, fills.ranges);
  if (lighting) {
    root.add(lighting.group);
    lighting.setOn(false);
  }
  const vehicles = [deck, setting].flatMap(group => group.children.find(o => o.name === 'Traffic')?.children ?? []);
  if (batch) {
    for (const vehicle of vehicles) batchMeshes(vehicle);
    for (const group of [deck, haunches, structure, setting]) batchMeshes(group);
  }
  return {
    root,
    deck,
    structure,
    haunches,
    setting,
    waters,
    vehicles,
    lighting,
    traffic: deck.children.find(o => o.name === 'Traffic'),
    config: c,
  };
}

// Inclined leg or arm with horizontal end faces: footing centre p0, top centre p1; section w along the support
// line (f.ax, f.az) and d square to it in plan.
function leg(parent, mat, f, p0, p1, w, d) {
  const geometry = new T.BoxGeometry(1, 1, 1),
    pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * w,
      z = pos.getZ(i) * d,
      base = pos.getY(i) < 0 ? p0 : p1;
    // (ax, up, -az/ax normal) is right-handed, so the box winding stays outward.
    pos.setXYZ(i, base.x + f.ax * x - f.az * z, base.y, base.z + f.az * x + f.ax * z);
  }
  geometry.computeVertexNormals();
  const mesh = new T.Mesh(geometry, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Pier wall / stem end: half-round, or a 90° cutwater (a square prism turned 45°), centred on the end of the
// straight part; width t along the road.
function pierNose(parent, mat, f, bottom, top, t, shape) {
  const height = top - bottom;
  if (height <= 0.05) return null;
  const mesh =
    shape === 'pointed'
      ? new T.Mesh(new T.BoxGeometry(t / Math.SQRT2, height, t / Math.SQRT2), mat)
      : new T.Mesh(new T.CylinderGeometry(t / 2, t / 2, height, 24), mat);
  mesh.position.set(f.x, bottom + height / 2, f.z);
  mesh.rotation.y = f.angle + (shape === 'pointed' ? Math.PI / 4 : 0);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = shape === 'pointed' ? 'Pointed pier end' : 'Rounded pier end';
  parent.add(mesh);
  return mesh;
}

// TSM / MSE reference: staggered concrete panels, dark joints and alternating inset ribbed strips.
function mseWallMaterial(concrete) {
  const mat = concrete.clone(),
    previous = concrete.onBeforeCompile;
  mat.userData = { ...concrete.userData, chamfer: false, noBatch: true, ownedMaterial: true };
  mat.customProgramCacheKey = () => concrete.customProgramCacheKey() + '|mse-panels';
  mat.onBeforeCompile = (shader, renderer) => {
    previous.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 mseUV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nmseUV=uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 mseUV;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 panel=mseUV/vec2(2.4,1.2);panel.x+=mod(floor(panel.y),2.)*.5;
        vec2 tile=floor(panel),p=fract(panel),edge=min(p,1.-p)*vec2(2.4,1.2);
        float joint=1.-smoothstep(.003,.014,min(edge.x,edge.y));
        float variant=fract(sin(dot(tile,vec2(127.1,311.7)))*43758.5453);
        float band=1.-smoothstep(.055,.08,abs(p.y-(.18+.6*variant)));
        float ribs=.72+.1*sin(mseUV.y*420.);
        diffuseColor.rgb*=mix(1.+(variant-.5)*.08,ribs,band)*(1.-.45*joint);
      `);
  };
  return mat;
}

// Merge repeated static surfaces by material while preserving the three visibility layers.
function batchMeshes(group) {
  group.updateMatrixWorld(true);
  const batches = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || child.isInstancedMesh || child.material.userData.flowTime || child.material.userData.noBatch) continue;
    const g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    g.applyMatrix4(child.matrix);
    if (!g.attributes.uv)
      g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    // Project each triangle in world metres, keeping aggregate/formwork scale consistent.
    if (child.material.userData.textureMetres) {
      const p = g.attributes.position,
        n = g.attributes.normal,
        uv = g.attributes.uv,
        size = child.material.userData.textureMetres;
      for (let i = 0; i < p.count; i += 3) {
        const axis = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))];
        const major = axis.indexOf(Math.max(...axis));
        for (let j = i; j < i + 3; j++)
          uv.setXY(j, (major === 0 ? p.getZ(j) : p.getX(j)) / size, (major === 1 ? p.getZ(j) : p.getY(j)) / size);
      }
    }
    if (!batches.has(child.material)) batches.set(child.material, []);
    batches.get(child.material).push(g);
    group.remove(child);
    // Vehicle templates and contact shadows share their geometry between instances.
    if (!child.userData.sharedGeometry) child.geometry.dispose();
  }
  for (const [mat, geos] of batches) {
    const g = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!g) throw Error('Could not combine bridge geometry.');
    const mesh = new T.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

// Fit the sun's orthographic shadow frustum to the model, from short spans to 150 m spans.
export function frameShadows(sun, model) {
  if (!sun || !model) return;
  const sphere = new T.Box3().setFromObject(model.root).getBoundingSphere(new T.Sphere()),
    r = Math.max(40, sphere.radius),
    cam = sun.shadow.camera;
  cam.left = -r;
  cam.right = r;
  cam.top = r;
  cam.bottom = -r;
  cam.near = -2 * r;
  cam.far = 3 * r;
  cam.updateProjectionMatrix();
  sun.target.position.copy(sphere.center);
  sun.target.updateMatrixWorld();
  return r;
}

export function disposeModel(model) {
  if (!model) return;
  model.lighting?.dispose();
  const geometries = new Set(),
    materials = new Set();
  model.root.traverse(o => {
    // Cached EZ-Tree geometries are shared between rebuilds.
    if (o.geometry && !o.userData.sharedGeometry) geometries.add(o.geometry);
    o.customDepthMaterial?.dispose();
    if (o.material?.userData.ownedMaterial) materials.add(o.material);
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
}
