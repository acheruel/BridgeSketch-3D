import { edgeWidth } from './deck-profiles.mjs';

export const defaults = {
  version: 1,
  name: '',
  width: 12,
  overhang: 1.2,
  girders: 5,
  material: 'concrete',
  depth: 1.4,
  web: 0.014,
  deck: 0.225,
  slabDepth: 0.8,
  asphalt: 0.065,
  haunch: 0.05,
  barrier: 1.1,
  continuous: true,
  variableDepth: false,
  pierDepth: 2.4,
  taper: 30,
  steelColor: 'brown',
  // 0.6.7: maximum spacing of the intermediate steel cross-frames in each span (m).
  frameSpacing: 8,
  fasciaColor: 'same',
  barrierType: 'concrete',
  leftRailing: '201',
  rightRailing: '201',
  sidewalkRailing: 'none',
  approachBarrier: 'guardrail',
  lighting: 'none',
  lightSpacing: 30,
  lightColor: 'white',
  lightSides: 'both',
  abutmentType: 'return',
  wingAngle: 30,
  laneCount: 2,
  sidewalkSide: 'none',
  sidewalkWidth: 3,
  showTraffic: true,
  boxTopWidth: 2.4,
  boxBottomWidth: 1.7,
  laneWidth: 3.5,
  movingTraffic: true,
  trafficMode: 'vehicles',
  waterStyle: 'glossy',
  skyMode: 'clouds',
  // 0.6.7: Medium (balanced) by default for every example; the atmospheric haze option is gone.
  renderQuality: 'balanced',
  fog: false,
  weather: 'clear',
  bentWidth: 1.9,
  bentThickness: 1,
  bentEndThickness: 1,
  bentTaperStart: 0,
  pierType: 'bent',
  columns: 2,
  columnShape: 'round',
  columnDiameter: 1.3,
  columnThickness: 1,
  columnSpread: 0,
  hammerheadWidth: 2.4,
  hammerheadThickness: 1.0,
  wallThickness: 0.8,
  wallEnds: 'round',
  hammerheadShape: 'rectangular',
  hammerheadCapDepth: 1.6,
  hammerheadCapEndDepth: 0.8,
  portalBatter: 0.8,
  portalBeam: false,
  vCap: true,
  hammerheadFlare: 1.5,
  bloom: true,
  birds: false,
  vAngle: 20,
  vArmThickness: 1,
  skew: 0,
  curved: false,
  radius: 250,
  direction: 1,
  elevation: 7,
  profile: 'crest',
  rise: 0.45,
  grade: 0,
  approach: 22,
  frontSlope: false,
  frontSlopeDrop: 0,
  frontSlopeMaterial: 'grass',
  approachConeMaterial: 'grass',
  approachWalls: 'none',
  environment: 'rural',
  terrainMode: 'grass',
  terrainShape: 'natural',
  sceneWidth: 140,
  background: 'blue',
  timeOfDay: 18,
  timeFlow: true,
  seed: 17,
  trainStyle: 'mixed',
  medianType: 'none',
  medianWidth: 1.2,
  // Structural system (0.5.5): simply supported / continuous girders, rigid frame (portique), strutted frame
  // (béquilles) or arch (deck arch with spandrel columns, or tied through arch above the deck).
  structureSystem: 'girder',
  strutAngle: 30,
  archType: 'deck',
  archMaterial: 'concrete',
  archSpan: -1,
  archRise: 0.18,
  psboxCount: 1,
  // 0.6.0: deck crossfall — crown (2 % each way from the crown line) or a uniform 2 / 3 / 4 % slope falling to
  // the left or right; crownOffset moves the crown (profile grade) line across the deck, 0 = deck centreline.
  crossfall: 'crown',
  crossSlope: 2,
  crownOffset: 0,
  // Line between opposing directions: dashed yellow or a solid double yellow line.
  centreLine: 'dashed',
  // Concrete surface: rough (Poly Haven), smooth formwork with panel joints and tie holes, or weathered.
  concreteFinish: 'light',
  // Concrete girder screens (cache-poutres) at the abutments, flush under the deck edge.
  girderScreens: true,
  // 0.6.6: abutment faces smooth, or with an architectural formliner (vertical ribs of varied widths, 40 mm).
  abutmentFinish: 'smooth',
  // 0.6.7: stylised gradient sky by default (the atmosphere model left a grey band near the horizon).
  skyModel: 'stylised',
  // 0.6.6: steel truss footbridge (structureSystem 'truss'): pony or through, Warren / Pratt / Howe web, panel
  // (post spacing), chord height between axes and the spacing of the floor beams and top struts.
  trussType: 'through',
  trussPattern: 'warren',
  trussPanel: 4,
  trussHeight: 4.2,
  trussBraceSpacing: 4,
  spans: [25, 25, 25].map(length => ({ length, obstacle: 'water', width: 22, elevation: 0, angle: 90 })),
};
export const depths = [1, 1.2, 1.4, 1.6, 1.8];
// Steel truss footbridges (0.6.6): the deck rests on 400 mm floor beams that frame into the bottom chords (structure
// depth 500 mm below the haunch line).
// 0.6.8: the trusses stand OUTSIDE the deck. c.width is the deck from curb to curb, exactly the width of the approach
// roads, so the wheel curbs continue straight from the approaches onto the bridge; each chord's inner face is 20 mm
// beyond the curb (TRUSS_GAP) and the floor beams run out to it.
export const TRUSS_GAP = 0.02;
export const TRUSS_DEPTH = 0.5;
export const isTruss = c => c.structureSystem === 'truss';
export const trussChord = c => (c.trussHeight > 2.6 ? 0.36 : 0.3);
// |u| of each truss line (bottom chord axis).
export const trussAxis = c => c.width / 2 + TRUSS_GAP + trussChord(c) / 2;
// Bearing under each truss line: pad 550 mm along the road, a little wider than the chord across it; the concrete
// plinth under the pad is 240 mm larger across (and 800 mm long).
export const trussBearing = c => {
  const across = Math.max(0.48, trussChord(c) + 0.14);
  return { along: 0.55, across, plinthAlong: 0.8, plinthAcross: across + 0.24 };
};
// Half-width of the pier caps and abutment seats: truss line + half the plinth + 200 mm edge margin.
export const trussSupportHalf = c => trussAxis(c) + trussBearing(c).plinthAcross / 2 + 0.2;
// Cast-in-place and prestressed concrete superstructures: solid slab and box girder (« psbox »).
export const isConcreteDeck = c => c.material === 'slab' || c.material === 'psbox';
// Prestressed box girder layout: 1–4 single-cell boxes side by side under one deck slab (a single box gets two
// cells above 16 m of deck). Outer web faces at the top slab, 1:4.5 web batter, 450 mm webs; the bottom slab
// narrows where the box deepens at supports. `top` / `bottom` are half-widths about each box centre.
export function psboxLayout(c, depth = c.depth) {
  const half = c.width / 2,
    count = Math.max(1, Math.min(4, c.psboxCount ?? 1)),
    pitch = c.width / count,
    top =
      count === 1
        ? Math.max(1.3, Math.min(half - 1.1, 0.29 * c.width))
        : Math.max(1.1, Math.min(pitch / 2 - 0.55, 0.33 * pitch)),
    deepest = c.variableDepth ? Math.max(c.pierDepth, c.depth) : c.depth,
    batter = Math.min(0.22, (top - 0.95) / Math.max(0.5, deepest - c.deck)),
    bottom = top - batter * (depth - c.deck),
    centres = Array.from({ length: count }, (_, i) => -half + pitch * (i + 0.5));
  return { half, top, bottom, batter, web: 0.45, cells: count === 1 && c.width > 16 ? 2 : 1, slab: 0.25, count, pitch, centres };
}
// Bearing positions across the deck (u): under every girder, or under the webs of each concrete box.
export function bearingPositions(c) {
  if (c.material === 'psbox') {
    const box = psboxLayout(c, c.variableDepth ? c.pierDepth : c.depth),
      d = Math.max(0.5, box.bottom - 0.45);
    return box.centres.flatMap(u => (box.cells > 1 ? [u - d, u, u + d] : [u - d, u + d]));
  }
  // 0.6.8: one bearing under each truss line, outside the deck.
  if (c.structureSystem === 'truss') return [-trussAxis(c), trussAxis(c)];
  return Array.from({ length: c.girders }, (_, g) => -c.width / 2 + c.overhang + g * spacing(c));
}
// Supports without bearings: every support of a rigid frame, the leg joints of a strutted frame.
export function monolithicSupport(c, j) {
  const last = c.spans.length;
  if (c.structureSystem === 'frame') return true;
  return c.structureSystem === 'strutted' && (j === 1 || j === last - 1) && j > 0 && j < last;
}
// Arch span: the chosen span, or the longest one.
export function archSpanIndex(c) {
  if (c.archSpan >= 0 && c.archSpan < c.spans.length) return c.archSpan;
  return c.spans.reduce((best, s, i) => (s.length > c.spans[best].length ? i : best), 0);
}
// Railway ballast raises the top of the sleepers 0.5 m above the crossing elevation.
export const RAIL_BED = 0.5;
export const totalLength = c => c.spans.reduce((n, s) => n + s.length, 0);
export const spacing = c => (c.girders === 1 ? 0 : (c.width - 2 * c.overhang) / (c.girders - 1));
// Box webs keep 1H:4V at the typical depth; top flanges stay parallel to the
// alignment and haunch webs become steeper where the box deepens at supports.
export const boxWebOffset = c => (c.depth - 0.1) / 4;
export const boxTopFromBottom = (c, bottom = c.boxBottomWidth) =>
  Number((bottom + 2 * boxWebOffset(c) + 0.5).toFixed(3));
