/* Game Plan page. Talks only to the local server; the vault is the database. */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PALETTE = ["#E0B36E", "#86B98A", "#7FB2D9", "#D98FA0", "#A99AD9", "#CDBB94", "#6CC0B3", "#D9876C", "#B5C97A", "#9FB8C9"];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let S = null;                     // last state from the server
let colors = {};                  // class -> color, stable while the set of classes is
let view = "now";                 // always opens on the one thing; "all" is one click away
let filter = { cls: null, day: null };
let calShift = 0;                 // calendar offset in 4-week steps
let highlight = null;             // task id to flash in the list
let version = null;               // server fingerprint: changes when anything the page shows changes
let stuckLevel = -1;

async function api(path, body) {
  const opts = body === undefined ? { cache: "no-store" }
    : { method: "POST", headers: { "Content-Type": "application/json", "X-Game-Plan": "1" }, body: JSON.stringify(body) };
  let r;
  try { r = await fetch(path, opts); } catch { throw new Error("Game Plan's server isn't answering. It restarts on its own in a few seconds."); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "That didn't work. Try again.");
  return data;
}
async function refresh() { try { render(await api("/api/state")); } catch (e) { say(e.message, true); } }
setInterval(async () => {                    // live: re-render within 2 s of any change (Obsidian, Brightspace, another window)
  if (document.hidden) return;
  try { const { v } = await api("/api/version"); if (version && v !== version) refresh(); } catch {}
}, 2000);
async function act(path, body) { try { render((await api(path, body)).state); } catch (e) { say(e.message, true); } }

