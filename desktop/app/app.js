/* Game Plan desktop: one page, backed by the Obsidian vault (server.py).
   The reward loop: finish something → stamp + sound → it lands on "Done today" → its week tile fills. */
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const key = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));

const CLASS_VAR = { "CS 350": "--c-cs350", "CS 301": "--c-cs301", "Math 314": "--c-math314", "Internship Course": "--c-intern" };
const cc = (cls) => `--cc:var(${CLASS_VAR[cls] || "--c-other"})`;
const CHECK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let S = null, month = null, selDay = null, showAllLater = false, showAllLate = false;
let justDone = new Set();          // ids finished this moment → pop their tile / drop their pile card
let heroArrive = false;

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json", "X-Game-Plan": "1" }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "server error " + r.status);
  return r.json();
}

async function load() {
  try { S = await api("/api/state"); }
  catch (e) { $("#hero").innerHTML = '<p class="empty-title">Game Plan can\'t reach your vault.</p><p class="why">Start the server with <code>zsh desktop/install.sh</code>, then reload this page.</p>'; return; }
  if (!month) { const t = parseDay(S.today); month = new Date(t.getFullYear(), t.getMonth(), 1); }
  render();
}

/* ---------- sound: a soft two-note "tock", a chord when the week is clear ---------- */
let actx = null;
const soundOn = () => localStorage.getItem("gp.sound") !== "off";
function play(notes) {
  if (!soundOn()) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = actx.currentTime;
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = t0 + i * 0.09;
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.4);
    });
  } catch (e) { /* audio blocked: fine */ }
}
const DING = [659.3, 987.8], FANFARE = [523.3, 659.3, 784, 1046.5];

/* ---------- labels ---------- */
function dueLabel(t) {
  if (t.days == null) return { text: "No due date", cls: "" };
  if (t.days < 0) return { text: -t.days === 1 ? "1 day late" : -t.days + " days late", cls: "late" };
  if (t.days === 0) return { text: "Due today", cls: "soon" };
  if (t.days === 1) return { text: "Due tomorrow", cls: "soon" };
  const d = parseDay(t.due);
  return { text: "Due " + d.toLocaleDateString([], t.days < 7 ? { weekday: "long" } : { month: "short", day: "numeric" }), cls: "" };
}

/* ---------- render ---------- */
function render() {
  $("#today").textContent = parseDay(S.today).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  renderWeek(); renderHero(); renderLists(); renderPile(); renderCal();
  justDone = new Set();
}

function renderWeek() {
  const w = S.week, done = w.filter((t) => t.status === "done").length;
  const tiles = w.map((t) => `<span class="tile${t.status === "done" ? " done" : ""}${justDone.has(t.id) ? " pop" : ""}" style="${cc(t.class)}" title="${esc(t.title)}"></span>`).join("");
  $("#week").innerHTML = w.length
    ? `<div class="tiles" aria-hidden="true">${tiles}</div><span class="week-label"><b>${done}</b> of ${w.length} done this week</span>`
    : '<span class="week-label">Nothing due this week</span>';
}

function renderHero() {
  const h = S.hero, el = $("#hero");
  el.className = "hero" + (heroArrive ? " arriving" : ""); heroArrive = false;
  if (!h) {
    el.innerHTML = `<div class="hero-top"><span class="lead">Nothing open</span></div>
      <h2>You're caught up.</h2><p class="why">Every assignment is done. Go do something that isn't homework.</p>`;
    return;
  }
  const d = dueLabel(h);
  el.innerHTML = `
    <div class="hero-top"><span class="lead">${h.status === "doing" ? "Keep going on" : "Start here"}</span>
      <span class="chip" style="${cc(h.class)}">${esc(h.class)}</span><span class="due ${d.cls}">${d.text}</span></div>
    <h2>${esc(h.title)}</h2>
    <p class="why">${esc(h.why)}</p>
    <p class="step"><strong>First 5 minutes:</strong> ${esc(h.first_step)}</p>
    <div class="actions">
      <button class="btn btn-go" type="button" data-act="start" data-id="${esc(h.id)}">Start in Claude</button>
      <button class="btn btn-done" type="button" data-act="done-hero" data-id="${esc(h.id)}">${CHECK_SVG} Mark done</button>
      <a class="link" href="${esc(h.obsidian)}">Open note</a>
    </div>
    <div class="stamp" aria-hidden="true">Done</div>`;
}

