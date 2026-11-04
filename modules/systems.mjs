// BridgeSketch 3D · Structural systems (0.5.5): prestressed concrete box girder, rigid-frame and strutted-frame
// supports (no bearings), deck arches with spandrel columns and tied through arches above the deck.
// Concept geometry only: proportions follow common practice (span / depth ratios, rise / span), not a design.
import * as T from 'three';
import {
  archSpanIndex,
  crossAt,
  frame,
  girderDepth,
  profile,
  psboxLayout,
  stations,
  supportStation,
  TRUSS_DEPTH,
  TRUSS_OVER,
  trussChord,
  trussInset,
} from './geometry.mjs';
import { beam, box, rect, skewPlate, soffitAt, supportPoint, sweep } from './sections.mjs';

// Swept sections must be clockwise in (u, y).
const signedArea = p => p.reduce((a, q, i) => a + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0);
export const clockwise = p => (signedArea(p) > 0 ? [...p].reverse() : p);

// ─── Prestressed concrete box girder ────────────────────────────────────────────────────────────────────────
// Section parts in (u, y) at a station, y from the finished road surface. The top slab is the deck slab (drawn
// with the deck); the box adds wing haunches, inclined webs with top fillets, an optional centre web and the
// bottom slab, which thickens towards the supports where the box deepens.
export function psboxParts(c, depthAt) {
  const typical = psboxLayout(c),
    d0 = depthAt(0),
    box = psboxLayout(c, d0),
    y1 = -c.asphalt - c.deck,
    extra = c.variableDepth ? Math.max(0, Math.min(1, (d0 - c.depth) / Math.max(0.01, c.pierDepth - c.depth))) : 0,
    tb = box.slab + 0.35 * extra,
    parts = [];
  const yb = u => -c.asphalt - depthAt(u);
  box.centres.forEach((centre, i) => {
    for (const side of [-1, 1]) {
      const top = centre + side * box.top,
        bottom = centre + side * box.bottom,
        web = side * box.web;
      // Web: outer face from the slab soffit to the bottom, 450 mm thick (measured horizontally).
      parts.push(
        clockwise([
          [top, y1],
          [top - web - side * 0.3, y1],
          [top - web, y1 - 0.2],
          [bottom - web * 1.05, yb(bottom) + tb],
          [bottom - web * 1.05, yb(bottom)],
          [bottom, yb(bottom)],
        ]),
      );
      // Haunch under the slab outside the web: to 1.4 m from the deck edge, or halfway to the next box.
      const outer = (side < 0 && i === 0) || (side > 0 && i === box.count - 1),
        tipU = outer
          ? side * Math.max(Math.abs(top) + 0.3, box.half - 1.4)
          : top + side * Math.max(0.2, Math.min(1.2, box.pitch / 2 - box.top - 0.15));
      parts.push(
        clockwise([
          [tipU, y1],
          [top, y1],
          [top + side * 0.02, y1 - 0.25],
        ]),
      );
    }
    // Bottom slab between the webs.
    parts.push(
      clockwise([
        [centre - box.bottom + box.web, yb(centre - box.bottom) + tb],
        [centre + box.bottom - box.web, yb(centre + box.bottom) + tb],
        [centre + box.bottom - box.web, yb(centre + box.bottom)],
        [centre - box.bottom + box.web, yb(centre - box.bottom)],
      ]),
    );
    if (box.cells > 1)
      parts.push(
        clockwise([
          [centre - 0.2, y1],
          [centre + 0.2, y1],
          [centre + 0.2, yb(centre) + tb],
          [centre - 0.2, yb(centre) + tb],
        ]),
      );
  });
  return { parts, box, typical, y1, tb, yb };
}

