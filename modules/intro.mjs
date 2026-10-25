import { release } from './release.mjs';

// 0.6.3: the launch drawing is an inline SVG redrawn from the earlier image: three spans in the proportions
// 0.8-1-0.8, a cambered deck with railing posts, girders deepening towards the piers with a constant-depth zone over
// each pier. A faint sketch is drawn once; the solid bridge is revealed left to right as the loading progresses.
// Only composited transforms animate, so the fill keeps moving while the scene build blocks the page.
const west = 130,
  east = 1070,
  unit = (east - west) / 2.6,
  piers = [west + 0.8 * unit, east - 0.8 * unit],
  ground = 330,
  flat = 12, // half-length of the constant-depth zone over each pier
  f = v => +v.toFixed(1);

// Deck soffit with a gentle camber; the girder soffit sits 22 below it and deepens by up to 30 near the piers.
const deckAt = x => 228 - 12 * (1 - ((x - 600) / 488) ** 2);
const soffitAt = x => {
  let add = 0;
  for (const p of piers) {
    const reach = 0.42 * (x < p ? p - (p === piers[0] ? west : piers[0]) : (p === piers[1] ? east : piers[1]) - p),
      t = Math.max(0, Math.abs(x - p) - flat) / (reach - flat);
    if (t < 1) add = Math.max(add, (1 - t) ** 2);
  }
  return deckAt(x) + 22 + 30 * add;
};
// Polyline through fn(x) + dy, sampled every 4 units from a to b (or b to a when reversed).
const line = (fn, a, b, dy = 0, reverse = false) => {
  const pts = [];
  for (let x = a; x <= b + 1e-6; x += 4) pts.push(`${f(x)} ${f(fn(x) + dy)}`);
  return (reverse ? pts.reverse() : pts).join(' L');
};

function drawing() {
  const posts = [];
  for (let x = 150; x < 1060; x += 80) posts.push(`M${x} ${f(deckAt(x) - 15)}V${f(deckAt(x) - 3)}`);
  const pier = p => {
    const b = soffitAt(p);
    return `<path class="ia-thin" d="M${f(p - 10)} ${f(b)}h20v5h-20Z"/>
      <path class="ia-solid" d="M${f(p - 18)} ${f(b + 5)}h36v7h-36Z"/>
      <path class="ia-solid" d="M${f(p - 12)} ${f(b + 12)}V${ground}H${f(p + 12)}V${f(b + 12)}"/>`;
  };
  const span = (a, b, n) => `<text x="${f((a + b) / 2)}" y="136">SPAN ${n}</text>`;
  const ripple = x => `M${x} 346c14 -5 26 -5 40 0s26 5 40 0`;
  return `<svg viewBox="0 0 1200 420" aria-hidden="true" focusable="false">
    <g class="ia-dim"><path d="M${west} 150H${east} ${[west, ...piers, east].map(x => `M${f(x)} 143v14`).join(' ')}"/>
      ${span(west, piers[0], 1)}${span(...piers, 2)}${span(piers[1], east, 3)}</g>
    <path class="ia-thin" d="M112 ${f(deckAt(112) - 15)} L${line(deckAt, 112, 1088, -15)} ${posts.join(' ')}"/>
    <path class="ia-girder" d="M${line(soffitAt, west + 2, east - 2)} L${line(deckAt, west + 2, east - 2, 0, true)}Z"/>
    <path class="ia-deck" d="M${line(deckAt, 112, 1088, -3)} L${line(deckAt, 112, 1088, 0, true)}Z"/>
    ${pier(piers[0])}${pier(piers[1])}
    <path class="ia-solid" d="M80 236H132V${ground}H80Z M1068 236H1120V${ground}H1068Z"/>
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
