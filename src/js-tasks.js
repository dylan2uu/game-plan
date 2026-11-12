function listOrder(a, b) {
  const da = parseLocal(a.due), db = parseLocal(b.due);
  if (da && db) return da - db; if (da) return -1; if (db) return 1;
  return String(a.createdAt).localeCompare(String(b.createdAt));
}

/* ---------- priority: what matters most right now, and why ---------- */
const WORK = { pomo: 1, focus: 1 };
function loggedMin(t) { return (t.log || []).reduce((a, e) => a + (WORK[e.k] ? +e.m || 0 : 0), 0); }
function hasFirst(t) { return !!t.firstAt || (t.log || []).some((e) => e.k === "first") || loggedMin(t) >= 2; }
function startedOn(t, dk) {
  if (S.timer && S.timer.taskId === t.id && dayKey(new Date()) === dk) return true;
  return (t.log || []).some((e) => (WORK[e.k] || e.k === "first") && dayKey(new Date(e.at)) === dk);
}
function lastWorkAt(t) { let m = 0; (t.log || []).forEach((e) => { if (WORK[e.k] || e.k === "first") m = Math.max(m, Date.parse(e.at) || 0); }); return m; }
function courseColor(c) { return c ? COURSE_COLORS[parseInt(fnv(String(c).toUpperCase()), 36) % COURSE_COLORS.length] : "var(--muted)"; }
function hmDate(d, h, m) { const x = new Date(d); x.setHours(h, m || 0, 0, 0); return x; }
function parseHM(d, hm) { const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || "")); return m ? hmDate(d, +m[1], +m[2]) : null; }
function mergeIv(list) {
  const a = list.filter((b) => b.e > b.s).sort((x, y) => x.s - y.s), out = [];
  a.forEach((b) => { const l = out[out.length - 1]; if (l && b.s <= l.e) l.e = Math.max(l.e, b.e); else out.push({ s: b.s, e: b.e }); });
  return out;
}
let BUSY = { at: 0, list: [], raw: [] };
let BUSYALL = { key: "", list: [] };
function weeklyBusy(from, to) {
  const out = [], blocks = Array.isArray(S.settings.busy) ? S.settings.busy : [];
  if (!blocks.length) return out;
  const d = new Date(from); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 70 && +d < to; i++, d.setDate(d.getDate() + 1)) {
    blocks.forEach((b) => {
      if (!b || !Array.isArray(b.days) || b.days.indexOf(d.getDay()) < 0) return;
      const s = parseHM(d, b.start), e = parseHM(d, b.end);
      if (s && e && e > s) out.push({ s: +s, e: +e });
    });
  }
  return out;
}
function busyAll() {
  const key = BUSY.at + "|" + JSON.stringify(S.settings.busy || []) + "|" + dayKey(new Date());
  if (BUSYALL.key !== key) { const now = Date.now(); BUSYALL = { key, list: mergeIv(BUSY.list.concat(weeklyBusy(now - DAY, now + 62 * DAY))) }; }
  return BUSYALL.list;
}
/* free minutes between 9 AM and 10 PM that aren't on his calendar or in his usual busy times */
function freeMin(from, to) {
  if (to <= from) return 0;
  const busy = busyAll(), known = BUSY.at ? BUSY.at + 16 * DAY : 0;
  let total = 0;
  const d = new Date(from); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 70 && +d < to; i++, d.setDate(d.getDate() + 1)) {
    const s = Math.max(from, +hmDate(d, 9, 0)), e = Math.min(to, +hmDate(d, 22, 0));
    if (e <= s) continue;
    let mins = (e - s) / 60000;
    busy.forEach((b) => { const os = Math.max(s, b.s), oe = Math.min(e, b.e); if (oe > os) mins -= (oe - os) / 60000; });
    if (!known || +d > known) mins *= 0.7;
    total += Math.max(0, mins);
  }
  return total;
}
function dueWord(due, ref) {
  const r = new Date(ref), tmr = new Date(r); tmr.setDate(r.getDate() + 1);
  const late = due.getHours() === 23 && due.getMinutes() === 59, tm = late ? "" : " " + fmtTime(due);
  if (dayKey(due) === dayKey(r)) return (due.getHours() >= 17 ? "tonight" : "today") + tm;
  if (dayKey(due) === dayKey(tmr)) return "tomorrow" + tm;
  if (due - r < 6 * DAY) return due.toLocaleDateString([], { weekday: "short" }) + tm;
  return due.toLocaleDateString([], { month: "short", day: "numeric" });
}
function assessRaw(t, now) {
  const due = parseLocal(t.due), est = +t.estMin || EST[t.points] || 30, logged = loggedMin(t);
  const left = Math.max(Math.round(est * 0.15), est - logged);
  const a = { tier: "green", score: 100, left, logged, est, due, hrs: null, free: null, pressure: 0, why: "", short: "" };
  const plan = parseLocal(t.planAt), planToday = plan && +plan > now - 3600000 && dayKey(plan) === dayKey(new Date(now));
  const started = logged > 0 || hasFirst(t);
  if (!due) {
    a.why = "No deadline, so it waits for a free gap."; a.short = "no deadline";
  } else {
    const hrs = (due - now) / 3600000, free = freeMin(now, +due), pressure = left / Math.max(20, free * 0.5);
    a.hrs = hrs; a.free = free; a.pressure = pressure;
    const dw = dueWord(due, now);
    if (hrs < 0) {
      a.tier = "red"; a.score = 420 + Math.min(60, -hrs / 2);
      const since = dayKey(due) === dayKey(new Date(now)) ? fmtTime(due) : due.toLocaleDateString([], { weekday: "long" });
      a.why = "Overdue since " + since + ". About " + fmtMin(left) + " left, so this goes first."; a.short = "overdue";
    } else if (hrs <= 24) {
      a.tier = "red"; a.score = 330 + (24 - hrs) * 2 + Math.min(40, pressure * 20);
      a.why = "Due " + dw + ". About " + fmtMin(left) + " of work left" + (started ? "." : " and it isn't started yet."); a.short = "due " + dw + (started ? "" : ", not started");
    } else if (pressure >= 0.7) {
      a.tier = "red"; a.score = 300 + Math.min(80, pressure * 40);
      a.why = "About " + fmtMin(left) + " of work, but only ~" + fmtMin(free) + " of free time before it's due " + dw + "."; a.short = "tight on time, due " + dw;
    } else if (hrs <= 96 || pressure >= 0.3 || (+t.points >= 8 && hrs <= 240)) {
      a.tier = "yellow"; a.score = 200 + Math.min(70, pressure * 70) + Math.max(0, 96 - hrs) / 3;
      if (+t.points >= 8 && hrs > 96) { a.why = "Big one (" + ptsL(t.points) + ") due " + dw + ". One " + focusLen() + "-minute chunk a day keeps it easy."; a.short = "big one, chip at it"; }
      else { a.why = "Due " + dw + ". Starting today means it never turns into a crunch."; a.short = "due " + dw; }
    } else {
      a.score = 100 + Math.max(0, 50 - hrs / 8);
      a.why = "Due " + dw + ". Plenty of room for now."; a.short = "due " + dw;
    }
  }
  if (planToday) {
    if (a.tier === "green") { a.tier = "yellow"; a.score = Math.max(a.score, 240); }
    a.why = (+plan > now ? "You planned this for " + fmtTime(plan) + ". " : "You planned this for today. ") + a.why;
  }
  if (started && a.tier !== "green") a.score += 10;
  if (t.pinned) a.score += 1000;
  a.score += (+t.points || 0) * 0.4;
  return a;
}
const AS = new Map();
function assess(t, ref) {
  busyAll();
  const now = ref || Date.now();
  const key = Math.floor(now / 60000) + "|" + BUSYALL.key + "|" + t.due + "|" + t.estMin + "|" + (t.log || []).length + "|" + t.firstAt + "|" + t.planAt + "|" + t.points + "|" + !!t.pinned + "|" + focusLen();
  const hit = AS.get(t.id);
  if (hit && hit.key === key) return hit.a;
  const a = assessRaw(t, now);
  AS.set(t.id, { key, a });
  return a;
}
function heroTask() {
  if (S.timer) { const t = S.tasks.get(S.timer.taskId); if (t && t.status === "open") return t; }
  const open = openTasks(), pool = open.filter((t) => !S.skipIds.has(t.id)), list = pool.length ? pool : open;
  const pinned = pool.find((t) => t.pinned);
  if (pinned) return pinned;
  const rn = recentNudge(); if (rn) return rn.t;
  let best = null, bs = -Infinity;
  list.forEach((t) => { const s = assess(t).score; if (s > bs) { bs = s; best = t; } });
  return best;
}
function lineup(excludeId) { return openTasks().filter((t) => t.id !== excludeId).map((t) => ({ t, a: assess(t) })).sort((x, y) => y.a.score - x.a.score); }
/* a nudge that went off in the last hour for something he hasn't touched since: that task jumps to "do this now" */
function recentNudge() {
  const now = Date.now(), tk = dayKey(new Date());
  let best = null;
  openTasks().forEach((t) => {
    if (S.skipIds.has(t.id) || t.quietDay === tk) return;
    (t.nudges || []).forEach((n) => {
      const at = n && Date.parse(n.at);
      if (!(at <= now && now - at <= 60 * 60000)) return;
      if (lastWorkAt(t) >= at - 5 * 60000) return;
      if (!best || at > best.at) best = { t, n, at, mins: Math.max(0, Math.round((now - at) / 60000)) };
    });
  });
  return best;
}
/* how many nudges in a row he let slide for this task */
function missedStreak(t) {
  const now = Date.now(), past = (t.nudges || []).filter((n) => n && Date.parse(n.at) <= now).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  let c = 0;
  for (const n of past) { const r = nudgeResult(t, n); if (r.state === "pending") continue; if (r.state === "missed") c++; else break; }
  return c;
}
/* the next few open half-hours (not busy, 9 AM to 9:30 PM), spread out, for "when will you do it?" */
function freeSlots(n) {
  const out = [], busy = busyAll(), now = Date.now();
  for (let di = 0; di < 3 && out.length < n; di++) {
    const day = new Date(now); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + di);
    for (let m = 9 * 60; m <= 21 * 60 + 30 && out.length < n; m += 30) {
      const x = +hmDate(day, Math.floor(m / 60), m % 60);
      if (x < now + 20 * 60000) continue;
      if (busy.some((b) => x >= b.s - 10 * 60000 && x < b.e)) continue;
      if (out.some((u) => Math.abs(u - x) < 150 * 60000)) continue;
      out.push(x);
    }
  }
  return out;
}
function planFor(id, at) {
  const t = S.tasks.get(id); if (!t) return;
  const prev = t.planAt || null, iso = at ? localISO(new Date(at)) : null;
  patchTask(id, { planAt: iso });
  planSoon();
  const key = pushUndo(iso ? "plan " + t.title : "clear plan", [() => { patchTask(id, { planAt: prev }); planSoon(); }]);
  toast(iso ? "Planned for " + fmtWhenShort(new Date(at)) + ". Your phone pings you right then." : "Plan cleared.", { action: "Undo", key, onAction: () => runUndo(key) });
}
/* any claude.ai link except this app itself or a not-yet-created chat */
/* the assignment's own Brightspace page: the submit box, discussion or quiz beats the calendar entry */
function bsLink(desc) {
  const urls = String(desc || "").match(/https?:\/\/[^\s<>"')]+/g) || [];
  const d2l = urls.map((u) => u.replace(/[.,;]+$/, "")).filter((u) => /\/d2l\//i.test(u));
  return d2l.find((u) => /dropbox|discussions|quizzing|quizzes|content/i.test(u)) || d2l.find((u) => !/\/calendar\//i.test(u)) || d2l[0] || null;
}
function bsLabel(u) { return /dropbox/i.test(u) ? "Submit in Brightspace" : /discussions/i.test(u) ? "Open the discussion" : /quiz/i.test(u) ? "Open the quiz" : "Open in Brightspace"; }
function bsBtn(t, cls) { return t.bsUrl ? '<a class="' + cls + '" href="' + esc(t.bsUrl) + '" target="_blank" rel="noopener">' + ICON.ext + esc(bsLabel(t.bsUrl)) + "</a>" : ""; }
const CHAT_RE = /^https:\/\/claude\.ai\/(?!artifact\/|new\b)\S+$/i;
function setChatLink(id, url, quiet) {
  const t = S.tasks.get(id); if (!t) return false;
  url = String(url || "").trim();
  if (!CHAT_RE.test(url)) { toast("That isn't a chat link yet. Open the chat in Claude, then copy its address (claude.ai/chat/…)."); return false; }
  const prev = t.chatUrl || null;
  patchTask(id, { chatUrl: url });
  planSoon();
  const key = pushUndo("chat link for " + t.title, [() => { patchTask(id, { chatUrl: prev }); planSoon(); }]);
  if (!quiet) toast("Chat saved. Start now reopens it right where you left off.", { action: "Undo", key, onAction: () => runUndo(key) });
  return key;
}
async function shrinkStep(id) {
  const t = S.tasks.get(id); if (!t) return;
  const prev = t.firstStep;
  let step = "Open it and look at it for 2 minutes. That's all.";
  if (S.sample && !S.sampleOff) {
    try {
      const r = await S.sample.json("Dylan keeps skipping this task. Rewrite its first step to be even smaller: one physical action under 2 minutes that's almost too easy to refuse (max 70 characters). Task: " + JSON.stringify(t.title) + ". Current first step: " + JSON.stringify(t.firstStep) + '. Reply with only JSON: {"firstStep": string}', { modelTier: "quick", cache: false });
      if (r && typeof r.firstStep === "string" && r.firstStep.trim()) step = r.firstStep.trim().slice(0, 120);
    } catch (e) { /* use the fallback */ }
  }
  patchTask(id, { firstStep: step });
  planSoon();
  const key = pushUndo("smaller first step", [() => patchTask(id, { firstStep: prev })]);
  toast("New first step: " + step, { action: "Undo", key, ms: 8000, onAction: () => runUndo(key) });
}
function upcomingNudges(t) { const now = Date.now(); return (t.nudges || []).filter((n) => n && Date.parse(n.at) > now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); }

/* did a nudge get him working? started within 2 hours = it worked fast; worked on it later that day = it helped */
function nudgeResult(t, n) {
  const at = Date.parse(n.at), now = Date.now();
  if (at > now) return { state: "upcoming" };
  let fast = null, later = null;
  (t.log || []).forEach((e) => {
    if (!(WORK[e.k] || e.k === "first" || e.k === "done")) return;
    const end = Date.parse(e.at), start = e.s ? Date.parse(e.s) : end - (+e.m || 0) * 60000;
    if (start >= at - 10 * 60000 && start <= at + 2 * 3600000) { if (fast == null || start < fast) fast = start; }
    else if (start > at && dayKey(new Date(start)) === dayKey(new Date(at))) { if (later == null || start < later) later = start; }
  });
  if (fast != null) return { state: "fast", fast: true, mins: Math.max(0, Math.round((fast - at) / 60000)) };
  if (later != null) return { state: "later", worked: true };
  if (now - at < 2 * 3600000) return { state: "pending" };
  return { state: "missed" };
}

/* ---------- task actions ---------- */
function completeTask(id, anchorEl, fromChat) {
  if (S.timer && S.timer.taskId === id) stopTimer(true, null, true);
  const t = S.tasks.get(id); if (!t || t.status !== "open") return null;
  unlockAudio();
  const before = gardenData(), now = new Date();
  const earned = (t.log || []).filter((e) => e.k === "step").reduce((a, e) => a + (+e.p || 0), 0);
  const pts = Math.max(0, Math.round((+t.points - earned) * 2) / 2);
  const due = parseLocal(t.due);
  const early = due ? Math.round(((due - now) / DAY) * 10) / 10 : null;
  const prev = { status: "open", completedAt: null, log: t.log || [], pinned: !!t.pinned };
  const entry = { at: now.toISOString(), k: "done", p: pts, m: 0 }; if (early != null) entry.early = early;
  S.skipIds.delete(id);
  patchTask(id, { status: "done", completedAt: now.toISOString(), log: (t.log || []).concat([entry]), pinned: false });
  let nextId = null;
  if (t.repeat === "weekly") {
    const nt = newTask({ title: t.title, course: t.course, due: due ? localISO(new Date(+due + 7 * DAY)) : null, points: t.points, estMin: t.estMin, firstStep: t.firstStep, repeat: "weekly", notes: t.notes, chatUrl: t.chatUrl });
    nextId = nt.id; saveTask(nt);
  }
  chime("done");
  if (anchorEl) { floatText(anchorEl, "+" + fmtPts(pts)); burst(anchorEl); }
  planSoon();
  const undo = () => { patchTask(id, prev); if (nextId) removeTaskCompletely(nextId); planSoon(); };
  if (!fromChat) {
    const key = pushUndo("finish " + t.title, [undo]);
    toast("<b>+" + ptsL(pts) + "</b> " + esc(t.title) + " is done." + growLine(before), { html: true, action: "Undo", ms: 9000, key, onAction: () => runUndo(key) });
  }
  return { pts, undo };
}
function reopenTask(id) {
  const t = S.tasks.get(id); if (!t || t.status !== "done") return;
  const prevLog = t.log || [], prevAt = t.completedAt, log = prevLog.slice();
  for (let k = log.length - 1; k >= 0; k--) if (log[k].k === "done") { log.splice(k, 1); break; }
  patchTask(id, { status: "open", completedAt: null, log });
  planSoon();
  const key = pushUndo("put back " + t.title, [() => { patchTask(id, { status: "done", completedAt: prevAt, log: prevLog }); planSoon(); }]);
  toast(esc(t.title) + " is back on your list.", { html: true, action: "Undo", ms: 7000, key, onAction: () => runUndo(key) });
}
function markFirst(id, auto, anchorEl) {
  const t = S.tasks.get(id); if (!t || t.status !== "open") return;
  if ((t.log || []).some((e) => e.k === "first")) { if (!t.firstAt) patchTask(id, { firstAt: new Date().toISOString() }); return; }
  const before = gardenData(), now = new Date().toISOString(), prev = { firstAt: t.firstAt || null, log: t.log || [] };
  patchTask(id, { firstAt: t.firstAt || now, log: (t.log || []).concat([{ at: now, k: "first", p: 1, m: 0 }]) });
  chime("start");
  if (anchorEl) { floatText(anchorEl, "+1"); burst(anchorEl, true); }
  planSoon();
  const key = pushUndo("first step on " + t.title, [() => { patchTask(id, prev); planSoon(); }]);
  toast("<b>+1 pt</b> " + (auto ? "Two minutes in counts as the first step. You're rolling." : "First step done. That was the hardest part.") + growLine(before), { html: true, action: auto ? null : "Undo", ms: 6500, key, onAction: () => runUndo(key) });
}
function chooseTask(id) {
  for (const o of S.tasks.values()) if (o.pinned && o.id !== id) patchTask(o.id, { pinned: false });
  S.skipIds.delete(id);
  patchTask(id, { pinned: true });
}
function skipTask(id) {
  const t = S.tasks.get(id); if (!t) return;
  S.skipIds.add(id);
  if (t.pinned) patchTask(id, { pinned: false }); else scheduleRender();
}
function dismissTask(id) {
  const t = S.tasks.get(id); if (!t) return;
  if (S.timer && S.timer.taskId === id) stopTimer(false);
  patchTask(id, { status: "dismissed", pinned: false });
  planSoon();
}
async function removeTaskCompletely(id) {
  const t = S.tasks.get(id); if (!t) return;
  if (S.timer && S.timer.taskId === id) stopTimer(false);
  deleteTaskDoc(id);
  planSoon();
  if (!S.mcp) return;
  const ids = [t.nudge && t.nudge.id].concat((t.nudges || []).filter((n) => n && Date.parse(n.at) > Date.now()).map((n) => n.id), (t.reminders || []).map((r) => r.id)).filter(Boolean);
  for (const eid of ids) { try { await calCall("delete_event", { eventId: eid }, false); } catch (e) { /* already gone or offline */ } }
}

/* ---------- clock-in timer: counts up until you stop. A point every 10 minutes, a plant blooms every 25. ---------- */
const POINT_MIN = 10, PLANT_MIN = 25;
function pickPlant() {
  const last = store.get("gp.lastPlant", "");
  let k = "tulip";
  for (let i = 0; i < 8; i++) { k = SPECIES[Math.floor(Math.random() * SPECIES.length)].k; if (k !== last) break; }
  store.set("gp.lastPlant", k);
  return { plant: k, seed: 1 + Math.floor(Math.random() * 2e9), gold: Math.random() < 1 / 12 };
}
/* the i-th plant of a session: the first is the one picked at clock-in, the rest are surprises */
function sessionKind(tm, i) {
  if (!i) return { plant: tm.plant || "tulip", seed: tm.seed || 1, gold: !!tm.gold };
  const r = mulberry((tm.seed || 1) + i * 7919);
  return { plant: SPECIES[Math.floor(r() * SPECIES.length) % SPECIES.length].k, seed: 1 + Math.floor(r() * 2e9), gold: r() < 1 / 12 };
}
function sessionPlants(tm, mins) {
  const out = [], n = Math.floor(mins / PLANT_MIN), rem = mins - n * PLANT_MIN;
  for (let i = 0; i < n; i++) out.push(Object.assign(sessionKind(tm, i), { g: 1 }));
  if (rem >= 5) out.push(Object.assign(sessionKind(tm, n), { g: Math.round((rem / PLANT_MIN) * 100) / 100 }));
  return out;
}
function elapsedMin(tm) { return Math.max(0, (Date.now() - Date.parse(tm.startedAt)) / 60000); }
function startFocus(id) {
  unlockAudio();
  if (S.timer) stopTimer(true, null, true);
  const pl = pickPlant(), now = new Date().toISOString();
  S.focusOpen = !isWide(); // on a big screen the timer docks beside the board instead of covering it
  setTimerDoc({ taskId: id, mode: "up", startedAt: now, checkAt: now, sid: rid("s"), plant: pl.plant, seed: pl.seed, gold: pl.gold });
  chime("start");
  planSoon();
}
function logTime(id, m, kind, sid, at, extra) {
  const t = S.tasks.get(id); if (!t || !m) return;
  if (sid && (t.log || []).some((e) => e.sid === sid)) return;
  const e = Object.assign({ at: (at || new Date()).toISOString(), k: kind, p: 0, m: m }, extra || {}); if (sid) e.sid = sid;
  patchTask(id, { log: (t.log || []).concat([e]) });
}
/* clock out: logs the minutes, a point per 10, and plants whatever grew */
function stopTimer(announce, minutesOverride, noAgain) {
  const tm = S.timer; if (!tm) return null;
  let m = Math.floor(elapsedMin(tm));
  if (minutesOverride != null) m = Math.max(0, Math.min(m, Math.round(minutesOverride)));
  const plants = m >= 5 ? sessionPlants(tm, m) : [], p = Math.floor(m / POINT_MIN), before = gardenData(), t = S.tasks.get(tm.taskId);
  if (m >= 1) logTime(tm.taskId, m, "focus", tm.sid, new Date(Date.parse(tm.startedAt) + m * 60000), { s: tm.startedAt, p, plants });
  S.stopped.add(tm.sid);
  setTimerDoc(null);
  S.focusOpen = !isWide();
  planSoon();
  if (announce) {
    chime(m >= 1 ? "stop" : "tap");
    let msg = m >= 1 ? (p ? "<b>+" + ptsL(p) + "</b> " : "") + "Clocked " + fmtMin(m) + (t ? " on " + esc(t.title) : "") + "." : "Timer stopped. Under a minute, so nothing was logged.";
    if (plants.length) msg += '<span class="toast-why">Planted ' + plants.map((q) => esc(plantName(q.plant, q.gold)) + (q.g < 1 ? " (sprout)" : "")).join(", ") + "</span>";
    if (m >= 1) msg += growLine(before);
    toast(msg, { html: true, ms: 9000, action: t && t.status === "open" && !noAgain ? "Keep going" : null, onAction: () => startFocus(tm.taskId) });
  }
  return { m, p, plants };
}
/* undo an automatic clock-out and let him type the real minutes */
function fixSession(saved) {
  const t = S.tasks.get(saved.taskId); if (!t) return;
  patchTask(t.id, { log: (t.log || []).filter((e) => e.sid !== saved.sid) });
  S.stopped.delete(saved.sid);
  setTimerDoc(Object.assign({}, saved, { checkAt: new Date().toISOString(), maxMin: null }));
  S.adjust = true; S.focusOpen = true; S.flSig = null; scheduleRender();
}
function stillHere() { if (S.timer) setTimerDoc(Object.assign({}, S.timer, { checkAt: new Date().toISOString() })); S.askedFor = null; }
function lerpHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), ch = (s) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const x = ch(pa), y = ch(pb);
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
const FL_SKY = { l: [["#DCEBD6", "#F2F7EF"], ["#E9F0D2", "#F6F8EC"], ["#F6E3B8", "#FAF5E6"]], d: [["#132A1C", "#0B1510"], ["#1A2E1A", "#0D160F"], ["#2C2A14", "#11140C"]] };
function skyAt(frac) {
  const P = FL_SKY[isDark() ? "d" : "l"], i = frac < 0.5 ? 0 : 1, t = frac < 0.5 ? frac * 2 : (frac - 0.5) * 2;
  return [lerpHex(P[i][0], P[i + 1][0], t), lerpHex(P[i][1], P[i + 1][1], t)];
}
function ringColor(f) { const h = f < 0.5 ? 245 - 85 * f * 2 : 160 - 120 * (f - 0.5) * 2; return "hsl(" + Math.round(h) + " 72% " + (isDark() ? 66 : 50) + "%)"; }
function stageName(p) { return p < 0.1 ? "Sprouting" : p < 0.3 ? "Sprout" : p < 0.55 ? "Growing" : p < 0.8 ? "Budding" : p < 1 ? "Blooming" : "Full bloom"; }
function fmtClock(sec) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60; return (h ? h + ":" + pad(m) : String(m)) + ":" + pad(s2); }
let lastSky = 0, beat = { sid: "", pts: 0, plants: 0 };
function setPlant(el, k, p, seed, gold, step) {
  if (!el) return;
  if (el.dataset.k === k + seed && Math.abs((+el.dataset.p || -1) - p) < step) return;
  el.innerHTML = plantSVG(k, p, seed, gold); el.dataset.p = String(p); el.dataset.k = k + seed;
}
function tick() {
  const tm = S.timer;
  if (!tm) { if (document.title !== "Game Plan") document.title = "Game Plan"; return; }
  const mins = elapsedMin(tm), txt = fmtClock(Math.floor(mins * 60));
  document.querySelectorAll("[data-clock]").forEach((c) => { if (c.textContent !== txt) c.textContent = txt; });
  const idx = Math.floor(mins / PLANT_MIN), cyc = (mins - idx * PLANT_MIN) / PLANT_MIN, pts = Math.floor(mins / POINT_MIN);
  const cur = sessionKind(tm, idx), p = Math.max(0.035, cyc);
  /* sounds: a coin for every point, a little fanfare when a plant blooms */
  if (beat.sid !== tm.sid) beat = { sid: tm.sid, pts, plants: idx };
  else if (idx > beat.plants) {
    beat.plants = idx; beat.pts = pts; chime("bloom");
    const done = sessionKind(tm, idx - 1), fl = $("#focusLayer");
    if (fl && !fl.hidden) burst(fl.querySelector(".fl-stage"));
    toast("<b>Bloomed!</b> " + esc(plantName(done.plant, done.gold)) + " is fully grown and goes in your garden when you stop. A new seed just went in.", { html: true, ms: 7000 });
    renderHarvest(tm, idx);
  } else if (pts > beat.pts) { beat.pts = pts; chime("coin"); const c = $("#fPts") || $("#rbPts"); if (c) floatText(c, "+1"); }
  const ring = $("#fRing");
  if (ring) { ring.setAttribute("stroke-dashoffset", f1(RING_C * (1 - cyc))); ring.setAttribute("stroke", ringColor(cyc)); }
  setPlant($("#fPlant"), cur.plant, p, cur.seed, cur.gold, 0.0015);
  setPlant($("#miniPlant"), cur.plant, p, cur.seed, cur.gold, 0.01);
  setPlant($("#rbPlant"), cur.plant, p, cur.seed, cur.gold, 0.01);
  setPlant($("#dkPlant"), cur.plant, p, cur.seed, cur.gold, 0.004);
  const dr = $("#dkRing"); if (dr) { dr.setAttribute("stroke-dashoffset", f1(DK_C * (1 - cyc))); dr.setAttribute("stroke", ringColor(cyc)); }
  const set = (sel, v) => { const e = $(sel); if (e && e.textContent !== v) e.textContent = v; };
  set("#fStage", plantName(cur.plant, cur.gold) + " · " + stageName(cyc).toLowerCase() + " · blooms in " + Math.max(1, Math.ceil((1 - cyc) * PLANT_MIN)) + " min");
  set("#fPts", "+" + pts + (pts === 1 ? " pt" : " pts"));
  set("#rbPts", "+" + pts);
  set("#dkPts", "+" + pts + (pts === 1 ? " pt" : " pts"));
  set("#dkStage", plantName(cur.plant, cur.gold) + " blooms in " + Math.max(1, Math.ceil((1 - cyc) * PLANT_MIN)) + " min · next point in " + Math.max(1, Math.ceil(POINT_MIN - (mins % POINT_MIN))) + " min");
  set("#fNext", "next point in " + Math.max(1, Math.ceil(POINT_MIN - (mins % POINT_MIN))) + " min");
  set("#fToday", fmtMin((stats().today.m || 0) + mins));
  const gd = gardenData(), have = Math.min(gd.curNeed, gd.curHave + pts), tr = $("#fTree");
  if (tr) { tr.style.width = ((have / gd.curNeed) * 100).toFixed(1) + "%"; set("#fTreeTxt", fmtPts(have) + "/" + gd.curNeed); }
  if (mins >= 2 && !S.autoFirst[tm.taskId]) {
    S.autoFirst[tm.taskId] = 1;
    const task = S.tasks.get(tm.taskId);
    if (task && task.status === "open" && !hasFirst(task)) markFirst(tm.taskId, true);
  }
  /* long sessions: ask at 90 min, and if nobody answers by 2 hours, save up to the question */
  if (tm.maxMin && mins >= tm.maxMin && ready()) { stopTimer(true, tm.maxMin); return; }
  const chk = Date.parse(tm.checkAt || tm.startedAt), since = (Date.now() - chk) / 60000;
  if (since >= 120 && ready()) {
    const upTo = (chk + 90 * 60000 - Date.parse(tm.startedAt)) / 60000, saved = Object.assign({}, tm), r = stopTimer(true, upTo);
    toast("I clocked you out at " + fmtMin(r ? r.m : upTo) + ", when I asked if you were still working and got no answer.", { action: "Fix the time", ms: 20000, onAction: () => fixSession(saved) });
    return;
  }
  const ask = since >= 90;
  document.querySelectorAll("[data-ask]").forEach((e) => { e.hidden = !ask; });
  if (ask && S.askedFor !== tm.checkAt) { S.askedFor = tm.checkAt; chime("check"); }
  const fl = $("#focusLayer");
  if (fl && !fl.hidden && Date.now() - lastSky > 4000) { lastSky = Date.now(); const c = skyAt(cyc); fl.style.setProperty("--fl-top", c[0]); fl.style.setProperty("--fl-bot", c[1]); }
  document.title = "⏱ " + txt + " · Game Plan";
}

/* links he attaches to a task (a doc, a video, the rubric): shown on the do-this-now card */
const URL_RE = /^https?:\/\/\S+$/i;
function linkName(u) {
  let h = ""; try { h = new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "Link"; }
  if (/docs\.google\.com/.test(h)) return /spreadsheets/.test(u) ? "Google Sheet" : /presentation/.test(u) ? "Google Slides" : "Google Doc";
  if (/drive\.google\.com/.test(h)) return "Google Drive";
  if (/youtube\.com|youtu\.be/.test(h)) return "YouTube";
  if (/brightspace|d2l/.test(h)) return "Brightspace";
  if (/github\.com/.test(h)) return "GitHub";
  if (/claude\.ai/.test(h)) return "Claude";
  if (/sharepoint|office|onedrive/.test(h)) return "Office file";
  return h.length > 28 ? h.slice(0, 27) + "…" : h;
}
function addTaskLink(id, url, label, quiet) {
  const t = S.tasks.get(id); url = String(url || "").trim();
  if (!t || !URL_RE.test(url)) { if (!quiet) toast("That doesn't look like a link. It should start with https://"); return null; }
  const prev = (t.links || []).slice();
  if (prev.some((l) => l.url === url)) { if (!quiet) toast("That link is already on this task."); return null; }
  const l = { url, label: String(label || "").trim().slice(0, 40) || linkName(url) };
  patchTask(id, { links: prev.concat([l]).slice(-8) });
  const key = pushUndo("add link to " + t.title, [() => patchTask(id, { links: prev })]);
  if (!quiet) toast("Added " + esc(l.label) + " to " + esc(t.title) + ".", { html: true, action: "Undo", key, onAction: () => runUndo(key) });
  return key;
}
function removeTaskLink(id, i) {
  const t = S.tasks.get(id); if (!t) return;
  const prev = (t.links || []).slice(), gone = prev[i]; if (!gone) return;
  patchTask(id, { links: prev.filter((_, k) => k !== i) });
  const key = pushUndo("remove link", [() => patchTask(id, { links: prev })]);
  toast("Removed " + esc(gone.label) + ".", { html: true, action: "Undo", key, onAction: () => runUndo(key) });
}
