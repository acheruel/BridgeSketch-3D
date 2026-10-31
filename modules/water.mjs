import * as T from 'three';

// River water, 0.6.0.
// Techniques adapted from the reviewed references, without their multi-pass simulations:
// - three.js Reflector / Water: one planar reflection at reduced resolution with an oblique clip plane.
// - jeantimex/threejs-water (MIT): Fresnel-weighted sky/scene reflection, water body tint and sun glints.
// - 0.6.4, after Noniv/web-ocean (MIT): a two-phase flow map (faster mid-channel current),
//   the river bed seen through shallow water (Beer-Lambert) and glints that widen and dim with distance, the normal
//   detail filtered out at range coming back as roughness.
// The standard PBR material keeps fog, shadows, tone mapping and the GLB export path intact.

export function makeWaterMaterial() {
  const material = new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.06, metalness: 0 });
  const u = {
    flowTime: { value: 0 },
    waves: { value: null },
    reflection: { value: null },
    reflectionMatrix: { value: new T.Matrix4() },
    reflectionStrength: { value: 0 },
    rippleStrength: { value: 1 },
    distortion: { value: 0.03 },
    shallowColor: { value: new T.Color('#5d7a58') },
    deepColor: { value: new T.Color('#0d3440') },
    foamColor: { value: new T.Color('#e9efe6') },
    sunDirection: { value: new T.Vector3(0, 1, 0) },
    sunColor: { value: new T.Color('#ffffff') },
    glint: { value: 1 },
  };
  material.userData.flowTime = u.flowTime;
  material.userData.water = u;
  material.userData.sunGlow = { value: 0 };
  material.customProgramCacheKey = () => 'bridgesketch-river-064';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float waterDepth,shore;attribute vec2 flowDirection;
varying float vWaterDepth,vShore;varying vec3 vWaterWorld;varying vec2 vRiver;varying vec2 vFlow;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vWaterDepth=waterDepth;vShore=clamp(shore,-1.,1.);vRiver=uv;vFlow=flowDirection;vWaterWorld=(modelMatrix*vec4(transformed,1.)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float flowTime,reflectionStrength,rippleStrength,distortion,glint;uniform sampler2D waves,reflection;uniform mat4 reflectionMatrix;
uniform vec3 shallowColor,deepColor,foamColor,sunDirection,sunColor;
varying float vWaterDepth,vShore;varying vec3 vWaterWorld;varying vec2 vRiver;varying vec2 vFlow;
vec3 waterWorldNormal;float waterFade;
float waterHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float waterNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(waterHash(i),waterHash(i+vec2(1,0)),f.x),mix(waterHash(i+vec2(0,1)),waterHash(i+vec2(1,1)),f.x),f.y);}
vec2 waveSlope(vec2 p,float scale,vec2 drift){return texture2D(waves,p/scale+drift).xy*2.-1.;}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// Distance fade first: three.js reads the roughness before the normal map chunk.
waterFade=1./(1.+.015*length(vWaterWorld-cameraPosition));
float waterDepthMix=smoothstep(.02,1.25,vWaterDepth);
// Beer-Lambert: a muddy-green bed seen through the water column, fading into the body colour with depth.
vec3 bedTrans=exp(-vec3(.9,.32,.26)*3.6*vWaterDepth);
vec3 waterBody=mix(vec3(.11,.10,.06)*(.35+.65*dot(shallowColor,vec3(1.))),mix(shallowColor,deepColor,waterDepthMix),1.-bedTrans);
float shoreNoise=waterNoise(vRiver*vec2(.9,1.6)+vec2(-flowTime*.7,0.));
float foam=(1.-smoothstep(.01,.07+.05*shoreNoise,vWaterDepth))*smoothstep(.35,.8,shoreNoise);
diffuseColor.rgb=mix(waterBody*.55,foamColor,foam*.45);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor+.1*(1.-waterFade),.55,foam);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // Two-phase flow map: each phase scrolls at the local speed (faster mid-channel) and resets while the other shows.
  float cur=1.-.6*vShore*vShore,ph0=fract(flowTime*.12),ph1=fract(flowTime*.12+.5),wb=abs(1.-2.*ph0);
  vec2 p=vRiver,q0=p-vec2(ph0*cur*8.,0.),q1=p-vec2(ph1*cur*8.,0.)+vec2(.37,.71),flow=vec2(flowTime,0.);
  float fade=waterFade;
  vec2 s=mix(waveSlope(q0,17.,vec2(0.)),waveSlope(q1,17.,vec2(0.)),wb)*.6+waveSlope(vec2(p.y,-p.x)*.8-flow.yx*.3,36.,vec2(.71,.53))*.45+mix(waveSlope(q0*vec2(1.,1.25),6.5,vec2(.37,.11)),waveSlope(q1*vec2(1.,1.25),6.5,vec2(.37,.11)),wb)*.3*fade;
  s*=rippleStrength*fade*(1.-foam*.6);
  vec2 along=normalize(vFlow),across=vec2(-along.y,along.x);
  waterWorldNormal=normalize(vec3(0.,1.,0.)+vec3(along.x,0.,along.y)*s.x*.5+vec3(across.x,0.,across.y)*s.y*.5);
  normal=normalize((viewMatrix*vec4(waterWorldNormal,0.)).xyz);
}`,
      )
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
if(reflectionStrength>0.){
  vec4 rc=reflectionMatrix*vec4(vWaterWorld,1.);
  vec2 ruv=rc.xy/rc.w+waterWorldNormal.xz*distortion;
  vec3 planar=texture2D(reflection,clamp(ruv,.001,.999)).rgb;
  vec2 inside=smoothstep(vec2(0.),vec2(.035),ruv)*smoothstep(vec2(1.),vec2(.965),ruv);
  radiance=mix(radiance,planar,reflectionStrength*inside.x*inside.y);
}
radiance*=1.35;
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 V=normalize(cameraPosition-vWaterWorld);vec3 L=normalize(sunDirection);
  // Glints widen and dim with distance, as the filtered roughness grows.
  vec3 R=reflect(-L,waterWorldNormal);float rv=max(dot(R,V),0.),spark=pow(rv,mix(180.,1100.,waterFade))*mix(.45,1.5,waterFade)+pow(rv,60.)*.07;
  float scatter=pow(max(dot(V,-L)*.5+.5,0.),4.)*(1.-waterDepthMix*.5);
  totalEmissiveRadiance+=sunColor*(spark*glint*(1.-foam)+waterBody*scatter*.25*max(L.y,0.));
}`,
      );
  };
  return material;
}