export function addPsbox(c, m, structure) {
  const L = stations(c).at(-1),
    group = new T.Group();
  group.name = 'Prestressed concrete box girder';
  const depthAt = station => u => girderDepth(c, supportStation(c, station, u), u);
  const count = psboxParts(c, depthAt(L / 2)).parts.length;
  for (let k = 0; k < count; k++) {
    const mesh = sweep(c, 0.05, L - 0.05, station => psboxParts(c, depthAt(station)).parts[k], m.concrete);
    mesh.name = 'Box girder part';
    group.add(mesh);
  }
  // Solid diaphragms inside each box on every support line (1.2 m thick at piers, 0.9 m at abutments).
  stations(c).forEach((s, j) => {
    const { box, y1, tb, yb } = psboxParts(c, depthAt(s)),
      end = j === 0 || j === c.spans.length,
      at = end ? s + (j === 0 ? 0.5 : -0.5) : s,
      y = profile(c, at);
    for (const u of box.centres)
      skewPlate(
        group,
        m.concrete,
        c,
        at,
        [
          [u - box.top + box.web, y1 + y],
          [u + box.top - box.web, y1 + y],
          [u + box.bottom - box.web, yb(u + box.bottom) + tb + y],
          [u - box.bottom + box.web, yb(u - box.bottom) + tb + y],
        ].map(([v, w]) => [v, w + crossAt(c, v)]),
        end ? 0.9 : 1.2,
        'Box girder diaphragm',
      );
  });
  structure.add(group);
  return group;
}

