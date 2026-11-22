/* Game Plan v3 page. Talks only to the local server; the vault is the database. */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PALETTE = ["#E0B36E", "#86B98A", "#7FB2D9", "#D98FA0", "#A99AD9", "#CDBB94", "#6CC0B3", "#D9876C", "#B5C97A", "#9FB8C9"];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let S = null;            // last state from the server
let colors = {};         // class -> color, stable while the set of classes is
let stuckLevel = -1;
let view = "now";                 // always open on the one thing; "all" is one click away
let filter = { cls: null, day: null };
let calShift = 0;                 // calendar offset in 4-week steps
let highlight = null;             // task id to flash in the list

async function api(path, body) {
  const opts = body === undefined ? { cache: "no-store" }
    : { method: "POST", headers: { "Content-Type": "application/json", "X-Game-Plan": "1" }, body: JSON.stringify(body) };
  let r;
  try { r = await fetch(path, opts); } catch { throw new Error("Game Plan's server isn't answering. It restarts on its own in a few seconds."); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "That didn't work. Try again.");
  return data;
}

async function refresh() {
  try { render(await api("/api/state")); } catch (e) { say(e.message, true); }
}

/* ---------- dates ---------- */
const day = (iso) => new Date(iso + "T12:00:00");
const daysBetween = (a, b) => Math.round((day(b) - day(a)) / 864e5);
const shortDay = (iso) => day(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
function dueLabel(due) {
  if (!due) return ["No due date", ""];
  const d = daysBetween(S.today, due);
  if (d === 0) return ["Due tonight", ""];
  if (d === 1) return ["Due tomorrow", ""];
  if (d > 1) return ["Due " + shortDay(due), ""];
  return [`${-d} day${d === -1 ? "" : "s"} late`, "late"];
}
const pts = (n) => `${n} pt${n === 1 ? "" : "s"}`;
const firstSentence = (s) => (String(s || "").match(/^[^.!?]*[.!?]?["”']?/) || [""])[0].trim();

/* ---------- render ---------- */
function render(state) {
  S = state;
  const names = [...new Set([...S.week.groups.map((g) => g.cls), ...S.progress.days.flatMap((d) => Object.keys(d.by))])].sort();
  if (names.join("|") !== Object.keys(colors).join("|")) colors = Object.fromEntries(names.map((n, i) => [n, PALETTE[i % PALETTE.length]]));
  renderBar();
  renderHero();
  renderWeek();
  renderProgress();
  if (view === "all") renderAll();
}

/* ---------- views ---------- */
function show(v) {
  view = v;
  $(".court").hidden = v !== "now";
  $("#board").hidden = v !== "all";
  $("#tab-now").setAttribute("aria-pressed", String(v === "now"));
  $("#tab-all").setAttribute("aria-pressed", String(v === "all"));
  if (v === "all" && S) renderAll();
}
$("#tab-now").onclick = () => show("now");
$("#tab-all").onclick = () => show("all");

/* ---------- all tasks: calendar + what you have + the list ---------- */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (isoDay, n) => { const d = day(isoDay); d.setDate(d.getDate() + n); return iso(d); };
const openTasks = () => S.all.filter((t) => t.status !== "done");
function bucket(t) {
  if (!t.due) return "No due date";
  const d = daysBetween(S.today, t.due);
  return d < 0 ? "Overdue" : d === 0 ? "Due today" : d <= 7 ? "Next 7 days" : "Later";
}
function dueWords(t) {
  if (!t.due) return "no due date";
  const d = daysBetween(S.today, t.due);
  return d < 0 ? `${-d} day${d === -1 ? "" : "s"} late` : d === 0 ? "due today" : d === 1 ? "due tomorrow" : "due " + shortDay(t.due);
}

function renderAll() {
  renderCalendar();
  renderLoad();
  renderList();
}

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

function renderLoad() {
  const by = {};
  for (const t of openTasks()) {
    const b = (by[t.cls] = by[t.cls] || { late: 0, soon: 0, later: 0, undated: 0, n: 0 });
    const k = bucket(t);
    b[k === "Overdue" ? "late" : k === "No due date" ? "undated" : k === "Later" ? "later" : "soon"] += t.points;
    b.n += 1;
  }
  const rows = Object.entries(by).sort((a, b) => total(b[1]) - total(a[1]));
  function total(b) { return b.late + b.soon + b.later + b.undated; }
  const max = Math.max(1, ...rows.map(([, b]) => total(b)));
  $("#load-bars").innerHTML = rows.length ? rows.map(([cls, b]) => `
    <button class="bar-row ${filter.cls === cls ? "on" : ""}" data-cls="${esc(cls)}" aria-pressed="${filter.cls === cls}">
      <span class="name">${esc(cls)}</span>
      <span class="track" title="${b.late} pts overdue, ${b.soon} pts due in 7 days, ${b.later} later, ${b.undated} undated">
        ${["late", "soon", "later", "undated"].map((k) => b[k] ? `<i class="${k}" style="width:${(b[k] / max) * 100}%;background:${colors[cls] || "#888"}"></i>` : "").join("")}</span>
      <span class="num">${b.n} open · ${b.late + b.soon + b.later + b.undated} pts</span></button>`).join("")
    : `<p class="nothing">Nothing open. Take the win.</p>`;
  $("#load-bars").onclick = (e) => {
    const r = e.target.closest(".bar-row");
    if (r) { filter.cls = filter.cls === r.dataset.cls ? null : r.dataset.cls; renderAll(); }
  };
}

function renderList() {
  let items = openTasks();
  if (filter.cls) items = items.filter((t) => t.cls === filter.cls);
  if (filter.day) items = S.all.filter((t) => t.due === filter.day && (!filter.cls || t.cls === filter.cls));
  const order = ["Overdue", "Due today", "Next 7 days", "Later", "No due date"];
  const groups = {};
  for (const t of items.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || b.points - a.points)) {
    const k = t.status === "done" ? "Done" : bucket(t);
    (groups[k] = groups[k] || []).push(t);
  }
  const open = items.filter((t) => t.status !== "done");
  $("#list-count").textContent = `${open.length} open · ${open.reduce((s, t) => s + t.points, 0)} pts`;
  $("#filters").innerHTML = [filter.cls && `<button class="filter" data-clear="cls">${esc(filter.cls)} ✕</button>`,
    filter.day && `<button class="filter" data-clear="day">${shortDay(filter.day)} ✕</button>`].filter(Boolean).join("");
  $("#filters").onclick = (e) => { const b = e.target.closest("[data-clear]"); if (b) { filter[b.dataset.clear] = null; renderAll(); } };
  $("#list").innerHTML = [...order, "Done"].filter((k) => groups[k]).map((k) => `
    <h3 class="${k === "Overdue" ? "late" : ""}">${k} (${groups[k].length})</h3>
    ${groups[k].map((t) => `<div class="row ${t.id === highlight ? "hl" : ""}" data-id="${esc(t.id)}">
      ${t.status === "done" ? `<span aria-hidden="true" style="color:var(--sage);text-align:center">✓</span>` : `<button class="tick" data-act="done" aria-label="Mark ${esc(t.title)} done"></button>`}
      <div><a class="t" href="${esc(t.note)}" title="Open the note in Obsidian">${esc(t.title)}</a>
        <div class="m"><span><span class="dot" style="background:${colors[t.cls] || "#888"}"></span>${esc(t.cls)}</span>
          <span class="${bucket(t) === "Overdue" && t.status !== "done" ? "late" : ""}">${t.status === "done" ? "done " + shortDay(t.done || t.due) : dueWords(t)}</span>
          <span class="p">${pts(t.points)}</span></div></div>
      <div class="acts">${t.url ? `<a class="mini sub" href="${esc(t.url)}" target="_blank" rel="noopener">Submit</a>` : ""}
        ${t.status === "done" ? "" : `<button class="mini" data-act="pick">Do now</button>`}</div></div>`).join("")}`).join("")
    || `<p class="nothing">Nothing here. Clear the filter, or type a task below.</p>`;
  const hl = $(".row.hl", $("#list"));
  if (hl) hl.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  $("#list").onclick = async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.closest(".row").dataset.id;
    if (b.dataset.act === "done") return done(id);
    try { const r = await api("/api/pick", { id }); show("now"); render(r.state); const s = $("#step"); if (s) s.focus(); }
    catch (err) { say(err.message, true); }
  };
}
$("#cal-prev").onclick = () => { calShift -= 1; renderCalendar(); };
$("#cal-next").onclick = () => { calShift += 1; renderCalendar(); };
$("#cal-today").onclick = () => { calShift = 0; filter.day = null; renderAll(); };

function renderBar() {
  const ex = S.experiment;
  $("#experiment").innerHTML = ex.title ? `This week's experiment: <b>${esc(ex.title)}.</b> ${esc(firstSentence(ex.text))}` : "";
  $("#open-checkin").hidden = !S.checkin_due;
  $("#open-review").hidden = !S.review_due;
  $("#map").href = S.map;
}

function renderHero() {
  const h = S.hero, box = $("#hero-body");
  if (!h) {
    box.dataset.key = "";
    box.innerHTML = `<div class="empty"><p class="kicker">Do this now</p><h1>Nothing's due.</h1>
      <p class="why">Type something into the box below, or take the win and go hoop.</p></div>`;
    return;
  }
  const running = !!h.started_at;
  const key = h.id + (running ? ":run" : "");
  if (box.dataset.key === key) {           // same task: keep what you're typing, refresh the words
    const why = $(".why", box);
    if (why) why.textContent = h.why;
    return;
  }
  box.dataset.key = key;
  stuckLevel = -1;
  const size = h.title.length > 60 ? "title longer" : h.title.length > 28 ? "title long" : "title";
  const [due, dueCls] = dueLabel(h.due);
  const submit = h.url ? `<a class="btn" href="${esc(h.url)}" target="_blank" rel="noopener">Submit</a>` : "";
  const top = `<p class="chain">${h.chain.map(esc).join(" → ")}</p><h1 class="${size}">${esc(h.title)}</h1>`;
  if (running) {
    box.innerHTML = `<p class="kicker">On the clock</p>${top}
      <div class="clock"><span class="digits" id="digits">0:00</span><span class="of">you guessed ${h.minutes} min</span></div>
      <p class="step">First step: <b>${esc(h.step)}</b></p>
      <div class="grow"></div>
      <div class="actions">
        <button class="go" id="done">Done</button>${submit}<button class="btn" id="stuck">Stuck</button>
        <span class="spacer"></span>
        <span class="blocker ${S.blocker ? "" : "off"}">${S.blocker ? "Blocker on" : "Blocker not connected"}</span>
        <button class="quiet" id="stop">Stop timer</button>
      </div>
      <div class="stuck" id="stuck-box" hidden></div>`;
    tick();
  } else {
    box.innerHTML = `<p class="kicker">Do this now</p>${top}
      <p class="why">${esc(h.why)}</p>
      <div class="facts"><span class="pts">${pts(h.points)}</span><span class="${dueCls}">${due}</span></div>
      <div class="grow"></div>
      <form class="plan" id="plan">
        <label>What's your first step?<input id="step" maxlength="140" placeholder="The first physical thing you'll do" required></label>
        <label>How many minutes?<input id="mins" type="number" min="1" max="600" inputmode="numeric" placeholder="25" required></label>
        <button class="go" id="start" disabled>Start</button>
      </form>
      <div class="actions">
        <button class="btn" id="stuck">Stuck</button>${submit}<button class="btn done" id="done">Done</button>
        <span class="spacer"></span><button class="quiet" id="skip">Not this one today</button>
      </div>
      <div class="stuck" id="stuck-box" hidden></div>`;
    const ok = () => { $("#start").disabled = !($("#step").value.trim() && +$("#mins").value > 0); };
    $("#step").oninput = ok;
    $("#mins").oninput = ok;
    $("#plan").onsubmit = (e) => {
      e.preventDefault();
      act("/api/start", { id: h.id, step: $("#step").value.trim(), minutes: +$("#mins").value });
    };
    $("#skip").onclick = () => act("/api/skip", { id: h.id });
  }
  $("#done").onclick = () => done(h.id);
  $("#stuck").onclick = () => stuck(h.id);
  if (running) $("#stop").onclick = () => act("/api/stop", {});
}

function tick() {
  const d = $("#digits");
  if (!d || !S.hero || !S.hero.started_at) return;
  const sec = Math.max(0, Math.floor((Date.now() - new Date(S.hero.started_at)) / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = String(sec % 60).padStart(2, "0");
  d.textContent = h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
setInterval(tick, 1000);

function renderWeek() {
  const w = S.week;
  $("#week-count").textContent = w.total ? `${w.done} of ${w.total} done this week` : "";
  $("#week-groups").innerHTML = w.groups.length ? w.groups.map((g) => `
    <div class="group"><h3>${esc(g.cls)}</h3><ul class="blocks">${g.items.map((it) => `
      <li class="${it.done ? "done" : ""}" style="background:${colors[g.cls]};width:${Math.max(20, it.points * 14)}px"
          title="${esc(it.title)}: ${it.points} pts, ${it.done ? "done" : "due " + it.due}">
        <span class="sr">${esc(it.title)}, ${it.points} points, ${it.done ? "done" : "due " + it.due}</span>
        ${!it.done && it.points >= 3 ? `<span aria-hidden="true">${it.due}</span>` : ""}</li>`).join("")}</ul></div>`).join("")
    : `<p class="nothing">Nothing due in the next 7 days.</p>`;
}

function renderProgress() {
  const p = S.progress;
  $("#streak").textContent = `Not-zero streak: ${p.streak} day${p.streak === 1 ? "" : "s"}`;
  const cells = Array.from({ length: p.goal }, (_, i) => `<i class="${i < p.today ? "on" : ""}"></i>`).join("");
  $("#today").innerHTML = `<div class="meter" aria-hidden="true">${cells}</div>` + (p.today >= p.goal
    ? `<p class="earned">${p.today} points today. ${esc(firstSentence(p.reward).replace(/\.$/, ""))} is earned.</p>`
    : `<p><b>${p.today}</b> of ${p.goal} points today</p>`);
  // 14 days, stacked by class, with the day goal as a faint line
  const W = 386, H = 132, base = 112, top = 10, bw = W / p.days.length;
  const max = Math.max(p.goal, ...p.days.map((d) => d.total));
  const y = (v) => base - (v / max) * (base - top);
  let bars = "";
  p.days.forEach((d, i) => {
    let acc = 0;
    const x = i * bw + bw * 0.18, w = bw * 0.64;
    for (const [cls, pts] of Object.entries(d.by).sort()) {
      bars += `<rect x="${x.toFixed(1)}" y="${y(acc + pts).toFixed(1)}" width="${w.toFixed(1)}" height="${(y(acc) - y(acc + pts)).toFixed(1)}" rx="2" fill="${colors[cls] || "#888"}"><title>${esc(cls)}: ${pts} pts</title></rect>`;
      acc += pts;
    }
    const isToday = i === p.days.length - 1;
    if (!d.total) bars += `<text x="${(x + w / 2).toFixed(1)}" y="${base - 4}" text-anchor="middle" class="zero">0</text>`;
    bars += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="${isToday ? "today-l" : ""}">${d.label}</text>`;
  });
  const gy = y(p.goal).toFixed(1);
  $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Points per day for the last 14 days">
    <line x1="0" x2="${W}" y1="${gy}" y2="${gy}" stroke="#E0B36E" stroke-opacity=".35" stroke-dasharray="3 4"/>
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="#3B2F25"/>${bars}</svg>`;
  const used = [...new Set(p.days.flatMap((d) => Object.keys(d.by)))].sort();
  $("#legend").innerHTML = used.map((c) => `<span style="--c:${colors[c]}">${esc(c)}</span>`).join("");
}

/* ---------- actions ---------- */
async function act(path, body) {
  try { render((await api(path, body)).state); } catch (e) { say(e.message, true); }
}

async function done(id) {
  try {
    const r = await api("/api/done", { id });
    burst(r.done);
    render(r.state);
  } catch (e) { say(e.message, true); }
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
  } catch (e) {
    stuckLevel -= 1;
    say(e.message, true);
  }
  btn.disabled = stuckLevel >= 2;
  btn.textContent = stuckLevel >= 2 ? "Your turn" : stuckLevel >= 0 ? "Still stuck" : "Stuck";
}

/* the Done moment: one swish, then the chain walks up to the goal */
function burst(d) {
  const b = $("#burst");
  const steps = [`<span class="pt" style="animation-delay:.85s">+${pts(d.points)}</span>`]
    .concat(d.chain.flatMap((c, i) => [`<span class="arrow" style="animation-delay:${(1.0 + i * 0.2).toFixed(2)}s">→</span>`,
                                       `<span style="animation-delay:${(1.05 + i * 0.2).toFixed(2)}s">${esc(c)}</span>`]));
  const guess = d.est && d.actual ? `You guessed ${d.est} min, took ${d.actual}.` : d.actual ? `Took ${d.actual} min.` : "";
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
      ${guess ? `<div class="guess">${guess}</div>` : ""}
      ${d.reward_hit ? `<div class="reward">${d.today} points today. ${esc(firstSentence(d.reward).replace(/\.$/, ""))} is earned.</div>` : ""}
    </div>`;
  b.hidden = false;
  if (!reduced) {
    const box = b.getBoundingClientRect(), hoop = $(".hoop", b).getBoundingClientRect();
    const end = { x: hoop.left - box.left + hoop.width / 2 - 23, y: hoop.top - box.top + hoop.height * 0.46 - 23 };
    const start = { x: box.width * 0.1, y: box.height * 0.82 }, ctrl = { x: (start.x + end.x) / 2, y: -box.height * 0.3 };
    const frames = Array.from({ length: 16 }, (_, i) => {
      const t = i / 15, u = 1 - t;
      const x = u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x, yy = u * u * start.y + 2 * u * t * ctrl.y + t * t * end.y;
      return { transform: `translate(${x.toFixed(1)}px, ${yy.toFixed(1)}px) rotate(${Math.round(t * 420)}deg)`, opacity: t < 0.98 ? 1 : 0 };
    });
    $(".ball", b).animate(frames, { duration: 760, easing: "cubic-bezier(.3,.1,.55,1)", fill: "forwards" });
    $(".net", b).animate([{ transform: "scaleY(1)" }, { transform: "scaleY(1.3)" }, { transform: "scaleY(1)" }], { duration: 380, delay: 720 });
  }
  const close = () => { b.hidden = true; b.innerHTML = ""; };
  b.onclick = close;
  setTimeout(close, d.reward_hit ? 7000 : 5200);
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
    } else if (r.kind === "done") {
      say("");
      burst(r.done);
    } else {
      say("Idea saved to your vault.");
      spitball(r.idea);
    }
    render(r.state);
  } catch (err) {
    say(err.message, true);
  } finally {
    input.disabled = false;
    if ($("#sheet-wrap").hidden) input.focus();
  }
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

function spitball(idea) {
  sheet(`<h2 id="sheet-h">${esc(idea.title)}</h2>
    <p class="sub">Spitball: Claude asks, you think. Everything lands in the idea note${idea.cls !== "Unsorted" ? ", linked to " + esc(idea.cls) : ""}.</p>
    <div class="thread" id="thread">${idea.questions.map((q) => `<p>${esc(q)}</p>`).join("")}</div>
    <form id="sp"><label>Your answer<textarea id="sp-in" maxlength="1000" required></textarea></label>
      <div class="row"><button class="go" id="sp-go">Send</button><button type="button" class="quiet" data-close>Done for now</button></div></form>`,
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
      } catch (err) {
        $("#thread", el).insertAdjacentHTML("beforeend", `<p>${esc(err.message)}</p>`);
      }
      go.disabled = false;
      go.textContent = "Send";
      input.focus();
    };
  });
}

function checkin() {
  const ex = S.experiment;
  sheet(`<h2 id="sheet-h">Night check-in</h2><p class="sub">Under a minute. Saved to today's daily note.</p>
    <form id="ci">
      <label>What did you get done that mattered?<textarea id="ci-got" maxlength="400"></textarea></label>
      <label>What got in the way?<textarea id="ci-way" maxlength="400"></textarea></label>
      <p class="sub">Did you run this week's experiment (${esc(ex.title)})?</p>
      <div class="row"><button type="button" class="choice" data-v="yes" aria-pressed="false">Yes</button>
        <button type="button" class="choice" data-v="no" aria-pressed="false">No</button></div>
      <div class="row" style="margin-top:20px"><button class="go">Save</button><button type="button" class="quiet" data-close>Later</button></div>
    </form>`,
  (el, close) => {
    const pick = choices(el);
    $("#ci", el).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api("/api/checkin", { got_done: $("#ci-got", el).value, in_the_way: $("#ci-way", el).value, experiment: pick() || "no" });
        close();
        render(r.state);
        say("Saved to today's note. Wind down.");
      } catch (err) { say(err.message, true); }
    };
  });
}

function review() {
  const n = S.review, ex = S.experiment;
  const box = (v, l) => `<div><b>${esc(v)}</b><span>${l}</span></div>`;
  sheet(`<h2 id="sheet-h">Sunday review</h2><p class="sub">${shortDay(n.from)} to ${shortDay(n.to)}. Five minutes, then it's saved as this week's note.</p>
    <div class="numbers">${box(n.points, "points")}${box(n.done, "finished")}${box(n.not_zero_days + "/7", "not-zero days")}
      ${box(n.best_day.split(" (")[0], "best day")}${box(n.top, "most points")}${box(n.estimate.startsWith("no ") ? "—" : n.estimate.replace("you guessed ", "").replace(" min, took ", " → "), "guessed → took (min)")}</div>
    <form id="rv">
      <label>What worked?<textarea id="rv-ok" maxlength="600"></textarea></label>
      <label>What got in the way?<textarea id="rv-way" maxlength="600"></textarea></label>
      <p class="sub">This week's experiment: ${esc(ex.title)}. Keep it, change it, or swap to the next one?</p>
      <div class="row"><button type="button" class="choice" data-v="keep" aria-pressed="true">Keep</button>
        <button type="button" class="choice" data-v="change" aria-pressed="false">Change</button>
        <button type="button" class="choice" data-v="swap" aria-pressed="false">Swap</button></div>
      <label style="margin-top:14px">What changes? (optional)<input id="rv-note" maxlength="300"></label>
      <div class="row"><button class="go">Save the week</button><button type="button" class="quiet" data-close>Later</button></div>
    </form>`,
  (el, close) => {
    const pick = choices(el);
    $("#rv", el).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api("/api/review", { worked: $("#rv-ok", el).value, in_the_way: $("#rv-way", el).value, decision: pick() || "keep", note: $("#rv-note", el).value });
        close();
        render(r.state);
        say(`Week saved. This week's experiment: ${r.state.experiment.title}.`);
      } catch (err) { say(err.message, true); }
    };
  });
}

$("#open-checkin").onclick = checkin;
$("#open-review").onclick = review;
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 30000);
refresh();
