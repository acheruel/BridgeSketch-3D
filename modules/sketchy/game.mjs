// BridgeSketch 3D · Sketchy's Bridge Hop (0.6.5, a secret Frogger-style game). Sketchy the frog hops on the bridge
// and its approaches between the vehicles. Arcade: stay alive on the roadway, squeeze between cars, leapfrog them,
// surf on their roofs, catch flies and power flies (golden Sketchy who bonks vehicles into the sky, slow motion); a
// heron snatches a frog that camps on a sidewalk, a shoulder or one spot. Free roam: hop anywhere on the site and
// swim in the river (Space to swim fast). The app keeps rendering (sky, water, time of day); this module drives the
// camera, Sketchy, the HUD, the music and its own deck traffic (the scene's deck vehicles are hidden while it runs).
import * as T from 'three';
import { createSketchy } from './sketchy.mjs';
import { createContactShadow, createVehicleModel, trafficKind, vehicleDimensions, vehiclePaint } from '../vehicles.mjs';
import { positionVehicle } from '../traffic.mjs';
import { alignmentStation, crossAt, frame, laneForward, profile, roadLayout, totalLength } from '../geometry.mjs';
import { CURB_HEIGHT } from '../deck-profiles.mjs';
import { approachSurfaces } from '../terrain.mjs';

const HOP = { along: 1.6, time: 0.19, height: 0.45 },
  BIG = { time: 0.62, height: 2.4, reach: 2.4, cooldown: 0.9 },
  WALL = { time: 0.34, height: 1.3 },
  SWIM = { time: 0.42, reach: 1.15 },
  DASH = { time: 0.34, reach: 3.2 },
  // A small frog: standing on a lane line, it squeezes between two vehicles passing side by side.
  FROG_R = 0.22,
  FLAT_TIME = 3,
  SHIELD_TIME = 3,
  STILL_LIMIT = 5,
  REFUGE_LIMIT = 2.6,
  POWER_TIME = 5,
  SLOW_TIME = 5,
  SLOW = 0.35,
  HEAVY = new Set(['truck', 'semi', 'double']),
  BEST_KEY = 'bridgesketch-sketchy-best',
  MUTE_KEY = 'bridgesketch-sketchy-mute';
const rand = (a, b) => a + Math.random() * (b - a),
  clamp = (v, a, b) => Math.min(b, Math.max(a, v)),
  damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt),
  angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a)),
  pick = list => list[Math.floor(Math.random() * list.length)],
  store = (key, value) => {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch {}
  };

// Deck zones across the width (u, m from the profile grade line, + to the right of increasing stations), on the
// bridge and its approaches up to the edges of the generated site.
export function deckModel(c) {
  const L = totalLength(c),
    lay = roadLayout(c),
    half = c.width / 2,
    left = -half + lay.leftBarrierWidth,
    right = half - lay.rightBarrierWidth,
    walls = [],
    raised = [];
  if (lay.innerBarrier && lay.left) walls.push([lay.roadMin - lay.innerBarrier, lay.roadMin]);
  if (lay.innerBarrier && lay.right) walls.push([lay.roadMax, lay.roadMax + lay.innerBarrier]);
  if (c.medianType === 'barrier') walls.push([lay.medianMin, lay.medianMax]);
  if (lay.left) raised.push([left, lay.roadMin - lay.innerBarrier]);
  if (lay.right) raised.push([lay.roadMax + lay.innerBarrier, right]);
  if (c.medianType === 'sidewalk') raised.push([lay.medianMin, lay.medianMax]);
  const cycling = c.trafficMode === 'cyclists';
  let lanes = lay.laneCenters.map((u, i) => ({ u, width: c.laneWidth, forward: laneForward(c, i), kind: cycling ? 'cyclist' : 'car' }));
  // A single cycle lane carries both directions: two narrow half-lanes keep the riders apart.
  if (cycling && lanes.length === 1)
    lanes = [-1, 1].map(k => ({ u: lanes[0].u + (k * lanes[0].width) / 4, width: lanes[0].width / 2, forward: k > 0, kind: 'cyclist' }));
  if (!lanes.length) lanes = [-1, 1].map(k => ({ u: k * 0.45, width: 0.9, forward: k > 0, kind: 'cyclist' }));
  // Cyclists also ride the wider sidewalks, so a sidewalk is no hiding place.
  const paths = raised
    .filter(([a, b]) => b - a >= 2.2 && (a > lay.roadMax - 0.01 || b < lay.roadMin + 0.01))
    .map(([a, b]) => ({ u: (a + b) / 2, width: Math.min(1.6, b - a - 0.4), forward: a > 0, kind: 'cyclist', path: true }));
  // The approach roads run to the edges of the site (same extent as buildBridge).
  const extent = Math.max(L + 2 * c.approach + 36, ...approachSurfaces(c).flat().map(p => 2 * Math.abs(p[0]) + 8)),
    edgeA = L / 2 - extent / 2,
    edgeB = L / 2 + extent / 2;
  const inside = (u, [a, b]) => u >= a - 0.02 && u <= b + 0.02;
  return {
    L,
    lay,
    edgeA,
    edgeB,
    sMin: edgeA + 4,
    sMax: edgeB - 4,
    uMin: left + FROG_R,
    uMax: right - FROG_R,
    walls,
    raised,
    lanes,
    paths,
    across: clamp(lanes[0].width / 2, 0.9, 1.85),
    zone(u) {
      if (walls.some(w => inside(u, w))) return 'wall';
      if (raised.some(r => inside(u, r))) return 'refuge';
      if (lanes.some(l => Math.abs(u - l.u) <= l.width / 2 + 0.05)) return 'lane';
      return 'shoulder';
    },
    y(s, u) {
      return profile(c, s) + crossAt(c, u) + (raised.some(r => inside(u, r)) ? CURB_HEIGHT : 0);
    },
  };
}

// Procedural sound (Web Audio): blips for every action and a little chiptune loop that speeds up with the level.
function makeSound() {
  let ctx = null,
    muted = store(MUTE_KEY) === '1',
    nextNote = 0,
    step = 0;
  const audio = () => {
    if (muted) return null;
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();
    } catch {
      return null;
    }
    return ctx;
  };
  const tone = ({ f0, f1 = f0, dur = 0.1, type = 'sine', gain = 0.05, delay = 0 }) => {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + Math.max(0, delay),
      o = a.createOscillator(),
      g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  const noise = ({ dur = 0.25, gain = 0.08, freq = 900 }) => {
    const a = audio();
    if (!a) return;
    const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate),
      data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = a.createBufferSource(),
      filter = a.createBiquadFilter(),
      g = a.createGain();
    src.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(a.destination);
    src.start();
  };
  const midi = n => 440 * 2 ** ((n - 69) / 12);
  // I – V – vi – IV in C, a bouncy bass and a square arpeggio; the power-up plays it an octave up, faster.
  const CHORDS = [
    [48, [0, 4, 7, 12]],
    [43, [0, 4, 7, 12]],
    [45, [0, 3, 7, 12]],
    [41, [0, 4, 7, 12]],
  ];
  return {
    hop: () => tone({ f0: 330 + Math.random() * 60, f1: 640, dur: 0.08, gain: 0.035 }),
    leap: () => tone({ f0: 220, f1: 980, dur: 0.3, type: 'triangle', gain: 0.05 }),
    splash: () => noise({ dur: 0.3, gain: 0.06, freq: 1400 }),
    dash: () => noise({ dur: 0.18, gain: 0.04, freq: 2200 }),
    splat() {
      noise({ dur: 0.35, gain: 0.12, freq: 600 });
      tone({ f0: 160, f1: 45, dur: 0.4, type: 'square', gain: 0.04 });
    },
    bonk() {
      tone({ f0: 180, f1: 900, dur: 0.25, type: 'square', gain: 0.045 });
      noise({ dur: 0.2, gain: 0.07, freq: 3000 });
    },
    gulp: kind => {
      tone({ f0: 700, f1: 220, dur: 0.11, gain: 0.05 });
      if (kind !== 'fly') [0, 0.08, 0.16, 0.24].forEach((d, i) => tone({ f0: (kind === 'slow' ? 523 : 880) * 1.26 ** i, dur: 0.12, gain: 0.04, delay: d + 0.1 }));
    },
    chime: (n = 2) => [0, 0.07, 0.14].slice(0, n).forEach((d, i) => tone({ f0: 660 * 1.335 ** i, dur: 0.14, type: 'triangle', gain: 0.035, delay: d })),
    honk() {
      tone({ f0: 392, dur: 0.22, type: 'square', gain: 0.02 });
      tone({ f0: 494, dur: 0.22, type: 'square', gain: 0.02 });
    },
    warn: () => tone({ f0: 980, dur: 0.06, type: 'square', gain: 0.025 }),
    pop: () => tone({ f0: 260, f1: 760, dur: 0.18, type: 'triangle', gain: 0.05 }),
    // Called every frame while playing: schedules the next notes of the loop a quarter of a second ahead.
    music(level, power, slow) {
      const a = audio();
      if (!a) return;
      if (nextNote < a.currentTime) nextNote = a.currentTime + 0.05;
      const bpm = (118 + 7 * Math.min(level - 1, 6) + (power ? 36 : 0)) * (slow ? 0.6 : 1),
        eighth = 30 / bpm;
      while (nextNote < a.currentTime + 0.25) {
        const [root, chord] = CHORDS[Math.floor(step / 8) % 4],
          s8 = step % 8,
          delay = nextNote - a.currentTime;
        if ([0, 3, 4, 6].includes(s8)) tone({ f0: midi(root - 12 + (s8 === 6 ? 7 : 0)), dur: eighth * 0.9, type: 'triangle', gain: 0.05, delay });
        tone({ f0: midi(root + 12 + (power ? 12 : 0) + chord[(step * (power ? 3 : 1)) % 4]), dur: eighth * 0.6, type: 'square', gain: power ? 0.014 : 0.009, delay });
        if (s8 === 2 || s8 === 6) noise({ dur: 0.05, gain: 0.012, freq: 6000 });
        nextNote += eighth;
        step++;
      }
    },
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      store(MUTE_KEY, muted ? '1' : '0');
      return muted;
    },
    dispose: () => ctx?.close?.(),
  };
}

