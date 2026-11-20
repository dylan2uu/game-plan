/* Game Plan: dopamine layer.
   1. Daily welcome: first open each day, your numbers count up and your momentum line draws.
   2. Momentum panel: 14-day points line + this week's class bars, animated on every refresh.
   3. Finish burst: finishing a task sends glowing particles out of the points ring.
   Reads data from claude-shim.js (window.__gp, "gp:data", "gp:done"). Respects reduced motion. */
(function () {
  "use strict";
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DAY = 864e5;
  const CLASS_COLORS = { "CS 350": "#8B7CFF", "CS 301": "#22D3EE", "Math 314": "#3EE6A8", "Internship Course": "#FFB547" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const key = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  /* ---------- numbers ---------- */
  function stats(data) {
    const tasks = Object.values((data && data.tasks) || {});
    const done = tasks.filter((t) => t.status === "done" && t.doneAt);
    const perDay = {};
    done.forEach((t) => { const k = String(t.doneAt).slice(0, 10); perDay[k] = (perDay[k] || 0) + (+t.points || 1); });
    const t0 = today0(), days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(+t0 - i * DAY); days.push({ d, k: key(d), pts: perDay[key(d)] || 0 }); }
    const thisWeek = days.slice(7).reduce((a, x) => a + x.pts, 0), lastWeek = days.slice(0, 7).reduce((a, x) => a + x.pts, 0);
    const yesterday = days[12].pts, todayPts = days[13].pts;
    let streak = 0; for (let i = todayPts ? 13 : 12; i >= 0 && days[i].pts > 0; i--) streak++;
    const showedUp = days.slice(7).filter((x) => x.pts > 0).length;
    // this week's due work, by class (Mon-Sun)
    const mon = new Date(t0); mon.setDate(t0.getDate() - ((t0.getDay() + 6) % 7));
    const sun = new Date(+mon + 6 * DAY + DAY - 1);
    const byClass = {};
    tasks.filter((t) => t.due && t.status !== "dismissed" && t.status !== "cancelled").forEach((t) => {
      const d = new Date(String(t.due).slice(0, 10) + "T12:00");
      if (d < mon || d > sun) return;
      const c = t.course || "Other"; byClass[c] = byClass[c] || { done: 0, total: 0 };
      byClass[c].total++; if (t.status === "done") byClass[c].done++;
    });
    return { days, thisWeek, lastWeek, yesterday, todayPts, streak, showedUp, byClass,
             doneYesterday: done.filter((t) => String(t.doneAt).slice(0, 10) === days[12].k).length };
  }

  /* ---------- chart: smooth line + glow, draws itself ---------- */
  function lineChart(days, w, h, id) {
    const max = Math.max(5, ...days.map((x) => x.pts)), n = days.length, px = (i) => 8 + i * ((w - 16) / (n - 1));
    const py = (v) => h - 10 - (v / max) * (h - 26);
    const pts = days.map((x, i) => [px(i), py(x.pts)]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {                    // gentle curve between points
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2;
      d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    const last = pts[pts.length - 1];
    return `<svg class="mo-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Points per day, last 14 days">
      <defs>
        <linearGradient id="${id}s" x1="0" x2="1"><stop offset="0" stop-color="#8B7CFF"/><stop offset=".6" stop-color="#22D3EE"/><stop offset="1" stop-color="#FFB547"/></linearGradient>
        <linearGradient id="${id}f" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#8B7CFF" stop-opacity=".35"/><stop offset="1" stop-color="#8B7CFF" stop-opacity="0"/></linearGradient>
      </defs>
      <path class="mo-fill" d="${d} L${last[0]},${h} L${pts[0][0]},${h} Z" fill="url(#${id}f)"/>
      <path class="mo-line" d="${d}" fill="none" stroke="url(#${id}s)" stroke-width="3" stroke-linecap="round" pathLength="1"/>
      <circle class="mo-dot" cx="${last[0]}" cy="${last[1]}" r="5"/>
    </svg>`;
  }

  function countUp(el, to, ms) {
    if (RM || !to) { el.textContent = to; return; }
    const t0 = performance.now();
    (function step(t) {
      const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------- momentum panel (lives above the garden) ---------- */
  let panel = null, lastSig = "";
  function renderPanel(data) {
    const col = document.querySelector(".col-see"); if (!col) return;
    if (!panel) { panel = document.createElement("section"); panel.className = "momentum"; panel.setAttribute("aria-label", "Momentum"); col.insertBefore(panel, col.firstChild); }
    const s = stats(data), sig = JSON.stringify([s.days.map((x) => x.pts), s.byClass]);
    if (sig === lastSig) return; lastSig = sig;
    const delta = s.lastWeek ? Math.round(((s.thisWeek - s.lastWeek) / s.lastWeek) * 100) : (s.thisWeek ? 100 : 0);
    const classes = Object.entries(s.byClass).sort((a, b) => b[1].total - a[1].total);
    panel.innerHTML = `
      <div class="mo-head">
        <div><h2>Momentum</h2><p class="mo-sub"><b class="mo-num" data-to="${s.thisWeek}">0</b> pts this week</p></div>
        <span class="mo-delta ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs last week</span>
      </div>
      ${lineChart(s.days, 520, 120, "mo")}
      <div class="mo-days" aria-hidden="true">${s.days.map((x, i) => `<span${i === 13 ? ' class="mo-today"' : ""}>${"SMTWTFS"[x.d.getDay()]}</span>`).join("")}</div>
      <div class="mo-classes">${classes.length ? classes.map(([c, v]) => `
        <div class="mo-class"><span class="mo-cname">${esc(c)}</span>
          <span class="mo-track"><i style="--to:${v.total ? (v.done / v.total) * 100 : 0}%;--c:${CLASS_COLORS[c] || "#9DA3CC"}"></i></span>
          <span class="mo-count">${v.done}/${v.total}</span></div>`).join("") : '<p class="mo-sub">Nothing due this week.</p>'}</div>
      <div class="mo-foot">${s.streak ? `<span class="mo-chip hot">🔥 ${s.streak}-day run</span>` : ""}<span class="mo-chip">Showed up ${s.showedUp}/7 days</span></div>`;
    panel.querySelectorAll(".mo-num").forEach((el) => countUp(el, +el.dataset.to, 900));
    requestAnimationFrame(() => panel.classList.add("go"));
  }

  /* ---------- daily welcome ---------- */
  function ritual(data) {
    const k = key(new Date());
    if (localStorage.getItem("gp.ritual") === k) return;
    localStorage.setItem("gp.ritual", k);
    const s = stats(data);
    const line = s.showedUp >= 5 ? `You showed up ${s.showedUp} of the last 7 days. That's a habit now.`
      : s.yesterday ? `Yesterday counted. Let's stack today on top of it.`
      : s.thisWeek ? `You've already banked points this week. One more start keeps it moving.`
      : `Clean slate. One start is all today needs.`;
    const el = document.createElement("div");
    el.className = "ritual"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Daily recap");
    el.innerHTML = `<div class="rt-card">
      <p class="rt-hi">${new Date().toLocaleDateString([], { weekday: "long" })}. Welcome back.</p>
      <div class="rt-stats">
        <div><b data-to="${s.yesterday}">0</b><span>pts yesterday</span></div>
        <div><b data-to="${s.thisWeek}">0</b><span>pts this week</span></div>
        <div><b data-to="${s.streak}">0</b><span>day run</span></div>
      </div>
      ${lineChart(s.days, 560, 130, "rt")}
      <p class="rt-line">${esc(line)}</p>
      <button type="button" class="rt-go">Let's go</button></div>`;
    document.body.appendChild(el);
    el.querySelectorAll("b[data-to]").forEach((b, i) => setTimeout(() => countUp(b, +b.dataset.to, 1100), 250 + i * 180));
    requestAnimationFrame(() => el.classList.add("in"));
    const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), RM ? 0 : 450); };
    el.addEventListener("click", close);
    document.addEventListener("keydown", function k(e) { if (e.key === "Escape" || e.key === "Enter") { close(); document.removeEventListener("keydown", k); } });
    el.querySelector(".rt-go").focus({ preventScroll: true });
  }

  /* ---------- finish burst ---------- */
  function burst(points) {
    if (RM) return;
    const ring = document.querySelector(".top svg, .top .ring, #top") || document.body;
    const r = ring.getBoundingClientRect(), ox = r.left + Math.min(r.width, 70) / 2, oy = r.top + Math.min(r.height, 70) / 2;
    const c = document.createElement("canvas"), dpr = devicePixelRatio || 1;
    c.className = "burst"; c.width = innerWidth * dpr; c.height = innerHeight * dpr; document.body.appendChild(c);
    const g = c.getContext("2d"); g.scale(dpr, dpr);
    const cols = ["#FFB547", "#8B7CFF", "#22D3EE", "#3EE6A8", "#FF5C93"], n = 26 + Math.min(40, points * 4);
    const ps = Array.from({ length: n }, () => { const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 6;
      return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, r: 2 + Math.random() * 3, c: cols[(Math.random() * cols.length) | 0], life: 1 }; });
    (function frame() {
      g.clearRect(0, 0, innerWidth, innerHeight); let alive = 0;
      ps.forEach((p) => { if (p.life <= 0) return; alive++;
        p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.vx *= 0.985; p.life -= 0.016;
        g.globalAlpha = Math.max(0, p.life); g.shadowBlur = 12; g.shadowColor = p.c; g.fillStyle = p.c;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill(); });
      if (alive) requestAnimationFrame(frame); else c.remove();
    })();
    const top = document.getElementById("top"); if (top) { top.classList.remove("pulse"); void top.offsetWidth; top.classList.add("pulse"); }
  }

  let first = true;
  document.addEventListener("gp:data", (e) => {
    renderPanel(e.detail);
    if (first) { first = false; setTimeout(() => ritual(e.detail), 600); }
  });
  document.addEventListener("gp:done", (e) => burst(e.detail.points || 1));
  if (window.__gp) document.dispatchEvent(new CustomEvent("gp:data", { detail: window.__gp }));
})();
