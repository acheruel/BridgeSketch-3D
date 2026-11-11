import * as T from 'three';

// Meadow, 0.6.0. Shading ideas adapted from Steve245270533/three-stylized (MIT):
// world-coherent wind, root-to-tip gradient, up-facing blade normals (no ribbon shimmer)
// and sun back-lighting through thin tips. The density is budgeted instead of per square metre:
// tufts concentrate around the bridge and in noise clumps, and the terrain shader carries the same palette.

// Tufts per scene (18 triangles each, 31 for reeds). 0.6.0: slightly fewer tufts, each with pointed, tapered blades.
export const grassBudget = { performance: 14000, balanced: 40000, high: 76000 };
export const grassUniforms = {
  grassTime: { value: 0 },
  windDirection: { value: new T.Vector2(0.82, 0.57) },
  windStrength: { value: 1 },
  sunDirection: { value: new T.Vector3(0, 1, 0) },
  sunColor: { value: new T.Color('#fff') },
  backlight: { value: 1 },
  // Distance thinning (level of detail): full density up to grassNear, 18 % beyond grassFar.
  grassNear: { value: 26 },
  grassFar: { value: 90 },
};

export function prepareGrassMaterial(material) {
  material.side = T.DoubleSide;
  material.vertexColors = true;
  material.color.set('#ffffff');
  material.roughness = 0.78;
  material.customProgramCacheKey = () => 'bridgesketch-meadow-055-lod';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, grassUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float grassTime,windStrength,grassNear,grassFar;uniform vec2 windDirection;varying float vGrassHeight;varying vec3 vGrassWorld;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        'vec3 objectNormal=normalize(mix(normal,vec3(0.,1.,0.),.78));\n#ifdef USE_TANGENT\nvec3 objectTangent=vec3(tangent.xyz);\n#endif',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vGrassHeight=uv.y;
#ifdef USE_INSTANCING
{
  mat4 grassMatrix=modelMatrix*instanceMatrix;vec3 root=grassMatrix[3].xyz;
  // Level of detail: each tuft has a random rank; far tufts shrink to nothing once the density drops below it.
  float rank=fract(sin(dot(root.xz,vec2(12.9898,78.233)))*43758.5453);
  float density=1.-.82*smoothstep(grassNear,grassFar,distance(root.xz,cameraPosition.xz));
  transformed*=smoothstep(rank-.06,rank,density);
  vec2 across=vec2(-windDirection.y,windDirection.x);
  float gust=smoothstep(.25,1.,.5+.5*sin(dot(root.xz,windDirection)*.045-grassTime*.55));
  float wave=sin(dot(root.xz,windDirection)*.42+grassTime*1.7)+.35*sin(dot(root.xz,across)*.77+grassTime*1.13);
  vec3 wind=vec3(windDirection.x,0.,windDirection.y)*(wave*(.05+.13*gust)+.05)*windStrength*uv.y*uv.y;
  mat3 m=mat3(instanceMatrix);transformed+=transpose(m)*wind/max(dot(m[0],m[0]),1e-4);
  transformed.y-=.12*length(wind)*uv.y;
  vGrassWorld=(grassMatrix*vec4(transformed,1.)).xyz;
}
#else
vGrassWorld=(modelMatrix*vec4(transformed,1.)).xyz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 sunDirection,sunColor;uniform float backlight;varying float vGrassHeight;varying vec3 vGrassWorld;`,
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb*=mix(.62,1.,smoothstep(0.,.55,vGrassHeight));',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 V=normalize(cameraPosition-vGrassWorld),L=normalize(sunDirection);
  float through=pow(max(dot(-V,L),0.),3.)*vGrassHeight*vGrassHeight;
  totalEmissiveRadiance+=sunColor*diffuseColor.rgb*(through*1.6*backlight+.04);
}`,
      );
  };
  return material;
}

