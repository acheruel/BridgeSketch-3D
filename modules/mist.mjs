// BridgeSketch 3D · 0.8.0: morning mist (config.mist), an option.
// Stacked horizontal sheets drawn with a drifting noise: seen together they read as a soft volume. Each sheet reads the
// ground height from a small baked texture, so it fades out where the relief comes through it (no hard line on the
// slopes) and the mist pools in the low ground. 'valley': the low ground of the whole site; 'water': only over the
// water surfaces and their banks. Densest at dawn, thin the rest of the day. One draw call per sheet, no extra pass.
import * as T from 'three';

const SHEETS = 9,
  N = 256,
  WHITE = new T.Color('#ffffff');

const vertexShader = `
varying vec3 vWorld;
void main(){
  vec4 w=modelMatrix*vec4(position,1.);
  vWorld=w.xyz;
  gl_Position=projectionMatrix*viewMatrix*w;
}`;
const fragmentShader = `
uniform sampler2D ground,mask;
uniform vec4 box;
uniform float time,strength,base,top;
uniform vec3 color;
varying vec3 vWorld;
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
void main(){
  vec2 uv=(vWorld.xz-box.xy)*box.zw;
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)discard;
  float above=vWorld.y-texture2D(ground,uv).r;
  if(above<=0.)discard;
  float k=clamp((vWorld.y-base)/(top-base),0.,1.),
    edge=smoothstep(0.,.06,min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y))),
    soft=smoothstep(0.,1.4,above),
    m=texture2D(mask,uv).r;
  vec2 p=vWorld.xz*.03+vec2(time*.018,time*.007)+k*2.3;
  float n=n2(p)*.55+n2(p*2.1+5.2)*.3+n2(p*4.7+1.3-time*.01)*.15;
  float a=strength*(1.-k)*(1.-k)*soft*edge*m*smoothstep(.3,.78,n);
  if(a<.004)discard;
  gl_FragColor=vec4(color,min(a*.7,.5));
}`;

// ground(x, z): height in the parent frame; box: { x0, x1, z0, z1 }; waters: water meshes of the same parent.
export function buildMist(c, ground, box, waters = []) {
  const mode = c.mist,
    w = box.x1 - box.x0,
    d = box.z1 - box.z0,
    heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const v = ground(box.x0 + ((i + 0.5) / N) * w, box.z0 + ((j + 0.5) / N) * d);
      heights[j * N + i] = Number.isFinite(v) ? v : 1e4;
    }
  // Water mode: cells under a water surface, then a 3-cell blur (the banks). Valley mode: everywhere.
  const cover = new Float32Array(N * N).fill(mode === 'water' ? 0 : 1);
  let level = Infinity;
  if (mode === 'water') {
    const a = new T.Vector3(),
      b = new T.Vector3(),
      e = new T.Vector3();
    for (const mesh of waters) {
      mesh.updateWorldMatrix(true, false);
      const pos = mesh.geometry.attributes.position,
        index = mesh.geometry.index,
        count = index ? index.count : pos.count,
        at = k => (index ? index.getX(k) : k);
      if (Number.isFinite(mesh.userData.level)) level = Math.min(level, mesh.userData.level);
      for (let t = 0; t + 2 < count; t += 3) {
        a.fromBufferAttribute(pos, at(t)).applyMatrix4(mesh.matrix);
        b.fromBufferAttribute(pos, at(t + 1)).applyMatrix4(mesh.matrix);
        e.fromBufferAttribute(pos, at(t + 2)).applyMatrix4(mesh.matrix);
        level = Math.min(level, a.y, b.y, e.y);
        const cell = p => [((p.x - box.x0) / w) * N, ((p.z - box.z0) / d) * N],
          [ax, az] = cell(a),
          [bx, bz] = cell(b),
          [ex, ez] = cell(e),
          area = (bx - ax) * (ez - az) - (bz - az) * (ex - ax);
        if (Math.abs(area) < 1e-9) continue;
        for (let j = Math.max(0, Math.floor(Math.min(az, bz, ez))); j <= Math.min(N - 1, Math.ceil(Math.max(az, bz, ez))); j++)
          for (let i = Math.max(0, Math.floor(Math.min(ax, bx, ex))); i <= Math.min(N - 1, Math.ceil(Math.max(ax, bx, ex))); i++) {
            const px = i + 0.5,
              pz = j + 0.5,
              u = ((bx - px) * (ez - pz) - (bz - pz) * (ex - px)) / area,
              v = ((ex - px) * (az - pz) - (ez - pz) * (ax - px)) / area;
            if (u >= -0.05 && v >= -0.05 && u + v <= 1.05) cover[j * N + i] = 1;
          }
      }
    }
    if (!Number.isFinite(level)) return null; // no water on this site
    for (let pass = 0; pass < 3; pass++) {
      const src = cover.slice();
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          let s = 0;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) s += src[Math.min(N - 1, Math.max(0, j + dj)) * N + Math.min(N - 1, Math.max(0, i + di))];
          cover[j * N + i] = Math.max(src[j * N + i], s / 9);
        }
    }
  }
  // Mist band: over the water from its level; in a valley from the low ground (15th percentile of the site).
  const sorted = Float32Array.from(heights.filter(v => v < 1e4)).sort(),
    base = mode === 'water' ? level : sorted[Math.floor(sorted.length * 0.15)] ?? 0,
    top = base + (mode === 'water' ? 4.5 : 7);
  const texture = data => {
    const t = new T.DataTexture(data, N, N, T.RedFormat, T.FloatType);
    t.magFilter = t.minFilter = T.NearestFilter;
    t.needsUpdate = true;
    return t;
  };
  const uniforms = {
      ground: { value: texture(heights) },
      mask: { value: texture(cover) },
      box: { value: new T.Vector4(box.x0, box.z0, 1 / w, 1 / d) },
      time: { value: 0 },
      strength: { value: 1 },
      base: { value: base },
      top: { value: top },
      color: { value: new T.Color('#e8eef2') },
    },
    group = new T.Group();
  group.name = 'Mist';
  const plane = new T.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate((box.x0 + box.x1) / 2, 0, (box.z0 + box.z1) / 2);
  for (let k = 0; k < SHEETS; k++) {
    const material = new T.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: false });
    material.userData.ownedMaterial = true;
    material.name = 'Mist';
    const sheet = new T.Mesh(plane, material);
    sheet.position.y = base + 0.25 + ((top - base - 0.5) * k) / (SHEETS - 1);
    sheet.renderOrder = 2;
    sheet.castShadow = sheet.receiveShadow = false;
    sheet.userData.noBatch = true;
    sheet.userData.sharedGeometry = k > 0;
    group.add(sheet);
  }
  group.userData.mist = {
    // hour: time of day; daylight 0–1; tint: the haze colour of the moment.
    update(seconds, hour, daylight, tint) {
      uniforms.time.value = seconds;
      const dawn = Math.exp(-(((hour - 7) / 1.8) ** 2));
      uniforms.strength.value = 0.35 + 0.65 * dawn;
      uniforms.color.value.copy(tint).lerp(WHITE, 0.75).multiplyScalar(0.55 + 0.45 * daylight);
    },
    dispose() {
      uniforms.ground.value.dispose();
      uniforms.mask.value.dispose();
    },
  };
  return group;
}
