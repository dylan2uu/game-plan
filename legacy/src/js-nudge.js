function taskDesc(t) {
  const lines = ["First step (2 min): " + t.firstStep];
  if (t.due) lines.push("Due: " + fmtDueLong(t.due));
  if (t.chatUrl) lines.push("Game plan chat: " + t.chatUrl);
  if (S.settings.why) lines.push("Why: " + S.settings.why);
  if (S.settings.appUrl) lines.push("Open Game Plan: " + S.settings.appUrl);
  return lines.join("\n");
}

/* ---------- nudges: one planner ranks everything, then decides who gets pinged, when, and why ---------- */
const NUDGE_RE = /^(▶ |☀ |⏰ |Start: |Keep going: |Now: |Today: |Today's first move|2 min: |Due (Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*,? \d)/;
const HOUR_PRIOR = { 9: 0.3, 10: 0.5, 11: 0.42, 12: 0.55, 13: 0.45, 14: 0.45, 15: 0.5, 16: 0.5, 17: 0.55, 18: 0.5, 19: 0.65, 20: 0.6, 21: 0.38 };
let CALS = { at: 0, ids: [] };
async function extraCalendars() {
  if (Date.now() - CALS.at < 6 * 3600000) return CALS.ids;
  try {
    const r = await calCall("list_calendars", { pageSize: 50 }, true);
    const arr = (r.payload && (r.payload.calendars || r.payload.items)) || [];
    CALS = { at: Date.now(), ids: arr.filter((c) => c && c.id && /@group\.calendar\.google\.com$/i.test(c.id) && c.id !== S.settings.bsCalendarId && !BS_NAME.test(c.summary || "")).slice(0, 4).map((c) => c.id) };
  } catch (e) { CALS = { at: Date.now(), ids: [] }; }
  return CALS.ids;
}
async function busyList(force) {
  if (!force && BUSY.at && Date.now() - BUSY.at < 10 * 60000) return BUSY.list;
  const now = new Date(), end = new Date(+now + 16 * DAY), raw = [], busy = [];
  const take = (p, mine) => {
    const arr = Array.isArray(p) ? p : (p && (p.events || p.items)) || [];
    arr.forEach((e) => {
      if (!e || e.status === "cancelled") return;
      const s = whenOf(e.start); if (!s) return;
      const en = whenOf(e.end), title = String(e.summary || "");
      const ev = { id: String(e.id || ""), title, s: +s.date, e: en ? +en.date : +s.date, allDay: !!s.allDay, created: Date.parse(e.created || "") || 0, desc: String(e.description || ""), rec: !!(e.recurringEventId || e.recurrence), free: e.transparency === "transparent" || e.availability === "AVAILABILITY_FREE" };
      if (mine) raw.push(ev);
      if (!ev.allDay && !ev.free && !NUDGE_RE.test(title) && !/^Game Plan/.test(title)) busy.push({ s: ev.s, e: Math.max(ev.e, ev.s + 15 * 60000) });
    });
  };
  let token = null;
  for (let i = 0; i < 5; i++) {
    const input = { startTime: localISO(now, true), endTime: localISO(end, true), pageSize: 250, orderBy: "startTime" };
    if (token) input.pageToken = token;
    const r = await calCall("list_events", input, true);
    take(r.payload, true);
    token = r.payload && r.payload.nextPageToken;
    if (!token) break;
  }
  for (const cid of await extraCalendars()) {
    try { const r = await calCall("list_events", { calendarId: cid, startTime: localISO(now, true), endTime: localISO(end, true), pageSize: 250, orderBy: "startTime" }, true); take(r.payload, false); }
    catch (e) { /* skip that calendar */ }
  }
  BUSY = { at: Date.now(), list: mergeIv(busy), raw };
  return BUSY.list;
}
/* the times of day his nudges actually work, learned from history (starts within 2 hours), blended with sensible defaults */
function hourRates() {
  const sent = {}, hit = {}, now = Date.now();
  S.tasks.forEach((t) => (t.nudges || []).forEach((n) => {
    const at = Date.parse(n.at); if (!(at < now - 2 * 3600000) || at < now - 30 * DAY) return;
    const h = new Date(at).getHours(); sent[h] = (sent[h] || 0) + 1;
    if (nudgeResult(t, n).fast) hit[h] = (hit[h] || 0) + 1;
  }));
  const out = {};
  for (let h = 9; h <= 21; h++) out[h] = ((hit[h] || 0) + (HOUR_PRIOR[h] || 0.4) * 2) / ((sent[h] || 0) + 2);
  return out;
}
function slotOk(x, from, to, busy, used, mine) {
  if (x < from || x > to) return false;
  const d = new Date(x), h = d.getHours();
  if (h < 9 || h > 21 || (h === 21 && d.getMinutes() > 30)) return false;
  if (busy.some((b) => x >= b.s - 10 * 60000 && x < b.e + 5 * 60000)) return false;
  if (used.some((u) => Math.abs(u - x) < 60 * 60000)) return false;
  if (mine.some((u) => Math.abs(u - x) < 150 * 60000)) return false;
  return true;
}
function bestSlot(day, from, to, busy, used, mine, rates) {
  let best = null, bs = -1;
  for (let m = 9 * 60; m <= 21 * 60 + 30; m += 30) {
    const x = +hmDate(day, Math.floor(m / 60), m % 60);
    if (!slotOk(x, from, to, busy, used, mine)) continue;
    let sc = rates[Math.floor(m / 60)] || 0.4;
    if (busy.some((b) => x - b.e >= 0 && x - b.e <= 35 * 60000)) sc += 0.08; // right after class or work
    if (sc > bs) { bs = sc; best = x; }
  }
  return best;
}
/* urgent: up to 3 a day, start-today: 1, plenty of time: none. Pings already sent today count. Stop once he starts.
   Never more than the daily cap, an hour apart, and a task he keeps ignoring drops to 1 a day. */
const chatSig = (t) => fnv((t.chatUrl || "") + "|" + (t.firstStep || "") + "|" + (t.bsUrl || ""));
function planWanted() {
  const out = [], now = Date.now(), tk = dayKey(new Date());
  if (S.settings.nudges === false) return out;
  const cap = Math.max(1, Math.min(10, +S.settings.nudgeCap || 5)), rates = hourRates(), busy = busyAll(), open = openTasks();
  const existing = new Map(), sent = new Map(), sentAll = [];
  S.tasks.forEach((t) => (t.nudges || []).forEach((n) => {
    const at = n && Date.parse(n.at);
    if (!(at <= now) || dayKey(new Date(at)) !== tk) return;
    sentAll.push(at);
    if (t.status === "open") { const a = sent.get(t.id) || []; a.push({ at, kind: n.kind }); sent.set(t.id, a); }
  }));
  open.forEach((t) => existing.set(t.id, upcomingNudges(t).map((n) => Date.parse(n.at))));
  for (let di = 0; di < 7; di++) {
    const day = new Date(now); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + di);
    const dk = dayKey(day), today = di === 0;
    const from = Math.max(now + 10 * 60000, +hmDate(day, 9, 0)), to = +hmDate(day, 21, 30);
    if (to <= from) continue;
    const ref = today ? now : +hmDate(day, 8, 0), used = today ? sentAll.slice() : [];
    let count = 0;
    const items = open.map((t) => ({ t, a: assess(t, ref) })).sort((x, y) => y.a.score - x.a.score);
    items.forEach((x) => {
      const plan = parseLocal(x.t.planAt); if (!plan || dayKey(plan) !== dk) return;
      const at = +plan - 5 * 60000; if (at < now + 3 * 60000) return;
      if (today && (startedOn(x.t, dk) || x.t.quietDay === dk)) return;
      used.push(at); count++;
      out.push({ tid: x.t.id, at, day: dk, kind: "plan", tier: "plan", why: "You planned to start this at " + fmtTime(plan) + ". " + x.a.why, short: "you planned " + fmtTime(plan), hrs: x.a.hrs, c: chatSig(x.t) });
    });
    // a day that's already half over gets a smaller share of the cap, minus what already went out today
    const dayCap = today ? Math.max(0, Math.min(Math.max(1, Math.round(cap * Math.min(1, (to - from) / (12.5 * 3600000)))), cap - sentAll.length)) : cap;
    const asks = [];
    for (const x of items) {
      const t = x.t, a = x.a;
      if (today && t.quietDay === dk) continue;
      const sentT = today ? sent.get(t.id) || [] : [];
      let total = a.tier === "red" ? 3 : a.tier === "yellow" ? 1 : 0, got = sentT.length, start = from, kind = "nudge";
      if (a.hrs != null && a.hrs < 0) total = today ? 2 : 1;
      else if (!today && a.tier === "red" && a.hrs > 30) total = 2;
      if (t.source === "brightspace" && a.hrs != null && a.hrs > 240) total = 0;
      const stale = missedStreak(t) >= 3;
      if (stale) total = Math.min(total, 1);
      if (today && startedOn(t, dk)) {
        if (a.tier === "red" && a.left > 45 && sentT.length < 3 && !sentT.some((n) => n.kind === "keep")) { total = 1; got = 0; kind = "keep"; start = Math.max(from, lastWorkAt(t) + 3 * 3600000); }
        else total = 0;
      }
      const planned = out.filter((o) => o.tid === t.id && o.day === dk).map((o) => o.at);
      got += planned.length;
      const latest = a.due && +a.due > now ? Math.min(to, +a.due - 45 * 60000) : to;
      if (got >= total || latest < start) continue;
      // something he's let slide 3 times in a row waits until fresher urgent work has its pings
      asks.push({ t, a, tier: stale && kind === "nudge" ? "yellow" : a.tier, total, got, start, latest, kind, mine: planned.concat(sentT.map((n) => n.at)), prev: (existing.get(t.id) || []).filter((v) => dayKey(new Date(v)) === dk) });
    }
    // urgent things get their first two pings, then each start-today thing gets one, then urgent ones get a third
    for (const [tier, round] of [["red", 0], ["red", 1], ["yellow", 0], ["red", 2]]) {
      for (const q of asks) {
        if (count >= dayCap) break;
        if (q.tier !== tier || q.got !== round || q.got >= q.total || q.done) continue;
        let at = null;
        for (const v of q.prev) { if (q.mine.indexOf(v) < 0 && slotOk(v, q.start, q.latest, busy, used, q.mine)) { at = v; break; } }
        if (at == null) at = bestSlot(day, q.start, q.latest, busy, used, q.mine, rates);
        if (at == null) { q.done = true; continue; }
        q.got++; count++; used.push(at); q.mine.push(at);
        out.push({ tid: q.t.id, at, day: dk, kind: q.kind, tier: q.a.tier, why: q.a.why, short: q.a.short, hrs: q.a.hrs, first: !hasFirst(q.t), c: chatSig(q.t) });
      }
    }
  }
  const groups = {};
  out.forEach((w) => { const k = w.tid + "|" + w.day; (groups[k] = groups[k] || []).push(w); });
  Object.keys(groups).forEach((k) => {
    const arr = groups[k].sort((x, y) => x.at - y.at), base = arr[0].day === tk ? (sent.get(arr[0].tid) || []).length : 0;
    arr.forEach((w, i) => { w.n = base + i + 1; w.of = base + arr.length; w.last = w.kind === "nudge" && w.tier === "red" && w.of >= 2 && w.n === w.of && w.hrs != null && w.hrs < 30; });
  });
  return out;
}
function clip(s, n) {
  s = String(s || "");
  if (s.length <= n) return s;
  let cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  if (sp > n * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s,.;:–-]+$/, "") + "…";
}
function nudgeTitle(t, w) {
  const name = clip(t.title, 48);
  if (w.kind === "plan") return "▶ Planned: " + name + " · start now";
  if (w.kind === "keep") return "▶ Keep going: " + name + " · " + w.short;
  if (w.last) return "⏰ Last call today: " + name + " · " + w.short;
  if (w.first) return "▶ 2 min: " + clip(t.firstStep, 56) + " (" + clip(t.title, 28) + ")";
  return "▶ " + name + " · " + w.short;
}
function nudgeDesc(t, w) {
  const L = [];
  if (t.chatUrl) L.push("Pick up where you left off: " + t.chatUrl, "");
  if (t.bsUrl) L.push(bsLabel(t.bsUrl) + ": " + t.bsUrl, "");
  L.push("Why now: " + w.why, "First step (2 min): " + t.firstStep);
  if (t.due) L.push("Due: " + fmtDueLong(t.due));
  if (w.of > 1) L.push("Nudge " + w.n + " of " + w.of + " for this today. They stop once you start.");
  L.push("Clock in and every 10 minutes is a point; 25 minutes grows a plant.");
  if (S.settings.appUrl) L.push("", "Open Game Plan and hit Start: " + S.settings.appUrl);
  L.push("(Game Plan nudge)");
  return L.join("\n");
}
/* only one open copy of the app plans at a time, so nothing gets made twice */
async function getLease() {
  const ref = S.db.doc("meta/lock");
  if (typeof ref.acquire === "function") {
    try { const r = await ref.acquire({ holder: INSTANCE, ttlMs: 150000 }); return !!(r && r.acquired); } catch (e) { return false; }
  }
  try {
    const cur = await ref.get(), d = cur.exists ? cur.data() : null;
    if (d && d.holder !== INSTANCE && Date.now() - Date.parse(d.at || 0) < 150000) return false;
    await ref.set({ holder: INSTANCE, at: new Date().toISOString() });
    await sleep(1500);
    const again = await ref.get();
    return !!(again.exists && again.data().holder === INSTANCE);
  } catch (e) { return false; }
}
function schedulePlan(ms) { clearTimeout(S.planTimer); S.planTimer = setTimeout(runPlanner, ms == null ? 4000 : ms); }
function planSoon() { schedulePlan(4000); }
function noteCalIssue(e) {
  S.calStatus = { ok: false, msg: calMsg(e) };
  if (!S.calWarned) { S.calWarned = true; toast("Phone nudges paused: " + calMsg(e)); }
  scheduleRender();
}
async function runPlanner() {
  if (!S.mcp || !S.db || !ready()) return;
  if (S.planning) { S.planAgain = true; return; }
  S.planning = true;
  try {
    if (!(await getLease())) { S.leader = false; schedulePlan(160000); return; }
    S.leader = true;
    try { await busyList(); } catch (e) { noteCalIssue(e); return; }
    const want = planWanted(), now = Date.now(), byTask = new Map();
    want.forEach((w) => { const a = byTask.get(w.tid) || []; a.push(w); byTask.set(w.tid, a); });
    let lease = Date.now(), changed = false;
    const gone = new Set();
    for (const id of Array.from(S.tasks.keys())) {
      const t = S.tasks.get(id); if (!t) continue;
      const cur = (t.nudges || []).filter((n) => n && n.at);
      const past = cur.filter((n) => Date.parse(n.at) <= now), future = cur.filter((n) => Date.parse(n.at) > now);
      const wanted = (byTask.get(id) || []).map((w) => Object.assign({}, w, { title: nudgeTitle(t, w) }));
      const keep = [], drop = [];
      future.forEach((n) => {
        const m = wanted.find((w) => !w.taken && Math.abs(w.at - Date.parse(n.at)) < 60000 && w.title === n.title && (n.c || "") === (w.c || ""));
        if (m) { m.taken = true; keep.push(Object.assign({}, n, { why: m.why, tier: m.tier, n: m.n, of: m.of, kind: m.kind })); } else drop.push(n);
      });
      const legacy = t.nudge && t.nudge.id && Date.parse(t.nudge.at) > now ? [t.nudge] : [];
      const add = wanted.filter((w) => !w.taken);
      if (!drop.length && !add.length && !legacy.length) continue;
      changed = true;
      for (const n of drop.concat(legacy)) {
        if (!n.id) continue;
        gone.add(n.id);
        try { await calCall("delete_event", { eventId: n.id }, false); }
        catch (e) { if (!(e && e.code === "tool_error")) { noteCalIssue(e); return; } }
      }
      const made = [];
      for (const w of add) {
        try {
          const r = await createEvent(w.title, new Date(w.at), 10, nudgeDesc(S.tasks.get(id) || t, w), null, true);
          made.push({ id: evId(r.payload), at: new Date(w.at).toISOString(), day: w.day, kind: w.kind, tier: w.tier, why: w.why, title: w.title, n: w.n, of: w.of, c: w.c });
          S.calStatus = { ok: true };
        } catch (e) { noteCalIssue(e); break; }
        if (Date.now() - lease > 60000) { lease = Date.now(); await getLease(); }
      }
      if (S.tasks.has(id)) patchTask(id, { nudges: past.slice(-40).concat(keep, made), nudge: null });
    }
    await syncDigest();
    await sweepOrphans(gone);
    if (changed) { S.gcal = {}; BUSY.at = 0; }
    S.lastPlan = Date.now();
  } catch (e) { /* tries again on the next pass */ }
  finally {
    S.planning = false; scheduleRender();
    if (S.planAgain) { S.planAgain = false; schedulePlan(3000); }
  }
}
/* 8 AM: today's lineup in one ping */
async function syncDigest() {
  const cur = S.settings.digest || null, now = new Date(), when = new Date(now);
  if (now.getHours() >= 8) when.setDate(when.getDate() + 1);
  when.setHours(8, 0, 0, 0);
  const ref = +when, dk = dayKey(when);
  const ranked = openTasks().map((t) => ({ t, a: assess(t, ref) })).filter((x) => x.a.tier !== "green").sort((x, y) => y.a.score - x.a.score);
  const wantIt = S.settings.nudges !== false && ranked.length > 0;
  let title = "", desc = "";
  if (wantIt) {
    const top = ranked[0];
    title = "☀ Today: " + (top.t.title.length > 50 ? top.t.title.slice(0, 49) + "…" : top.t.title) + " first" + (ranked.length > 1 ? " · " + ranked.length + " in your lineup" : "");
    const L = ["Start with: " + top.t.title, "Why: " + top.a.why, "First step (2 min): " + top.t.firstStep, "", "Today's lineup:"];
    ranked.slice(0, 6).forEach((x, i) => L.push(i + 1 + ". " + x.t.title + " (" + x.a.short + ")"));
    const hb = habitList().filter((h) => habitScheduled(h, when)).map((h) => h.name);
    if (hb.length) L.push("", "Habits today: " + hb.join(", "));
    if (S.settings.why) L.push("", "Your why: " + S.settings.why);
    if (S.settings.appUrl) L.push("", "Open Game Plan: " + S.settings.appUrl);
    L.push("(Game Plan nudge)");
    desc = L.join("\n");
  }
  const sig = title + "|" + desc;
  if (cur && cur.day === dk && cur.sig === sig) return;
  if (cur && cur.id && Date.parse(cur.at) > Date.now()) {
    try { await calCall("delete_event", { eventId: cur.id }, false); } catch (e) { if (!(e && e.code === "tool_error")) return; }
  }
  if (!wantIt) { if (cur) saveSettings({ digest: null }); return; }
  try {
    const r = await createEvent(title.slice(0, 140), when, 10, desc, null, true);
    saveSettings({ digest: { id: evId(r.payload), day: dk, sig, at: when.toISOString() } });
  } catch (e) { noteCalIssue(e); }
}
/* clean up nudge events nothing tracks anymore (doubles from two open copies, leftovers of finished tasks) */
async function sweepOrphans(gone) {
  const now = Date.now(), tracked = new Set(), s = S.settings;
  S.tasks.forEach((t) => {
    (t.nudges || []).forEach((n) => { if (n && n.id) tracked.add(n.id); });
    (t.reminders || []).forEach((r) => { if (r && r.id) tracked.add(r.id); });
    if (t.nudge && t.nudge.id) tracked.add(t.nudge.id);
  });
  if (s.digest && s.digest.id) tracked.add(s.digest.id);
  if (s.checkin && s.checkin.id) tracked.add(s.checkin.id);
  (s.anchors || []).forEach((a) => { if (a && a.id) tracked.add(a.id); });
  const orphans = (BUSY.raw || []).filter((e) => e.s > now && !e.rec && NUDGE_RE.test(e.title) && /Game Plan/.test(e.desc) && e.created && now - e.created > 3 * 60000 && !tracked.has(e.id) && !(gone && gone.has(e.id)));
  for (const e of orphans.slice(0, 40)) { try { await calCall("delete_event", { eventId: e.id }, false); } catch (x) { /* already gone */ } }
  if (orphans.length) { BUSY.raw = BUSY.raw.filter((e) => orphans.indexOf(e) < 0); S.gcal = {}; }
}
function setNudges(on) {
  saveSettings({ nudges: on });
  planSoon();
  toast(on ? "Smart nudges on. Urgent things get up to 3 pings a day, start-today things get 1." : "Nudges off. The planner clears the ones it made.");
}
const DAYMAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function parseDays(x) {
  if (Array.isArray(x)) return Array.from(new Set(x.map((d) => DAYMAP[String(d).slice(0, 3).toLowerCase()]).filter((n) => n != null))).sort();
  const s = String(x || "").toLowerCase();
  if (/weekday/.test(s)) return [1, 2, 3, 4, 5];
  if (/every ?day|daily/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  return Array.from(new Set((s.match(/sun|mon|tue|wed|thu|fri|sat/g) || []).map((d) => DAYMAP[d]))).sort();
}
function normHM(x) { const m = /^(\d{1,2}):?(\d{2})?$/.exec(String(x || "").trim()); if (!m) return null; const h = +m[1], mi = +(m[2] || 0); return h < 24 && mi < 60 ? pad(h) + ":" + pad(mi) : null; }
function blockText(b) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], d = new Date();
  const days = b.days.length === 5 && [1, 2, 3, 4, 5].every((x) => b.days.indexOf(x) >= 0) ? "Weekdays" : b.days.length === 7 ? "Every day" : b.days.map((x) => names[x]).join(" ");
  const s = parseHM(d, b.start), e = parseHM(d, b.end);
  return days + " " + (s ? fmtTime(s) : b.start) + "–" + (e ? fmtTime(e) : b.end);
}