// ─── Solids between rings ─────────────────────────────────────────────────────────────────────────────────
// Closed loft through rings of 3D points (same vertex count), capped at both ends, faces turned outward.
export function loft(rings, mat, name) {
  const triangles = [],
    centre = q => q.reduce((a, p) => a.map((v, k) => v + p[k] / q.length), [0, 0, 0]);
  const tri = (p, q, r, inside) => {
    const e = q.map((v, k) => v - p[k]),
      f = r.map((v, k) => v - p[k]),
      n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]],
      mid = [0, 1, 2].map(k => (p[k] + q[k] + r[k]) / 3 - inside[k]);
    triangles.push(...p, ...(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0 ? [...r, ...q] : [...q, ...r]));
  };
  for (let j = 0; j < rings.length - 1; j++) {
    const a = rings[j],
      b = rings[j + 1],
      inside = centre([...a, ...b]);
    for (let k = 0; k < a.length; k++) {
      const l = (k + 1) % a.length;
      tri(a[k], a[l], b[l], inside);
      tri(a[k], b[l], b[k], inside);
    }
  }
  for (const [ring, next] of [
    [rings[0], rings[1]],
    [rings.at(-1), rings.at(-2)],
  ]) {
    const inside = centre(next);
    for (let k = 1; k < ring.length - 1; k++) tri(ring[0], ring[k], ring[k + 1], inside);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(triangles, 3));
  geometry.computeVertexNormals();
  const mesh = new T.Mesh(geometry, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

// ─── Strutted frame legs (béquilles) ───────────────────────────────────────────────────────────────────────
// An inclined concrete leg across the deck width, from the soffit at the leg joint (support j) down to a
// footing on the side of the nearer abutment; 1.5 m thick at the joint, 1.0 m at the foot.
export function addStrutLeg(c, m, structure, j, earth) {
  const s = stations(c)[j],
    toward = j <= c.spans.length / 2 ? -1 : 1,
    span = toward < 0 ? j - 1 : j,
    tan = Math.tan((c.strutAngle * Math.PI) / 180),
    half = c.width / 2,
    rings = [];
  const steps = Math.max(2, Math.ceil((c.width - 1.2) / 0.8));
  let reach = 0;
  for (let n = 0; n <= steps; n++) {
    const u = -half + 0.6 + ((c.width - 1.2) * n) / steps,
      st = supportStation(c, s, u),
      top = soffitAt(c, Math.max(0, Math.min(c.spans.length - 1, span)), st, u) + 0.05,
      lean = (top - earth - 1) * tan,
      foot = st + toward * lean;
    reach = Math.max(reach, lean);
    const at = (station, y) => {
      const f = frame(c, station, u);
      return [f.x, y, f.z];
    };
    rings.push([at(st - 0.75, top), at(st + 0.75, top), at(foot + 0.5, earth + 1), at(foot - 0.5, earth + 1)]);
  }
  const leg = loft(rings, m.concrete, 'Strutted frame leg');
  structure.add(leg);
  // Spread footing under the leg, on the same skew as the support.
  const f = frame(c, supportStation(c, s, 0) + toward * reach, 0),
    footing = box(structure, m.concrete, f.x, earth + 0.5, f.z, 3.2, 1, c.width + 1, -Math.atan2(f.tz, f.tx));
  footing.name = 'Strut footing';
  return reach;
}

// ─── Arches ────────────────────────────────────────────────────────────────────────────────────────────────
// Deck arch: two ribs under the deck spring from footing blocks at the arch-span supports; spandrel columns and
// cross-beams carry the deck, the crown meets the soffit. Tied arch: two ribs above the deck, leaning 10° inwards,
// vertical hangers to steel (or concrete) tie beams along the deck edges, wind bracing over the traffic.
export function addArch(c, m, structure, earth, ground = () => -1e3) {
  const ss = stations(c),
    k = archSpanIndex(c),
    a = ss[k],
    b = ss[k + 1],
    L = b - a,
    steel = c.archMaterial === 'steel',
    mat = steel ? m.steel : m.concrete,
    group = new T.Group(),
    half = c.width / 2;
  group.name = c.archType === 'tied' ? 'Tied arch' : 'Deck arch';
  structure.add(group);
  const t = s => Math.max(0, Math.min(1, (s - a) / L));
  if (c.archType === 'tied') {
    const rise = Math.max(4, c.archRise * L * 0.9),
      lean = Math.tan((10 * Math.PI) / 180),
      edge = half + 0.5,
      w = steel ? 0.9 : 1.2,
      h0 = steel ? Math.max(0.9, Math.min(2.2, L / 65)) : Math.max(1.1, Math.min(2.8, L / 45)),
      axis = s => 0.25 + rise * 4 * t(s) * (1 - t(s)),
      slope = s => (rise * 4 * (1 - 2 * t(s))) / L;
    for (const side of [-1, 1]) {
      // Rib, swept along the alignment; the vertical cut keeps the true depth on the inclined ends.
      const rib = sweep(
        c,
        a + 0.2,
        b - 0.2,
        station => {
          const y = axis(station),
            u = side * (edge - (y - 0.25) * lean),
            h = (h0 * Math.hypot(1, slope(station))) / 2;
          return clockwise([
            [u - w / 2, y + h],
            [u + w / 2, y + h],
            [u + w / 2, y - h],
            [u - w / 2, y - h],
          ]);
        },
        mat,
        undefined,
        Math.max(24, Math.ceil(L / 1.5)),
      );
      rib.name = 'Arch rib';
      group.add(rib);
      // Tie beam along the deck edge, carrying the hangers and the floor.
      const tie = sweep(c, a + 0.05, b - 0.05, clockwise([[side * (edge - 0.4), 0.15], [side * (edge + 0.4), 0.15], [side * (edge + 0.4), -1.3], [side * (edge - 0.4), -1.3]]), mat);
      tie.name = 'Tie beam';
      group.add(tie);
    }
    // Hangers every 4–5 m.
    const n = Math.max(6, Math.round(L / 4.5));
    for (let j = 1; j < n; j++) {
      const s = a + (L * j) / n;
      for (const side of [-1, 1]) {
        const y = axis(s),
          u = side * (edge - (y - 0.25) * lean),
          top = supportPoint(c, s, u, profile(c, supportStation(c, s, u)) + crossAt(c, u) + y - h0 / 2),
          bottom = supportPoint(c, s, side * edge, profile(c, supportStation(c, s, side * edge)) + crossAt(c, side * edge) + 0.15);
        const hanger = beam(group, m.railing, bottom, top, 0.07, 0.07);
        hanger.name = 'Hanger';
      }
    }
    // Wind bracing where the ribs clear the traffic by 5.5 m: struts and X diagonals between the ribs.
    const clear = s => axis(s) - h0 / 2 > 5.8;
    const struts = [];
    for (let j = 1; j < n; j++) {
      const s = a + (L * j) / n;
      if (!clear(s) || j % 2) continue;
      const y = axis(s),
        u = edge - (y - 0.25) * lean,
        p = supportPoint(c, s, -u, profile(c, supportStation(c, s, 0)) + crossAt(c, -u) + y),
        q = supportPoint(c, s, u, profile(c, supportStation(c, s, 0)) + crossAt(c, u) + y);
      beam(group, mat, p, q, 0.45, 0.45).name = 'Wind brace strut';
      struts.push([p, q]);
    }
    for (let j = 1; j < struts.length; j++) {
      beam(group, mat, struts[j - 1][0], struts[j][1], 0.25, 0.25).name = 'Wind brace diagonal';
      beam(group, mat, struts[j - 1][1], struts[j][0], 0.25, 0.25).name = 'Wind brace diagonal';
    }
    // End cross-girders tie the two ribs over each bearing line.
    for (const s of [a + 0.6, b - 0.6])
      beam(
        group,
        mat,
        supportPoint(c, s, -edge, profile(c, supportStation(c, s, -edge)) + crossAt(c, -edge) - 0.6),
        supportPoint(c, s, edge, profile(c, supportStation(c, s, edge)) + crossAt(c, edge) - 0.6),
        0.8,
        1.2,
      ).name = 'End cross-girder';
    return { k, rise };
  }
  // Deck arch.
  const crown = Math.min(...[-half * 0.6, 0, half * 0.6].map(u => soffitAt(c, k, (a + b) / 2, u))) - 0.05,
    span = c.spans[k],
    // Springings sit on the ground at both supports (on the valley slopes when the terrain follows the profile).
    groundAt = s => Math.min(...[-half * 0.6, half * 0.6].map(u => {
      const f = frame(c, supportStation(c, s, u), u);
      return ground(f.x, f.z);
    })),
    spring = Math.max(earth + 1.2, span.elevation + (span.obstacle === 'rail' ? 1.5 : 0.8), Math.min(groundAt(a), groundAt(b)) - 0.3),
    rise = Math.max(2, crown - spring),
    h0 = steel ? Math.max(0.9, Math.min(2.4, L / 70)) : Math.max(1, Math.min(3, L / 50)),
    depth = s => h0 * (1 + 0.55 * (2 * t(s) - 1) ** 2),
    top = s => spring + rise * 4 * t(s) * (1 - t(s)),
    slope = s => (rise * 4 * (1 - 2 * t(s))) / L;
  // Ribs under the outer girders (inside the box for a box girder, under the webs).
  const ribU =
      c.material === 'psbox'
        ? Math.max(0.8, Math.abs(psboxLayout(c).centres[0]) + (psboxLayout(c).count > 1 ? 0 : psboxLayout(c).bottom - 0.5))
        : c.material === 'slab'
          ? Math.max(1, half * 0.62)
          : Math.max(0.8, half - c.overhang),
    w = steel ? 0.9 : 1.3;
  for (const side of [-1, 1]) {
    const u = side * ribU,
      rib = sweep(
        c,
        a + 0.05,
        b - 0.05,
        station => {
          const y = top(station),
            h = depth(station) * Math.hypot(1, slope(station));
          return clockwise([
            [u - w / 2, y],
            [u + w / 2, y],
            [u + w / 2, y - h],
            [u - w / 2, y - h],
          ]);
        },
        mat,
        () => 0,
        Math.max(28, Math.ceil(L / 1.2)),
        false,
      );
    rib.name = 'Arch rib';
    group.add(rib);
  }
  // Springing blocks at both supports.
  for (const s of [a, b]) {
    const f = frame(c, supportStation(c, s, 0), 0);
    box(group, m.concrete, f.x, spring - 1.2, f.z, 4.5, 3, 2 * ribU + 3, -Math.atan2(f.tz, f.tx)).name = 'Arch springing block';
  }
  // Spandrel columns every ~6 m, a cross-beam under the deck on each; the crown region is filled solid.
  const n = Math.max(6, 2 * Math.round(L / 12)),
    columnWidth = steel ? 0.55 : 0.8;
  for (let j = 1; j < n; j++) {
    const s = a + (L * j) / n,
      gap = crown - top(s);
    const yTop = Math.min(...[-ribU, ribU].map(u => soffitAt(c, k, supportStation(c, s, u), u)));
    if (yTop - top(s) < 0.25) continue;
    for (const side of [-1, 1]) {
      const u = side * ribU,
        st = supportStation(c, s, u),
        f = frame(c, st, u),
        bottom = top(st) - 0.2,
        height = soffitAt(c, k, st, u) - 0.9 - bottom;
      if (height > 0.3)
        box(group, mat, f.x, bottom + height / 2, f.z, columnWidth, height, w * 0.8, -Math.atan2(f.tz, f.tx)).name =
          gap < 1.5 ? 'Crown block' : 'Spandrel column';
    }
    // Cross-beam under the deck girders.
    const pl = supportPoint(c, s, -ribU - 0.6, 0),
      pr = supportPoint(c, s, ribU + 0.6, 0),
      y = yTop - 0.45;
    const cross = beam(group, steel ? m.steel : m.concrete, [pl[0], y, pl[2]], [pr[0], y, pr[2]], 0.9, 0.9);
    cross.name = 'Spandrel cross-beam';
  }
  // Transverse bracing between the ribs.
  for (let j = 1; j < n; j += steel ? 1 : 2) {
    const s = a + (L * j) / n,
      y = top(s) - depth(s) / 2,
      p = supportPoint(c, s, -ribU, y),
      q = supportPoint(c, s, ribU, y);
    beam(group, mat, p, q, steel ? 0.35 : 0.6, steel ? 0.35 : 0.6).name = 'Rib cross-strut';
    if (steel && j + 1 < n) {
      const s2 = a + (L * (j + 1)) / n,
        y2 = top(s2) - depth(s2) / 2;
      beam(group, mat, p, supportPoint(c, s2, ribU, y2), 0.2, 0.2).name = 'Rib bracing';
    }
  }
  return { k, rise, spring };
}

// ─── Steel trusses for footbridges (0.6.6) ────────────────────────────────────────────────────────────────
// Two trusses with the deck at their bottom chords: a pony truss (low, open top, outrigger knee braces) or a through
// truss (top struts and X bracing over the path, portal struts at the ends). Warren, Pratt or Howe web; every
// truss ends with an inclined end post (a diagonal) down to its bearing. Simple spans, or one truss continuous over
// the piers. Floor beams (traverses) under the slab and the top struts follow the chosen spacing.
export { TRUSS_OVER, TRUSS_DEPTH, trussChord, trussInset };

// Bearing-to-bearing node stations (centre-line basis) of each truss run; an even panel count in every span.
export function trussRuns(c) {
  const ss = stations(c),
    last = c.spans.length - 1,
    spans = c.spans.map((_, i) => [ss[i] + (i === 0 ? 0.5 : c.continuous ? 0 : 0.55), ss[i + 1] - (i === last ? 0.5 : c.continuous ? 0 : 0.55)]);
  const divide = ([a, b]) => {
    const n = Math.max(2, 2 * Math.round((b - a) / (2 * c.trussPanel)));
    return Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);
  };
  if (!c.continuous) return spans.map(range => ({ spans: [divide(range)] }));
  return [{ spans: spans.map(divide) }];
}

