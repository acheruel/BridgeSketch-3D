// BridgeSketch 3D · Export to QuickerBridge (0.7.3): a QuickerBridge project file (.quickerbridge.json) built from the
// bridge, for a quick longitudinal analysis of one girder line. Pure module (no DOM): tested in check.mjs.
//
// QuickerBridge validates a project strictly (no unknown field) and fills what is missing with its own defaults, so only
// what BridgeSketch 3D knows is written: spans, continuity, girder section, slab and wearing-surface loads, and the
// inputs of the simplified method (truck load fraction: girder count and spacing, overhang, carriageway, skew).
import { roadLayout, spacing } from './geometry.mjs';

export const QB_URL = 'https://acheruel.github.io/QuickerBridge/';
// Schema of QuickerBridge 1.0 / 1.01 (projects.py). Newer versions migrate older schemas when they open them.
export const QB_SCHEMA = 17;
const MAX_SPANS = 7,
  NEBT = [1000, 1200, 1400, 1600, 1800],
  CONCRETE = 24, // kN/m³, reinforced concrete slab
  ASPHALT = 23.5, // kN/m³, wearing surface
  clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  round = (v, digits = 2) => Number(v.toFixed(digits));

// Returns { project, notes }: the project object and plain sentences on what was assumed or left out.
export function toQuickerBridge(c, now = new Date()) {
  if (c.spans.length > MAX_SPANS) throw Error(`QuickerBridge analyses up to ${MAX_SPANS} spans; this bridge has ${c.spans.length}.`);
  const notes = [],
    n = c.spans.length,
    truss = c.structureSystem === 'truss',
    material = truss ? 'truss' : c.material,
    girderBridge = material === 'steel' || material === 'concrete',
    S = c.girders > 1 ? spacing(c) : c.width,
    // Width carried by the analysed line: one interior girder, one box, the whole deck of a box or truss, or a 1 m strip
    // of a solid slab (the slab truck load fraction of QuickerBridge is per metre of width).
    tributary = girderBridge ? S : material === 'box' ? c.width / Math.max(1, c.girders) : material === 'slab' ? 1 : c.width,
    layout = roadLayout(c),
    continuous = n > 1 && (c.structureSystem !== 'girder' || (c.continuous && c.material !== 'concrete'));
  const slab = {
    slab_thickness: round(c.deck * 1000, 0),
    haunch: round(clamp(c.haunch * 1000, 0, 1000), 0),
    effective_width: round(clamp(S * 1000, 1, 20000), 0),
  };
  const sections = [],
    spans = c.spans.map(span => ({ length: round(span.length, 3), section: 0, zones: [], simple: n > 1 && !continuous }));
  let nonprismatic = false;
  if (material === 'steel') {
    // Plate girder of BridgeSketch 3D: 500 x 50 mm flanges, 14 mm web.
    const plate = depth => ({ kind: 'girder', depth: round(depth * 1000, 0), top_width: 500, top_thickness: 50, web_thickness: 14, bottom_width: 500, bottom_thickness: 50, composite: { ...slab } });
    sections.push({ name: 'S1', ...plate(c.depth) });
    notes.push('Steel plate girder: 500 × 50 mm flanges and a 14 mm web (the concept section of BridgeSketch 3D), with the slab as a composite section. The analysis starts on the girder alone; choose the composite inertia in QuickerBridge.');
    if (c.variableDepth && c.pierDepth > c.depth && n > 1) {
      // Deeper section over the piers, reached by parabolic depth haunches (same layout as the QuickerBridge default).
      sections.push({ name: 'S2', ...plate(c.pierDepth) });
      nonprismatic = true;
      const reach = clamp(c.taper / 100, 0.05, 0.45);
      spans.forEach((span, i) => {
        if (i > 0) span.zones.push({ end: round(reach, 4), section: 1, end_section: 0, profile: 'parabolic', plates: 'deep' });
        if (i < n - 1) span.zones.push({ end: round(1 - reach, 4), section: 0 }, { end: 1, section: 0, end_section: 1, profile: 'parabolic', plates: 'deep' });
        else span.zones.push({ end: 1, section: 0 });
      });
    } else if (c.variableDepth) notes.push('Variable depth is not transferred for this layout: constant typical depth.');
  } else if (material === 'concrete') {
    const depth = NEBT.reduce((a, b) => (Math.abs(b - c.depth * 1000) < Math.abs(a - c.depth * 1000) ? b : a));
    sections.push({ name: `NEBT ${depth}`, kind: 'nebt', nebt: `NEBT${depth}`, composite: { ...slab } });
    if (c.variableDepth) notes.push('Variable depth is not transferred: QuickerBridge NEBT girders are prismatic.');
  } else if (material === 'slab') {
    sections.push({ name: 'Slab strip 1 m', kind: 'ei', stiffness_input: 'concrete', I_direct: round(clamp(c.slabDepth ** 3 / 12, 1e-6, 1e6), 6), fc: 35, unit_weight: CONCRETE });
    notes.push(`Solid slab: a 1 m wide strip, I = h³ / 12 with h = ${c.slabDepth} m (typical depth, voids ignored), loads per metre of width; the slab truck load fraction (per metre) is on.`);
  } else {
    sections.push({ name: truss ? 'Truss' : material === 'box' ? 'Steel box' : 'Concrete box', kind: 'ei' });
    notes.push((truss ? 'Truss' : 'Box girder') + ': the stiffness is not transferred. Enter EI of the section in QuickerBridge before reading any result.');
  }
  // Permanent loads that follow from the geometry alone, on the tributary width of the analysed line.
  const dead = [];
  if (material === 'slab') dead.push({ name: `Slab ${round(c.slabDepth * 1000, 0)} mm`, w: round(CONCRETE * c.slabDepth), stage: 'steel' });
  else if (!['psbox', 'box', 'truss'].includes(material)) dead.push({ name: `Concrete slab ${round(c.deck * 1000, 0)} mm`, w: round(CONCRETE * c.deck * tributary), stage: 'steel' });
  dead.push({ name: `Wearing surface ${round(c.asphalt * 1000, 0)} mm`, w: round(ASPHALT * c.asphalt * tributary), stage: '3n' });
  notes.push(
    `Permanent loads: ${['psbox', 'box', 'truss'].includes(material) ? `wearing surface only (add the ${material === 'truss' ? 'truss and deck' : 'box and slab'} self-weight)` : 'slab and wearing surface'} on a ${round(tributary)} m width (${CONCRETE} and ${ASPHALT} kN/m³). Barriers, sidewalks and utilities are not included: add them in QuickerBridge.` +
      (girderBridge ? ' The girder self-weight is added by QuickerBridge.' : ''),
  );
  // Simplified method of analysis (truck load fraction): slab-on-girder bridges, and the inputs of a solid slab.
  const distribution = {
    bridge_type: material === 'slab' ? 'slab' : 'slab_on_girder',
    deck_thickness: round(clamp((material === 'slab' ? c.slabDepth : c.deck) * 1000, 10, 600), 0),
    slab_width: round(clamp(c.width, 1.01, 60), 3),
    girders: clamp(c.girders, 1, 40),
    spacing: round(clamp(S, 0.31, 10), 3),
    overhang: round(clamp(c.overhang, 0, 6), 3),
    carriageway: round(clamp(layout.roadMax - layout.roadMin, 1.01, 60), 3),
    skew: round(clamp(Math.abs(c.skew), 0, 45), 2),
    girder: 'interior',
  };
  const simplified = c.trafficMode !== 'cyclists' && (material === 'slab' || (girderBridge && c.girders > 1 && S <= 10));
  distribution.enabled = distribution.apply = simplified;
  if (simplified && material === 'slab') notes.push(`Simplified method on (slab bridge): B = ${distribution.slab_width} m, carriageway ${distribution.carriageway} m, skew ${distribution.skew}°.`);
  else if (simplified) notes.push(`Simplified method on: ${c.girders} girders at ${round(S, 3)} m, overhang ${round(c.overhang, 3)} m, carriageway ${distribution.carriageway} m, skew ${distribution.skew}°, interior girder.`);
  else if (c.trafficMode !== 'cyclists') notes.push('Simplified method (truck load fraction) off: its inputs are filled where they apply, check them before turning it on.');
  if (Math.abs(c.skew) > 45) notes.push('Skew above 45°: capped at 45° for the simplified method.');
  if (simplified && c.overhang > 6) notes.push(`Overhang ${c.overhang} m capped at 6 m (QuickerBridge limit): check the simplified method.`);
  if (layout.medianWidth > 0 && simplified) notes.push(`The carriageway includes the ${round(layout.medianWidth)} m median: adjust Wc in QuickerBridge if needed.`);
  if (c.variableDepth && !['steel', 'concrete'].includes(material)) notes.push('Variable depth is not transferred: constant typical depth.');
  if (c.curved) notes.push(`Horizontal curve (R = ${c.radius} m): QuickerBridge analyses a straight line with the span lengths measured along the alignment.`);
  if (c.structureSystem !== 'girder' && !truss) notes.push(`${{ frame: 'Rigid frame', strutted: 'Strutted frame', arch: 'Arch', truss: 'Truss' }[c.structureSystem] ?? 'This system'}: only the continuous girder line is transferred; legs, arch or truss action are not modelled.`);
  if (n > 1 && !continuous)
    notes.push(material === 'concrete' && c.continuous ? 'Simply supported spans: the continuity diaphragms of the NEBT girders are not modelled as continuity (precast girders, conservative for midspan moments).' : 'Simply supported spans (no continuity over the piers).');
  const model = {
    spans,
    supports: ['pin', ...Array(n).fill('roller')],
    sections,
    nonprismatic,
    dead,
    distribution,
  };
  if (c.trafficMode === 'cyclists') {
    model.live = { source: 'pedestrian' };
    model.pedestrian = { width_source: 'manual', width: round(clamp(tributary * 1000, 1, 30000), 0) };
    notes.push('Pedestrian bridge: the live load is the pedestrian load on the tributary width.');
  }
  return {
    project: {
      format: 'QuickerBridgeProject',
      schema_version: QB_SCHEMA,
      app_version: '1.01',
      name: (c.name || 'BridgeSketch 3D bridge').trim().slice(0, 120) || 'BridgeSketch 3D bridge',
      saved_at: now.toISOString(),
      model,
    },
    notes,
  };
}

// Link that opens QuickerBridge with the project loaded: the JSON travels in the fragment (never sent to a server).
export function quickerBridgeLink(project, base = QB_URL) {
  const bytes = new TextEncoder().encode(JSON.stringify(project));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return base + '#project=' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const quickerBridgeFilename = project =>
  (project.name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'BridgeSketch-3D') + '.quickerbridge.json';
