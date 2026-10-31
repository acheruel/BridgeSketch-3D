import { release } from './release.mjs';

// 0.6.3: the launch drawing is an inline SVG: three spans in the proportions 0.8-1-0.8, a cambered deck with railing
// posts and girders deepening towards the piers. A faint sketch is drawn once; the solid bridge is revealed left to
// right as the loading progresses. Only composited transforms animate, so the fill keeps moving while the scene
// build blocks the page.
// 0.6.4: proportions of the Fall river example: girders 1.4 m deep in the spans and 2.4 m over the
// piers, haunch reach 45 % of each span with the app's parabola, a 0.29 m deck; bent piers whose cap tapers from
// 1.6 m over the column to 1.1 m at its tips (drawn 4.6 m long, like the bent cap seen across), on a 1.8 m round
// column and a footing. Depths are drawn 1.66 times
// the plan scale (central span = 42 m) so the structure reads at logo size.
const west = 130,
  east = 1070,
  unit = (east - west) / 2.6,
  piers = [west + 0.8 * unit, east - 0.8 * unit],
  ground = 342,
  m = (unit / 42) * 1.66, // drawing units per metre, vertically and for member widths
  typical = 1.4 * m,
  atPier = 2.4 * m,
  f = v => +v.toFixed(1);

// Top of the deck slab with a gentle camber; the girders hang from its 0.29 m soffit.
const deckAt = x => 206 - 12 * (1 - ((x - 600) / 488) ** 2),
  slab = 0.29 * m;
// Haunch as in geometry.mjs girderDepth(): (1 - t)² over 45 % of the adjacent span, past a short bearing zone.
const soffitAt = x => {
  let add = 0;
  for (const p of piers) {
    const reach = 0.45 * (x < p ? p - (p === piers[0] ? west : piers[0]) : (p === piers[1] ? east : piers[1]) - p),
      t = Math.max(0, Math.abs(x - p) - 0.7 * m) / (reach - 0.7 * m);
    if (t < 1) add = Math.max(add, (1 - t) ** 2);
  }
  return deckAt(x) + slab + typical + (atPier - typical) * add;
};
// Polyline through fn(x) + dy, sampled every 4 units from a to b (or b to a when reversed).
const line = (fn, a, b, dy = 0, reverse = false) => {
  const pts = [];
  for (let x = a; x <= b + 1e-6; x += 4) pts.push(`${f(x)} ${f(fn(x) + dy)}`);
  return (reverse ? pts.reverse() : pts).join(' L');
};

function drawing() {
  const posts = [],
    rail = 1.1 * m;
  for (let x = 150; x < 1060; x += 80) posts.push(`M${x} ${f(deckAt(x) - rail)}V${f(deckAt(x) - 3)}`);
  // Bent pier in elevation: bearing and plinth, tapered cap, round column with a highlight, spread footing.
  const pier = p => {
    const b = soffitAt(p),
      cap = b + 0.075 * m + 0.25 * m, // bearing and plinth
      half = 2.3 * m, // cap tips
      face = 0.9 * m, // column faces
      deep = cap + 1.6 * m,
      tip = cap + 1.1 * m;
    return `<path class="ia-thin" d="M${f(p - 0.35 * m)} ${f(b)}h${f(0.7 * m)}v${f(0.075 * m)}h${f(-0.7 * m)}Z M${f(p - 0.6 * m)} ${f(b + 0.075 * m)}h${f(1.2 * m)}V${f(cap)}h${f(-1.2 * m)}Z"/>
      <path class="ia-solid" d="M${f(p - half)} ${f(cap)}H${f(p + half)}V${f(tip)}L${f(p + face)} ${f(deep)}H${f(p - face)}L${f(p - half)} ${f(tip)}Z"/>
      <path class="ia-solid" d="M${f(p - face)} ${f(deep)}V${f(ground - 0.5 * m)}H${f(p + face)}V${f(deep)}"/>
      <path class="ia-thin" d="M${f(p - 0.35 * m)} ${f(deep + 4)}V${f(ground - 0.5 * m - 4)}"/>
      <path class="ia-solid" d="M${f(p - 1.6 * m)} ${f(ground - 0.5 * m)}h${f(3.2 * m)}V${ground}h${f(-3.2 * m)}Z"/>`;
  };
  // Abutment seat under the girder ends, with a ballast wall up to the deck.
  const abutment = (x, side) => {
    const seat = soffitAt(x) + 0.3 * m,
      back = x - side * 1.4 * m,
      toe = x + side * 0.9 * m;
    return `<path class="ia-solid" d="M${f(toe)} ${f(seat)}H${f(back)}V${f(deckAt(x) - 1)}H${f(back - side * 2.2 * m)}V${ground}H${f(toe)}Z"/>`;
  };
  const span = (a, b, n) => `<text x="${f((a + b) / 2)}" y="128">SPAN ${n}</text>`;
  const ripple = x => `M${x} 358c14 -5 26 -5 40 0s26 5 40 0`;
  return `<svg viewBox="0 0 1200 420" aria-hidden="true" focusable="false">
    <g class="ia-dim"><path d="M${west} 142H${east} ${[west, ...piers, east].map(x => `M${f(x)} 135v14`).join(' ')}"/>
      ${span(west, piers[0], 1)}${span(...piers, 2)}${span(piers[1], east, 3)}</g>
    <path class="ia-thin" d="M112 ${f(deckAt(112) - rail)} L${line(deckAt, 112, 1088, -rail)} ${posts.join(' ')}"/>
    <path class="ia-girder" d="M${line(soffitAt, west + 2, east - 2)} L${line(deckAt, west + 2, east - 2, slab, true)}Z"/>
    <path class="ia-deck" d="M${line(deckAt, 112, 1088)} L${line(deckAt, 112, 1088, slab, true)}Z"/>
    ${pier(piers[0])}${pier(piers[1])}${abutment(west, 1)}${abutment(east, -1)}
    <path d="M40 ${ground}H1160"/>
    <path class="ia-thin ia-water" d="${[200, 560, 880].map(ripple).join(' ')}"/>
  </svg>`;
}

