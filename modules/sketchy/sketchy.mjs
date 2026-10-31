// BridgeSketch 3D · Sketchy, the frog mascot (0.6.5). A procedural cartoon tree frog in a site hard hat: glossy skin,
// big blinking eyes that look around, a breathing throat, squash-and-stretch hops with a front flip, a tongue for
// flies, swimming strokes and a flattened, dizzy pose. Local axes: +Z forward, +Y up, feet on y = 0; about 0.75 m
// tall with the hat (a giant frog, so he reads next to the cars).
import * as T from 'three';

// Body ellipsoid: a taller dome above the centre than below it, so the frog sits low.
const BODY = { y: 0.3, rx: 0.33, top: 0.27, bottom: 0.2, rz: 0.37 };
// Point and outward normal on the body surface at (x, y), front (side 1) or back (side -1).
function onBody(x, y, side = 1) {
  const ry = y > BODY.y ? BODY.top : BODY.bottom,
    k = 1 - (x / BODY.rx) ** 2 - ((y - BODY.y) / ry) ** 2,
    z = side * BODY.rz * Math.sqrt(Math.max(0, k));
  return {
    p: new T.Vector3(x, y, z),
    n: new T.Vector3(x / BODY.rx ** 2, (y - BODY.y) / ry ** 2, z / BODY.rz ** 2).normalize(),
  };
}
// Point and normal on the top of the body at plan position (x, z).
function onTop(x, z) {
  const k = 1 - (x / BODY.rx) ** 2 - (z / BODY.rz) ** 2,
    y = BODY.y + BODY.top * Math.sqrt(Math.max(0, k));
  return {
    p: new T.Vector3(x, y, z),
    n: new T.Vector3(x / BODY.rx ** 2, (y - BODY.y) / BODY.top ** 2, z / BODY.rz ** 2).normalize(),
  };
}
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);

