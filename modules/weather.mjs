// BridgeSketch 3D · Weather: light rain, light snow or falling autumn leaves, each one GPU-animated draw call around the camera.
// Particles wrap inside a 90 × 40 × 90 m box that follows the camera, so the cost is fixed.
import * as T from 'three';

const BOX = new T.Vector3(90, 40, 90);

export function makeWeather() {
  const uniforms = {
    time: { value: 0 },
    centre: { value: new T.Vector3() },
    box: { value: BOX },
    wind: { value: new T.Vector2(1.2, 0.6) },
    tint: { value: new T.Color('#c8d2dc') },
    opacity: { value: 0.5 },
  };
  // Rain: 6000 short streaks (two vertices each, falling at 9 m/s, 0.45 m long).
  const rainCount = 9000,
    rainSeed = new Float32Array(rainCount * 2 * 3),
    rainEnd = new Float32Array(rainCount * 2);
  for (let i = 0; i < rainCount; i++) {
    const s = [Math.random(), Math.random(), Math.random()];
    rainSeed.set(s, i * 6);
    rainSeed.set(s, i * 6 + 3);
    rainEnd[i * 2 + 1] = 1;
  }
  const rainGeometry = new T.BufferGeometry();
  rainGeometry.setAttribute('position', new T.Float32BufferAttribute(rainSeed, 3));
  rainGeometry.setAttribute('streak', new T.Float32BufferAttribute(rainEnd, 1));
  const common = `uniform float time;uniform vec3 centre,box;uniform vec2 wind;
vec3 wrap(vec3 seed,float fall,float sway){
  vec3 p=seed*box;
  p.y=mod(p.y-time*fall,box.y);
  p.xz+=wind*(box.y-p.y)/fall*.6+sway*vec2(sin(time*.9+seed.x*40.),cos(time*.7+seed.z*40.));
  vec3 origin=centre-box*.5;
  p.xz=origin.xz+mod(p.xz-origin.xz+box.xz*1000.,box.xz);
  p.y+=centre.y-box.y*.35;
  return p;
}`;
  const rain = new T.LineSegments(
    rainGeometry,
    new T.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `${common}
attribute float streak;
void main(){
  vec3 p=wrap(position,9.,0.);
  p-=vec3(wind.x,-9.,wind.y)*.05*streak;
  gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
}`,
      fragmentShader: `uniform vec3 tint;uniform float opacity;void main(){gl_FragColor=vec4(tint,opacity*.55);}`,
    }),
  );
  // Snow: 5000 soft flakes falling at 1.1 m/s with a gentle sway.
  const snowCount = 5000,
    snowSeed = new Float32Array(snowCount * 3);
  for (let i = 0; i < snowSeed.length; i++) snowSeed[i] = Math.random();
  const snowGeometry = new T.BufferGeometry();
  snowGeometry.setAttribute('position', new T.Float32BufferAttribute(snowSeed, 3));
  const snow = new T.Points(
    snowGeometry,
    new T.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `${common}
void main(){
  vec3 p=wrap(position,1.1,.8);
  vec4 view=viewMatrix*vec4(p,1.);
  gl_Position=projectionMatrix*view;
  gl_PointSize=clamp(180./-view.z,1.5,9.);
}`,
      fragmentShader: `uniform vec3 tint;uniform float opacity;
void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vec3(.96,.97,1.),opacity*smoothstep(.5,.1,d));}`,
    }),
  );
  // Falling leaves: 2200 tumbling autumn leaves drifting down at 0.9 m/s in a light breeze.
  const leafCount = 2200,
    leafSeed = new Float32Array(leafCount * 3),
    leafColour = new Float32Array(leafCount * 3),
    palette = [
      [0.95, 0.72, 0.16],
      [0.9, 0.5, 0.12],
      [0.83, 0.3, 0.1],
      [0.66, 0.17, 0.1],
      [0.78, 0.62, 0.22],
    ];
  for (let i = 0; i < leafCount; i++) {
    leafSeed.set([Math.random(), Math.random(), Math.random()], i * 3);
    leafColour.set(palette[Math.floor(Math.random() * palette.length)], i * 3);
  }
  const leafGeometry = new T.BufferGeometry();
  leafGeometry.setAttribute('position', new T.Float32BufferAttribute(leafSeed, 3));
  leafGeometry.setAttribute('leafColour', new T.Float32BufferAttribute(leafColour, 3));
  uniforms.light = { value: 1 };
  const leaves = new T.Points(
    leafGeometry,
    new T.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `${common}
attribute vec3 leafColour;varying vec3 vColour;varying float vSpin,vFlip;
void main(){
  vec3 p=wrap(position,.9,1.6);
  vec4 view=viewMatrix*vec4(p,1.);
  gl_Position=projectionMatrix*view;
  gl_PointSize=clamp(260./-view.z,1.5,14.);
  vColour=leafColour;
  vSpin=time*(1.5+2.5*position.x)+position.z*40.;
  vFlip=.35+.65*abs(sin(time*(1.1+position.y*2.)+position.x*30.));
}`,
      fragmentShader: `uniform float opacity,light;varying vec3 vColour;varying float vSpin,vFlip;
void main(){
  vec2 q=gl_PointCoord-.5;float c=cos(vSpin),s=sin(vSpin);q=mat2(c,-s,s,c)*q;q.x/=vFlip;
  // Pointed leaf outline with a midrib.
  float d=length(vec2(q.x*1.9,q.y))+abs(q.x)*.9;if(d>.48)discard;
  float rib=1.-smoothstep(.0,.03,abs(q.x))*.25;
  gl_FragColor=vec4(vColour*light*rib*(.75+.25*vFlip),opacity*smoothstep(.48,.38,d));
}`,
    }),
  );
  for (const o of [rain, snow, leaves]) {
    o.frustumCulled = false;
    o.visible = false;
    o.renderOrder = 5;
  }
  rain.name = 'Rain';
  snow.name = 'Snow';
  leaves.name = 'Falling leaves';
  let mode = 'clear',
    // 0.6.5: off in the Plan and Elevation views. The box follows the camera, and an orthographic camera stands
    // hundreds of metres away, so the particles gathered in one odd square far from the bridge.
    hidden = false;
  const show = () => {
    rain.visible = !hidden && mode === 'rain';
    snow.visible = !hidden && mode === 'snow';
    leaves.visible = !hidden && mode === 'leaves';
  };
  return {
    objects: [rain, snow, leaves],
    get active() {
      return mode !== 'clear' && !hidden;
    },
    hide(on) {
      hidden = on;
      show();
    },
    set(next, daylight = 1) {
      mode = next;
      show();
      uniforms.opacity.value = mode === 'rain' ? 0.55 + 0.4 * daylight : mode === 'leaves' ? 1 : 0.9;
      uniforms.light.value = 0.25 + 0.75 * daylight;
    },
    animate(dt, camera) {
      uniforms.time.value += dt;
      uniforms.centre.value.copy(camera.position);
    },
    dispose() {
      rainGeometry.dispose();
      snowGeometry.dispose();
      leafGeometry.dispose();
      rain.material.dispose();
      snow.material.dispose();
      leaves.material.dispose();
    },
  };
}
