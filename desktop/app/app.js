/* Game Plan desktop: one page, read from the Obsidian vault via server.py */
"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const key = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

let S = null;                       // last /api/state
let month = null;                   // first day of the shown month
let selDay = null;                  // selected calendar day (yyyy-mm-dd)
let showAllLater = false;
let showAllLate = false;

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json", "X-Game-Plan": "1" }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}

async function load() {
  try { S = await api("/api/state"); }
  catch (e) { $("#hero").innerHTML = '<p class="empty">Can\'t reach the vault server. Is it running? (desktop/install.sh)</p>'; return; }
  if (!month) { const t = parseDay(S.today); month = new Date(t.getFullYear(), t.getMonth(), 1); }
  render();
}

function dueLabel(t) {
  if (t.days == null) return { text: "no date", cls: "" };
  if (t.days < 0) return { text: -t.days === 1 ? "1 day late" : -t.days + " days late", cls: "late" };
  if (t.days === 0) return { text: "due today", cls: "soon" };
  if (t.days === 1) return { text: "due tomorrow", cls: "soon" };
  const d = parseDay(t.due);
  return { text: "due " + d.toLocaleDateString([], t.days < 7 ? { weekday: "short" } : { month: "short", day: "numeric" }), cls: "" };
}

/* ---------- render ---------- */
function render() {
  const t = parseDay(S.today);
  $("#today").textContent = t.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const p = S.progress, pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  $("#prog").innerHTML = `<span>This week: <b>${p.done}</b> of ${p.total} done</span><div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
  renderHero(); renderLists(); renderCal();
}

function renderHero() {
  const h = S.hero;
  if (!h) { $("#hero").innerHTML = '<div class="eyebrow">START HERE</div><p class="empty">Nothing open. You\'re caught up 🎉</p>'; return; }
  const d = dueLabel(h);
  $("#hero").innerHTML = `
    <div class="eyebrow">${h.status === "doing" ? "KEEP GOING" : "START HERE"}</div>
    <h1>${esc(h.title)}</h1>
    <div class="meta"><span class="tag">${esc(h.class)}</span><span class="due ${d.cls}">${d.text}</span></div>
    <p class="why">${esc(h.why)}</p>
    <p class="step"><b>5-minute first step:</b> ${esc(h.first_step)}</p>
    <div class="actions">
      <button class="btn go" data-act="start" data-id="${esc(h.id)}">▶ Start</button>
      <button class="btn ghost" data-act="done" data-id="${esc(h.id)}">✓ Done</button>
      <a class="btn ghost" href="${esc(h.obsidian)}">Open note</a>
    </div>`;
}

function row(t) {
  const d = dueLabel(t);
  return `<div class="row">
    <button class="check" data-act="done" data-id="${esc(t.id)}" aria-label="Mark ${esc(t.title)} done" title="Mark done"></button>
    <div class="t"><a href="${esc(t.obsidian)}">${esc(t.title)}</a>${t.status === "doing" ? ' <span class="doing">● STARTED</span>' : ""}</div>
    <span class="tag">${esc(t.class)}</span><span class="due ${d.cls}">${d.text}</span>
  </div>`;
}

function renderLists() {
  const rest = S.open.filter((t) => !S.hero || t.id !== S.hero.id);
  const late = rest.filter((t) => t.days != null && t.days < 0);
  const week = rest.filter((t) => t.days != null && t.days >= 0 && t.days <= 7);
  const later = rest.filter((t) => t.days == null || t.days > 7);
  let html = "";
  if (late.length) {
    // A wall of red is demotivating: show 3, tuck the rest away, offer a one-click cleanup.
    html += `<h3 class="over">Overdue (${late.length})</h3>` + (showAllLate ? late : late.slice(0, 3)).map(row).join("");
    if (late.length > 3) html += `<button class="more" data-act="late">${showAllLate ? "Show less" : "Show all " + late.length}</button> `;
    const allLate = S.open.filter((t) => t.days != null && t.days < 0).length;
    html += `<button class="bulk" data-act="bulk">Already turned these in? Mark all ${allLate} done</button>`;
  }
  html += `<h3>This week (${week.length})</h3>` + (week.map(row).join("") || '<p class="sub">Nothing else this week 👍</p>');
  if (later.length) {
    const shown = showAllLater ? later : later.slice(0, 4);
    html += `<h3>Later (${later.length})</h3>` + shown.map(row).join("");
    if (later.length > 4) html += `<button class="more" data-act="later">${showAllLater ? "Show less" : "Show all " + later.length}</button>`;
  }
  $("#lists").innerHTML = html;
}

function renderCal() {
  $("#cal-h").textContent = month.toLocaleDateString([], { month: "long", year: "numeric" });
  const byDay = {};
  S.calendar.forEach((t) => (byDay[t.due] = byDay[t.due] || []).push(t));
  const start = new Date(month); start.setDate(1 - ((month.getDay() + 6) % 7));   // Monday-first grid
  let html = ["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = key(d), items = byDay[k] || [];
    const dots = items.map((t) => `<i class="dot ${t.status === "done" ? "done" : t.days < 0 ? "late" : ""}"></i>`).join("");
    html += `<button class="day${d.getMonth() !== month.getMonth() ? " other" : ""}${k === S.today ? " is-today" : ""}${k === selDay ? " sel" : ""}" data-act="day" data-day="${k}" aria-label="${d.toDateString()}, ${items.length} due">
      <span class="n">${d.getDate()}</span><span class="dots">${dots}</span></button>`;
  }
  $("#cal").innerHTML = html;
  const sel = selDay ? (byDay[selDay] || []) : [];
  $("#dayList").innerHTML = selDay ? `<h3>${parseDay(selDay).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</h3>` +
    (sel.length ? sel.map((t) => t.status === "done" ? `<div class="row"><span class="check" style="background:var(--mint-soft);border-color:var(--mint)"></span><div class="t">${esc(t.title)}</div><span class="tag">${esc(t.class)}</span></div>` : row(t)).join("") : '<p class="sub">Nothing due.</p>') : "";
}

/* ---------- actions ---------- */
let toastTimer;
function toast(msg, undo) {
  const el = $("#toast"); el.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button data-act="undo">Undo</button>' : "");
  el.hidden = false; el._undo = undo; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "start") {
    const win = window.open("about:blank", "_blank");          // open now so it isn't popup-blocked
    try {
      const r = await api("/api/start", { id });
      if (win) win.location = r.url; else location.href = r.url;
      toast("Started. Logged in today's daily note.");
    } catch (err) { if (win) win.close(); toast("Couldn't start: " + err.message); }
    load();
  } else if (act === "done") {
    const t = S.open.find((x) => x.id === id), prev = t ? t.status : "todo";
    await api("/api/status", { id, status: "done" });
    toast(`Done: ${t ? t.title : "task"} ✅`, () => api("/api/status", { id, status: prev }).then(load));
    load();
  } else if (act === "bulk") {
    const late = S.open.filter((t) => t.days != null && t.days < 0);
    await Promise.all(late.map((t) => api("/api/status", { id: t.id, status: "done" })));
    toast(`Marked ${late.length} overdue items done`, () => Promise.all(late.map((t) => api("/api/status", { id: t.id, status: t.status }))).then(load));
    load();
  } else if (act === "late") {
    showAllLate = !showAllLate; renderLists();
  } else if (act === "undo") {
    const u = $("#toast")._undo; $("#toast").hidden = true; if (u) u();
  } else if (act === "prev" || act === "next") {
    month = new Date(month.getFullYear(), month.getMonth() + (act === "next" ? 1 : -1), 1); renderCal();
  } else if (act === "day") {
    selDay = selDay === b.dataset.day ? null : b.dataset.day; renderCal();
  } else if (act === "later") {
    showAllLater = !showAllLater; renderLists();
  }
});

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
setInterval(load, 60000);
load();
