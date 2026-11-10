// BridgeSketch 3D · site zones of an imported terrain, edited on the map of the terrain dialog (a draft packet only:
// canceling the dialog never edits the displayed site).
// 0.7.0: direct manipulation. Click a zone to select it (Shift + click adds, Shift + drag frames several), drag the
// selection to move it, Delete removes it, Ctrl + Z undoes. One selected zone shows its vertices: drag one to move it,
// double-click one to remove it, double-click an edge to add one. The lists and coordinate fields of 0.6.9 are gone.
import { serializePacket, gridBounds } from './terrain-packet.mjs';

export const zoneNames = { water: 'Lake / pond', river: 'River', forest: 'Forest', grass: 'Grass', road: 'Road' };
export function validZonePoints(points, road = false) {
  if (points.length < (road ? 2 : 3) || points.some(p => p.some(v => !Number.isFinite(v)))) return false;
  if (road) return points.slice(1).some((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]) > 0.1);
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  return Math.abs(area) >= 1;
}
const segDist = (p, a, b) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l2 = dx * dx + dy * dy,
    t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const inPoly = (pts, [x, y]) => {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    if (pts[i][1] > y !== pts[j][1] > y && x < ((pts[j][0] - pts[i][0]) * (y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) hit = !hit;
  return hit;
};
const areaOf = pts => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2;
};

export function createZoneEditor({ $, packet, redraw, toCanvas, ratio, scale }) {
  let selected = new Set(), // zone objects
    drawing = null,
    action = null, // { kind: 'vertex' | 'zones' | 'frame', … }
    history = [];
  const zones = () => packet()?.zones ?? [];
  const ptsOf = z => z.line ?? z.polygon;
  const one = () => (selected.size === 1 ? [...selected][0] : null);
  const message = s => ($('dem-zone-help').textContent = s);
  const remember = () => {
    history.push({ zones: structuredClone(zones()), selected: [...selected].map(z => zones().indexOf(z)) });
    if (history.length > 40) history.shift();
  };
  const bounded = p => {
    const b = gridBounds(packet());
    return [Math.max(b.x0, Math.min(b.x1, p[0])), Math.max(b.y0, Math.min(b.y1, p[1]))];
  };
  const idle = 'Click a zone to select it (Shift adds, Shift + drag frames several). Drag to move, Delete to remove, Ctrl + Z to undo.';

  function refresh() {
    const p = packet();
    if (!p) return;
    const sel = [...selected],
      n = sel.length,
      polys = sel.filter(z => z.polygon),
      roads = sel.filter(z => z.line),
      z = one();
    $('dem-zone-count').textContent = n ? `${n} zone${n > 1 ? 's' : ''} selected` : `${p.zones.length} zone${p.zones.length === 1 ? '' : 's'} on the site`;
    $('dem-zone-props').hidden = !n || !!drawing;
    const type = $('dem-zone-type'),
      width = $('dem-zone-width'),
      level = $('dem-zone-level');
    type.closest('label').hidden = !(n && polys.length === n);
    if (polys.length) type.value = polys.every(q => q.type === polys[0].type) ? polys[0].type : '';
    width.closest('label').hidden = !(n && roads.length === n);
    if (roads.length) width.value = roads.every(q => q.width === roads[0].width) ? roads[0].width : '';
    level.closest('label').hidden = !(z && ['water', 'river'].includes(z.type));
    if (z) level.value = z.level ?? '';
    $('dem-zone-delete').disabled = !n || !!drawing;
    $('dem-zone-delete').textContent = n > 1 ? `Delete ${n} zones` : 'Delete';
    $('dem-zone-undo').disabled = !history.length || !!drawing;
    $('dem-zone-draw').hidden = !!drawing;
    $('dem-zone-drawing').hidden = !drawing;
    if (drawing) $('dem-zone-finish').disabled = drawing.points.length < (drawing.type === 'road' ? 2 : 3);
    redraw();
  }
  const select = list => {
    selected = new Set(list);
    refresh();
  };
  function remove() {
    if (!selected.size || drawing) return;
    remember();
    const n = selected.size;
    packet().zones = zones().filter(z => !selected.has(z));
    selected = new Set();
    message(`${n} zone${n > 1 ? 's' : ''} deleted. Ctrl + Z brings ${n > 1 ? 'them' : 'it'} back.`);
    refresh();
  }
  function undo() {
    const h = history.pop();
    if (!h || drawing) return;
    packet().zones = h.zones;
    selected = new Set(h.selected.map(i => packet().zones[i]).filter(Boolean));
    message('Undone.');
    refresh();
  }
  function finish() {
    if (!drawing) return;
    if (!validZonePoints(drawing.points, drawing.type === 'road')) return message('Not enough points: 3 for an area, 2 for a road.');
    remember();
    const z = { type: drawing.type, source: 'user' };
    if (z.type === 'road') {
      z.line = drawing.points;
      z.width = 7;
    } else z.polygon = drawing.points;
    packet().zones.push(z);
    drawing = null;
    message('Zone added.');
    select([z]);
  }
  const hit = (p, tolerance) => {
    // roads first (thin), then the smallest area under the pointer
    let best = null,
      bestArea = Infinity;
    for (const z of zones()) {
      if (z.line) {
        for (let i = 0; i + 1 < z.line.length; i++) if (segDist(p, z.line[i], z.line[i + 1]) <= Math.max(z.width / 2, tolerance)) return z;
      } else if (inPoly(z.polygon, p)) {
        const a = areaOf(z.polygon);
        if (a < bestArea) {
          best = z;
          bestArea = a;
        }
      }
    }
    return best;
  };

  $('dem-zone-type').onchange = () => {
    const v = $('dem-zone-type').value;
    if (!v || !selected.size) return;
    remember();
    for (const z of selected)
      if (z.polygon) {
        z.type = v;
        z.source = 'user';
        if (!['water', 'river'].includes(v)) delete z.level;
      }
    refresh();
  };
  $('dem-zone-width').onchange = () => {
    const v = Number($('dem-zone-width').value);
    if (!Number.isFinite(v) || v < 3 || v > 40) return message('Road width: 3 to 40 m.');
    remember();
    for (const z of selected)
      if (z.line) {
        z.width = v;
        z.source = 'user';
      }
    refresh();
  };
  $('dem-zone-level').onchange = () => {
    const z = one();
    if (!z || !['river', 'water'].includes(z.type)) return;
    remember();
    const raw = $('dem-zone-level').value.trim();
    if (raw === '' || !Number.isFinite(Number(raw))) delete z.level;
    else z.level = Number(raw);
    z.source = 'user';
    refresh();
  };
  $('dem-zone-draw').onclick = e => {
    const type = e.target.closest('[data-draw]')?.dataset.draw;
    if (!type || !packet()) return;
    drawing = { type, points: [] };
    selected = new Set();
    message(`Drawing a ${zoneNames[type].toLowerCase()}: click its points on the map. Double-click or Enter to finish, Esc to cancel.`);
    refresh();
  };
  $('dem-zone-finish').onclick = finish;
  $('dem-zone-cancel').onclick = () => {
    drawing = null;
    message('Drawing cancelled.');
    refresh();
  };
  $('dem-zone-delete').onclick = remove;
  $('dem-zone-undo').onclick = undo;
  $('dem-save-terrain').onclick = () => {
    if (!packet() || drawing) return message('Finish the drawing before saving.');
    const blob = new Blob([serializePacket(packet())], { type: 'application/json' }),
      a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'site.bs3dterrain';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return {
    reset() {
      selected = new Set();
      drawing = null;
      action = null;
      history = [];
      message(idle);
      refresh();
    },
    unfinished: () => !!drawing,
    busy: () => !!drawing || !!action,
    // First chance on a press: a drawing click, a vertex of the selected zone, or Shift = frame selection.
    downFirst(x, y, p, e) {
      if (drawing) {
        drawing.points.push(bounded(p));
        refresh();
        return true;
      }
      const z = one();
      if (z) {
        const i = ptsOf(z).findIndex(q => {
          const [qx, qy] = toCanvas(...q);
          return Math.hypot(qx - x, qy - y) < 9 * ratio();
        });
        if (i >= 0) {
          action = { kind: 'vertex', zone: z, index: i, before: { zones: structuredClone(zones()), selected: [zones().indexOf(z)] }, moved: false };
          return true;
        }
      }
      if (e.shiftKey && !hit(p, 5 / scale())) {
        action = { kind: 'frame', a: p, b: p, add: selected.size > 0 };
        return true;
      }
      return false;
    },
    // Second chance (after the bridge): a zone under the pointer is selected and can be dragged.
    downZone(p, e) {
      const z = hit(p, 5 / scale());
      if (!z) {
        if (selected.size) select([]);
        return false;
      }
      if (e.shiftKey) {
        selected.has(z) ? selected.delete(z) : selected.add(z);
        refresh();
        return true;
      }
      if (!selected.has(z)) select([z]);
      const list = [...selected];
      action = { kind: 'zones', start: p, list, base: list.map(q => structuredClone(ptsOf(q))), before: { zones: structuredClone(zones()), selected: list.map(q => zones().indexOf(q)) }, moved: false, clicked: z };
      return true;
    },
    move(p) {
      if (!action) return false;
      if (action.kind === 'vertex') {
        ptsOf(action.zone)[action.index] = bounded(p);
        action.moved = true;
      } else if (action.kind === 'frame') action.b = p;
      else {
        const b = gridBounds(packet());
        let dx = p[0] - action.start[0],
          dy = p[1] - action.start[1];
        if (Math.hypot(dx, dy) * scale() < 3 && !action.moved) return true;
        // the whole selection stays inside the terrain
        const all = action.base.flat();
        dx = Math.max(b.x0 - Math.min(...all.map(q => q[0])), Math.min(b.x1 - Math.max(...all.map(q => q[0])), dx));
        dy = Math.max(b.y0 - Math.min(...all.map(q => q[1])), Math.min(b.y1 - Math.max(...all.map(q => q[1])), dy));
        action.list.forEach((z, i) => {
          const pts = action.base[i].map(q => [q[0] + dx, q[1] + dy]);
          if (z.line) z.line = pts;
          else z.polygon = pts;
        });
        action.moved = true;
      }
      redraw();
      return true;
    },
    up() {
      const a = action;
      action = null;
      if (!a) return;
      if (a.kind === 'frame') {
        const x0 = Math.min(a.a[0], a.b[0]),
          x1 = Math.max(a.a[0], a.b[0]),
          y0 = Math.min(a.a[1], a.b[1]),
          y1 = Math.max(a.a[1], a.b[1]),
          inside = zones().filter(z => ptsOf(z).some(q => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1));
        select(a.add ? [...selected, ...inside] : inside);
        return;
      }
      if (a.moved) {
        if (a.kind === 'vertex' && !validZonePoints(ptsOf(a.zone), !!a.zone.line)) {
          packet().zones = a.before.zones;
          selected = new Set(a.before.selected.map(i => packet().zones[i]));
          message('Move cancelled: the zone would collapse.');
        } else {
          history.push(a.before);
          for (const z of a.kind === 'vertex' ? [a.zone] : a.list) z.source = 'user';
        }
      } else if (a.kind === 'zones' && selected.size > 1) return select([a.clicked]);
      refresh();
    },
    // Double-click: remove the vertex under the pointer, or add one on the nearest edge of the selected zone.
    dbl(x, y, p) {
      if (drawing) {
        drawing.points.pop(); // the second click of the double-click added one point too many
        finish();
        return true;
      }
      const z = one();
      if (!z) return false;
      const pts = ptsOf(z),
        i = pts.findIndex(q => {
          const [qx, qy] = toCanvas(...q);
          return Math.hypot(qx - x, qy - y) < 9 * ratio();
        });
      if (i >= 0) {
        const next = pts.filter((_, k) => k !== i);
        if (!validZonePoints(next, !!z.line)) return true;
        remember();
        if (z.line) z.line = next;
        else z.polygon = next;
      } else {
        let best = -1,
          bd = 8 / scale();
        const n = z.line ? pts.length - 1 : pts.length;
        for (let k = 0; k < n; k++) {
          const d = segDist(p, pts[k], pts[(k + 1) % pts.length]);
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        if (best < 0) return false;
        remember();
        pts.splice(best + 1, 0, bounded(p));
      }
      z.source = 'user';
      refresh();
      return true;
    },
    key(e) {
      if (e.key === 'Escape' && drawing) {
        drawing = null;
        message('Drawing cancelled.');
        refresh();
        return true;
      }
      if (e.key === 'Enter' && drawing) return finish(), true;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size && !drawing) return remove(), true;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && history.length) return undo(), true;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !drawing) return select(zones()), true;
      if (e.key === 'Escape' && selected.size) return select([]), true;
      return false;
    },
    isSelected: z => selected.has(z),
    draw(g) {
      const r = ratio();
      g.save();
      for (const z of selected) {
        const pts = ptsOf(z);
        g.strokeStyle = '#fff';
        g.lineWidth = 3 * r;
        g.setLineDash([]);
        g.beginPath();
        pts.forEach((p, i) => {
          const q = toCanvas(...p);
          i ? g.lineTo(...q) : g.moveTo(...q);
        });
        if (z.polygon) g.closePath();
        g.stroke();
        g.strokeStyle = '#102d41';
        g.lineWidth = 1 * r;
        g.setLineDash([4 * r, 4 * r]);
        g.stroke();
      }
      g.setLineDash([]);
      const z = one(),
        pts = drawing?.points ?? (z ? ptsOf(z) : []);
      if (drawing && pts.length) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2 * r;
        g.setLineDash([5 * r, 3 * r]);
        g.beginPath();
        pts.forEach((p, i) => {
          const q = toCanvas(...p);
          i ? g.lineTo(...q) : g.moveTo(...q);
        });
        g.stroke();
        g.setLineDash([]);
      }
      if (pts.length <= 80 || drawing)
        for (const p of pts) {
          const q = toCanvas(...p);
          g.beginPath();
          g.arc(...q, 4.5 * r, 0, Math.PI * 2);
          g.fillStyle = '#fff';
          g.fill();
          g.lineWidth = 2 * r;
          g.strokeStyle = '#102d41';
          g.stroke();
        }
      if (action?.kind === 'frame') {
        const [x0, y0] = toCanvas(...action.a),
          [x1, y1] = toCanvas(...action.b);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5 * r;
        g.setLineDash([6 * r, 4 * r]);
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }
      g.restore();
    },
  };
}
