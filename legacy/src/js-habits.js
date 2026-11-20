/* ---------- habits: a few tracked automatically, plus his own. Each of his own is +1 pt when checked. ---------- */
const AUTO_HABITS = [
  { id: "_open", name: "Showed up", tip: "Opened Game Plan today" },
  { id: "_first", name: "First step", tip: "Did a first step or clocked any time today" },
  { id: "_focus", name: "25 min clocked", tip: "Clocked at least 25 minutes today" },
  { id: "_done", name: "Finished one", tip: "Finished at least one task today" },
];
const HABIT_IDEAS = ["Gym", "Supplements", "Up by 7", "Water", "Read 10 pages", "Bed by 11"];
const DAY_SETS = { daily: [], weekdays: [1, 2, 3, 4, 5], mwf: [1, 3, 5], tth: [2, 4], weekends: [0, 6] };
function habitList() { return Array.isArray(S.habits.list) ? S.habits.list.filter((h) => h && h.id && h.name) : []; }
let DI = { key: -1, v: null };
/* per day: minutes clocked, any first step or time, anything finished */
function dayInfo() {
  if (DI.key === S.ver) return DI.v;
  const m = new Map(), get = (k) => { let v = m.get(k); if (!v) { v = { m: 0, first: false, done: false }; m.set(k, v); } return v; };
  S.tasks.forEach((t) => (t.log || []).forEach((e) => {
    const k = dayKey(new Date(e.at));
    if (WORK[e.k]) { const v = get(k); v.m += +e.m || 0; v.first = true; }
    else if (e.k === "first") get(k).first = true;
    else if (e.k === "done" && t.status === "done") get(k).done = true;
  }));
  DI = { key: S.ver, v: m };
  return m;
}
function habitScheduled(h, d) { return !h.days || !h.days.length || h.days.indexOf(d.getDay()) >= 0; }
function habitDoneOn(h, dk, info, liveMin) {
  const v = info.get(dk) || { m: 0, first: false, done: false }, today = dk === dayKey(new Date());
  if (h.id === "_open") return (S.habits.opened || []).indexOf(dk) >= 0 || today;
  if (h.id === "_focus") return v.m + (today ? liveMin || 0 : 0) >= 25;
  if (h.id === "_first") return v.first || (today && !!liveMin);
  if (h.id === "_done") return v.done;
  return ((S.habits.log || {})[dk] || []).indexOf(h.id) >= 0;
}
function habitStreak(h, info) {
  let n = 0;
  const d = new Date(); d.setHours(12, 0, 0, 0);
  if (!habitDoneOn(h, dayKey(d), info)) d.setDate(d.getDate() - 1);
  for (let i = 0; i < 400; i++, d.setDate(d.getDate() - 1)) {
    if (!habitScheduled(h, d)) continue;
    if (habitDoneOn(h, dayKey(d), info)) n++; else break;
  }
  return n;
}
function habitBest(h, info) {
  let best = 0, run = 0;
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - 120);
  for (let i = 0; i <= 120; i++, d.setDate(d.getDate() + 1)) {
    if (!habitScheduled(h, d)) continue;
    if (habitDoneOn(h, dayKey(d), info)) { run++; best = Math.max(best, run); } else if (dayKey(d) !== dayKey(new Date())) run = 0;
  }
  return best;
}
function habitPointsByDay() {
  const out = new Map(), log = S.habits.log || {};
  Object.keys(log).forEach((k) => { const n = (log[k] || []).filter((id) => id && id[0] !== "_").length; if (n) out.set(k, n); });
  return out;
}
/* merge-writes: a day's check-ins, the list or the opened days, so two devices don't undo each other */
function saveHabits(patch) {
  S.habits = Object.assign({}, S.habits, patch, patch.log ? { log: Object.assign({}, S.habits.log, patch.log) } : {}); S.ver++; scheduleRender();
  const p = clean(patch), data = clean(S.habits);
  return enqueue("meta/habits", () => S.db.doc("meta/habits").update(p).catch((e) => { if (e && e.code === "invalid_argument") return S.db.doc("meta/habits").set(data); throw e; }));
}
function toggleHabit(id, anchor, dk) {
  dk = dk || dayKey(new Date());
  const h = habitList().find((x) => x.id === id); if (!h) return;
  const before = gardenData(), arr = ((S.habits.log || {})[dk] || []).slice(), i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
  saveHabits({ log: { [dk]: arr } });
  if (i < 0) {
    unlockAudio(); chime("coin");
    if (anchor) { floatText(anchor, "+1"); burst(anchor, true); }
    const st = habitStreak(h, dayInfo());
    toast("<b>+1 pt</b> " + esc(h.name) + " done" + (st > 1 ? " · 🔥 " + st + " in a row" : "") + "." + growLine(before), { html: true, ms: 5000 });
  }
}
function addHabit(name, days) {
  name = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) return null;
  const list = habitList(), ex = list.find((h) => h.name.toLowerCase() === name.toLowerCase());
  if (ex) return ex;
  const h = { id: rid("h"), name, days: Array.isArray(days) && days.length && days.length < 7 ? days.slice().sort() : [] };
  saveHabits({ list: list.concat([h]) });
  return h;
}
function removeHabit(id) {
  const prev = habitList(), h = prev.find((x) => x.id === id); if (!h) return;
  saveHabits({ list: prev.filter((x) => x.id !== id) });
  const key = pushUndo("remove habit " + h.name, [() => saveHabits({ list: prev })]);
  toast("Removed " + esc(h.name) + ". Past check-ins still count.", { html: true, action: "Undo", key, onAction: () => runUndo(key) });
}
function findHabit(name) { const n = String(name || "").toLowerCase().trim(); return habitList().find((h) => h.name.toLowerCase() === n) || habitList().find((h) => h.name.toLowerCase().indexOf(n) >= 0 || n.indexOf(h.name.toLowerCase()) >= 0); }
function markOpened() { if (!S.loaded.habits) return; const dk = dayKey(new Date()), op = S.habits.opened || []; if (op.indexOf(dk) >= 0) return; saveHabits({ opened: op.concat([dk]).slice(-400) }); }
function daysLabel(days) {
  if (!days || !days.length || days.length === 7) return "every day";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], s = days.slice().sort().join(",");
  if (s === "1,2,3,4,5") return "weekdays"; if (s === "0,6") return "weekends";
  return days.slice().sort().map((d) => names[d]).join(" ");
}