function row(t) {
  const d = dueLabel(t);
  return `<div class="row" data-row="${esc(t.id)}">
    <button class="check" type="button" data-act="done" data-id="${esc(t.id)}" aria-label="Mark ${esc(t.title)} done">${CHECK_SVG}</button>
    <span><a class="title" href="${esc(t.obsidian)}">${esc(t.title)}</a>${t.status === "doing" ? '<span class="started">started</span>' : ""}</span>
    <span class="chip" style="${cc(t.class)}">${esc(t.class)}</span><span class="due ${d.cls}">${d.text}</span>
  </div>`;
}

function renderLists() {
  const rest = S.open.filter((t) => !S.hero || t.id !== S.hero.id);
  const late = rest.filter((t) => t.days != null && t.days < 0);
  const week = rest.filter((t) => t.days != null && t.days >= 0 && t.days <= 7);
  const later = rest.filter((t) => t.days == null || t.days > 7);
  const allLate = S.open.filter((t) => t.days != null && t.days < 0).length;
  let html = "";
  if (late.length) {
    html += `<h3 class="late">Overdue (${late.length})</h3>` + (showAllLate ? late : late.slice(0, 3)).map(row).join("");
    if (late.length > 3) html += `<button class="more" type="button" data-act="late">${showAllLate ? "Show fewer" : "Show all " + late.length}</button>`;
    html += `<button class="bulk" type="button" data-act="bulk">Already turned these in? Mark all ${allLate} done</button>`;
  }
  html += `<h3>This week (${week.length})</h3>` + (week.map(row).join("") || '<p class="quiet">Nothing else due this week.</p>');
  if (later.length) {
    html += `<h3>Later (${later.length})</h3>` + (showAllLater ? later : later.slice(0, 4)).map(row).join("");
    if (later.length > 4) html += `<button class="more" type="button" data-act="later">${showAllLater ? "Show fewer" : "Show all " + later.length}</button>`;
  }
  $("#lists").innerHTML = html;
}

function renderPile() {
  const p = S.done_today;
  $("#pile-h").innerHTML = "Done today" + (p.length ? `<span class="pile-count">${p.length}</span>` : "");
  $("#pile").innerHTML = p.length
    ? p.slice().reverse().map((t, i) => `<div class="pile-card${justDone.has(t.id) ? " new" : ""}" style="${cc(t.class)};--r:${[-1.2, 0.8, -0.4, 1.1][i % 4]}deg">
        ${CHECK_SVG}<span class="t">${esc(t.title)}</span></div>`).join("")
    : '<p class="pile-empty">Finish something and it lands here.</p>';
}

function renderCal() {
  $("#cal-h").textContent = month.toLocaleDateString([], { month: "long", year: "numeric" });
  const byDay = {};
  S.calendar.forEach((t) => (byDay[t.due] = byDay[t.due] || []).push(t));
  const start = new Date(month); start.setDate(1 - ((month.getDay() + 6) % 7));
  let html = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="dow" aria-hidden="true">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = key(d), items = byDay[k] || [];
    const marks = items.map((t) => `<i class="mark${t.status === "done" ? " done" : t.days < 0 ? " late" : ""}" style="${cc(t.class)}"></i>`).join("");
    const label = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) + (items.length ? `, ${items.length} due` : "");
    html += `<button type="button" class="day${d.getMonth() !== month.getMonth() ? " other" : ""}${k === S.today ? " is-today" : ""}${k === selDay ? " sel" : ""}" data-act="day" data-day="${k}" aria-label="${label}" aria-pressed="${k === selDay}">
      <span class="n">${d.getDate()}</span><span class="marks">${marks}</span></button>`;
  }
  $("#cal").innerHTML = html;
  const sel = selDay ? byDay[selDay] || [] : [];
  $("#dayList").innerHTML = selDay
    ? `<h3>${parseDay(selDay).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</h3>` +
      (sel.length ? sel.map((t) => (t.status === "done"
        ? `<div class="row"><span class="check" style="background:var(--hi);border-color:transparent"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="opacity:1"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="title">${esc(t.title)}</span><span class="chip" style="${cc(t.class)}">${esc(t.class)}</span><span class="due">Done</span></div>`
        : row(t))).join("") : '<p class="quiet">Nothing due.</p>')
    : "";
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, undo) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button type="button" data-act="undo">Undo</button>' : "");
  el.hidden = false; el._undo = undo; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