export function startIntro() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches,
    root = document.createElement('div'),
    start = performance.now(),
    art = drawing();
  root.id = 'intro';
  root.className = reduce ? 'intro reduced' : 'intro';
  root.innerHTML = `<div class="intro-grid"></div>
    <div class="intro-stage">
      <div class="intro-art"><div class="intro-sketch">${art}</div>
        <div class="intro-fill"><div class="intro-fill-inner">${art}</div><i class="intro-front"></i></div></div>
      <div class="intro-brand"><h1>Bridge<span>Sketch</span> <em>3D</em></h1>
        <p>A quick visual tool for bridge concepts</p><p class="intro-author">by ${release.author} · v${release.version}</p>
        <small class="intro-status">Preparing the site…</small></div>
    </div>
    <button class="intro-skip" type="button">Skip</button>`;
  document.body.append(root);
  const fill = root.querySelector('.intro-fill'),
    inner = root.querySelector('.intro-fill-inner'),
    status = root.querySelector('.intro-status');
  let done = false,
    resolveExit;
  const exited = new Promise(resolve => (resolveExit = resolve));
  const leave = () => {
    if (done) return;
    done = true;
    removeEventListener('keydown', skip);
    root.classList.add('leaving');
    resolveExit();
    setTimeout(() => root.remove(), 350);
  };
  const skip = e => {
    if (['Escape', 'Enter', ' '].includes(e.key)) leave();
  };
  root.querySelector('button').onclick = leave;
  addEventListener('keydown', skip);
  // Each step eases to its value, then creeps towards the next one over a long ease-out transition, so the bridge
  // never looks frozen during a long step. A CSS transition retargets smoothly from wherever it is.
  const reveal = (fraction, complete) => {
    const p = complete ? 1 : Math.min(0.96, Math.max(0.03, fraction) + 0.14);
    root.classList.toggle('complete', !!complete);
    fill.style.transform = `translateX(${(p - 1) * 100}%)`;
    inner.style.transform = `translateX(${(1 - p) * 100}%)`;
  };
  reveal(0.03);
  // A background tab never paints: start loading after 100 ms anyway instead of waiting to be shown.
  const painted = new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
    setTimeout(resolve, 100);
  });
  return {
    exited,
    painted,
    progress(fraction, text) {
      if (done) return;
      reveal(fraction, fraction >= 1);
      if (text) status.textContent = text;
    },
    ready() {
      this.progress(1, 'Ready');
      const now = performance.now();
      setTimeout(leave, Math.max(reduce ? 300 : 2000 - (now - start), reduce ? 0 : 900));
    },
  };
}