/* ---------- small helpers ---------- */
const day = (isoDay) => new Date(isoDay + "T12:00:00");
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (isoDay, n) => { const d = day(isoDay); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((day(b) - day(a)) / 864e5);
const shortDay = (isoDay) => day(isoDay).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const pts = (n) => `${n} pt${n === 1 ? "" : "s"}`;
const about = (m) => (m ? `~${m >= 60 ? (m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`) : `${m}m`}` : "");
const hm = (m) => { m = Math.round(m || 0); const h = Math.floor(m / 60), r = m % 60; return h >= 10 ? `${Math.round(m / 60)}h` : h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
const firstSentence = (s) => (String(s || "").match(/^[^.!?]*[.!?]?["”']?/) || [""])[0].trim();
function dueWords(t) {
  if (!t.due) return "no due date";
  const d = daysBetween(S.today, t.due);
  return d < 0 ? `${-d} day${d === -1 ? "" : "s"} late` : d === 0 ? "due today" : d === 1 ? "due tomorrow" : "due " + shortDay(t.due);
}
function bucket(t) {
  if (!t.due) return "No due date";
  const d = daysBetween(S.today, t.due);
  return d < 0 ? "Overdue" : d === 0 ? "Due today" : d <= 7 ? "Next 7 days" : "Later";
}
function ago(isoTime) {
  const m = Math.max(0, Math.round((Date.now() - new Date(isoTime)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

/* Brightspace and other web links always open in Chrome (the server runs `open -a "Google Chrome"`). */
function titleLink(t) {
  return t.url && t.bs
    ? `<a class="t" href="${esc(t.url)}" data-ext title="Open in Brightspace (Chrome)">${esc(t.title)}<span class="ext" aria-hidden="true">↗</span></a>`
    : `<a class="t" href="${esc(t.note)}" title="Open the note in Obsidian">${esc(t.title)}</a>`;
}
document.addEventListener("click", async (e) => {
  const a = e.target.closest("a[data-ext]");
  if (!a) return;
  e.preventDefault();
  try { await api("/api/open", { url: a.href }); } catch { window.open(a.href, "_blank", "noopener"); }
});

/* ---------- render ---------- */
function render(state) {
  S = state;
  version = state.version;
  const keep = ["#next", "#list"].map((sel) => [sel, $(sel) ? $(sel).scrollTop : 0]);
  requestAnimationFrame(() => keep.forEach(([sel, top]) => { if ($(sel)) $(sel).scrollTop = top; }));
  const names = [...new Set(S.all.map((t) => t.cls))].sort();
  if (names.join("|") !== Object.keys(colors).join("|")) colors = Object.fromEntries(names.map((n, i) => [n, PALETTE[i % PALETTE.length]]));
  renderBar();
  renderHero();
  renderNext();
  renderProgress();
  if (view === "all") renderAll();
}

function renderBar() {
  const b = S.brightspace || {};
  const needs = !S.extension_ever || b.error === "not_connected" || b.error === "login";
  $("#setup").hidden = !needs;
  $("#setup").textContent = b.error === "login" ? "Log in to Brightspace in Chrome" : "Finish setup: Brightspace sync";
  $("#open-checkin").hidden = !S.checkin_due;
  $("#map").href = S.map;
}

function show(v) {
  view = v;
  history.replaceState(null, "", v === "all" ? "#all" : location.pathname);   // the view survives a reload
  $("#court").hidden = v !== "now";
  $("#board").hidden = v !== "all";
  $("#tab-now").setAttribute("aria-pressed", String(v === "now"));
  $("#tab-all").setAttribute("aria-pressed", String(v === "all"));
  if (v === "all" && S) renderAll();
}
$("#tab-now").onclick = () => show("now");
$("#tab-all").onclick = () => show("all");
$("#see-all").onclick = () => show("all");

/* ---------- Now: the one thing ---------- */
function renderHero() {
  const h = S.hero, box = $("#hero-body");
  if (!h) {
    box.dataset.key = "";
    box.innerHTML = `<div class="empty"><p class="kicker">Do this now</p><h1>Nothing's due.</h1>
      <p class="why">Type something into the box below, or take the win and go hoop.</p></div>`;
    return;
  }
  const running = !!h.started_at, key = h.id + (running ? ":run" : "");
  if (box.dataset.key === key) {            // same task: just refresh the words
    const why = $(".why", box);
    if (why) why.textContent = h.why;
    return;
  }
  box.dataset.key = key;
  stuckLevel = -1;
  const size = h.title.length > 60 ? "title longer" : h.title.length > 28 ? "title long" : "title";
  const t = S.all.find((x) => x.id === h.id) || h;
  const open = h.url ? `<a class="btn bs" href="${esc(h.url)}" data-ext>${h.bs ? "Open in Brightspace" : "Open link"}</a>` : "";
  const top = `<p class="chain">${h.chain.map(esc).join(" → ")}</p><h1 class="${size}">${esc(h.title)}</h1>`;
  if (running) {
    box.innerHTML = `<p class="kicker">On the clock</p>${top}
      <div class="clock"><span class="digits" id="digits">0:00</span>
        <span class="of">${h.guessed ? `you guessed ${h.minutes} min` : `estimate: ${hm(h.minutes)}`}</span></div>
      <div class="grow"></div>
      <div class="actions">
        <button class="go" id="done">Done</button>${open}<button class="btn" id="stuck">Stuck</button>
        <span class="spacer"></span>
        <span class="blocker ${S.blocker ? "" : "off"}">${S.blocker ? "Blocker on" : "Blocker not connected"}</span>
        <button class="quiet" id="stop">Stop timer</button>
      </div>
      <div class="stuck" id="stuck-box" hidden></div>`;
    tick();
    $("#stop").onclick = () => act("/api/stop", {});
  } else {
    const [due, late] = [dueWords(t), bucket(t) === "Overdue"];
    box.innerHTML = `<p class="kicker">Do this now</p>${top}
      <p class="why">${esc(h.why)}</p>
      <div class="facts"><button class="pts pts-btn" id="resize" title="Wrong size? Click to change it" aria-expanded="false">${pts(h.points)}</button>
        <span class="${late ? "late" : ""}">${esc(due[0].toUpperCase() + due.slice(1))}</span>
        ${t.unsubmitted ? `<span class="warn">Marked done here, but Brightspace shows no submission</span>` : ""}</div>
      <div class="sizes-pick" id="sizes" role="group" aria-label="Task size" hidden>Size:
        ${[1, 2, 3, 5, 8, 13].map((p) => `<button class="chip-btn" data-pts="${p}" aria-pressed="${p === h.points}">${p}</button>`).join("")}
        <span class="hint">1 is under 15 min, 13 is 4 h or more</span></div>
      <div class="grow"></div>
      <div class="actions">
        <button class="go" id="start">Start<span class="go-est">${about(h.est)}</span></button>${open}<button class="btn done" id="done">Done</button>
        <span class="spacer"></span><button class="quiet" id="stuck">Stuck?</button><button class="quiet" id="skip">Not today</button>
      </div>
      <div class="stuck" id="stuck-box" hidden></div>`;
    $("#resize").onclick = (e) => { const s = $("#sizes"); s.hidden = !s.hidden; e.currentTarget.setAttribute("aria-expanded", String(!s.hidden)); };
    $("#sizes").onclick = (e) => { const b = e.target.closest("[data-pts]"); if (b) { box.dataset.key = ""; act("/api/size", { id: h.id, points: +b.dataset.pts }); } };
    $("#start").onclick = (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = "Starting…"; act("/api/start", { id: h.id }); };
    $("#skip").onclick = () => act("/api/skip", { id: h.id });
  }
  $("#done").onclick = () => done(h.id);
  $("#stuck").onclick = () => stuck(h.id);
}

function tick() {
  const d = $("#digits");
  if (!d || !S || !S.hero || !S.hero.started_at) return;
  const sec = Math.max(0, Math.floor((Date.now() - new Date(S.hero.started_at)) / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = String(sec % 60).padStart(2, "0");
  d.textContent = h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
setInterval(tick, 1000);

function row(t, { tick: canTick = true } = {}) {
  const late = bucket(t) === "Overdue" && t.status !== "done";
  return `<div class="row ${t.id === highlight ? "hl" : ""}" data-id="${esc(t.id)}">
    ${t.status === "done" ? `<span class="tick-done" aria-label="done">✓</span>`
      : canTick ? `<button class="tick" data-act="done" aria-label="Mark ${esc(t.title)} done"></button>` : "<span></span>"}
    <div>${titleLink(t)}
      <div class="m"><span><span class="dot" style="background:${colors[t.cls] || "#888"}"></span>${esc(t.cls)}</span>
        <span class="${late ? "late" : ""}">${t.status === "done" ? "done " + shortDay(t.done || t.due) : dueWords(t)}</span>
        <span class="p">${pts(t.points)}</span>${t.status === "done" ? "" : `<span>${about(t.est)}</span>`}
        ${t.unsubmitted ? `<span class="warn">not submitted on Brightspace?</span>` : ""}</div></div>
    ${t.status === "done" ? "<span></span>" : `<button class="mini" data-act="start">Start</button>`}</div>`;
}

async function rowAction(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.closest(".row").dataset.id;
  if (b.dataset.act === "done") return done(id);
  b.disabled = true;
  try { const r = await api("/api/start", { id }); show("now"); render(r.state); }
  catch (err) { say(err.message, true); b.disabled = false; }
}

function renderNext() {
  const items = S.next.map((h) => S.all.find((t) => t.id === h.id)).filter(Boolean).slice(0, 4);
  $("#next").innerHTML = items.length ? items.map((t) => row(t)).join("")
    : `<p class="nothing">Nothing else is open. Type something below, or take the win.</p>`;
  $("#next").onclick = rowAction;
}

function renderProgress() {
  const p = S.progress, ids = S.identities.filter((g) => g.kind === "goal");
  const monday = addDays(S.today, -((day(S.today).getDay() + 6) % 7));
  const byDay = Object.fromEntries(p.days.map((d) => [d.date, d.total]));
  const dots = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    return `<span><i class="${byDay[d] > 0 ? "on" : ""} ${d === S.today ? "today" : ""}" title="${shortDay(d)}: ${byDay[d] || 0} pts"></i>${"MTWTFSS"[i]}</span>`;
  }).join("");
  const producer = p.today >= p.goal;
  $("#progress").innerHTML = `
    <div class="prog-today"><span class="big">${p.built.length}<small> done</small></span><span class="big pts-big">${p.today}<small> / ${p.goal} pts</small></span>
      ${producer ? `<span class="badge">Producer day</span>` : ""}</div>
    <div class="meter" aria-hidden="true">${Array.from({ length: p.goal }, (_, i) => `<i class="${i < p.today ? "on" : ""}"></i>`).join("")}</div>
    <p class="built">${p.built.length ? "Built: " + p.built.map(esc).join(" · ") : `Nothing finished yet. ${p.goal} points makes it a producer day.`}</p>
    <h3 class="sub-h">Who you're becoming</h3>
    <div class="levels">${ids.map((g) => `<button class="lv lv-btn" data-goal="${esc(g.name)}" title="${esc(g.rank)}: ${g.pts} pts, about ${g.hours} h of real work">
      <span class="lv-name">${esc(g.title)}</span><span class="lv-num">Lv ${g.level}</span>
      <span class="lv-bar"><i style="width:${Math.round((g.into / g.need) * 100)}%"></i></span><span class="lv-left">${g.need - g.into} to ${g.level + 1}</span></button>`).join("")}</div>
    <p class="week-share">This week: <b>${S.week_built.count}</b> built, <b>${S.week_built.pts}</b> pts, about <b>${S.week_built.hours}</b> h
      <button class="link-btn" id="share-week">Share this week</button></p>
    <div class="streak"><span>Not-zero streak: <b>${p.streak}</b> day${p.streak === 1 ? "" : "s"}</span><span class="dots" aria-label="Days with points this week">${dots}</span></div>`;
}
$("#how-points").onclick = () => pointsSheet();
$("#progress").onclick = (e) => {
  const lv = e.target.closest(".lv-btn");
  if (lv) return levelSheet(S.identities.find((g) => g.name === lv.dataset.goal));
  if (e.target.closest("#share-week")) weekSheet();
};

/* ---------- All tasks: calendar + what you have + the list ---------- */
const openTasks = () => S.all.filter((t) => t.status !== "done");
function renderAll() { renderCalendar(); renderLoad(); renderList(); }

function renderCalendar() {
  const monday = addDays(S.today, -((day(S.today).getDay() + 6) % 7));
  const start = addDays(monday, calShift * 28);
  const byDay = {};
  for (const t of S.all) if (t.due) (byDay[t.due] = byDay[t.due] || []).push(t);
  let html = "";
  for (let i = 0; i < 28; i++) {
    const d = addDays(start, i), items = (byDay[d] || []).sort((a, b) => (a.status === "done") - (b.status === "done") || b.points - a.points);
    const open = items.filter((t) => t.status !== "done"), load = open.reduce((s, t) => s + t.points, 0);
    const dd = day(d), label = dd.getDate() === 1 || i === 0 ? dd.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : dd.getDate();
    const cls = ["day", d < S.today ? "past" : "", d === S.today ? "today" : "", d === filter.day ? "picked" : ""].join(" ");
    html += `<button class="${cls}" data-day="${d}" aria-label="${shortDay(d)}: ${open.length} open, ${load} points">
      <span class="n">${label}${load ? `<small>${load} pts</small>` : ""}</span>
      ${items.slice(0, 3).map((t) => `<span class="chip ${t.status === "done" ? "done" : d < S.today ? "late" : ""}" data-id="${esc(t.id)}"
        style="background:${colors[t.cls] || "#888"}" title="${esc(t.title)} (${esc(t.cls)}, ${pts(t.points)})">${esc(t.title)}</span>`).join("")}
      ${items.length > 3 ? `<span class="more">+${items.length - 3} more</span>` : ""}</button>`;
  }
  $("#cal-grid").innerHTML = html;
  $("#cal-range").textContent = `${shortDay(start).replace(/^\w+, /, "")} – ${shortDay(addDays(start, 27)).replace(/^\w+, /, "")}`;
  $("#cal-grid").onclick = (e) => {
    const chip = e.target.closest(".chip"), cell = e.target.closest(".day");
    if (chip) { highlight = chip.dataset.id; filter.day = null; renderList(); return; }
    if (cell) { filter.day = filter.day === cell.dataset.day ? null : cell.dataset.day; renderAll(); }
  };
}
$("#cal-prev").onclick = () => { calShift -= 1; renderCalendar(); };
$("#cal-next").onclick = () => { calShift += 1; renderCalendar(); };
$("#cal-today").onclick = () => { calShift = 0; filter.day = null; renderAll(); };

function renderLoad() {
  const by = {};
  for (const t of openTasks()) {
    const b = (by[t.cls] = by[t.cls] || { late: 0, soon: 0, later: 0, undated: 0, n: 0 });
    const k = bucket(t);
    b[k === "Overdue" ? "late" : k === "No due date" ? "undated" : k === "Later" ? "later" : "soon"] += t.points;
    b.n += 1;
  }
  const total = (b) => b.late + b.soon + b.later + b.undated;
  const rows = Object.entries(by).sort((a, b) => total(b[1]) - total(a[1]));
  const max = Math.max(1, ...rows.map(([, b]) => total(b)));
  $("#load-bars").innerHTML = rows.length ? rows.map(([cls, b]) => `
    <button class="bar-row ${filter.cls === cls ? "on" : ""}" data-cls="${esc(cls)}" aria-pressed="${filter.cls === cls}">
      <span class="name">${esc(cls)}</span>
      <span class="track" title="${b.late} pts overdue, ${b.soon} pts due within 7 days, ${b.later} later, ${b.undated} undated">
        ${["late", "soon", "later", "undated"].map((k) => b[k] ? `<i class="${k}" style="width:${(b[k] / max) * 100}%;background:${colors[cls] || "#888"}"></i>` : "").join("")}</span>
      <span class="numr">${b.n} open · ${total(b)} pts</span></button>`).join("")
    : `<p class="nothing">Nothing open. Take the win.</p>`;
  $("#load-bars").onclick = (e) => {
    const r = e.target.closest(".bar-row");
    if (r) { filter.cls = filter.cls === r.dataset.cls ? null : r.dataset.cls; renderAll(); }
  };
}

function renderSync() {
  const b = S.brightspace || {}, el = $("#sync");
  const pending = b.requested && (!b.checked_at || b.checked_at < b.requested);
  let msg, bad = false;
  if (pending) msg = "Checking Brightspace for submissions…";
  else if (b.error === "not_connected") { msg = "Brightspace sync isn't connected: reload the Game Plan extension in Chrome, then press Connect."; bad = true; }
  else if (b.error === "login") { msg = "Log in to Brightspace in Chrome so Game Plan can see what you've submitted."; bad = true; }
  else if (b.checked_at) msg = `Brightspace checked ${ago(b.checked_at)}` + (b.updated && b.updated.length ? `. Marked done: ${b.updated.join(", ")}.` : ".");
  else { msg = "Brightspace sync hasn't run yet."; bad = true; }
  el.className = "sync" + (bad ? " bad" : "");
  el.innerHTML = `${esc(msg)} ${pending ? "" : `<button class="link-btn" id="bs-now">Check now</button>`}`;
  const btn = $("#bs-now");
  if (btn) btn.onclick = async () => {
    await act("/api/brightspace/check", {});
    let n = 0;
    const iv = setInterval(async () => {
      await refresh();
      const s = S.brightspace || {};
      if (++n > 24 || (s.checked_at && s.checked_at >= s.requested) || !s.requested) clearInterval(iv);
    }, 5000);
  };
}

function renderList() {
  renderSync();
  const w = S.week;
  $("#week-line").innerHTML = `Next 7 days: <b>${w.left}</b> left${w.late ? ` (<span class="late">${w.late} overdue</span>)` : ""}, about <b>${hm(w.need_min)}</b> of work and <b>${hm(w.free_min)}</b> free. <span class="verdict ${w.left && w.need_min > w.free_min ? "tight" : "ok"}">${esc(w.verdict)}</span>`;
  let items = openTasks();
  if (filter.cls) items = items.filter((t) => t.cls === filter.cls);
  if (filter.day) items = S.all.filter((t) => t.due === filter.day && (!filter.cls || t.cls === filter.cls));
  const order = ["Overdue", "Due today", "Next 7 days", "Later", "No due date", "Done"];
  const groups = {};
  for (const t of items.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || b.points - a.points)) {
    (groups[t.status === "done" ? "Done" : bucket(t)] = groups[t.status === "done" ? "Done" : bucket(t)] || []).push(t);
  }
  const open = items.filter((t) => t.status !== "done");
  $("#list-count").textContent = `${open.length} open · ${open.reduce((s, t) => s + t.points, 0)} pts`;
  $("#filters").innerHTML = [filter.cls && `<button class="filter" data-clear="cls" aria-label="Clear filter: ${esc(filter.cls)}">${esc(filter.cls)} ✕</button>`,
    filter.day && `<button class="filter" data-clear="day" aria-label="Clear filter: ${shortDay(filter.day)}">${shortDay(filter.day)} ✕</button>`].filter(Boolean).join("");
  $("#filters").onclick = (e) => { const b = e.target.closest("[data-clear]"); if (b) { filter[b.dataset.clear] = null; renderAll(); } };
  $("#list").innerHTML = order.filter((k) => groups[k]).map((k) =>
    `<h3 class="${k === "Overdue" ? "late" : ""}">${k} (${groups[k].length})</h3>${groups[k].map((t) => row(t)).join("")}`).join("")
    || `<p class="nothing">Nothing here. Clear the filter, or type a task below.</p>`;
  const hl = $(".row.hl", $("#list"));
  if (hl) hl.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  $("#list").onclick = rowAction;
}

/* ---------- actions ---------- */
async function done(id) {
  try { const r = await api("/api/done", { id }); burst(r.done, id); render(r.state); } catch (e) { say(e.message, true); }
}
async function undo(id) {
  try { render((await api("/api/undo", { id })).state); say("Undone. It's back on your list."); } catch (e) { say(e.message, true); }
}

async function stuck(id) {
  if (stuckLevel >= 2) return;
  const btn = $("#stuck"), box = $("#stuck-box");
  stuckLevel += 1;
  btn.disabled = true;
  btn.textContent = "Thinking…";
  box.hidden = false;
  try {
    const r = await api("/api/stuck", { id, level: stuckLevel });
    const label = ["A question first", "A hint", "A similar problem, worked out"][r.level];
    box.insertAdjacentHTML("beforeend", `<p class="lvl">${label}</p><p>${esc(r.text)}</p>`);
    box.scrollTop = box.scrollHeight;
  } catch (e) { stuckLevel -= 1; say(e.message, true); }
  btn.disabled = stuckLevel >= 2;
  btn.textContent = stuckLevel >= 2 ? "Your turn" : stuckLevel >= 0 ? "Still stuck" : "Stuck?";
}

/* the Done moment: one swish, then the points walk up to the goal */
function burst(d, id) {
  const b = $("#burst");
  const steps = [`<span class="pt" style="animation-delay:.85s">+${pts(d.points)}</span>`]
    .concat(d.chain.flatMap((c, i) => [`<span class="arrow" style="animation-delay:${(1.0 + i * 0.2).toFixed(2)}s">→</span>`,
                                       `<span style="animation-delay:${(1.05 + i * 0.2).toFixed(2)}s">${esc(c)}</span>`]));
  const g = d.est && d.actual ? `Estimated ${hm(d.est)}, took ${hm(d.actual)}.` : d.actual ? `Took ${hm(d.actual)}.` : "";
  const ups = (d.levels || []).filter((l) => l.up), goals = (d.levels || []).filter((l) => l.kind === "goal").slice(0, 2);
  b.innerHTML = `
    <svg class="hoop" viewBox="0 0 120 120" aria-hidden="true">
      <rect x="20" y="2" width="80" height="56" rx="3" fill="none" stroke="#C9BCAB" stroke-opacity=".5" stroke-width="2"/>
      <rect x="44" y="22" width="32" height="24" fill="none" stroke="#C9BCAB" stroke-opacity=".5" stroke-width="2"/>
      <g class="net"><path d="M34 62 L42 100 M46 62 L50 100 M60 62 L60 100 M74 62 L70 100 M86 62 L78 100 M38 80 L82 80 M42 96 L78 96" stroke="#F2EADF" stroke-opacity=".7" stroke-width="1.5" fill="none"/></g>
      <ellipse cx="60" cy="62" rx="27" ry="5" fill="none" stroke="#EF7A2E" stroke-width="3.5"/>
    </svg>
    <div class="ball" aria-hidden="true"><svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="21" fill="#EF7A2E"/>
      <path d="M2 23 H44 M23 2 V44 M8 8 C17 16 17 30 8 38 M38 8 C29 16 29 30 38 38" stroke="#5A2A0C" stroke-width="1.6" fill="none"/></svg></div>
    <div class="score" role="status">
      <div class="walk">${steps.join("")}</div>
      <div class="burst-levels">${goals.map((l) => `<div class="lv"><span class="lv-name">${esc(l.title)}</span><span class="lv-num">Lv ${l.level}</span>
        <span class="lv-bar"><i style="width:${Math.round((l.into / l.need) * 100)}%"></i></span><span class="lv-left">${l.need - l.into} to ${l.level + 1}</span></div>`).join("")}</div>
      ${ups.length ? `<div class="reward-line">Level up: ${ups.map((l) => `${esc(l.title)} is now ${/^[AEIOU]/.test(l.rank) ? "an" : "a"} ${esc(l.rank)} (level ${l.level})`).join(" · ")}</div>` : ""}
      ${d.producer_day ? `<div class="reward-line">Producer day. ${d.built_today} things built, the day's work is done. Everything after this is a bonus.</div>` : ""}
      ${g ? `<div class="guess-line">${g}</div>` : ""}
      ${id ? `<button class="quiet undo" id="undo">Undo, I didn't finish this</button>` : ""}
    </div>`;
  b.hidden = false;
  if (!reduced) {
    const box = b.getBoundingClientRect(), hoop = $(".hoop", b).getBoundingClientRect();
    const end = { x: hoop.left - box.left + hoop.width / 2 - 23, y: hoop.top - box.top + hoop.height * 0.46 - 23 };
    const start = { x: box.width * 0.1, y: box.height * 0.82 }, ctrl = { x: (start.x + end.x) / 2, y: -box.height * 0.3 };
    const frames = Array.from({ length: 16 }, (_, i) => {
      const t = i / 15, u = 1 - t;
      const x = u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x, y = u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y;
      return { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${Math.round(t * 420)}deg)`, opacity: t < 0.98 ? 1 : 0 };
    });
    $(".ball", b).animate(frames, { duration: 760, easing: "cubic-bezier(.3,.1,.55,1)", fill: "forwards" });
    $(".net", b).animate([{ transform: "scaleY(1)" }, { transform: "scaleY(1.3)" }, { transform: "scaleY(1)" }], { duration: 380, delay: 720 });
  }
  const close = () => { b.hidden = true; b.innerHTML = ""; };
  b.onclick = (e) => { if (e.target.id === "undo") { close(); undo(id); } else close(); };
  setTimeout(close, (d.levels || []).some((l) => l.up) || d.producer_day ? 7500 : 5600);
}

