import * as T from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import {
  defaults,
  validate,
  totalLength,
  spacing,
  clearance,
  setClearance,
  encodeConfig,
  decodeConfig,
  depths,
  roadLayout,
  steelFinishes,
  fitBoxLayout,
  fitBoxLayoutFromBottom,
  profile,
  girderTop,
  girderDepth,
  supportStation,
  archSpanIndex,
  psboxLayout,
  crossAt,
  lowestCross,
  crossfallSection,
  stations,
  frame,
  TRUSS_DEPTH,
  trussAxis,
  trussChord,
  bearingPositions,
} from './geometry.mjs';
import { psboxParts } from './systems.mjs';
import { profileCsv, profileTable, frenchNumber } from './road-profile.mjs';
import { release } from './release.mjs';
import { presets, makePreset } from './presets.mjs';
import {
  makeMaterials,
  buildBridge,
  disposeModel,
  obstacleTour,
  animateTraffic,
  nebtSection,
  steelSection,
  boxSection,
  chamferSection,
  frameShadows,
} from './scene.mjs';
import { makeSky } from './sky.mjs';
import {
  CURB_HEIGHT,
  RAIL_311A,
  barrierHeight,
  barrierTopCentre,
  concreteBarrier,
  isConcrete,
  sidewalkProfile,
  sidewalkTop,
  wheelCurb,
} from './deck-profiles.mjs';
import { createPlanarReflection } from './water.mjs';
import { lightsOn } from './lighting.mjs';
import { makeWeather } from './weather.mjs';
import { makeAmbient } from './ambient.mjs';
import { setVehicleLights } from './vehicles.mjs';
import { grassUniforms } from './grass.mjs';
import { createPost } from './post.mjs';
import { cloudShadow, concreteFinishes } from './materials.mjs';
import { renderSettings, effectiveQuality, setGpuName, stepDownAuto, gpuInfo } from './quality.mjs';
import { createHistory } from './history.mjs';
import { createDemImport, saveOverlay, loadOverlay, clearOverlay } from './dem-ui.mjs';
import { siteSun, packetToScene } from './terrain-packet.mjs';
import { roadFootprints, intersectsRoad, setActiveDem, setTwinZone } from './terrain.mjs';
import { setGroundPartner } from './dem.mjs';
import { twinConfig, twinPlacement, twinToA, aToTwin } from './twin.mjs';
import { createTwinPanel } from './twin-ui.mjs';
import {
  isNum,
  numValue,
  setNum,
  numInput,
  setupNumericInputs,
  setupMenus,
  setupShortcuts,
  showDirty,
  showRestoreBar,
  hideRestoreBar,
  qbParse,
} from './ui.mjs';

// Golden hour: the sun about 7° above the horizon, 30 min before sunset.
const $ = id => document.getElementById(id),
  form = $('parameters');
let config = makePreset(presets[0].id),
  model,
  renderer,
  camera,
  perspectiveCamera,
  orthoCamera,
  controls,
  scene,
  materials,
  // 0.6.8: imported terrain (DTM / DSM from QuickerAtlas), a session overlay: { packet, placement, texture } or null.
  // Not part of the config, the share link or the saved .json; IndexedDB keeps it across reloads (dem-ui.mjs).
  demOverlay = null,
  twinPanel = null,
  sky,
  skyTime = 0,
  view = 'perspective',
  pendingCamera;
let messageTimer,
  driving = null,
  // Test hook (bridgeViewer.freeze): stop ambient animation so automated captures get a still frame.
  frozen = false;
let needsRender = true,
  flowTime = 0,
  lastTime = 0,
  frameMs = 0,
  reflection,
  weather,
  ambient,
  reflectionMs = 0,
  envDirty = true,
  envAt = 0;
// Frame budget (0.5.5): the sun's shadow map is redrawn only when something that casts a shadow changes
// (rebuild, time of day, every 2 s while the time flows, tree level-of-detail swaps at 2 Hz; moving vehicles
// cast no sun shadow since 0.6.2); ambient
// animation alone (water, clouds, wind, weather) renders at 30 fps; the reflection is refreshed every other
// frame while the camera is still.
let timeAppliedAt = 0,
  shadowDirty = true,
  shadowSoft = false,
  shadowFlow = false,
  shadowAt = 0,
  lastInteraction = 0,
  lastFrameAt = 0,
  frameCount = 0,
  cameraKey = '',
  bootAt = 0;
