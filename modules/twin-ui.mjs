// BridgeSketch 3D · 0.7.0: « Bridge A / Bridge B » switch and the placement plan of bridge B.
// The switch exchanges the bridge being edited (twin.mjs, swapTwin): the whole parameters panel then edits that bridge.
// The plan is a top view in the frame of bridge A: A stays put, B is dragged (move) or turned by its round handle, and
// the three fields below hold the same values as numbers. Works with or without an imported terrain.
import { totalLength } from './geometry.mjs';
import { footprint } from './terrain-packet.mjs';
import { newTwin, twinConfig, swapTwin, mainRole, pairFromA, twinToA } from './twin.mjs';

const RAD = Math.PI / 180,
  COL = { A: '#102d41', B: '#D55E00' };

export function createTwinPanel({ $, getConfig, update, notify, switchBridge }) {
  const pad = $('twin-pad'),
    g = pad.getContext('2d');
  let draft = null, // placement being dragged: { spacing, shift, turn }
    drag = null,
    view = null; // { scale, ox, oy } of the last drawing
  const pair = () => pairFromA(getConfig()); // bridge A as the main configuration
  const placement = () => draft ?? pair().twin;
  const gapOf = (a, b, t) => Math.abs(t.spacing) - a.width / 2 - b.width / 2;

  // Apply a placement of B (given in A's frame), whichever bridge is being edited.
  async function applyPlacement(p, editKey = 'twin-place') {
    const c = getConfig(),
      a = pair(),
      next = { ...a, twin: { ...a.twin, ...p } };
    try {
      await update(mainRole(c) === 'B' ? swapTwin(next) : next, { editKey, refresh: mainRole(c) === 'B' });
    } catch (e) {
      notify(e.message, true);
    }
    draft = null;
    refresh();
  }

  function drawPad() {
    const c = getConfig();
    if (!c.twin) return;
    const a = pair(),
      b = twinConfig(a),
      t = placement(),
      ratio = Math.min(2, window.devicePixelRatio || 1),
      w = pad.clientWidth || 300,
      h = pad.clientHeight || 200;
    if (pad.width !== Math.round(w * ratio) || pad.height !== Math.round(h * ratio)) {
      pad.width = Math.round(w * ratio);
      pad.height = Math.round(h * ratio);
    }
    const fa = footprint(a, 0, { approaches: false }),
      fb = footprint(b, 0, { approaches: false }).map(([x, z]) => twinToA(t, x, z)),
      ra = footprint(a, 0).map(p => p),
      rb = footprint(b, 0).map(([x, z]) => twinToA(t, x, z));
    // The view is fixed while dragging, so the bridge follows the pointer instead of the plan rescaling under it.
    if (!drag || !view) {
      const all = [...fa, ...fb],
        xs = all.map(p => p[0]),
        zs = all.map(p => p[1]),
        cx = (Math.min(...xs) + Math.max(...xs)) / 2,
        cz = (Math.min(...zs) + Math.max(...zs)) / 2,
        span = Math.max(Math.max(...xs) - Math.min(...xs), 30),
        depth = Math.max(Math.max(...zs) - Math.min(...zs), 20),
        scale = Math.min((w - 36) / (span * 1.25), (h - 40) / (depth * 1.9));
      view = { scale, ox: w / 2 - cx * scale, oy: h / 2 - cz * scale };
    }
    const X = x => (view.ox + x * view.scale) * ratio,
      Y = z => (view.oy + z * view.scale) * ratio,
      path = pts => {
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
        g.closePath();
      };
    g.clearRect(0, 0, pad.width, pad.height);
    // 10 m grid
    g.lineWidth = 1;
    g.strokeStyle = '#dfe7ec';
    const step = view.scale * 10 < 9 ? 50 : 10;
    for (let x = Math.ceil(-view.ox / view.scale / step) * step; X(x) < pad.width; x += step) {
      g.beginPath();
      g.moveTo(X(x), 0);
      g.lineTo(X(x), pad.height);
      g.stroke();
    }
    for (let z = Math.ceil(-view.oy / view.scale / step) * step; Y(z) < pad.height; z += step) {
      g.beginPath();
      g.moveTo(0, Y(z));
      g.lineTo(pad.width, Y(z));
      g.stroke();
    }
    const bridge = (road, deck, role, active) => {
      path(road);
      g.fillStyle = '#c9d3da';
      g.fill();
      path(deck);
      g.fillStyle = role === 'B' ? '#f6d5bd' : '#cfdbe4';
      g.fill();
      g.lineWidth = (active ? 2.5 : 1.5) * ratio;
      g.strokeStyle = COL[role];
      if (role === 'B') g.setLineDash([6 * ratio, 3 * ratio]);
      g.stroke();
      g.setLineDash([]);
    };
    const gap = gapOf(a, b, t);
    bridge(ra, fa, 'A', false);
    bridge(rb, fb, 'B', true);
    const label = (role, x, z) => {
      g.font = `700 ${12 * ratio}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = COL[role];
      g.fillText(role, X(x), Y(z));
    };
    label('A', 0, 0);
    const [bx, bz] = twinToA(t, 0, 0);
    label('B', bx, bz);
    // turn handle at the end of B
    const [hx, hz] = twinToA(t, totalLength(b) / 2, 0);
    g.beginPath();
    g.arc(X(hx), Y(hz), 6.5 * ratio, 0, 2 * Math.PI);
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = 2.5 * ratio;
    g.strokeStyle = COL.B;
    g.stroke();
    // scale bar
    const bar = step * view.scale * ratio;
    g.fillStyle = '#52636d';
    g.fillRect(8 * ratio, pad.height - 9 * ratio, bar, 2 * ratio);
    g.font = `${10 * ratio}px system-ui, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillText(`${step} m`, 8 * ratio, pad.height - 11 * ratio);
    $('twin-check').textContent =
      (gap >= 0 ? `Clear gap between the decks: ${gap.toFixed(2)} m` : `⚠ The decks overlap by ${(-gap).toFixed(2)} m`) +
      (Math.abs(t.turn) > 0.01 ? ` at B's centre · B turned ${t.turn.toFixed(1)}°` : ' · parallel') +
      (Math.abs(t.shift) > 0.01 ? ` · B shifted ${t.shift.toFixed(1)} m along A` : '') +
      '.';
    $('twin-check').classList.toggle('warn', gap < 0);
  }

  function refresh() {
    const c = getConfig(),
      t = c.twin,
      role = mainRole(c);
    $('bridge-a').setAttribute('aria-pressed', String(role === 'A'));
    $('bridge-b').setAttribute('aria-pressed', String(!!t && role === 'B'));
    $('bridge-b').classList.toggle('add', !t);
    $('bridge-b').querySelector('span').textContent = t ? 'Bridge B' : 'Add bridge B';
    $('bridge-b').title = t ? 'Edit bridge B: every parameter below then belongs to bridge B' : 'Add a second, independent bridge: it starts as an exact copy of bridge A';
    $('bridge-a').title = t ? 'Edit bridge A: every parameter below then belongs to bridge A' : 'The bridge being edited';
    $('twin-box').hidden = !t;
    document.body.classList.toggle('editing-b', !!t && role === 'B');
    if (!t) return;
    const a = pair(),
      b = twinConfig(a),
      p = placement(),
      set = (id, v) => {
        if (document.activeElement !== $(id)) $(id).value = String(Math.round(v * 100) / 100);
      };
    set('twin-gap', gapOf(a, b, p));
    set('twin-shift', p.shift);
    set('twin-turn', p.turn);
    $('twin-side').textContent = p.spacing >= 0 ? 'B is on the right of A · swap sides' : 'B is on the left of A · swap sides';
    $('twin-editing').textContent = role === 'B' ? 'You are editing bridge B. The Site tab (terrain, sky, weather) is shared by both bridges; the crossings belong to bridge A.' : 'You are editing bridge A. Bridge B keeps its own parameters.';
    drawPad();
  }

  // --- drag on the plan: body of B = move, round handle = turn
  const toPlan = e => {
    const r = pad.getBoundingClientRect();
    return [(e.clientX - r.left - view.ox) / view.scale, (e.clientY - r.top - view.oy) / view.scale];
  };
  const inside = (pts, [x, z]) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      if (pts[i][1] > z !== pts[j][1] > z && x < ((pts[j][0] - pts[i][0]) * (z - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) hit = !hit;
    return hit;
  };
  pad.addEventListener('pointerdown', e => {
    if (!getConfig().twin || !view) return;
    const a = pair(),
      b = twinConfig(a),
      t = { ...a.twin },
      p = toPlan(e),
      [hx, hz] = twinToA(t, totalLength(b) / 2, 0),
      onHandle = Math.hypot(p[0] - hx, p[1] - hz) * view.scale < 14,
      onBody = inside(footprint(b, 2).map(([x, z]) => twinToA(t, x, z)), p);
    if (!onHandle && !onBody) return;
    drag = { mode: onHandle ? 'turn' : 'move', start: p, t, moved: false };
    draft = { spacing: t.spacing, shift: t.shift, turn: t.turn };
    pad.setPointerCapture(e.pointerId);
    pad.classList.add('dragging');
    e.preventDefault();
  });
  pad.addEventListener('pointermove', e => {
    if (!view) return;
    if (!drag) {
      // cursor feedback
      const c = getConfig();
      if (!c.twin) return;
      const a = pair(),
        b = twinConfig(a),
        p = toPlan(e),
        [hx, hz] = twinToA(a.twin, totalLength(b) / 2, 0);
      pad.style.cursor = Math.hypot(p[0] - hx, p[1] - hz) * view.scale < 14 ? 'crosshair' : inside(footprint(b, 2).map(([x, z]) => twinToA(a.twin, x, z)), p) ? 'grab' : 'default';
      return;
    }
    const p = toPlan(e),
      t = drag.t;
    drag.moved = true;
    if (drag.mode === 'move') {
      let shift = t.shift + p[0] - drag.start[0],
        spacing = t.spacing + p[1] - drag.start[1];
      // light snapping: aligned with A, and whole 0.5 m (hold Alt for a free move)
      if (!e.altKey) {
        shift = Math.abs(shift) < 1.2 ? 0 : Math.round(shift * 2) / 2;
        spacing = Math.round(spacing * 2) / 2;
      }
      draft = { spacing: Math.max(-400, Math.min(400, spacing)), shift: Math.max(-400, Math.min(400, shift)), turn: t.turn };
    } else {
      // angle of the pointer seen from B's origin; scene rotation is clockwise from above for a positive turn
      let turn = Math.atan2(p[1] - t.spacing, p[0] - t.shift) / RAD;
      if (turn > 90) turn -= 180;
      if (turn < -90) turn += 180;
      if (!e.altKey) turn = Math.abs(turn) < 1.5 ? 0 : Math.round(turn * 2) / 2;
      draft = { spacing: t.spacing, shift: t.shift, turn: Math.max(-90, Math.min(90, turn)) };
    }
    refresh();
  });
  const end = e => {
    if (!drag) return;
    const moved = drag.moved,
      p = draft;
    drag = null;
    pad.classList.remove('dragging');
    try {
      pad.releasePointerCapture(e.pointerId);
    } catch {}
    if (moved && p) applyPlacement(p);
    else {
      draft = null;
      refresh();
    }
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  new ResizeObserver(() => {
    if (!$('twin-box').hidden && !drag) {
      view = null;
      drawPad();
    }
  }).observe(pad);

  // --- numbers
  $('twin-box').addEventListener('change', e => {
    const id = e.target.id;
    if (!['twin-gap', 'twin-shift', 'twin-turn'].includes(id)) return;
    e.stopPropagation();
    const v = Number(String(e.target.value).replace(',', '.'));
    if (!Number.isFinite(v)) return refresh();
    const a = pair(),
      b = twinConfig(a),
      t = a.twin;
    const p = { spacing: t.spacing, shift: t.shift, turn: t.turn };
    if (id === 'twin-gap') p.spacing = (t.spacing < 0 ? -1 : 1) * (v + a.width / 2 + b.width / 2);
    else if (id === 'twin-shift') p.shift = v;
    else p.turn = Math.max(-90, Math.min(90, v));
    view = null;
    applyPlacement(p, id);
  });
  $('twin-side').onclick = () => {
    const t = pair().twin;
    view = null;
    applyPlacement({ spacing: -t.spacing, shift: t.shift, turn: t.turn });
  };
  $('twin-align').onclick = () => {
    const a = pair(),
      b = twinConfig(a),
      t = a.twin;
    view = null;
    applyPlacement({ spacing: (t.spacing < 0 ? -1 : 1) * (3 + a.width / 2 + b.width / 2), shift: 0, turn: 0 });
  };

  // --- switch, add, copy, remove
  $('bridge-a').onclick = () => switchBridge('A');
  $('bridge-b').onclick = async () => {
    const c = getConfig();
    if (c.twin) return switchBridge('B');
    try {
      await update({ ...structuredClone(c), twin: newTwin(c) }, { editKey: 'twin-add' });
      view = null;
      refresh();
      notify('Bridge B added: an exact copy of bridge A, 3 m clear on its right. Drag it on the plan, then click « Bridge B » to edit it on its own.');
    } catch (e) {
      notify(e.message, true);
    }
  };
  $('twin-recopy').onclick = async () => {
    const a = pair(),
      next = { ...a, twin: { ...a.twin, bridge: newTwin(a).bridge } };
    try {
      await update(mainRole(getConfig()) === 'B' ? swapTwin(next) : next, { editKey: 'twin-recopy', refresh: true });
      notify('Bridge B is again an exact copy of bridge A (its position is kept). Undo brings the previous bridge B back.');
    } catch (e) {
      notify(e.message, true);
    }
  };
  $('twin-remove').onclick = async () => {
    try {
      await update({ ...structuredClone(pair()), twin: null }, { editKey: 'twin-remove', refresh: true });
      notify('Bridge B removed. Undo brings it back.');
    } catch (e) {
      notify(e.message, true);
    }
  };
  return { refresh };
}