/* ---------- type box ---------- */
let sayTimer = null;
function say(msg, err) {
  const el = $("#type-status");
  el.textContent = msg;
  el.className = "type-status" + (err ? " err" : "");
  clearTimeout(sayTimer);
  if (msg) sayTimer = setTimeout(() => (el.textContent = ""), err ? 9000 : 6000);
}

$("#typebox").onsubmit = async (e) => {
  e.preventDefault();
  const input = $("#type-in"), text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  say("Filing…");
  try {
    const r = await api("/api/type", { text });
    input.value = "";
    if (r.kind === "task") {
      const t = r.task;
      say(`Filed under ${t.cls}: ${t.title}, ${pts(t.points)}${t.due ? ", due " + shortDay(t.due) : ""}.`);
    } else if (r.kind === "done") { say(""); burst(r.done, r.done.id); }
    else { say("Idea saved to your vault."); spitball(r.idea); }
    render(r.state);
  } catch (err) { say(err.message, true); }
  finally { input.disabled = false; if ($("#sheet-wrap").hidden) input.focus(); }
};

/* ---------- sheets ---------- */
function sheet(html, onOpen) {
  const wrap = $("#sheet-wrap"), el = $("#sheet");
  el.innerHTML = html;
  wrap.hidden = false;
  const close = () => { wrap.hidden = true; el.innerHTML = ""; $("#type-in").focus(); };
  wrap.onclick = (e) => { if (e.target === wrap || e.target.closest("[data-close]")) close(); };
  document.onkeydown = (e) => { if (e.key === "Escape" && !wrap.hidden) close(); };
  if (onOpen) onOpen(el, close);
  const first = $("textarea, input, button", el);
  if (first) first.focus();
}

