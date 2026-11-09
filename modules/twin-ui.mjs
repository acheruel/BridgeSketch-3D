// BridgeSketch 3D · 0.6.9: « Bridge B » panel (Site tab). Edits config.twin only; the main form keeps editing bridge A.
// Its fields have no name attribute and stop their change events, so the parameters form never reads them.
import { totalLength } from './geometry.mjs';
import { newTwin, twinConfig, twinClearance } from './twin.mjs';

export function createTwinPanel({ $, getConfig, hasSite, update, notify }) {
  const group = $('twin-group'),
    keys = ['spacing', 'shift', 'turn', 'width', 'spans', 'material', 'skew', 'grade', 'elevation'],
    field = k => $('twin-' + k);
  const apply = async (twin, editKey = 'twin') => {
    try {
      await update({ ...structuredClone(getConfig()), twin }, { editKey });
    } catch (e) {
      notify(e.message, true);
      refresh();
    }
  };
  function refresh() {
    const c = getConfig(),
      t = c.twin,
      site = hasSite();
    $('twin-add').hidden = !!t;
    $('twin-add').disabled = !site;
    $('twin-remove').hidden = !t;
    $('twin-copy').hidden = !t;
    $('twin-fields').hidden = !t;
    $('twin-off').hidden = site;
    $('twin-off').textContent = t
      ? 'Bridge B stays in the project; it is drawn again on an imported terrain (Import DTM/DSM).'
      : 'Available on an imported terrain (Import DTM/DSM): both bridges share its ground, water, roads and light.';
    const meta = group.querySelector('.group-meta');
    if (meta) meta.textContent = t ? `On · ${t.spacing.toFixed(1)} m apart` : 'Off';
    if (!t) {
      $('twin-check').textContent = '';
      return;
    }
    for (const k of keys)
      if (document.activeElement !== field(k)) field(k).value = k === 'spans' ? t.spans.join(' ; ') : t[k];
    let text;
    try {
      const b = twinConfig(c),
        gap = twinClearance(c, b);
      text =
        `Bridge A ${totalLength(c).toFixed(1)} m × ${c.width} m · bridge B ${totalLength(b).toFixed(1)} m × ${b.width} m. ` +
        (gap >= 0
          ? `Clear gap between the decks: ${gap.toFixed(2)} m` + (t.turn ? ' at the origin (the decks are not parallel).' : '.')
          : `⚠ Overlap: the decks cross by ${(-gap).toFixed(2)} m. Increase the axis spacing.`);
    } catch (e) {
      text = '⚠ ' + e.message;
    }
    $('twin-check').textContent = text;
  }
  group.addEventListener('change', e => {
    if (!e.target.id?.startsWith('twin-')) return;
    e.stopPropagation();
    const c = getConfig();
    if (!c.twin) return;
    const t = { ...c.twin },
      k = e.target.id.slice(5);
    if (k === 'spans') {
      const spans = e.target.value.split(/[;\s]+/).filter(Boolean).map(v => Number(v.replace(',', '.')));
      if (!spans.length || spans.length > 8 || spans.some(v => !Number.isFinite(v) || v < 10 || v > 150)) {
        notify('Bridge B spans: 1 to 8 lengths of 10 to 150 m, separated by semicolons.', true);
        refresh();
        return;
      }
      t.spans = spans;
    } else if (k === 'material') t.material = e.target.value;
    else {
      const v = Number(String(e.target.value).replace(',', '.'));
      if (!Number.isFinite(v)) {
        refresh();
        return;
      }
      t[k] = v;
    }
    apply(t, 'twin-' + k);
  });
  $('twin-add').onclick = () => {
    if (!hasSite()) return;
    apply(newTwin(getConfig()));
    notify('Bridge B added: a copy of bridge A, 3 m clear on its right. Edit it below; bridge A stays as it is.');
  };
  $('twin-remove').onclick = () => apply(null);
  // « Apply to both » is a deliberate action, never a hidden synchronisation.
  $('twin-copy').onclick = () => {
    const c = getConfig(),
      copy = newTwin(c);
    apply({ ...c.twin, width: copy.width, spans: copy.spans, material: copy.material, skew: copy.skew, grade: copy.grade, elevation: copy.elevation });
  };
  return { refresh };
}