// Grass tufts (0.6.0), after CK42BB/procedural-grass-threejs (MIT) species profiles: tapered blades of three
// triangles (base quad + pointed tip) bent along a quadratic curve; uv.y is the normalised height used by the
// wind and shading. Kinds: meadow (mixed wild grass), tall (sedges and reeds with cattails on wet river banks),
// dry (bunch grass with straw tips on slopes and dry patches). Vertex colours carry each species' palette.
const SPECIES = {
  meadow: {
    blades: 6,
    height: [0.3, 0.46],
    width: 0.02,
    bend: [0.1, 0.26],
    spread: 0.1,
    // 0.7.1: darker blades, to match the darker ground
    root: '#33471f',
    mid: '#566b34',
    tip: '#8f9a5c',
    straw: 0.25,
  },
  tall: {
    blades: 5,
    height: [0.75, 1.25],
    width: 0.016,
    bend: [0.05, 0.16],
    spread: 0.14,
    root: '#2a4324',
    mid: '#4d6a3a',
    tip: '#7f9258',
    straw: 0.15,
    cattails: 1,
  },
  dry: {
    blades: 6,
    height: [0.34, 0.6],
    width: 0.018,
    bend: [0.14, 0.34],
    spread: 0.12,
    root: '#4f5a2e',
    mid: '#7d8650',
    tip: '#b5aa74',
    straw: 0.7,
  },
};
export const grassKinds = Object.keys(SPECIES);
export function tuftGeometry(kind = 'meadow') {
  const k = SPECIES[kind] ?? SPECIES.meadow,
    position = [],
    color = [],
    uv = [],
    root = new T.Color(k.root),
    mid = new T.Color(k.mid),
    tip = new T.Color(k.tip),
    straw = new T.Color('#d8c27a');
  const colourAt = (t, tone, dry) => {
    const c = t < 0.5 ? root.clone().lerp(mid, t / 0.5) : mid.clone().lerp(tip, (t - 0.5) / 0.5);
    return c.lerp(straw, dry * Math.max(0, t - 0.35) * 1.5).multiplyScalar(tone);
  };
  for (let i = 0; i < k.blades; i++) {
    const f = n => (((i + 1) * n) % 97) / 97,
      a = i * 2.39996 + 0.3,
      dx = Math.cos(a),
      dz = Math.sin(a),
      offset = 0.015 + k.spread * f(37),
      h = k.height[0] + (k.height[1] - k.height[0]) * f(53),
      w = k.width * (0.8 + 0.4 * f(19)),
      bend = k.bend[0] + (k.bend[1] - k.bend[0]) * f(29),
      tone = 0.86 + 0.28 * f(71),
      dry = f(13) < k.straw ? 0.7 : 0;
    // Point on the blade: across ∈ [-1, 1], t ∈ [0, 1] up the blade; width tapers, the blade bends outwards.
    const vertex = (across, t) => {
      const lean = bend * t * t,
        half = w * (1 - 0.75 * t);
      return [dx * (offset + lean) - dz * across * half, h * t * (1 - 0.2 * t * t * bend / 0.3), dz * (offset + lean) + dx * across * half];
    };
    const tri = (...pts) => {
      for (const [across, t] of pts) {
        position.push(...vertex(across, t));
        uv.push(across > 0 ? 1 : 0, t);
        const c = colourAt(t, tone, dry);
        color.push(c.r, c.g, c.b);
      }
    };
    tri([-1, 0], [1, 0], [1, 0.55]);
    tri([-1, 0], [1, 0.55], [-1, 0.55]);
    tri([-1, 0.55], [1, 0.55], [0, 1]);
  }
  // Cattails: a brown spike on a thin stem (two crossed quads each).
  for (let j = 0; j < (k.cattails ?? 0); j++) {
    const a = j * 2.7 + 1.1,
      ox = Math.cos(a) * 0.06,
      oz = Math.sin(a) * 0.06,
      top = 1.25,
      brown = new T.Color('#5a3a22'),
      stem = new T.Color('#6f7f46');
    for (const [cx, cz] of [
      [1, 0],
      [0, 1],
    ])
      for (const [y0, y1, r, c] of [
        [0, top - 0.2, 0.005, stem],
        [top - 0.2, top, 0.021, brown],
      ]) {
        const p = (s, y) => [ox + cx * s * r, y, oz + cz * s * r];
        for (const [s, y] of [
          [-1, y0],
          [1, y0],
          [1, y1],
          [-1, y0],
          [1, y1],
          [-1, y1],
        ]) {
          position.push(...p(s, y));
          uv.push(s > 0 ? 1 : 0, y / top);
          color.push(c.r, c.g, c.b);
        }
      }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(color, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Small upward-facing blossoms add the meadow colour variation seen in architectural renders.
export function flowerGeometry() {
  const position = [],
    uv = [],
    r = 0.07;
  for (const a of [0, Math.PI / 2]) {
    const c = Math.cos(a) * r,
      s = Math.sin(a) * r;
    position.push(-c, 0.32, -s, c, 0.32, s, 0, 0.36, 0, -c, 0.32, -s, 0, 0.28, 0, c, 0.32, s);
    uv.push(0, 1, 1, 1, 0.5, 1, 0, 1, 0.5, 1, 1, 1);
  }
  position.push(-0.008, 0, 0, 0.008, 0, 0, 0, 0.32, 0);
  uv.push(0, 0, 1, 0, 0.5, 0.8);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute(
    'color',
    new T.Float32BufferAttribute(
      position.map((_, i) => 1),
      3,
    ),
  );
  g.computeVertexNormals();
  return g;
}

function valueNoise(seed) {
  const h = (x, z) => {
    const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  return (x, z) => {
    const ix = Math.floor(x),
      iz = Math.floor(z),
      fx = x - ix,
      fz = z - iz,
      u = fx * fx * (3 - 2 * fx),
      v = fz * fz * (3 - 2 * fz);
    return (h(ix, iz) * (1 - u) + h(ix + 1, iz) * u) * (1 - v) + (h(ix, iz + 1) * (1 - u) + h(ix + 1, iz + 1) * u) * v;
  };
}

// Budgeted placement: dense near the bridge and in clumps, thinner towards the diorama edge.
// 0.7.1: density(x, z) thins or thickens the meadow (grass zones of an imported site); `hot` = [{ x0, z0, x1, z1, weight }]
// boxes of the dense zones, drawn more often than the rest of the site (share = `hotShare` of the candidates).
export function scatterMeadow({ extent, halfZ, rng, occupied, height, budget, seed = 1, zone = () => 'meadow', density = null, hot = [], hotShare = 0 }) {
  const noise = valueNoise(seed),
    items = [],
    flowers = [],
    attempts = budget * 6;
  const hotTotal = hot.reduce((a, b) => a + b.weight, 0);
  for (let i = 0; i < attempts && items.length < budget; i++) {
    let x, z, dense = 1, inHot = false;
    if (hotTotal && rng() < hotShare) {
      let pick = rng() * hotTotal,
        k = 0;
      while (k < hot.length - 1 && pick > hot[k].weight) pick -= hot[k++].weight;
      x = hot[k].x0 + rng() * (hot[k].x1 - hot[k].x0);
      z = hot[k].z0 + rng() * (hot[k].z1 - hot[k].z0);
      if (density(x, z) <= 1) continue;
      inHot = true;
    } else {
      x = (rng() - 0.5) * (extent - 3);
      z = (rng() - 0.5) * (2 * halfZ - 3);
      if (density) dense = Math.min(1, density(x, z));
    }
    const r = Math.hypot(x / (extent / 2), z / halfZ),
      focus = inHot ? 1 : dense * (1 - 0.62 * Math.min(1, Math.max(0, (r - 0.35) / 0.65)));
    const clump =
      0.35 +
      0.65 * Math.min(1, Math.max(0, noise(x * 0.09, z * 0.09) * 1.25 + noise(x * 0.31, z * 0.31) * 0.35 - 0.25));
    if (rng() > focus * clump || occupied(x, z, 0.4)) continue;
    const s = 0.75 + rng() * 0.5 + clump * 0.3,
      dry = noise(x * 0.03 + 40, z * 0.03);
    // Species by site: tall sedges and reeds on wet banks, bunch grass on slopes and dry patches, meadow elsewhere.
    let kind = zone(x, z, dry);
    if (kind === 'meadow' && dry > 0.68) kind = 'dry';
    items.push({ x, z, y: height(x, z) - 0.02, s, r: rng() * Math.PI * 2, dry, kind });
    if (rng() < 0.035)
      flowers.push({
        x: x + (rng() - 0.5) * 0.4,
        z: z + (rng() - 0.5) * 0.4,
        y: height(x, z) - 0.02,
        s: 0.8 + rng() * 0.6,
        r: rng() * 6.28,
        kind: Math.floor(rng() * 4),
      });
  }
  return { items, flowers };
}