// One reflection camera mirrored in a horizontal plane; the oblique near plane removes everything below the water.
export function createPlanarReflection() {
  const target = new T.WebGLRenderTarget(2, 2, { type: T.HalfFloatType, depthBuffer: true }),
    virtual = new T.PerspectiveCamera(),
    matrix = new T.Matrix4();
  target.texture.generateMipmaps = false;
  target.texture.minFilter = target.texture.magFilter = T.LinearFilter;
  const normal = new T.Vector3(0, 1, 0),
    plane = new T.Plane(),
    clip = new T.Vector4(),
    q = new T.Vector4(),
    view = new T.Vector3(),
    look = new T.Vector3(),
    point = new T.Vector3(),
    rotation = new T.Matrix4(),
    cameraPosition = new T.Vector3(),
    size = new T.Vector2();
  let scale = 0.5;
  return {
    texture: target.texture,
    matrix,
    setScale(value) {
      scale = value;
    },
    render(renderer, scene, camera, level, { hidden = [], shown = [] } = {}) {
      if (!camera.isPerspectiveCamera) return false;
      renderer.getDrawingBufferSize(size);
      const w = Math.max(2, Math.round(size.x * scale)),
        h = Math.max(2, Math.round(size.y * scale));
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      point.set(0, level, 0);
      cameraPosition.setFromMatrixPosition(camera.matrixWorld);
      if (cameraPosition.y <= level + 0.05) return false;
      view.copy(cameraPosition);
      view.y = 2 * level - view.y;
      rotation.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rotation).add(cameraPosition);
      look.y = 2 * level - look.y;
      virtual.position.copy(view);
      virtual.up.set(0, 1, 0).applyMatrix4(rotation);
      virtual.up.y *= -1;
      virtual.lookAt(look);
      virtual.near = camera.near;
      virtual.far = camera.far;
      virtual.updateMatrixWorld();
      virtual.projectionMatrix.copy(camera.projectionMatrix);
      virtual.layers.mask = camera.layers.mask;
      matrix
        .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
        .multiply(virtual.projectionMatrix)
        .multiply(virtual.matrixWorldInverse);
      plane.setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(virtual.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const p = virtual.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      p[2] = clip.x;
      p[6] = clip.y;
      p[10] = clip.z + 1 - 0.003;
      p[14] = clip.w;
      virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();
      const hiddenState = hidden.map(o => o.visible),
        shownState = shown.map(o => o.visible);
      hidden.forEach(o => (o.visible = false));
      shown.forEach(o => (o.visible = true));
      const previousTarget = renderer.getRenderTarget(),
        shadowUpdate = renderer.shadowMap.autoUpdate,
        xr = renderer.xr.enabled;
      renderer.shadowMap.autoUpdate = false;
      renderer.xr.enabled = false;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, virtual);
      renderer.setRenderTarget(previousTarget);
      renderer.shadowMap.autoUpdate = shadowUpdate;
      renderer.xr.enabled = xr;
      hidden.forEach((o, i) => (o.visible = hiddenState[i]));
      shown.forEach((o, i) => (o.visible = shownState[i]));
      return true;
    },
    dispose() {
      target.dispose();
    },
  };
}
