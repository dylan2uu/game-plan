/* ---------- interactions ---------- */
function fillBar(text) { const b = $("#barInput"); b.value = text; autoGrow(); syncSend(); b.focus(); try { b.setSelectionRange(b.value.length, b.value.length); } catch (e) { /* ignore */ } }
function clearBoard() {
  S.confirmClear = false;
  if (S.timer) setTimerDoc(null);
  const gd = gardenData(), all = Array.from(S.tasks.values()), now = Date.now();
  const evIds = [];
  all.forEach((t) => (t.nudges || []).concat(t.reminders || [], t.nudge ? [t.nudge] : []).forEach((n) => { if (n && n.id && Date.parse(n.at) > now) evIds.push(n.id); }));
  saveSettings({ lastCheckin: null, bank: { pts: Math.round(gd.pts * 10) / 10, plants: gd.plants.slice(-60) } });
  all.forEach((t) => deleteTaskDoc(t.id));
  if (S.mcp) (async () => { for (const id of evIds) { try { await calCall("delete_event", { eventId: id }, false); } catch (e) { /* gone */ } } planSoon(); })();
  S.chat = []; saveChat(); S.undo.clear(); S.hist = []; S.undoLabel.clear(); syncUndo(); S.skipIds.clear();
  S.settingsOpen = false; S.sheetTask = null; scheduleRender();
  toast("Board cleared. Your garden stays.");
}
const acts = {
  opensettings() { S.sheetTask = null; S.settingsOpen = true; render(); const c = $("#closeSheet"); if (c) c.focus(); },
  closesettings() { S.settingsOpen = false; S.confirmClear = false; render(); const g = $("#gearBtn"); if (g) g.focus(); },
  closesheet() { S.sheetTask = null; S.settingsOpen = false; render(); },
  opentask(el, id) {
    if (!id || !S.tasks.has(id)) return;
    S.settingsOpen = false; S.sheetTask = id; S.focusLink = el && el.dataset && el.dataset.focus === "link";
    render(); if (!S.focusLink) { const c = $("#closeSheet"); if (c) c.focus({ preventScroll: true }); }
  },
  /* Start: clocks in and opens the task's Claude chat (the link does the opening) */
  start(el, id) {
    const t = S.tasks.get(id); if (!t || t.status !== "open") return;
    if (!t.chatUrl) copyText(gamePlanPrompt(t)).then((ok) => { if (ok) toast("Task copied too, in case Claude's box is empty. Once that chat opens, copy its link and paste it in the timer so Start reopens it next time.", { ms: 9000 }); });
    S.sheetTask = null;
    if (!(S.timer && S.timer.taskId === id)) startFocus(id);
    else { S.focusOpen = true; S.flSig = null; scheduleRender(); }
  },
  /* the ▶ on a row: just the timer */
  clockin(el, id) { const t = S.tasks.get(id); if (!t || t.status !== "open") return; S.sheetTask = null; chooseTask(id); startFocus(id); },
  /* tapping a task makes it the one to do now */
  pick(el, id) { const t = S.tasks.get(id); if (!t || t.status !== "open") return; chooseTask(id); S.editLink = null; scheduleRender(); const h = $("#hero"); if (h) h.scrollIntoView({ behavior: "smooth", block: "start" }); },
  editlink(el, id) { S.editLink = S.editLink === id ? null : id; scheduleRender(); if (S.editLink) setTimeout(() => { const i = document.getElementById("hl-" + id); if (i) i.focus(); }, 60); },
  qstart(el) { const id = el.dataset.tid, t = S.tasks.get(id); if (!t || t.status !== "open") return; chooseTask(id); acts.start(el, id); },
  openplan(el, id) { const t = S.tasks.get(id || (S.timer && S.timer.taskId)); if (t && !t.chatUrl) copyText(gamePlanPrompt(t)); },
  stoptimer() { S.adjust = false; stopTimer(true); },
  stillhere() { stillHere(); chime("tap"); toast("Got it. Keep going."); },
  adjust() { S.adjust = true; S.focusOpen = true; S.flSig = null; scheduleRender(); setTimeout(() => { const i = $("#adjMin"); if (i) { i.focus(); i.select(); } }, 60); },
  adjustno() { S.adjust = false; S.flSig = null; scheduleRender(); },
  minfocus() { S.focusOpen = false; S.adjust = false; renderFocusLayer(); scheduleRender(); },
  maxfocus() { S.focusOpen = true; S.flSig = null; scheduleRender(); },
  async pastelink(el, id) {
    const f = el.closest("form"), inp = f && f.querySelector("input");
    let txt = "";
    try { txt = String((await navigator.clipboard.readText()) || "").trim(); } catch (e) { txt = ""; }
    if (txt && CHAT_RE.test(txt)) { if (setChatLink(id, txt)) { if (f) f.reset(); } return; }
    if (inp) { inp.focus(); if (txt) inp.value = txt; }
    let touch = false; try { touch = matchMedia("(pointer: coarse)").matches; } catch (e) { /* old browser */ }
    toast(txt ? "That isn't a Claude chat link. Copy the link from the chat's address bar (or Share, Copy link)." : touch ? "Tap and hold the box, then Paste the chat's link." : "Press Ctrl+V (⌘V on a Mac) to paste the chat's link here.");
  },
  unlink(el, id) {
    const t = S.tasks.get(id); if (!t || !t.chatUrl) return;
    const prev = t.chatUrl; patchTask(id, { chatUrl: null }); planSoon();
    const key = pushUndo("forget chat link", [() => { patchTask(id, { chatUrl: prev }); planSoon(); }]);
    toast("Forgot that chat. Start opens a new game plan chat now.", { action: "Undo", key, onAction: () => runUndo(key) });
  },
  plan(el, id) { const at = +el.dataset.at || null; planFor(id, at); },
  quiet(el, id) {
    const t = S.tasks.get(id); if (!t) return;
    const prev = t.quietDay || null, tk = dayKey(new Date());
    patchTask(id, { quietDay: tk }); S.skipIds.add(id); planSoon();
    const key = pushUndo("quiet " + t.title, [() => { patchTask(id, { quietDay: prev }); S.skipIds.delete(id); planSoon(); }]);
    toast("No more pings for " + esc(t.title) + " today. It's back tomorrow.", { html: true, action: "Undo", key, onAction: () => runUndo(key) });
  },
  shrink(el, id) { el.disabled = true; el.textContent = "Thinking…"; shrinkStep(id); },
  habit(el) { toggleHabit(el.dataset.hid, el); },
  habitadd() { S.habitAdd = !S.habitAdd; scheduleRender(); if (S.habitAdd) setTimeout(() => { const i = $("#habitName"); if (i) i.focus(); }, 60); },
  habitcancel() { S.habitAdd = false; scheduleRender(); },
  habitidea(el) { const h = addHabit(el.dataset.name, []); S.habitAdd = false; if (h) toast("Added " + esc(h.name) + ". Tap it on the days you do it, +1 pt each.", { html: true }); },
  habitdel(el) { removeHabit(el.dataset.hid); },
  dfilter(el) { S.progCourse = el.dataset.course || null; S.progAll = false; scheduleRender(); },
  dall() { S.progAll = !S.progAll; scheduleRender(); },
  complete(el, id) { const tid = id || (S.timer && S.timer.taskId); if (!tid) return; if (S.sheetTask === tid) S.sheetTask = null; completeTask(tid, el, false); scheduleRender(); },
  reopen(el, id) { reopenTask(id); scheduleRender(); },
  first(el, id) { markFirst(id, false, el); },
  choose(el, id) { chooseTask(id); S.sheetTask = null; S.view = "today"; store.set("gp.view", "today"); scheduleRender(); window.scrollTo({ top: 0, behavior: "smooth" }); },
  skip(el, id) { skipTask(id); },
  deltask(el, id) {
    const t = S.tasks.get(id); if (!t) return;
    const prev = t.status; dismissTask(id); S.sheetTask = null;
    const key = pushUndo("delete " + t.title, [() => { patchTask(id, { status: prev }); planSoon(); }]);
    toast("Deleted " + esc(t.title) + ".", { html: true, action: "Undo", key, onAction: () => runUndo(key) });
    scheduleRender();
  },
  delbusy(el) { const i = +el.dataset.i, prev = (S.settings.busy || []).slice(); saveSettings({ busy: prev.filter((_, k) => k !== i) }); planSoon(); },
  feedall() { S.feedAll = !S.feedAll; scheduleRender(); },
  qfill(el) { fillBar(el.dataset.text || ""); },
  undo(el) { runUndo(el.dataset.key); },
  undolast() { const k = S.hist[S.hist.length - 1]; if (k) runUndo(k); else toast("Nothing to undo."); },
  chatmin() { S.chatMin = !S.chatMin; store.set("gp.chatMin", S.chatMin); scheduleRender(); },
  helper(el, id) { const tid = id || (S.timer && S.timer.taskId); if (tid) makeHelper(tid); },
  staleall() { S.staleAll = !S.staleAll; scheduleRender(); },
  stalekeep(el, id) {
    const t = S.tasks.get(id); if (!t) return;
    const prev = t.due, d = new Date(); d.setDate(d.getDate() + 1); const due = dayKey(d) + "T23:59";
    patchTask(id, { due }); planSoon();
    const key = pushUndo("new date for " + t.title, [() => { patchTask(id, { due: prev }); planSoon(); }]);
    toast(esc(t.title) + " is now due tomorrow.", { html: true, action: "Undo", key, onAction: () => runUndo(key) });
  },
  staledrop(el, id) {
    const t = S.tasks.get(id); if (!t) return;
    const prev = t.status; dismissTask(id);
    const key = pushUndo("drop " + t.title, [() => { patchTask(id, { status: prev }); planSoon(); }]);
    toast("Dropped " + esc(t.title) + ". Its nudges stop.", { html: true, action: "Undo", key, onAction: () => runUndo(key) });
  },
  addlink(el, id) { S.addLink = S.addLink === id ? null : id; scheduleRender(); if (S.addLink) setTimeout(() => { const i = document.getElementById("tl-" + id); if (i) i.focus(); }, 60); },
  dellink(el, id) { removeTaskLink(id, +el.dataset.i); },
  showall() { S.showAll = !S.showAll; scheduleRender(); },
  fold(el) { const k = el.dataset.sec, open = el.getAttribute("aria-expanded") === "true"; S.folds = Object.assign({}, S.folds, { [k]: !open }); store.set("gp.folds", S.folds); scheduleRender(); },
  sync() { syncGoogle(false); },
  detect() { detectBrightspace(true); },
  opengcal() { S.connecting = true; },
  copyfeed() { copyText(S.settings.bsFeedUrl || "").then((ok) => toast(ok ? "Copied. Now open Google Calendar." : "Couldn't copy. Grab the link from Brightspace instead.")); },
  disconnect() { saveSettings({ bsCalendarId: null, bsCalendarName: "", lastSync: null }); toast("Brightspace disconnected."); },
  clearask() { S.confirmClear = true; scheduleRender(); },
  clearno() { S.confirmClear = false; scheduleRender(); },
  clearyes() { clearBoard(); },
  setview(el) {
    const v = el.dataset.view; S.view = VIEWS.indexOf(v) >= 0 ? v : "today"; store.set("gp.view", S.view); S.habitAdd = false; scheduleRender();
    if (el.closest(".gstrip")) window.scrollTo({ top: 0, behavior: "smooth" });
  },
  calday(el) {
    const k = el.dataset.day, d = parseLocal(k); if (!d) return;
    S.calSel = k;
    if (d.getMonth() !== S.calMonth.getMonth() || d.getFullYear() !== S.calMonth.getFullYear()) S.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    scheduleRender();
  },
  calprev() { shiftMonth(-1); },
  calnext() { shiftMonth(1); },
  caltoday() { const n = new Date(); S.calMonth = new Date(n.getFullYear(), n.getMonth(), 1); S.calSel = dayKey(n); scheduleRender(); },
  calreload() { loadMonthEvents(true); },
};
const forms = {
  link(f, id) {
    const url = String(new FormData(f).get("url") || "").trim();
    if (!url) { toast("Paste the chat's link first."); return; }
    if (setChatLink(id, url)) { f.reset(); S.editLink = null; }
  },
  tasklink(f, id) {
    const url = String(new FormData(f).get("url") || "").trim();
    if (addTaskLink(id, url)) { f.reset(); S.addLink = null; scheduleRender(); }
  },
  adjust(f) {
    const m = Math.round(+new FormData(f).get("m") || 0);
    if (!(m >= 1)) { toast("Type how many minutes you worked."); return; }
    S.adjust = false; stopTimer(true, m);
  },
  habit(f) {
    const fd = new FormData(f), name = String(fd.get("name") || "").trim();
    if (!name) { toast("Name the habit first, like Gym."); return; }
    const h = addHabit(name, DAY_SETS[String(fd.get("days") || "daily")] || []);
    S.habitAdd = false;
    if (h) toast("Added " + esc(h.name) + " (" + esc(daysLabel(h.days)) + "). Tap it when you do it, +1 pt.", { html: true });
  },
  why(f) { saveSettings({ why: String(new FormData(f).get("why") || "").trim().slice(0, 240) }); toast("Saved."); },
  prefs(f) {
    const fd = new FormData(f);
    saveSettings({ dailyTarget: Math.max(1, Math.min(60, Math.round(+fd.get("dailyTarget") || 10))) });
    planSoon(); toast("Saved.");
  },
};
document.addEventListener("click", (e) => {
  const tp = $("#tip"); if (tp) tp.hidden = true;
  if (e.target.id === "sheet") { if (S.sheetTask) acts.closesheet(); else acts.closesettings(); return; }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const fn = acts[el.dataset.act]; if (!fn) return;
  if (el.tagName === "BUTTON" && el.type === "submit") e.preventDefault();
  const host = el.closest("[data-id]");
  fn(el, host ? host.dataset.id : null, e);
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "bar") { e.preventDefault(); send($("#barInput").value); return; }
  const f = e.target.closest("form[data-form]"); if (!f) return;
  e.preventDefault();
  const host = f.closest("[data-id]");
  const fn = forms[f.dataset.form]; if (fn) fn(f, host ? host.dataset.id : null);
});
document.addEventListener("input", (e) => {
  const el = e.target, f = el && el.closest ? el.closest('form[data-form="link"]') : null;
  if (!f) return;
  const v = String(el.value || "").trim(), host = f.closest("[data-id]");
  if (host && CHAT_RE.test(v) && setChatLink(host.dataset.id, v)) { f.reset(); S.editLink = null; scheduleRender(); }
});
document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "icsFile") { importIcsFile(e.target.files && e.target.files[0]); e.target.value = ""; }
  else if (id === "nudgeToggle") setNudges(!!e.target.checked);
  else if (id === "capSel") { saveSettings({ nudgeCap: +e.target.value || 5 }); planSoon(); toast("Up to " + (+e.target.value || 5) + " nudges a day."); }
  else if (id === "anchorToggle") { if (e.target.checked) addAnchors(); else removeAnchors(); }
  else if (id === "soundToggle") { store.set("gp.sound", !!e.target.checked); if (e.target.checked) { unlockAudio(); chime("start"); } }
  else if (id === "checkinSel") { const v = e.target.value || null; setCheckin(v).then((r) => toast(r.chip.text + (r.chip.k === "warn" ? "" : "."))); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (S.adjust) { acts.adjustno(); return; }
    if (S.habitAdd) { acts.habitcancel(); return; }
    if (S.settingsOpen) { acts.closesettings(); return; }
    if (S.sheetTask) { acts.closesheet(); return; }
    if (S.timer && S.focusOpen) { acts.minfocus(); return; }
  }
  if ((e.key === "Enter" || e.key === " ") && e.target && e.target.classList && e.target.classList.contains("bell")) { e.preventDefault(); e.target.click(); return; }
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (String(e.key || "").toLowerCase() === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !/INPUT|TEXTAREA|SELECT/.test(tag) && S.hist.length) { e.preventDefault(); acts.undolast(); return; }
  if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && !/INPUT|TEXTAREA|SELECT/.test(tag) && ready() && !S.focusOpen) { e.preventDefault(); $("#barInput").focus(); }
});
document.addEventListener("pointerdown", unlockAudio, { once: true });
function autoGrow() { const a = $("#barInput"); a.style.height = "auto"; a.style.height = Math.min(a.scrollHeight, 220) + "px"; }
$("#barInput").addEventListener("input", () => { autoGrow(); syncSend(); });
$("#barInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(e.target.value); } });
function showTip(el) {
  const tip = $("#tip"); tip.textContent = el.dataset.tip; tip.hidden = false;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  tip.style.top = (r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8) + "px";
}
const hideTip = () => { $("#tip").hidden = true; };
document.addEventListener("pointerover", (e) => { if (e.pointerType && e.pointerType !== "mouse") return; const el = e.target.closest && e.target.closest("[data-tip]"); if (el) showTip(el); });
document.addEventListener("pointerout", (e) => { if (e.target.closest && e.target.closest("[data-tip]")) hideTip(); });
document.addEventListener("focusin", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el && el.matches(":focus-visible")) showTip(el); });
document.addEventListener("focusout", (e) => { if (e.target.closest && e.target.closest("[data-tip]")) hideTip(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (S.connecting && !S.settings.bsCalendarId) detectBrightspace(false);
  S.autoSynced = false; maybeAutoSync(); markOpened(); setTimeout(maybeDailyCheckin, 4000); schedulePlan(6000); scheduleRender();
});
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { S.flSig = null; scheduleRender(); }); } catch (e) { /* old browser */ }
window.addEventListener("resize", () => { clearTimeout(S.rsz); S.rsz = setTimeout(() => { if (isWide() && S.focusOpen && S.timer && !S.adjust) S.focusOpen = false; S.flSig = null; scheduleRender(); }, 200); });
setInterval(tick, 500);
setInterval(scheduleRender, 60000);
setInterval(() => schedulePlan(0), 20 * 60000);