// Small round alpha texture for fly markers, sparkles and ripples.
function softDisc(edge = 0.5) {
  const N = 64,
    data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const d = Math.hypot((i + 0.5) / N - 0.5, (j + 0.5) / N - 0.5) * 2,
        k = (j * N + i) * 4,
        a = d > 1 ? 0 : edge < 0.5 ? Math.max(0, 1 - Math.abs(d - 0.82) / 0.16) : 1 - d ** 2;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(255 * a);
    }
  const map = new T.DataTexture(data, N, N);
  map.needsUpdate = true;
  return map;
}
function starShape(outer = 0.16, inner = 0.07) {
  const shape = new T.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer,
      a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    shape[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  return new T.ShapeGeometry(shape);
}

const ICON = {
  camera: '<path d="M3 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="m16 10.5 5-3v9l-5-3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  on: '<path d="M4 9h3l5-4v14l-5-4H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  off: '<path d="M4 9h3l5-4v14l-5-4H4Z"/><path d="m16 9 5 6M21 9l-5 6"/>',
};
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

export function startSketchy(app) {
  const { scene, camera, canvas, host, model } = app,
    c = app.config,
    deck = deckModel(c),
    sound = makeSound(),
    sketchy = createSketchy(),
    world = new T.Group(),
    disc = softDisc(1),
    ring = softDisc(0.4);
  world.name = 'Sketchy';
  scene.add(world);
  world.add(sketchy.group, sketchy.shadow);
  sketchy.group.traverse(o => (o.castShadow = false));
  const deckTraffic = model.traffic,
    trafficWasVisible = deckTraffic?.visible;
  if (deckTraffic) deckTraffic.visible = false;

  // ---- Heads-up display ----------------------------------------------------------------------------------------
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('./sketchy.css', import.meta.url).href;
  document.head.append(css);
  const face = new URL('../../sketchy.svg', import.meta.url).href,
    ui = document.createElement('div');
  ui.className = 'sk';
  ui.innerHTML = `
    <div class="sk-tint"></div>
    <div class="sk-top">
      <div class="sk-card">
        <img class="sk-face" src="${face}" alt="" />
        <div class="sk-name"><b>Sketchy</b><small data-k="mode">Arcade</small></div>
        <div class="sk-stat sk-arcade"><small>Score</small><b data-k="score">0</b></div>
        <div class="sk-stat sk-arcade sk-mult"><small>Combo</small><b data-k="mult">×1.0</b></div>
        <div class="sk-stat sk-arcade"><small>Best</small><b data-k="best">0</b></div>
        <div class="sk-stat"><small>Flies</small><b data-k="flies">0</b></div>
      </div>
      <div class="sk-tools">
        <button type="button" class="sk-btn" data-act="sound" title="Sound and music on or off (M)"></button
        ><button type="button" class="sk-btn" data-act="camera" title="Camera across the lanes or along the bridge (C)">${svg(ICON.camera)}</button
        ><button type="button" class="sk-btn" data-act="pause" title="Pause (Esc)">${svg(ICON.pause)}</button>
      </div>
    </div>
    <div class="sk-powers"><span class="sk-power star" hidden>★ Golden <b></b></span><span class="sk-power slow" hidden>◷ Slow-mo <b></b></span><span class="sk-power surf" hidden>🏄 Surfing <b></b></span></div>
    <div class="sk-pops"></div>
    <div class="sk-banner" hidden></div>
    <div class="sk-warn" hidden><b></b><span class="sk-warn-bar"><i></i></span></div>
    <div class="sk-leap" title="Leapfrog (Space)"><i></i><span>Leap</span></div>
    <p class="sk-help">WASD or arrows: hop · Space: leap (land on a roof to surf) · drag: look · wheel: zoom · C: camera · M: sound · Esc: pause</p>
    <div class="sk-pad" aria-hidden="true">
      <button type="button" data-dir="0,1">▲</button><button type="button" data-dir="-1,0">◀</button
      ><button type="button" data-dir="1,0">▶</button><button type="button" data-dir="0,-1">▼</button>
      <button type="button" class="sk-pad-leap" data-dir="leap">Leap</button>
    </div>
    <div class="sk-menu" role="dialog" aria-modal="true" aria-labelledby="sk-title">
      <div class="sk-menu-card">
        <img class="sk-hero" src="${face}" alt="Sketchy the frog in a hard hat" />
        <h2 id="sk-title">Sketchy's <span>Bridge Hop</span></h2>
        <p class="sk-tag" data-k="tag">A secret BridgeSketch mini-game. Sketchy checks your bridge, the hard way.</p>
        <div class="sk-modes">
          <button type="button" data-mode="arcade"><b>Arcade</b><small>Squeeze between cars, leapfrog them, surf their roofs, catch flies. Don't camp: the heron is watching.</small></button
          ><button type="button" data-mode="roam"><b>Free roam</b><small>Hop around the whole site and swim in the river (Space to swim fast).</small></button>
        </div>
        <button type="button" class="sk-resume" data-act="resume" hidden>Resume <kbd>Esc</kbd></button>
        <div class="sk-legend">
          <span><i class="dot fly"></i>Fly +100</span><span><i class="dot gold"></i>Golden fly +500</span
          ><span><i class="dot star"></i>Power fly: golden Sketchy, bonk the traffic</span><span><i class="dot slow"></i>Blue fly: slow motion</span>
        </div>
        <div class="sk-keys"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> hop</span><span><kbd>Space</kbd> leap</span><span><kbd>C</kbd> camera</span><span><kbd>M</kbd> sound</span></div>
        <div class="sk-menu-foot"><span data-k="bestline"></span><button type="button" class="sk-quit" data-act="quit">Back to BridgeSketch</button></div>
      </div>
    </div>`;
  host.append(ui);
  const $ = k => ui.querySelector(`[data-k="${k}"]`),
    menu = ui.querySelector('.sk-menu'),
    banner = ui.querySelector('.sk-banner'),
    warn = ui.querySelector('.sk-warn'),
    pops = ui.querySelector('.sk-pops'),
    leapMeter = ui.querySelector('.sk-leap'),
    powerChips = { star: ui.querySelector('.sk-power.star'), slow: ui.querySelector('.sk-power.slow'), surf: ui.querySelector('.sk-power.surf') };
  const showSound = () => (ui.querySelector('[data-act="sound"]').innerHTML = svg(sound.muted ? ICON.off : ICON.on));
  showSound();

  // ---- Game state ----------------------------------------------------------------------------------------------
  let best = Number(store(BEST_KEY)) || 0;
  const g = {
    mode: 'arcade',
    paused: true,
    started: false,
    time: 0,
    score: 0,
    mult: 1,
    trickAt: -10,
    flies: 0,
    alive: 0,
    level: 1,
    state: 'play', // play | flat
    flat: 0,
    shield: 0,
    countdown: 0,
    still: 0,
    refuge: 0,
    leapReady: 0,
    crossFrom: null,
    lastHopAt: -10,
    warnBeep: 0,
    power: 0,
    slow: 0,
    hitstop: 0,
    shake: 0,
    bonks: 0,
    bonkAt: -10,
    lastMiss: null,
    surf: 0,
    onFire: false,
  };
  const frog = {
    s: deck.L / 2,
    u: deck.uMin + 0.2,
    pos: new T.Vector3(),
    ground: 0,
    yaw: 0,
    hop: null,
    swim: false,
    ride: null,
  };
  const cam = { across: true, yaw: 0, pitch: 0.68, dist: 6.8, pos: new T.Vector3(), look: new T.Vector3(), snap: true };
  const input = { held: [], queued: null, leap: false, space: false };

  const toWorld = (s, u) => {
    const f = frame(c, s, u);
    return { x: f.x, z: f.z };
  };
  const toDeck = (x, z) => {
    const s = alignmentStation(c, x, z),
      f = frame(c, s);
    return { s, u: (x - f.x) * f.nx + (z - f.z) * f.nz };
  };
  function placeOnDeck(s, u) {
    frog.s = s;
    frog.u = u;
    const p = toWorld(s, u);
    frog.ground = deck.y(s, u);
    frog.pos.set(p.x, frog.ground, p.z);
  }

  // ---- Free roam ground: a 2 m grid index of the scene triangles (not the trees, grass, vehicles or lamps), built
  // on the first free roam. A vertical query then tests a few dozen triangles instead of raycasting 600 k (7–30 ms).
  let ground = null;
  function groundIndex() {
    const waters = new Set(model.waters),
      skip = new Set();
    for (const group of [model.traffic, model.setting.children.find(o => o.name === 'Traffic'), model.lighting?.group])
      group?.traverse(o => skip.add(o));
    const meshes = [];
    model.root.traverse(o => {
      if (o.isMesh && !o.isInstancedMesh && !skip.has(o) && (waters.has(o) || !o.material?.transparent)) meshes.push(o);
    });
    const parts = meshes.map(m => {
      m.updateWorldMatrix(true, false);
      const geo = m.geometry,
        source = geo.attributes.position;
      let p = source.array;
      if (!m.matrixWorld.equals(new T.Matrix4()) || source.isInterleavedBufferAttribute || source.itemSize !== 3) {
        p = new Float32Array(source.count * 3);
        const v = new T.Vector3();
        for (let i = 0; i < source.count; i++) v.fromBufferAttribute(source, i).applyMatrix4(m.matrixWorld).toArray(p, i * 3);
      }
      return { p, index: geo.index?.array ?? null, count: Math.floor((geo.index?.count ?? source.count) / 3), water: waters.has(m), level: m.userData.level };
    });
    const box = new T.Box3();
    meshes.forEach(m => box.expandByObject(m));
    const cell = 2,
      x0 = box.min.x,
      z0 = box.min.z,
      nx = Math.max(1, Math.ceil((box.max.x - x0) / cell) + 1),
      nz = Math.max(1, Math.ceil((box.max.z - z0) / cell) + 1),
      offsets = new Uint32Array(nx * nz + 1);
    const vertex = (part, t, k) => (part.index ? part.index[t * 3 + k] : t * 3 + k) * 3;
    const cells = (part, t, visit) => {
      const a = vertex(part, t, 0),
        b = vertex(part, t, 1),
        c3 = vertex(part, t, 2),
        p = part.p,
        i0 = Math.floor((Math.min(p[a], p[b], p[c3]) - x0) / cell),
        i1 = Math.floor((Math.max(p[a], p[b], p[c3]) - x0) / cell),
        j0 = Math.floor((Math.min(p[a + 2], p[b + 2], p[c3 + 2]) - z0) / cell),
        j1 = Math.floor((Math.max(p[a + 2], p[b + 2], p[c3 + 2]) - z0) / cell);
      for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++)
        for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) visit(j * nx + i);
    };
    parts.forEach(part => {
      for (let t = 0; t < part.count; t++) cells(part, t, k => offsets[k + 1]++);
    });
    for (let k = 1; k < offsets.length; k++) offsets[k] += offsets[k - 1];
    const fill = offsets.slice(0, -1),
      entries = new Uint32Array(offsets.at(-1));
    // Packed entry: part index (8 bits) and triangle index (24 bits).
    parts.forEach((part, pi) => {
      for (let t = 0; t < part.count; t++) cells(part, t, k => (entries[fill[k]++] = (pi << 24) | t));
    });
    // Every surface over (x, z): height and whether it faces up or down.
    function surfacesAt(x, z) {
      const i = Math.floor((x - x0) / cell),
        j = Math.floor((z - z0) / cell);
      if (i < 0 || j < 0 || i >= nx || j >= nz) return null;
      const k = j * nx + i,
        out = [];
      for (let e = offsets[k]; e < offsets[k + 1]; e++) {
        const part = parts[entries[e] >>> 24],
          t = entries[e] & 0xffffff,
          p = part.p,
          a = vertex(part, t, 0),
          b = vertex(part, t, 1),
          c3 = vertex(part, t, 2),
          ax = p[a],
          az = p[a + 2],
          ux = p[b] - ax,
          uz = p[b + 2] - az,
          vx = p[c3] - ax,
          vz = p[c3 + 2] - az,
          det = ux * vz - uz * vx;
        if (Math.abs(det) < 1e-9) continue;
        const wx = x - ax,
          wz = z - az,
          l1 = (wx * vz - wz * vx) / det,
          l2 = (ux * wz - uz * wx) / det;
        if (l1 < -1e-6 || l2 < -1e-6 || l1 + l2 > 1 + 1e-6) continue;
        const uy = p[b + 1] - p[a + 1],
          vy = p[c3 + 1] - p[a + 1],
          // Face normal (winding order): its y component and length give the slope and the side it faces.
          nxv = uy * vz - uz * vy,
          nyv = uz * vx - ux * vz,
          nzv = ux * vy - uy * vx,
          slope = nyv / Math.hypot(nxv, nyv, nzv);
        out.push({ y: p[a + 1] + l1 * uy + l2 * vy, slope, water: part.water, level: part.level });
      }
      return out;
    }
    return { surfacesAt, bounds: box.clone().expandByScalar(-2) };
  }
  // Landing surface under (x, z) at or below fromY. Inside a solid (the first surface above faces up: a pier, a
  // wall), on a steep face or off the site: null or a wall.
  function groundAt(x, z, fromY) {
    ground ??= groundIndex();
    const { bounds } = ground;
    if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) return null;
    const all = ground.surfacesAt(x, z);
    if (!all?.length) return null;
    let land = null;
    for (const s of all) if (s.y <= fromY + 0.01 && (s.slope > 0.35 || s.water) && (!land || s.y > land.y)) land = s;
    if (!land) return { wall: true };
    let above = null;
    for (const s of all) if (s.y > land.y + 0.08 && Math.abs(s.slope) > 0.05 && (!above || s.y < above.y)) above = s;
    if (above && above.slope > 0 && !above.water && above.y - land.y < 40) return { wall: true };
    return land.water ? { y: land.level ?? land.y, water: true } : { y: land.y, water: false };
  }

  // ---- Deck traffic: per lane one speed (no collisions between vehicles), varied gaps and rhythm. Vehicles queue
  // out of sight beyond the edges of the site and drive in from there, so they are always seen coming. -----------
  const traffic = new T.Group();
  traffic.name = 'Sketchy traffic';
  world.add(traffic);
  const zoneA = deck.edgeA - 35,
    zoneB = deck.edgeB + 35;
  let seed = c.seed * 31 + 7;
  const lanes = [...deck.lanes, ...deck.paths].map((lane, i) => {
    const cyclist = lane.kind === 'cyclist',
      base = cyclist ? rand(4, 6.5) : rand(9, 14) + (lane.forward ? 0 : 0.6),
      L = { ...lane, base, speed: base, target: base, changeAt: rand(5, 11), vehicles: [], lift: lane.path ? CURB_HEIGHT : 0 };
    const headway = () => (Math.random() < 0.28 ? rand(3.6, 6) : rand(1.3, 3.4)) * Math.max(0.7, 1 - 0.06 * (g.level - 1));
    L.gap = () => Math.max(cyclist ? 3 : 6, headway() * L.speed);
    // Fill the lane from its downstream end.
    let s = lane.forward ? zoneB - rand(0, 20) : zoneA + rand(0, 20);
    for (let k = 0; k < 18; k++) {
      const type = cyclist ? 'cyclist' : trafficKind(seed++),
        dims = vehicleDimensions(type),
        group = createVehicleModel(type, vehiclePaint(seed * 7 + i, type), app.materials);
      if (type !== 'cyclist') group.add(createContactShadow(dims.length, dims.width));
      group.traverse(o => (o.castShadow = false));
      const v = {
        group,
        type,
        s,
        u: lane.u,
        hl: dims.halfLength,
        hw: dims.halfWidth,
        height: dims.height,
        wander: rand(0, Math.PI * 2),
        amp: cyclist ? 0.08 : HEAVY.has(type) ? 0.05 : 0.14,
        side: 0,
        travel: 0,
        launched: null,
      };
      group.userData.route = { s, u: lane.u, forward: lane.forward, road: null, type, halfLength: v.hl, halfWidth: v.hw, verticalOffset: L.lift };
      traffic.add(group);
      L.vehicles.push(v);
      s += (lane.forward ? -1 : 1) * (v.hl * 2 + L.gap());
      if (lane.forward ? s < zoneA - 40 : s > zoneB + 40) break;
    }
    return L;
  });
  const roadLanes = lanes.filter(l => !l.path);
  // Back in the queue behind its last vehicle, and always out of sight beyond the edge of the site: placing it just
  // behind a last vehicle already on the bridge made it pop up in front of Sketchy. Vehicles flying after a bonk are
  // out of the queue.
  function requeue(lane, v) {
    const dir = lane.forward ? 1 : -1,
      last = lane.vehicles.filter(o => o !== v && !o.launched).reduce((a, b) => (!a || dir * b.s < dir * a.s ? b : a), null),
      behind = last ? last.s - dir * (last.hl + v.hl + lane.gap()) : lane.forward ? zoneA : zoneB;
    v.s = lane.forward ? Math.min(behind, zoneA) : Math.max(behind, zoneB);
    v.side = 0;
  }
  function moveTraffic(dt) {
    const k = 1 + 0.1 * (Math.min(g.level, 7) - 1);
    for (const lane of lanes) {
      lane.changeAt -= dt;
      if (lane.changeAt <= 0) {
        lane.target = lane.base * rand(0.78, 1.28);
        lane.changeAt = rand(6, 12);
      }
      lane.speed = damp(lane.speed, lane.target * k, 0.6, dt);
      const dir = lane.forward ? 1 : -1;
      for (const v of lane.vehicles) {
        // Bonked by golden Sketchy: a tumbling flight into the sky, then back in the queue.
        if (v.launched) {
          const f = v.launched;
          f.t += dt;
          f.vel.y -= 7 * dt;
          v.group.position.addScaledVector(f.vel, dt);
          v.group.rotation.x += f.spin.x * dt;
          v.group.rotation.y += f.spin.y * dt;
          v.group.rotation.z += f.spin.z * dt;
          if (f.t > 4) {
            v.launched = null;
            requeue(lane, v);
          } else continue;
        }
        v.s += dir * lane.speed * dt;
        v.travel += lane.speed * dt;
        if (lane.forward ? v.s - v.hl > zoneB : v.s + v.hl < zoneA) requeue(lane, v);
        v.wander += dt * 0.4;
        const r = v.group.userData.route;
        r.s = v.s;
        r.u = lane.u + v.amp * Math.sin(v.wander);
        v.u = r.u;
        positionVehicle(v.group, c);
        // Shown on the whole road up to the edges of the site (not only where the scene's own traffic fits).
        v.group.visible = v.s - v.hl > deck.edgeA + 1 && v.s + v.hl < deck.edgeB - 1;
        v.group.userData.pose?.(v.travel);
      }
    }
  }
  function launch(lane, v) {
    const away = new T.Vector3().subVectors(v.group.position, sketchy.group.position).setY(0).normalize(),
      f = frame(c, v.s),
      dir = lane.forward ? 1 : -1;
    v.launched = {
      t: 0,
      vel: new T.Vector3(f.tx * dir * lane.speed * 0.5 + away.x * 7, rand(15, 21), f.tz * dir * lane.speed * 0.5 + away.z * 7),
      spin: new T.Vector3(rand(-5, 5), rand(-3, 3), rand(-6, 6)),
    };
    v.side = 0;
    if (frog.ride?.v === v) frog.ride = null;
  }

  // ---- Flies: buzzing snacks over the lanes (or around Sketchy in free roam), and the power flies -----------------------
  const FLY = {
    fly: { body: '#1b2226', ring: '#b8ffcf', points: 100, label: ['Yum!', 'Gulp!', 'Snack!'] },
    gold: { body: '#ffcc33', ring: '#ffd84a', points: 500, label: ['Golden fly!'], halo: '#ffd23f' },
    star: { body: '#fff6c8', ring: '#ff9cf0', points: 300, label: ['POWER FLY!'], halo: '#ff7ce6' },
    slow: { body: '#7fd8ff', ring: '#7fd8ff', points: 200, label: ['Slow motion!'], halo: '#3fb8ff' },
  };
  const flyBody = new T.SphereGeometry(1, 12, 8),
    wingGeo = new T.PlaneGeometry(1, 0.5).translate(0.5, 0, 0),
    markGeo = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    starGeo = starShape(),
    eyeMat = new T.MeshStandardMaterial({ color: '#b2302a', roughness: 0.3 }),
    wingMat = new T.MeshBasicMaterial({ color: '#e8f4ff', transparent: true, opacity: 0.55, side: T.DoubleSide, depthWrite: false }),
    starMat = new T.MeshBasicMaterial({ color: '#fff3a0', side: T.DoubleSide }),
    mats = Object.fromEntries(
      Object.entries(FLY).map(([k, f]) => [
        k,
        {
          body: new T.MeshStandardMaterial({ color: f.body, roughness: 0.3, metalness: k === 'fly' ? 0.3 : 0.5, emissive: k === 'fly' ? '#000' : f.body, emissiveIntensity: k === 'fly' ? 0 : 0.6 }),
          ring: new T.MeshBasicMaterial({ color: f.ring, map: ring, transparent: true, opacity: 0.85, depthWrite: false }),
          halo: f.halo ? new T.SpriteMaterial({ color: f.halo, map: disc, transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending }) : null,
        },
      ]),
    );
  const flies = [];
  function spawnFly() {
    const r = Math.random(),
      kind = r < 0.07 ? 'star' : r < 0.13 ? 'slow' : r < 0.25 ? 'gold' : 'fly',
      fly = new T.Group(),
      m = mats[kind],
      body = new T.Mesh(flyBody, m.body);
    body.scale.set(0.07, 0.06, 0.1);
    const head = new T.Mesh(flyBody, eyeMat);
    head.scale.setScalar(0.045);
    head.position.z = 0.09;
    const wings = [-1, 1].map(side => {
      const w = new T.Mesh(wingGeo, wingMat);
      w.scale.set(0.16 * side, 1, 0.16);
      w.position.y = 0.04;
      fly.add(w);
      return w;
    });
    fly.add(body, head);
    let spinner = null;
    if (m.halo) {
      const halo = new T.Sprite(m.halo);
      halo.scale.setScalar(kind === 'star' ? 1.1 : 0.7);
      fly.add(halo);
    }
    if (kind === 'star') {
      spinner = new T.Mesh(starGeo, starMat);
      spinner.position.y = 0.28;
      fly.add(spinner);
    }
    const mark = new T.Mesh(markGeo, m.ring);
    mark.renderOrder = 2;
    let base, floor;
    if (g.mode === 'arcade') {
      const lane = lanes[Math.floor(Math.random() * lanes.length)],
        s = clamp(frog.s + rand(-26, 26), deck.sMin + 1, deck.sMax - 1),
        u = lane.u + rand(-0.35, 0.35) * lane.width,
        p = toWorld(s, u);
      floor = deck.y(s, u);
      base = new T.Vector3(p.x, floor + rand(0.6, 1.1), p.z);
    } else {
      const a = rand(0, Math.PI * 2),
        d = rand(5, 22),
        x = frog.pos.x + Math.cos(a) * d,
        z = frog.pos.z + Math.sin(a) * d,
        at = groundAt(x, z, frog.pos.y + 30);
      if (!at || at.wall) return;
      floor = at.y;
      base = new T.Vector3(x, floor + rand(0.6, 1.2), z);
    }
    world.add(fly, mark);
    // A pulsing ring on the ground shows where each fly buzzes.
    mark.position.set(base.x, floor + 0.03, base.z);
    flies.push({ fly, mark, wings, spinner, base, kind, age: 0, life: rand(12, 18), phase: rand(0, 9) });
  }
  function removeFly(f) {
    world.remove(f.fly, f.mark);
    flies.splice(flies.indexOf(f), 1);
  }
  const mouth = new T.Vector3();
  function moveFlies(dt) {
    const want = g.mode === 'arcade' ? 3 : 5;
    if (flies.length < want && Math.random() < dt * 1.5) spawnFly();
    mouth.set(Math.sin(frog.yaw) * 0.3, 0.35, Math.cos(frog.yaw) * 0.3).add(frog.pos);
    // A longer tongue while golden.
    const reach = g.power > 0 ? 2.6 : 1.45;
    for (const f of [...flies]) {
      f.age += dt;
      const t = f.age + f.phase,
        leaving = f.age > f.life;
      f.fly.position.set(
        f.base.x + Math.cos(t * 1.7) * 0.45 + Math.sin(t * 4.1) * 0.08,
        f.base.y + Math.sin(t * 2.3) * 0.18 + (leaving ? (f.age - f.life) * 3 : 0),
        f.base.z + Math.sin(t * 1.3) * 0.45,
      );
      f.fly.rotation.y = t * 1.7 + Math.PI / 2;
      const flap = Math.sin(t * 90) * 0.7;
      f.wings[0].rotation.z = flap;
      f.wings[1].rotation.z = -flap;
      if (f.spinner) f.spinner.rotation.y = t * 4;
      if (f.kind === 'star') mats.star.halo.color.setHSL((t * 0.5) % 1, 0.9, 0.65);
      const pulse = 1 + 0.15 * Math.sin(t * 5);
      f.mark.scale.set(0.9 * pulse, 1, 0.9 * pulse);
      f.mark.visible = !leaving;
      if (leaving && f.age > f.life + 1.5) {
        removeFly(f);
        continue;
      }
      if (g.state === 'play' && !leaving && f.fly.position.distanceTo(mouth) < reach) {
        sketchy.lick(f.fly.position);
        sketchy.cheer();
        sound.gulp(f.kind);
        g.flies++;
        const spec = FLY[f.kind];
        award(spec.points, pick(spec.label), f.kind === 'fly' ? 0.25 : 1, f.kind);
        if (f.kind === 'star') {
          g.power = POWER_TIME;
          g.shield = 0;
          g.shake = 0.3;
          showBanner('<b>Golden Sketchy!</b><small>5 seconds: bonk the traffic into the sky</small>', 'star', 1500);
        }
        if (f.kind === 'slow') {
          g.slow = SLOW_TIME;
          showBanner('<b>Slow motion</b><small>Traffic at a third of its speed</small>', 'slow', 1300);
        }
        removeFly(f);
      }
    }
  }

  // ---- Effects: ripples and dust puffs, sparkles, heron shadow ----------------------------------------------------------
  const ripples = [],
    rippleMat = new T.MeshBasicMaterial({ color: '#ffffff', map: ring, transparent: true, opacity: 0.7, depthWrite: false });
  function ripple(pos, size = 1.4, color = '#ffffff', life = 0.9) {
    const m = new T.Mesh(markGeo, rippleMat.clone());
    m.material.color.set(color);
    m.position.copy(pos);
    m.renderOrder = 3;
    world.add(m);
    ripples.push({ m, age: 0, size, life });
  }
  const sparkMat = new T.SpriteMaterial({ color: '#ffe066', map: disc, transparent: true, depthWrite: false, blending: T.AdditiveBlending }),
    sparks = [];
  function sparkle(pos, color = '#ffe066', n = 1, speed = 1.5) {
    for (let i = 0; i < n; i++) {
      const sp = new T.Sprite(sparkMat.clone());
      sp.material.color.set(color);
      sp.position.copy(pos).add(new T.Vector3(rand(-0.3, 0.3), rand(0, 0.6), rand(-0.3, 0.3)));
      sp.scale.setScalar(rand(0.12, 0.25));
      world.add(sp);
      sparks.push({ sp, vel: new T.Vector3(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)).multiplyScalar(speed), age: 0, life: rand(0.5, 0.9) });
    }
  }
  const heron = new T.Mesh(markGeo, new T.MeshBasicMaterial({ color: '#04110c', map: disc, transparent: true, opacity: 0, depthWrite: false }));
  heron.renderOrder = 2;
  world.add(heron);

  // ---- Score and messages -------------------------------------------------------------------------------------------
  const screen = new T.Vector3();
  function popup(text, kind = '') {
    screen.copy(frog.pos).add(new T.Vector3(0, 1.1, 0)).project(camera);
    const el = document.createElement('div');
    el.className = `sk-pop ${kind}`;
    el.textContent = text;
    el.style.left = `${clamp(((screen.x + 1) / 2) * 100, 8, 92)}%`;
    el.style.top = `${clamp(((1 - screen.y) / 2) * 100, 12, 88)}%`;
    pops.append(el);
    setTimeout(() => el.remove(), 1300);
  }
  function award(points, label, multUp = 0.25, kind = '') {
    if (g.mode !== 'arcade') {
      popup(label, kind);
      return;
    }
    const gained = Math.round(points * g.mult);
    g.score += gained;
    g.mult = Math.min(8, g.mult + multUp);
    g.trickAt = g.time;
    popup(`${label} +${gained.toLocaleString('en-US')}`, kind);
    if (g.mult >= 4 && !g.onFire) {
      g.onFire = true;
      showBanner('<b>On fire!</b><small>Combo ×4 · keep the tricks coming</small>', 'fire', 1300);
      sound.chime(3);
    }
  }
  let bannerTimer;
  function showBanner(text, kind = '', ms = 1400) {
    banner.className = `sk-banner ${kind}`;
    banner.innerHTML = text;
    banner.hidden = false;
    banner.style.animation = 'none';
    void banner.offsetWidth;
    banner.style.animation = '';
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(() => (banner.hidden = true), ms);
  }
  function hud() {
    $('score').textContent = Math.floor(g.score).toLocaleString('en-US');
    $('mult').textContent = `×${g.mult.toFixed(1)}`;
    $('best').textContent = Math.floor(best).toLocaleString('en-US');
    $('flies').textContent = g.flies;
    ui.querySelector('.sk-mult').classList.toggle('fire', g.mult >= 4);
    leapMeter.style.setProperty('--k', String(1 - clamp(g.leapReady / BIG.cooldown, 0, 1)));
    leapMeter.classList.toggle('ready', g.leapReady <= 0);
    for (const [key, left] of [['star', g.power], ['slow', g.slow], ['surf', frog.ride ? g.surf : 0]]) {
      powerChips[key].hidden = left <= 0;
      if (left > 0) powerChips[key].querySelector('b').textContent = key === 'surf' ? `${left.toFixed(1)} s` : left.toFixed(1);
    }
    ui.classList.toggle('golden', g.power > 0);
    ui.classList.toggle('slowmo', g.slow > 0);
  }

  // ---- Hops -----------------------------------------------------------------------------------------------------------
  function planDeckHop(dir, big) {
    const f = frame(c, frog.s),
      a = dir.x * f.tx + dir.z * f.tz,
      b = dir.x * f.nx + dir.z * f.nz;
    let ds = 0,
      du = 0;
    if (Math.abs(a) >= Math.abs(b)) ds = Math.sign(a) * (big ? BIG.reach * 1.25 : HOP.along);
    else du = Math.sign(b) * (big ? BIG.reach : deck.across);
    const s1 = clamp(frog.s + ds, deck.sMin, deck.sMax);
    let u1 = clamp(frog.u + du, deck.uMin, deck.uMax),
      over = false;
    // Sketchy clears a central barrier (or a sidewalk railing) in one higher hop, never stopping on top of it.
    for (const [w0, w1] of deck.walls) {
      if (du > 0 && frog.u < w1 && u1 > w0 - FROG_R) {
        u1 = Math.max(u1, w1 + FROG_R + 0.08);
        over = true;
      }
      if (du < 0 && frog.u > w0 && u1 < w1 + FROG_R) {
        u1 = Math.min(u1, w0 - FROG_R - 0.08);
        over = true;
      }
    }
    if (u1 < deck.uMin - 0.01 || u1 > deck.uMax + 0.01) return null;
    if (Math.abs(s1 - frog.s) < 0.05 && Math.abs(u1 - frog.u) < 0.05) return null;
    const p = toWorld(s1, u1);
    return {
      s0: frog.s,
      u0: frog.u,
      s1,
      u1,
      from: frog.pos.clone(),
      to: new T.Vector3(p.x, deck.y(s1, u1), p.z),
      time: big ? BIG.time : over ? WALL.time : HOP.time,
      height: big ? BIG.height : over ? WALL.height : HOP.height,
      big,
      flip: big,
      over,
    };
  }
  function planRoamHop(dir, big) {
    const dash = frog.swim && big,
      reach = dash ? DASH.reach : frog.swim ? SWIM.reach : big ? 3 : 1.5,
      x = frog.pos.x + dir.x * reach,
      z = frog.pos.z + dir.z * reach,
      at = groundAt(x, z, frog.pos.y + (big && !dash ? 3.4 : 1.5));
    if (!at || at.wall) return null;
    const swim = at.water,
      y = swim ? at.y - 0.17 : at.y,
      drop = frog.pos.y - y,
      stroke = swim && frog.swim;
    return {
      from: frog.pos.clone(),
      to: new T.Vector3(x, y, z),
      time: (stroke ? (dash ? DASH.time : SWIM.time) : big ? BIG.time : HOP.time) + (drop > 1.5 ? Math.sqrt(drop / 9.8) * 0.9 : 0),
      height: stroke ? (dash ? 0.12 : 0.06) : big ? BIG.height : HOP.height,
      big: big && !dash,
      flip: big && !swim && !dash,
      swim,
      dash: dash && swim,
      drop,
    };
  }
  function startHop(dirKey, big = false) {
    if (g.state !== 'play' || frog.hop || g.paused) return false;
    const dashing = g.mode === 'roam' && frog.swim && big;
    if (big && !dashing && g.leapReady > 0) big = false;
    const yaw = cam.yaw,
      fwd = new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
      right = new T.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)),
      dir = dirKey ? fwd.multiplyScalar(dirKey[1]).addScaledVector(right, dirKey[0]).normalize() : new T.Vector3(Math.sin(frog.yaw), 0, Math.cos(frog.yaw));
    const hop = g.mode === 'arcade' ? planDeckHop(dir, big) : planRoamHop(dir, big);
    if (!hop) {
      // Blocked (invisible barrier at the road edge, a wall, the end of the site): a little bump on the spot.
      sketchy.animate(0, { landed: true });
      return false;
    }
    hop.t = 0;
    hop.fromRoof = !!frog.ride;
    frog.ride = null;
    frog.hop = hop;
    frog.targetYaw = Math.atan2(hop.to.x - hop.from.x, hop.to.z - hop.from.z);
    g.still = 0;
    g.lastHopAt = g.time;
    if (hop.dash) {
      sound.dash();
      ripple(new T.Vector3(frog.pos.x, frog.ground + 0.17, frog.pos.z), 1.6);
    } else if (big) {
      g.leapReady = BIG.cooldown;
      sound.leap();
    } else if (!hop.swim) sound.hop();
    sketchyPose.takeoff = true;
    sketchyPose.big = big;
    return true;
  }
  function landHop() {
    const hop = frog.hop;
    frog.hop = null;
    frog.pos.copy(hop.to);
    if (g.mode === 'arcade') {
      frog.s = hop.s1;
      frog.u = hop.u1;
      frog.ground = hop.to.y;
      // Full crossing: from one side of the roadway to the other in one go.
      const lo = Math.min(...roadLanes.map(l => l.u - l.width / 2)),
        hi = Math.max(...roadLanes.map(l => l.u + l.width / 2));
      const side = frog.u < lo ? -1 : frog.u > hi ? 1 : 0;
      if (side && g.crossFrom && g.crossFrom.side === -side && g.time - g.crossFrom.at < 9) award(250, 'Full crossing!', 0.5, 'big');
      if (side) g.crossFrom = { side, at: g.time };
    } else {
      frog.ground = hop.to.y;
      const wasSwimming = frog.swim;
      frog.swim = !!hop.swim;
      if (frog.swim && !wasSwimming) {
        sound.splash();
        ripple(new T.Vector3(hop.to.x, hop.to.y + 0.17, hop.to.z), 2.2);
        popup(pick(['Splash!', 'Swim time!']));
      } else if (frog.swim) ripple(new T.Vector3(hop.to.x, hop.to.y + 0.17, hop.to.z), hop.dash ? 1.8 : 1.4);
      if (hop.drop > 3) popup('Wheee!');
    }
    // A puff of dust where the frog lands (bigger after a leap).
    if (!frog.swim) ripple(new T.Vector3(hop.to.x, hop.to.y + 0.04, hop.to.z), hop.big ? 1.6 : 0.7, '#d8d2c4', 0.45);
    if (hop.big) g.shake = Math.max(g.shake, 0.12);
    sketchyPose.landed = true;
    sketchyPose.big = hop.big;
  }

  // ---- Car surfing: a leap that comes down on a roof rides the vehicle -------------------------------------------------
  const roofLift = (lane, v) => profile(c, v.s) + crossAt(c, v.u) + lane.lift + v.height;
  function tryRoof() {
    const hop = frog.hop;
    if (!hop || hop.t < 0.45 || hop.swim) return;
    const fd = frogDeck();
    if (!fd) return;
    for (const lane of roadLanes)
      for (const v of lane.vehicles) {
        if (v.launched || !v.group.visible || v.type === 'cyclist') continue;
        // Anywhere over the roof (a little generous): Sketchy then settles in the middle of it.
        if (Math.abs(fd.s - v.s) > v.hl || Math.abs(fd.u - v.u) > v.hw + 0.15) continue;
        const roof = roofLift(lane, v);
        if (frog.pos.y < roof - 0.3 || frog.pos.y > roof + 1.2) continue;
        const roofHop = hop.fromRoof;
        frog.hop = null;
        frog.ride = { v, lane, ds: clamp(fd.s - v.s, -(v.hl - 0.4), v.hl - 0.4) };
        g.surf = 0;
        g.still = 0;
        sketchyPose.landed = true;
        sketchyPose.big = true;
        sound.chime(3);
        award(roofHop ? 400 : 200, roofHop ? 'Roof hop!' : HEAVY.has(v.type) ? 'Truck surfing!' : 'Car surfing!', 1, 'big');
        return;
      }
  }
  function ride(dt) {
    const { v, lane, ds } = frog.ride,
      s = v.s + ds;
    frog.s = s;
    frog.u = v.u;
    const p = toWorld(s, v.u);
    frog.ground = roofLift(lane, v);
    frog.pos.set(p.x, frog.ground, p.z);
    const f = frame(c, s);
    frog.targetYaw = Math.atan2(f.tx, f.tz) + (lane.forward ? 0 : Math.PI);
    g.surf += dt;
    g.still = 0;
    if (g.mode === 'arcade') g.score += dt * (HEAVY.has(v.type) ? 60 : 30) * g.mult;
    if (Math.random() < dt * 8) sparkle(frog.pos.clone().add(new T.Vector3(0, 0.1, 0)), '#bff3ff', 1, 0.8);
    // Near the end of the road: Sketchy bails out onto the next lane line.
    if (s < deck.sMin + 6 || s > deck.sMax - 6) {
      popup('Bail out!');
      const toward = Math.sign(deck.lay.medianCentre - v.u) || 1,
        f2 = frame(c, s),
        keyDir = new T.Vector3(f2.nx * toward, 0, f2.nz * toward);
      frog.ride = null;
      const hop = planDeckHop(keyDir, false) ?? planDeckHop(keyDir.negate(), false);
      if (hop && g.mode === 'arcade') {
        hop.t = 0;
        hop.height = 0.9;
        hop.time = 0.36;
        frog.hop = hop;
      }
    }
  }

  // ---- Collisions and tricks --------------------------------------------------------------------------------------
  function frogDeck() {
    if (g.mode === 'arcade') return { s: frog.s, u: frog.u, h: frog.pos.y - deck.y(frog.s, frog.u) };
    const { s, u } = toDeck(frog.pos.x, frog.pos.z);
    if (s < deck.edgeA || s > deck.edgeB || Math.abs(u) > c.width / 2) return null;
    frog.s = s;
    frog.u = u;
    return { s, u, h: frog.pos.y - (profile(c, s) + crossAt(c, u)) };
  }
  function hitBy(cause) {
    g.state = 'flat';
    g.flat = FLAT_TIME;
    frog.hop = null;
    frog.ride = null;
    // Land flat where Sketchy was (an airborne frog drops to the surface).
    if (g.mode === 'arcade') placeOnDeck(frog.s, frog.u);
    else frog.pos.y = frog.ground;
    sound.splat();
    g.shake = 0.45;
    const lost = Math.floor(g.score);
    if (g.mode === 'arcade' && lost > best) {
      best = lost;
      store(BEST_KEY, String(best));
    }
    const title = cause === 'heron' ? 'Heron!' : pick(['Splat!', 'Squish!', 'Pancake!']),
      line = cause === 'heron' ? 'Too safe for too long. Keep hopping on the road!' : cause;
    showBanner(`<b>${title}</b><small>${line}${g.mode === 'arcade' && lost ? ` · ${lost.toLocaleString('en-US')} points lost` : ''}</small>`, 'hit', 2600);
    if (g.mode === 'arcade') {
      g.score = 0;
      g.mult = 1;
      g.alive = 0;
      g.level = 1;
      g.onFire = false;
    }
  }
  function nearMiss(v, clearance, sideOfFrog) {
    const heavy = HEAVY.has(v.type),
      close = clearance < 0.45,
      last = g.time - g.lastHopAt < 0.4;
    sound.chime(close ? 2 : 1);
    if (heavy && Math.random() < 0.5) sound.honk();
    // Two vehicles brushing past on both sides at once: Sketchy squeezes between them.
    if (g.lastMiss && g.lastMiss.side === -sideOfFrog && g.time - g.lastMiss.at < 0.8) {
      sketchy.squeeze();
      g.hitstop = 0.22;
      g.shake = Math.max(g.shake, 0.15);
      sound.chime(3);
      award(350, 'Sandwich squeeze!', 1, 'big');
      g.lastMiss = null;
      return;
    }
    g.lastMiss = { side: sideOfFrog, at: g.time };
    if (close) g.hitstop = 0.15;
    award(
      (close ? 140 : 60) * (heavy ? 2 : 1) + (last ? 100 : 0),
      last ? 'Last-second hop!' : heavy ? 'Big rig dodge!' : close ? 'Whisker close!' : 'Close shave!',
      close ? 0.5 : 0.25,
    );
  }
  function collide() {
    if (g.state !== 'play' || g.countdown > 0 || frog.ride) return;
    const fd = frogDeck();
    if (fd)
      for (const lane of lanes)
        for (const v of lane.vehicles) {
          if (!v.group.visible || v.launched) continue;
          const du = Math.abs(fd.u - v.u),
            ds = fd.s - v.s,
            over = fd.h > v.height * 0.92 + lane.lift,
            touching = Math.abs(ds) < v.hl + FROG_R && du < v.hw + FROG_R && !over && fd.h > -0.6;
          if (touching && g.power > 0) {
            // Golden Sketchy bonks the vehicle off the bridge.
            launch(lane, v);
            sound.bonk();
            g.shake = Math.max(g.shake, 0.25);
            g.bonks = g.time - g.bonkAt < 3 ? g.bonks + 1 : 1;
            g.bonkAt = g.time;
            sparkle(v.group.position.clone().add(new T.Vector3(0, 1, 0)), '#ffe066', 10, 4);
            award(400 * g.bonks, g.bonks > 2 ? `${g.bonks}× BONK!` : g.bonks === 2 ? 'Double BONK!' : 'BONK!', 0.5, 'gold');
            continue;
          }
          if (touching && g.shield <= 0) {
            hitBy(`Flattened by a ${v.type === 'double' ? 'road train' : v.type === 'semi' ? 'semi-trailer' : v.type}.`);
            return;
          }
          // A vehicle passing Sketchy's station this frame: near miss, squeeze or leapfrog.
          const side = Math.sign(ds);
          if (v.side && side && side !== v.side && g.mode === 'arcade' && g.shield <= 0) {
            const clearance = du - (v.hw + FROG_R);
            if (over && du < v.hw + FROG_R) {
              sound.chime(3);
              award(300, 'Leapfrog!', 1, 'big');
            } else if (clearance < 0.95 && clearance >= 0) nearMiss(v, clearance, Math.sign(v.u - fd.u));
          }
          v.side = side;
        }
    if (g.shield > 0) return;
    // Free roam: the crossing roads and railways under the bridge are dangerous too.
    if (g.mode === 'roam')
      for (const v of model.vehicles) {
        const r = v.userData.route;
        if (!r?.road || !v.visible) continue;
        const dx = frog.pos.x - v.position.x,
          dz = frog.pos.z - v.position.z,
          yaw = v.rotation.y,
          lx = dx * Math.cos(yaw) - dz * Math.sin(yaw),
          lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        if (Math.abs(lx) < r.halfLength + FROG_R && Math.abs(lz) < r.halfWidth + FROG_R && Math.abs(frog.pos.y - v.position.y) < 2.5) {
          if (g.power > 0) continue;
          hitBy(r.type === 'train' ? 'Flattened by a train. Look both ways!' : 'Flattened on the road below.');
          return;
        }
      }
  }

  // ---- Camera ---------------------------------------------------------------------------------------------------------
  function baseYaw() {
    const f = frame(c, clamp(frog.s, deck.edgeA, deck.edgeB));
    return cam.across ? Math.atan2(f.nx, f.nz) : Math.atan2(f.tx, f.tz);
  }
  let yawOffset = 0;
  // Top of the edge railings above the deck (the 2.4 m Samuel-De Champlain railing, otherwise about 1.4 m).
  const railHeight = [c.leftRailing, c.rightRailing].includes('SDC') ? 2.6 : 1.5;
  function moveCamera(dt) {
    const target = g.mode === 'roam' ? cam.free : baseYaw() + yawOffset;
    cam.yaw = cam.snap ? target : cam.yaw + angleTo(cam.yaw, target) * (1 - Math.exp(-8 * dt));
    // Near the deck edge on the camera side, the camera rises to look over the railing (narrow cycle bridges).
    let pitch = cam.pitch;
    if (g.mode === 'arcade') {
      const f = frame(c, frog.s),
        back = -(Math.sin(cam.yaw) * f.nx + Math.cos(cam.yaw) * f.nz),
        edge = back < 0 ? frog.u + c.width / 2 : c.width / 2 - frog.u,
        reach = Math.max(0.3, edge / Math.max(0.25, Math.abs(back)));
      pitch = Math.max(pitch, Math.min(1.3, Math.atan2(railHeight, reach) + 0.08));
    }
    cam.pitchNow = cam.snap ? pitch : damp(cam.pitchNow ?? pitch, pitch, 5, dt);
    const look = frog.pos.clone().add(new T.Vector3(Math.sin(cam.yaw) * 1.8, 0.7, Math.cos(cam.yaw) * 1.8)),
      flat = cam.dist * Math.cos(cam.pitchNow),
      want = frog.pos
        .clone()
        .add(new T.Vector3(-Math.sin(cam.yaw) * flat, 0.6 + cam.dist * Math.sin(cam.pitchNow), -Math.cos(cam.yaw) * flat));
    want.y = Math.max(want.y, frog.pos.y + 0.5);
    if (cam.snap) {
      cam.pos.copy(want);
      cam.look.copy(look);
      cam.snap = false;
    } else {
      cam.pos.lerp(want, 1 - Math.exp(-7 * dt));
      cam.look.lerp(look, 1 - Math.exp(-10 * dt));
    }
    camera.position.copy(cam.pos);
    // Screen shake on hits, bonks and big landings.
    if (g.shake > 0) camera.position.add(new T.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(g.shake * 0.5));
    camera.lookAt(cam.look);
  }

  // ---- Input ----------------------------------------------------------------------------------------------------------
  const KEYS = {
    KeyW: [0, 1],
    ArrowUp: [0, 1],
    KeyZ: [0, 1],
    KeyS: [0, -1],
    ArrowDown: [0, -1],
    KeyA: [-1, 0],
    KeyQ: [-1, 0],
    ArrowLeft: [-1, 0],
    KeyD: [1, 0],
    ArrowRight: [1, 0],
  };
  function onKeyDown(e) {
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const dir = KEYS[e.code];
    let used = true;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (!g.started) quit();
      else setPaused(!g.paused);
    } else if (g.paused) {
      if (e.code === 'Enter' || e.code === 'Space') begin(g.started ? g.mode : 'arcade');
      else used = !!dir;
    } else if (dir) {
      if (!e.repeat) {
        input.held = input.held.filter(k => k !== e.code).concat(e.code);
        if (!startHop(dir)) input.queued = dir;
      }
    } else if (e.code === 'Space') {
      input.space = true;
      if (!e.repeat) {
        const held = input.held.at(-1);
        if (!startHop(held ? KEYS[held] : null, true)) input.leap = true;
      }
    } else if (e.code === 'KeyC') toggleCamera();
    else if (e.code === 'KeyM') {
      sound.toggle();
      showSound();
    } else used = false;
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function onKeyUp(e) {
    if (KEYS[e.code]) input.held = input.held.filter(k => k !== e.code);
    if (e.code === 'Space') input.space = false;
  }
  function toggleCamera() {
    if (g.mode === 'roam') {
      cam.free += Math.PI / 2;
      return;
    }
    cam.across = !cam.across;
    yawOffset = 0;
    popup(cam.across ? 'Camera: across the lanes' : 'Camera: along the road');
  }
  // Drag to look around, wheel to zoom; a quick swipe on a touch screen hops.
  let drag = null;
  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), id: e.pointerId };
    canvas.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (e.pointerType === 'touch' && performance.now() - drag.t < 220) return;
    if (g.mode === 'roam') cam.free -= dx * 0.006;
    else yawOffset -= dx * 0.006;
    cam.pitch = clamp(cam.pitch + dy * 0.004, 0.1, 1.25);
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0,
      dy = e.clientY - drag.y0,
      quick = performance.now() - drag.t < 260;
    drag = null;
    if (e.pointerType !== 'mouse' && quick && !g.paused) {
      if (Math.hypot(dx, dy) > 36) startHop(Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, -Math.sign(dy)]);
      else startHop([0, 1]);
    }
  }
  function onWheel(e) {
    e.preventDefault();
    cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.1), 3.5, 20);
  }
  function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const mode = b.dataset.mode,
      act = b.dataset.act,
      dir = b.dataset.dir;
    if (mode) begin(mode);
    else if (act === 'resume') setPaused(false);
    else if (act === 'pause') setPaused(true);
    else if (act === 'quit') quit();
    else if (act === 'camera') toggleCamera();
    else if (act === 'sound') {
      sound.toggle();
      showSound();
    } else if (dir === 'leap') startHop(null, true);
    else if (dir) startHop(dir.split(',').map(Number));
    b.blur();
  }
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  ui.addEventListener('click', onClick);

  // ---- Flow: menu, start, pause, quit -------------------------------------------------------------------------------
  function setPaused(on) {
    if (!g.started) return;
    g.paused = on;
    menu.hidden = !on;
    ui.querySelector('.sk-resume').hidden = !on;
    $('tag').textContent = on ? 'Paused. Pick a mode to start again, or resume.' : '';
    $('bestline').textContent = `Best ${Math.floor(best).toLocaleString('en-US')}`;
    if (on) input.held = [];
  }
  const spawnU = clamp(Math.min(...roadLanes.map(l => l.u - l.width / 2)) - 0.9, deck.uMin, deck.uMax);
  function begin(mode) {
    g.mode = mode;
    if (mode === 'roam') ground ??= groundIndex();
    g.started = true;
    g.paused = false;
    menu.hidden = true;
    ui.classList.toggle('roam', mode === 'roam');
    $('mode').textContent = mode === 'roam' ? 'Free roam' : 'Arcade';
    Object.assign(g, {
      score: 0,
      mult: 1,
      flies: 0,
      alive: 0,
      level: 1,
      state: 'play',
      flat: 0,
      still: 0,
      refuge: 0,
      leapReady: 0,
      crossFrom: null,
      power: 0,
      slow: 0,
      onFire: false,
      lastMiss: null,
    });
    for (const f of [...flies]) removeFly(f);
    frog.swim = false;
    frog.hop = null;
    frog.ride = null;
    // Spawn on the left shoulder or sidewalk at mid-bridge, facing the lanes.
    placeOnDeck(deck.L / 2, spawnU);
    const f = frame(c, frog.s);
    frog.yaw = frog.targetYaw = Math.atan2(f.nx, f.nz);
    cam.across = true;
    yawOffset = 0;
    cam.free = Math.atan2(f.nx, f.nz);
    cam.snap = true;
    g.countdown = mode === 'arcade' ? 2.4 : 0;
    g.shield = mode === 'arcade' ? 0 : 1;
    sound.pop();
    if (mode === 'arcade') showBanner('<b>Ready?</b><small>Squeeze, leap, surf, catch flies</small>', 'ready', 1200);
    else showBanner('<b>Free roam</b><small>Hop anywhere. The river is lovely today.</small>', 'ready', 2200);
  }
  function quit() {
    app.exit();
  }
  menu.hidden = false;
  $('bestline').textContent = best ? `Best ${Math.floor(best).toLocaleString('en-US')}` : 'No best score yet';
  placeOnDeck(deck.L / 2, spawnU);
  {
    const f = frame(c, frog.s);
    frog.yaw = frog.targetYaw = Math.atan2(f.nx, f.nz);
  }

  // ---- Frame --------------------------------------------------------------------------------------------------------
  const sketchyPose = {};
  function frameStep(realDt) {
    // Hit-stop: a short slow-down on the closest calls; the slow-motion fly slows the traffic only.
    g.hitstop = Math.max(0, g.hitstop - realDt);
    const dt = realDt * (g.hitstop > 0 ? 0.3 : 1);
    if (!g.paused) {
      g.time += dt;
      moveTraffic(dt * (g.slow > 0 ? SLOW : 1));
      if (g.countdown > 0) {
        const before = Math.ceil(g.countdown / 0.8);
        g.countdown -= dt;
        const after = Math.ceil(g.countdown / 0.8);
        if (after !== before && after > 0) {
          showBanner(`<b>${after}</b>`, 'count', 700);
          sound.warn();
        }
        if (g.countdown <= 0) {
          showBanner('<b>Hop!</b>', 'go', 700);
          sound.pop();
        }
      }
      g.leapReady = Math.max(0, g.leapReady - dt);
      g.shield = Math.max(0, g.shield - dt);
      g.slow = Math.max(0, g.slow - realDt);
      g.shake = Math.max(0, g.shake - realDt * 1.6);
      if (g.power > 0) {
        g.power = Math.max(0, g.power - realDt);
        if (Math.random() < realDt * 30) sparkle(frog.pos, pick(['#ffe066', '#fff3b0', '#ffb300']), 1, 1.2);
        if (g.power === 0) showBanner('<b>Back to green</b>', 'go', 800);
      }
      sketchy.setGolden(g.power > 0 ? Math.min(1, g.power * 3) : 0);
      if (g.started) sound.music(g.level, g.power > 0, g.slow > 0);
      // Hop in progress, or riding on a roof.
      if (frog.hop) {
        const h = frog.hop;
        h.t += dt / h.time;
        const p = Math.min(1, h.t);
        frog.pos.lerpVectors(h.from, h.to, p);
        frog.pos.y += h.height * 4 * p * (1 - p);
        if (g.mode === 'arcade') {
          frog.s = h.s0 + (h.s1 - h.s0) * p;
          frog.u = h.u0 + (h.u1 - h.u0) * p;
        }
        if (h.big || h.fromRoof) tryRoof();
        if (frog.hop && h.t >= 1) landHop();
      } else if (frog.ride) {
        if (frog.ride.v.launched || !frog.ride.v.group.visible) frog.ride = null;
        else ride(dt);
      }
      // Next hop: a key pressed during the jump, or keys still held; Space held swims fast in free roam.
      if (!frog.hop && g.state === 'play') {
        if (input.leap || (input.space && frog.swim && g.mode === 'roam')) {
          input.leap = false;
          const held = input.held.at(-1);
          startHop(held ? KEYS[held] : null, true);
        } else if (input.queued) {
          const q = input.queued;
          input.queued = null;
          startHop(q);
        } else if (input.held.length) startHop(KEYS[input.held.at(-1)]);
      }
      frog.yaw += angleTo(frog.yaw, frog.targetYaw ?? frog.yaw) * (1 - Math.exp(-22 * dt));
      // Flattened, then back on its feet with a few seconds of shield.
      if (g.state === 'flat') {
        g.flat -= dt;
        if (g.flat <= 0) {
          g.state = 'play';
          g.shield = SHIELD_TIME;
          g.still = g.refuge = 0;
          sound.pop();
          showBanner('<b>Boing!</b><small>3 seconds of shield</small>', 'go', 1100);
        }
      }
      if (g.state === 'play' && g.countdown <= 0) {
        if (g.mode === 'arcade') {
          const zone = deck.zone(frog.u),
            onRoad = zone === 'lane' || !!frog.ride;
          g.alive += dt;
          const level = 1 + Math.floor(g.alive / 30);
          if (level > g.level) {
            g.level = level;
            showBanner(`<b>Rush hour!</b><small>Level ${level} · faster traffic</small>`, 'level', 1600);
            sound.chime(3);
          }
          if (onRoad) g.score += dt * 10 * g.mult;
          if (g.time - g.trickAt > 4) {
            g.mult = Math.max(1, g.mult - 0.15 * dt);
            if (g.mult < 4) g.onFire = false;
          }
          // The heron: camping on a refuge, a shoulder or one spot is not allowed (golden Sketchy is too shiny).
          const calm = g.shield > 0 || g.power > 0 || frog.ride;
          if (!calm && !frog.hop) {
            g.still += dt;
            g.refuge = onRoad ? 0 : g.refuge + dt;
          }
          if (frog.hop || frog.ride) g.refuge = onRoad ? 0 : g.refuge;
          const danger = calm ? 0 : Math.max(g.still / STILL_LIMIT, g.refuge / REFUGE_LIMIT);
          warn.hidden = danger < 0.4;
          if (!warn.hidden) {
            warn.querySelector('b').textContent = g.refuge / REFUGE_LIMIT >= g.still / STILL_LIMIT ? 'Too safe! Back on the road' : 'Keep hopping!';
            warn.querySelector('i').style.width = `${Math.min(100, danger * 100)}%`;
            g.warnBeep -= dt;
            if (g.warnBeep <= 0) {
              sound.warn();
              g.warnBeep = 0.6 - 0.4 * danger;
            }
          }
          heron.material.opacity = danger < 0.4 ? 0 : 0.25 + 0.4 * danger;
          heron.position.set(frog.pos.x, frog.ground + 0.04, frog.pos.z);
          heron.scale.set(3.2 - 2.2 * Math.min(1, danger), 1, 2.2 - 1.4 * Math.min(1, danger));
          heron.rotation.y = g.time * 0.7;
          if (danger >= 1) {
            warn.hidden = true;
            heron.material.opacity = 0;
            hitBy('heron');
          }
        } else warn.hidden = true;
        collide();
      } else {
        warn.hidden = true;
        heron.material.opacity = 0;
      }
      moveFlies(dt);
      for (const r of [...ripples]) {
        r.age += dt;
        const k = r.age / r.life;
        r.m.scale.set(r.size * (0.3 + k), 1, r.size * (0.3 + k));
        r.m.material.opacity = 0.7 * (1 - k);
        if (k >= 1) {
          world.remove(r.m);
          r.m.material.dispose();
          ripples.splice(ripples.indexOf(r), 1);
        }
      }
      for (const p of [...sparks]) {
        p.age += dt;
        p.vel.y -= 2 * dt;
        p.sp.position.addScaledVector(p.vel, dt);
        p.sp.material.opacity = 1 - p.age / p.life;
        if (p.age >= p.life) {
          world.remove(p.sp);
          p.sp.material.dispose();
          sparks.splice(sparks.indexOf(p), 1);
        }
      }
      if (frog.swim && Math.random() < dt * 1.2) ripple(new T.Vector3(frog.pos.x, frog.ground + 0.17, frog.pos.z), 0.9);
    }
    // Sketchy's pose and shadow.
    sketchy.group.position.copy(frog.pos);
    if (frog.swim && !frog.hop) sketchy.group.position.y += 0.025 * Math.sin(g.time * 3);
    sketchy.group.rotation.y = frog.yaw;
    sketchy.group.visible = !(g.shield > 0 && g.state === 'play' && Math.floor(g.time * 12) % 2);
    sketchyPose.air = frog.hop ? Math.min(1, frog.hop.t) : null;
    sketchyPose.flip = frog.hop?.flip;
    sketchyPose.swim = frog.swim;
    sketchyPose.flat = g.state === 'flat' ? 1 : 0;
    sketchy.animate(g.paused ? realDt * 0.3 : dt, sketchyPose);
    sketchyPose.takeoff = sketchyPose.landed = false;
    const lift = frog.pos.y - (frog.hop ? frog.hop.from.y + (frog.hop.to.y - frog.hop.from.y) * Math.min(1, frog.hop.t) : frog.ground);
    castShadowBlob(lift);
    moveCamera(realDt);
    hud();
  }
  function castShadowBlob(lift) {
    sketchy.shadow.position.set(frog.pos.x, frog.pos.y - lift + 0.03, frog.pos.z);
    sketchy.shadow.scale.setScalar((g.state === 'flat' ? 1.5 : 0.9) * (1 - Math.min(0.6, lift / 4)));
    sketchy.shadow.visible = !frog.swim;
  }

  return {
    get mode() {
      return g.mode;
    },
    frame(dt) {
      frameStep(Math.min(dt, 0.05));
      app.render();
    },
    // Test hooks: state for automated checks, and power-ups on demand.
    state: () => ({
      ...g,
      s: frog.s,
      u: frog.u,
      swim: frog.swim,
      riding: !!frog.ride,
      pos: frog.pos.toArray(),
      lanes: lanes.length,
      vehicles: lanes.reduce((n, l) => n + l.vehicles.length, 0),
      flying: lanes.reduce((n, l) => n + l.vehicles.filter(v => v.launched).length, 0),
      visibleFrom: Math.min(...lanes.flatMap(l => l.vehicles.filter(v => v.group.visible).map(v => v.s))),
      // The next car or truck coming towards Sketchy in his lane: gap along the road and closing speed.
      ahead: (() => {
        const lane = roadLanes.find(l => Math.abs(frog.u - l.u) < l.width / 2);
        if (!lane) return null;
        const dir = lane.forward ? 1 : -1,
          next = lane.vehicles
            .filter(v => !v.launched && v.type !== 'cyclist' && dir * (frog.s - v.s) > 0)
            .sort((a, b) => dir * (b.s - a.s))[0];
        return next ? { gap: dir * (frog.s - next.s), speed: lane.speed, toward: [0, 0], dir } : null;
      })(),
    }),
    begin,
    hop: (dir, big) => startHop(dir, big),
    power: (kind = 'star') => {
      if (kind === 'star') g.power = POWER_TIME;
      else g.slow = SLOW_TIME;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      clearTimeout(bannerTimer);
      ui.remove();
      css.remove();
      scene.remove(world);
      if (deckTraffic) deckTraffic.visible = trafficWasVisible;
      sketchy.dispose();
      for (const r of ripples) r.m.material.dispose();
      for (const p of sparks) p.sp.material.dispose();
      for (const m of Object.values(mats)) for (const x of Object.values(m)) x?.dispose();
      for (const x of [flyBody, wingGeo, markGeo, starGeo, heron.material, eyeMat, wingMat, starMat, rippleMat, sparkMat, disc, ring]) x.dispose();
      sound.dispose();
    },
  };
}
