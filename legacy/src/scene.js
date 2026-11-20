/* ---------- the garden scene ---------- */
const SKY = {
  lmorning: { top: "#ffd9c4", bot: "#e6f1ff", hill1: "#a9d99a", hill2: "#8fcd86", g1: "#86c873", g2: "#62ad5f", orb: "#fff1c9", glow: "#ffe2a6" },
  lday: { top: "#a9d6ff", bot: "#e9f6ff", hill1: "#a6d896", hill2: "#8acb7f", g1: "#84c870", g2: "#5faa5c", orb: "#fff6d6", glow: "#ffeab0" },
  levening: { top: "#a996ff", bot: "#ffc9a3", hill1: "#9cc48f", hill2: "#7fb47a", g1: "#78b468", g2: "#56985a", orb: "#ffcf8a", glow: "#ffb46b" },
  lnight: { top: "#28306e", bot: "#5c5294", hill1: "#3f6a54", hill2: "#355f49", g1: "#3d6b48", g2: "#2b5137", orb: "#fdf6dc", glow: "#c9c4ff" },
  dmorning: { top: "#2b2550", bot: "#4a3d63", hill1: "#2f5a43", hill2: "#28503a", g1: "#2c5b3a", g2: "#1f432b", orb: "#ffe3b3", glow: "#a7718b" },
  dday: { top: "#13284d", bot: "#25507a", hill1: "#2c5d43", hill2: "#26553b", g1: "#2a5d3a", g2: "#1d452b", orb: "#fff1c4", glow: "#4f7fb0" },
  devening: { top: "#2a1d4d", bot: "#5c3552", hill1: "#2d5440", hill2: "#264a38", g1: "#285236", g2: "#1c3d29", orb: "#ffbe7a", glow: "#a1586b" },
  dnight: { top: "#0b0e2a", bot: "#232a5c", hill1: "#22432f", hill2: "#1d3b29", g1: "#21422c", g2: "#16301f", orb: "#f3efd8", glow: "#6c6ab8" },
};
const BF_COLS = ["#ff8a3d", "#5a8dff", "#ff6fae", "#ffc93c", "#a066ff", "#2ec5b6"];
function butterfly(x, y, col, i) {
  return '<g transform="translate(' + f1(x) + " " + f1(y) + ')"><g class="bf bf' + (i % 3) + '" style="animation-duration:' + f1(9 + (i % 4) * 2.6) + "s;animation-delay:-" + f1(i * 1.9) + 's">' +
    '<path class="wl" style="animation-delay:-' + f1(i * 0.11) + 's" d="M0 0C-6.5 -10 -13 -6.5 -11 -1C-13 3.5 -6.5 6.5 0 1Z" fill="' + col + '"/>' +
    '<path class="wr" style="animation-delay:-' + f1(i * 0.11) + 's" d="M0 0C6.5 -10 13 -6.5 11 -1C13 3.5 6.5 6.5 0 1Z" fill="' + col + '"/>' +
    '<path d="M0 -3.5V3.5" stroke="#2a1d2e" stroke-width="1.5" stroke-linecap="round"/></g></g>';
}
let SCENE_N = 0;
function sceneSVG(o) {
  const W = 400, H = o.big ? 250 : 180, gy = H - (o.big ? 74 : 58), hr = o.hour;
  const tod = hr >= 20 || hr < 6 ? "night" : hr < 11 ? "morning" : hr < 17 ? "day" : "evening";
  const P = SKY[(o.dark ? "d" : "l") + tod], id = (o.big ? "gb" : "gs") + (++SCENE_N), rnd = mulberry(4242);
  let s = '<svg class="scene" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMax slice" role="img" aria-label="' + esc(o.label || "Your garden") + '">' +
    '<defs><linearGradient id="' + id + 'k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + P.top + '"/><stop offset="1" stop-color="' + P.bot + '"/></linearGradient>' +
    '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + P.g1 + '"/><stop offset="1" stop-color="' + P.g2 + '"/></linearGradient>' +
    '<radialGradient id="' + id + 'o"><stop offset="0" stop-color="' + P.glow + '" stop-opacity=".9"/><stop offset="1" stop-color="' + P.glow + '" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#' + id + 'k)"/>';
  const ox = 336, oy = o.big ? 52 : 40;
  if (tod === "night") {
    for (let i = 0; i < 26; i++) s += circ(rnd() * W, rnd() * (gy - 40), 0.5 + rnd() * 0.9, "#fff", ' opacity="' + f2(0.35 + rnd() * 0.5) + '"');
    s += circ(ox, oy, 30, "url(#" + id + "o)") + circ(ox, oy, 12, P.orb) + circ(ox + 5, oy - 3, 10.5, P.top);
  } else {
    s += circ(ox, oy, 40, "url(#" + id + "o)") + circ(ox, oy, 14, P.orb);
    [[70, 34, 1], [205, 22, 0.8], [292, o.big ? 92 : 70, 0.65]].forEach((c) => {
      s += '<g opacity=".75" transform="translate(' + c[0] + " " + c[1] + ")scale(" + c[2] + ')">' + ell(0, 0, 22, 7, 0, "#fff") + ell(-10, -5, 11, 7, 0, "#fff") + ell(8, -7, 13, 9, 0, "#fff") + "</g>";
    });
  }
  s += '<path d="M0 ' + (gy - 16) + "C70 " + (gy - 46) + " 150 " + (gy - 32) + " 210 " + (gy - 14) + "S330 " + (gy - 44) + " 400 " + (gy - 22) + "V" + H + 'H0Z" fill="' + P.hill1 + '"/>';
  s += '<path d="M0 ' + (gy - 2) + "C90 " + (gy - 20) + " 190 " + (gy - 8) + " 260 " + (gy - 1) + "S360 " + (gy - 15) + " 400 " + (gy - 7) + "V" + H + 'H0Z" fill="' + P.hill2 + '"/>';
  s += '<path d="M0 ' + (gy + 3) + "Q100 " + (gy - 5) + " 200 " + (gy + 1) + "T400 " + (gy + 2) + "V" + H + 'H0Z" fill="url(#' + id + 'g)"/>';
  // the big trees: finished ones around the one growing now
  const slots = [[200, 0], [124, 1], [276, 1], [58, 2], [342, 2], [164, 3], [236, 3], [22, 4], [378, 4], [92, 5], [308, 5]];
  const tsc = o.big ? 0.7 : 0.5, done = o.trees.slice(-10).reverse(), items = [];
  done.forEach((t, i) => { const sl = slots[i + 1]; items.push({ x: sl[0], y: gy + 2 - (sl[1] > 2 ? 4 : 0), sc: tsc * (sl[1] > 2 ? 0.82 : 0.92), t, p: 1 }); });
  items.sort((a, b) => a.y - b.y);
  items.forEach((it) => { s += '<g transform="translate(' + it.x + " " + f1(it.y) + ")scale(" + f2(it.sc) + ')">' + plantSVG(it.t.k, 1, it.t.seed, it.t.gold) + "</g>"; });
  if (o.cur) s += '<g transform="translate(200 ' + (gy + 6) + ")scale(" + f2(tsc * 1.08) + ')"><ellipse cy="2" rx="26" ry="4" fill="#000" opacity=".1"/>' + plantSVG(o.cur.k, Math.max(0.06, o.frac), o.cur.seed, o.cur.gold) + "</g>";
  // grass tufts
  for (let i = 0; i < 26; i++) { const x = rnd() * W, y = gy + 8 + rnd() * (H - gy - 12); s += '<path d="M' + f1(x) + " " + f1(y) + "q-1 -5 -3.5 -7M" + f1(x) + " " + f1(y) + "q0 -6 1 -9M" + f1(x) + " " + f1(y) + 'q1.2 -4 4 -6" stroke="' + P.g2 + '" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".8"/>'; }
  // plants from focus sessions fill the front
  const pl = o.plants.slice(-(o.big ? 64 : 40)).map((q, i) => {
    const h = mulberry(Math.floor(Date.parse(q.at) / 1000) + i * 131);
    const row = Math.floor(h() * 3);
    return { q, x: 12 + h() * (W - 24), y: gy + 14 + row * ((H - gy - 20) / 3) + h() * 4, sc: (SP[q.k] && SP[q.k].tree ? 0.2 : 0.3) * (o.big ? 1.25 : 1) * (0.9 + row * 0.06) * (0.55 + 0.45 * q.g) };
  }).sort((a, b) => a.y - b.y);
  pl.forEach((it) => { s += '<g transform="translate(' + f1(it.x) + " " + f1(it.y) + ")scale(" + f2(it.sc) + ')">' + plantSVG(it.q.k, Math.max(0.3, it.q.g), it.q.seed, it.q.gold) + "</g>"; });
  // butterflies show up as today's points come in
  for (let i = 0; i < o.butterflies; i++) s += butterfly(40 + ((i * 97 + 31) % 320), gy - 24 - ((i * 53) % 46), o.goldFly && i === 0 ? "#ffd23f" : BF_COLS[i % BF_COLS.length], i);
  return s + "</svg>";
}