/* ---------- boot ---------- */
function use(name) {
  try { return window.claude && typeof window.claude.use === "function" ? Promise.resolve(window.claude.use(name)).catch(() => null) : Promise.resolve(null); }
  catch (e) { return Promise.resolve(null); }
}
function dbReadErr(e) { toast(e && e.code === "revoked" ? "Access to this page changed. Reload it." : "Lost the live connection. Reload if things look stale."); }
function afterLoad() { if (ready()) { maybeAutoSync(); maybeDailyCheckin(); schedulePlan(2500); } scheduleRender(); }
async function boot() {
  render();
  const res = await Promise.all([use("db"), use("user")]);
  const db = res[0], user = res[1];
  if (!db) { S.noDb = true; render(); return; }
  if (user && typeof user.isOwner === "function") { try { if ((await user.isOwner()) === false) { S.notOwner = true; render(); return; } } catch (e) { /* unknown: carry on */ } }
  S.db = db;
  db.collection("tasks").onSnapshot((snap) => {
    const m = new Map(); snap.docs.forEach((d) => { if (d.exists) m.set(d.id, Object.assign({}, d.data(), { id: d.id })); });
    S.tasks = m; S.ver++;
    const first = !S.loaded.tasks; S.loaded.tasks = true;
    if (first) afterLoad(); else { scheduleRender(); if (S.leader) planSoon(); }
  }, dbReadErr);
  db.doc("meta/settings").onSnapshot((d) => {
    S.settings = Object.assign({}, DEFAULTS, d.exists ? d.data() : {}); if (!S.settings.appUrl) S.settings.appUrl = APP_LINK; S.ver++; const first = !S.loaded.settings; S.loaded.settings = true; if (first) afterLoad(); else scheduleRender();
  }, dbReadErr);
  db.doc("meta/chat").onSnapshot((d) => {
    const data = d.exists ? d.data() : null; S.chat = data && Array.isArray(data.msgs) ? data.msgs.map((m) => Object.assign({}, m)) : [];
    const first = !S.loaded.chat; S.loaded.chat = true; if (first) afterLoad(); else scheduleRender();
  }, dbReadErr);
  db.doc("meta/habits").onSnapshot((d) => {
    const data = d.exists ? d.data() || {} : {};
    S.habits = { list: Array.isArray(data.list) ? data.list : [], log: data.log && typeof data.log === "object" ? data.log : {}, opened: Array.isArray(data.opened) ? data.opened : [] };
    S.ver++;
    const first = !S.loaded.habits; S.loaded.habits = true;
    if (first) markOpened();
    scheduleRender();
  }, dbReadErr);
  db.doc("meta/timer").onSnapshot((d) => {
    const prev = S.timer;
    let tm = d.exists ? Object.assign({}, d.data()) : null;
    if (tm && tm.sid && S.stopped.has(tm.sid)) tm = null; // a late echo of a session this copy already stopped
    /* a countdown from the old version: keep it running as a clock-in, capped at its old length */
    if (tm && tm.phase) { setTimerDoc(tm.phase === "focus" ? { taskId: tm.taskId, mode: "up", startedAt: tm.startedAt, checkAt: tm.startedAt, sid: tm.sid || rid("s"), plant: tm.plant || "tulip", seed: tm.seed || 1, gold: !!tm.gold, maxMin: +tm.durMin || 25 } : null); return; }
    S.timer = tm;
    if (S.timer && (!prev || prev.startedAt !== S.timer.startedAt)) S.focusOpen = (S.focusOpen || !prev) && !isWide();
    scheduleRender(); if (S.leader) planSoon();
  }, dbReadErr);
  use("mcp").then((m) => { S.mcp = m; scheduleRender(); maybeAutoSync(); schedulePlan(2500); });
  use("sample").then((s) => { S.sample = s; });
}
boot();
