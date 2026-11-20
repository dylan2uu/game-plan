/* ---------- garden: points grow the big trees, focus sessions plant things, today's points bring butterflies ---------- */
/* which tree grows next is a surprise: random kind, never the same twice in a row, about 1 in 9 golden */
const MT = [];
function milestoneTree(i) {
  while (MT.length <= i) {
    const j = MT.length, h = parseInt(fnv("tree-" + j + "-dylan"), 36), n = TREE_KEYS.length, prev = MT[j - 1];
    let x = h % n;
    if (prev && TREE_KEYS[x] === prev.k) x = (x + 1 + ((h >>> 5) % (n - 1))) % n;
    MT.push({ k: TREE_KEYS[x], seed: 1 + (h % 1000003), gold: (h >>> 3) % 9 === 4, i: j });
  }
  return MT[i];
}
let GD = { key: "", v: null };
function gardenData() {
  const key = S.ver + "|" + dayKey(new Date()) + "|" + JSON.stringify(S.settings.bank || 0) + "|" + (+S.settings.dailyTarget || 10);
  if (GD.key === key) return GD.v;
  const bank = S.settings.bank || {}, tk = dayKey(new Date());
  let pts = +bank.pts || 0, todayP = 0;
  const plants = Array.isArray(bank.plants) ? bank.plants.slice() : [], gains = [];
  S.tasks.forEach((t) => (t.log || []).forEach((e) => {
    const p = +e.p || 0; pts += p;
    if (p) gains.push({ at: e.at, p });
    if (dayKey(new Date(e.at)) === tk) todayP += p;
    if (Array.isArray(e.plants)) e.plants.forEach((q, j) => { if (q && q.plant) plants.push({ k: q.plant, seed: q.seed || 1, gold: !!q.gold, g: Math.max(0.3, Math.min(1, +q.g || 1)), at: e.at, j }); });
    else if (e.plant && (e.k === "pomo" || e.k === "focus")) plants.push({ k: e.plant, seed: e.seed || 1, gold: !!e.gold, g: e.k === "pomo" ? 1 : Math.max(0.3, Math.min(1, +e.g || 0.4)), at: e.at });
  }));
  habitPointsByDay().forEach((n, k) => { pts += n; gains.push({ at: k + "T12:00", p: n }); if (k === tk) todayP += n; });
  plants.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const trees = [];
  let acc = 0, need = FIRST_TREE, i = 0, run = +bank.pts || 0;
  const bloom = (at) => { while (run >= acc + need && i < 500) { acc += need; trees.push(Object.assign({ at }, milestoneTree(i))); i++; need = TREE_STEP; } };
  bloom(null);
  gains.sort((a, b) => String(a.at).localeCompare(String(b.at))).forEach((g) => { run += g.p; bloom(g.at); });
  const target = +S.settings.dailyTarget || 10;
  const found = new Set(), golds = new Set();
  plants.concat(trees.map((t) => ({ k: t.k, gold: t.gold }))).forEach((q) => { found.add(q.k); if (q.gold) golds.add(q.k); });
  const v = { found, golds, pts, todayP, plants, trees, cur: milestoneTree(i), curNeed: need, curHave: Math.round((pts - acc) * 10) / 10, frac: Math.max(0, Math.min(1, (pts - acc) / need)), butterflies: Math.min(6, Math.ceil(todayP / 2)), goldFly: todayP >= target };
  GD = { key, v };
  return v;
}
const SCN = {};
function sceneHTML(big) {
  const gd = gardenData(), dark = isDark(), hr = new Date().getHours(), slot = big ? "b" : "s";
  const key = [big, gd.pts, gd.plants.length, gd.butterflies, gd.goldFly, dark, hr >= 20 || hr < 6 ? "n" : hr < 11 ? "m" : hr < 17 ? "d" : "e"].join("|");
  if (SCN[slot] && SCN[slot].key === key) return SCN[slot];
  const label = "Your garden: " + gd.trees.length + " big trees, " + gd.plants.length + " plants, a " + "mystery tree" + " growing, " + gd.butterflies + " butterflies today";
  SCN[slot] = { key, html: sceneSVG({ trees: gd.trees, cur: gd.cur, frac: gd.frac, plants: gd.plants, butterflies: gd.butterflies, goldFly: gd.goldFly, big, dark, hour: hr, label }) };
  return SCN[slot];
}
function burst(anchor, small) {
  try {
    const r = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : null, ok = r && r.width > 0;
    const cx = ok ? r.left + r.width / 2 : window.innerWidth / 2, cy = ok ? r.top + Math.min(r.height / 2, 60) : window.innerHeight * 0.4;
    const cols = ["#ff6fae", "#ffc93c", "#5b5bf7", "#14a06c", "#ff8a3d", "#a066ff"];
    for (let i = 0; i < (small ? 10 : 18); i++) {
      const p = document.createElement("i"), a = Math.random() * Math.PI * 2, d = 36 + Math.random() * 70;
      p.className = "petal"; p.style.left = cx + "px"; p.style.top = cy + "px"; p.style.background = cols[i % cols.length];
      p.style.setProperty("--dx", (Math.cos(a) * d).toFixed(0) + "px"); p.style.setProperty("--dy", (Math.sin(a) * d - 30).toFixed(0) + "px"); p.style.setProperty("--rot", Math.round(Math.random() * 360) + "deg");
      document.body.appendChild(p); setTimeout(() => p.remove(), 1150);
    }
  } catch (e) { /* decoration only */ }
}
/* the line under a reward toast: how close the big tree is, or that it just bloomed */
function growLine(before) {
  const after = gardenData();
  let extra = "";
  if (after.butterflies > before.butterflies) extra = before.butterflies ? " · 🦋 another butterfly showed up" : " · 🦋 a butterfly showed up";
  if (after.trees.length > before.trees.length) {
    const t = after.trees[after.trees.length - 1];
    setTimeout(() => celebrateTree(t, after.cur), 700);
    return '<span class="toast-why">' + esc(plantName(t.k, t.gold)) + " bloomed! It was a mystery until now." + extra + "</span>";
  }
  const left = Math.max(0, after.curNeed - after.curHave);
  return '<span class="toast-why">' + esc("Mystery tree") + ": " + fmtPts(after.curHave) + "/" + after.curNeed + " pts, " + fmtPts(left) + " to bloom" + extra + "</span>";
}
function celebrateTree(t, next) {
  chime("focus");
  toast("<b>Fully grown!</b> Your " + esc(plantName(t.k, t.gold).toLowerCase()) + " joined the garden, and a " + "new mystery tree" + " just sprouted.", { html: true, ms: 9000, action: "See it", onAction: () => { S.view = "garden"; store.set("gp.view", "garden"); scheduleRender(); window.scrollTo({ top: 0, behavior: "smooth" }); } });
  const a = $("#gstrip"); if (a && !a.hidden) burst(a);
}