function choices(el) {
  el.querySelectorAll(".choice").forEach((c) => (c.onclick = () => {
    el.querySelectorAll(".choice").forEach((o) => o.setAttribute("aria-pressed", String(o === c)));
  }));
  return () => (el.querySelector('.choice[aria-pressed="true"]') || {}).dataset?.v;
}

function ladder(g) {
  const thr = (l) => 20 * (l - 1) + 5 * (l - 1) * (l - 2);          // points to reach level l: 0, 20, 50, 90, 140…
  const v = S.identities.find((x) => x.kind === "vision"), mpp = v && v.pts ? (v.hours * 60) / v.pts : 15;   // your minutes per point
  const rows = [];
  for (let l = 1; l <= Math.max(10, (g ? g.level : 0) + 2); l++) {
    const here = g && g.level === l, past = g && g.level > l;
    rows.push(`<tr class="${here ? "here" : past ? "past" : ""}"><td>${l}</td><td>${esc(RANKS[Math.min(l, RANKS.length) - 1])}</td>
      <td class="num">${thr(l)} pts</td><td class="num">~${Math.round((thr(l) * mpp) / 60)} h</td><td>${here ? "you are here" : past ? "✓" : ""}</td></tr>`);
  }
  return `<table class="ladder"><thead><tr><th>Level</th><th>Rank</th><th>Reached at</th><th>About this much real work</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}
const RANKS = ["Walk-on", "Bench", "Rotation", "Starter", "Captain", "All-Star", "MVP", "Champion", "Hall of Famer", "Legend"];

function pointsSheet() {
  const goals = S.identities.filter((g) => g.kind === "goal");
  sheet(`<h2 id="sheet-h">How points and levels work</h2>
    <p class="sub">Points are proof. Every finished task is evidence for the person you're becoming. Levels are that proof, added up.</p>
    <h3 class="sheet-h3">1. Points follow the time a task really takes</h3>
    <table class="sizes"><tbody>
      <tr><td>1</td><td>under 15 min</td><td>forms, surveys, a quick email</td></tr>
      <tr><td>2</td><td>15 to 30 min</td><td>a quiz, a discussion post, a journal</td></tr>
      <tr><td>3</td><td>30 to 60 min</td><td>a short assignment</td></tr>
      <tr><td>5</td><td>1 to 2 hours</td><td>a problem set</td></tr>
      <tr><td>8</td><td>2 to 4 hours</td><td>a paper, a presentation</td></tr>
      <tr><td>13</td><td>4 hours or more</td><td>a project milestone</td></tr></tbody></table>
    <p class="sub">Claude sizes every task from how long similar ones actually took you. Wrong size? Click the points on the main screen.</p>
    <h3 class="sheet-h3">2. Your goals level up</h3>
    <p class="sub">Each goal is someone you're becoming: ${goals.map((g) => esc(g.title)).join(", ")}. A finished task's points go to its class, then up to every goal above it.
      Level 2 takes 20 points, then each level takes 10 more than the last. Levels never go down: a level is hours of real work you've already put in.</p>
    ${ladder(null)}
    <h3 class="sheet-h3">3. A producer day</h3>
    <p class="sub">${S.progress.goal} points in a day means the day's work is done. Everything after that is a bonus, with no guilt and no argument in your head. Any day with at least 1 point keeps your not-zero streak.</p>
    <h3 class="sheet-h3">4. Rewards that build you</h3>
    <p class="sub">When a goal levels up, spend the win on something that makes you more, not less: a build session on your own project, pickup basketball, a real meal with a friend, a new book, a gym PR attempt. Or send someone this week's build list.</p>
    <p class="sub">Open Game Plan from anywhere: <b>⌥⌘G</b>.</p>
    <div class="row-btns"><button class="go" data-close>Got it</button></div>`);
}

function levelSheet(g) {
  if (!g) return;
  const since = g.since ? shortDay(g.since) : null;
  sheet(`<h2 id="sheet-h">${esc(g.title)}</h2>
    <p class="sub">${esc(g.rank)} · level ${g.level}${g.feeds.length ? ` · fed by ${g.feeds.map(esc).join(", ")}` : ""}</p>
    <div class="numbers">
      <div><b>${g.pts}</b><span>points of proof</span></div>
      <div><b>~${g.hours} h</b><span>of real work${since ? " since " + since : ""}</span></div>
      <div><b>${g.need - g.into}</b><span>points to ${esc(g.next_rank)}</span></div></div>
    <div class="lv-bar big-bar"><i style="width:${Math.round((g.into / g.need) * 100)}%"></i></div>
    <p class="sub">${g.into} of ${g.need} points into level ${g.level}. That's about ${Math.max(1, Math.ceil((g.need - g.into) / 5))} more homework-sized tasks.</p>
    ${g.recent.length ? `<h3 class="sheet-h3">Latest proof</h3><ul class="proof">${g.recent.map((r) => `<li><b>${esc(r.title)}</b> · ${esc(r.cls)} · +${r.points} · ${shortDay(r.date)}</li>`).join("")}</ul>`
      : `<p class="sub">No proof yet. Finish one task for ${esc(g.title)} to start the climb.</p>`}
    <h3 class="sheet-h3">The ladder</h3>${ladder(g)}
    <div class="row-btns"><button class="go" data-close>Back to work</button></div>`);
}

function weekText() {
  const w = S.week_built, byCls = {};
  for (const grp of w.groups) for (const it of grp.items) (byCls[it.cls] = byCls[it.cls] || []).push(it);
  const classes = Object.entries(byCls).sort((a, b) => b[1].reduce((s, x) => s + x.points, 0) - a[1].reduce((s, x) => s + x.points, 0));
  const ups = w.levels.filter((l) => l.to > l.from);
  return [`This week I built (${shortDay(w.from)} to ${shortDay(w.to)}): ${w.count} things, about ${w.hours} hours of focused work.`, "",
    ...classes.map(([cls, items]) => `${cls}: ${items.map((x) => x.title).join(", ")}`),
    ...(ups.length ? ["", "Leveled up: " + ups.map((l) => `${l.title} ${l.from} → ${l.to}`).join(", ")] : [])].join("\n");
}

function weekSheet() {
  const text = weekText();
  sheet(`<h2 id="sheet-h">This week's build list</h2>
    <p class="sub">Send it to someone who should see you building: a mentor, your supervisor, a friend who's grinding too. Showing your work is the reward.</p>
    <pre class="week-text" id="week-text">${esc(text)}</pre>
    <div class="row-btns"><button class="go" id="copy-week">Copy</button><button type="button" class="quiet" data-close>Close</button></div>`,
  (el) => {
    $("#copy-week", el).onclick = async (e) => {
      try { await navigator.clipboard.writeText(text); e.currentTarget.textContent = "Copied"; }
      catch { const r = document.createRange(); r.selectNodeContents($("#week-text", el)); getSelection().removeAllRanges(); getSelection().addRange(r); say("Selected. Press ⌘C to copy."); }
    };
  });
}

function setupSheet() {
  const b = S.brightspace || {};
  sheet(`<h2 id="sheet-h">${b.error === "login" ? "Log in to Brightspace" : "Finish setup: Brightspace sync"}</h2>
    <p class="sub">${b.error === "login"
      ? "The extension is connected, but Chrome isn't logged in to Brightspace. Log in there once; the next check clears everything you've already submitted."
      : "Once the Chrome extension is in, anything you've submitted on Brightspace drops off your list by itself, and the blocker and night lock turn on."}</p>
    ${b.error === "login" ? "" : `<ul>
      <li><b>1.</b> Press the button below. It opens Chrome's extensions page and the extension's folder.</li>
      <li><b>2.</b> Turn on <b>Developer mode</b> (top right), then drag the <b>extension</b> folder onto the page.</li>
      <li><b>3.</b> A "Connect Brightspace" tab opens. Press <b>Connect</b>, then <b>Allow</b>.</li></ul>`}
    <div class="row-btns">${b.error === "login" ? "" : `<button class="go" id="open-ext">Open the extensions page</button>`}
      <button type="button" class="quiet" data-close>Later</button></div>`,
  (el) => {
    const btn = $("#open-ext", el);
    if (btn) btn.onclick = async () => {
      try { await api("/api/setup/extension", {}); btn.textContent = "Opened in Chrome"; } catch (e) { say(e.message, true); }
    };
  });
}
$("#setup").onclick = setupSheet;

function spitball(idea) {
  sheet(`<h2 id="sheet-h">${esc(idea.title)}</h2>
    <p class="sub">Spitball: Claude asks, you think. Everything lands in the idea note${idea.cls !== "Unsorted" ? ", linked to " + esc(idea.cls) : ""}.</p>
    <div class="thread" id="thread">${idea.questions.map((q) => `<p>${esc(q)}</p>`).join("")}</div>
    <form id="sp"><label>Your answer<textarea id="sp-in" maxlength="1000" required></textarea></label>
      <div class="row-btns"><button class="go" id="sp-go">Send</button><button type="button" class="quiet" data-close>Done for now</button></div></form>`,
  (el) => {
    $("#sp", el).onsubmit = async (e) => {
      e.preventDefault();
      const input = $("#sp-in", el), reply = input.value.trim(), go = $("#sp-go", el);
      if (!reply) return;
      go.disabled = true;
      go.textContent = "Thinking…";
      $("#thread", el).insertAdjacentHTML("beforeend", `<p class="me">${esc(reply)}</p>`);
      input.value = "";
      try {
        const r = await api("/api/spitball", { id: idea.id, reply });
        $("#thread", el).insertAdjacentHTML("beforeend", r.questions.map((q) => `<p>${esc(q)}</p>`).join(""));
      } catch (err) { $("#thread", el).insertAdjacentHTML("beforeend", `<p>${esc(err.message)}</p>`); }
      go.disabled = false;
      go.textContent = "Send";
      input.focus();
    };
  });
}

function checkin() {
  sheet(`<h2 id="sheet-h">Night check-in</h2><p class="sub">Under a minute. Saved to today's daily note.</p>
    <form id="ci">
      <label>What did you get done that mattered?<textarea id="ci-got" maxlength="400"></textarea></label>
      <label>What got in the way?<textarea id="ci-way" maxlength="400"></textarea></label>
      <div class="row-btns" style="margin-top:20px"><button class="go">Save</button><button type="button" class="quiet" data-close>Later</button></div>
    </form>`,
  (el, close) => {
    $("#ci", el).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api("/api/checkin", { got_done: $("#ci-got", el).value, in_the_way: $("#ci-way", el).value });
        close();
        render(r.state);
        say("Saved to today's note. Wind down.");
      } catch (err) { say(err.message, true); }
    };
  });
}

$("#open-checkin").onclick = checkin;
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 30000);
if (location.hash === "#all") show("all");
refresh();
