// BridgeSketch 3D · 0.6.8: the « Import DTM/DSM » dialog. Receives a bs3d-terrain packet (QuickerAtlas by postMessage, or a
// .bs3dterrain file), shows it on a 2D map with the bridge footprint to drag, turn and raise, then hands { packet,
// placement } to the app. The imported terrain is a session overlay: IndexedDB keeps it across reloads, the shared link
// and the saved .json know nothing about it.
import { frame, profile, totalLength } from './geometry.mjs';
import { siteBridge, siteParameters } from './site-config.mjs';
import { createZoneEditor, zoneNames } from './zone-editor.mjs';
import {
  autoPlacement,
  autoZOffset,
  footprint,
  gridBounds,
  originAllowed,
  sampleGrid,
  sceneToPacket,
  validatePacket,
} from './terrain-packet.mjs';

export const QA_URL = 'https://acheruel.github.io/QuickerAtlas/';
const qaUrl = () => {
  try {
    return localStorage.getItem('bs3d-qa-url') || QA_URL;
  } catch {
    return QA_URL;
  }
};

/* ---------------------------------------------------------------------------------------------- */
/* Persistence (IndexedDB): { packet, placement } under one key                                     */
/* ---------------------------------------------------------------------------------------------- */

const open = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('bridgesketch-dem', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('overlay');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const run = async (mode, action) => {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = action(db.transaction('overlay', mode).objectStore('overlay'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
};
export const saveOverlay = async ({ packet, placement }) => {
  try {
    await run('readwrite', store => store.put({ packet, placement }, 'current'));
    return true;
  } catch {
    return false;
  }
};
export const loadOverlay = async () => {
  try {
    const saved = await run('readonly', store => store.get('current'));
    if (!saved) return null;
    return { packet: validatePacket(saved.packet), placement: saved.placement };
  } catch {
    return null;
  }
};
export const clearOverlay = async () => {
  try {
    await run('readwrite', store => store.delete('current'));
  } catch {}
};

/* ---------------------------------------------------------------------------------------------- */
/* Map rendering                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

// Hypsometric tint with a north-west hillshade, one pixel per grid cell.
function hillshade(packet) {
  const { cols, rows, cell } = packet.grid,
    z = packet.mnt,
    canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < z.length; i++)
    if (z[i] === z[i]) {
      if (z[i] < lo) lo = z[i];
      if (z[i] > hi) hi = z[i];
    }
  const image = new ImageData(cols, rows),
    d = image.data,
    ramp = [
      [0.0, [88, 132, 92]],
      [0.45, [176, 192, 120]],
      [0.75, [196, 166, 112]],
      [1.0, [236, 232, 224]],
    ],
    tint = t => {
      for (let k = 1; k < ramp.length; k++)
        if (t <= ramp[k][0]) {
          const [t0, c0] = ramp[k - 1],
            [t1, c1] = ramp[k],
            f = (t - t0) / (t1 - t0);
          return c0.map((v, j) => v + (c1[j] - v) * f);
        }
      return ramp.at(-1)[1];
    };
  const at = (c, r) => {
    const v = z[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
    return v === v ? v : NaN;
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v = z[r * cols + c],
        k = (r * cols + c) * 4;
      if (v !== v) {
        d[k] = d[k + 1] = d[k + 2] = 70;
        d[k + 3] = 255;
        continue;
      }
      const gx = (at(c + 1, r) - at(c - 1, r)) / (2 * cell),
        gy = (at(c, r + 1) - at(c, r - 1)) / (2 * cell),
        // Light from the north-west, 45° up: normal (-gx, 1, +gy) in (east, up, south).
        shade = Math.max(0.25, Math.min(1.4, (0.707 + 0.5 * (gx + gy)) / Math.hypot(gx, gy, 1) / 0.9 + 0.15)),
        rgb = tint(hi > lo ? (v - lo) / (hi - lo) : 0.3);
      d[k] = Math.min(255, rgb[0] * shade);
      d[k + 1] = Math.min(255, rgb[1] * shade);
      d[k + 2] = Math.min(255, rgb[2] * shade);
      d[k + 3] = 255;
    }
  canvas.getContext('2d').putImageData(image, 0, 0);
  return canvas;
}

const inPolygon = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if (poly[i][1] > y !== poly[j][1] > y && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0])
      inside = !inside;
  return inside;
};

/* ---------------------------------------------------------------------------------------------- */
/* Dialog                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

// getConfig(): current bridge; getOverlay(): imported terrain in use or null; apply({packet, placement}) and remove() put
// it in the scene; notify(text, isError).
export function createDemImport({ $, getConfig, getOverlay, apply, remove, notify }) {
  const dialog = $('dem-dialog'),
    map = $('dem-map'),
    prof = $('dem-profile'),
    fields = { azimuth: $('dem-azimuth'), cx: $('dem-cx'), cy: $('dem-cy'), zOffset: $('dem-zoffset') };
  let pending = null, // { packet, placement }
    auto = true,
    view = null, // { x, y, scale }: packet point at the middle of the map, pixels per metre
    background = null, // hillshade canvas of the pending packet
    satellite = null, // decoded image of the pending packet
    hover = null,
    drag = null,
    qaWindow = null,
    busy = false;
  let configError = '';
  const draftConfig = () => pending?.config ?? getConfig();
  const configKeys = ['spans','width','material','skew','grade','elevation','approach'];
  function configFields() {
    const c=draftConfig();
    for(const k of configKeys) $('dem-'+k).value=k==='spans'?c.spans.map(s=>s.length).join(' ; '):c[k];
    const axis=pending.packet.bridge?.axis, length=axis?Math.hypot(axis[1][0]-axis[0][0],axis[1][1]-axis[0][1]):null;
    $('dem-length-check').textContent=`Bridge: ${totalLength(c).toFixed(1)} m`+(length===null?' · no proposed axis':` · axis: ${length.toFixed(1)} m · difference: ${(totalLength(c)-length).toFixed(1)} m. Check the spans.`);
  }

  const status = (text, error = false) => {
    const p = $('dem-status');
    p.hidden = !text;
    p.textContent = text ?? '';
    p.classList.toggle('error', error);
  };

  const fit = () => {
    const b = gridBounds(pending.packet),
      w = map.clientWidth || 640,
      h = map.clientHeight || 420,
      pad = pending.packet.grid.cell * 2;
    view = {
      x: (b.x0 + b.x1) / 2,
      y: (b.y0 + b.y1) / 2,
      scale: Math.min(w / (b.x1 - b.x0 + 2 * pad), h / (b.y1 - b.y0 + 2 * pad)),
    };
  };
  const toCanvas = (px, py) => [map.width / 2 + (px - view.x) * view.scale * dpr(), map.height / 2 - (py - view.y) * view.scale * dpr()];
  const fromCanvas = (x, y) => [view.x + (x - map.width / 2) / (view.scale * dpr()), view.y - (y - map.height / 2) / (view.scale * dpr())];
  const dpr = () => map.width / (map.clientWidth || map.width);

  // Footprint outlines in packet coordinates for the current placement.
  const outlines = () => {
    const c = draftConfig(),
      pl = pending.placement,
      to = pts => pts.map(([x, z]) => sceneToPacket(pl, x, z));
    return {
      approach: to(footprint(c)),
      deck: to(footprint(c, 0, { approaches: false })),
      handle: sceneToPacket(pl, totalLength(c) / 2 + c.approach + 18 + 10, 0),
      centre: [pl.cx, pl.cy],
    };
  };

  function drawMap() {
    if (!pending) return;
    const rect = map.getBoundingClientRect(),
      ratio = window.devicePixelRatio || 1;
    if (map.width !== Math.round(rect.width * ratio) || map.height !== Math.round(rect.height * ratio)) {
      map.width = Math.round(rect.width * ratio);
      map.height = Math.round(rect.height * ratio);
      if (!view || view.fitted !== map.clientWidth) fit();
    }
    if (!view) fit();
    const g = map.getContext('2d'),
      { packet } = pending,
      grid = packet.grid,
      d = dpr();
    g.fillStyle = '#26323a';
    g.fillRect(0, 0, map.width, map.height);
    g.imageSmoothingEnabled = true;
    const [x0, y0] = toCanvas(grid.x0 - grid.cell / 2, grid.y0 + grid.cell / 2),
      w = grid.cols * grid.cell * view.scale * d,
      h = grid.rows * grid.cell * view.scale * d;
    g.drawImage(satellite ?? background, x0, y0, w, h);
    if (satellite) {
      // Faint hillshade over the image so the relief still reads.
      g.globalAlpha = 0.28;
      g.globalCompositeOperation = 'multiply';
      g.drawImage(background, x0, y0, w, h);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    const path = pts => {
      g.beginPath();
      pts.forEach(([px, py], i) => {
        const [x, y] = toCanvas(px, py);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
    };
    for (const zone of packet.zones) {
      if (zone.type === 'road') {
        path(zone.line);
        g.strokeStyle = '#f2d24b';
        g.lineWidth = Math.max(1.5 * d, zone.width * view.scale * d);
        g.globalAlpha = 0.85;
        g.lineJoin = 'round';
        g.stroke();
        g.globalAlpha = 1;
        continue;
      }
      path(zone.polygon);
      g.closePath();
      g.fillStyle = zone.type === 'forest' ? 'rgba(0,158,115,0.38)' : zone.type === 'grass' ? 'rgba(240,228,66,0.3)' : 'rgba(0,114,178,0.4)';
      g.fill();
      g.strokeStyle = zone.type === 'forest' ? '#009E73' : zone.type === 'grass' ? '#F0E442' : '#0072B2';
      g.setLineDash(zone.type==='forest'?[2*d,5*d]:zone.type==='grass'?[8*d,3*d,2*d,3*d]:zone.type==='water'?[7*d,4*d]:[]);
      g.lineWidth = 1.2 * d;
      g.stroke();
      g.setLineDash([]);
    }
    const axis = packet.bridge?.axis;
    if (axis) {
      path(axis);
      g.setLineDash([6 * d, 4 * d]);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5 * d;
      g.stroke();
      g.setLineDash([]);
    }
    const o = outlines(),
      outside = o.approach.some(([px, py]) => {
        const b = gridBounds(packet);
        return px < b.x0 || px > b.x1 || py < b.y0 || py > b.y1;
      });
    path(o.approach);
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fill();
    g.strokeStyle = outside ? '#ff5a4a' : '#ffffff';
    g.lineWidth = 1.5 * d;
    g.stroke();
    path(o.deck);
    g.closePath();
    g.fillStyle = outside ? 'rgba(255,90,74,0.65)' : 'rgba(0,127,120,0.8)';
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2 * d;
    g.stroke();
    // Rotation handle.
    const [hx, hy] = toCanvas(...o.handle),
      [mx, my] = toCanvas(...o.centre);
    g.beginPath();
    g.moveTo(mx, my);
    g.lineTo(hx, hy);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5 * d;
    g.stroke();
    g.beginPath();
    g.arc(hx, hy, 7 * d, 0, Math.PI * 2);
    g.fillStyle = '#ffb347';
    g.fill();
    g.stroke();
    // North arrow and scale bar.
    editor.draw(g);
    g.fillStyle = '#fff';
    g.font = `${12 * d}px sans-serif`;
    g.fillText('N ↑', 10 * d, 18 * d);
    const metres = [10, 20, 50, 100, 200, 500].find(m => m * view.scale >= 70) ?? 500,
      bar = metres * view.scale * d;
    g.fillRect(10 * d, map.height - 18 * d, bar, 3 * d);
    g.fillText(`${metres} m`, 10 * d, map.height - 24 * d);
    $('dem-readout').textContent = hover
      ? `E ${hover[0].toFixed(0)} m · N ${hover[1].toFixed(0)} m · ground ${fmt(sampleGrid(packet, hover[0], hover[1]))}`
      : outside
        ? 'The footprint leaves the block: the approaches would stand on nothing.'
        : '';
    $('dem-readout').classList.toggle('warn', outside && !hover);
    drawProfile();
  }
  const fmt = v => (Number.isFinite(v) ? v.toFixed(1) + ' m' : '–');

  // Ground under the alignment against the road line: shows what the vertical offset does.
  function drawProfile() {
    const c = draftConfig(),
      pl = pending.placement,
      L = totalLength(c),
      reach = c.approach + 18,
      rect = prof.getBoundingClientRect(),
      ratio = window.devicePixelRatio || 1;
    if (prof.width !== Math.round(rect.width * ratio)) {
      prof.width = Math.round(rect.width * ratio);
      prof.height = Math.round(rect.height * ratio);
    }
    const g = prof.getContext('2d'),
      W = prof.width,
      H = prof.height,
      n = 120,
      ground = [],
      road = [];
    for (let i = 0; i <= n; i++) {
      const s = -reach + ((L + 2 * reach) * i) / n,
        f = frame(c, s),
        [px, py] = sceneToPacket(pl, f.x, f.z);
      ground.push(sampleGrid(pending.packet, px, py) + pl.zOffset);
      road.push(profile(c, s) - 0.17);
    }
    const all = [...ground, ...road].filter(Number.isFinite),
      lo = Math.min(...all) - 2,
      hi = Math.max(...all) + 2,
      X = i => (i / n) * (W - 8 * ratio) + 4 * ratio,
      Y = v => H - 14 * ratio - ((v - lo) / (hi - lo)) * (H - 24 * ratio);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#f3f7f9';
    g.fillRect(0, 0, W, H);
    g.beginPath();
    g.moveTo(X(0), H);
    ground.forEach((v, i) => g.lineTo(X(i), Number.isFinite(v) ? Y(v) : H));
    g.lineTo(X(n), H);
    g.closePath();
    g.fillStyle = '#b9a98a';
    g.fill();
    g.beginPath();
    road.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.strokeStyle = '#102d41';
    g.lineWidth = 3 * ratio;
    g.stroke();
    g.strokeStyle = '#007f78';
    g.lineWidth = 1.2 * ratio;
    g.setLineDash([4 * ratio, 3 * ratio]);
    for (const s of [0, L]) {
      const x = X(((s + reach) / (L + 2 * reach)) * n);
      g.beginPath();
      g.moveTo(x, 4 * ratio);
      g.lineTo(x, H - 14 * ratio);
      g.stroke();
    }
    g.setLineDash([]);
    g.fillStyle = '#566e7c';
    g.font = `${11 * ratio}px sans-serif`;
    g.fillText(`road ${road[Math.round(n / 2)].toFixed(1)} m · ground under the middle ${fmt(ground[Math.round(n / 2)])} · abutments dashed`, 6 * ratio, H - 3 * ratio);
    // 0.6.9: warn about an interference rather than silently excavating the imported ground.
    const depth=c.material==='slab'?c.slabDepth:c.variableDepth?c.pierDepth:c.depth;
    const conflict=ground.some((h,i)=>{const s=-reach+(L+2*reach)*i/n;return s>2&&s<L-2&&Number.isFinite(h)&&h>road[i]+0.17-c.deck-c.asphalt-c.haunch-depth;});
    $('dem-conflict').hidden=!configError&&!conflict;
    $('dem-conflict').textContent=configError || '⚠ The ground may touch the deck. The measured ground is kept: raise the profile or the vertical offset before applying.';
  }

  function syncFields() {
    const pl = pending.placement;
    fields.azimuth.value = (Math.round(pl.azimuth * 10) / 10).toString();
    fields.cx.value = Math.round(pl.cx).toString();
    fields.cy.value = Math.round(pl.cy).toString();
    fields.zOffset.value = (Math.round(pl.zOffset * 100) / 100).toString();
    $('dem-auto').setAttribute('aria-pressed', auto);
    $('dem-auto').classList.toggle('on', auto);
  }
  function changed() {
    if (auto) pending.placement.zOffset = autoZOffset(pending.packet, draftConfig(), pending.placement);
    syncFields();
    drawMap();
  }

  async function show(packet, placement) {
    // A normalized copy owns the editable zones; grids remain shared and immutable.
    packet = validatePacket(packet);
    const config=placement?structuredClone(getConfig()):siteBridge(packet);
    pending = { packet, config, placement: placement ?? autoPlacement(packet, config) };
    configError='';
    auto = !placement;
    background = hillshade(packet);
    satellite = null;
    view = null;
    if (packet.image) {
      const img = new Image();
      img.onload = () => {
        if(pending?.packet!==packet)return;
        satellite = img;
        drawMap();
      };
      img.src = packet.image.dataUrl;
    }
    $('dem-place').hidden = false;
    $('dem-apply').disabled = false;
    $('dem-apply').textContent = getOverlay() ? 'Apply to the project' : 'Create the bridge on this site';
    const zones = { river: 0, water: 0, forest: 0, grass: 0, road: 0 };
    for (const z of packet.zones) zones[z.type]++;
    $('dem-info').textContent =
      `${packet.source || 'Terrain packet'} · ${packet.grid.cols} × ${packet.grid.rows} cells at ${packet.grid.cell} m · ` +
      `${zones.river + zones.water} water, ${zones.forest} forest, ${zones.grass} grass, ${zones.road} road zones · ` +
      `${packet.image ? 'satellite image' : 'no image'}${packet.mns ? ' · surface model' : ''}` +
      (packet.attribution.length ? ' · ' + packet.attribution.join(' · ') : '');
    status(packet.bridge ? 'Block received. The bridge is on the axis drawn in QuickerAtlas: move it if needed.' : 'Block received. Place the bridge by dragging its footprint.');
    if (!dialog.open) dialog.showModal();
    syncFields();
    configFields();
    editor.reset();
    requestAnimationFrame(drawMap);
  }

  // 0.6.9: acknowledgement to the sender (QuickerAtlas): received (valid), applied, closed without applying, or error.
  let reply = null;
  const acknowledge = (state, extra = {}) => {
    if (!reply) return;
    try {
      reply.source.postMessage({ type: 'bs3d-terrain-ack', id: reply.id, state, ...extra }, reply.origin);
    } catch {
      /* sender closed */
    }
    if (state !== 'received') reply = null;
  };
  async function accept(data, origin = '', source = null) {
    if (reply) acknowledge('closed');
    reply = source && origin ? { source, origin, id: typeof data?.transferId === 'string' ? data.transferId.slice(0, 80) : null } : null;
    try {
      const packet = validatePacket(data);
      await show(packet);
      acknowledge('received', { zones: packet.zones.length, axis: !!packet.bridge });
      notify?.(`Terrain block received${origin ? ' from ' + origin.replace(/^https?:\/\//, '') : ''}.`);
    } catch (e) {
      if (!dialog.open) dialog.showModal();
      status(e.message, true);
      acknowledge('error', { message: String(e.message).slice(0, 300) });
    }
  }

  /* ---- pointer interaction ---- */
  const editor=createZoneEditor({ $, packet:()=>pending?.packet, redraw:()=>pending&&drawMap(), toCanvas, ratio:dpr });
  const pointer = e => {
    const r = map.getBoundingClientRect();
    return [(e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr()];
  };
  map.addEventListener('pointerdown', e => {
    if (!pending) return;
    const [x, y] = pointer(e),
      o = outlines(),
      [hx, hy] = toCanvas(...o.handle);
    if(editor.down(x,y,fromCanvas(x,y))){map.setPointerCapture(e.pointerId);return;}
    let mode = 'pan';
    if (Math.hypot(x - hx, y - hy) < 14 * dpr()) mode = 'rotate';
    else if (inPolygon(o.approach, ...fromCanvas(x, y))) mode = 'move';
    drag = { mode, x, y, view: { ...view }, placement: { ...pending.placement } };
    map.setPointerCapture(e.pointerId);
    map.style.cursor = mode === 'pan' ? 'grabbing' : mode === 'rotate' ? 'crosshair' : 'move';
  });
  map.addEventListener('pointermove', e => {
    if (!pending) return;
    const [x, y] = pointer(e);
    hover = fromCanvas(x, y);
    if(editor.move(hover))return;
    if (!drag) {
      const o = outlines(),
        [hx, hy] = toCanvas(...o.handle);
      map.style.cursor = Math.hypot(x - hx, y - hy) < 14 * dpr() ? 'crosshair' : inPolygon(o.approach, ...hover) ? 'move' : 'grab';
      drawMap();
      return;
    }
    const dx = (x - drag.x) / (view.scale * dpr()),
      dy = -(y - drag.y) / (view.scale * dpr());
    if (drag.mode === 'pan') {
      view.x = drag.view.x - dx;
      view.y = drag.view.y - dy;
      drawMap();
    } else if (drag.mode === 'move') {
      pending.placement.cx = drag.placement.cx + dx;
      pending.placement.cy = drag.placement.cy + dy;
      changed();
    } else {
      const [qx, qy] = fromCanvas(x, y);
      pending.placement.azimuth = (((Math.atan2(qx - pending.placement.cx, qy - pending.placement.cy) * 180) / Math.PI) % 360 + 360) % 360;
      changed();
    }
  });
  const release = () => {
    editor.up();
    drag = null;
    map.style.cursor = 'grab';
  };
  map.addEventListener('pointerup', release);
  map.addEventListener('pointercancel', release);
  map.addEventListener('pointerleave', () => {
    hover = null;
    if (pending && !drag) drawMap();
  });
  map.addEventListener(
    'wheel',
    e => {
      if (!pending) return;
      e.preventDefault();
      const [x, y] = pointer(e),
        before = fromCanvas(x, y);
      view.scale = Math.min(20, Math.max(0.05, view.scale * Math.exp(-e.deltaY * 0.0015)));
      const after = fromCanvas(x, y);
      view.x += before[0] - after[0];
      view.y += before[1] - after[1];
      drawMap();
    },
    { passive: false },
  );
  window.addEventListener('resize', () => dialog.open && pending && drawMap());

  /* ---- fields ---- */
  for (const key of ['azimuth', 'cx', 'cy']) {
    fields[key].addEventListener('input', () => {
      const v = parseFloat(fields[key].value);
      if (!pending || !Number.isFinite(v)) return;
      pending.placement[key] = key === 'azimuth' ? ((v % 360) + 360) % 360 : v;
      if (auto) pending.placement.zOffset = autoZOffset(pending.packet, draftConfig(), pending.placement);
      fields.zOffset.value = (Math.round(pending.placement.zOffset * 100) / 100).toString();
      drawMap();
    });
  }
  fields.zOffset.addEventListener('input', () => {
    const v = parseFloat(fields.zOffset.value);
    if (!pending || !Number.isFinite(v)) return;
    auto = false;
    pending.placement.zOffset = v;
    $('dem-auto').setAttribute('aria-pressed', 'false');
    $('dem-auto').classList.remove('on');
    drawMap();
  });
  $('dem-auto').onclick = () => {
    if (!pending) return;
    auto = true;
    changed();
  };
  for(const key of configKeys) $('dem-'+key).addEventListener('change',()=>{
    if(!pending)return;
    try {
      const values=Object.fromEntries(configKeys.map(k=>[k,$('dem-'+k).value]));
      pending.config=siteParameters(key==='grade'?{...pending.config,profile:'constant'}:pending.config,values);
      configError='';$('dem-apply').disabled=false;configFields();changed();
    } catch(e){configError=e.message;$('dem-apply').disabled=true;drawMap();}
  });
  $('dem-neutral').onclick=()=>{if(!pending)return;pending.config=siteBridge(pending.packet);configError='';$('dem-apply').disabled=false;configFields();changed();};
  $('dem-current').onclick=()=>{if(!pending)return;pending.config=structuredClone(getConfig());configError='';$('dem-apply').disabled=false;configFields();changed();};

  /* ---- sources ---- */
  $('dem-qa').onclick = () => {
    const base = qaUrl();
    qaWindow = window.open(base + (base.includes('?') ? '&' : '?') + 'bs3d=1', 'quickeratlas');
    status(
      qaWindow
        ? 'QuickerAtlas is open in another tab. Delimit the block on the satellite map and send it: it arrives here.'
        : 'The browser blocked the QuickerAtlas tab. Allow pop-ups for this site, or open a .bs3dterrain file instead.',
      !qaWindow,
    );
  };
  $('dem-file-button').onclick = () => $('dem-file').click();
  $('dem-file').onchange = async () => {
    const file = $('dem-file').files[0];
    $('dem-file').value = '';
    if (!file) return;
    status(`Reading ${file.name}…`);
    try {
      await accept(JSON.parse(await file.text()));
    } catch (e) {
      status(e instanceof SyntaxError ? 'This file is not a .bs3dterrain terrain file.' : e.message, true);
    }
  };
  $('dem-apply').onclick = async () => {
    if (!pending || busy || configError) return;
    if(editor.unfinished()){status('Finish or cancel the zone drawing before applying.',true);return;}
    busy = true;
    $('dem-apply').disabled = true;
    try {
      await apply({ packet: validatePacket(pending.packet), config: pending.config, placement: { ...pending.placement } });
      acknowledge('applied');
      dialog.close();
    } catch (e) {
      status(e.message, true);
      acknowledge('error', { message: String(e.message).slice(0, 300) });
    } finally {
      busy = false;
      $('dem-apply').disabled = false;
    }
  };
  $('dem-remove').onclick = async () => {
    await remove();
    pending = null;
    dialog.close();
  };

  // Messages from QuickerAtlas (or any allowed origin): accepted at any time, not only while the dialog is open.
  window.addEventListener('message', e => {
    if (!originAllowed(e.origin)) return;
    const d = e.data;
    if (d && typeof d === 'object' && d.type === 'bs3d-terrain') accept(d, e.origin, e.source);
  });

  function openDialog({ waiting = false } = {}) {
    const overlay = getOverlay();
    $('dem-remove').hidden = !overlay;
    $('dem-apply').textContent = overlay ? 'Apply to the project' : 'Create the bridge on this site';
    if (overlay && !pending) show(overlay.packet, { ...overlay.placement });
    else if (pending) {
      $('dem-place').hidden = false;
      $('dem-apply').disabled = false;
      syncFields();
    } else {
      $('dem-place').hidden = true;
      $('dem-apply').disabled = true;
      status(waiting ? 'Waiting for QuickerAtlas to send the block…' : '');
    }
    if (!dialog.open) dialog.showModal();
    if (pending) requestAnimationFrame(drawMap);
  }
  $('dem-open').onclick = () => openDialog();
  dialog.addEventListener('close', () => {
    acknowledge('closed');
    pending=null;drag=null;
    if (!getOverlay()) return;
    $('dem-open').classList.add('active');
  });

  return {
    open: openDialog,
    accept,
    refreshButton() {
      const on = !!getOverlay();
      $('dem-open').classList.toggle('active', on);
      $('dem-open').title = on ? 'Imported terrain in use · open to move the bridge or remove it' : 'Import MNT/MNS (QuickerAtlas)';
      $('dem-open').querySelector('span').textContent = on ? 'Imported terrain' : 'Import DTM/DSM';
    },
  };
}