/* ---------- stats ---------- */
let ST = { key: "", v: null };
function stats() {
  const key = S.ver + "|" + dayKey(new Date());
  if (ST.key === key) return ST.v;
  ST = { key, v: statsRaw() };
  return ST.v;
}
function statsRaw() {
  const now = new Date(), tk = dayKey(now), days = new Map();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
  const earlies = [];
  S.tasks.forEach((t) => (t.log || []).forEach((e) => {
    const at = new Date(e.at); if (isNaN(at)) return;
    const k = dayKey(at); let d = days.get(k); if (!d) { d = { p: 0, m: 0, pomo: 0, done: 0, names: [] }; days.set(k, d); }
    d.p += +e.p || 0; d.m += WORK[e.k] ? +e.m || 0 : 0;
    if (e.k === "pomo") d.pomo++;
    if (e.k === "done" && t.status === "done") { d.done++; d.names.push(t.title); if (at >= weekStart && typeof e.early === "number") earlies.push(e.early); }
  }));
  habitPointsByDay().forEach((n, k) => { let d = days.get(k); if (!d) { d = { p: 0, m: 0, pomo: 0, done: 0, names: [] }; days.set(k, d); } d.p += n; });
  const counts = (d) => !!d && (d.p >= 1 || d.m >= 10);
  let streak = 0; const c = new Date(now);
  if (!counts(days.get(tk))) c.setDate(c.getDate() - 1);
  while (counts(days.get(dayKey(c)))) { streak++; c.setDate(c.getDate() - 1); }
  return { days, streak, today: days.get(tk) || { p: 0, m: 0, pomo: 0, done: 0, names: [] }, early: earlies.length ? earlies.reduce((a, b) => a + b, 0) / earlies.length : null };
}
function nudgeStats(nDays) {
  const since = Date.now() - nDays * DAY, now = Date.now(), byH = {};
  let sent = 0, worked = 0, fast = 0;
  S.tasks.forEach((t) => (t.nudges || []).forEach((n) => {
    const at = Date.parse(n.at); if (!(at > since) || at > now) return;
    const r = nudgeResult(t, n); if (r.state === "pending") return;
    sent++; if (r.fast || r.worked) worked++; if (r.fast) fast++;
    const h = new Date(at).getHours(); byH[h] = byH[h] || { s: 0, f: 0 }; byH[h].s++; if (r.fast) byH[h].f++;
  }));
  let best = null;
  Object.keys(byH).forEach((h) => { const v = byH[h]; if (v.s >= 2 && v.f && (!best || v.f / v.s > best.r)) best = { h: +h, r: v.f / v.s }; });
  return { sent, worked, fast, best };
}
