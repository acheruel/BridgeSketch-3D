// 0.6.9: a neutral, editable starting point for an imported site, not a presentation preset.
import { defaults, validate } from './geometry.mjs';

export function siteBridge(packet) {
  const axis = packet.bridge?.axis;
  const length = axis ? Math.hypot(axis[1][0] - axis[0][0], axis[1][1] - axis[0][1]) : 30;
  // Suggested equal spans are a sketch only; the user sees and edits them before applying.
  // 0.6.9: BridgeSketch takes 8 spans at most; a longer axis gets longer spans (150 m cap), then a length gap to read.
  const count = Math.min(8, Math.max(1, Math.ceil(length / 40)));
  return validate({ ...defaults, name: packet.bridge?.structure?.name ?? 'Bridge on site',
    profile: 'constant', grade: 0, curved: false, skew: 0, timeFlow: false,
    spans: Array.from({ length: count }, () => ({ length: Math.max(10, Math.min(150, Math.round((length / count) * 10) / 10)), obstacle: 'land', width: 10, elevation: 0, angle: 90 })) });
}

export function siteParameters(base, values) {
  const lengths = values.spans.split(/[;\s]+/).filter(Boolean).map(v => Number(v.replace(',', '.')));
  if (!lengths.length || lengths.length > 8 || lengths.some(v => !Number.isFinite(v) || v < 10 || v > 150))
    throw Error('Spans: 1 to 8 lengths of 10 to 150 m, separated by semicolons.');
  const patch = {};
  for (const key of ['width', 'skew', 'grade', 'elevation', 'approach']) {
    if (String(values[key]).trim() === '' || !Number.isFinite(Number(values[key]))) throw Error('Missing number: ' + key);
    patch[key] = Number(values[key]);
  }
  return validate({ ...base, ...patch, material: values.material,
    spans: lengths.map((length, i) => ({ ...(base.spans[i] ?? base.spans.at(-1)), length })) });
}
