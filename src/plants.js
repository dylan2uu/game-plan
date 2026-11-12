/* ---------- plants: each focus session grows one, points grow the big trees ---------- */
function mulberry(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (p, a, b) => c01((p - a) / (b - a));
const eOut = (x) => 1 - Math.pow(1 - c01(x), 3);
const eBack = (x) => { x = c01(x); if (x === 0) return 0; const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const f1 = (n) => String(Math.round(n * 10) / 10);
const f2 = (n) => String(Math.round(n * 100) / 100);
function qpt(p0, c, p1, t) { const u = 1 - t; return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]; }
function qsplit(p0, c, p1, t) {
  const a = [p0[0] + (c[0] - p0[0]) * t, p0[1] + (c[1] - p0[1]) * t];
  const b = [c[0] + (p1[0] - c[0]) * t, c[1] + (p1[1] - c[1]) * t];
  const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return "M" + f1(p0[0]) + " " + f1(p0[1]) + "Q" + f1(a[0]) + " " + f1(a[1]) + " " + f1(m[0]) + " " + f1(m[1]);
}
function leafP(L, W) { return "M0 0Q" + f1(L * 0.42) + " " + f1(-W) + " " + f1(L) + " 0Q" + f1(L * 0.58) + " " + f1(W) + " 0 0Z"; }
function leafG(x, y, ang, L, W, s, fill, vein) {
  if (!(s > 0.02)) return "";
  return '<g transform="translate(' + f1(x) + " " + f1(y) + ")rotate(" + f1(ang) + ")scale(" + f2(s) + ')"><path d="' + leafP(L, W) + '" fill="' + fill + '"/>' + (vein ? '<path d="M2 0H' + f1(L * 0.8) + '" stroke="' + vein + '" stroke-width=".9" opacity=".45"/>' : "") + "</g>";
}
function stemP(p0, c, p1, w, col) { return '<path d="M' + f1(p0[0]) + " " + f1(p0[1]) + "Q" + f1(c[0]) + " " + f1(c[1]) + " " + f1(p1[0]) + " " + f1(p1[1]) + '" stroke="' + col + '" stroke-width="' + f1(w) + '" fill="none" stroke-linecap="round"/>'; }
function circ(x, y, r, fill, extra) { return '<circle cx="' + f1(x) + '" cy="' + f1(y) + '" r="' + f1(Math.max(0, r)) + '" fill="' + fill + '"' + (extra || "") + "/>"; }
function ell(x, y, rx, ry, rot, fill) { return '<ellipse rx="' + f1(rx) + '" ry="' + f1(ry) + '" fill="' + fill + '" transform="translate(' + f1(x) + " " + f1(y) + ")rotate(" + f1(rot) + ')"/>'; }
const G = { stem: "#3f8f4c", leaf: "#4fae5c", leaf2: "#6cc274", vein: "#2b6e38" };
const GOLD = ["#e2a90a", "#f2c234", "#ffd95c", "#ffe9a0"];
function sprout(s) {
  if (!(s > 0.02)) return "";
  const h = 11 * s;
  return stemP([0, 0], [-1, -h / 2], [0, -h], 1.9, G.stem) + leafG(0, -h, -155, 10 * s, 4, 1, G.leaf) + leafG(0, -h, -25, 10 * s, 4, 1, G.leaf2);
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

function tulip(p, r, o) {
  const c = o.gold ? ["#f5c22c", "#ffe27a", "#d99a00"] : pick(r, [["#ee4466", "#ff8a9c", "#c92a4b"], ["#ff8a3d", "#ffb877", "#e0661c"], ["#ffc93c", "#ffe48a", "#e3a812"], ["#9d5cff", "#c8a2ff", "#7a3fe0"], ["#ff6fae", "#ffaad0", "#e04a8e"]]);
  const H = 74 + r() * 14, sx = (r() - 0.5) * 12, lean = (r() - 0.5) * 10, l1 = 40 + r() * 8, l2 = 34 + r() * 8;
  const g = eOut(seg(p, 0.06, 0.7)), h = H * g, top = [sx * g, -h];
  let s = sprout(seg(p, 0, 0.08) * (1 - seg(p, 0.22, 0.36)));
  s += leafG(-1, -1, -114, l1, 8.5, eOut(seg(p, 0.12, 0.45)), G.leaf, G.vein);
  s += leafG(1, -3, -62, l2, 7.5, eOut(seg(p, 0.2, 0.52)), G.leaf2, G.vein);
  if (h > 2) s += stemP([0, 0], [lean * g, -h * 0.55], top, 3, G.stem);
  if (p > 0.5) {
    const bud = eBack(seg(p, 0.5, 0.66)), b = eOut(seg(p, 0.64, 1)), sc = Math.max(0.08, 0.5 * bud + 0.5 * b);
    s += '<g transform="translate(' + f1(top[0]) + " " + f1(top[1] + 2) + ")scale(" + f2(sc * 1.15) + ')">' +
      '<path d="M-7 0C-8 -9 -5 -16 0 -18C5 -16 8 -9 7 0C4 3 -4 3 -7 0Z" fill="#7cc36a"/>' +
      '<g opacity="' + f2(b) + '"><path d="M-10 -1C-12 -10 -10 -18 -5 -22C-2.5 -15 -1 -10 0 -7C1 -10 2.5 -15 5 -22C10 -18 12 -10 10 -1C6 4 -6 4 -10 -1Z" fill="' + c[0] + '"/>' +
      '<path d="M0 -6C-3.6 -12 -3.6 -19 0 -24C3.6 -19 3.6 -12 0 -6Z" fill="' + c[1] + '"/><path d="M-10 -1C-6 4 6 4 10 -1C6 1.6 -6 1.6 -10 -1Z" fill="' + c[2] + '" opacity=".55"/></g></g>';
  }
  return s;
}
function daisy(p, r, o) {
  const c = o.gold ? ["#ffe27a", "#ffd23f"] : pick(r, [["#ffffff", "#f3eeff"], ["#ffd6e6", "#ffbcd5"], ["#e7deff", "#cfbfff"]]);
  const heads = [];
  for (let i = 0; i < 3; i++) heads.push({ H: 50 + r() * 26, a: (i - 1) * 14 + (r() - 0.5) * 8, bend: (r() - 0.5) * 12, n: 11 + Math.floor(r() * 4) });
  let s = sprout(seg(p, 0, 0.08) * (1 - seg(p, 0.2, 0.34)));
  s += leafG(0, 0, -152, 24, 5.5, eOut(seg(p, 0.1, 0.4)), G.leaf, G.vein) + leafG(0, 0, -28, 22, 5.5, eOut(seg(p, 0.14, 0.44)), G.leaf2, G.vein);
  heads.forEach((hd, i) => {
    const g = eOut(seg(p, 0.08 + i * 0.05, 0.7 + i * 0.04)), h = hd.H * g, rad = (hd.a - 90) * Math.PI / 180;
    const top = [Math.cos(rad) * h, Math.sin(rad) * h], ctrl = [top[0] * 0.3 + hd.bend * g, top[1] * 0.55];
    if (h > 2) s += stemP([0, 0], ctrl, top, 1.8, G.stem);
    const mid = qpt([0, 0], ctrl, top, 0.45);
    s += leafG(mid[0], mid[1], hd.a > 0 ? -20 : -160, 11, 3.4, eOut(seg(p, 0.3 + i * 0.05, 0.55)), G.leaf2);
    const b = eBack(seg(p, 0.62 + i * 0.07, 0.92 + i * 0.03));
    if (b > 0.02) {
      let pet = "";
      for (let k = 0; k < hd.n; k++) pet += '<ellipse cy="-7" rx="2.5" ry="6.4" fill="' + (k % 2 ? c[1] : c[0]) + '" transform="rotate(' + f1((360 / hd.n) * k) + ')"/>';
      s += '<g transform="translate(' + f1(top[0]) + " " + f1(top[1]) + ")scale(" + f2(b) + ')"><g stroke="rgba(70,50,110,.16)" stroke-width=".6">' + pet + "</g>" + circ(0, 0, 4.3, "#ffc83a", ' stroke="#e3a014" stroke-width="1"') + circ(-1.1, -1.1, 1.4, "#ffe596") + "</g>";
    } else if (p > 0.5) s += circ(top[0], top[1], 2.6 * seg(p, 0.5, 0.62), "#7cc36a");
  });
  return s;
}
function sunflower(p, r, o) {
  const H = 104 + r() * 12, sx = (r() - 0.5) * 10, tilt = (r() - 0.5) * 16;
  const pet = o.gold ? ["#ffe066", "#fff2b0"] : r() < 0.25 ? ["#ff9f1c", "#ffc061"] : ["#ffc21a", "#ffdb5e"];
  const g = eOut(seg(p, 0.05, 0.72)), h = H * g, top = [sx * g, -h], ctrl = [-sx * 0.4 * g, -h * 0.5];
  let s = sprout(seg(p, 0, 0.08) * (1 - seg(p, 0.2, 0.32)));
  if (h > 2) s += stemP([0, 0], ctrl, top, 4.4, G.stem);
  [[0.2, -152, 32, 13], [0.36, -30, 30, 12.5], [0.52, -154, 26, 11], [0.68, -28, 21, 9]].forEach((L, i) => {
    const pt = qpt([0, 0], ctrl, top, L[0]);
    s += leafG(pt[0], pt[1], L[1], L[2], L[3], eOut(seg(p, 0.15 + i * 0.1, 0.4 + i * 0.1)), i % 2 ? G.leaf2 : G.leaf, G.vein);
  });
  if (p > 0.55) {
    const b = eBack(seg(p, 0.66, 0.98)), bud = seg(p, 0.55, 0.68);
    let pt = "", sd = "";
    for (let k = 0; k < 18; k++) pt += '<ellipse cy="-12.5" rx="3.5" ry="8.8" fill="' + (k % 2 ? pet[1] : pet[0]) + '" transform="rotate(' + f1(20 * k) + ')"/>';
    for (let k = 0; k < 16; k++) { const a = k * 2.4, rr = 1.6 * Math.sqrt(k + 1); sd += circ(Math.cos(a) * rr, Math.sin(a) * rr, 0.9, "#3d220f"); }
    s += '<g transform="translate(' + f1(top[0]) + " " + f1(top[1]) + ")rotate(" + f1(tilt) + ")scale(" + f2(Math.max(0.15, 0.35 * bud + 0.65 * b)) + ')">' +
      '<g opacity="' + f2(b) + '">' + pt + "</g>" + circ(0, 0, 9.8, "#6b3e1f", ' stroke="#4b2a12" stroke-width="1"') + '<g opacity="' + f2(b) + '">' + sd + "</g></g>";
  }
  return s;
}
function lavender(p, r, o) {
  const bud = o.gold ? ["#f2c234", "#ffd95c", "#e2a90a"] : ["#8a63d2", "#a582ea", "#bb9ff2"];
  const st = [];
  for (let i = 0; i < 7; i++) st.push({ a: (i - 3) * 8 + (r() - 0.5) * 6, H: 58 + r() * 24, bend: (r() - 0.5) * 8 });
  let s = sprout(seg(p, 0, 0.08) * (1 - seg(p, 0.2, 0.32)));
  for (let i = 0; i < 6; i++) s += leafG(0, 0, -90 + (i - 2.5) * 22, 20 + (i % 2) * 6, 2.5, eOut(seg(p, 0.1 + i * 0.03, 0.4)), "#7fa676");
  st.forEach((q, i) => {
    const g = eOut(seg(p, 0.1 + i * 0.03, 0.7 + i * 0.02)), h = q.H * g, rad = (q.a - 90) * Math.PI / 180;
    const top = [Math.cos(rad) * h, Math.sin(rad) * h], ctrl = [top[0] * 0.4 + q.bend * g, top[1] * 0.5];
    if (h > 2) s += stemP([0, 0], ctrl, top, 1.4, "#6f9460");
    for (let k = 0; k < 8; k++) {
      const t = 0.62 + k * 0.05; if (t > 1) break;
      const pt = qpt([0, 0], ctrl, top, t), bs = eBack(seg(p, 0.5 + k * 0.05 + i * 0.01, 0.62 + k * 0.05 + i * 0.01));
      if (bs > 0.02) s += ell(pt[0] + (k % 2 ? 1.7 : -1.7), pt[1], 2.3 * bs, 3.6 * bs, q.a + (k % 2 ? 25 : -25), bud[k % 3]);
    }
  });
  return s;
}
function rose(p, r, o) {
  const c = o.gold ? ["#f5c22c", "#d99a00", "#fff0a8"] : pick(r, [["#e23950", "#a8182e", "#ff7a8a"], ["#ff8fb1", "#d9557f", "#ffc6d7"], ["#ff8566", "#d4503a", "#ffb7a3"], ["#fff1ea", "#d9bcb1", "#ffffff"], ["#ffd35c", "#d9a020", "#ffeaa8"]]);
  const br = [];
  for (let i = 0; i < 3; i++) br.push({ a: (i - 1) * 24 + (r() - 0.5) * 10, H: 48 + r() * 22, bend: (r() - 0.5) * 16 });
  let s = sprout(seg(p, 0, 0.08) * (1 - seg(p, 0.2, 0.32)));
  br.forEach((b, i) => {
    const g = eOut(seg(p, 0.08 + i * 0.04, 0.68)), h = b.H * g, rad = (b.a - 90) * Math.PI / 180;
    const top = [Math.cos(rad) * h, Math.sin(rad) * h], ctrl = [top[0] * 0.5 + b.bend * g, top[1] * 0.5];
    if (h > 2) s += stemP([0, 0], ctrl, top, 2.2, "#2f6f3c");
    for (let k = 0; k < 4; k++) {
      const pt = qpt([0, 0], ctrl, top, 0.3 + k * 0.17);
      s += leafG(pt[0], pt[1], (k % 2 ? -25 : -155) + b.a * 0.5, 12, 5.5, eOut(seg(p, 0.2 + k * 0.08, 0.5 + k * 0.08)), k % 2 ? "#3f9455" : "#2f7d43", "#1f5a2e");
    }
    const bl = eBack(seg(p, 0.62 + i * 0.08, 0.95));
    if (bl > 0.02) s += '<g transform="translate(' + f1(top[0]) + " " + f1(top[1]) + ")scale(" + f2(bl * 1.25) + ')">' + circ(0, 0, 9, c[0], ' stroke="' + c[1] + '" stroke-opacity=".35" stroke-width=".8"') +
      '<path d="M-6.5 2.5C-7.5 -4 -2 -7.5 2 -6.5C6.5 -5.5 7.5 0 4.5 4.5" fill="none" stroke="' + c[1] + '" stroke-width="1.7" stroke-linecap="round"/><path d="M-3.2 0.4C-3.2 -3 0 -4.3 2.2 -3.2C4.3 -2 3.2 1.2 1 1.6" fill="none" stroke="' + c[1] + '" stroke-width="1.4" stroke-linecap="round"/>' + circ(-3.2, -4.3, 2.3, c[2], ' opacity=".55"') + "</g>";
    else if (p > 0.5) s += circ(top[0], top[1], 2.7, "#3f9455");
  });
  return s;
}
function poppy(p, r, o) {
  const c = o.gold ? ["#f5c22c", "#d99a00"] : pick(r, [["#ff4d3d", "#d93024"], ["#ff8a1f", "#e06a00"], ["#ff6b8b", "#e04869"]]);
  const fl = [];
  for (let i = 0; i < 2; i++) fl.push({ H: 62 + r() * 22, x: (i ? 1 : -1) * (6 + r() * 8), w: (r() - 0.5) * 18 });
  let s = sprout(seg(p, 0, 0.08) * (1 - seg(p, 0.2, 0.32)));
  s += leafG(0, 0, -145, 20, 4.6, eOut(seg(p, 0.1, 0.4)), "#6aa35c", G.vein) + leafG(0, 0, -38, 18, 4.2, eOut(seg(p, 0.14, 0.44)), "#7cb46c", G.vein);
  fl.forEach((f, i) => {
    const g = eOut(seg(p, 0.08 + i * 0.06, 0.72)), h = f.H * g, top = [f.x * g + f.w * 0.2 * g, -h], c1 = [f.w * g, -h * 0.35], c2 = [-f.w * 0.5 * g, -h * 0.7];
    if (h > 2) s += '<path d="M0 0C' + f1(c1[0]) + " " + f1(c1[1]) + " " + f1(c2[0]) + " " + f1(c2[1]) + " " + f1(top[0]) + " " + f1(top[1]) + '" stroke="#5f9a52" stroke-width="1.7" fill="none" stroke-linecap="round"/>';
    const b = eBack(seg(p, 0.66 + i * 0.08, 0.96)), droop = 1 - seg(p, 0.6 + i * 0.08, 0.7 + i * 0.08);
    if (b > 0.02) s += '<g transform="translate(' + f1(top[0]) + " " + f1(top[1]) + ")scale(" + f2(b) + ')">' + circ(-5, -2, 7.6, c[0]) + circ(5, -2, 7.6, c[0]) + circ(0, -7, 7.6, c[1]) + circ(0, 2, 7.2, c[0]) + circ(0, -1.5, 3.4, "#2a1d2e") + circ(-1.2, -2.6, 0.7, "#6a4f70") + circ(1.3, -0.6, 0.7, "#6a4f70") + "</g>";
    else if (p > 0.45) s += '<g transform="translate(' + f1(top[0]) + " " + f1(top[1]) + ")rotate(" + f1(140 * droop) + ')">' + ell(0, -4, 2.9, 4.7, 0, "#6aa35c") + "</g>";
  });
  return s;
}
function cactus(p, r, o) {
  const body = o.gold ? "#d9b64a" : r() < 0.5 ? "#5aa65c" : "#4f9a6a", flower = o.gold ? "#fff1a8" : pick(r, ["#ff6fae", "#ffb03a", "#ff5a6e"]);
  const Hc = 58 + r() * 14, la = 24 + r() * 10, ra = 34 + r() * 10;
  const g = eOut(seg(p, 0.04, 0.6)), h = Math.max(4, Hc * g);
  let s = "";
  const al = eOut(seg(p, 0.35, 0.65)), ar = eOut(seg(p, 0.45, 0.75));
  if (al > 0.02) s += '<path d="M-6 ' + f1(-la) + "H" + f1(-9 - 13 * al) + "V" + f1(-la - 16 * al) + '" stroke="' + body + '" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  if (ar > 0.02) s += '<path d="M6 ' + f1(-ra) + "H" + f1(9 + 12 * ar) + "V" + f1(-ra - 13 * ar) + '" stroke="' + body + '" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  s += '<rect x="-11" y="' + f1(-h) + '" width="22" height="' + f1(h + 1) + '" rx="11" fill="' + body + '"/>';
  if (h > 14) s += '<path d="M-4 ' + f1(-h + 7) + "V-3M4 " + f1(-h + 7) + 'V-3" stroke="rgba(255,255,255,.24)" stroke-width="1.6" stroke-linecap="round"/>';
  if (g > 0.5) { for (let k = 0; k < 6; k++) { const y = -8 - k * (h - 14) / 6; s += '<path d="M-11 ' + f1(y) + 'l-3 -1M11 ' + f1(y - 4) + 'l3 -1" stroke="#eef7dc" stroke-width=".9" stroke-linecap="round"/>'; } }
  const b = eBack(seg(p, 0.78, 1));
  if (b > 0.02) { let pt = ""; for (let k = 0; k < 6; k++) pt += '<ellipse cy="-4.2" rx="2.5" ry="4.5" fill="' + flower + '" transform="rotate(' + (k * 60) + ')"/>'; s += '<g transform="translate(0 ' + f1(-h - 1) + ")scale(" + f2(b) + ')">' + pt + circ(0, 0, 2.2, "#ffe27a") + "</g>"; }
  return s;
}
function fern(p, r, o) {
  const col = o.gold ? ["#d8a91c", "#f0cc52"] : ["#3f9a52", "#5bb565"];
  const fr = [];
  for (let i = 0; i < 7; i++) fr.push({ a: -90 + (i - 3) * 22 + (r() - 0.5) * 8, L: 54 + r() * 22 - Math.abs(i - 3) * 4 });
  let s = sprout(seg(p, 0, 0.07) * (1 - seg(p, 0.16, 0.28)));
  fr.forEach((f, i) => {
    const g = eOut(seg(p, 0.06 + Math.abs(i - 3) * 0.05, 0.75 + Math.abs(i - 3) * 0.03));
    if (g < 0.02) return;
    const rad = f.a * Math.PI / 180, L = f.L;
    const top = [Math.cos(rad) * L, Math.sin(rad) * L * 0.95 + L * 0.18], ctrl = [Math.cos(rad) * L * 0.45, Math.sin(rad) * L * 0.78];
    s += '<path d="' + qsplit([0, 0], ctrl, top, g) + '" stroke="' + col[0] + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
    for (let k = 1; k <= 9; k++) {
      const t = k / 10; if (t > g) break;
      const pt = qpt([0, 0], ctrl, top, t), nx = qpt([0, 0], ctrl, top, Math.min(1, t + 0.02)), ang = Math.atan2(nx[1] - pt[1], nx[0] - pt[0]) * 180 / Math.PI, sz = (1 - t * 0.7) * 8;
      s += leafG(pt[0], pt[1], ang - 68, sz, 2.3, 1, k % 2 ? col[1] : col[0]) + leafG(pt[0], pt[1], ang + 68, sz, 2.3, 1, k % 2 ? col[0] : col[1]);
    }
    if (g < 0.97) { const tp = qpt([0, 0], ctrl, top, g); s += circ(tp[0], tp[1], 2.3 * (1 - g) + 0.9, col[0]); }
  });
  return s;
}
function succulent(p, r, o) {
  const base = o.gold ? ["#e3b93a", "#f3d470"] : r() < 0.5 ? ["#7fbea3", "#a3d6bf"] : ["#86aed0", "#acc9e4"], tip = "#e98aa6";
  const H = 44 + r() * 12;
  let s = "";
  [[9, 33, 12.5, 0.04], [7, 26, 10.5, 0.24], [5, 19, 8.5, 0.44], [3, 12, 6.5, 0.6]].forEach((L) => {
    const n = L[0], len = L[1], w = L[2], g = eBack(seg(p, L[3], L[3] + 0.3));
    if (g < 0.02) return;
    for (let k = 0; k < n; k++) {
      const a = -180 + (180 / (n - 1)) * k;
      s += '<g transform="rotate(' + f1(a) + ")scale(" + f2(g) + ')"><path d="M0 0Q' + f1(len * 0.5) + " " + f1(-w) + " " + f1(len) + " 0Q" + f1(len * 0.5) + " " + f1(w * 0.6) + ' 0 0Z" fill="' + (k % 2 ? base[1] : base[0]) + '"/>' + circ(len - 1.8, 0, 1.9, tip) + "</g>";
    }
  });
  const fs = eOut(seg(p, 0.8, 1));
  if (fs > 0.02) {
    const h = H * fs;
    let bells = "";
    for (let k = 0; k < 4; k++) bells += circ(9 + k * 2.2, -h - 2 + k * 3.2, 2.1 * fs, o.gold ? "#fff1a8" : "#ff9a62");
    s = stemP([2, -4], [12, -h * 0.6], [9, -h - 2], 1.5, "#c9727e") + s + bells;
  }
  return s;
}
function bluebell(p, r, o) {
  const bell = o.gold ? "#f2c234" : pick(r, ["#5a7dff", "#7d6bff", "#4f9dff"]);
  const H = 70 + r() * 12, dir = r() < 0.5 ? -1 : 1;
  let s = sprout(seg(p, 0, 0.08) * (1 - seg(p, 0.2, 0.32)));
  s += leafG(0, 0, -100, 36, 4.6, eOut(seg(p, 0.08, 0.4)), G.leaf, G.vein) + leafG(0, 0, -76, 30, 4.2, eOut(seg(p, 0.12, 0.45)), G.leaf2, G.vein) + leafG(0, 0, -126, 26, 4, eOut(seg(p, 0.16, 0.48)), G.leaf);
  const g = eOut(seg(p, 0.08, 0.7)), p0 = [0, 0], c = [dir * 2, -H * 1.12], p1 = [dir * 40, -H * 0.58];
  s += '<path d="' + qsplit(p0, c, p1, g) + '" stroke="' + G.stem + '" stroke-width="1.9" fill="none" stroke-linecap="round"/>';
  for (let k = 0; k < 5; k++) {
    const t = 0.42 + k * 0.13; if (t > g) break;
    const pt = qpt(p0, c, p1, t), b = eBack(seg(p, 0.55 + k * 0.08, 0.75 + k * 0.06));
    if (b < 0.02) continue;
    s += '<g transform="translate(' + f1(pt[0]) + " " + f1(pt[1]) + ")scale(" + f2(b * (1.05 + k * 0.06)) + ')"><path d="M0 0V3" stroke="' + G.stem + '" stroke-width="1"/><path d="M-4.2 11.5C-4.7 6 -3.2 3 0 3C3.2 3 4.7 6 4.2 11.5L2.7 10L1.3 11.6L0 10.2L-1.3 11.6L-2.7 10Z" fill="' + bell + '"/></g>';
  }
  return s;
}

/* trees: the branch shape is built once per seed, then drawn at any growth stage */
const TREE_SPECS = {
  cherry: { trunk: "#7a4b3a", depth: 5, splits: 2, extra: 0.35, spread: 0.5, jit: 0.25, up: 0.1, len: 34, lenK: 0.75, w: 7, wK: 0.66, canopy: "blossom", cols: ["#ffb3cc", "#ff94b6", "#ffd2e1", "#fff0f5"], size: 1 },
  jacaranda: { trunk: "#6e4f45", depth: 5, splits: 2, extra: 0.3, spread: 0.55, jit: 0.25, up: 0.08, len: 33, lenK: 0.76, w: 6.5, wK: 0.66, canopy: "blossom", cols: ["#9b7bff", "#b49aff", "#cbb8ff", "#8a6ae8"], size: 1 },
  oak: { trunk: "#6b4a32", depth: 4, splits: 2, extra: 0.5, spread: 0.62, jit: 0.3, up: 0.12, len: 36, lenK: 0.73, w: 9, wK: 0.64, canopy: "blob", cols: ["#2f7d43", "#409656", "#5aaf68", "#82c785"], size: 1.15 },
  maple: { trunk: "#6a4530", depth: 4, splits: 2, extra: 0.45, spread: 0.58, jit: 0.3, up: 0.14, len: 36, lenK: 0.73, w: 8, wK: 0.64, canopy: "blob", cols: ["#c8402a", "#e8622f", "#f7953b", "#ffc25c"], size: 1.1 },
  lemon: { trunk: "#73513a", depth: 4, splits: 2, extra: 0.45, spread: 0.6, jit: 0.3, up: 0.12, len: 30, lenK: 0.74, w: 7.5, wK: 0.64, canopy: "blob", cols: ["#357f45", "#4aa05a", "#69b96d", "#8fd08b"], size: 1, fruit: "#ffd23f" },
  birch: { trunk: "#f3efe8", bark: "#3d3a36", depth: 4, splits: 2, extra: 0.3, spread: 0.42, jit: 0.2, up: 0.2, len: 44, lenK: 0.7, w: 5.5, wK: 0.68, canopy: "blob", cols: ["#7fbf5e", "#9bd176", "#b8e092", "#d3eeb2"], size: 0.82 },
  willow: { trunk: "#6e5a3f", depth: 4, splits: 2, extra: 0.4, spread: 0.72, jit: 0.3, up: 0.05, len: 36, lenK: 0.72, w: 7.5, wK: 0.64, canopy: "willow", cols: ["#86c164", "#a3d27e", "#6fae52"], size: 1 },
  pine: { special: "pine" },
  palm: { special: "palm" },
};
const TCACHE = new Map();
function treeStruct(sp, seed) {
  const r = mulberry(seed), segs = [], tips = [];
  (function grow(x, y, ang, len, w, d) {
    const bend = (r() - 0.5) * 0.4;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    const cx = (x + x2) / 2 + Math.cos(ang + Math.PI / 2) * len * bend * 0.5, cy = (y + y2) / 2 + Math.sin(ang + Math.PI / 2) * len * bend * 0.5;
    segs.push({ p0: [x, y], c: [cx, cy], p1: [x2, y2], w, d });
    const midTip = r(), tipK = r();
    if (d >= sp.depth) { tips.push({ x: x2, y: y2, k: tipK }); return; }
    if (d >= 2 && midTip < 0.45) tips.push({ x: (x + x2) / 2, y: (y + y2) / 2, k: tipK });
    const n = sp.splits + (r() < sp.extra ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * sp.spread;
      let na = ang + off + (r() - 0.5) * sp.jit;
      na += (-Math.PI / 2 - na) * sp.up;
      grow(x2, y2, na, len * sp.lenK * (0.82 + r() * 0.3), Math.max(0.8, w * sp.wK), d + 1);
    }
  })(0, 0, -Math.PI / 2 + (r() - 0.5) * 0.12, sp.len, sp.w, 0);
  tips.forEach((t) => { t.r = r(); t.r2 = r(); t.r3 = r(); });
  return { segs, tips };
}
function pineSVG(p, r, o) {
  const cols = o.gold ? GOLD : ["#2b6e4a", "#357f57", "#4a9c6c", "#5fb37f"];
  const H = 120 + r() * 14, ws = [];
  for (let i = 0; i < 6; i++) ws.push(0.9 + r() * 0.2);
  const g = Math.max(0.08, eOut(seg(p, 0.02, 0.8))), th = H * g;
  let s = '<path d="M0 0V' + f1(-Math.max(3, th * 0.9)) + '" stroke="#6b4a32" stroke-width="' + f1(2.5 + 4.5 * g) + '" stroke-linecap="round"/>';
  for (let i = 0; i < 6; i++) {
    const y0 = -th * (0.16 + i * 0.13), w = (44 - i * 6.4) * ws[i] * (0.35 + 0.65 * g), hg = th * 0.25;
    const lg = eBack(seg(p, 0.03 + i * 0.07, 0.2 + i * 0.08)); if (lg < 0.02) continue;
    s += '<g transform="translate(0 ' + f1(y0) + ")scale(" + f2(lg) + ')"><path d="M' + f1(-w) + " 0Q0 " + f1(-hg * 0.32) + " " + f1(w) + " 0L0 " + f1(-hg) + 'Z" fill="' + cols[i % 2 ? 1 : 0] + '"/><path d="M' + f1(w * 0.05) + " " + f1(-hg * 0.86) + "L0 " + f1(-hg) + "L" + f1(w * 0.62) + " " + f1(-hg * 0.08) + 'Z" fill="' + cols[2] + '" opacity=".6"/></g>';
  }
  return s;
}
function palmSVG(p, r, o) {
  const cols = o.gold ? GOLD : ["#2f8443", "#43a058", "#5cb86c"];
  const H = 108 + r() * 14, lean = 12 + r() * 12, fr = [];
  for (let i = 0; i < 8; i++) fr.push({ a: -172 + i * 23 + (r() - 0.5) * 8, L: 40 + r() * 12 });
  const g = eOut(seg(p, 0.04, 0.6)), h = H * g, top = [lean * g, -h], c = [-6 * g, -h * 0.5];
  let s = '<path d="M0 0Q' + f1(c[0]) + " " + f1(c[1]) + " " + f1(top[0]) + " " + f1(top[1]) + '" stroke="#a07a52" stroke-width="' + f1(4 + 3.5 * g) + '" fill="none" stroke-linecap="round"/>';
  for (let k = 1; k < 10; k++) { const pt = qpt([0, 0], c, top, k / 10); if (-pt[1] < 8 || k / 10 > 0.93) continue; s += '<path d="M' + f1(pt[0] - 3.4) + " " + f1(pt[1]) + 'h6.8" stroke="#7d5a38" stroke-width="1.2" stroke-linecap="round"/>'; }
  const fg = Math.max(0, eOut(seg(p, 0.06, 0.92)));
  if (fg > 0.02) fr.forEach((f, i) => {
    const L = f.L * fg, rad = f.a * Math.PI / 180;
    const end = [top[0] + Math.cos(rad) * L, top[1] + Math.sin(rad) * L * 0.55 + L * 0.42], ctrl = [top[0] + Math.cos(rad) * L * 0.55, top[1] + Math.sin(rad) * L * 0.7 - 6];
    s += '<path d="M' + f1(top[0]) + " " + f1(top[1]) + "Q" + f1(ctrl[0]) + " " + f1(ctrl[1]) + " " + f1(end[0]) + " " + f1(end[1]) + '" stroke="' + cols[i % 3] + '" stroke-width="2" fill="none" stroke-linecap="round"/>';
    for (let k = 2; k <= 9; k++) {
      const t = k / 10, pt = qpt(top, ctrl, end, t), nx = qpt(top, ctrl, end, Math.min(1, t + 0.03)), ang = Math.atan2(nx[1] - pt[1], nx[0] - pt[0]), ln = 9 * (1 - t * 0.6) * fg;
      [1, -1].forEach((sd) => { const a2 = ang + sd * 1.15 + 0.35; s += '<path d="M' + f1(pt[0]) + " " + f1(pt[1]) + "l" + f1(Math.cos(a2) * ln) + " " + f1(Math.abs(Math.sin(a2)) * ln + 2) + '" stroke="' + cols[(i + k) % 3] + '" stroke-width="1.4" stroke-linecap="round"/>'; });
    }
  });
  const nb = eBack(seg(p, 0.85, 1));
  if (nb > 0.02) s += circ(top[0] - 3, top[1] + 4, 3.2 * nb, "#7a5230") + circ(top[0] + 3, top[1] + 5, 3 * nb, "#8a6038") + circ(top[0], top[1] + 7, 2.8 * nb, "#6b4628");
  return s;
}
function treeSVG(k, p, seed, o) {
  const sp = TREE_SPECS[k] || TREE_SPECS.oak;
  if (sp.special === "pine") return pineSVG(p, mulberry(seed), o);
  if (sp.special === "palm") return palmSVG(p, mulberry(seed), o);
  const key = k + ":" + seed;
  let st = TCACHE.get(key);
  if (!st) { st = treeStruct(sp, seed); TCACHE.set(key, st); if (TCACHE.size > 400) TCACHE.delete(TCACHE.keys().next().value); }
  const cols = o.gold ? GOLD : sp.cols, D = sp.depth, dur = 0.56 / (D + 1), wk = 0.3 + 0.7 * eOut(seg(p, 0, 0.85));
  let br = "", bark = "", buds = "", out = "";
  const budCol = o.gold ? [GOLD[1], GOLD[2]] : ["#6cbf62", "#8fd27c"];
  st.segs.forEach((q, i) => {
    const a = 0.03 + q.d * dur, lg = eOut(seg(p, a, a + dur * 1.15));
    if (lg <= 0.01) return;
    const d = qsplit(q.p0, q.c, q.p1, lg), w = Math.max(0.8, q.w * wk);
    if (sp.bark) out += '<path d="' + d + '" stroke="#bdb3a5" stroke-width="' + f1(w + 1.4) + '" fill="none" stroke-linecap="round"/>';
    br += '<path d="' + d + '" stroke="' + sp.trunk + '" stroke-width="' + f1(w) + '" fill="none" stroke-linecap="round"/>';
    if (sp.bark && q.d < 2) bark += '<path d="' + d + '" stroke="' + sp.bark + '" stroke-width="' + f1(w * 0.5) + '" stroke-dasharray="1.4 7" fill="none" opacity=".7"/>';
    if (q.d === 0 && p < 0.3) { const tp = qpt(q.p0, q.c, q.p1, lg), sz = 1 - seg(p, 0.16, 0.3); buds += leafG(tp[0], tp[1], -150, 11, 4.2, sz, budCol[0]) + leafG(tp[0], tp[1], -30, 11, 4.2, sz, budCol[1]); }
    if (q.d >= 1 && lg > 0.5 && p < 0.995) { const bs = eOut(seg(p, a + dur * 0.7, a + dur * 2.2)) * (sp.canopy === "willow" ? 0.8 : 1); if (bs > 0.02) { const ang = Math.atan2(q.p1[1] - q.c[1], q.p1[0] - q.c[0]) * 180 / Math.PI, tp = qpt(q.p0, q.c, q.p1, lg); buds += leafG(tp[0], tp[1], ang - 40, 7.5, 3, bs, budCol[i % 2]) + leafG(tp[0], tp[1], ang + 40, 7, 2.8, bs, budCol[(i + 1) % 2]); } }
  });
  let can = "";
  if (sp.canopy === "blob") {
    let back = "", mid = "", hi = "", fruit = "";
    st.tips.forEach((t) => {
      const g = eBack(seg(p, 0.5 + t.k * 0.22, 0.8 + t.k * 0.18));
      if (g < 0.02) return;
      const R = (9 + t.r * 7) * sp.size * g;
      back += circ(t.x + 2, t.y + 2.5, R * 1.08, cols[0]);
      mid += circ(t.x - t.r2 * 3, t.y - 2, R * 0.9, cols[1]);
      hi += circ(t.x - 3, t.y - 4.5, R * 0.48, cols[2], ' opacity=".9"');
      if (sp.fruit && t.r3 > 0.45) fruit += circ(t.x + (t.r2 - 0.5) * 9, t.y + 2, 2.3 * eBack(seg(p, 0.88, 1)), sp.fruit);
    });
    can = back + mid + hi + fruit;
  } else if (sp.canopy === "blossom") {
    st.tips.forEach((t) => {
      const g = eBack(seg(p, 0.55 + t.k * 0.2, 0.85 + t.k * 0.14));
      if (g < 0.02) return;
      for (let j = 0; j < 6; j++) { const a = j * 1.05 + t.r * 6, rr = 3 + t.r2 * 4.5; can += circ(t.x + Math.cos(a) * rr, t.y + Math.sin(a) * rr * 0.8, (3.3 + ((j + Math.floor(t.r3 * 5)) % 3)) * g, cols[(j + Math.floor(t.r * 4)) % cols.length]); }
      can += circ(t.x, t.y, 1.3 * g, "#ffe39a");
    });
  } else if (sp.canopy === "willow") {
    st.tips.forEach((t) => {
      const g = eOut(seg(p, 0.5 + t.k * 0.25, 0.9 + t.k * 0.1));
      if (g < 0.02) return;
      can += circ(t.x, t.y, 6 * g, cols[2], ' opacity=".75"');
      for (let j = 0; j < 3; j++) {
        const dx = (j - 1) * 4 + (t.r - 0.5) * 4, L = (26 + t.r2 * 24) * g;
        can += '<path d="M' + f1(t.x) + " " + f1(t.y) + "Q" + f1(t.x + dx * 2) + " " + f1(t.y + L * 0.3) + " " + f1(t.x + dx * 1.4) + " " + f1(t.y + L) + '" stroke="' + cols[j % cols.length] + '" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-dasharray="3.2 1.4"/>';
      }
    });
  }
  return out + br + bark + buds + can;
}

/* what can grow, and the drawer for each */
const SPECIES = [
  { k: "cherry", name: "Cherry blossom", tree: 1 }, { k: "jacaranda", name: "Jacaranda", tree: 1 }, { k: "oak", name: "Oak", tree: 1 },
  { k: "maple", name: "Maple", tree: 1 }, { k: "lemon", name: "Lemon tree", tree: 1 }, { k: "birch", name: "Birch", tree: 1 },
  { k: "pine", name: "Pine", tree: 1 }, { k: "willow", name: "Willow", tree: 1 }, { k: "palm", name: "Palm", tree: 1 },
  { k: "tulip", name: "Tulip" }, { k: "daisy", name: "Daisies" }, { k: "sunflower", name: "Sunflower" }, { k: "lavender", name: "Lavender" },
  { k: "rose", name: "Rose bush" }, { k: "poppy", name: "Poppies" }, { k: "cactus", name: "Cactus" }, { k: "fern", name: "Fern" },
  { k: "succulent", name: "Succulent" }, { k: "bluebell", name: "Bluebells" },
];
const SP = {}; SPECIES.forEach((x) => { SP[x.k] = x; });
const TREE_KEYS = SPECIES.filter((x) => x.tree).map((x) => x.k);
const DRAW = { tulip, daisy, sunflower, lavender, rose, poppy, cactus, fern, succulent, bluebell };
function plantName(k, gold) { return (gold ? "Golden " : "") + ((SP[k] && SP[k].name) || "Plant"); }
function plantSVG(k, p, seed, gold) {
  const o = { gold: !!gold };
  let s = DRAW[k] ? DRAW[k](p, mulberry(seed || 1), o) : treeSVG(k, p, seed || 1, o);
  if (gold && p > 0.9) {
    const r = mulberry((seed || 1) + 7), tall = SP[k] && SP[k].tree ? 120 : 80;
    for (let i = 0; i < 5; i++) { const x = (r() - 0.5) * 80, y = -18 - r() * tall; s += '<path class="spark" style="animation-delay:-' + f1(r() * 2) + 's" d="M' + f1(x) + " " + f1(y - 4.5) + 'l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3-3.3-1.2 3.3-1.2z" fill="#ffe27a"/>'; }
  }
  return s;
}
function potSVG() {
  return '<path d="M-30 3L-25 36Q-24 40 -20 40H20Q24 40 25 36L30 3Z" fill="#d9774e"/><path d="M-26 8L-22.5 33" stroke="#fff" stroke-opacity=".2" stroke-width="3.2" stroke-linecap="round"/>' +
    '<rect x="-34" y="-5" width="68" height="11" rx="4.5" fill="#e98b5d"/><ellipse cx="0" cy="-3.4" rx="29" ry="3.4" fill="#5a3b2a"/>';
}
