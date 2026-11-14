// BridgeSketch 3D · 0.8.0: up to four bridges.
// The bridge bar (just above the parameter tabs) chooses the bridge edited by the whole panel (twin.mjs, switchTo), adds a
// bridge and opens « Bridges on the site »: a top view of the site (the imported terrain when there is one) where the
// bridges are placed, added, removed, and where parameters are copied from one bridge to another. The window edits a
// draft: the 3D scene is rebuilt once, on « Apply » (moving a bridge live rebuilt the whole scene at every step).
import { totalLength } from './geometry.mjs';
import { footprint } from './terrain-packet.mjs';
import { hillshade } from './dem-ui.mjs';
import {
  ROLES, ROLE_COLOURS, REACH, addBridge, bridgeConfig, bridgeKeys, clearanceOf, copyBetween, mainRole, others, pairFromA,
  placementOf, removeBridge, rolesOf, switchTo, twinToA,
} from './twin.mjs';

const RAD = Math.PI / 180,
  GROUPS = { model: 'Spans and alignment', deck: 'Deck', structure: 'Structure', supports: 'Supports' };
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const round = v => Math.round(v * 100) / 100;

export function createTwinPanel({ $, getConfig, getOverlay, update, notify, switchBridge }) {
  const dialog = $('bridges-dialog'),
    map = $('br-map'),
    g = map.getContext('2d');
  let draft = null, // the group being arranged, bridge A as the main configuration
    picked = 'B',
    view = null, // { scale, ox, oy } (CSS pixels)
    drag = null,
    backdrop = null; // { packet, image } of the imported site, drawn under the bridges

  // Parameter keys of each tab, read from the form (so a new field is copied with its tab).
  const groupKeys = group => {
    const keys = new Set([...document.querySelectorAll(`#panel-${group} [name]`)].map(el => el.name));
    if (group === 'model') keys.add('spans');
    const allowed = new Set(bridgeKeys());
    return [...keys].filter(k => allowed.has(k) && k !== 'name');
  };

  /* ---- bridge bar ---- */
  function refresh() {
    const c = getConfig(),
      roles = rolesOf(c),
      main = mainRole(c),
      focused = $('bridge-chips').contains(document.activeElement);
    $('bridge-chips').innerHTML = roles
      .map(r => {
        const name = bridgeConfig(c, r)?.name || `Bridge ${r}`;
        return `<button type="button" role="radio" data-role="${r}" aria-checked="${r === main}" tabindex="${r === main ? 0 : -1}" title="${esc(`Edit bridge ${r}: ${name}`)}" style="--role:${ROLE_COLOURS[r]}"><b>${r}</b>${r === main ? `<span>${esc(roles.length > 1 ? name : 'Bridge A')}</span>` : ''}</button>`;
      })
      .join('');
    $('bridge-add').disabled = roles.length >= ROLES.length;
    $('bridge-add').title = roles.length >= ROLES.length ? 'Four bridges at most' : 'Add a bridge: a copy of the one being edited, beside the group';
    $('bridge-arrange').hidden = roles.length < 2;
    document.body.dataset.editing = roles.length > 1 ? main : '';
    if (focused) $('bridge-chips').querySelector(`[data-role="${main}"]`)?.focus();
  }
  $('bridge-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-role]');
    if (b) switchBridge(b.dataset.role);
  });
  // radio group: arrow keys move to the next bridge and edit it
  $('bridge-chips').addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const chips = [...$('bridge-chips').querySelectorAll('[data-role]')],
      k = chips.indexOf(document.activeElement);
    if (k < 0) return;
    e.preventDefault();
    const next = chips[(k + step + chips.length) % chips.length];
    next.focus();
    switchBridge(next.dataset.role);
  });
  $('bridge-add').onclick = async () => {
    const c = getConfig(),
      next = addBridge(c);
    if (!next) return;
    const role = rolesOf(next).find(r => !rolesOf(c).includes(r));
    try {
      await update(next, { editKey: 'bridge-add' });
      refresh();
      notify(`Bridge ${role} added: a copy of bridge ${mainRole(c)}, 3 m beside the group. « Arrange » places it on the site.`);
    } catch (e) {
      notify(e.message, true);
    }
  };
  $('bridge-arrange').onclick = () => open();

  /* ---- « Bridges on the site » ---- */
  function open(role) {
    draft = pairFromA(getConfig());
    picked = role && role !== 'A' ? role : (others(draft)[0]?.role ?? 'A');
    view = null;
    const ov = getOverlay();
    if (ov?.packet && backdrop?.packet !== ov.packet) {
      backdrop = { packet: ov.packet, image: null, shade: null };
      if (ov.packet.image) {
        const img = new Image();
        img.onload = () => {
          if (backdrop?.packet === ov.packet) (backdrop.image = img), draw();
        };
        img.src = ov.packet.image.dataUrl;
      } else backdrop.shade = hillshade(ov.packet);
    }
    if (!ov) backdrop = null;
    dialog.showModal();
    sync();
  }
  const configOf = r => bridgeConfig(draft, r);
  const placement = r => (r === 'A' ? { spacing: 0, shift: 0, turn: 0 } : placementOf(draft, r));
  function edit(next, message) {
    draft = next;
    if (!rolesOf(draft).includes(picked)) picked = others(draft)[0]?.role ?? 'A';
    sync();
    if (message) $('br-status').textContent = message;
  }
  function setPlacement(role, p) {
    if (role === 'A') return;
    const clean = {
      spacing: Math.max(-REACH, Math.min(REACH, p.spacing)),
      shift: Math.max(-REACH, Math.min(REACH, p.shift)),
      turn: ((((p.turn + 180) % 360) + 360) % 360) - 180,
    };
    draft = { ...draft, twin: { ...draft.twin, others: others(draft).map(o => (o.role === role ? { ...o, ...clean } : o)) } };
  }

  function sync() {
    if (!draft) return;
    const roles = rolesOf(draft),
      a = configOf('A');
    $('br-list').innerHTML = roles
      .map(r => {
        const c = configOf(r),
          spans = c.spans.map(s => round(s.length)).join(' + ');
        return `<li class="${r === picked ? 'on' : ''}" style="--role:${ROLE_COLOURS[r]}"><button type="button" class="br-pick" data-pick="${r}" aria-pressed="${r === picked}"><b>${r}</b><span><strong>${esc(c.name || `Bridge ${r}`)}</strong><small>${spans} m · ${round(c.width)} m wide${r === 'A' ? ' · owns the site' : ''}</small></span></button>${r === 'A' ? '' : `<button type="button" class="br-remove" data-remove="${r}" title="Remove bridge ${r}" aria-label="Remove bridge ${r}">×</button>`}</li>`;
      })
      .join('');
    $('br-add').disabled = roles.length >= ROLES.length;
    // position of the picked bridge
    const p = placement(picked),
      fixed = picked === 'A';
    $('br-place-role').textContent = `bridge ${picked}`;
    for (const [id, key] of [['br-shift', 'shift'], ['br-spacing', 'spacing'], ['br-turn', 'turn']]) {
      $(id).disabled = fixed;
      if (document.activeElement !== $(id)) $(id).value = String(round(p[key]));
    }
    $('br-parallel').disabled = $('br-flip').disabled = fixed;
    if (fixed) $('br-check').textContent = 'Bridge A owns the site and stays put; on an imported terrain it is placed from « Imported terrain ».';
    else {
      const gap = clearanceOf(a, configOf(picked), p);
      $('br-check').textContent =
        (gap >= 0 ? `${round(gap)} m clear of bridge A` : `⚠ Overlaps bridge A by ${round(-gap)} m`) + ` (square to A at the centre of ${picked})` + (Math.abs(p.turn) > 0.01 ? ` · turned ${round(p.turn)}°` : ' · parallel to A') + '.';
      $('br-check').classList.toggle('warn', gap < 0);
    }
    // copy
    const options = roles.map(r => `<option value="${r}">Bridge ${r}</option>`).join(''),
      from = roles.includes($('br-from').value) ? $('br-from').value : 'A',
      to = roles.includes($('br-to').value) && $('br-to').value !== from ? $('br-to').value : roles.find(r => r !== from);
    $('br-from').innerHTML = options;
    $('br-to').innerHTML = options;
    $('br-from').value = from;
    $('br-to').value = to;
    $('br-copy').disabled = !to || from === to || ![...dialog.querySelectorAll('[name="br-group"]:checked')].length;
    draw();
  }

  /* ---- top view ---- */
  const ratio = () => Math.min(2, window.devicePixelRatio || 1);
  const shapes = r => {
    const c = configOf(r),
      p = placement(r),
      to = pts => pts.map(([x, z]) => twinToA(p, x, z));
    return { c, p, deck: to(footprint(c, 0, { approaches: false })), road: to(footprint(c, 0)), body: to(footprint(c, 2)), handle: twinToA(p, totalLength(c) / 2 + 6, 0) };
  };
  function fit() {
    const w = map.clientWidth || 600,
      h = map.clientHeight || 420,
      pts = rolesOf(draft).flatMap(r => shapes(r).road),
      xs = pts.map(q => q[0]),
      zs = pts.map(q => q[1]),
      cx = (Math.min(...xs) + Math.max(...xs)) / 2,
      cz = (Math.min(...zs) + Math.max(...zs)) / 2,
      span = Math.max(Math.max(...xs) - Math.min(...xs), 60),
      depth = Math.max(Math.max(...zs) - Math.min(...zs), 60),
      scale = Math.min((w - 40) / (span * 1.3), (h - 40) / (depth * 1.3));
    view = { scale, ox: w / 2 - cx * scale, oy: h / 2 - cz * scale };
  }
  function draw() {
    if (!draft || !dialog.open) return;
    const r = ratio(),
      w = map.clientWidth || 600,
      h = map.clientHeight || 420;
    if (map.width !== Math.round(w * r) || map.height !== Math.round(h * r)) {
      map.width = Math.round(w * r);
      map.height = Math.round(h * r);
    }
    if (!view) fit();
    const X = x => (view.ox + x * view.scale) * r,
      Y = z => (view.oy + z * view.scale) * r,
      path = pts => {
        g.beginPath();
        pts.forEach((q, i) => (i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1]))));
        g.closePath();
      };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = backdrop ? '#26323a' : '#f4f7f9';
    g.fillRect(0, 0, map.width, map.height);
    const ov = getOverlay();
    if (backdrop && ov) {
      // The site image (or its relief) in A's frame: packet (x east, y north) -> scene (x along A, z to its right).
      const src = backdrop.image ?? backdrop.shade;
      if (src) {
        const { grid } = backdrop.packet,
          pl = ov.placement,
          sA = Math.sin(pl.azimuth * RAD),
          cA = Math.cos(pl.azimuth * RAD),
          gx0 = grid.x0 - grid.cell / 2,
          gy1 = grid.y0 + grid.cell / 2,
          sx = (grid.cols * grid.cell) / src.width,
          sy = (grid.rows * grid.cell) / src.height,
          x0 = sA * (gx0 - pl.cx) + cA * (gy1 - pl.cy),
          z0 = cA * (gx0 - pl.cx) - sA * (gy1 - pl.cy),
          k = r * view.scale;
        g.setTransform(k * sA * sx, k * cA * sx, -k * cA * sy, k * sA * sy, r * (view.ox + view.scale * x0), r * (view.oy + view.scale * z0));
        g.imageSmoothingEnabled = true;
        g.drawImage(src, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else {
      // plain site: a grid
      g.strokeStyle = '#dfe7ec';
      g.lineWidth = 1;
      const step = view.scale * 10 < 9 ? 50 : 10;
      for (let x = Math.ceil(-view.ox / view.scale / step) * step; X(x) < map.width; x += step) g.beginPath(), g.moveTo(X(x), 0), g.lineTo(X(x), map.height), g.stroke();
      for (let z = Math.ceil(-view.oy / view.scale / step) * step; Y(z) < map.height; z += step) g.beginPath(), g.moveTo(0, Y(z)), g.lineTo(map.width, Y(z)), g.stroke();
    }
    for (const role of rolesOf(draft)) {
      const s = drag?.role === role && drag.preview ? drag.preview : shapes(role),
        on = role === picked,
        col = ROLE_COLOURS[role];
      path(s.road);
      g.fillStyle = backdrop ? 'rgba(255,255,255,0.28)' : '#c9d3da';
      g.fill();
      path(s.deck);
      g.fillStyle = col;
      g.globalAlpha = on ? 0.85 : 0.6;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = (on ? 2.5 : 1.5) * r;
      g.strokeStyle = '#fff';
      g.stroke();
      const [lx, lz] = twinToA(s.p, 0, 0);
      g.font = `700 ${13 * r}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 3 * r;
      g.strokeStyle = col;
      g.strokeText(role, X(lx), Y(lz));
      g.fillStyle = '#fff';
      g.fillText(role, X(lx), Y(lz));
      if (role !== 'A' && on) {
        const [hx, hz] = s.handle,
          [mx, mz] = twinToA(s.p, totalLength(s.c) / 2, 0);
        g.beginPath();
        g.moveTo(X(mx), Y(mz));
        g.lineTo(X(hx), Y(hz));
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5 * r;
        g.stroke();
        g.beginPath();
        g.arc(X(hx), Y(hz), 7 * r, 0, 2 * Math.PI);
        g.fillStyle = '#ffb347';
        g.fill();
        g.stroke();
      }
    }
    // scale bar
    const metres = [10, 20, 50, 100, 200, 500, 1000].find(m => m * view.scale >= 70) ?? 1000;
    g.fillStyle = backdrop ? '#fff' : '#52636d';
    g.fillRect(10 * r, map.height - 16 * r, metres * view.scale * r, 3 * r);
    g.font = `${11 * r}px system-ui, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillText(`${metres} m`, 10 * r, map.height - 21 * r);
  }

  /* ---- pointer: a bridge body = pick and move, round handle = turn, elsewhere = pan; wheel = zoom ---- */
  const toPlan = e => {
    const b = map.getBoundingClientRect();
    return [(e.clientX - b.left - view.ox) / view.scale, (e.clientY - b.top - view.oy) / view.scale];
  };
  const inside = (pts, [x, z]) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      if (pts[i][1] > z !== pts[j][1] > z && x < ((pts[j][0] - pts[i][0]) * (z - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) hit = !hit;
    return hit;
  };
  const hitTest = q => {
    if (picked !== 'A') {
      const s = shapes(picked);
      if (Math.hypot(q[0] - s.handle[0], q[1] - s.handle[1]) * view.scale < 12) return { role: picked, mode: 'turn' };
    }
    // the picked bridge first, then the others (later letters on top)
    for (const role of [picked, ...rolesOf(draft).reverse()]) if (inside(shapes(role).body, q)) return { role, mode: role === 'A' ? 'pick' : 'move' };
    return null;
  };
  map.addEventListener('pointerdown', e => {
    if (!view) return;
    const q = toPlan(e),
      hit = hitTest(q);
    if (hit && hit.role !== picked) {
      picked = hit.role;
      sync();
    }
    drag = hit && hit.mode !== 'pick' ? { ...hit, start: q, p: { ...placement(hit.role) }, moved: false } : { mode: 'pan', sx: e.clientX, sy: e.clientY, view: { ...view } };
    map.setPointerCapture(e.pointerId);
    map.classList.add('dragging');
    e.preventDefault();
  });
  map.addEventListener('pointermove', e => {
    if (!view) return;
    if (!drag) {
      const hit = hitTest(toPlan(e));
      map.style.cursor = hit?.mode === 'turn' ? 'crosshair' : hit?.mode === 'move' ? 'grab' : hit ? 'pointer' : 'default';
      return;
    }
    if (drag.mode === 'pan') {
      view = { ...drag.view, ox: drag.view.ox + e.clientX - drag.sx, oy: drag.view.oy + e.clientY - drag.sy };
      return draw();
    }
    const q = toPlan(e),
      p = drag.p;
    let next;
    if (drag.mode === 'move') {
      let shift = p.shift + q[0] - drag.start[0],
        spacing = p.spacing + q[1] - drag.start[1];
      // light snapping: aligned with A, whole 0.5 m (Alt for a free move)
      if (!e.altKey) {
        shift = Math.abs(shift) < 1.2 ? 0 : Math.round(shift * 2) / 2;
        spacing = Math.round(spacing * 2) / 2;
      }
      next = { ...p, shift, spacing };
    } else {
      let turn = Math.atan2(q[1] - p.spacing, q[0] - p.shift) / RAD;
      if (!e.altKey) turn = Math.abs(turn) < 1.5 ? 0 : Math.round(turn * 2) / 2;
      next = { ...p, turn };
    }
    drag.moved = true;
    setPlacement(drag.role, next);
    sync();
  });
  const end = e => {
    if (!drag) return;
    drag = null;
    map.classList.remove('dragging');
    try {
      map.releasePointerCapture(e.pointerId);
    } catch {}
    sync();
  };
  map.addEventListener('pointerup', end);
  map.addEventListener('pointercancel', end);
  map.addEventListener(
    'wheel',
    e => {
      if (!view) return;
      e.preventDefault();
      const b = map.getBoundingClientRect(),
        mx = e.clientX - b.left,
        my = e.clientY - b.top,
        k = Math.exp(-Math.sign(e.deltaY) * 0.15),
        scale = Math.max(0.02, Math.min(40, view.scale * k));
      view = { scale, ox: mx - ((mx - view.ox) * scale) / view.scale, oy: my - ((my - view.oy) * scale) / view.scale };
      draw();
    },
    { passive: false },
  );
  new ResizeObserver(() => dialog.open && draw()).observe(map);

  /* ---- list, numbers, copy, apply ---- */
  $('br-list').addEventListener('click', e => {
    const pick = e.target.closest('[data-pick]'),
      gone = e.target.closest('[data-remove]');
    if (pick) {
      picked = pick.dataset.pick;
      sync();
    } else if (gone) edit(removeBridge(draft, gone.dataset.remove), `Bridge ${gone.dataset.remove} removed (Cancel keeps it).`);
  });
  $('br-add').onclick = () => {
    const next = addBridge(draft);
    if (!next) return;
    const role = rolesOf(next).find(r => !rolesOf(draft).includes(r));
    picked = role;
    view = null;
    edit(next, `Bridge ${role} added: a copy of bridge A. Drag it where it belongs.`);
  };
  dialog.querySelector('.br-fields').addEventListener('change', e => {
    const key = { 'br-shift': 'shift', 'br-spacing': 'spacing', 'br-turn': 'turn' }[e.target.id];
    if (!key || picked === 'A') return;
    e.stopPropagation();
    const v = Number(String(e.target.value).replace(',', '.'));
    if (Number.isFinite(v)) setPlacement(picked, { ...placement(picked), [key]: v });
    view = null;
    sync();
  });
  $('br-parallel').onclick = () => {
    const a = configOf('A'),
      b = configOf(picked),
      p = placement(picked);
    setPlacement(picked, { spacing: (p.spacing < 0 ? -1 : 1) * (3 + a.width / 2 + b.width / 2), shift: 0, turn: 0 });
    view = null;
    sync();
  };
  $('br-flip').onclick = () => {
    const p = placement(picked);
    setPlacement(picked, { ...p, spacing: -p.spacing });
    view = null;
    sync();
  };
  dialog.addEventListener('change', e => {
    if (['br-from', 'br-to'].includes(e.target.id) || e.target.name === 'br-group') {
      e.stopPropagation();
      sync();
    }
  });
  $('br-copy').onclick = () => {
    const from = $('br-from').value,
      to = $('br-to').value,
      groups = [...dialog.querySelectorAll('[name="br-group"]:checked')].map(el => el.value),
      keys = groups.flatMap(groupKeys);
    try {
      edit(copyBetween(draft, from, to, keys), `Bridge ${to} takes the ${groups.map(k => GROUPS[k].toLowerCase()).join(', ')} of bridge ${from}.`);
    } catch (e) {
      $('br-status').textContent = `⚠ ${e.message}`;
    }
  };
  $('br-apply').onclick = async () => {
    const c = getConfig(),
      keep = rolesOf(draft).includes(mainRole(c)) ? mainRole(c) : 'A',
      next = switchTo(draft, keep);
    dialog.close();
    try {
      await update(next, { refresh: true, editKey: 'bridges' });
      notify('Bridges updated. Undo brings the previous arrangement back.');
    } catch (e) {
      notify(e.message, true);
    }
    draft = null;
    refresh();
  };
  dialog.addEventListener('close', () => {
    draft = null;
    $('br-status').textContent = '';
  });

  return { refresh, open };
}