// Render budgets per tier (quality.mjs): reflection scale, shadow map, pixel ratio, level-of-detail distances.
const tier = () => renderSettings[effectiveQuality(config.renderQuality)];
let post = null;
// Every visible frame goes through the bloom chain unless the tier or the Glow option turns it off.
// 0.6.9: geographic north projected into the camera, independent of the bridge heading.
const northBadge = document.createElement('div');
northBadge.id = 'site-north';
northBadge.innerHTML = '<span>↑</span>North · artistic sun path';
northBadge.hidden = true;
const northVector = new T.Vector3();
const draw = () => {
  if (renderer && !northBadge.parentNode) renderer.domElement.parentNode.appendChild(northBadge);
  northBadge.hidden = !demOverlay;
  if (demOverlay) {
    const [x, z] = packetToScene({ ...demOverlay.placement, cx: 0, cy: 0 }, 0, 1);
    northVector.set(x, 0, z).transformDirection(camera.matrixWorldInverse);
    northBadge.firstElementChild.style.transform = `rotate(${Math.atan2(northVector.x, northVector.y)}rad)`;
  }
  post.render(scene, camera, { strength: config.bloom ? tier().bloom : 0 });
};
// Frame statistics for the Stats overlay and the Auto quality: loop rate, CPU time and GPU time (timer query).
const perf = { frames: 0, since: 0, fps: 0, cpu: 0, gpu: null, lowSince: null, query: null, ext: null };
function notify(message, error = false) {
  clearTimeout(messageTimer);
  $('feedback').replaceChildren(document.createTextNode(message));
  $('feedback').classList.toggle('error', error);
  $('feedback').hidden = false;
  // 0.6.7: errors also clear themselves (10 s), so a stale message never stays on screen.
  messageTimer = setTimeout(() => ($('feedback').hidden = true), error ? 10000 : 5000);
}
// Undo / redo / dirty tracking / autosave (history.mjs). Snapshots exclude the clock (time of day, time flow).
const hist = createHistory({
  read: () => config,
  apply: snapshot =>
    update({ ...snapshot, timeOfDay: config.timeOfDay, timeFlow: config.timeFlow }, { refresh: true, noHistory: true }),
  extra: () => ({ camera: camera && controls ? captureCamera() : undefined }),
  onState: ({ dirty, canUndo, canRedo }) => {
    for (const b of document.querySelectorAll('[data-action="undo"]')) b.disabled = !canUndo;
    for (const b of document.querySelectorAll('[data-action="redo"]')) b.disabled = !canRedo;
    showDirty(dirty, config?.name);
  },
  onDecline: hideRestoreBar,
  version: release.version,
});
async function stepHistory(dir) {
  if (!model) return;
  try {
    const done = await (dir < 0 ? hist.undo() : hist.redo());
    notify(done ? (dir < 0 ? 'Change undone.' : 'Change redone.') : dir < 0 ? 'Nothing to undo.' : 'Nothing to redo.');
  } catch (e) {
    notify(`${e.message} The last valid model remains visible.`, true);
  }
}
let activeSpan = 0;
function selectSpan() {
  activeSpan = Number($('activeSpan').value) || 0;
  [...$('spanRows').children].forEach((row, i) => (row.hidden = i !== activeSpan));
}
function initWorkspace() {
  for (const p of presets) {
    const option = new Option(p.label, p.id);
    option.title = p.description;
    $('preset').insertBefore(option, $('preset').lastElementChild);
  }
  $('release-version').textContent = release.name + ' · v' + release.version;
  $('release-date').textContent = release.date + ' · ' + release.author;
  $('about-release').textContent = 'Version ' + release.version + ' · ' + release.date;
  $('about-button').onclick = () => $('about').showModal();
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const activate = tab => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
  };
  tabs.forEach((tab, i) => {
    tab.onclick = () => activate(tab);
    tab.onkeydown = e => {
      const next =
        e.key === 'ArrowRight'
          ? (i + 1) % tabs.length
          : e.key === 'ArrowLeft'
            ? (i + tabs.length - 1) % tabs.length
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? tabs.length - 1
                : -1;
      if (next >= 0) {
        e.preventDefault();
        activate(tabs[next]);
        tabs[next].focus();
      }
    };
  });
  // 0.6.4: collapsible parameter panel (QuickerBridge); the choice is remembered in this browser.
  const collapsePanel = collapsed => {
    document.body.classList.toggle('panel-collapsed', collapsed);
    const label = collapsed ? 'Show the parameters panel' : 'Collapse the parameters panel';
    Object.assign($('panel-toggle'), { title: label });
    $('panel-toggle').setAttribute('aria-label', label);
    $('panel-toggle').setAttribute('aria-expanded', !collapsed);
    try {
      localStorage.setItem('bridgesketch-panel-collapsed', collapsed ? '1' : '0');
    } catch {}
  };
  try {
    if (localStorage.getItem('bridgesketch-panel-collapsed') === '1') collapsePanel(true);
  } catch {}
  $('panel-toggle').onclick = () => collapsePanel(!document.body.classList.contains('panel-collapsed'));
  $('focus').onclick = () => {
    const focus = document.body.classList.toggle('focus-mode');
    $('focus').setAttribute('aria-pressed', focus);
    $('focus').querySelector('span').textContent = focus ? 'Parameters' : 'Focus';
  };
  // 0.6.5: the view dock (QuickerAtlas « Couches »). 0.6.6: it stays open while views, weather and switches are
  // chosen (and while the scene is orbited); only its button or Escape closes it.
  const dock = $('dock'),
    dockOpen = open => {
      $('dock-panel').hidden = !open;
      $('dock-button').setAttribute('aria-expanded', open);
      dock.classList.toggle('open', open);
    };
  $('dock-button').onclick = () => dockOpen($('dock-panel').hidden);
  dock.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('dock-panel').hidden) {
      e.stopPropagation();
      dockOpen(false);
      $('dock-button').focus();
    }
  });
  // 0.6.6: weather buttons drive the (hidden) weather field of the parameters form.
  dock.querySelectorAll('[data-weather]').forEach(b =>
    b.addEventListener('click', () => {
      if (form.elements.weather.value === b.dataset.weather) return;
      form.elements.weather.value = b.dataset.weather;
      syncWeatherButtons();
      form.dispatchEvent(new Event('change'));
    }),
  );
  $('activeSpan').onchange = selectSpan;
  // Formula-capable numeric fields, File menu, keyboard shortcuts and the undo / redo buttons.
  setupNumericInputs(form, {
    onInvalid: (el, message) => {
      const label = el.closest('label')?.textContent.replace(/\s+/g, ' ').trim();
      notify(`${label ? label + ': ' : ''}${message}`, true);
    },
  });
  setupMenus();
  setupShortcuts({
    save: () => $('save').click(),
    open: () => $('load').click(),
    undo: () => stepHistory(-1),
    redo: () => stepHistory(1),
    ready: () => !!model,
  });
  document.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => stepHistory(b.dataset.action === 'redo' ? 1 : -1)));
  window.addEventListener('beforeunload', e => {
    if (hist.isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
function refreshForm() {
  const crossingOpen = [...$('spanRows').children].map(row => row.querySelector('details').open);
  // The generated crossing fields are rebuilt below: put the focus back on the one being edited.
  const active = document.activeElement,
    activeKey =
      active?.dataset?.span !== undefined && $('parameters').contains(active)
        ? `[data-span="${active.dataset.span}"][data-key="${active.dataset.key}"]`
        : null;
  $('archSpan').innerHTML =
    `<option value="-1">Longest span (${archSpanIndex({ ...config, archSpan: -1 }) + 1})</option>` +
    config.spans.map((span, i) => `<option value="${i}">Span ${i + 1} · ${span.length} m</option>`).join('');
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = config[el.name];
    else if (config[el.name] !== undefined) isNum(el) ? setNum(el, config[el.name]) : (el.value = config[el.name]);
  }
  setNum($('spanCount'), config.spans.length);
  $('nebt').value = config.depth;
  $('variantName').value = config.name ?? '';
  $('spanLengths').innerHTML = config.spans
    .map(
      (span, i) =>
        `<label>Span ${i + 1} · m${numInput({ span: i, key: 'length', min: 10, max: 150, step: 1, value: span.length })}</label>`,
    )
    .join('');
  activeSpan = Math.min(activeSpan, config.spans.length - 1);
  $('activeSpan').innerHTML = config.spans
    .map((span, i) => `<option value="${i}">Span ${i + 1} · ${span.length} m</option>`)
    .join('');
  $('activeSpan').value = activeSpan;
  $('spanRows').innerHTML = config.spans
    .map(
      (span, i) =>
        `<section class="span-row" ${i === activeSpan ? '' : 'hidden'}><h3>SPAN ${i + 1}</h3><label>Crossing<select data-span="${i}" data-key="obstacle">${['water', 'road', 'rail', 'land'].map(v => `<option value="${v}" ${span.obstacle === v ? 'selected' : ''}>${{ water: 'Water', road: 'Road', rail: 'Railway', land: 'Open ground · no crossing' }[v]}</option>`).join('')}</select></label><label>Vertical clearance · m${numInput({ span: i, key: 'clearance', min: '.3', max: 35, step: '.01', value: clearance(config, i).toFixed(2) })}</label><details ${crossingOpen[i] ? 'open' : ''}><summary>Crossing dimensions</summary><div class="field-grid">${[
          ['width', 'Width · m', 3, 60],
          ['elevation', 'Elevation · m', -5, 15],
          ['angle', 'Crossing angle · °', 35, 145],
        ]
          .map(
            ([key, label, min, max]) =>
              `<label>${label}${numInput({ span: i, key, min, max, step: 'any', value: span[key] })}</label>`,
          )
          .join('')}</div></details></section>`,
    )
    .join('');
  syncWaterFields();
  syncWeatherButtons();
  syncEnabled();
  if (activeKey) form.querySelector(activeKey)?.focus({ preventScroll: true });
}
function syncWeatherButtons() {
  for (const b of document.querySelectorAll('[data-weather]'))
    b.setAttribute('aria-pressed', b.dataset.weather === form.elements.weather.value);
}
function syncWaterFields() {
  config.spans.forEach((span, i) => {
    const row = $('spanRows').children[i];
    if (!row) return;
    row.querySelector('.river-hint')?.remove();
    setNum(row.querySelector('[data-key="clearance"]'), clearance(config, i).toFixed(2));
    setNum(row.querySelector('[data-key="elevation"]'), Number(span.elevation.toFixed(4)));
    const joined =
      span.obstacle === 'water' &&
      (config.spans[i - 1]?.obstacle === 'water' || config.spans[i + 1]?.obstacle === 'water');
    row.querySelector('[data-key="width"]').disabled =
      span.obstacle === 'water' &&
      config.spans[i - 1]?.obstacle === 'water' &&
      config.spans[i + 1]?.obstacle === 'water';
    if (joined) {
      const hint = document.createElement('p');
      hint.className = 'hint river-hint';
      hint.textContent =
        'Joined river: elevation and angle apply to all adjacent water spans. Edge-span widths set the banks.';
      row.querySelector('details').append(hint);
    }
  });
}
function syncEnabled() {
  const steel = config.material === 'steel' || config.material === 'box',
    box = config.material === 'box',
    psbox = config.material === 'psbox',
    slab = config.material === 'slab',
    system = config.structureSystem;
  $('arch-fields').hidden = system !== 'arch';
  $('cross-slope-label').hidden = !['left', 'right'].includes(config.crossfall);
  $('crown-offset-label').hidden = config.crossfall === 'flat';
  form.elements.crownOffset.min = String(-config.width / 2);
  form.elements.crownOffset.max = String(config.width / 2);
  form.elements.girderScreens.disabled = !['concrete', 'steel', 'box'].includes(config.material) || config.structureSystem === 'truss';
  form.elements.archRise.disabled = config.archType !== 'tied';
  $('strut-fields').hidden = system !== 'strutted';
  // 0.6.6: steel truss footbridges: the trusses replace the girders (always steel, two trusses, fixed depth).
  const truss = system === 'truss';
  $('truss-fields').hidden = !truss;
  form.elements.structureSystem.querySelector('[value="truss"]').disabled = config.trafficMode !== 'cyclists';
  form.elements.material.disabled = truss;
  form.elements.depth.disabled = truss;
  // Frames are monolithic concrete: solid slab or prestressed box only.
  for (const option of form.elements.material.options)
    option.disabled = (system === 'frame' || system === 'strutted') && !['slab', 'psbox'].includes(option.value);
  form.elements.continuous.disabled = psbox || system === 'frame' || system === 'strutted';
  $('nebt-label').hidden = steel || slab || psbox;
  $('steel-depth-label').hidden = !steel && !psbox;
  $('slab-depth-label').hidden = !slab;
  $('steel-color-controls').hidden = !steel;
  $('group-steel-finish').hidden = !steel;
  $('flange-note').hidden = !steel;
  $('box-bottom-width-label')?.toggleAttribute('hidden', !box);
  for (const name of ['girders', 'overhang'])
    form.elements[name].disabled = slab || psbox || truss || (box && name === 'overhang');
  // Precast NEBT girders have a constant depth: no variable-depth option.
  $('variable-depth-fields').hidden = config.material === 'concrete' || truss;
  form.elements.variableDepth.disabled = config.material === 'concrete';
  form.elements.pierDepth.disabled = !config.variableDepth;
  form.elements.taper.disabled = !config.variableDepth;
  form.elements.variableDepth.checked = config.variableDepth;
  form.elements.girders.step = '1';
  $('girder-count-label').hidden = box || slab || psbox;
  $('psbox-count-label').hidden = !psbox;
  $('box-count-label').hidden = !box;
  setNum($('boxCount'), config.girders);
  setNum(form.elements.girders, config.girders);
  form.elements.wingAngle.disabled = config.abutmentType !== 'wing';
  $('wing-angle-label').hidden = config.abutmentType !== 'wing';
  const columnPier = ['bent', 'portal'].includes(config.pierType),
    cappedPier = columnPier || config.pierType === 'vshape';
  $('group-columns').hidden = !columnPier;
  $('column-shape-label').hidden = !columnPier;
  $('column-size-label').textContent =
    config.columnShape === 'square'
      ? 'Column side · m'
      : config.columnShape === 'rectangular'
        ? 'Column width · m'
        : 'Column diameter · m';
  $('column-thickness-label').hidden = !columnPier || config.columnShape !== 'rectangular';
  $('column-spread-label').hidden = !columnPier || (config.pierType === 'bent' && config.columns < 2);
  form.elements.frontSlopeDrop.disabled = !config.frontSlope;
  form.elements.lightSpacing.disabled = form.elements.lightColor.disabled = form.elements.lightSides.disabled =
    config.lighting === 'none';
  form.elements.lighting.options[2].disabled = ![config.leftRailing, config.rightRailing].some(type => ['20C', 'SDC'].includes(type));
  form.elements.sidewalkWidth.disabled = config.sidewalkSide === 'none';
  form.elements.sidewalkRailing.disabled = config.sidewalkSide === 'none';
  $('median-width-label').hidden = config.medianType !== 'sidewalk';
  const paint = steelFinishes[config.steelColor] ?? config.steelColor;
  form.elements.steelColor.value = Object.hasOwn(steelFinishes, config.steelColor) ? config.steelColor : 'custom';
  $('steelPicker').value = paint;
  $('steelHex').value = paint.toUpperCase();
  $('steel-swatch').style.background = paint;
  const fascia = config.fasciaColor === 'same' ? paint : (steelFinishes[config.fasciaColor] ?? config.fasciaColor);
  form.elements.fasciaColor.value =
    config.fasciaColor === 'same' || Object.hasOwn(steelFinishes, config.fasciaColor) ? config.fasciaColor : 'custom';
  $('fasciaPicker').value = fascia;
  $('fasciaPicker').disabled = form.elements.fasciaColor.value !== 'custom';
  $('fascia-swatch').style.background = fascia;
  form.elements.columns.disabled = config.pierType !== 'bent';
  $('bent-settings').hidden = !cappedPier;
  form.elements.bentTaperStart.max = String(Math.max(0, config.width / 2 - 0.16));
  for (const name of ['frontSlope', 'frontSlopeDrop', 'frontSlopeMaterial', 'approachConeMaterial'])
    form.elements[name].disabled = config.approachWalls === 'mse';
  form.elements.movingTraffic.disabled = !config.showTraffic;
  form.elements.width.min = config.trafficMode === 'cyclists' ? '3' : '4';
  form.elements.laneWidth.min = config.trafficMode === 'cyclists' ? '1.5' : '2.5';
  form.elements.overhang.min = config.trafficMode === 'cyclists' ? '.3' : '.65';
  // Pedestrian bridges: no W-beam at the approaches, only nothing or a wheel curb with a 20C railing.
  const approachOptions = form.elements.approachBarrier.options,
    pedestrian = config.trafficMode === 'cyclists';
  approachOptions[0].disabled = approachOptions[0].hidden = pedestrian;
  approachOptions[1].textContent = pedestrian ? 'Wheel curb + 20C railing' : 'Continue the bridge railings';
  $('columns-label').hidden = config.pierType !== 'bent';
  $('column-diameter-label').hidden = !columnPier;
  $('wall-settings').hidden = config.pierType !== 'wall';
  $('hammerhead-settings').hidden = config.pierType !== 'hammerhead';
  $('portal-settings').hidden = config.pierType !== 'portal';
  $('vshape-settings').hidden = config.pierType !== 'vshape';
  $('hammerhead-flare-label').hidden = config.hammerheadShape !== 'flared';
  form.elements.vAngle.disabled = !config.vCap;
  $('continuity-note').textContent =
    system === 'frame'
      ? 'Rigid frame: deck built into every support, no bearings.'
      : system === 'strutted'
        ? 'Strutted frame: deck built into the inclined legs; bearings at the abutments only.'
        : psbox
          ? 'Cast-in-place box, continuous over the piers.'
          : slab
    ? config.continuous
      ? 'Continuous solid slab across supports.'
      : 'Solid slab spans with joints at supports.'
    : !config.continuous
      ? 'Separate girder spans with joints at piers.'
      : steel
        ? 'Unbroken girders and one bearing line at each pier.'
        : 'Precast spans joined with concrete closure diaphragms.';
  form.elements.material.options[0].disabled = config.curved || system === 'frame' || system === 'strutted';
  form.elements.radius.disabled = !config.curved;
  form.elements.direction.disabled = !config.curved;
  form.elements.rise.disabled = config.profile !== 'crest';
  form.elements.grade.disabled = config.profile !== 'constant';
  $('material-note').textContent = truss
    ? `Two steel ${config.trussType} trusses (${config.trussPattern}); the deck rests on floor beams between the bottom chords`
    : psbox
    ? `Prestressed concrete ${config.psboxCount > 1 ? config.psboxCount + ' single-cell boxes' : 'box · ' + (config.width > 16 ? 'two cells' : 'one cell')}, inclined webs, depth from the deck top`
    : slab
    ? config.variableDepth
      ? 'Solid concrete slab · variable depth'
      : 'Solid concrete slab · constant depth'
    : box
      ? 'Hollow box · webs incline 1H:4V'
      : steel
        ? 'Plate girder · depth includes both flanges'
        : config.variableDepth
          ? 'NEBT-shaped concrete concept · variable depth'
          : 'Metric NEBT family · 1200 / 810 mm flanges';
  const layout = roadLayout(config);
  $('shoulders').textContent =
    Math.abs(layout.leftShoulder - layout.rightShoulder) < 0.001
      ? layout.leftShoulder.toFixed(2) + ' m'
      : layout.leftShoulder.toFixed(2) + ' / ' + layout.rightShoulder.toFixed(2) + ' m';
  try {
    updateGroupMeta();
  } catch (e) {
    console.warn(e);
  }
}
// One-line value summaries shown on the folded parameter groups.
function updateGroupMeta() {
  const label = (name, value = config[name]) => {
      const option = [...(form.elements[name]?.options ?? [])].find(o => o.value === String(value));
      return option ? option.textContent.split(' · ')[0].trim() : String(value);
    },
    steelName = () => {
      const option = form.elements.steelColor?.selectedOptions[0];
      return option ? (option.textContent.split(' · ').filter(part => !part.startsWith('#')).pop() ?? '') : '';
    },
    c = config,
    count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`,
    kinds = ['water', 'road', 'rail', 'land']
      .map(k => [k, c.spans.filter(span => span.obstacle === k).length])
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${k === 'land' ? 'open' : k}`)
      .join(' · ');
  const meta = {
    'model-spans': `${count(c.spans.length, 'span')} · ${totalLength(c).toFixed(0)} m`,
    'model-align': c.curved ? `Curved · R ${c.radius} m` : 'Straight',
    'model-skew': `${c.skew}° · ${c.elevation} m`,
    'model-profile': c.profile === 'crest' ? `Crest ${c.rise} m` : `Grade ${c.grade} %`,
    'deck-road': `${c.width} m · ${c.laneCount === 0 ? 'no lane' : count(c.laneCount, 'lane')}${c.trafficMode === 'cyclists' ? ' · cycling' : ''}`,
    'deck-crossfall': label('crossfall'),
    'deck-median': label('medianType'),
    'deck-walk': c.sidewalkSide === 'none' ? 'None' : `${label('sidewalkSide')} · ${c.sidewalkWidth} m`,
    'deck-rail': `${c.leftRailing} / ${c.rightRailing}`,
    'deck-approach': label('approachBarrier'),
    'deck-light': c.lighting === 'none' ? 'Off' : `${label('lighting')} · ${c.lightSpacing} m`,
    'str-system': c.structureSystem === 'truss' ? `${label('trussType')} ${label('trussPattern')} truss` : label('structureSystem'),
    'str-type': label('material'),
    'str-dim': c.material === 'slab' ? `${c.slabDepth} m` : c.material === 'concrete' ? `NEBT ${Math.round(c.depth * 1000)}` : `${c.depth} m`,
    'str-depth': `${c.variableDepth ? 'Variable' : 'Constant'}${c.continuous ? ' · continuous' : ''}`,
    'str-conc': label('concreteFinish'),
    'str-steel': steelName(),
    'sup-type': label('pierType'),
    'sup-columns': `${c.pierType === 'bent' ? c.columns + ' × ' : ''}${label('columnShape').toLowerCase()}`,
    'sup-cap': `${c.bentWidth} × ${c.bentThickness} m`,
    'sup-wall': `${c.wallThickness} m`,
    'sup-portal': c.portalBeam ? 'With tie beam' : 'No tie beam',
    'sup-vshape': `${c.vAngle}° · ${c.vArmThickness} m`,
    'sup-hammerhead': `${c.hammerheadWidth} × ${c.hammerheadThickness} m`,
    'sup-abut': `${label('abutmentType')}${c.abutmentFinish === 'formliner' ? ' · formliner' : ''}${c.approachWalls === 'mse' ? ' · MSE' : ''}`,
    'sup-slope': c.approachWalls === 'mse' ? 'n/a' : c.frontSlope ? 'Slope on' : 'Slope off',
    'site-cross': kinds,
    'site-terrain': `${label('terrainShape')} · ${label('terrainMode')}`,
    'site-env': `${label('environment')} · seed ${c.seed}`,
    'site-river': label('waterStyle'),
    'site-sky': `${label('skyMode')} · ${label('skyModel')}`,
    'site-render': `${label('renderQuality')}${c.bloom ? ' · glow' : ''}`,
  };
  for (const el of document.querySelectorAll('[data-meta]')) el.textContent = meta[el.dataset.meta] ?? '';
}
// Numeric fields accept formulas: read the evaluated value, or keep the model's own when the text is invalid.
const numberOr = (el, fallback) => {
  const v = numValue(el);
  return Number.isNaN(v) ? fallback : v;
};
function readForm() {
  const raw = structuredClone(config);
  for (const el of form.elements) {
    if (!el.name) continue;
    raw[el.name] =
      el.type === 'checkbox'
        ? el.checked
        : isNum(el)
          ? numberOr(el, config[el.name])
          : el.name === 'direction' || el.name === 'archSpan'
            ? Number(el.value)
            : el.value;
  }
  if (raw.material === 'concrete' && !raw.curved) raw.depth = Number($('nebt').value) || 1.4;
  for (const el of form.querySelectorAll('[data-span]:not([data-key="clearance"])'))
    raw.spans[Number(el.dataset.span)][el.dataset.key] = isNum(el)
      ? numberOr(el, raw.spans[Number(el.dataset.span)][el.dataset.key])
      : el.value;
  return raw;
}
function applyTimeOfDay(hour, flowing = false) {
  if (!scene?.userData.lights) return;
  // Sun from 06:30 to 19:30 (autumn day). Daylight follows the sun elevation, so the evening only gets darker:
  // golden hour when the sun is low (about 18:30–19:30, peak 19:05), then blue hour, then night from 20:00.
  const solar = siteSun(hour, demOverlay?.placement),
    elevation = solar.elevation,
    daylight = T.MathUtils.smoothstep(elevation, -0.14, 0.22);
  const golden = Math.exp(-(((elevation - 0.1) / 0.12) ** 2)) * T.MathUtils.smoothstep(elevation, -0.13, 0);
  scene.userData.daylight = daylight;
  const tint = (night, day, gold) =>
    new T.Color(night).lerp(new T.Color(day), daylight).lerp(new T.Color(gold), golden);
  const { hemi, sun, fill, rim } = scene.userData.lights;
  sun.position.set(solar.x, solar.lightY, solar.z);
  // Flowing time moves the sun by a few hundredths of a degree per step: its shadows are refreshed every 2 s.
  if (flowing) shadowFlow = true;
  else shadowDirty = true;
  sun.color.copy(tint('#a9c7ed', '#fff3dd', '#ff9a68'));
  sun.intensity = 0.4 + 2.8 * daylight - 0.35 * golden;
  // No cast shadows at night: the residual "moonlight" key light fades its shadows out with the daylight
  // (a uniform: toggling castShadow would recompile every shader at dusk), and the shadow map is no
  // longer refreshed once they are gone (render loop).
  sun.shadow.intensity = T.MathUtils.smoothstep(daylight, 0.04, 0.3);
  hemi.color.copy(tint('#7186a8', '#e1efff', '#ffc98f'));
  hemi.groundColor.copy(tint('#283844', '#687560', '#3d2930'));
  hemi.intensity = 0.65 + 1.75 * daylight - 0.55 * golden;
  fill.color.copy(tint('#7293bf', '#c8ddfa', '#ffcfab'));
  fill.intensity = 0.3 + 0.95 * daylight - 0.4 * golden;
  rim.intensity = 0.15 + 0.55 * daylight + 0.15 * golden;
  sky?.update(daylight, golden, sun, new T.Vector3(solar.x, solar.skyY, solar.z));
  if (materials?.water) {
    const w = materials.water.userData.water,
      sunDirection = sun.position.clone().normalize();
    w.deepColor.value.copy(tint('#030c12', config.waterStyle === 'glossy' ? '#082a3a' : '#0a2e34', '#10262f'));
    w.shallowColor.value.copy(tint('#141c1a', '#3f5a44', '#4f4c36'));
    w.sunDirection.value.copy(sunDirection);
    w.sunColor.value.copy(sun.color).multiplyScalar(daylight * (1 + 1.4 * golden));
    w.glint.value = config.waterStyle === 'glossy' ? 1.4 : 1;
    materials.water.userData.sunGlow.value = golden;
    grassUniforms.sunDirection.value.copy(sunDirection);
    grassUniforms.sunColor.value.copy(sun.color).multiplyScalar(daylight);
    grassUniforms.backlight.value = 0.3 + 1.0 * golden;
  }
  // The sky shader is re-captured as image-based lighting (throttled in the render loop).
  envDirty = true;
  scene.environmentIntensity = 0.25 + 0.75 * daylight - 0.1 * golden;
  model?.lighting?.setOn(lightsOn(hour));
  // Rain and snow: overcast sky, softer key light, denser haze.
  const wet = config.weather === 'rain' || config.weather === 'snow';
  if (wet) {
    sun.intensity *= 0.4;
    fill.intensity *= 0.7;
    hemi.intensity *= 0.9;
  }
  sky?.uniforms && (sky.uniforms.overcast.value = wet ? 1 : 0);
  // Drifting cloud shadows with the dynamic sky, strongest in full daylight; soft under overcast skies.
  cloudShadow.strength.value =
    config.skyMode === 'clouds' || wet ? (wet ? 0.18 : 0.42) * daylight * (1 - 0.6 * golden) : 0;
  weather?.set(config.weather, daylight);
  // Ambient touches (0.6.0): birds by day, vehicle lamps after dusk, wet (glossier) road and concrete in rain.
  ambient?.set(daylight, golden, config.weather, scene.userData.birdCentre, config.birds !== false);
  setVehicleLights(1 - T.MathUtils.smoothstep(daylight, 0.08, 0.45));
  if (materials) {
    const rain = config.weather === 'rain';
    materials.asphalt.roughness = rain ? 0.72 : 0.9;
    materials.asphalt.metalness = 0;
    materials.asphalt.envMapIntensity = rain ? 0.8 : 1;
    materials.concrete.roughness = materials.edge.roughness = rain ? 0.62 : 0.88;
  }
  // Stylised atmospheric haze: cool by day, peach at golden hour, deep blue at night (option).
  const radius = scene.userData.radius ?? 120,
    hazeColor = tint('#141f33', '#b4c7d4', '#e2ae8a');
  scene.fog.color.copy(hazeColor);
  scene.fog.near = config.fog || wet ? radius * (wet ? 0.35 : 1.4 - 0.3 * golden) : 1e5;
  scene.fog.far = config.fog || wet ? radius * (wet ? 3.2 : 9 - 2.5 * golden - 2.5 * (1 - daylight)) : 2e5;
  if (wet) scene.fog.color.lerp(new T.Color(config.weather === 'snow' ? '#c9d2da' : '#7f8a94').multiplyScalar(0.25 + 0.75 * daylight), 0.7);
  if (sky) {
    sky.uniforms.fogColor.value.copy(scene.fog.color).convertLinearToSRGB();
    sky.uniforms.fogAmount.value = wet ? 0.8 : config.fog ? 0.4 + 0.25 * golden : 0;
  }
  renderer.toneMappingExposure = 0.9 + 0.28 * daylight - 0.13 * golden;
  $('viewport').style.setProperty('--night-factor', `${((1 - daylight) * 100).toFixed(1)}%`);
  $('timeOfDay').value = hour;
  // 0.6.5: whole minutes first, so 14:59.7 reads 15:00 rather than 14:60.
  const minutes = Math.round(hour * 60) % 1440;
  $('timeLabel').textContent =
    String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  needsRender = true;
}
// 0.6.7: uniform wheel zoom. Raw deltaY varies by mouse, driver and browser (lines vs pixels, 3 to 300 per notch,
// accelerated bursts when the frame rate drops), so each event is converted to pixels and capped at one notch:
// every mouse zooms 5 % per notch whatever the fps; touchpads keep their small, smooth deltas.
const WHEEL_NOTCH = 100;
function normalizedWheel(e) {
  let dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
  if (e.ctrlKey) dy *= 4; // touchpad pinch: tiny deltas, keep it responsive
  return { clientX: e.clientX, clientY: e.clientY, deltaY: Math.sign(dy) * Math.min(Math.abs(dy), WHEEL_NOTCH) };
}
// Section view zoom: wheel zooms about the pointer, drag pans, double-click resets (like the 3D views).
const sectionZoom = { k: 1, cx: null, cy: null, width: 800 };
function sectionViewBox() {
  const w = sectionZoom.width,
    h = 600,
    k = sectionZoom.k,
    cx = sectionZoom.cx ?? w / 2,
    cy = sectionZoom.cy ?? h / 2;
  return `${cx - w / (2 * k)} ${cy - h / (2 * k)} ${w / k} ${h / k}`;
}
function setupSectionZoom() {
  const svg = $('sectionSvg'),
    toSvg = e => {
      const r = svg.getBoundingClientRect(),
        [x, y, w, h] = sectionViewBox().split(' ').map(Number),
        scale = Math.max(w / r.width, h / r.height);
      return [x + w / 2 + (e.clientX - r.left - r.width / 2) * scale, y + h / 2 + (e.clientY - r.top - r.height / 2) * scale, scale];
    };
  svg.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const [px, py] = toSvg(e),
        k = Math.min(20, Math.max(1, sectionZoom.k * Math.exp(-e.deltaY * 0.0015))),
        cx = sectionZoom.cx ?? sectionZoom.width / 2,
        cy = sectionZoom.cy ?? 300,
        f = sectionZoom.k / k;
      Object.assign(sectionZoom, { k, cx: px + (cx - px) * f, cy: py + (cy - py) * f });
      if (k === 1) Object.assign(sectionZoom, { cx: null, cy: null });
      svg.setAttribute('viewBox', sectionViewBox());
    },
    { passive: false },
  );
  let drag = null;
  svg.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, cx: sectionZoom.cx ?? sectionZoom.width / 2, cy: sectionZoom.cy ?? 300 };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const scale = toSvg(e)[2];
    Object.assign(sectionZoom, { cx: drag.cx - (e.clientX - drag.x) * scale, cy: drag.cy - (e.clientY - drag.y) * scale });
    svg.setAttribute('viewBox', sectionViewBox());
  });
  svg.addEventListener('pointerup', () => (drag = null));
  svg.addEventListener('dblclick', () => {
    Object.assign(sectionZoom, { k: 1, cx: null, cy: null });
    svg.setAttribute('viewBox', sectionViewBox());
  });
}
function renderSection() {
  const c = config,
    L = totalLength(c),
    slider = $('sectionStation');
  if (Number(slider.max) !== L) slider.value = L / 2;
  slider.max = L;
  const s = Math.min(L, Math.max(0, Number(slider.value) || L / 2));
  slider.value = s;
  $('sectionStationLabel').textContent = `${s.toFixed(2)} m`;
  const i = Math.min(
      c.spans.length - 1,
      c.spans.findIndex((_, j) => s <= c.spans.slice(0, j + 1).reduce((n, v) => n + v.length, 0)),
    ),
    road = roadLayout(c),
    half = c.width / 2;
  const actualDepth = girderDepth(c, s),
    depthAt = u => girderDepth(c, supportStation(c, s, u), u),
    top = c.material === 'slab' ? -0.065 : girderTop(c, i, s) - profile(c, s);
  const deepest = Math.max(
    actualDepth,
    ...Array.from({ length: c.material === 'slab' ? 9 : c.girders }, (_, g) =>
      depthAt(c.material === 'slab' ? -half + (c.width * g) / 8 : -half + c.overhang + g * spacing(c)),
    ),
  );
  const bottom = c.material === 'slab' ? -deepest - 0.065 : top - deepest;
  // Deck and slab follow crossfall; NEBT/I flanges stay level, boxes follow the slab.
  const xf = u => crossAt(c, u);
  const svg = $('sectionSvg'),
    svgWidth = Math.max(580, Math.min(1000, svg.clientWidth || 800));
  sectionZoom.width = svgWidth;
  svg.setAttribute('viewBox', sectionViewBox());
  // Drawing band 110–470 px leaves room for the heading, dimension chains and title block.
  const truss = c.structureSystem === 'truss',
    lo = Math.min(bottom + lowestCross(c) - 1.05, -2),
    hi = truss ? Math.max(2.75, c.trussHeight - 0.2) : 2.75,
    k = Math.min((svgWidth - 60) / (c.width + 2.4), 360 / (hi - lo)),
    cy = 290 + (k * (hi + lo)) / 2;
  const poly = (points, fill, stroke = '#344a50', sheared = true) =>
    `<polygon points="${(sheared ? crossfallSection(c, points) : points).map(([u, y]) => [u, sheared ? y + xf(u) : y].join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width=".018"/>`;
  const rectangle = (a, b, t, d, fill, sheared = true) =>
    poly(
      [
        [a, t],
        [b, t],
        [b, d],
        [a, d],
      ],
      fill,
      undefined,
      sheared,
    );
  // Concrete outlines carry the same 15 × 15 mm chamfers as the 3D model.
  const concrete = (points, fill) => poly(chamferSection(points), concreteFinishes[c.concreteFinish] ?? fill);
  let drawing = `<line x1="${-half - 1}" x2="${half + 1}" y1="0" y2="0" stroke="#849596" stroke-width=".018" stroke-dasharray=".12 .1"/>`;
  if (c.material === 'slab') {
    const us = Array.from({ length: 25 }, (_, j) => -half + (c.width * j) / 24);
    drawing += concrete(
      [...us.map(u => [u, -0.065]), ...[...us].reverse().map(u => [u, -0.065 - depthAt(u)])],
      '#a7a49a',
    );
  } else if (c.material === 'psbox') {
    for (const part of psboxParts(c, depthAt).parts) drawing += concrete(part, '#aba79a');
    drawing += concrete(
      [
        [-half, -0.065],
        [half, -0.065],
        [half, -0.065 - c.deck],
        [-half, -0.065 - c.deck],
      ],
      '#b9b6aa',
    );
  } else if (truss) {
    // 0.6.6: steel truss: floor beam under the slab between the bottom chords, the chords and a post in elevation
    // behind the cut; a through truss adds its top strut.
    // 0.6.8: the trusses stand outside the curbs; the slab stops at the deck edge, the floor beam runs to the chords.
    const tu = trussAxis(c),
      cw = trussChord(c),
      axis = -0.065 - c.deck - 0.05 - TRUSS_DEPTH + cw / 2,
      paint = steelFinishes[c.steelColor] ?? c.steelColor,
      inner = half;
    drawing += rectangle(-(tu - cw / 2), tu - cw / 2, -0.065 - c.deck, -0.065 - c.deck - 0.4, paint);
    for (const side of [-1, 1]) {
      const u = side * tu;
      drawing += rectangle(u - 0.09, u + 0.09, axis + c.trussHeight, axis, '#d8dcdc');
      for (const y of [axis, axis + c.trussHeight]) drawing += rectangle(u - cw / 2, u + cw / 2, y + cw / 2, y - cw / 2, paint);
    }
    if (c.trussType === 'through')
      drawing += rectangle(-tu, tu, axis + c.trussHeight + 0.125, axis + c.trussHeight - 0.125, paint);
    drawing += concrete(
      [
        [-inner, -0.065],
        [inner, -0.065],
        [inner, -0.065 - c.deck],
        [-inner, -0.065 - c.deck],
      ],
      '#b9b6aa',
    );
  } else {
    for (let g = 0; g < c.girders; g++) {
      const u = -half + c.overhang + g * spacing(c),
        girderDepthAt = depthAt(u),
        sections =
          c.material === 'concrete'
            ? [nebtSection(girderDepthAt)]
            : c.material === 'box'
              ? Object.values(boxSection(girderDepthAt, c.boxTopWidth, c.boxBottomWidth, 0.05, c.web))
              : [steelSection(c.depth, c.web).map(([x, y]) => [x, y < -0.05 ? y + c.depth - girderDepthAt : y])];
      const xg = xf(u),
        beamTop = girderTop(c, i, s, u) - profile(c, s);
      for (const section of sections)
        drawing += poly(
          section.map(([x, y]) => [x + u, y + beamTop + (c.material === 'box' ? xf(x + u) : xg)]),
          c.material === 'concrete'
            ? '#aba79a'
            : (() => {
                const finish = c.fasciaColor !== 'same' && (g === 0 || g === c.girders - 1) ? c.fasciaColor : c.steelColor;
                return steelFinishes[finish] ?? finish;
              })(),
          undefined,
          false,
        );
      if (c.material === 'steel' && c.girders > 1)
        for (const face of [-1, 1])
          if (face < 0 ? g > 0 : g < c.girders - 1)
            drawing += rectangle(
              u + face * 0.007,
              u + face * 0.207,
              beamTop - 0.05 + xg,
              beamTop - girderDepthAt + 0.05 + xg,
              'none',
              false,
            ).replace('stroke="#344a50"', 'stroke="#344a50" stroke-dasharray=".05 .04"');
      // Haunch over each top flange (NEBT: the full 1200 mm flange): level on the flange, sloped under the slab.
      for (const flange of c.material === 'box'
        ? [sections[0], sections[1]]
        : [
            [
              [c.material === 'concrete' ? -0.6 : -0.25, 0],
              [c.material === 'concrete' ? 0.6 : 0.25, 0],
            ],
          ]) {
        const a = u + flange[0][0],
          b = u + flange[1][0];
        drawing += poly(
          [
            [a, -0.065 - c.deck + xf(a)],
            [b, -0.065 - c.deck + xf(b)],
            [b, beamTop + (c.material === 'box' ? xf(b) : xg)],
            [a, beamTop + (c.material === 'box' ? xf(a) : xg)],
          ],
          '#c0bdb1',
          undefined,
          false,
        );
      }
    }
    drawing += concrete(
      [
        [-half, -0.065],
        [half, -0.065],
        [half, -0.065 - c.deck],
        [-half, -0.065 - c.deck],
      ],
      '#b9b6aa',
    );
  }
  // Asphalt covers the roadway only; sidewalks, curbs, barriers and medians stand on the slab.
  for (const [a, b] of road.medianWidth
    ? [
        [road.roadMin, road.medianMin],
        [road.medianMax, road.roadMax],
      ]
    : [[road.roadMin, road.roadMax]])
    drawing += rectangle(a, b, 0, -0.065, c.laneCount ? '#394247' : '#c4c0b5');
  // Sidewalks: 280 mm at the road-side face (35 mm in 280 mm batter), 1 % crossfall; vertical behind a 301.
  const walkFace = side => (side < 0 ? road.roadMin : road.roadMax) + (c.sidewalkRailing === '301' ? side * road.innerBarrier : 0),
    walkTop = (side, u) => sidewalkTop(0.065, walkFace(side), u);
  for (const [side, on] of [
    [-1, road.left],
    [1, road.right],
  ])
    if (on) drawing += concrete(sidewalkProfile(0.065, side * half, walkFace(side), side, c.sidewalkRailing !== '301'), '#c5c1b5');
  if (road.medianWidth)
    drawing +=
      c.medianType === 'barrier'
        ? concrete(
            [
              [-0.3, -0.065],
              [-0.3, 0.12],
              [-0.16, 0.42],
              [-0.12, 1.1],
              [0.12, 1.1],
              [0.16, 0.42],
              [0.3, 0.12],
              [0.3, -0.065],
            ].map(([x, y]) => [x + road.medianCentre, y]),
            '#a9a79d',
          )
        : concrete(
            [
              [road.medianMin, 0.2],
              [road.medianMax, 0.2],
              [road.medianMax, -0.065],
              [road.medianMin, -0.065],
            ],
            '#c5c1b5',
          );
  for (const u of road.laneEdges) drawing += rectangle(u - 0.04, u + 0.04, 0.012, 0.004, '#f5f2e7');
  const railing = (edge, side, type, raised = null) => {
    if (isConcrete(type)) {
      let result = concrete(concreteBarrier(type, edge, side, raised ?? -0.065), '#a9a79d');
      // Type 311A: steel tube rail on a post, 400 mm above the concrete.
      if (type === '311A') {
        const r = RAIL_311A,
          u = edge - side * barrierTopCentre(type),
          top = (raised ?? -0.065) + barrierHeight(type);
        result += rectangle(u - r.post / 2, u + r.post / 2, top + r.rise - r.depth, top, '#879597');
        result += rectangle(u - r.width / 2, u + r.width / 2, top + r.rise, top + r.rise - r.depth, '#879597');
      }
      return result;
    }
    // No wheel curb on a raised sidewalk: posts are anchored in the sidewalk.
    if (type === 'SDC') {
      const base = raised === null ? CURB_HEIGHT - 0.065 : raised,
        u0 = edge - side * 0.2,
        lean = Math.tan((12 * Math.PI) / 180),
        at = h => u0 + side * h * lean;
      let result = raised === null ? concrete(wheelCurb(edge, side, 0.065), '#b8b5aa') : '';
      result += poly(
        [
          [u0 - 0.1, base],
          [u0 + 0.1, base],
          [at(2.3) + 0.1, base + 2.3],
          [at(2.3) - 0.1, base + 2.3],
        ],
        '#d6dad8',
      );
      for (const [h, r] of [
        [2.3, 0.1],
        [1.1, 0.05],
        [0.14, 0.04],
      ])
        result += `<circle cx="${at(h)}" cy="${base + h + xf(at(h))}" r="${r}" fill="#d6dad8" stroke="#344a50" stroke-width=".018"/>`;
      return result;
    }
    const curb = raised === null ? CURB_HEIGHT - 0.065 : raised,
      u = edge - side * (raised === null ? 0.18 : 0.12),
      h = type === '210A' ? 0.87 : 1.4;
    let result = raised === null ? concrete(wheelCurb(edge, side, 0.065), '#b8b5aa') : '';
    result += rectangle(u - 0.045, u + 0.045, curb + h, curb, '#879597');
    for (const y of type === '20C' ? [0.08, 1.38] : type === '210C' ? [0.18, 0.51, 0.81, 1.38] : [0.18, 0.51, 0.81])
      result += rectangle(u - 0.075, u + 0.075, curb + y + 0.04, curb + y - 0.04, '#879597');
    return result;
  };
  drawing +=
    railing(-half, -1, c.leftRailing, road.left ? walkTop(-1, -half) : null) +
    railing(half, 1, c.rightRailing, road.right ? walkTop(1, half) : null);
  if (c.sidewalkRailing !== 'none')
    for (const [side, on] of [
      [-1, road.left],
      [1, road.right],
    ]) {
      if (!on) continue;
      const u = (side < 0 ? road.roadMin : road.roadMax) + side * road.innerBarrier;
      drawing += railing(u, side, c.sidewalkRailing, c.sidewalkRailing === '301' ? null : walkTop(side, u));
    }
  // Dimension chains in screen units so text stays legible at any scale.
  const X = u => svgWidth / 2 + k * u,
    Y = y => cy - k * y,
    fmt = v => v.toFixed(2);
  let dims = '';
  const chain = (points, y, extendTo) => {
    const us = [...new Set(points.map(u => Number(u.toFixed(4))))].sort((a, b) => a - b);
    dims += `<line x1="${X(us[0])}" x2="${X(us.at(-1))}" y1="${Y(y)}" y2="${Y(y)}" stroke="#557279" stroke-width="1"/>`;
    for (const u of us)
      dims += `<line x1="${X(u)}" x2="${X(u)}" y1="${Y(y) - 5}" y2="${extendTo === undefined ? Y(y) + 5 : Y(extendTo)}" stroke="#8aa1a7" stroke-width=".8"/><line x1="${X(u) - 4}" x2="${X(u) + 4}" y1="${Y(y) + 4}" y2="${Y(y) - 4}" stroke="#17374b" stroke-width="1.4"/>`;
    for (let j = 0; j < us.length - 1; j++) {
      const w = us[j + 1] - us[j],
        px = k * w;
      if (px < 18) continue;
      dims += `<text x="${(X(us[j]) + X(us[j + 1])) / 2}" y="${Y(y) - 6}" text-anchor="middle" font-size="${px < 34 ? 9.5 : 11.5}" fill="#17374b">${fmt(w)}</text>`;
    }
  };
  const deckMarks = [-half, half, road.roadMin, road.roadMax, ...road.laneEdges];
  if (road.left) deckMarks.push(-half + road.leftBarrierWidth, road.roadMin - road.innerBarrier);
  if (road.right) deckMarks.push(half - road.rightBarrierWidth, road.roadMax + road.innerBarrier);
  if (road.medianWidth) deckMarks.push(road.medianMin, road.medianMax);
  chain(deckMarks, 1.85);
  chain([-half, half], 2.45);
  if (c.material === 'psbox') chain([-half, half, ...psboxLayout(c).centres], bottom - 0.55, bottom - 0.1);
  else if (truss) chain([-half, half, ...bearingPositions(c)], bottom - 0.55, bottom - 0.1);
  else if (c.material !== 'slab' && c.girders > 1)
    chain([-half, half, ...Array.from({ length: c.girders }, (_, g) => -half + c.overhang + g * spacing(c))], bottom - 0.55, bottom - 0.1);
  // Structure depth at the section, beside the left edge.
  dims += `<line x1="${X(-half - 0.7)}" x2="${X(-half - 0.7)}" y1="${Y(0)}" y2="${Y(bottom)}" stroke="#557279"/><line x1="${X(-half - 0.7) - 4}" x2="${X(-half - 0.7) + 4}" y1="${Y(0) + 4}" y2="${Y(0) - 4}" stroke="#17374b" stroke-width="1.4"/><line x1="${X(-half - 0.7) - 4}" x2="${X(-half - 0.7) + 4}" y1="${Y(bottom) + 4}" y2="${Y(bottom) - 4}" stroke="#17374b" stroke-width="1.4"/><text transform="translate(${X(-half - 0.7) - 6} ${(Y(0) + Y(bottom)) / 2}) rotate(-90)" text-anchor="middle" font-size="11.5" fill="#17374b">${fmt(-bottom)}</text>`;
  // Crossfall arrows (pointing downhill) and the crown line.
  if (c.crossfall !== 'flat') {
    const pct = c.crossfall === 'crown' ? 2 : c.crossSlope,
      marks =
        c.crossfall === 'crown'
          ? [
              [(Math.max(-half, road.roadMin) + c.crownOffset) / 2, -1],
              [(Math.min(half, road.roadMax) + c.crownOffset) / 2, 1],
            ].filter(([u]) => Math.abs(u - c.crownOffset) > 0.6)
          : [[(road.roadMin + road.roadMax) / 2, c.crossfall === 'right' ? 1 : -1]];
    for (const [u, dir] of marks) {
      const ua = u - (dir * 26) / k,
        ub = u + (dir * 26) / k,
        ya = Y(0.42 + xf(ua)),
        yb = Y(0.42 + xf(ub));
      dims += `<line x1="${X(ua)}" x2="${X(ub)}" y1="${ya}" y2="${yb}" stroke="#17374b" stroke-width="1.2"/><path d="M${X(ub)} ${yb} l${-dir * 8} -4 l0 8 z" fill="#17374b"/><text x="${X(u)}" y="${Math.min(ya, yb) - 7}" text-anchor="middle" font-size="11.5" fill="#17374b">${pct.toFixed(1)} %</text>`;
    }
    dims += `<line x1="${X(c.crownOffset)}" x2="${X(c.crownOffset)}" y1="${Y(1.4)}" y2="${Y(bottom - 0.3)}" stroke="#b0412e" stroke-width=".9" stroke-dasharray="10 3 2 3"/><text x="${X(c.crownOffset) + 4}" y="${Y(1.4) + 10}" font-size="10.5" fill="#b0412e">Center line</text>`;
  }
  // Title block: variant, software version and date (0.6.4: no author name on the drawing).
  const sectionDate = new Date(),
    today = `${sectionDate.getFullYear()}-${String(sectionDate.getMonth() + 1).padStart(2, '0')}-${String(sectionDate.getDate()).padStart(2, '0')}`,
    bx = svgWidth - 300,
    escape = t => t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const titleBlock = `<g font-size="12" fill="#17374b"><rect x="${bx}" y="492" width="280" height="92" fill="#fff" stroke="#17374b" stroke-width="1.2"/><line x1="${bx}" x2="${bx + 280}" y1="518" y2="518" stroke="#17374b"/><line x1="${bx}" x2="${bx + 280}" y1="540" y2="540" stroke="#8aa1a7"/><line x1="${bx}" x2="${bx + 280}" y1="562" y2="562" stroke="#8aa1a7"/><text x="${bx + 10}" y="510" font-size="13" font-weight="600">${escape(c.name || 'Unnamed variant')}</text><text x="${bx + 10}" y="533">Transverse section · station ${s.toFixed(2)} m</text><text x="${bx + 10}" y="555">${escape(release.name)} v${release.version} · ${today}</text><text x="${bx + 10}" y="577">Dimensions in metres</text></g>`;
  svg.innerHTML = `<title>Transverse deck section at station ${s.toFixed(2)} metres</title><g transform="translate(${svgWidth / 2} ${cy}) scale(${k} ${-k})">${drawing}</g><text x="30" y="54" fill="#17374b" font-size="22" font-weight="600">TRANSVERSE DECK SECTION</text><text x="30" y="83" fill="#557279" font-size="15">Station ${s.toFixed(2)} m · Deck ${c.width.toFixed(2)} m · ${truss ? `Steel ${c.trussType} truss, ${c.trussHeight.toFixed(2)} m` : c.material === 'box' ? 'Steel box' : c.material === 'steel' ? 'Steel plate' : c.material === 'slab' ? 'Concrete slab' : c.material === 'psbox' ? 'Prestressed concrete box' : 'Concrete NEBT'} · Depth ${actualDepth.toFixed(2)} m</text><text x="30" y="575" fill="#557279" font-size="14">Looking toward bridge end · Left / right follow alignment</text>${dims}${titleBlock}`;
}
// 0.6.4: span lengths under the Elevation view, a dimension chain like the Section drawing. Supports are projected
// with the camera, so the chain follows pans and zooms; it sits below the lowest point of the structure.
let elevationKey = '';
function renderElevationDims() {
  // An SVG element has no hidden property: toggle the attribute.
  const svg = $('elevationDims'),
    shown = view === 'elevation' && !!model;
  svg.toggleAttribute('hidden', !shown);
  if (!shown) return void (elevationKey = '');
  const w = $('canvasHost').clientWidth,
    h = $('canvasHost').clientHeight,
    key = `${camera.projectionMatrix.elements.join()}${camera.matrixWorld.elements.join()}${w}x${h}`;
  if (key === elevationKey) return;
  elevationKey = key;
  const ss = stations(config),
    low = new T.Box3().setFromObject(model.structure).min.y,
    screen = (s, y) => {
      const f = frame(config, s),
        p = new T.Vector3(f.x, y, f.z).project(camera);
      return [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h];
    },
    xs = ss.map(s => screen(s, profile(config, s))[0]),
    bottom = Math.max(...ss.map(s => screen(s, low)[1])),
    y = Math.min(h - 150, bottom + 28),
    top = Math.min(...ss.map(s => screen(s, profile(config, s))[1])),
    tick = x => `<line class="tick" x1="${x - 4}" x2="${x + 4}" y1="${y + 4}" y2="${y - 4}"/>`;
  let out = `<line x1="${xs[0]}" x2="${xs.at(-1)}" y1="${y}" y2="${y}"/>`;
  for (const x of xs) out += `<line class="ext" x1="${x}" x2="${x}" y1="${Math.max(top, y - 40)}" y2="${y + 32}"/>${tick(x)}`;
  config.spans.forEach((span, i) => {
    if (Math.abs(xs[i + 1] - xs[i]) > 26)
      out += `<text x="${(xs[i] + xs[i + 1]) / 2}" y="${y - 6}">${span.length.toFixed(2)}</text>`;
  });
  if (config.spans.length > 1) {
    const yt = y + 26;
    out += `<line x1="${xs[0]}" x2="${xs.at(-1)}" y1="${yt}" y2="${yt}"/>${[xs[0], xs.at(-1)].map(x => `<line class="tick" x1="${x - 4}" x2="${x + 4}" y1="${yt + 4}" y2="${yt - 4}"/>`).join('')}`;
    out += `<text class="total" x="${(xs[0] + xs.at(-1)) / 2}" y="${yt - 6}">${totalLength(config).toFixed(2)} m</text>`;
  }
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = out;
}
let updateQueue = Promise.resolve();
// 0.6.9: renderer.compileAsync, except that a material disposed while its shader compiles (an overlapping rebuild, e.g.
// right after a terrain import) is skipped instead of throwing « reading 'isReady' » from three.js's polling timer.
function compileScene() {
  const pending = renderer.compile(scene, camera),
    parallel = renderer.extensions.get('KHR_parallel_shader_compile') !== null;
  return new Promise(resolve => {
    const check = () => {
      pending.forEach(m => {
        const program = renderer.properties.get(m).currentProgram;
        if (!program || program.isReady()) pending.delete(m);
      });
      if (pending.size) setTimeout(check, 10);
      else resolve();
    };
    if (parallel) check();
    else setTimeout(check, 10);
  });
}
function update(raw, options = {}) {
  const next = validate(raw);
  // Parameter edits rebuild immediately; only a new model (boot, concept, link, file) shows the loading logo and
  // precompiles its shaders.
  if (!options.heavy && !options.resetCamera) {
    updateQueue = updateQueue.catch(() => {}).then(() => {
      rebuild(next, options);
      renderReflection();
    });
    return updateQueue;
  }
  updateQueue = updateQueue.catch(() => {}).then(async () => {
    const loading = $('scene-loading');
    loading.hidden = false;
    $('viewport').setAttribute('aria-busy', 'true');
    // Give the compositor a painted logo before synchronous geometry work starts.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      rebuild(next, options);
      await compileScene();
      renderReflection();
      draw();
    } finally {
      loading.hidden = true;
      $('viewport').setAttribute('aria-busy', 'false');
    }
  });
  return updateQueue;
}
// 0.6.9: bridge B (config.twin) on the imported site. B is built first, without a site of its own: its footprint then
// keeps A's imported roads, trees and grass off its deck and approaches, and both grounds carry both approach cuts.
function buildPair(next) {
  const t = next.twin,
    cB = t && demOverlay ? twinConfig(next) : null;
  setTwinZone(null);
  if (!cB) return buildBridge(next, materials, { dem: demOverlay });
  const demB = { packet: demOverlay.packet, placement: twinPlacement(demOverlay.placement, t) };
  setGroundPartner(next, { c: cB, dem: demB, to: (x, z) => aToTwin(t, x, z) });
  setGroundPartner(cB, { c: next, dem: demOverlay, to: (x, z) => twinToA(t, x, z) });
  let b = null, a;
  try {
    b = buildBridge(cB, materials, { site: false, lights: true, fills: true, dem: demB });
    const zones = roadFootprints(cB);
    setTwinZone((x, z, margin = 0) => {
      const [u, v] = aToTwin(t, x, z);
      return intersectsRoad(zones, u, v, margin);
    });
    a = buildBridge(next, materials, { dem: demOverlay });
  } catch (e) {
    if (b) disposeModel(b);
    setTwinZone(null);
    setActiveDem(demOverlay);
    throw e;
  }
  b.root.name = 'Bridge B';
  b.root.position.set(t.shift, 0, t.spacing);
  b.root.rotation.y = (-t.turn * Math.PI) / 180;
  a.root.add(b.root);
  a.vehicles.push(...b.vehicles);
  const la = a.lighting, lb = b.lighting;
  if (lb)
    a.lighting = la
      ? { ...la, setOn: on => (la.setOn(on), lb.setOn(on)), setHidden: h => (la.setHidden?.(h), lb.setHidden?.(h)), dispose: () => (la.dispose(), lb.dispose()) }
      : lb;
  a.twin = b;
  return a;
}
function rebuild(raw, { resetCamera = false, refresh = false, noHistory = false, editKey = null, baseline = false } = {}) {
  stopDriving();
  const next = validate(raw),
    started = performance.now(),
    replacement = buildPair(next);
  if (model) {
    scene.remove(model.root);
    disposeModel(model);
  }
  config = next;
  model = replacement;
  scene.add(model.root);
  applyReveal();
  model.setting.visible = view !== 'elevation';
  // The sky dome is the backdrop and the reflected sky; clouds are optional.
  sky.mesh.visible = true;
  sky.setClouds(config.skyMode === 'clouds' || config.weather === 'rain' || config.weather === 'snow');
  sky.setModel(config.skyModel);
  if (sky.seed !== config.seed) {
    sky.setSeed(config.seed);
    sky.seed = config.seed;
  }
  const glossy = config.waterStyle === 'glossy',
    w = materials.water.userData.water,
    q = tier();
  materials.water.roughness = glossy ? 0.035 : 0.07;
  w.rippleStrength.value = glossy ? 0.22 : 0.55;
  w.distortion.value = glossy ? 0.008 : 0.02;
  reflection.setScale(q.reflection);
  grassUniforms.grassNear.value = q.grassNear;
  grassUniforms.grassFar.value = q.grassFar;
  shadowDirty = true;
  perf.lowSince = null;
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
  const sun = scene.userData.lights.sun;
  if (sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  applyTimeOfDay(config.timeOfDay);
  if (refresh) refreshForm();
  else {
    syncEnabled();
    syncWaterFields();
  }
  twinPanel?.refresh();
  if (view === 'section') renderSection();
  const L = totalLength(config);
  $('length').innerHTML = `${L.toFixed(1)} <small>m</small>`;
  $('area').innerHTML = `${Math.round(L * config.width).toLocaleString()} <small>m²</small>`;
  $('spacing').textContent = `${config.material === 'slab' ? 'Not applicable' : spacing(config).toFixed(2) + ' m'}`;
  let triangles = 0;
  model.root.traverse(o => {
    if (o.isMesh)
      triangles +=
        ((o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  $('triangles').innerHTML = `${(triangles / 1000).toFixed(1)}<small>k tris</small>`;
  renderProfile();
  updateHeading();
  syncTimePlay();
  $('sceneSubtitle').textContent =
    `${config.spans.length} ${config.spans.length === 1 ? 'span' : 'spans'} · ${
      { frame: 'Rigid frame · ', strutted: 'Strutted frame · ', arch: config.archType === 'tied' ? 'Tied ' + config.archMaterial + ' arch · ' : config.archMaterial[0].toUpperCase() + config.archMaterial.slice(1) + ' deck arch · ' }[config.structureSystem] ?? ''
    }${config.material === 'slab' ? 'Solid concrete slab' : config.material === 'psbox' ? 'Prestressed box girder' : config.material === 'concrete' ? 'NEBT ' + config.depth * 1000 : config.material === 'box' ? 'Steel box girders' : config.structureSystem === 'truss' ? `Steel ${config.trussType} truss` : 'Steel plate girders'} · ${config.trafficMode === 'cyclists' ? 'cycling · ' : ''}${config.environment}`;
  if (resetCamera) fit(view);
  needsRender = true;
  const updateMs = performance.now() - started;
  $('preset').value = 'custom';
  scene.userData.radius = frameShadows(scene.userData.lights.sun, model);
  scene.userData.birdCentre = new T.Box3().setFromObject(model.structure).getCenter(new T.Vector3());
  applyTimeOfDay(config.timeOfDay);
  // Undo / redo steps and the dirty marker follow every successful rebuild (undo and redo apply their own snapshot).
  if (!noHistory) hist.track({ key: editKey, baseline });
  window.bridgeSketch = window.bridgeViewer = {
    getConfig: () => structuredClone(config),
    frames: () => frameCount,
    debug: () => ({ scene, sky, renderer, camera }),
    freeze: (on = true) => {
      frozen = on;
      needsRender = true;
    },
    update: raw => update(raw, { refresh: true }),
    sketchy: () => startGame(),
    // 0.6.8 test hooks for the imported terrain: place a packet without the dialog, read the state, remove it.
    importDem: (packet, placement) => importDem(packet, placement),
    removeDem: () => removeDem(),
    demState: () => (demOverlay ? { placement: { ...demOverlay.placement }, grid: demOverlay.packet.grid, zones: demOverlay.packet.zones.length } : null),
    get game() {
      return game;
    },
    getStats: () => ({
      triangles,
      updateMs,
      frameMs,
      reflectionMs,
      geometries: renderer.info.memory.geometries,
      drawCalls: renderer.info.render.calls,
      renderedTriangles: renderer.info.render.triangles,
      fps: perf.fps,
      gpuMs: perf.gpu,
      quality: effectiveQuality(config.renderQuality),
      gpu: gpuInfo(),
    }),
    setView: ({ position, target }) => {
      if (fly) {
        fly = null;
        controls.enabled = true;
      }
      stopDriving(false);
      controls.autoRotate = false;
      camera.position.fromArray(position);
      controls.target.fromArray(target);
      controls.update();
      needsRender = true;
    },
  };
}
// Reveal structure hides the deck, its haunches and the street lights standing on it.
function applyReveal() {
  if (!model) return;
  shadowDirty = true;
  const hide = $('reveal').checked && !driving;
  model.deck.visible = model.haunches.visible = !hide;
  // Only the poles, heads and glows are hidden: hiding the lamp PointLights would change the light count and
  // recompile every material (about 2 s on an integrated GPU) at each toggle.
  model.lighting?.setHidden(hide);
}
function syncTimePlay() {
  const on = config.timeFlow;
  $('timePlay').textContent = on ? '❚❚' : '▶';
  $('timePlay').setAttribute('aria-pressed', on);
  $('timePlay').title = on ? 'Stop the time (15 min every 10 s)' : 'Let the time run (15 min every 10 s)';
  needsRender = true;
}
function updateHeading() {
  $('sceneTitle').textContent =
    config.name ||
    (config.trafficMode === 'cyclists'
      ? 'Pedestrian bridge'
      : config.structureSystem === 'arch'
        ? 'Arch bridge'
        : config.structureSystem === 'frame'
          ? 'Rigid frame bridge'
          : config.structureSystem === 'strutted'
            ? 'Strutted frame bridge'
            : config.curved
        ? 'Curved viaduct'
        : config.spans.every(s => s.obstacle === 'water')
          ? 'River crossing'
          : 'Bridge crossing');
}
function fit(mode = 'perspective') {
  stopDriving(false);
  $('sectionHost').hidden = mode !== 'section';
  $('viewport').classList.toggle('section-view', mode === 'section');
  if (mode === 'section') {
    view = mode;
    controls.autoRotate = false;
    Object.assign(sectionZoom, { k: 1, cx: null, cy: null });
    renderSection();
    renderElevationDims();
    showView(mode);
    return;
  }
  model.setting.visible = mode !== 'elevation';
  shadowDirty = true;
  view = mode;
  camera = mode === 'perspective' ? perspectiveCamera : orthoCamera;
  weather.hide(mode !== 'perspective');
  controls.object = camera;
  controls.enableRotate = mode === 'perspective';
  camera.up.set(0, 1, 0);
  const bounds = new T.Box3().setFromObject(model.structure);
  if (mode !== 'elevation') bounds.union(new T.Box3().setFromObject(model.deck));
  const target = bounds.getCenter(new T.Vector3());
  const width = $('canvasHost').clientWidth,
    height = $('canvasHost').clientHeight,
    aspect = width / height;
  const direction =
    mode === 'plan'
      ? new T.Vector3(0, 1, 0.00001)
      : mode === 'elevation'
        ? new T.Vector3(0, 0, 1)
        : new T.Vector3(0.73, 0.55, 0.85).normalize();
  if (mode === 'plan') camera.up.set(0, 0, -1);
  camera.position.copy(target).add(direction);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
    up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
    // Room left by the overlays: since 0.6.5 only the view dock, in the top-right corner.
    compact = matchMedia('(max-width: 760px), (max-height: 500px) and (orientation: landscape)').matches,
    uiV = compact ? 52 : 64,
    uiH = 16,
    tanV = Math.tan((18 * Math.PI) / 180) * Math.max(0.4, (height - uiV) / height),
    tanH = (Math.tan((18 * Math.PI) / 180) * aspect * (width - uiH)) / width;
  let distance = 20,
    halfHeight = 5;
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const p = new T.Vector3(x, y, z).sub(target),
          px = Math.abs(p.dot(right)),
          py = Math.abs(p.dot(up)),
          depth = p.dot(direction);
        distance = Math.max(distance, depth + Math.max(px / tanH, py / tanV));
        halfHeight = Math.max(halfHeight, px / aspect / (1 - uiH / width), py / Math.max(0.4, (height - uiV) / height));
      }
  if (camera.isOrthographicCamera) {
    camera.top = halfHeight * 1.06;
    camera.bottom = -camera.top;
    camera.right = camera.top * aspect;
    camera.left = -camera.right;
    camera.zoom = 1;
  } else camera.aspect = aspect;
  camera.position.copy(target).addScaledVector(direction, distance * 1.06);
  controls.target.copy(target);
  camera.updateProjectionMatrix();
  controls.update();
  needsRender = true;
  showView(mode);
}
// Pressed view button and the dock label (0.6.5).
function showView(mode) {
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === mode));
  $('dock-view').textContent = { perspective: '3D', plan: 'Plan', elevation: 'Elevation', section: 'Section' }[mode];
}
function captureCamera() {
  return { position: camera.position.toArray(), target: controls.target.toArray(), view, zoom: camera.zoom };
}
function restoreCamera(saved) {
  if (!saved) return;
  if (
    !Array.isArray(saved.position) ||
    !Array.isArray(saved.target) ||
    saved.position.length !== 3 ||
    saved.target.length !== 3 ||
    ![...saved.position, ...saved.target].every(v => Number.isFinite(v) && Math.abs(v) < 10000)
  )
    return;
  fit(['plan', 'elevation', 'section'].includes(saved.view) ? saved.view : 'perspective');
  if (saved.view === 'section') return;
  if (new T.Vector3(...saved.position).distanceTo(new T.Vector3(...saved.target)) < 1) return;
  camera.position.fromArray(saved.position);
  controls.target.fromArray(saved.target);
  camera.zoom = Number.isFinite(saved.zoom) ? T.MathUtils.clamp(saved.zoom, 0.1, 20) : 1;
  camera.updateProjectionMatrix();
  controls.update();
  needsRender = true;
}
function stopDriving(restore = true) {
  if (!driving) return;
  const saved = driving.saved;
  driving = null;
  controls.enabled = true;
  controls.enableDamping = true;
  perspectiveCamera.fov = 36;
  perspectiveCamera.updateProjectionMatrix();
  const traffic = model.setting.children.find(o => o.name === 'Traffic');
  if (traffic) traffic.visible = true;
  applyReveal();
  $('drive').querySelector('span').textContent = 'Drive';
  $('drive').setAttribute('aria-pressed', 'false');
  $('drive-status').hidden = true;
  if (restore) restoreCamera(saved);
  needsRender = true;
}
function startDriving() {
  if (driving) {
    stopDriving();
    return;
  }
  const saved = captureCamera();
  fit('perspective');
  controls.autoRotate = false;
  controls.enabled = false;
  controls.enableDamping = false;
  perspectiveCamera.fov = 62;
  perspectiveCamera.updateProjectionMatrix();
  const route = obstacleTour(config);
  driving = { saved, route, station: -route.reach };
  const traffic = model.setting.children.find(o => o.name === 'Traffic');
  if (traffic) traffic.visible = false;
  applyReveal();
  $('drive').querySelector('span').textContent = 'Stop driving';
  $('drive').setAttribute('aria-pressed', 'true');
  $('drive-status').hidden = false;
  driveFrame(0);
}
function driveFrame(dt) {
  driving.station += (dt * 30) / 3.6;
  const s = driving.station,
    { route } = driving;
  if (s > route.reach) {
    stopDriving();
    return;
  }
  const pose = route.pose(s);
  camera.position.fromArray(pose.position);
  controls.target.fromArray(pose.target);
  camera.lookAt(controls.target);
  const label = { road: 'ROAD', water: 'RIVER', rail: 'RAILWAY', land: 'GROUND' }[route.type];
  $('drive-status').textContent =
    label +
    ' VIEW · SPAN ' +
    (route.index + 1) +
    ' · ' +
    Math.round(((s + route.reach) / (2 * route.reach)) * 100) +
    '% · Esc to stop';
  needsRender = true;
}
// Road profile (0.6.2): chainage / elevation table, exported as CSV. 0.6.3: moved from Model info to a File menu
// dialog, with plan coordinates X, Y from a reference point and bearing at the west axis. The settings are viewer
// preferences, remembered in this browser; the table is only built while the dialog is open.
const profileInputs = { step: 'profileStep', datum: 'profileDatum', x0: 'profileX', y0: 'profileY', bearing: 'profileBearing' },
  profileDefaults = { step: 5, datum: 30, x0: 0, y0: 0, bearing: 90 };
const profileField = key => {
  const el = $(profileInputs[key]),
    v = qbParse(el.value),
    ok = Number.isFinite(v) && (key !== 'step' || v > 0);
  el.setAttribute('aria-invalid', String(!ok));
  return ok ? v : profileDefaults[key];
};
const profileOptions = () => {
  const o = Object.fromEntries(Object.keys(profileInputs).map(k => [k, profileField(k)]));
  return { ...o, step: Math.max(0.5, o.step), bearing: ((o.bearing % 360) + 360) % 360 };
};
function renderProfile() {
  if (!config || !$('profile-dialog').open) return;
  const rows = profileTable(config, profileOptions());
  $('profileTable').tBodies[0].replaceChildren(
    ...rows.map(r => {
      const tr = document.createElement('tr');
      if (r.label) tr.className = 'axis';
      for (const text of [frenchNumber(r.chainage), frenchNumber(r.elevation), frenchNumber(r.x), frenchNumber(r.y), r.label || r.part]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }),
  );
}
try {
  const saved = JSON.parse(localStorage.getItem('bridgesketch-profile-v1') || '{}');
  for (const [key, id] of Object.entries(profileInputs)) if (saved[key]) $(id).value = saved[key];
} catch {}
for (const id of Object.values(profileInputs)) {
  $(id).addEventListener('change', () => {
    const options = profileOptions();
    for (const [key, el] of Object.entries(profileInputs))
      $(el).value = key === 'step' ? frenchNumber(options.step).replace(/,?0+$/, '') : frenchNumber(options[key]);
    try {
      localStorage.setItem(
        'bridgesketch-profile-v1',
        JSON.stringify(Object.fromEntries(Object.entries(profileInputs).map(([key, el]) => [key, $(el).value]))),
      );
    } catch {}
    renderProfile();
  });
  // Enter applies the value instead of submitting (closing) the dialog form.
  $(id).addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    $(id).dispatchEvent(new Event('change'));
  });
}
$('profile-menu').onclick = () => {
  $('profile-dialog').showModal();
  renderProfile();
};
$('exportProfile').onclick = () => {
  const options = profileOptions(),
    name = (config.name || 'bridge').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'bridge';
  download(new Blob([profileCsv(config, profileTable(config, options), options)], { type: 'text/csv;charset=utf-8' }), `${name}-road-profile.csv`);
  notify('Road profile exported (semicolon separator, decimal comma).');
};
function download(blob, name) {
  const a = document.createElement('a'),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// One mirrored pass at reduced resolution; the meadow and the water itself are left out of it.
function renderReflection() {
  const w = materials.water.userData.water;
  w.reflectionStrength.value = 0;
  if (!model.waters.length || !model.setting.visible || tier().reflection <= 0) return;
  const start = performance.now(),
    hidden = [
      ...model.waters,
      ...model.setting.children.filter(o => o.name === 'Meadow blades' || o.name === 'Meadow flowers'),
      ...weather.objects,
    ];
  const level = model.waters[0].userData.level;
  if (!reflection.render(renderer, scene, camera, level, { hidden, shown: [sky.mesh] })) return;
  w.reflection.value = reflection.texture;
  w.reflectionMatrix.value.copy(reflection.matrix);
  w.reflectionStrength.value = config.waterStyle === 'glossy' ? 1 : 0.9;
  reflectionMs = performance.now() - start;
}
async function boot() {
  renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  post = createPost(renderer);
  // Draw calls and triangles are counted for the whole frame: shadow, reflection and main passes.
  renderer.info.autoReset = false;
  renderer.shadowMap.autoUpdate = false;
  {
    const gl = renderer.getContext(),
      info = gl.getExtension('WEBGL_debug_renderer_info');
    setGpuName(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    perf.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart'])
    renderer.domElement.addEventListener(type, () => (lastInteraction = performance.now()), { passive: true });
  $('canvasHost').append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '3D bridge model. Use the view buttons for fixed camera views.');
  scene = new T.Scene();
  scene.fog = new T.Fog('#a9bfca', 300, 1500);
  const hemi = new T.HemisphereLight(0xdcefff, 0x9b9c87, 2.3);
  scene.add(hemi);
  scene.environmentIntensity = 0.7;
  sky = makeSky();
  sky.attach(renderer);
  scene.add(sky.mesh);
  reflection = createPlanarReflection();
  weather = makeWeather();
  scene.add(...weather.objects);
  ambient = makeAmbient();
  scene.add(ambient.mesh);
  const sun = new T.DirectionalLight(0xfff5e5, 3.0);
  sun.position.set(-45, 65, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  sun.shadow.camera.far = 250;
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.00015;
  scene.add(sun);
  const fill = new T.DirectionalLight(0xd4eaff, 1.15);
  fill.position.set(50, 35, -45);
  scene.add(fill);
  const rim = new T.DirectionalLight(0xffe9cb, 0.7);
  rim.position.set(55, 25, 50);
  scene.add(rim);
  scene.userData.lights = { hemi, sun, fill, rim };
  perspectiveCamera = new T.PerspectiveCamera(36, 1, 0.1, 5000);
  orthoCamera = new T.OrthographicCamera(-50, 50, 50, -50, 0.1, 5000);
  camera = perspectiveCamera;
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.minZoom = 0.05;
  controls.maxZoom = 50;
  controls.panSpeed = 1.8;
  controls.maxDistance = 2500;
  controls.maxPolarAngle = Math.PI * 0.5;
  controls._customWheelEvent = normalizedWheel;
  materials = makeMaterials(() => (needsRender = true));
  // 0.6.8: the imported terrain of the previous session comes back with the page (IndexedDB), if the user kept one.
  try {
    const saved = await loadOverlay();
    if (saved && ['cx', 'cy', 'azimuth', 'zOffset'].every(k => Number.isFinite(saved.placement?.[k]))) {
      demOverlay = { packet: saved.packet, placement: saved.placement, texture: await demTexture(saved.packet) };
      demImport.refreshButton();
      $('save-project').disabled = false;
    }
  } catch (e) {
    console.warn('Imported terrain not restored:', e);
  }
  if (location.hash) {
    try {
      const saved = decodeConfig(location.hash);
      config = saved.config;
      pendingCamera = saved.camera;
    } catch (e) {
      notify(e.message, true);
    }
  }
  const intro = window.bridgeIntro;
  intro?.progress(0.35, 'Growing the landscape\u2026');
  await new Promise(requestAnimationFrame);
  await update(config, { refresh: true, resetCamera: true });
  intro?.progress(0.62, 'Lighting the scene\u2026');
  await new Promise(requestAnimationFrame);
  // Capture the sky lighting and compile every shader before the first frame (in parallel where the driver
  // supports it), so the launch sequence does not stall on a long first render.
  scene.environment = sky.environment(renderer, config.skyMode === 'clouds');
  envDirty = false;
  intro?.progress(0.78, 'Compiling shaders\u2026');
  try {
    await compileScene();
  } catch (e) {
    console.warn(e);
  }
  bootAt = performance.now();
  if (!location.hash) {
    $('preset').value = presets[0].id;
    if (!config.name) $('sceneTitle').textContent = presets[0].label;
  }
  // 0.6.4: the welcome concept opens on its own camera (the launch fly-in then lands on it).
  restoreCamera(pendingCamera ?? (location.hash ? null : presets[0].camera));
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = $('canvasHost');
    renderer.setSize(w, h);
    perspectiveCamera.aspect = w / h;
    perspectiveCamera.updateProjectionMatrix();
    orthoCamera.right = (orthoCamera.top * w) / h;
    orthoCamera.left = -orthoCamera.right;
    orthoCamera.updateProjectionMatrix();
    if (view === 'section') renderSection();
    needsRender = true;
  };
  new ResizeObserver(resize).observe($('canvasHost'));
  resize();
  controls.addEventListener('change', () => (needsRender = true));
  $('timePlay').onclick = () => {
    config.timeFlow = !config.timeFlow;
    syncTimePlay();
  };
  $('timeOfDay').oninput = () => {
    config.timeOfDay = Number($('timeOfDay').value);
    applyTimeOfDay(config.timeOfDay);
  };
  $('sectionStation').oninput = renderSection;
  setupSectionZoom();
  controls.autoRotate = false;
  $('drive').onclick = startDriving;
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') stopDriving();
  });
  renderer.setAnimationLoop(time => {
    const dt = Math.min(0.05, (time - lastTime) / 1000),
      // Wall-clock step for the flowing time, so a slow computer does not slow the day down.
      clockDt = Math.min(0.5, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;
    if (document.hidden) return;
    if (frozen) {
      if (needsRender) {
        renderer.shadowMap.needsUpdate = true;
        renderReflection();
        draw();
        needsRender = false;
        frameCount++;
      }
      return;
    }
    if (fly) flyFrame(time);
    else if (driving) driveFrame(dt);
    else if (game) game.frame(dt);
    else controls.update(dt);
    const moving = config.movingTraffic && config.showTraffic;
    // Moving vehicles keep their contact shadows but cast no sun shadow, so the shadow map stays static
    // (it was redrawn about 11 times a second, the main cost of moving traffic on integrated GPUs).
    if (model.vehicleShadows !== !moving) {
      for (const v of model.vehicles)
        v.traverse(o => {
          if (!o.isMesh) return;
          o.userData.sunShadow ??= o.castShadow;
          o.castShadow = o.userData.sunShadow && !moving;
        });
      model.vehicleShadows = !moving;
      shadowDirty = true;
    }
    if (moving) animateTraffic(model, dt);
    const flowing = model.waters.length > 0;
    if (flowing) {
      flowTime += dt;
      materials.water.userData.flowTime.value = flowTime;
    }
    const cloudy = sky.mesh.visible && (config.skyMode === 'clouds' || config.weather === 'rain' || config.weather === 'snow');
    if (weather.active) weather.animate(dt, camera);
    if (ambient.mesh.visible && sky.mesh.visible) ambient.animate(time / 1000);
    if (cloudy) skyTime += dt;
    sky.animate(skyTime, camera);
    // Moving cloud shadows drift with the sky (materials.mjs); they follow the sun, not the shadow map.
    cloudShadow.time.value = skyTime;
    // Wind only moves the meadow while the scene is already animating, so a still view costs no frames.
    const animated = flowing || moving || controls.autoRotate || cloudy || weather.active || config.timeFlow;
    if (animated) grassUniforms.grassTime.value += dt;
    // Flowing time: 15 minutes every 10 s by day, three times faster at night; the lighting
    // is re-applied twice a second and the sky lighting re-captured every 1.5 s, so the cost stays small.
    if (config.timeFlow && !driving && view !== 'section') {
      const night = (scene.userData.daylight ?? 1) < 0.05;
      config.timeOfDay = (config.timeOfDay + clockDt * (night ? 0.075 : 0.025)) % 24;
      if (time - timeAppliedAt > 500) {
        applyTimeOfDay(config.timeOfDay, true);
        timeAppliedAt = time;
      }
    }
    if (envDirty && time - envAt > (config.timeFlow ? 4000 : 120)) {
      scene.environment = sky.environment(renderer, config.skyMode === 'clouds');
      envDirty = false;
      envAt = time;
      needsRender = true;
    }
    // Tree levels of detail follow the camera (re-sorted after 2 m of travel); a swap refreshes the shadows at 2 Hz.
    if (model.setting.userData.treeLod?.(camera.position)) shadowSoft = true;
    const key = camera.matrixWorld.elements.map(v => v.toFixed(3)).join(),
      cameraMoved = key !== cameraKey;
    cameraKey = key;
    const interactive = needsRender || fly || driving || game || controls.autoRotate || cameraMoved || time - lastInteraction < 1500;
    // Ambient-only animation is capped at 30 fps.
    const due = interactive || time - lastFrameAt >= 1000 / 30 - 2;
    if ((needsRender || animated) && due) {
      if (shadowSoft && time - shadowAt > 500) shadowDirty = true;
      if (shadowFlow && time - shadowAt > 2000) shadowDirty = true;
      if (shadowDirty && scene.userData.lights.sun.shadow.intensity > 0) {
        renderer.shadowMap.needsUpdate = true;
        shadowDirty = shadowSoft = shadowFlow = false;
        shadowAt = time;
      }
      const start = performance.now(),
        timing = $('perf-hud').hidden ? null : beginGpuTimer();
      renderer.info.reset();
      if (game ? frameCount % 3 === 0 : cameraMoved || frameCount % 2 === 0 || !reflection.texture) renderReflection();
      renderElevationDims();
      draw();
      timing?.end();
      frameMs = performance.now() - start;
      needsRender = false;
      lastFrameAt = time;
      frameCount++;
    }
    trackPerformance(time, animated || fly);
  });
  registerTools();
  // Offer the unsaved session of last time (a shared link always wins), otherwise start saving this one.
  const previous = location.hash ? null : hist.peek();
  if (previous)
    showRestoreBar(previous, {
      onRestore: async () => {
        try {
          await update(previous.config, { refresh: true, resetCamera: true, noHistory: true });
          restoreCamera(previous.camera);
          hist.accept(previous);
          notify('Previous session restored.');
        } catch (e) {
          hist.dismiss();
          notify(`${e.message} The stored session could not be restored.`, true);
        }
      },
      onDismiss: () => hist.dismiss(),
    });
  else hist.arm();
  // Launch sequence: leave the intro once the first frame is on screen, then settle the camera on the bridge.
  if (intro) {
    requestAnimationFrame(() => requestAnimationFrame(() => intro.ready()));
    intro.exited.then(() => {
      if (new URLSearchParams(location.search).has('sketchy')) startGame();
      else if (!pendingCamera && view === 'perspective' && !matchMedia('(prefers-reduced-motion: reduce)').matches) startFly();
    });
  } else if (new URLSearchParams(location.search).has('sketchy')) startGame();
}
// GPU time of one frame (EXT_disjoint_timer_query_webgl2), read back a few frames later without stalling.
function beginGpuTimer() {
  if (!perf.ext || perf.query) return null;
  const gl = renderer.getContext(),
    query = gl.createQuery();
  gl.beginQuery(perf.ext.TIME_ELAPSED_EXT, query);
  return {
    end() {
      gl.endQuery(perf.ext.TIME_ELAPSED_EXT);
      perf.query = query;
    },
  };
}
function readGpuTimer() {
  if (!perf.query) return;
  const gl = renderer.getContext();
  if (!gl.getQueryParameter(perf.query, gl.QUERY_RESULT_AVAILABLE)) return;
  if (!gl.getParameter(perf.ext.GPU_DISJOINT_EXT)) perf.gpu = gl.getQueryParameter(perf.query, gl.QUERY_RESULT) / 1e6;
  gl.deleteQuery(perf.query);
  perf.query = null;
}
// Loop rate while the scene animates: drives the Stats overlay and lets Auto step the quality down.
function trackPerformance(time, animating) {
  readGpuTimer();
  if (!animating) {
    if (time - perf.since > 1000 && !$('perf-hud').hidden)
      $('perf-hud').textContent = `Still view · last frame CPU ${frameMs.toFixed(1)} ms · ${renderer.info.render.calls} calls`;
    if (time - perf.since > 1000) perf.since = time;
    perf.frames = 0;
    perf.lowSince = null;
    return;
  }
  perf.frames++;
  if (time - perf.since < 1000) return;
  perf.fps = (perf.frames * 1000) / (time - perf.since);
  perf.cpu = frameMs;
  perf.since = time;
  perf.frames = 0;
  if (!$('perf-hud').hidden) {
    const q = effectiveQuality(config.renderQuality);
    $('perf-hud').textContent =
      `${Math.round(perf.fps)} fps · CPU ${perf.cpu.toFixed(1)} ms · GPU ${perf.gpu === null ? (perf.ext ? '…' : 'n/a') : perf.gpu.toFixed(1) + ' ms'}` +
      ` · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles / 1e6).toFixed(2)} M tris · ` +
      `${q[0].toUpperCase() + q.slice(1)}${config.renderQuality === 'auto' ? ' (auto)' : ''}`;
  }
  // Auto: below 24 fps for 4 s in a row (after the first 6 s) → one tier down, rebuilt once.
  if (config.renderQuality !== 'auto' || time - bootAt < 6000 || fly || game) return;
  if (perf.fps >= 24) perf.lowSince = null;
  else if (perf.lowSince === null) perf.lowSince = time;
  else if (time - perf.lowSince > 4000) {
    const next = stepDownAuto(effectiveQuality('auto'));
    perf.lowSince = null;
    if (!next) return;
    update(config, { refresh: true });
    notify(`Auto quality: ${Math.round(perf.fps)} fps measured, switched to ${next[0].toUpperCase() + next.slice(1)}.`);
  }
}
// 0.6.5: Sketchy's Bridge Hop, the secret Frogger-style game (modules/sketchy/, loaded on demand). The game drives the
// camera, Sketchy and its own deck traffic; the app keeps rendering the scene around it, in Balanced quality at most.
let game = null,
  gameSaved = null;
async function startGame() {
  if (game || gameSaved || !model) return;
  if ($('about').open) $('about').close();
  stopDriving(false);
  if (fly) {
    fly = null;
    controls.enabled = true;
  }
  gameSaved = { camera: captureCamera(), quality: config.renderQuality, preset: $('preset').value };
  document.body.classList.add('sketchy-game');
  try {
    if (effectiveQuality(config.renderQuality) === 'high')
      await update({ ...config, renderQuality: 'balanced' }, { heavy: true, noHistory: true });
    if (view !== 'perspective') fit('perspective');
    // 0.6.7: a stale cache right after a deploy can fail the dynamic import; retry once past the cache.
    const { startSketchy } = await import('./sketchy/game.mjs').catch(() => import(`./sketchy/game.mjs?v=${release.version}-${Date.now()}`));
    controls.enabled = false;
    perspectiveCamera.fov = 55;
    perspectiveCamera.far = 1600;
    perspectiveCamera.updateProjectionMatrix();
    game = startSketchy({
      scene,
      camera: perspectiveCamera,
      canvas: renderer.domElement,
      host: $('viewport'),
      config,
      model,
      materials,
      render: () => (needsRender = true),
      exit: stopGame,
    });
    // The deck vehicles left the scene: redraw the static sun shadows without them.
    shadowDirty = true;
  } catch (e) {
    notify(`The game could not start: ${e.message}`, true);
    await stopGame();
  }
}
async function stopGame() {
  if (!gameSaved) return;
  const saved = gameSaved;
  game?.dispose();
  game = null;
  document.body.classList.remove('sketchy-game');
  perspectiveCamera.fov = 36;
  perspectiveCamera.far = 5000;
  perspectiveCamera.updateProjectionMatrix();
  controls.enabled = true;
  shadowDirty = true;
  if (config.renderQuality !== saved.quality)
    await update({ ...config, renderQuality: saved.quality }, { heavy: true, noHistory: true });
  restoreCamera(saved.camera);
  $('preset').value = saved.preset;
  gameSaved = null;
  needsRender = true;
}
// Secret ways in: Sketchy in the About dialog, typing « sketchy » (or « frog »), or ?sketchy in the address.
let typed = '';
window.addEventListener('keydown', e => {
  if (game || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select')) return;
  typed = (typed + e.key.toLowerCase()).slice(-7);
  if (typed.endsWith('sketchy') || typed.endsWith('frog')) startGame();
});
$('sketchy-start').onclick = startGame;
// Camera fly-in after the intro: from a high, wide, rotated view down to the fitted view (1.8 s, ease-out).
let fly = null;
function startFly() {
  const to = camera.position.clone(),
    target = controls.target.clone(),
    offset = to.clone().sub(target),
    from = target.clone().add(offset.applyAxisAngle(new T.Vector3(0, 1, 0), -0.75).multiplyScalar(1.9)).add(new T.Vector3(0, offset.length() * 0.45, 0));
  fly = { from, to, target, start: null, rotate: controls.autoRotate };
  controls.autoRotate = false;
  controls.enabled = false;
}
function flyFrame(time) {
  fly.start ??= time;
  const t = Math.min(1, (time - fly.start) / 1800),
    k = 1 - (1 - t) ** 3;
  camera.position.lerpVectors(fly.from, fly.to, k);
  camera.lookAt(fly.target);
  needsRender = true;
  if (t >= 1) {
    controls.enabled = true;
    controls.autoRotate = fly.rotate;
    controls.update();
    fly = null;
  }
}
form.addEventListener('submit', e => e.preventDefault());
// Fields of the parameters form that live in the view dock (form="parameters") do not bubble to the form.
$('dock-panel').addEventListener('change', e => {
  if (['showTraffic', 'movingTraffic', 'birds'].includes(e.target.name)) form.dispatchEvent(new Event('change'));
});
form.addEventListener('change', async e => {
  if (e.target.id === 'activeSpan') return;
  // Typed fields coalesce into one undo step when they are edited again within 800 ms.
  const editKey = isNum(e.target) ? (e.target.name || e.target.id || `${e.target.dataset.span}:${e.target.dataset.key}`) : null;
  try {
    if (e.target.id === 'spanCount') {
      const count = numValue(e.target);
      if (!Number.isInteger(count) || count < 1 || count > 8) throw Error('Use 1 to 8 spans.');
      const raw = readForm();
      raw.spans = Array.from({ length: count }, (_, i) => raw.spans[i] ?? { ...raw.spans.at(-1) });
      await update(raw, { refresh: true, resetCamera: true, editKey });
    } else {
      const raw = readForm();
      if (raw.curved && raw.material === 'concrete') raw.material = 'steel';
      if (e.target.name === 'trafficMode') {
        if (raw.trafficMode === 'cyclists') {
          raw.laneCount = 1;
          raw.laneWidth = 1.8;
          raw.medianType = 'none';
          raw.sidewalkSide = 'none';
          raw.sidewalkRailing = 'none';
          raw.approachBarrier = 'extend';
          if ([raw.leftRailing, raw.rightRailing].some(type => ['20C', 'SDC'].includes(type))) raw.lighting = raw.lighting === 'none' ? 'none' : 'handrail';
        } else {
          raw.approachBarrier = 'guardrail';
          raw.width = Math.max(raw.width, 8);
          raw.laneCount = Math.max(2, raw.laneCount);
          raw.laneWidth = 3.5;
          raw.overhang = Math.max(0.65, raw.overhang);
        }
      }
      if (e.target.name === 'width' && raw.trafficMode === 'cyclists' && raw.width <= 6 && raw.material !== 'box')
        raw.overhang = Math.min(raw.overhang, Math.max(0.3, (raw.width - 1.95) / 2));
      // Default spacing per lighting type: 30 m street lights, 3 m handrail LEDs.
      if (e.target.name === 'lighting') raw.lightSpacing = raw.lighting === 'handrail' ? 3 : 30;
      if (e.target.id === 'steelPicker') raw.steelColor = $('steelPicker').value;
      if (e.target.id === 'steelHex') raw.steelColor = $('steelHex').value.trim();
      if (e.target.name === 'steelColor' && raw.steelColor === 'custom') raw.steelColor = $('steelPicker').value;
      if (e.target.name === 'fasciaColor' && raw.fasciaColor === 'custom') raw.fasciaColor = $('fasciaPicker').value;
      if (e.target.id === 'fasciaPicker') raw.fasciaColor = $('fasciaPicker').value;
      if (e.target.dataset.span !== undefined) {
        const index = Number(e.target.dataset.span),
          key = e.target.dataset.key;
        if (key === 'clearance') setClearance(raw, index, numValue(e.target));
        if (raw.spans[index].obstacle === 'water') {
          let a = index,
            b = index;
          while (a > 0 && raw.spans[a - 1].obstacle === 'water') a--;
          while (b < raw.spans.length - 1 && raw.spans[b + 1].obstacle === 'water') b++;
          for (let j = a; j <= b; j++)
            for (const k of ['elevation', 'angle']) {
              raw.spans[j][k] = raw.spans[index][k];
              setNum(form.querySelector(`[data-span="${j}"][data-key="${k}"]`), raw.spans[index][k]);
            }
        }
      }
      if (e.target.id === 'boxCount') raw.girders = numValue(e.target);
      if (e.target.name === 'bentThickness' && config.bentEndThickness === config.bentThickness)
        raw.bentEndThickness = raw.bentThickness;
      if (e.target.name === 'material' && raw.material === 'box') raw.girders = raw.width < 7 ? 1 : 2;
      // Concrete box girders and frames: start from a sensible depth (about span / 22, deeper at the supports).
      const longest = Math.max(...raw.spans.map(span => span.length));
      if (
        (e.target.name === 'material' && raw.material === 'psbox') ||
        (e.target.name === 'structureSystem' &&
          ['frame', 'strutted'].includes(raw.structureSystem) &&
          !['slab', 'psbox'].includes(raw.material))
      ) {
        raw.material = 'psbox';
        raw.depth = Math.max(1.4, Math.min(4.5, Number((longest / 24).toFixed(2))));
        raw.pierDepth = Math.max(raw.pierDepth, Number((raw.depth * 1.7).toFixed(2)));
        raw.width = Math.max(raw.width, 7);
      }
      if (e.target.name === 'structureSystem' && raw.structureSystem === 'strutted') raw.variableDepth = true;
      // 0.6.6: a truss is a footbridge: open it with sensible proportions; each truss type has its own height.
      if (e.target.name === 'structureSystem' && raw.structureSystem === 'truss') {
        raw.width = Math.min(Math.max(raw.width, 3.5), 6);
        raw.trussHeight = raw.trussType === 'pony' ? 1.8 : 4.2;
      }
      if (e.target.name === 'trussType') raw.trussHeight = raw.trussType === 'pony' ? 1.8 : 4.2;
      // Leaving the concrete box: back to a regular girder layout.
      if (e.target.name === 'material' && config.material === 'psbox' && ['concrete', 'steel'].includes(raw.material)) {
        raw.overhang = 1.2;
        raw.girders = Math.max(3, Math.round((raw.width - 2.4) / (raw.material === 'concrete' ? 2.6 : 2.8)) + 1);
        raw.depth = raw.material === 'concrete' ? 1.4 : Math.min(raw.depth, 2.4);
      }
      if (
        e.target.name === 'material' &&
        raw.material === 'steel' &&
        raw.trafficMode === 'cyclists' &&
        raw.width <= 6
      ) {
        raw.girders = 2;
        raw.overhang = Math.min(raw.overhang, 0.45);
      }
      // The bottom flange drives box spacing; other box edits keep the chosen bottom flange when it still fits.
      if (raw.material === 'box' && e.target.name === 'boxBottomWidth') Object.assign(raw, fitBoxLayoutFromBottom(raw));
      else if (
        raw.material === 'box' &&
        (e.target.id === 'boxCount' || ['material', 'width', 'trafficMode', 'depth'].includes(e.target.name))
      ) {
        try {
          Object.assign(raw, fitBoxLayoutFromBottom(raw));
        } catch {
          Object.assign(raw, fitBoxLayout(raw));
        }
      }
      if (e.target.name === 'material' && raw.material === 'concrete') {
        raw.depth = depths.reduce((a, b) => (Math.abs(b - config.depth) < Math.abs(a - config.depth) ? b : a));
        $('nebt').value = raw.depth;
      }
      // Keep the edited crossing input and its focus alive for repeated arrow clicks.
      await update(raw, {
        refresh: e.target.dataset.span === undefined || e.target.dataset.key === 'obstacle',
        editKey,
      });
    }
    $('feedback').hidden = true;
  } catch (error) {
    refreshForm();
    notify(`${error.message} The last valid model remains visible.`, true);
  }
});
document.querySelectorAll('[data-view]').forEach(b =>
  b.addEventListener('click', () => {
    controls.autoRotate = false;
    fit(b.dataset.view);
  }),
);
$('stats').onchange = () => {
  $('perf-hud').hidden = !$('stats').checked;
  $('perf-hud').textContent = 'Measuring…';
  needsRender = true;
};
$('reveal').onchange = () => {
  applyReveal();
  needsRender = true;
};
$('reset').onclick = () => selectPreset(presets[0].id);
async function selectPreset(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) return;
  await update(makePreset(id), { refresh: true, heavy: true, baseline: true });
  fit('perspective');
  restoreCamera(preset.camera);
  $('preset').value = id;
  if (!config.name) $('sceneTitle').textContent = preset.label;
  $('preset').title = preset.description;
  $('feedback').hidden = true;
}
$('preset').onchange = () => selectPreset($('preset').value);
// File names carry the variant name, the save date and the software version.
function fileBase() {
  const now = new Date(),
    date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const name =
    (config.name || 'bridge')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'bridge';
  return `BridgeSketch-${name}_${date}_v${release.version}`;
}
$('save').onclick = () => {
  const saved = {
    release: { ...release, savedAt: new Date().toISOString() },
    name: config.name,
    config,
    camera: captureCamera(),
  };
  download(new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }), fileBase() + '.json');
  hist.markSaved();
  notify(`Saved ${fileBase()}.json`);
};
// 0.6.9: complete project: configuration (bridge A and B), camera, imported terrain packet (grids, image, edited
// zones, attribution) and its placement. The .json configuration and the shared link stay light and site-free.
$('save-project').onclick = async () => {
  if (!demOverlay) return notify('Import a terrain first: the complete project carries the imported site.', true);
  const { serializePacket } = await import('./terrain-packet.mjs'),
    saved = {
      format: 'bs3d-project',
      formatVersion: 1,
      release: { ...release, savedAt: new Date().toISOString() },
      name: config.name,
      config,
      camera: captureCamera(),
      placement: { ...demOverlay.placement },
      terrain: JSON.parse(serializePacket(demOverlay.packet)),
    },
    blob = new Blob([JSON.stringify(saved)], { type: 'application/json' });
  download(blob, fileBase() + '.bs3dproject');
  hist.markSaved();
  notify(`Saved ${fileBase()}.bs3dproject (${(blob.size / 1048576).toFixed(1)} MB). Open it from File › Open.`);
};
async function openProject(data) {
  const { validatePacket } = await import('./terrain-packet.mjs'),
    packet = validatePacket(data.terrain),
    pl = data.placement;
  if (!pl || !['cx', 'cy', 'azimuth', 'zOffset'].every(k => Number.isFinite(pl[k]))) throw Error('This project has no valid bridge placement.');
  const next = validate({ ...data.config, name: data.config?.name ?? data.name ?? '' });
  await setDem({ packet, placement: { cx: pl.cx, cy: pl.cy, azimuth: pl.azimuth, zOffset: pl.zOffset }, config: next });
  hist.track({ baseline: true });
  restoreCamera(data.camera);
  notify('Complete project opened: bridges, imported site and zones.');
}
$('variantName').addEventListener('input', () => {
  config.name = $('variantName')
    .value.replace(/[\u0000-\u001f]/g, '')
    .slice(0, 60);
  updateHeading();
  hist.track({ key: 'variantName' });
});
$('variantName').addEventListener('change', () => {
  config.name = config.name.trim();
  $('variantName').value = config.name;
  updateHeading();
  hist.track({ key: 'variantName' });
});
$('load').onclick = () => $('file').click();
$('file').onchange = async () => {
  try {
    const file = $('file').files[0];
    if (!file) return;
    if (/\.bs3dproject$/i.test(file.name) || file.size > 24000) {
      if (file.size > 200 * 1048576) throw Error('This project is larger than 200 MB.');
      const project = JSON.parse(await file.text());
      if (project?.format !== 'bs3d-project') throw Error('Choose a BridgeSketch 3D configuration smaller than 24 KB, or a .bs3dproject file.');
      await openProject(project);
      return;
    }
    const data = JSON.parse(await file.text()),
      saved = {
        config: validate({ ...(data.config ?? data), name: data.config?.name ?? data.name ?? '' }),
        camera: data.camera,
      };
    await update(saved.config, { refresh: true, resetCamera: true, baseline: true });
    restoreCamera(saved.camera);
    notify('Configuration loaded.');
  } catch (e) {
    notify(e.message, true);
  } finally {
    $('file').value = '';
  }
};
$('share').onclick = async () => {
  const url = new URL(location.href);
  url.hash = encodeConfig(config, captureCamera());
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url.href);
    notify('Link copied. It includes the bridge and camera view.');
  } catch {
    notify('Copy this link to share the bridge and camera view.');
    clearTimeout(messageTimer);
    const field = document.createElement('input');
    field.type = 'text';
    field.readOnly = true;
    field.value = url.href;
    field.setAttribute('aria-label', 'Bridge share link');
    field.style.cssText = 'width:100%;margin-top:10px;padding:8px';
    $('feedback').append(field);
    field.focus();
    field.select();
  }
};
$('image').onclick = async () => {
  if (view === 'section') {
    download(
      new Blob([new XMLSerializer().serializeToString($('sectionSvg'))], { type: 'image/svg+xml' }),
      fileBase() + '_section.svg',
    );
    notify('Section saved.');
    return;
  }
  // High-quality snapshot: rendered once at up to 3840 px wide (supersampled for small windows), with a 4096 px
  // shadow map, full-resolution water reflection and the dense meadow, then saved as a lossless PNG.
  const button = $('image'),
    sun = scene.userData.lights.sun,
    host = $('canvasHost'),
    saved = {
      ratio: renderer.getPixelRatio(),
      shadow: sun.shadow.mapSize.x,
      near: grassUniforms.grassNear.value,
      far: grassUniforms.grassFar.value,
    };
  const gl = renderer.getContext(),
    maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192),
    ratio = Math.max(saved.ratio, Math.min(3, 3840 / host.clientWidth, maxSize / host.clientWidth, maxSize / host.clientHeight));
  button.disabled = true;
  try {
    renderer.setPixelRatio(ratio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    renderer.shadowMap.needsUpdate = true;
    grassUniforms.grassNear.value = 120;
    grassUniforms.grassFar.value = 400;
    reflection.setScale(1);
    renderReflection();
    draw();
    const canvas = document.createElement('canvas');
    canvas.width = renderer.domElement.width;
    canvas.height = renderer.domElement.height;
    const ctx = canvas.getContext('2d');
    const bg = ctx.createRadialGradient(
      canvas.width * 0.45,
      canvas.height * 0.12,
      0,
      canvas.width * 0.45,
      canvas.height * 0.12,
      canvas.width,
    );
    const shade = 1 - scene.userData.daylight;
    for (const [stop, day, night] of [
      [0, '#5e7b8b', '#172b46'],
      [0.52, '#35566c', '#0a1930'],
      [1, '#203d51', '#050d1d'],
    ])
      bg.addColorStop(stop, new T.Color(day).lerp(new T.Color(night), shade).getStyle());
    ctx.fillStyle = config.background === 'white' ? '#ffffff' : bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(renderer.domElement, 0, 0);
    // The same soft vignette as the viewport (CSS), baked into the picture.
    if (config.background !== 'white') {
      const v = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        Math.min(canvas.width, canvas.height) * 0.45,
        canvas.width / 2,
        canvas.height / 2,
        Math.hypot(canvas.width, canvas.height) * 0.62,
      );
      v.addColorStop(0, 'rgba(8,20,32,0)');
      v.addColorStop(1, 'rgba(8,20,32,0.28)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (blob) {
      download(blob, fileBase() + '.png');
      notify(`Snapshot saved · ${canvas.width} × ${canvas.height} px PNG (lossless).`);
    } else notify('Could not create the snapshot.', true);
  } finally {
    renderer.setPixelRatio(saved.ratio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    sun.shadow.mapSize.set(saved.shadow, saved.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    shadowDirty = true;
    grassUniforms.grassNear.value = saved.near;
    grassUniforms.grassFar.value = saved.far;
    reflection.setScale(tier().reflection);
    button.disabled = false;
    needsRender = true;
  }
};
// 0.6.6: IFC export (modules/ifc-export.mjs). The bridge is rebuilt without batching so every member keeps its own
// mesh and name; coordinates follow the road profile frame (File › Road profile…).
$('export-ifc').onclick = () => {
  const o = profileOptions();
  $('ifcOrigin').textContent = `X ${frenchNumber(o.x0)}, Y ${frenchNumber(o.y0)}, Z ${frenchNumber(o.datum)} m, bearing ${frenchNumber(o.bearing)}°`;
  try {
    const saved = localStorage.getItem('bridgesketch-ifc-schema');
    if (saved) for (const r of document.querySelectorAll('[name="ifcSchema"]')) r.checked = r.value === saved;
  } catch {}
  $('ifc-dialog').showModal();
};
$('exportIfc').onclick = async () => {
  const button = $('exportIfc'),
    schema = document.querySelector('[name="ifcSchema"]:checked')?.value ?? 'IFC2X3';
  button.disabled = true;
  button.textContent = 'Exporting…';
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)));
  let copy;
  try {
    try {
      localStorage.setItem('bridgesketch-ifc-schema', schema);
    } catch {}
    const { exportIfc } = await import('./ifc-export.mjs');
    copy = buildBridge(config, materials, { batch: false, site: false, lights: true, dem: demOverlay });
    const o = profileOptions(),
      result = exportIfc(config, copy, materials, {
        schema,
        origin: { datum: o.datum, x0: o.x0, y0: o.y0, bearing: o.bearing },
        name: config.name || 'BridgeSketch 3D bridge',
        version: release.version,
      });
    download(new Blob([result.text], { type: 'application/x-step' }), `${fileBase()}-${schema.toLowerCase()}.ifc`);
    $('ifc-dialog').close();
    // 0.6.7: open a free online viewer (Online 3D Viewer, open source, web-ifc) next to the download; browsers do
    // not let a page hand a local file to another site, so the user drops the downloaded file into that tab.
    window.open('https://3dviewer.net/', '_blank', 'noopener');
    notify(
      `IFC exported: ${result.elements} elements (${(result.text.length / 1e6).toFixed(1)} MB). ` +
        'Drop the downloaded .ifc file into the 3dviewer.net tab (opened for you) to view it.' +
        ' Save JSON to keep editable parameters.',
    );
  } catch (e) {
    notify(`IFC export failed: ${e.message}`, true);
  } finally {
    if (copy) disposeModel(copy);
    button.disabled = false;
    button.textContent = 'Export IFC';
  }
};
$('export-glb').onclick = async () => {
  const button = $('export-glb'),
    label = button.querySelector('b');
  button.disabled = true;
  label.textContent = 'Exporting…';
  let waterMaterial;
  try {
    const { GLTFExporter } = await import('../vendor/GLTFExporter.js');
    const copy = model.root.clone(true);
    copy.children[0].visible = true;
    copy.children[1].children.find(o => o.name === 'Concrete deck haunches').visible = true;
    copy.children[2].visible = true;
    waterMaterial = new T.MeshStandardMaterial({ color: '#1f5059', roughness: 0.12 });
    const shadows = [];
    copy.traverse(o => {
      if (o.material?.isShaderMaterial || o.material?.userData.water) o.material = waterMaterial;
      if (o.name === 'Contact shadow' || o.material?.name === 'Contact shadow') shadows.push(o);
    });
    // Vehicle contact shadows are a viewport effect only.
    for (const o of shadows) o.removeFromParent();
    const binary = await new GLTFExporter().parseAsync(copy, { binary: true, maxTextureSize: 1024 });
    download(new Blob([binary], { type: 'model/gltf-binary' }), fileBase() + '.glb');
    notify('3D model exported. Save JSON to keep editable parameters.');
  } catch (e) {
    notify(`Model export failed: ${e.message}`, true);
  } finally {
    waterMaterial?.dispose();
    button.disabled = false;
    label.textContent = 'Export GLB';
  }
};
function registerTools() {
  if (!document.modelContext?.registerTool) return;
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  const properties = Object.fromEntries(
    Object.entries(defaults)
      .filter(
        ([k]) =>
          !['spans', 'version', 'web', 'deck', 'asphalt', 'barrier', 'barrierType', 'boxTopWidth', 'haunch'].includes(
            k,
          ),
      )
      .map(([k, v]) => [k, { type: typeof v }]),
  );
  properties.spans = {
    type: 'array',
    minItems: 1,
    maxItems: 8,
    items: {
      type: 'object',
      properties: {
        length: { type: 'number' },
        obstacle: { type: 'string', enum: ['water', 'road', 'rail', 'land'] },
        width: { type: 'number' },
        elevation: { type: 'number' },
        angle: { type: 'number' },
      },
      required: ['length', 'obstacle', 'width', 'elevation', 'angle'],
      additionalProperties: false,
    },
  };
  for (const tool of [
    {
      name: 'get_bridge_configuration',
      description: 'Read the current bridge parameters and geometry statistics.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({ config: structuredClone(config), stats: window.bridgeViewer.getStats() }),
    },
    {
      name: 'configure_bridge',
      description:
        'Apply bridge parameters to the visible model. Supports plate and 1–14 box girders, variable-depth slabs and steel girders, sidewalks, railings and abutment slopes. Asphalt 65 mm and steel web 14 mm remain fixed.',
      inputSchema: { type: 'object', properties, additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute: async parameters => {
        if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters))
          throw Error('Provide bridge parameters.');
        let next = { ...config, ...parameters };
        if (
          next.material === 'box' &&
          ['material', 'girders', 'width', 'variableDepth', 'depth', 'pierDepth'].some(k =>
            Object.hasOwn(parameters, k),
          )
        )
          next = fitBoxLayout(next);
        await update(next, { refresh: true });
        draw();
        return { config: structuredClone(config), stats: window.bridgeViewer.getStats() };
      },
    },
  ]) {
    try {
      Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(console.warn);
    } catch (e) {
      console.warn(e);
    }
  }
}
// 0.6.8: imported terrain (« Import DTM/DSM » in the project bar). The packet comes from QuickerAtlas (postMessage or a
// .bs3dterrain file, dem-ui.mjs); the overlay is kept apart from the config.
async function demTexture(packet) {
  if (!packet.image) return null;
  try {
    const img = new Image();
    img.src = packet.image.dataUrl;
    await img.decode();
    let source = img;
    const limit = Math.min(renderer?.capabilities.maxTextureSize ?? 4096, 4096);
    if (Math.max(img.width, img.height) > limit) {
      const k = limit / Math.max(img.width, img.height),
        canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      source = canvas;
    }
    const texture = new T.Texture(source);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() ?? 1);
    texture.needsUpdate = true;
    return texture;
  } catch (e) {
    console.warn('Terrain image not used:', e);
    return null;
  }
}
async function setDem(data) {
  const previous = demOverlay,
    previousConfig = config,
    texture = data ? await demTexture(data.packet) : null;
  demOverlay = data ? { packet: data.packet, placement: data.placement, texture } : null;
  try {
    await update(data?.config ?? config, { refresh: true, resetCamera: true, noHistory: true });
  } catch (e) {
    texture?.dispose();
    demOverlay = previous;
    await update(previousConfig, { refresh: true, resetCamera: true, noHistory: true }).catch(() => {});
    throw e;
  }
  previous?.texture?.dispose();
  if (data) await saveOverlay({ packet: data.packet, placement: data.placement });
  else await clearOverlay();
  demImport.refreshButton();
  $('save-project').disabled = !demOverlay;
  twinPanel?.refresh();
}
async function importDem(raw, placement) {
  const { validatePacket, autoPlacement } = await import('./terrain-packet.mjs'),
    packet = validatePacket(raw);
  await setDem({ packet, placement: placement ?? autoPlacement(packet, config) });
  notify('Terrain imported. Move or turn the bridge from « Imported terrain ».');
}
async function removeDem() {
  await setDem(null);
  notify('Imported terrain removed: back to the procedural terrain.');
}
const demImport = createDemImport({
  $,
  getConfig: () => config,
  getOverlay: () => demOverlay,
  apply: async data => {
    await setDem(data);
    notify('Terrain imported. Open « Imported terrain » to move or turn the bridge, or to remove it.');
  },
  remove: removeDem,
  notify,
});
twinPanel = createTwinPanel({ $, getConfig: () => config, hasSite: () => !!demOverlay, update, notify });
twinPanel.refresh();
// QuickerAtlas can also open this page with #terrain-import and wait for { type: 'bs3d-ready' } before sending.
const terrainHash = location.hash === '#terrain-import';
if (terrainHash) {
  history.replaceState(null, '', location.pathname + location.search);
  window.opener?.postMessage({ type: 'bs3d-ready' }, '*');
  demImport.open({ waiting: true });
}
window.addEventListener('hashchange', async () => {
  if (location.hash === '#terrain-import') {
    history.replaceState(null, '', location.pathname + location.search);
    window.opener?.postMessage({ type: 'bs3d-ready' }, '*');
    demImport.open({ waiting: true });
    return;
  }
  try {
    const saved = decodeConfig(location.hash);
    await update(saved.config, { refresh: true, resetCamera: true, baseline: true });
    restoreCamera(saved.camera);
  } catch (e) {
    notify(e.message, true);
  }
});
initWorkspace();
boot().catch(e => {
  $('fatal').hidden = false;
  $('fatal').textContent =
    `The 3D viewer could not start. Check that hardware acceleration and WebGL 2 are enabled in your desktop browser. ${e.message}`;
  console.error(e);
});