function materials() {
  const skin = new T.MeshPhysicalMaterial({
    color: '#62c23d',
    roughness: 0.36,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    sheen: 0.4,
    sheenColor: new T.Color('#c9ff8a'),
  });
  return {
    skin,
    spot: new T.MeshPhysicalMaterial({ color: '#2f7d26', roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    toe: new T.MeshPhysicalMaterial({ color: '#86d957', roughness: 0.4, clearcoat: 0.4 }),
    web: new T.MeshStandardMaterial({ color: '#9ee36f', roughness: 0.55, side: T.DoubleSide }),
    belly: new T.MeshStandardMaterial({ color: '#f4efc2', roughness: 0.62 }),
    white: new T.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.12, clearcoat: 1, emissive: '#ffffff', emissiveIntensity: 0.06 }),
    pupil: new T.MeshPhysicalMaterial({ color: '#0d1114', roughness: 0.08, clearcoat: 1 }),
    shine: new T.MeshBasicMaterial({ color: '#ffffff' }),
    mouth: new T.MeshStandardMaterial({ color: '#3a1618', roughness: 0.5 }),
    tongue: new T.MeshPhysicalMaterial({ color: '#ff6f8e', roughness: 0.3, clearcoat: 0.8 }),
    cheek: new T.MeshStandardMaterial({ color: '#ff7f98', roughness: 0.6, transparent: true, opacity: 0.8, depthWrite: false }),
    hat: new T.MeshPhysicalMaterial({ color: '#ffc21a', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
    band: new T.MeshStandardMaterial({ color: '#102d41', roughness: 0.5 }),
    star: new T.MeshBasicMaterial({ color: '#ffe066', side: T.DoubleSide }),
    shadow: null,
  };
}

// Soft round blob shadow (64 px radial alpha), laid on the ground by the game under the frog.
function blobShadow() {
  const N = 64,
    data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const d = Math.hypot((i + 0.5) / N - 0.5, (j + 0.5) / N - 0.5) * 2,
        k = (j * N + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(255 * (1 - smooth(d)) ** 1.6);
    }
  const map = new T.DataTexture(data, N, N);
  map.needsUpdate = true;
  const mesh = new T.Mesh(
    new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new T.MeshBasicMaterial({ color: '#06120c', map, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
  );
  mesh.name = 'Sketchy shadow';
  mesh.renderOrder = 2;
  return mesh;
}

function starGeometry() {
  const shape = new T.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.022 : 0.05,
      a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    shape[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  return new T.ShapeGeometry(shape);
}

const mesh = (geometry, material, name) => {
  const m = new T.Mesh(geometry, material);
  m.name = name;
  m.castShadow = true;
  return m;
};
// A flattened bump laid on a surface point, facing its normal.
function decal(parent, geometry, material, { p, n }, scale, lift = 0) {
  const m = new T.Mesh(geometry, material);
  m.position.copy(p).addScaledVector(n, lift);
  m.lookAt(m.position.clone().add(n));
  m.scale.set(...scale);
  parent.add(m);
  return m;
}

export function createSketchy() {
  const M = materials(),
    root = new T.Group(),
    // squash: scale about the feet; flip: rotation about the body centre; body: breathing and pitch.
    squash = new T.Group(),
    flip = new T.Group(),
    body = new T.Group();
  root.name = 'Sketchy';
  flip.position.y = BODY.y;
  body.position.y = -BODY.y;
  root.add(squash);
  squash.add(flip);
  flip.add(body);

  // Body: a deformed sphere, a wider seat and a slightly narrower snout.
  const bodyGeo = new T.SphereGeometry(1, 48, 32),
    pos = bodyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i),
      widen = 1 + 0.1 * Math.max(0, -z) * (y < 0.2 ? 1 : 0.5) - 0.07 * Math.max(0, z) * Math.max(0, y);
    pos.setXYZ(i, x * BODY.rx * widen, BODY.y + y * (y > 0 ? BODY.top : BODY.bottom), z * BODY.rz);
  }
  bodyGeo.computeVertexNormals();
  body.add(mesh(bodyGeo, M.skin, 'Sketchy body'));
  const unit = new T.SphereGeometry(1, 24, 16);
  const belly = mesh(unit, M.belly, 'Sketchy belly');
  belly.position.set(0, 0.19, 0.11);
  belly.scale.set(0.27, 0.16, 0.27);
  body.add(belly);
  // Throat sac: pulses while Sketchy breathes.
  const throat = mesh(unit, M.belly, 'Sketchy throat');
  throat.position.set(0, 0.17, 0.26);
  throat.scale.set(0.13, 0.085, 0.1);
  body.add(throat);
  // Back spots.
  for (const [x, z, r] of [
    [-0.12, -0.08, 0.05],
    [0.11, -0.17, 0.045],
    [0.02, -0.27, 0.035],
    [-0.2, -0.22, 0.03],
    [0.22, -0.04, 0.032],
    [-0.04, 0.02, 0.028],
  ])
    decal(body, unit, M.spot, onTop(x, z), [r, r * 0.8, r * 0.18], -0.002);
  // Smile: a tube along the snout, corners turned up, with round dimples.
  const smile = [];
  for (let i = 0; i <= 12; i++) {
    const x = -0.19 + (0.38 * i) / 12,
      { p, n } = onBody(x, 0.322 + 0.045 * (x / 0.19) ** 2);
    smile.push(p.addScaledVector(n, 0.003));
  }
  body.add(mesh(new T.TubeGeometry(new T.CatmullRomCurve3(smile), 32, 0.0095, 6), M.mouth, 'Sketchy smile'));
  for (const s of [smile[0], smile.at(-1)]) {
    const dimple = mesh(unit, M.mouth, 'Sketchy dimple');
    dimple.position.copy(s);
    dimple.scale.setScalar(0.014);
    body.add(dimple);
  }
  for (const side of [-1, 1]) {
    decal(body, unit, M.cheek, onBody(side * 0.2, 0.375), [0.045, 0.032, 0.01], 0.003);
    decal(body, unit, M.mouth, onBody(side * 0.045, 0.445), [0.011, 0.008, 0.006], 0.001);
  }

  // Eyes: a skin socket, a glossy eyeball, a pupil with a highlight on a pivot (looking around) and a lid.
  const eyes = [-1, 1].map(side => {
    const g = new T.Group();
    g.position.set(side * 0.15, 0.52, 0.15);
    const socket = mesh(unit, M.skin, 'Sketchy eye socket');
    socket.position.set(0, -0.045, -0.035);
    socket.scale.setScalar(0.108);
    const ball = mesh(unit, M.white, 'Sketchy eyeball');
    ball.position.set(0, 0.012, 0.012);
    ball.scale.setScalar(0.1);
    const pivot = new T.Group();
    pivot.position.copy(ball.position);
    const pupil = mesh(unit, M.pupil, 'Sketchy pupil');
    pupil.position.z = 0.074;
    pupil.scale.set(0.058, 0.064, 0.032);
    const shine = mesh(unit, M.shine, 'Sketchy eye shine');
    shine.castShadow = false;
    shine.position.set(-side * 0.018, 0.024, 0.104);
    shine.scale.setScalar(0.017);
    const shine2 = shine.clone();
    shine2.position.set(side * 0.014, -0.016, 0.103);
    shine2.scale.setScalar(0.008);
    pivot.add(pupil, shine, shine2);
    const lid = mesh(new T.SphereGeometry(0.107, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.skin, 'Sketchy eyelid');
    lid.position.copy(ball.position);
    g.add(socket, ball, pivot, lid);
    body.add(g);
    return { g, pivot, lid, pupil, side };
  });

  // Hard hat (BridgeSketch navy band), tilted back behind the eyes.
  const hat = new T.Group();
  hat.position.set(0, 0.5, -0.11);
  hat.rotation.x = -0.32;
  const dome = mesh(new T.SphereGeometry(0.15, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.hat, 'Sketchy hat');
  dome.scale.set(1, 0.82, 1.08);
  dome.position.y = 0.035;
  const brim = mesh(new T.CylinderGeometry(0.19, 0.19, 0.016, 36), M.hat, 'Sketchy hat brim');
  brim.scale.set(1, 1, 1.16);
  brim.position.set(0, 0.034, 0.03);
  const band = mesh(new T.CylinderGeometry(0.153, 0.155, 0.032, 36, 1, true), M.band, 'Sketchy hat band');
  band.scale.set(1, 1, 1.08);
  band.position.y = 0.054;
  const ridge = mesh(new T.TorusGeometry(0.121, 0.016, 8, 28, Math.PI), M.hat, 'Sketchy hat ridge');
  ridge.rotation.y = Math.PI / 2;
  ridge.scale.set(1, 0.95, 1.08);
  ridge.position.y = 0.04;
  hat.add(dome, brim, band, ridge);
  body.add(hat);

  // Front arms: shoulder pivot, upper arm, three-toed hand.
  const toeGeo = new T.SphereGeometry(1, 12, 8),
    arms = [-1, 1].map(side => {
      const shoulder = new T.Group();
      shoulder.position.set(side * 0.2, 0.2, 0.18);
      const upper = mesh(new T.CapsuleGeometry(0.036, 0.13, 4, 10), M.skin, 'Sketchy arm');
      upper.position.set(side * 0.02, -0.08, 0.04);
      upper.rotation.set(0.42, 0, side * 0.22);
      const hand = new T.Group();
      hand.position.set(side * 0.04, -0.175, 0.09);
      const palm = mesh(toeGeo, M.skin, 'Sketchy hand');
      palm.scale.set(0.05, 0.02, 0.045);
      hand.add(palm);
      for (const a of [-0.55, 0, 0.55]) {
        const toe = mesh(toeGeo, M.toe, 'Sketchy finger');
        toe.position.set(Math.sin(a) * 0.055 + side * 0.008, 0.002, Math.cos(a) * 0.05);
        toe.scale.setScalar(0.021);
        hand.add(toe);
      }
      shoulder.add(upper, hand);
      body.add(shoulder);
      return { shoulder, side };
    });

  // Back legs: hip → thigh, knee → shin, ankle → webbed foot. Folded at rest, stretched behind in a jump.
  const webShape = new T.Shape();
  webShape.moveTo(0, 0);
  webShape.lineTo(-0.075, 0.13);
  webShape.quadraticCurveTo(0, 0.1, 0.075, 0.13);
  webShape.lineTo(0, 0);
  const webGeo = new T.ShapeGeometry(webShape).rotateX(-Math.PI / 2);
  const legs = [-1, 1].map(side => {
    const hip = new T.Group();
    hip.position.set(side * 0.22, 0.16, -0.14);
    const thigh = mesh(unit, M.skin, 'Sketchy thigh');
    thigh.scale.set(0.105, 0.1, 0.19);
    thigh.position.set(side * 0.05, 0, 0.07);
    thigh.rotation.y = side * 0.32;
    const knee = new T.Group();
    knee.position.set(side * 0.11, -0.03, 0.21);
    const shin = mesh(new T.CapsuleGeometry(0.042, 0.17, 4, 10), M.skin, 'Sketchy shin');
    shin.rotation.x = Math.PI / 2 - 0.35;
    shin.position.set(0, -0.045, -0.095);
    const ankle = new T.Group();
    ankle.position.set(0, -0.1, -0.19);
    const foot = mesh(toeGeo, M.skin, 'Sketchy foot');
    foot.scale.set(0.05, 0.022, 0.08);
    foot.position.z = 0.07;
    const web = new T.Mesh(webGeo, M.web);
    web.name = 'Sketchy web';
    web.position.set(0, 0.004, 0.08);
    ankle.add(foot, web);
    for (const a of [-0.5, 0, 0.5]) {
      const toe = mesh(toeGeo, M.toe, 'Sketchy toe');
      toe.position.set(Math.sin(a) * 0.12, 0.006, 0.08 + Math.cos(a) * 0.12);
      toe.scale.setScalar(0.024);
      ankle.add(toe);
    }
    knee.add(shin, ankle);
    hip.add(thigh, knee);
    body.add(hip);
    return { hip, knee, ankle, side };
  });

  // Tongue: a pink capsule from the mouth, stretched towards a fly.
  const tongue = new T.Group();
  tongue.position.copy(onBody(0, 0.305).p);
  const tongueMesh = mesh(new T.CapsuleGeometry(0.028, 1, 4, 10).rotateX(Math.PI / 2).translate(0, 0, 0.5), M.tongue, 'Sketchy tongue');
  tongue.add(tongueMesh);
  tongue.visible = false;
  body.add(tongue);

  // Dizzy stars over the flattened frog.
  const stars = new T.Group(),
    starGeo = starGeometry();
  for (let i = 0; i < 4; i++) {
    const s = new T.Mesh(starGeo, M.star);
    s.name = 'Sketchy dizzy star';
    stars.add(s);
  }
  stars.visible = false;
  root.add(stars);

  const shadow = blobShadow();
  const state = {
    time: Math.random() * 10,
    blinkAt: 1.5,
    blink: 0,
    lookAt: 0,
    look: new T.Vector2(),
    lookTarget: new T.Vector2(),
    spring: 0,
    springV: 0,
    hatV: 0,
    hat: 0,
    happy: 0,
    flat: 0,
    tongue: null,
    pitch: 0,
    squeeze: 0,
    squeezeV: 0,
    gold: 0,
  };
  // 0.6.5: golden power (the power fly): the skin, spots and belly turn to glowing gold.
  const gold = { skin: new T.Color('#ffc928'), spot: new T.Color('#e08a00'), belly: new T.Color('#fff4b8') },
    base = { skin: M.skin.color.clone(), spot: M.spot.color.clone(), belly: M.belly.color.clone() };
  M.skin.emissive.set('#ffb300');
  M.skin.emissiveIntensity = 0;

  function setLegs(extend, splay = 0, kick = [0, 0]) {
    for (const l of legs) {
      const e = Math.min(1, Math.max(0, extend + kick[l.side < 0 ? 0 : 1]));
      l.hip.rotation.set(2.5 * e, l.side * splay, 0);
      l.knee.rotation.x = 2.9 * e;
      l.ankle.rotation.x = 2.3 * e;
    }
  }
  function setArms(reach, paddle = [0, 0]) {
    for (const a of arms) a.shoulder.rotation.set(-1.1 * reach + paddle[a.side < 0 ? 0 : 1], 0, a.side * 0.25 * reach);
  }

  return {
    group: root,
    shadow,
    // Stretch the tongue to a point given in world coordinates; it snaps back on its own.
    lick(world) {
      state.tongue = { target: world.clone(), t: 0 };
    },
    // Squeezed between two vehicles: a quick sideways squash.
    squeeze() {
      state.squeezeV += 9;
    },
    // 0–1: green to glowing gold.
    setGolden(k) {
      if (Math.abs(k - state.gold) < 0.002) return;
      state.gold = k;
      for (const key of ['skin', 'spot', 'belly']) M[key].color.lerpColors(base[key], gold[key], k);
      M.skin.emissiveIntensity = 0.45 * k;
    },
    cheer() {
      state.happy = 0.6;
    },
    // Called every frame. pose: { air: 0–1 hop phase or null, big, flip, swim, flat: 0–1, moving, landed }
    animate(dt, pose = {}) {
      const s = state;
      s.time += dt;
      const t = s.time;
      // Squash and stretch spring: in-air stretch target, impulses on take-off and landing.
      if (pose.takeoff) s.springV += pose.big ? 3.2 : 2.2;
      if (pose.landed) {
        s.springV -= pose.big ? 5.5 : 3.2;
        s.hatV -= pose.big ? 9 : 5;
      }
      const target = pose.air != null ? 0.14 * Math.sin(Math.PI * pose.air) : 0;
      s.springV += (-260 * (s.spring - target) - 15 * s.springV) * dt;
      s.spring += s.springV * dt;
      s.hatV += (-180 * s.hat - 9 * s.hatV) * dt;
      s.hat += s.hatV * dt;
      // Flattened by a vehicle: a pancake with dizzy stars, then a springy recovery.
      s.flat = damp(s.flat, pose.flat ?? 0, pose.flat ? 30 : 9, dt);
      const breathe = 1 + 0.018 * Math.sin(t * 5.2),
        sy = (1 + s.spring) * (1 - 0.86 * s.flat),
        sxz = (1 / Math.sqrt(Math.max(0.3, 1 + s.spring))) * (1 + 0.75 * s.flat);
      s.squeezeV += (-220 * s.squeeze - 12 * s.squeezeV) * dt;
      s.squeeze += s.squeezeV * dt;
      squash.scale.set(sxz * breathe * (1 - 0.45 * Math.max(0, s.squeeze)), sy * (1 + 0.25 * Math.max(0, s.squeeze)), sxz * (2 - breathe));
      throat.scale.set(0.13, 0.085, 0.1).multiplyScalar(1 + (pose.air == null && !pose.swim ? 0.22 * Math.max(0, Math.sin(t * 3.1)) ** 4 : 0));
      // Body pitch: nose up on take-off, down before landing; leaning forward while swimming.
      const pitchTarget = pose.air != null ? -0.38 + 0.68 * pose.air : pose.swim ? 0.28 : 0;
      s.pitch = damp(s.pitch, pitchTarget, 14, dt);
      body.rotation.x = s.pitch;
      flip.rotation.x = pose.air != null && pose.flip ? 2 * Math.PI * smooth(Math.min(1, pose.air * 1.15)) : 0;
      hat.rotation.x = -0.32 + s.hat * 0.06;
      // Legs and arms.
      if (s.flat > 0.05) {
        setLegs(1, 0.9);
        setArms(0.2);
      } else if (pose.swim) {
        const k = Math.sin(t * 7.5);
        setLegs(0.45, 0.35, [0.35 * k, -0.35 * k]);
        setArms(0.5, [0.6 * Math.sin(t * 7.5 + 1), 0.6 * Math.sin(t * 7.5 + 1 + Math.PI)]);
      } else if (pose.air != null) {
        const p = pose.air;
        setLegs(p < 0.45 ? smooth(p / 0.2) : 1 - smooth((p - 0.55) / 0.45), 0.15);
        setArms(p < 0.5 ? 0.3 : 0.3 + 0.7 * smooth((p - 0.5) / 0.4));
      } else {
        setLegs(0);
        setArms(0);
      }
      // Eyes: blinks every few seconds (sometimes twice), a glance around, a squint when happy or dizzy.
      if (t > s.blinkAt) {
        s.blink = 0.16;
        s.blinkAt = t + 1.8 + Math.random() * 3.5;
        if (Math.random() < 0.2) s.blinkAt = t + 0.3;
      }
      s.blink = Math.max(0, s.blink - dt);
      s.happy = Math.max(0, s.happy - dt);
      const blinkLid = s.blink > 0 ? Math.sin((s.blink / 0.16) * Math.PI) : 0,
        lidAngle = -0.95 + 2.5 * Math.max(blinkLid, s.happy > 0 ? 0.55 : 0, s.flat > 0.3 ? 0.62 : 0, pose.swim ? 0.25 : 0);
      if (t > s.lookAt) {
        s.lookTarget.set((Math.random() - 0.5) * 0.7, (Math.random() - 0.4) * 0.35);
        s.lookAt = t + 1 + Math.random() * 2.2;
      }
      s.look.x = damp(s.look.x, s.lookTarget.x, 12, dt);
      s.look.y = damp(s.look.y, s.lookTarget.y, 12, dt);
      for (const e of eyes) {
        e.lid.rotation.x = lidAngle;
        e.pivot.rotation.set(-s.look.y, e.side * 0.2 + s.look.x, 0);
        const dizzy = s.flat > 0.3;
        e.pupil.scale.set(dizzy ? 0.03 : 0.058, dizzy ? 0.03 : 0.064, 0.032);
        if (dizzy) e.pivot.rotation.set(0.3 * Math.sin(t * 9 + e.side), 0.3 * Math.cos(t * 9 + e.side), 0);
      }
      // Dizzy stars orbit over the pancake.
      stars.visible = s.flat > 0.4;
      if (stars.visible)
        stars.children.forEach((st, i) => {
          const a = t * 3.2 + (i * Math.PI) / 2;
          st.position.set(Math.cos(a) * 0.32, 0.22 + 0.04 * Math.sin(t * 6 + i), Math.sin(a) * 0.32);
          st.rotation.set(0, -a, t * 4);
        });
      // Tongue: out in 0.07 s, back in 0.12 s.
      if (s.tongue) {
        s.tongue.t += dt;
        const k = s.tongue.t < 0.07 ? s.tongue.t / 0.07 : 1 - (s.tongue.t - 0.07) / 0.12;
        if (k <= 0) {
          s.tongue = null;
          tongue.visible = false;
        } else {
          tongue.visible = true;
          root.updateMatrixWorld(true);
          tongue.lookAt(s.tongue.target);
          const tip = body.worldToLocal(s.tongue.target.clone());
          tongue.scale.set(1, 1, Math.max(0.01, k * tip.distanceTo(tongue.position)));
        }
      }
    },
    dispose() {
      root.traverse(o => o.geometry?.dispose());
      shadow.geometry.dispose();
      shadow.material.map.dispose();
      shadow.material.dispose();
      for (const m of Object.values(M)) m?.dispose?.();
    },
  };
}