export function addTruss(c, m, structure) {
  const group = new T.Group(),
    half = c.width / 2,
    tu = half - TRUSS_OVER,
    cw = trussChord(c),
    member = c.trussType === 'through' ? 0.24 : 0.2,
    H = c.trussHeight,
    through = c.trussType === 'through';
  group.name = `Steel ${c.trussType} truss · ${c.trussPattern}`;
  structure.add(group);
  // Bottom chord axis level (before crossfall) at a station on the truss line u.
  const chordAxis = (s, u) => profile(c, s) - c.asphalt - c.deck - 0.05 - TRUSS_DEPTH + cw / 2,
    node = (x, u, rise = 0) => {
      const s = supportStation(c, x, u),
        f = frame(c, s, u);
      return [f.x, chordAxis(s, u) + crossAt(c, u) + rise, f.z];
    },
    slabUnder = (x, u) => {
      const s = supportStation(c, x, u);
      return profile(c, s) - c.asphalt - c.deck + crossAt(c, u);
    };
  const add = (mesh, name) => {
    mesh.name = name;
    return mesh;
  };
  for (const run of trussRuns(c)) {
    const all = run.spans.flatMap((nodes, i) => (i ? nodes.slice(1) : nodes)),
      first = all[0],
      lastNode = all.at(-1),
      topStart = run.spans[0][1],
      topEnd = run.spans.at(-1).at(-2);
    for (const side of [-1, 1]) {
      const u = side * tu;
      // Chords: square hollow sections swept along the alignment (they follow the curve and the profile).
      const chord = (a, b, rise, name) =>
        group.add(
          add(
            sweep(c, a, b, rect(u - cw / 2, u + cw / 2, cw / 2, -cw / 2), m.steel, (_, s) => chordAxis(s, u) + rise, undefined, u),
            name,
          ),
        );
      chord(first - 0.15, lastNode + 0.15, 0, 'Truss bottom chord');
      chord(topStart, topEnd, H, 'Truss top chord');
      const bar = (p, q, w, name) => add(beam(group, m.steel, p, q, w, w), name);
      run.spans.forEach((nodes, i) => {
        const n = nodes.length - 1,
          B = k => node(nodes[k], u),
          Tn = k => node(nodes[k], u, H),
          endA = i === 0,
          endB = i === run.spans.length - 1;
        for (let k = 0; k < n; k++) {
          const left = k < n / 2;
          let from, to;
          if (c.trussPattern === 'warren') [from, to] = k % 2 === 0 ? [B(k), Tn(k + 1)] : [Tn(k), B(k + 1)];
          else if (c.trussPattern === 'pratt') [from, to] = left ? [Tn(k), B(k + 1)] : [B(k), Tn(k + 1)];
          else [from, to] = left ? [B(k), Tn(k + 1)] : [Tn(k), B(k + 1)];
          // End posts: an inclined chord-size member from the bearing node to the first top node.
          const endPost = (k === 0 && endA) || (k === n - 1 && endB);
          if (endPost) [from, to] = k === 0 ? [B(0), Tn(1)] : [Tn(n - 1), B(n)];
          bar(from, to, endPost ? cw : member, endPost ? 'Truss end post' : 'Truss diagonal');
        }
        // Verticals (posts): every interior node for Pratt and Howe, the top nodes of a Warren; over continuous piers.
        for (let k = 0; k <= n; k++) {
          const interior = k > 0 && k < n,
            overPier = (k === 0 && !endA) || (k === n && !endB);
          if (!(interior || overPier) || (overPier && k === 0)) continue;
          if (interior && c.trussPattern === 'warren' && k % 2 === 0) continue;
          bar(B(k), Tn(k), member * 0.9, overPier ? 'Truss post over pier' : 'Truss post');
          // Pony truss: outrigger knee brace outside each post (U-frame against lateral buckling of the top chord).
          if (!through) {
            const out = node(nodes[k], u + side * 0.7),
              knee = node(nodes[k], u, H * 0.6);
            bar(out, knee, 0.12, 'Pony truss knee brace');
            bar(node(nodes[k], u + side * cw * 0.5), out, 0.16, 'Floor beam outrigger');
          }
        }
      });
    }
    // Floor beams (traverses) under the slab between the bottom chords, at the chosen spacing.
    const count = Math.max(1, Math.round((lastNode - first) / c.trussBraceSpacing));
    for (let k = 0; k <= count; k++) {
      const x = first + ((lastNode - first) * k) / count,
        y = u => slabUnder(x, u) - 0.2,
        a = node(x, -tu + cw / 2),
        b = node(x, tu - cw / 2);
      add(beam(group, m.steel, [a[0], y(-tu), a[2]], [b[0], y(tu), b[2]], 0.2, 0.4), 'Floor beam');
    }
    // Through truss: top struts at the top-chord nodes (every k panels for the chosen spacing), X bracing between
    // them, deeper portal struts over the end posts.
    if (through) {
      const tops = run.spans.flatMap((nodes, i) => nodes.slice(i === 0 ? 1 : 0, i === run.spans.length - 1 ? -1 : undefined)),
        unique = tops.filter((x, k) => k === 0 || x - tops[k - 1] > 1e-6),
        panel = unique.length > 1 ? unique[1] - unique[0] : c.trussPanel,
        every = Math.max(1, Math.round(c.trussBraceSpacing / panel)),
        picked = unique.filter((_, k) => k % every === 0 || k === unique.length - 1);
      picked.forEach((x, k) => {
        const portal = k === 0 || k === picked.length - 1,
          p = node(x, -tu, H),
          q = node(x, tu, H);
        add(beam(group, m.steel, p, q, portal ? 0.3 : 0.2, portal ? 0.55 : 0.25), portal ? 'Portal strut' : 'Top strut');
        if (k > 0) {
          const r = node(picked[k - 1], -tu, H),
            t = node(picked[k - 1], tu, H);
          add(beam(group, m.steel, r, q, 0.07, 0.07), 'Top lateral bracing');
          add(beam(group, m.steel, t, p, 0.07, 0.07), 'Top lateral bracing');
        }
      });
    }
  }
  return group;
}
