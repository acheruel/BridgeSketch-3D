// BridgeSketch 3D · Materials: textures, procedural meadow/snow/steel/water shaders.
import * as T from 'three';
import { makeWaterMaterial } from './water.mjs';
import { prepareGrassMaterial } from './grass.mjs';
import { prepareLeafMaterial } from './trees.mjs';

// Moving cloud shadows (0.5.5): the sun's shadow term of every lit material is multiplied by a drifting
// cloud-cover noise sampled at the world position. One global shader patch, no extra render pass; the
// uniforms are shared through onBeforeCompile (materials without them get strength 0: no clouds).
export const cloudShadow = { time: { value: 0 }, strength: { value: 0 } };
if (!T.ShaderChunk.shadowmap_vertex.includes('vCloudWorld')) {
  T.ShaderChunk.shadowmap_pars_vertex += '\n#ifdef USE_SHADOWMAP\nvarying vec3 vCloudWorld;\n#endif\n';
  T.ShaderChunk.shadowmap_vertex += '\n#ifdef USE_SHADOWMAP\nvCloudWorld=worldPosition.xyz;\n#endif\n';
  T.ShaderChunk.shadowmap_pars_fragment += `
#ifdef USE_SHADOWMAP
varying vec3 vCloudWorld;uniform float cloudTime,cloudStrength;
float cloudHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float cloudNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(cloudHash(i),cloudHash(i+vec2(1,0)),f.x),mix(cloudHash(i+vec2(0,1)),cloudHash(i+vec2(1,1)),f.x),f.y);}
float cloudShade(){
  if(cloudStrength<=0.)return 1.;
  vec2 p=vCloudWorld.xz*.012+vec2(cloudTime*.021,cloudTime*.009);
  float n=cloudNoise(p)*.55+cloudNoise(p*2.3+7.1)*.3+cloudNoise(p*5.1+3.7)*.15;
  return 1.-cloudStrength*smoothstep(.5,.72,n);
}
#endif
`;
  const line = 'vDirectionalShadowCoord[ i ] ) : 1.0;';
  if (T.ShaderChunk.lights_fragment_begin.includes(line))
    T.ShaderChunk.lights_fragment_begin = T.ShaderChunk.lights_fragment_begin.replace(
      line,
      line + '\n\t\tdirectLight.color *= cloudShade();',
    );
}
const withClouds = material => {
  if (material.userData.clouds) return material;
  material.userData.clouds = true;
  // Keep each material's own program key: the wrapper below has the same source text for every material.
  const previous = material.onBeforeCompile,
    key = material.customProgramCacheKey() + '|clouds';
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader, renderer) => {
    shader.uniforms.cloudTime = cloudShadow.time;
    shader.uniforms.cloudStrength = cloudShadow.strength;
    previous?.call(material, shader, renderer);
  };
  return material;
};

// Concrete tints (cool grey is the default); the original bright Poly Haven tint is no longer offered.
export const concreteFinishes = { light: '#8f9a9e', warm: '#b5b4ab' };