export function fitBoxLayout(c) {
  const deepest = c.depth,
    minTop = 0.3 + (deepest - 0.1) / 2 + 0.5;
  if (c.girders === 1) {
    const edge = Math.max(0.35, Math.min(0.6, (c.width - minTop) / 2)),
      boxTopWidth = Number(Math.min(15, c.width - 2 * edge).toFixed(3));
    if (boxTopWidth < minTop - 0.001) throw Error('This deck is too narrow for one full-width steel box.');
    return {
      ...c,
      boxTopWidth,
      boxBottomWidth: Number((boxTopWidth - (deepest - 0.1) / 2 - 0.5).toFixed(3)),
      overhang: c.width / 2,
    };
  }
  let edge = Math.max(0.35, Math.min(1.2, (c.width - (c.girders - 1) - c.girders * minTop) / 2));
  const gap = Math.max(0.2, Math.min(1, (c.width - 2 * edge - c.girders * minTop) / (c.girders - 1)));
  const boxTopWidth = Number(((c.width - 2 * edge - (c.girders - 1) * gap) / c.girders).toFixed(3));
  if (boxTopWidth < minTop - 0.001 || boxTopWidth > 15)
    throw Error('This deck width cannot fit the boxes and their full-width bottom-flange web connections.');
  edge = (c.width - c.girders * boxTopWidth - (c.girders - 1) * gap) / 2;
  return {
    ...c,
    boxTopWidth,
    boxBottomWidth: Number((boxTopWidth - (deepest - 0.1) / 2 - 0.5).toFixed(3)),
    overhang: Number((edge + boxTopWidth / 2).toFixed(3)),
  };
}
// The bottom flange drives the layout: top flanges, edge cantilevers and gaps follow.
export function fitBoxLayoutFromBottom(c) {
  const n = c.girders,
    bottom = Number(c.boxBottomWidth.toFixed(3)),
    top = boxTopFromBottom(c, bottom),
    room = c.width - n * top;
  const maxBottom =
    n === 1
      ? c.width - 0.7 - 2 * boxWebOffset(c) - 0.5
      : (c.width - 0.7 - 0.2 * (n - 1)) / n - 2 * boxWebOffset(c) - 0.5;
  if (bottom < 0.3) throw Error('Box bottom flange: enter at least 0.30 m.');
  if (top > 15 || room < 0.7 + (n > 1 ? 0.2 * (n - 1) : 0) - 1e-6)
    throw Error(
      `Box bottom flange is too wide for ${n} ${n === 1 ? 'box' : 'boxes'} on this deck; use at most ${Math.max(0.3, maxBottom).toFixed(2)} m, fewer boxes or a wider deck.`,
    );
  if (n === 1) return { ...c, boxBottomWidth: bottom, boxTopWidth: top, overhang: c.width / 2 };
  let gap = Math.min(2, Math.max(0.2, room / (n + 1))),
    edge = (room - (n - 1) * gap) / 2;
  if (edge > 2) {
    gap = Math.min(2, (room - 4) / (n - 1));
    edge = (room - (n - 1) * gap) / 2;
  }
  if (edge > 2.01)
    throw Error(
      `Box bottom flange is too narrow to fill this deck; use at least ${((c.width - 4 - 2 * (n - 1)) / n - 2 * boxWebOffset(c) - 0.5).toFixed(2)} m or add boxes.`,
    );
  return { ...c, boxBottomWidth: bottom, boxTopWidth: top, overhang: Number((edge + top / 2).toFixed(3)) };
}
export const stations = c => c.spans.reduce((a, s) => [...a, a.at(-1) + s.length], [0]);
export const roadLayout = c => {
  const left = c.sidewalkSide === 'left' || c.sidewalkSide === 'both',
    right = c.sidewalkSide === 'right' || c.sidewalkSide === 'both';
  // Type 201 is 410 mm wide, Type 301 435 mm; steel railings stand on 450 mm curbs or sidewalks.
  // 0.6.8: trusses stand outside the deck, so the curbs sit at the deck edge like on every other bridge.
  const leftBarrierWidth = edgeWidth(c.leftRailing),
    rightBarrierWidth = edgeWidth(c.rightRailing);
  const barrierWidth = Math.max(leftBarrierWidth, rightBarrierWidth),
    innerBarrier = c.sidewalkRailing === 'none' ? 0 : edgeWidth(c.sidewalkRailing);
  const roadMin = -c.width / 2 + leftBarrierWidth + (left ? c.sidewalkWidth + innerBarrier : 0),
    roadMax = c.width / 2 - rightBarrierWidth - (right ? c.sidewalkWidth + innerBarrier : 0);
  const medianWidth = c.medianType === 'barrier' ? 0.6 : c.medianType === 'sidewalk' ? c.medianWidth : 0,
    medianCentre = (roadMin + roadMax) / 2,
    medianMin = medianCentre - medianWidth / 2,
    medianMax = medianCentre + medianWidth / 2;
  const laneWidth = c.laneWidth,
    split = Math.floor(c.laneCount / 2),
    shoulders = (roadMax - roadMin - medianWidth - c.laneCount * laneWidth) / 2;
  const leftShoulder = medianWidth ? medianMin - roadMin - split * laneWidth : shoulders,
    rightShoulder = medianWidth ? roadMax - medianMax - (c.laneCount - split) * laneWidth : shoulders;
  const laneStart = roadMin + leftShoulder,
    laneCenters = Array.from({ length: c.laneCount }, (_, i) =>
      medianWidth && i >= split
        ? medianMax + laneWidth / 2 + (i - split) * laneWidth
        : laneStart + laneWidth / 2 + i * laneWidth,
    );
  const laneEdges = [
    ...new Set(laneCenters.flatMap(u => [u - laneWidth / 2, u + laneWidth / 2]).map(u => Number(u.toFixed(8)))),
  ].sort((a, b) => a - b);
  const dividers = laneCenters
    .slice(1)
    .flatMap((u, i) =>
      medianWidth && i + 1 === split ? [] : [{ u: (u + laneCenters[i]) / 2, opposing: i + 1 === split }],
    );
  return {
    left,
    right,
    barrierWidth,
    leftBarrierWidth,
    rightBarrierWidth,
    innerBarrier,
    roadMin,
    roadMax,
    shoulders,
    leftShoulder,
    rightShoulder,
    laneStart,
    laneCenters,
    laneEdges,
    dividers,
    medianWidth,
    medianCentre,
    medianMin,
    medianMax,
  };
};
// +u is the driver's right when travelling in the increasing-station direction.
export const laneForward = (c, index) => c.laneCount === 1 || index >= Math.floor(c.laneCount / 2);
// Display RGB sampled from the requested AMS-STD-595 catalogue; these are screen approximations.
export const steelFinishes = {
  brown: '#5F4F4A',
  green: '#005F45',
  gray: '#9B9F9B',
  gray16515: '#C7C9C7',
  blue15056: '#253273',
  blue15065: '#005686',
  red: '#AD2328',
  weathered: '#8B6047',
  blue: '#005686',
};
export const terrainBase = c => Math.min(-1.5, ...c.spans.map(s => s.elevation - 1.5));
export const approachDrop = (c, s, base = terrainBase(c)) => Math.max(0.5, profile(c, s) - base - 0.17);
export const approachToeOffset = (c, s, base = terrainBase(c)) => 2 * approachDrop(c, s, base);
const rad = d => (d * Math.PI) / 180;
// Vertical offset of the deck surface at u (m across) relative to the profile grade line: crown with 2 % on
// each side of the crown line, or a uniform crossfall. Everything built on the deck follows it.
export function crossAt(c, u) {
  const d = u - (c.crownOffset ?? 0);
  if (c.crossfall === 'crown') return -0.02 * Math.abs(d);
  if (c.crossfall === 'right') return (-(c.crossSlope ?? 2) / 100) * d;
  if (c.crossfall === 'left') return ((c.crossSlope ?? 2) / 100) * d;
  return 0;
}
// A polygon needs vertices on the centre line to retain both slopes when its faces are triangulated.
export function crossfallSection(c, points, splitEdges) {
  if (c.crossfall !== 'crown') return points;
  const centre = c.crownOffset ?? 0;
  return points.flatMap((p, i) => {
    const q = points[(i + 1) % points.length];
    if (splitEdges ? !splitEdges.has(i) : (p[0] - centre) * (q[0] - centre) >= 0) return [p];
    const t = q[0] === p[0] ? 0 : Math.max(0, Math.min(1, (centre - p[0]) / (q[0] - p[0])));
    return [p, [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]];
  });
}
// Lowest deck offset across the width (conservative clearance).
export const lowestCross = c => Math.min(crossAt(c, -c.width / 2), crossAt(c, c.width / 2), crossAt(c, 0));
// Obstacles under a span: water, road, railway or open ground (terrain vague, no crossing).
export const obstacleTypes = ['water', 'road', 'rail', 'land'];
export function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('Choose a BridgeSketch 3D JSON configuration.');
  if (raw.version !== undefined && raw.version !== 1) throw Error('This configuration version is not supported.');
  const c = {
    ...defaults,
    ...Object.fromEntries(
      Object.keys(defaults)
        .filter(k => Object.hasOwn(raw, k))
        .map(k => [k, raw[k]]),
    ),
  };
  c.steelColor =
    { blue: 'blue15065', bluegreen: 'blue15065', blue15090: 'blue15065', greengray: 'gray' }[c.steelColor] ??
    c.steelColor;
  if (typeof c.name !== 'string') c.name = '';
  c.name = c.name
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 60);
  if (!Object.hasOwn(raw, 'leftRailing')) c.leftRailing = c.barrierType === 'steel' ? '210A' : '201';
  if (!Object.hasOwn(raw, 'rightRailing')) c.rightRailing = c.barrierType === 'steel' ? '210A' : '201';
  // Earlier files: generic concrete barrier → Type 201 at the edge, Type 301 in front of a sidewalk.
  if (c.leftRailing === 'concrete') c.leftRailing = '201';
  if (c.rightRailing === 'concrete') c.rightRailing = '201';
  if (c.sidewalkRailing === 'concrete') c.sidewalkRailing = '301';
  // Fascia (edge) girder finish: 'same' as the interior girders, a catalogue finish or a hex colour.
  if (typeof c.fasciaColor === 'string' && /^#[0-9a-f]{6}$/i.test(c.fasciaColor)) c.fasciaColor = c.fasciaColor.toUpperCase();
  if (!(c.fasciaColor === 'same' || Object.hasOwn(steelFinishes, c.fasciaColor) || /^#[0-9A-F]{6}$/.test(c.fasciaColor)))
    throw Error('Select a fascia girder finish.');
  if (typeof c.steelColor === 'string' && /^#[0-9a-f]{6}$/i.test(c.steelColor))
    c.steelColor = c.steelColor.toUpperCase();
  if (!Object.hasOwn(raw, 'boxBottomWidth')) c.boxBottomWidth = c.boxTopWidth - c.depth / 2;
  Object.assign(c, { asphalt: 0.065, web: 0.014, barrier: 1.1 });
  // Structural slab thickness under the asphalt: 200, 225 (default) or 250 mm.
  c.deck = Number(c.deck);
  if (![0.2, 0.225, 0.25].includes(c.deck)) throw Error('Slab thickness: select 200, 225 or 250 mm.');
  // 0.6.7: haze removed; old links and files may still carry fog: true.
  c.fog = false;
  if (typeof c.timeFlow !== 'boolean') throw Error('Invalid time flow option.');
  if (!['clear', 'rain', 'snow', 'leaves'].includes(c.weather)) throw Error('Select the weather: clear, rain, snow or falling leaves.');
  if (
    !['vehicles', 'cyclists'].includes(c.trafficMode) ||
    !['natural', 'glossy'].includes(c.waterStyle) ||
    !['clear', 'clouds'].includes(c.skyMode)
  )
    throw Error('Select traffic, water and sky styles.');
  if (!['auto', 'performance', 'balanced', 'high'].includes(c.renderQuality)) throw Error('Select a render quality.');
  if (!['crown', 'left', 'right', 'flat'].includes(c.crossfall)) throw Error('Select a crown or a uniform crossfall.');
  c.crossSlope = Number(c.crossSlope);
  if (![2, 3, 4].includes(c.crossSlope)) throw Error('Uniform crossfall: select 2, 3 or 4 %.');
  if (typeof c.crownOffset !== 'number' || !Number.isFinite(c.crownOffset) || Math.abs(c.crownOffset) > c.width / 2)
    throw Error('Center line: enter an offset within the deck width.');
  if (!['dashed', 'double'].includes(c.centreLine)) throw Error('Select a dashed or double yellow centre line.');
  c.concreteFinish = { rough: 'light', formwork: 'light', weathered: 'warm' }[c.concreteFinish] ?? c.concreteFinish;
  if (!['light', 'warm'].includes(c.concreteFinish)) throw Error('Select a concrete finish.');
  if (typeof c.girderScreens !== 'boolean') throw Error('Invalid girder screen option.');
  if (!['smooth', 'formliner'].includes(c.abutmentFinish)) throw Error('Select a smooth or formliner abutment finish.');
  if (!['atmosphere', 'stylised', 'physical'].includes(c.skyModel)) throw Error('Select a sky model.');
  const cycling = c.trafficMode === 'cyclists';
  const limits = {
    width: [cycling ? 3 : 4, 30],
    overhang: [cycling ? 0.3 : 0.65, 15],
    girders: [1, 14],
    depth: [0.4, 5],
    slabDepth: [0.3, 2.5],
    pierDepth: [0.4, 8],
    taper: [10, 45],
    columnDiameter: [0.35, 3],
    columnThickness: [0.35, 3],
    columnSpread: [0, 60],
    frontSlopeDrop: [0, 15],
    lightSpacing: [2, 80],
    hammerheadWidth: [1, 8],
    hammerheadThickness: [0.35, 2],
    wallThickness: [0.25, 2],
    hammerheadCapDepth: [0.5, 4],
    hammerheadCapEndDepth: [0.3, 4],
    portalBatter: [-3, 3],
    hammerheadFlare: [0.3, 6],
    vAngle: [5, 40],
    vArmThickness: [0.4, 2.5],
    web: [0.008, 0.08],
    deck: [0.15, 0.6],
    asphalt: [0.025, 0.2],
    haunch: [0.02, 0.12],
    barrier: [0.8, 1.5],
    wingAngle: [0, 90],
    laneCount: [0, 8],
    sidewalkWidth: [0.5, 6],
    boxTopWidth: [0.8, 15],
    boxBottomWidth: [0.3, 15],
    sceneWidth: [90, 600],
    timeOfDay: [0, 24],
    skew: [-45, 45],
    radius: [30, 5000],
    elevation: [3, 30],
    rise: [0, 3],
    grade: [-6, 6],
    approach: [5, 200],
    seed: [0, 99999],
    frameSpacing: [2, 25],
  };
  Object.assign(limits, {
    laneWidth: [cycling ? 1.5 : 2.5, 4.5],
    bentWidth: [0.5, 5],
    bentThickness: [0.35, 3],
    bentEndThickness: [0.35, 3],
    bentTaperStart: [0, c.width / 2 - 0.15],
  });
  for (const [k, [lo, hi]] of Object.entries(limits))
    if (typeof c[k] !== 'number' || !Number.isFinite(c[k]) || c[k] < lo || c[k] > hi)
      throw Error(`${k}: enter a number from ${lo} to ${hi}.`);
  if (c.bentTaperStart >= c.width / 2 - 0.15 && c.bentEndThickness !== c.bentThickness)
    throw Error('Cap taper start must be inside the transverse cap tip.');
  if (typeof c.movingTraffic !== 'boolean') throw Error('Invalid moving traffic option.');
  if (!['none', 'mse'].includes(c.approachWalls)) throw Error('Select approach retaining walls.');
  if (
    typeof c.frontSlope !== 'boolean' ||
    !['grass', 'stone', 'concrete'].includes(c.frontSlopeMaterial) ||
    !['grass', 'stone'].includes(c.approachConeMaterial)
  )
    throw Error('Invalid abutment slope finish.');
  if (
    !['201', '301', '311', '311A', '210A', '210C', '20C', 'SDC'].includes(c.leftRailing) ||
    !['201', '301', '311', '311A', '210A', '210C', '20C', 'SDC'].includes(c.rightRailing) ||
    !['none', '301', '210A', '210C', '20C'].includes(c.sidewalkRailing)
  )
    throw Error('Invalid railing selection.');
  if (c.trafficMode === 'vehicles' && (c.leftRailing === 'SDC' || c.rightRailing === 'SDC'))
    throw Error('Samuel-De Champlain railings are available for cyclist and pedestrian bridges only.');
  // Approach barriers: none, the bridge railings continued, or a W-beam guardrail (road bridges only).
  if (!['none', 'extend', 'guardrail'].includes(c.approachBarrier)) throw Error('Select an approach barrier.');
  // Night lighting: street lights (30 m by default) or LEDs in a 20C handrail (3 m), white or warm.
  if (
    !['none', 'poles', 'handrail'].includes(c.lighting) ||
    !['white', 'warm'].includes(c.lightColor) ||
    !['both', 'left', 'right'].includes(c.lightSides)
  )
    throw Error('Select a lighting type and colour.');
  if (c.lighting === 'handrail' && ![c.leftRailing, c.rightRailing].some(type => ['20C', 'SDC'].includes(type)))
    throw Error('Handrail lighting needs a 20C or Samuel-De Champlain railing on at least one side.');
  if (c.trafficMode === 'cyclists' && c.approachBarrier === 'guardrail') c.approachBarrier = 'extend';
  if (!Number.isInteger(c.girders) || !Number.isInteger(c.seed) || !Number.isInteger(c.laneCount))
    throw Error('Girder count, lane count and scenery seed must be whole numbers.');
  if (typeof c.curved !== 'boolean' || ![1, -1].includes(c.direction)) throw Error('Invalid horizontal alignment.');
  if (
    typeof c.continuous !== 'boolean' ||
    !(Object.hasOwn(steelFinishes, c.steelColor) || /^#[0-9A-F]{6}$/.test(c.steelColor)) ||
    !['concrete', 'steel', 'box', 'slab', 'psbox'].includes(c.material) ||
    !['concrete', 'steel'].includes(c.barrierType) ||
    !['return', 'wing'].includes(c.abutmentType) ||
    !['none', 'left', 'right', 'both'].includes(c.sidewalkSide) ||
    !['bent', 'wall', 'hammerhead', 'portal', 'vshape'].includes(c.pierType) ||
    !['round', 'pointed', 'square'].includes(c.wallEnds) ||
    !['rectangular', 'oblong', 'flared'].includes(c.hammerheadShape) ||
    typeof c.vCap !== 'boolean' ||
    typeof c.bloom !== 'boolean' ||
    typeof c.birds !== 'boolean' ||
    typeof c.portalBeam !== 'boolean' ||
    !Number.isInteger(c.columns) ||
    c.columns < 1 ||
    c.columns > 6
  )
    throw Error('Invalid material, barrier, wall, sidewalk or pier configuration.');
  if (!['girder', 'frame', 'strutted', 'arch', 'truss'].includes(c.structureSystem)) throw Error('Select a structural system.');
  if (c.structureSystem === 'truss') {
    if (c.trafficMode !== 'cyclists')
      throw Error('Steel trusses are offered for footbridges: set the deck traffic to cyclists and pedestrians.');
    if (!['pony', 'through'].includes(c.trussType) || !['warren', 'pratt', 'howe'].includes(c.trussPattern))
      throw Error('Truss: select pony or through, and a Warren, Pratt or Howe web.');
    for (const [k, lo, hi, label] of [
      ['trussPanel', 2, 8, 'Post spacing'],
      ['trussHeight', 1.2, 6, 'Truss height'],
      ['trussBraceSpacing', 1.5, 12, 'Cross-beam spacing'],
    ])
      if (typeof c[k] !== 'number' || !Number.isFinite(c[k]) || c[k] < lo || c[k] > hi)
        throw Error(`${label}: enter ${lo} to ${hi} m.`);
    // 0.6.7: pony and through trusses take any height in range; the designer decides on the bracing.
    if (c.width < 3 || c.width > 10) throw Error('Truss footbridge: deck width 3 to 10 m.');
    // Deck at the bottom chords: two steel trusses on four bearings per support, no girders, no sidewalks.
    Object.assign(c, {
      material: 'steel',
      girders: 2,
      overhang: 0.3, // unused by trusses (bearings: trussAxis); 0.3 m is the footbridge minimum of the field
      depth: TRUSS_DEPTH,
      variableDepth: false,
      sidewalkSide: 'none',
      sidewalkRailing: 'none',
      medianType: 'none',
    });
  }
  if (
    !['deck', 'tied'].includes(c.archType) ||
    !['concrete', 'steel'].includes(c.archMaterial) ||
    !Number.isInteger(c.archSpan) ||
    typeof c.archRise !== 'number' ||
    !(c.archRise >= 0.1 && c.archRise <= 0.35) ||
    typeof c.strutAngle !== 'number' ||
    !(c.strutAngle >= 15 && c.strutAngle <= 45)
  )
    throw Error('Arch: deck or tied, concrete or steel, rise 0.10–0.35 of the span; strut angle 15–45°.');
  // Frames are monolithic concrete: a box girder unless a solid slab was chosen; always continuous.
  if (c.structureSystem === 'frame' || c.structureSystem === 'strutted') {
    if (!isConcreteDeck(c)) c.material = 'psbox';
    c.continuous = true;
  }
  if (c.structureSystem === 'strutted' && c.spans.length < 3)
    throw Error('A strutted frame needs at least three spans: side span, main span between the legs, side span.');
  if (c.material === 'psbox') c.continuous = true;
  if (!['mixed', 'diesel', 'bullet', 'city'].includes(c.trainStyle)) throw Error('Select a train style.');
  if (!['natural', 'profile'].includes(c.terrainShape)) throw Error('Select a natural or profile-following terrain.');
  if (!['grass', 'fall', 'snow'].includes(c.terrainMode)) throw Error('Select summer grass, autumn or snow terrain.');
  // 0.6.6: the urban setting (lawn and Kenney buildings) is shelved; its code stays in terrain.mjs. Earlier files
  // and links open as rural.
  if (c.environment === 'urban') c.environment = 'rural';
  if (
    !['rural', 'none'].includes(c.environment) ||
    !['crest', 'constant'].includes(c.profile) ||
    typeof c.showTraffic !== 'boolean'
  )
    throw Error('Invalid environment, profile or traffic option.');
  // All entry points (controls, files, links and agent tools) enforce the same rule.
  if (c.curved && c.material === 'concrete') c.material = 'steel';
  if (typeof c.variableDepth !== 'boolean') throw Error('Invalid variable-depth option.');
  // Precast NEBT girders have a constant depth.
  if (c.material === 'concrete') c.variableDepth = false;
  if (!['round', 'square', 'rectangular'].includes(c.columnShape))
    throw Error('Select round, square or rectangular columns.');
  // Outer column spacing (centre to centre); 0 keeps the automatic 64 % of the deck width.
  if (c.columnSpread > 0 && c.columns > 1) {
    if (c.columnSpread > c.width) throw Error('Outer column spacing cannot exceed the deck width.');
    if (c.columnSpread / (c.columns - 1) < c.columnDiameter + 0.3)
      throw Error('Columns overlap: increase the outer column spacing or reduce the column size.');
  }
  if (!['blue', 'white'].includes(c.background)) throw Error('Select a blue or white background.');
  c.background = 'blue';
  if (
    !['none', 'barrier', 'sidewalk'].includes(c.medianType) ||
    typeof c.medianWidth !== 'number' ||
    !Number.isFinite(c.medianWidth) ||
    c.medianWidth < 0.6 ||
    c.medianWidth > 4
  )
    throw Error('Select a median type and an island width from 0.6 to 4 m.');
  if (c.medianType !== 'none' && c.laneCount < 2) throw Error('A centre median needs at least two lanes.');
  if (c.material === 'psbox' && c.depth < 1.2) throw Error('Box girder depth: at least 1.2 m.');
  if (c.material === 'psbox' && c.width < 7) throw Error('A concrete box girder needs a deck at least 7 m wide.');
  if (c.variableDepth && c.pierDepth < (c.material === 'slab' ? c.slabDepth : c.depth))
    throw Error('Depth at piers must be at least the typical girder depth.');
  if (c.material === 'box') {
    if (c.boxBottomWidth > c.boxTopWidth) throw Error('Box bottom flange must not be wider than the top flange.');
    if (c.boxBottomWidth + (c.depth - 0.1) / 2 + 0.5 > c.boxTopWidth + 0.001)
      throw Error('Box top flange must cover webs rising from both bottom-flange edges; reduce bottom width or depth.');
  }
  if (c.material === 'concrete' && !depths.includes(c.depth)) throw Error('Select a standard NEBT depth.');
  if (!Array.isArray(c.spans) || c.spans.length < 1 || c.spans.length > 8) throw Error('Use 1 to 8 spans.');
  c.spans = c.spans.map((s, i) => {
    if (!s || typeof s !== 'object') throw Error(`Span ${i + 1} is invalid.`);
    const v = { length: s.length, obstacle: s.obstacle, width: s.width, elevation: s.elevation, angle: s.angle };
    for (const [k, [lo, hi]] of Object.entries({
      length: [10, 150],
      width: [3, 60],
      elevation: [-5, 15],
      angle: [35, 145],
    }))
      if (typeof v[k] !== 'number' || !Number.isFinite(v[k]) || v[k] < lo || v[k] > hi)
        throw Error(`Span ${i + 1} ${k}: enter ${lo} to ${hi}.`);
    if (!obstacleTypes.includes(v.obstacle)) throw Error(`Span ${i + 1}: select road, railway, water or open ground.`);
    return v;
  });
  // Box girder: bearings under the webs (two, or three with a centre web), set from the section at the supports.
  if (c.material === 'psbox') {
    if (!Number.isInteger(c.psboxCount) || c.psboxCount < 1 || c.psboxCount > 4)
      throw Error('Concrete box girders: 1 to 4 boxes.');
    if (c.width / c.psboxCount < 4.2)
      throw Error(`Each concrete box needs at least 4.2 m of deck: use at most ${Math.max(1, Math.floor(c.width / 4.2))} boxes or widen the deck.`);
    const bearings = bearingPositions(c);
    c.girders = bearings.length;
    c.overhang = Number((c.width / 2 + bearings[0]).toFixed(3));
  }
  if (c.girders === 1 && c.material !== 'box') throw Error('One girder is available for steel box bridges only.');
  if (
    !isConcreteDeck(c) &&
    c.girders > 1 &&
    spacing(c) < (c.material === 'concrete' ? 1.3 : c.material === 'box' ? c.boxTopWidth + 0.2 : 0.65)
  )
    throw Error('Girders overlap: increase deck width, reduce overhang or use fewer girders.');
  if (!Object.hasOwn(raw, 'laneCount'))
    c.laneCount = Math.max(1, Math.min(2, Math.floor((c.width - 2 * roadLayout(c).barrierWidth) / c.laneWidth)));
  if (c.material === 'box') {
    const gap = spacing(c) - c.boxTopWidth,
      edge = c.girders === 1 ? (c.width - c.boxTopWidth) / 2 : c.overhang - c.boxTopWidth / 2;
    if (edge < 0.35 || edge > 2.01)
      throw Error('Box edge cantilever must be 0.35 to 2.0 m; adjust box width or overhang.');
    if (c.girders > 1 && gap > 2.01) throw Error('Box girders are too far apart; increase box width or edge overhang.');
  }
  if (Math.min(roadLayout(c).leftShoulder, roadLayout(c).rightShoulder) < -0.0001)
    throw Error('Lanes, median and sidewalks exceed the deck width; reduce them or widen the deck.');
  if (c.curved && c.radius - c.width / 2 < 12)
    throw Error(`Increase the curve radius to at least ${Math.ceil(c.width / 2 + 12)} m for this deck width.`);
  if (c.curved && totalLength(c) / c.radius > 2.2)
    throw Error('Increase the curve radius: total turning angle must stay below 126 degrees.');
  if (c.width * Math.abs(Math.tan(rad(c.skew))) > Math.min(...c.spans.map(s => s.length)) * 0.85)
    throw Error('Skew is too large for the span length and deck width.');
  for (let i = 1; i < c.spans.length; i++)
    if (
      c.spans[i].obstacle === 'water' &&
      c.spans[i - 1].obstacle === 'water' &&
      c.spans[i].elevation !== c.spans[i - 1].elevation
    )
      throw Error('Adjacent water spans must have the same water elevation.');
  for (let i = 1; i < c.spans.length; i++)
    if (
      c.spans[i].obstacle === 'water' &&
      c.spans[i - 1].obstacle === 'water' &&
      c.spans[i].angle !== c.spans[i - 1].angle
    )
      throw Error('Adjacent water spans must have the same river direction.');
  for (let i = 0; i < c.spans.length; i++) {
    const s = c.spans[i];
    if ((s.obstacle === 'road' || s.obstacle === 'rail') && s.width / Math.sin(rad(s.angle)) > s.length - 3)
      throw Error(`Span ${i + 1}: the crossing is too wide for this span and angle.`);
  }
  for (let i = 0; i < c.spans.length; i++)
    if (clearance(c, i) < 0.3)
      throw Error(`Span ${i + 1}: raise the bridge or lower the obstacle; it intersects the structure.`);
  // Limit end slopes for a readable concept model, without suggesting design compliance.
  if (c.profile === 'crest' && (4 * c.rise) / totalLength(c) > 0.12)
    throw Error('Reduce crest rise for this bridge length.');
  return c;
}
export function frame(c, s, u = 0) {
  const L = totalLength(c);
  if (c.curved && (s < 0 || s > L)) {
    const end = s < 0 ? 0 : L,
      f = frame(c, end, u);
    return { ...f, x: f.x + (s - end) * f.tx, z: f.z + (s - end) * f.tz };
  }
  const t = c.curved ? (s - totalLength(c) / 2) / c.radius : 0,
    d = c.direction;
  const tx = Math.cos(t),
    tz = d * Math.sin(t),
    nx = -tz,
    nz = tx;
  return {
    x: (c.curved ? c.radius * Math.sin(t) : s - totalLength(c) / 2) + nx * u,
    z: (c.curved ? d * c.radius * (1 - Math.cos(t)) : 0) + nz * u,
    tx,
    tz,
    nx,
    nz,
  };
}
export function alignmentStation(c, x, z) {
  const L = totalLength(c);
  if (!c.curved) return x + L / 2;
  const a = frame(c, 0),
    b = frame(c, L),
    before = (x - a.x) * a.tx + (z - a.z) * a.tz,
    after = (x - b.x) * b.tx + (z - b.z) * b.tz;
  if (before < 0) return before;
  if (after > 0) return L + after;
  return Math.atan2(x, c.radius - c.direction * z) * c.radius + L / 2;
}
export function profile(c, s) {
  const L = totalLength(c);
  if (c.profile === 'constant') return c.elevation + (s * c.grade) / 100;
  // Tangent extensions keep the short approaches continuous at both ends.
  if (s < 0) return c.elevation + (4 * c.rise * s) / L;
  if (s > L) return c.elevation - (4 * c.rise * (s - L)) / L;
  return c.elevation + (4 * c.rise * s * (L - s)) / (L * L);
}
export function supportStation(c, station, u) {
  if (!c.curved) return station + u * Math.tan(rad(c.skew));
  const f = frame(c, station),
    k = Math.tan(rad(c.skew));
  const residual = s => {
    const p = frame(c, s, u);
    return (p.x - f.x) * (f.tx - k * f.nx) + (p.z - f.z) * (f.tz - k * f.nz);
  };
  let s = station + u * k;
  for (let j = 0; j < 6; j++) {
    const r = residual(s);
    if (Math.abs(r) < 1e-10) break;
    const derivative = (residual(s + 0.001) - residual(s - 0.001)) / 0.002;
    s -= r / derivative;
  }
  return s;
}
export function girderTop(c, i, s, u = 0) {
  if (isConcreteDeck(c)) return profile(c, s) - c.asphalt;
  // The conceptual beams follow the longitudinal profile. Level NEBT / I-girder flanges need a small
  // crossfall allowance so every point of the concrete haunch remains between 20 and 120 mm.
  const halfFlange = c.material === 'concrete' ? 0.6 : c.material === 'steel' ? 0.25 : 0,
    offsets = [-halfFlange, 0, halfFlange].map(v => crossAt(c, u + v) - crossAt(c, u)),
    haunch = Math.max(0.02 - Math.min(...offsets), Math.min(0.12 - Math.max(...offsets), c.haunch));
  return profile(c, s) - c.asphalt - c.deck - haunch;
}
export function clearance(c, i) {
  const ss = stations(c),
    a = ss[i],
    b = ss[i + 1];
  const edgeStations = [a, b].flatMap(s => [-c.width / 2, c.width / 2].map(u => supportStation(c, s, u)));
  const depth = c.variableDepth ? c.pierDepth : c.material === 'slab' ? c.slabDepth : c.depth;
  // Railways: clearance above the 0.5 m ballast bed (sleeper level), not the surrounding ground.
  const obstacleTop = c.spans[i].elevation + (c.spans[i].obstacle === 'rail' ? RAIL_BED : 0);
  return Math.min(...edgeStations.map(s => girderTop(c, i, s))) + lowestCross(c) - depth - 0.2 - obstacleTop;
}
// Smooth bottom-flange haunches, measured from each girder's skewed pier intersection.
export function girderDepth(c, s, u = 0) {
  if (!c.variableDepth) return c.material === 'slab' ? c.slabDepth : c.depth;
  const typical = c.material === 'slab' ? c.slabDepth : c.depth;
  const bearingZone = 0.7; // Bearings are 0.5 m from supports; 0.3–0.7 m spans 400 mm above each pad.
  if (c.spans.length === 1) {
    const L = totalLength(c),
      reach = (L * c.taper) / 100,
      near = Math.min(s, L - s),
      t = Math.max(0, (near - bearingZone) / Math.max(0.001, reach - bearingZone));
    return typical + (c.pierDepth - typical) * (t < 1 ? (1 - t) ** 2 : 0);
  }
  // Each half-haunch is tangent to the shallow soffit at its outer end,
  // with maximum depth at the actual skewed pier intersection.
  const ss = stations(c);
  let factor = 0;
  for (let j = 1; j < ss.length - 1; j++) {
    const pier = supportStation(c, ss[j], u),
      left = supportStation(c, ss[j - 1], u),
      right = supportStation(c, ss[j + 1], u);
    const reach = ((s <= pier ? pier - left : right - pier) * c.taper) / 100;
    const t = Math.max(0, (Math.abs(s - pier) - bearingZone) / Math.max(0.001, reach - bearingZone));
    factor = Math.max(factor, t < 1 ? (1 - t) ** 2 : 0);
  }
  return typical + (c.pierDepth - typical) * factor;
}
export function setClearance(c, i, value) {
  if (!Number.isFinite(value) || value < 0.3 || value > 35) throw Error('Clearance: enter 0.3 to 35 m.');
  const elevation = c.spans[i].elevation + clearance(c, i) - value;
  let a = i,
    b = i;
  if (c.spans[i].obstacle === 'water') {
    while (a > 0 && c.spans[a - 1].obstacle === 'water') a--;
    while (b < c.spans.length - 1 && c.spans[b + 1].obstacle === 'water') b++;
  }
  for (let j = a; j <= b; j++) c.spans[j].elevation = elevation;
  return c;
}
export function waterGroups(c) {
  const groups = [],
    ss = stations(c);
  c.spans.forEach((s, i) => {
    if (s.obstacle !== 'water') return;
    const last = groups.at(-1);
    if (last && last.endIndex === i - 1) {
      last.end = ss[i + 1];
      last.endIndex = i;
    } else
      groups.push({
        start: ss[i],
        end: ss[i + 1],
        startIndex: i,
        endIndex: i,
        elevation: s.elevation,
        angle: s.angle,
        width: s.width,
      });
  });
  return groups;
}
export function encodeConfig(c, camera) {
  return encodeURIComponent(JSON.stringify({ config: c, camera }));
}
export function decodeConfig(hash) {
  if (hash.length > 24000) throw Error('The shared configuration is too large.');
  const data = JSON.parse(decodeURIComponent(hash.replace(/^#/, '')));
  return { config: validate(data.config ?? data), camera: data.camera };
}

export function vehicleFits(c, s, u, halfLength, halfWidth) {
  const f = frame(c, s, u),
    layout = roadLayout(c),
    L = totalLength(c);
  if (!layout.laneCenters.length) return false;
  const lane = layout.laneCenters.reduce((a, b) => (Math.abs(a - u) < Math.abs(b - u) ? a : b)),
    laneMin = lane - c.laneWidth / 2,
    laneMax = lane + c.laneWidth / 2;
  for (const dx of [-halfLength, 0, halfLength]) {
    const extents = [];
    for (const du of [-halfWidth, halfWidth]) {
      const x = f.x + dx * f.tx + du * f.nx,
        z = f.z + dx * f.tz + du * f.nz;
      const q = alignmentStation(c, x, z);
      const centre = frame(c, q),
        across = (x - centre.x) * centre.nx + (z - centre.z) * centre.nz;
      if (
        across < Math.max(layout.roadMin + 0.08, laneMin + 0.04) ||
        across > Math.min(layout.roadMax - 0.08, laneMax - 0.04)
      )
        return false;
      extents.push(across);
      const start = supportStation(c, 0, across) - c.approach - 18,
        end = supportStation(c, L, across) + c.approach + 18;
      if (q < start || q > end) return false;
    }
    if (
      layout.medianWidth &&
      Math.min(...extents) < layout.medianMax + 0.08 &&
      Math.max(...extents) > layout.medianMin - 0.08
    )
      return false;
  }
  return true;
}