/* ---------- finishing things ---------- */
let focusAfter = "hero";
async function finish(ids, animate, focus) {
  focusAfter = focus || "hero";
  const before = S.week.filter((t) => t.status === "done").length;
  const prev = ids.map((id) => ({ id, status: (S.open.find((t) => t.id === id) || {}).status || "todo" }));
  const save = Promise.all(ids.map((id) => api("/api/status", { id, status: "done" })));
  await animate();
  try { await save; } catch (e) { toast("Couldn't save that. Check that Game Plan's server is running (desktop/install.sh), then try again."); load(); return; }
  ids.forEach((id) => justDone.add(id));
  await load();
  const w = S.week, done = w.filter((t) => t.status === "done").length;
  const cleared = w.length && done === w.length && before < done;
  play(cleared ? FANFARE : DING);
  const name = ids.length === 1 ? (S.done_today.find((t) => t.id === ids[0]) || {}).title || "task" : ids.length + " tasks";
  const next = focusAfter === "hero" ? $("#hero") : $("#lists .check");
  if (next) next.focus({ preventScroll: focusAfter !== "hero" });
  toast(cleared ? "Week cleared. Every assignment due this week is done." : `Marked ${name} done`,
    () => Promise.all(prev.map((p) => api("/api/status", p))).then(load));
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "start") {
    const win = window.open("about:blank", "_blank");     // open now so it isn't popup-blocked
    try {
      const r = await api("/api/start", { id });
      if (win) win.location = r.url; else location.href = r.url;
      toast("Started. It's logged in today's daily note.");
    } catch (err) { if (win) win.close(); toast("Couldn't start. Check that Game Plan's server is running (desktop/install.sh), then try again."); }
    load();
  } else if (act === "done-hero") {
    b.disabled = true;
    await finish([id], async () => { const h = $("#hero"); h.classList.add("stamped"); play([392]); await wait(450); h.classList.add("leaving"); await wait(550); heroArrive = true; });
  } else if (act === "done") {
    b.disabled = true;
    await finish([id], async () => { const r = b.closest(".row"); r.classList.add("ticking"); await wait(500); r.classList.add("gone"); await wait(400); }, "list");
  } else if (act === "bulk") {
    const ids = S.open.filter((t) => t.days != null && t.days < 0).map((t) => t.id);
    await finish(ids, async () => { document.querySelectorAll("#lists .row").forEach((r) => { if (ids.includes(r.dataset.row)) r.classList.add("ticking"); }); await wait(600); heroArrive = true; });
  } else if (act === "undo") {
    const u = $("#toast")._undo; $("#toast").hidden = true; if (u) u();
  } else if (act === "prev" || act === "next") {
    month = new Date(month.getFullYear(), month.getMonth() + (act === "next" ? 1 : -1), 1); renderCal();
  } else if (act === "day") {
    selDay = selDay === b.dataset.day ? null : b.dataset.day; renderCal();
  } else if (act === "later") { showAllLater = !showAllLater; renderLists(); }
  else if (act === "late") { showAllLate = !showAllLate; renderLists(); }
});

const soundBtn = $("#sound");
soundBtn.setAttribute("aria-pressed", String(soundOn()));
soundBtn.addEventListener("click", () => {
  localStorage.setItem("gp.sound", soundOn() ? "off" : "on");
  soundBtn.setAttribute("aria-pressed", String(soundOn()));
  if (soundOn()) play(DING);
});

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
setInterval(load, 60000);
load();