export function makeMaterials(onLoad = () => {}) {
  const material = (color, roughness = 0.85, metalness = 0) =>
    new T.MeshStandardMaterial({ color, roughness, metalness });
  const m = {
    concrete: material('#a5a397', 0.88),
    edge: material('#aaa99e', 0.86),
    asphalt: material('#30363a', 0.9),
    steel: material('#64707a', 0.7, 0.5),
    dark: material('#253037', 0.65, 0.15),
    railing: material('#9ba6a6', 0.62, 0.7),
    guardrail: material('#9da6a1', 0.55, 0.75),
    // Samuel-De Champlain architectural railing: white-grey satin paint.
    sdc: material('#d6dad8', 0.45, 0.05),
    reflector: material('#f0c84c', 0.4, 0.1),
    grass: material('#839873'),
    grassBlade: material('#4d8052'),
    earth: material('#8f9581'),
    stone: material('#ffffff'),
    sand: material('#b7ad91'),
    white: material('#ebe6cf'),
    yellow: material('#eec45f'),
    tree: material('#446c58'),
    treeLight: material('#658f67'),
    trunk: material('#655849'),
    building: material('#b9c6c9'),
    roof: material('#728891'),
    vehicle: material('#c85b4d', 0.5, 0.15),
    vehicleAlt: material('#4c7895', 0.5, 0.15),
    truck: material('#d38a42', 0.58, 0.1),
    glass: material('#9fd6df', 0.25, 0.2),
    wheel: material('#20292d', 0.9),
  };
  m.concrete.userData.chamfer = m.edge.userData.chamfer = true;
  ['#23577e', '#b93632', '#e5e8e6', '#34464b', '#c9a34e', '#42785e', '#776a8b'].forEach(
    (color, i) => (m['paint' + i] = material(color, 0.32, 0.28)),
  );
  if (typeof document !== 'undefined') {
    const loader = new T.TextureLoader();
    const load = (file, color = false) => {
      const t = loader.load(`./textures/${file}`, onLoad, undefined, () => console.warn(`Could not load ${file}`));
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = 8;
      if (color) t.colorSpace = T.SRGBColorSpace;
      return t;
    };
    for (const [key, file, size, normal] of [
      ['asphalt', 'asphalt_4k.webp', 4.5, 'asphalt_01_nor_gl.webp'],
      ['concrete', 'rough_concrete_diff_1k.jpg', 1.2, 'rough_concrete_nor_gl_1k.jpg'],
      ['grass', 'meadow-v2.webp', 1.6, ''],
    ]) {
      m[key].map = load(file, true);
      m[key].color.set(key === 'grass' ? '#ab9caa' /* 0.7.1: darker, olive grass: with the meadow texture it renders close to the grass of the satellite imagery (about rgb 90 101 64); was #dce7c9 */ : key === 'concrete' ? '#f0f0ed' : '#687176');
      m[key].userData.textureMetres = size;
      if (normal) {
        m[key].normalMap = load(normal);
        m[key].normalScale.setScalar(key === 'asphalt' ? 0.32 : 0.32);
      }
    }
    m.concrete.roughnessMap = load('rough_concrete_rough_1k.jpg');
    // Riprap: packed 200–300 mm angular stones; one 1024 px tile covers 2 m.
    m.stone.map = load('riprap_diff.webp', true);
    m.stone.normalMap = load('riprap_nor.webp');
    m.stone.roughnessMap = load('riprap_rough.webp');
    m.stone.normalScale.setScalar(0.8);
    m.stone.userData.textureMetres = 2;
    m.edge.map = m.concrete.map;
    m.edge.normalMap = m.concrete.normalMap;
    m.edge.roughnessMap = m.concrete.roughnessMap;
    m.edge.normalScale.setScalar(0.32);
    m.edge.color.set('#f9f8f4');
    m.edge.userData.textureMetres = 1.2;
    // Painted steel uses the selected sRGB colour directly; a dark diffuse map hid the finishes.
    for (const [key, file, size] of [
      ['earth', 'meadow-v2.webp', 3],
      ['tree', 'foliage-v2.webp', 0],
      ['treeLight', 'foliage-v2.webp', 0],
    ]) {
      const t = load(file, true);
      m[key].map = t;
      m[key].color.set(key === 'treeLight' ? '#b8c2a0' : '#ffffff');
      if (size) {
        t.wrapS = t.wrapT = T.RepeatWrapping;
        m[key].userData.textureMetres = size;
        m[key].bumpMap = t;
        m[key].bumpScale = 0.035;
      } else {
        m[key].alphaTest = 0.45;
        m[key].side = T.DoubleSide;
        m[key].roughness = 0.9;
        m[key].emissive.set('#758354');
        m[key].emissiveIntensity = 0.18;
      }
    }
    m.building.map = m.concrete.map.clone();
    m.building.map.repeat.set(3, 3);
    m.building.color.set('#c6c0b4');
    m.glass.color.set('#546774');
    m.glass.roughness = 0.22;
    m.roof.color.set('#656561');
    m.truck.color.set('#b49062');
    for (const kit of ['suburban', 'commercial']) {
      const atlas = loader.load(`./models/${kit}-colormap.webp`, onLoad);
      atlas.colorSpace = T.SRGBColorSpace;
      atlas.magFilter = T.NearestFilter;
      m[kit] = new T.MeshStandardMaterial({
        map: atlas,
        roughness: 0.84,
        metalness: 0,
      });
    }
  }
  m.grass.roughness = 1;
  m.grass.bumpMap = m.grass.map;
  m.grass.bumpScale = 0.055;
  // Site tint: wetter, deeper green near the water line; drier straw on 2H:1V slopes; lawn for urban sites.
  m.grass.userData.waterLevel = { value: -1e4 };
  m.grass.userData.lawn = { value: 0 };
  m.grass.userData.fall = { value: 0 };
  m.grass.onBeforeCompile = shader => {
    shader.uniforms.waterLevel = m.grass.userData.waterLevel;
    shader.uniforms.lawn = m.grass.userData.lawn;
    shader.uniforms.fall = m.grass.userData.fall;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 meadowPosition;varying vec3 meadowNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nmeadowPosition=(modelMatrix*vec4(transformed,1.)).xyz;meadowNormal=normalize(mat3(modelMatrix)*objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 meadowPosition;varying vec3 meadowNormal;uniform float waterLevel,lawn,fall;
float meadowHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float meadowNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(meadowHash(i),meadowHash(i+vec2(1,0)),f.x),mix(meadowHash(i+vec2(0,1)),meadowHash(i+vec2(1,1)),f.x),f.y);}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
vec2 grassUV=meadowPosition.xz/4.;
vec4 grassA=texture2D(map,grassUV),grassB=texture2D(map,mat2(.8,-.6,.6,.8)*grassUV+vec2(17.3,9.7));
diffuseColor*=mix(grassA,grassB,smoothstep(.25,.75,meadowNoise(meadowPosition.xz*.16)));
#endif`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float meadowPatch=meadowNoise(meadowPosition.xz*.055);diffuseColor.rgb*=mix(vec3(.72,.91,.78),vec3(1.10,1.15,1.03),mix(meadowPatch,.6,lawn*.7));
// 0.7.2: no dry (yellow) tint on slopes: approach and bridge embankments keep the colour of the base ground.
float wet=smoothstep(waterLevel+1.8,waterLevel+.25,meadowPosition.y);
diffuseColor.rgb*=mix(vec3(1.),vec3(.78,.9,.8),wet);
diffuseColor.rgb*=mix(vec3(1.),vec3(1.04,1.12,.94),lawn);
// Autumn: straw-gold meadow with drifts of fallen leaves (orange, rust, ochre).
if(fall>0.){
  diffuseColor.rgb*=mix(vec3(1.),mix(vec3(1.1,.93,.62),vec3(1.,.8,.55),meadowPatch),fall);
  float litter=smoothstep(.66,.84,meadowNoise(meadowPosition.xz*3.1))*smoothstep(.25,.65,meadowNoise(meadowPosition.xz*.19+3.));
  vec3 leafCol=mix(vec3(.5,.16,.05),vec3(.74,.4,.08),meadowNoise(meadowPosition.xz*7.3));
  diffuseColor.rgb=mix(diffuseColor.rgb,leafCol,fall*litter*.8);
}`,
      );
  };
  // Diorama cut faces: one soil section on all four edges and the approach cuts. A 'soilDepth' attribute
  // (0 at the ground surface) gives a grass fringe, dark topsoil and banded subsoil, in world metres.
  // Railway ballast: procedural crushed-stone texture (textures/ballast.webp), about 1.2 m per tile.
  m.ballast = material('#d8d6d0', 0.95);
  m.ballast.userData.textureMetres = 1.2;
  if (typeof document !== 'undefined') {
    const t = new T.TextureLoader().load('./textures/ballast.webp', onLoad);
    t.colorSpace = T.SRGBColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 8;
    m.ballast.map = t;
  }
  m.soil = material('#ffffff', 0.97);
  m.soil.customProgramCacheKey = () => 'bridgesketch-soil-060';
  m.soil.userData.snow = { value: 0 };
  m.soil.userData.fall = { value: 0 };
  m.soil.userData.noBatch = true; // keeps its soilDepth attribute
  m.soil.onBeforeCompile = shader => {
    shader.uniforms.soilSnow = m.soil.userData.snow;
    shader.uniforms.soilFall = m.soil.userData.fall;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float soilDepth;varying float vSoilDepth;varying vec3 vSoilWorld;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSoilDepth=soilDepth;vSoilWorld=(modelMatrix*vec4(transformed,1.)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vSoilDepth;varying vec3 vSoilWorld;uniform float soilSnow,soilFall;
float soilHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float soilNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(soilHash(i),soilHash(i+vec2(1,0)),f.x),mix(soilHash(i+vec2(0,1)),soilHash(i+vec2(1,1)),f.x),f.y);}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float along=vSoilWorld.x+vSoilWorld.z;
  float wobble=soilNoise(vec2(along*.35,1.7))*.12;
  float d=vSoilDepth+wobble*.5;
  float band=soilNoise(vec2(along*.08,vSoilWorld.y*3.1+soilNoise(vec2(along*.2,0.))*1.5));
  vec3 sub=mix(vec3(.46,.36,.26),vec3(.62,.52,.38),band);
  sub=mix(sub,sub*.72,step(.82,soilNoise(vec2(along*6.,vSoilWorld.y*9.))));
  vec3 top=vec3(.24,.18,.12)*(.85+.3*soilNoise(vec2(along*2.,vSoilWorld.y*4.)));
  vec3 col=mix(top,sub,smoothstep(.28,.55,d));
  float fringe=1.-smoothstep(.04,.1+.06*soilNoise(vec2(along*3.,0.)),d);
  col=mix(col,mix(mix(vec3(.33,.45,.2),vec3(.55,.42,.18),soilFall),vec3(.86,.9,.92),soilSnow),fringe);
  diffuseColor.rgb=col;
}`,
      );
  };
  // Bank boulders: weathered grey stone, darker than the old sand tone that read as white dots.
  m.bankRock = material('#8a857b', 0.92);
  m.snow = material('#d3dfe0', 1);
  m.snow.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 snowPosition;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nsnowPosition=(modelMatrix*vec4(transformed,1.)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 snowPosition;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat snowGrain=fract(sin(dot(floor(snowPosition.xz*7.),vec2(127.1,311.7)))*43758.5453);float drift=sin(snowPosition.x*.22)*sin(snowPosition.z*.16);diffuseColor.rgb*=.90+.07*drift+.08*snowGrain;',
      );
  };
  for (const [key, snowKey] of [
    ['tree', 'treeSnow'],
    ['treeLight', 'treeLightSnow'],
  ]) {
    m[snowKey] = m[key].clone();
    m[snowKey].onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.66,.77,.72),.55);',
      );
    };
  }
  // Weathering is sampled in metres; painted finishes keep their selected colour.
  // Interior girders use m.steel; fascia (edge) girders may take their own finish (m.steelFascia).
  m.steelFascia = material('#64707a', 0.7, 0.5);
  for (const steel of [m.steel, m.steelFascia]) {
  steel.userData.weathered = { value: 0 };
  // 0.6.2: girders stand under the deck slab, which hides most of the sky. Without this occlusion they received
  // the full sky and environment light, so their shaded faces were nearly as bright as the sunlit ones and
  // saturated paints (red, green) looked vivid and flat. Indirect light is reduced under the deck (more on
  // upward faces, which only see the slab soffit); the sun keeps its own shadows.
  steel.userData.occlusion = { value: 0.5 };
  steel.onBeforeCompile = shader => {
    shader.uniforms.weathered = steel.userData.weathered;
    shader.uniforms.deckOcclusion = steel.userData.occlusion;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 steelPosition;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nsteelPosition=(modelMatrix*vec4(transformed,1.)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float weathered,deckOcclusion;varying vec3 steelPosition;
float steelHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float steelNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(steelHash(i),steelHash(i+vec3(1,0,0)),f.x),mix(steelHash(i+vec3(0,1,0)),steelHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(steelHash(i+vec3(0,0,1)),steelHash(i+vec3(1,0,1)),f.x),mix(steelHash(i+vec3(0,1,1)),steelHash(i+vec3(1,1,1)),f.x),f.y),f.z);}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float patina=steelNoise(steelPosition*vec3(2.,.42,2.));float rustGrain=steelNoise(steelPosition*35.);vec3 weathering=mix(vec3(.55,.40,.31),vec3(1.13,.94,.68),patina)*(.91+.18*rustGrain);diffuseColor.rgb*=mix(vec3(1.),weathering,weathered);
// Painted finishes in service: slightly chalked (less chroma), faint dust mottling, darker grime on the lower parts.
float painted=1.-weathered,dust=steelNoise(steelPosition*vec3(.7,2.4,.7));
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))),.14*painted);
diffuseColor.rgb*=mix(1.,.9+.12*dust,painted);`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
{
  float up=clamp(inverseTransformDirection(normal,viewMatrix).y,0.,1.);
  float occ=deckOcclusion*mix(1.,.6,up);
  reflectedLight.indirectDiffuse*=occ;
  reflectedLight.indirectSpecular*=mix(1.,occ,.7);
}`,
      );
  };
  }
  // River 0.6.0: planar reflection + Fresnel + sun glints + depth tint (see water.mjs).
  m.water = makeWaterMaterial();
  m.foam = new T.LineBasicMaterial({ color: '#d8f1df', transparent: true, opacity: 0.16 });
  if (typeof document !== 'undefined') {
    const waves = new T.TextureLoader().load('./textures/water-waves.webp', onLoad);
    waves.wrapS = waves.wrapT = T.RepeatWrapping;
    waves.anisotropy = 4;
    m.water.userData.water.waves.value = waves;
  }
  // Meadow 0.6.0: GPU wind, root-to-tip gradient and sun back-lighting (see grass.mjs).
  prepareGrassMaterial(m.grassBlade);
  // EZ-Tree bark and leaf cards (textures: ambientCG CC0 bark, EZ-Tree leaves, MIT).
  m.bark = material('#b9ab98', 0.95);
  m.leaves = {};
  m.leavesSnow = {};
  m.leavesFall = {};
  for (const [leaf, tint] of [
    ['oak', '#d5d5cd'],
    ['ash', '#ffffff'],
    ['aspen', '#ffffff'],
  ]) {
    // 0.6.3: the yellow aspen branch is recoloured green in summer and snow (see prepareLeafMaterial).
    const green = leaf === 'aspen';
    m.leaves[leaf] = prepareLeafMaterial(material(tint, 0.82), 'summer', { green });
    m.leavesSnow[leaf] = prepareLeafMaterial(material(tint, 0.82), 'snow', { green });
    m.leavesFall[leaf] = prepareLeafMaterial(material('#ffffff', 0.8), 'fall');
  }
  // Foliage clumps and understory shrubs (0.6.2): dense foliage cards, a touch darker than the twigs (inner crown).
  m.clumps = prepareLeafMaterial(material('#f2f7ea', 0.85));
  m.clumpsSnow = prepareLeafMaterial(material('#f2f7ea', 0.85), 'snow');
  m.clumpsFall = prepareLeafMaterial(material('#ffffff', 0.82), 'fall');
  if (typeof document !== 'undefined') {
    const loader = new T.TextureLoader(),
      load = (file, srgb = true) => {
        const t = loader.load(`./textures/${file}`, onLoad);
        if (srgb) t.colorSpace = T.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      };
    m.bark.map = load('bark-color.webp');
    m.bark.normalMap = load('bark-normal.webp', false);
    for (const t of [m.bark.map, m.bark.normalMap]) {
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(1, 0.1);
    }
    for (const leaf of Object.keys(m.leaves))
      m.leaves[leaf].map = m.leavesSnow[leaf].map = m.leavesFall[leaf].map = load(`leaf-${leaf}.webp`);
    m.clumps.map = m.clumpsSnow.map = m.clumpsFall.map = load('foliage-v2.webp');
  }
  // Pier water marks: a darker wet band and faint algae just above the river level, only on concrete inside the
  // river corridor (piers, not abutments far from the water). Set per scene by buildBridge.
  m.concrete.userData.stain = {
    level: { value: -1e4 },
    centre: { value: new T.Vector2() },
    along: { value: new T.Vector2(1, 0) },
    half: { value: 0 },
  };
  {
    const stain = m.concrete.userData.stain;
    m.concrete.customProgramCacheKey = () => 'bridgesketch-concrete-060';
    m.edge.customProgramCacheKey = () => 'bridgesketch-edge-060';
    m.concrete.onBeforeCompile = shader => {
      shader.uniforms.stainLevel = stain.level;
      shader.uniforms.stainCentre = stain.centre;
      shader.uniforms.stainAlong = stain.along;
      shader.uniforms.stainHalf = stain.half;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 stainWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nstainWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 stainWorld;uniform float stainLevel,stainHalf;uniform vec2 stainCentre,stainAlong;
float stainHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float stainNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(stainHash(i),stainHash(i+vec2(1,0)),f.x),mix(stainHash(i+vec2(0,1)),stainHash(i+vec2(1,1)),f.x),f.y);}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if(stainLevel>-1e3){
  vec2 rel=stainWorld.xz-stainCentre;
  float inside=1.-smoothstep(stainHalf,stainHalf+5.,abs(dot(rel,vec2(-stainAlong.y,stainAlong.x))));
  float h=stainWorld.y-stainLevel,ring=dot(stainWorld.xz,vec2(.71,.7));
  float top=.35+.55*stainNoise(vec2(ring*2.7,1.3))+.3*stainNoise(vec2(ring*11.,4.));
  float wet=smoothstep(-.6,-.05,h)*(1.-smoothstep(top-.25,top,h));
  float streak=smoothstep(.55,.9,stainNoise(vec2(ring*14.,.5)))*(1.-smoothstep(0.,1.8,h))*step(0.,h);
  float algae=(1.-smoothstep(.0,.3,h))*smoothstep(-.5,-.1,h);
  vec3 c=diffuseColor.rgb;
  c*=mix(1.,.66+.1*stainNoise(stainWorld.xz*4.+stainWorld.y),max(wet,streak*.6)*inside);
  c=mix(c,c*vec3(.72,.86,.6),algae*inside*.8);
  diffuseColor.rgb=c;
}`,
        );
    };
  }
  for (const mat of [m.concrete, m.edge]) mat.userData.originalColor = mat.color.clone();
  // Every lit material receives the moving cloud shadow uniforms.
  for (const value of Object.values(m))
    if (value?.isMaterial) withClouds(value);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) if (v?.isMaterial) withClouds(v);
  return m;
}
