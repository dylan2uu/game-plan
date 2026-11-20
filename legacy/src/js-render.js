/* ---------- rendering ---------- */
let raf = 0;
function scheduleRender() { if (!raf) raf = requestAnimationFrame(render); }
function preserve(root, fn) {
  const vals = new Map();
  root.querySelectorAll("input[id],textarea[id],select[id]").forEach((el) => { if (el.type !== "file" && el.type !== "checkbox") vals.set(el.id, el.value); });
  const a = document.activeElement, fid = a && root.contains(a) ? a.id : null;
  let ss = null, se = null; if (fid) { try { ss = a.selectionStart; se = a.selectionEnd; } catch (e) { /* no selection */ } }
  fn();
  vals.forEach((v, id) => { const el = document.getElementById(id); if (el && root.contains(el)) el.value = v; });
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) { /* not a text field */ } } }
}
function render() {
  raf = 0;
  const gate = $("#gate"), main = $("#main");
  let g = "";
  if (S.noDb) g = "<h2>Open Game Plan inside Claude</h2><p>Your board loads when this page runs in Claude.</p>";
  else if (S.notOwner) g = "<h2>This board is private</h2><p>Only its owner can see it.</p>";
  else if (!ready()) g = "<h2>Loading…</h2><p>Getting your board.</p>";
  const st = stats();
  $("#top").innerHTML = renderTop(st, !g);
  if (g) { gate.innerHTML = '<div class="gate">' + g + "</div>"; main.hidden = true; renderSheet(); renderFocusLayer(); renderRunbar(); return; }
  gate.innerHTML = ""; main.hidden = false; main.dataset.view = S.view;
  const view = S.view;
  $("#tabs").innerHTML = renderTabs();
  $("#bar").hidden = view === "garden";
  const strip = $("#gstrip"); strip.hidden = view !== "today"; if (view === "today") renderStrip(strip);
  const gv = $("#gardenView"); gv.hidden = view !== "garden"; if (view === "garden") renderGardenView(gv);
  const hero = view === "today" ? heroTask() : null;
  preserve(main, () => {
    $("#habits").innerHTML = "";
    $("#feed").innerHTML = view === "garden" ? "" : S.chatMin && !S.busy.send ? (S.chat.length ? '<button type="button" class="link feed-more" data-act="chatmin">Show chat (' + S.chat.length + ")</button>" : "") : renderFeed() + (S.chat.length ? '<button type="button" class="link feed-more feed-hide" data-act="chatmin">Hide chat</button>' : "");
    $("#hero").innerHTML = view === "today" ? renderHero(hero) : "";
    $("#upnext").innerHTML = view === "today" ? renderLineup(hero) : "";
    $("#calbox").innerHTML = view === "today" ? renderCalendar(st) : "";
    $("#progbox").innerHTML = view === "today" ? '<h2 class="prog-h">Your progress</h2>' + renderProgress(st) : "";
  });
  syncSend(); syncUndo();
  renderSheet();
  renderFocusLayer();
  renderRunbar();
  renderDock();
  tick();
  if (view === "today") { setTimeout(() => loadMonthEvents(false), 0); }
}
function renderTop(st, live) {
  const target = +S.settings.dailyTarget || 10, p = live ? st.today.p : 0, frac = Math.min(1, p / target), C = 2 * Math.PI * 26;
  const now = new Date(), hr = now.getHours();
  const greet = hr < 5 ? "Up late" : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const bits = [fmtPts(p) + " of " + target + " pts today" + (live ? " · " + dayBand(p, target).word.toLowerCase() + " day so far" : "")];
  if (live && st.streak) bits.push("🔥 " + st.streak + "-day streak");
  if (live && st.today.m) bits.push("⏱ " + fmtMin(st.today.m));
  return '<div class="ring' + (p >= target ? " hit" : "") + '" role="img" aria-label="' + esc(fmtPts(p) + " of " + target + " points today") + '"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="ring-track" cx="32" cy="32" r="26"/><circle class="ring-fill" cx="32" cy="32" r="26" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - frac)).toFixed(1) + '"/></svg><span class="ring-num">' + fmtPts(p) + "</span></div>" +
    '<div class="hello"><p class="day">' + esc(now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })) + '</p><h1 class="greet">' + greet + ', Dylan</h1><p class="meta">' + bits.map((b) => "<span>" + esc(b) + "</span>").join("") + "</p></div>" +
    '<button type="button" class="icon-btn" id="gearBtn" data-act="opensettings" aria-label="Settings" aria-haspopup="dialog">' + ICON.gear + "</button>";
}
function renderTabs() {
  const n = openTasks().filter((t) => assess(t).tier !== "green").length;
  const tab = (v, label, extra) => '<button type="button" role="tab" aria-selected="' + (S.view === v) + '" data-act="setview" data-view="' + v + '">' + label + (extra || "") + "</button>";
  return '<div class="seg tabs" role="tablist" aria-label="View">' + tab("today", "Plan", n ? '<span class="count">' + n + "</span>" : "") + tab("garden", "Garden") + "</div>";
}
function renderStrip(el) {
  const gd = gardenData(), sc = sceneHTML(false), left = Math.max(0, gd.curNeed - gd.curHave);
  const cap = "<span><b>Mystery tree</b> " + fmtPts(gd.curHave) + "/" + gd.curNeed + "</span><span>🦋 " + (gd.butterflies ? gd.butterflies + " today" : "none yet") + "</span>";
  const key = sc.key + "|" + cap;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = '<button type="button" class="gstrip" data-act="setview" data-view="garden" aria-label="' + esc("Open your garden. The mystery tree needs " + fmtPts(left) + " more points to bloom.") + '">' + sc.html + '<span class="gs-bar">' + cap + "</span></button>";
}
function tierPill(tier) { return '<span class="tier-pill ' + tier + '"><i></i>' + TIERS[tier] + "</span>"; }
function courseTag(t) { return t.course ? '<span class="tag"><i style="background:' + courseColor(t.course) + '"></i>' + esc(t.course) + "</span>" : ""; }
function stageCls(t, a) {
  if (t.status === "done") return "s-done";
  const f = a.logged / Math.max(1, a.est);
  return f >= 0.75 ? "s-late" : f >= 0.25 ? "s-mid" : hasFirst(t) ? "s-start" : "s-none";
}
function timeBar(t, a, big) {
  const frac = Math.min(1, a.logged / Math.max(1, a.est));
  const label = a.logged ? fmtMin(a.logged) + " of ~" + fmtMin(a.est) + (a.logged > a.est ? ", over the guess" : "") : "~" + fmtMin(a.est) + " · nothing clocked yet";
  return '<div class="timebar' + (big ? " big" : "") + '" role="img" aria-label="' + esc("Time: " + label) + '"><span class="tb-track"><i class="' + stageCls(t, a) + '" style="width:' + (frac * 100).toFixed(1) + '%"></i></span><span class="tb-lbl">' + esc(label) + "</span></div>";
}
function pRing(t, a) {
  const f = Math.min(1, a.logged / Math.max(1, a.est)), C = 2 * Math.PI * 13, cls = stageCls(t, a);
  return '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" class="pr-track"/>' +
    (f > 0 ? '<circle cx="16" cy="16" r="13" class="pr-fill ' + cls + '" stroke-dasharray="' + f1(C) + '" stroke-dashoffset="' + f1(C * (1 - Math.max(f, 0.06))) + '" transform="rotate(-90 16 16)"/>' : "") +
    (f === 0 && hasFirst(t) ? '<circle cx="16" cy="16" r="4" class="pr-dot"/>' : "") + '</svg><span class="pr-check">' + ICON.check + "</span>";
}
function fmtWhenShort(d) {
  const now = new Date(), tm = new Date(now); tm.setDate(now.getDate() + 1);
  return (dayKey(d) === dayKey(now) ? "" : dayKey(d) === dayKey(tm) ? "Tmrw " : d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }) + " ") + fmtTime(d);
}
function nudgeInfo(t, a) {
  const up = upcomingNudges(t), tk = dayKey(new Date()), today = up.filter((n) => dayKey(new Date(n.at)) === tk);
  const hist = (t.nudges || []).filter((n) => n && Date.parse(n.at) <= Date.now());
  const worked = hist.filter((n) => { const r = nudgeResult(t, n); return r.fast || r.worked; }).length;
  const planText = up.length ? up.length + (up.length === 1 ? " nudge" : " nudges") + " planned" + (today.length ? (today.length === up.length ? " today" : " (" + today.length + " today)") : "") + ": " + up.slice(0, 4).map((n) => fmtWhenShort(new Date(n.at))).join(", ") + (up.length > 4 ? "…" : ".") :
    S.settings.nudges === false ? "Nudges are off." : t.quietDay === tk ? "Quiet for today, like you asked." : a.tier === "green" ? "No nudges. It isn't pressing yet." : startedOn(t, tk) ? "No more nudges today, you already started." : S.lastPlan ? "None scheduled right now." : "Planning nudges…";
  const histText = hist.length ? hist.length + " sent so far, " + worked + " got you working." : "";
  const why = up.length && up[0].why ? up[0].why : a.why;
  return { up, today, hist, worked, planText, histText, why, tip: [planText, "Why: " + why, histText].filter(Boolean).join(" ") };
}
function firstBtn(t, firstOk, done) {
  return '<button type="button" class="first' + (firstOk ? " ok" : "") + '" data-act="first"' + (firstOk || done ? ' disabled aria-disabled="true"' : "") + '><span class="fbox">' + (firstOk ? ICON.check : "") + "</span><span><small>" + (firstOk ? "First step done" : "First step · 2 min · tap when done for +1 pt") + "</small>" + esc(t.firstStep) + "</span></button>";
}
function planRow(t) {
  const plan = parseLocal(t.planAt);
  if (plan && +plan > Date.now() - 30 * 60000) return '<div class="plan-row planned">' + ICON.plan + "<span>Planned for <b>" + esc(fmtWhenShort(plan)) + '</b>. Your phone pings you then.</span><button type="button" class="link" data-act="plan" data-at="">Clear</button></div>';
  const slots = freeSlots(3);
  if (!slots.length) return "";
  return '<div class="plan-row"><span class="pr-label">' + ICON.plan + "When?</span>" + slots.map((x) => '<button type="button" class="qchip" data-act="plan" data-at="' + x + '">' + esc(fmtWhenShort(new Date(x))) + "</button>").join("") + "</div>";
}
function renderHero(t) {
  if (!t) {
    if (!S.chat.length && !Array.from(S.tasks.values()).length) return "";
    return '<div class="card clear-card"><span class="label"><i></i>All clear</span><h2 class="title">Nothing on your plate.</h2><p>Tell me what’s next whenever you’re ready.</p></div>';
  }
  const a = assess(t), due = dueText(t.due, false), firstOk = hasFirst(t), ni = nudgeInfo(t, a), live = !!(S.timer && S.timer.taskId === t.id), rn = live ? null : recentNudge(), nudged = rn && rn.t.id === t.id, miss = live ? 0 : missedStreak(t);
  const nlabel = ni.up.length ? (ni.today.length ? ni.today.length + " today · next " : "next ") + esc(fmtWhenShort(new Date(ni.up[0].at))) : a.tier === "green" ? "No nudges needed" : live || startedOn(t, dayKey(new Date())) ? "Started, nudges paused" : S.lastPlan ? "None scheduled" : "Planning nudges";
  const nchip = S.settings.nudges === false ? "" : '<button type="button" class="nchip' + (ni.up.length ? "" : " quiet") + '" data-act="opentask" data-tip="' + esc(ni.tip) + '">' + ICON.bell + nlabel + "</button>";
  let h = '<article class="card now tier-' + a.tier + (live ? " live" : "") + '" data-id="' + esc(t.id) + '">';
  if (nudged) h += '<div class="ribbon">' + ICON.bell + "<span>You got nudged " + (rn.mins < 2 ? "just now" : rn.mins + " min ago") + '. Two minutes is all it takes.</span><button type="button" class="link" data-act="quiet">Not today</button></div>';
  h += '<div class="now-top"><span class="label"><i></i>' + (live ? "Clocked in" : "Do this now") + "</span>" + tierPill(a.tier) + "</div>" +
    '<h2 class="title">' + esc(t.title) + "</h2>" +
    '<p class="why">' + ICON.why + "<span>" + esc(a.why) + "</span></p>" +
    '<p class="facts">' + courseTag(t) + (due ? '<span class="due ' + due.cls + '">' + esc(due.text) + "</span>" : "") + '<span class="coin">' + ptsL(t.points) + "</span></p>" + linksRow(t) + timeBar(t, a, true);
  if (miss >= 3) h += '<div class="hint"><span>You let the last ' + miss + ' nudges slide on this one. A smaller first step usually fixes that.</span><button type="button" class="btn sm" data-act="shrink">Make it smaller</button></div>';
  if (!live) h += firstBtn(t, firstOk, false);
  if (live) h += '<div class="actions"><button type="button" class="btn primary big" data-act="stoptimer">' + ICON.stop + 'Stop <span class="clk" data-clock>0:00</span></button><button type="button" class="btn big" data-act="complete">Done</button></div>' +
    '<p class="start-note">' + ICON.chat + (t.chatUrl ? '<a href="' + esc(t.chatUrl) + '" target="_blank" rel="noopener">Back to your chat</a>' : '<a href="' + esc(planHref(t)) + '" target="_blank" rel="noopener" data-act="openplan">Open a Claude chat for it</a>') + ' · <button type="button" class="link" data-act="maxfocus">Open the timer</button></p>';
  else h += '<div class="actions"><a class="btn primary big start" href="' + esc(planHref(t)) + '" target="_blank" rel="noopener" data-act="start">' + ICON.play + (t.chatUrl ? "Resume" : "Start") + '</a><button type="button" class="btn big" data-act="complete">Done</button></div>' +
    chatRow(t) + planRow(t);
  return h + '<div class="now-foot"><button type="button" class="link" data-act="skip">Not now</button><button type="button" class="link" data-act="opentask">Details</button>' + nchip + "</div></article>";
}
function rowHtml(x) {
  const t = x.t, a = x.a, due = dueText(t.due, true), ni = nudgeInfo(t, a), live = !!(S.timer && S.timer.taskId === t.id);
  const bell = S.settings.nudges === false || (!ni.up.length && !ni.hist.length) ? "" : '<span class="bell' + (ni.today.length ? " on" : "") + '" role="button" tabindex="0" data-act="opentask" data-tip="' + esc(ni.tip) + '" aria-label="' + esc("Nudges: " + ni.tip) + '">' + ICON.bell + "<b>" + (ni.today.length || ni.up.length || ni.hist.length) + "</b></span>";
  const sub = [t.course ? '<i class="cdot" style="background:' + courseColor(t.course) + '"></i>' + esc(t.course) : "", due ? '<span class="due ' + due.cls + '">' + esc(due.text) + "</span>" : "", '<span class="pts-s">' + ptsL(t.points) + "</span>"].filter(Boolean).join('<span class="sep">·</span>') + bell;
  const ringTip = (a.logged ? fmtMin(a.logged) + " of ~" + fmtMin(a.est) + " clocked" : hasFirst(t) ? "First step done" : "Not started yet") + ". Tap to mark done.";
  return '<li class="item tier-' + a.tier + (live ? " live" : "") + '" data-id="' + esc(t.id) + '">' +
    '<button type="button" class="pring" data-act="complete" aria-label="' + esc("Mark " + t.title + " done. " + ringTip) + '" data-tip="' + esc(ringTip) + '">' + pRing(t, a) + "</button>" +
    '<button type="button" class="item-main" data-act="pick" data-tip="Make this the one to do now"><span class="item-title">' + esc(t.title) + '</span><span class="item-sub">' + sub + '</span><span class="item-why">' + esc(t.due ? a.why.replace(/^Due [^.]*\.\s*/, "") : a.why) + "</span>" +
    (a.logged ? '<span class="mini-tb"><i class="' + stageCls(t, a) + '" style="width:' + Math.min(100, (a.logged / Math.max(1, a.est)) * 100).toFixed(0) + '%"></i></span>' : "") + "</button>" +
    (live ? '<button type="button" class="play on" data-act="stoptimer" aria-label="Stop the timer" data-tip="Clocked in. Tap to stop and save.">' + ICON.stop + "</button>" : '<button type="button" class="play" data-act="clockin" aria-label="' + esc("Clock in on " + t.title) + '" data-tip="Clock in (just the timer)">' + ICON.play + "</button>") + "</li>";
}
function doneRow(t) {
  const pts = (t.log || []).filter((e) => e.k === "done").reduce((s, e) => s + (+e.p || 0), 0), lm = loggedMin(t);
  return '<li class="item done" data-id="' + esc(t.id) + '"><button type="button" class="pring done" data-act="reopen" aria-label="' + esc("Undo done for " + t.title) + '" data-tip="Done by accident? Tap to put it back."><span class="done-dot">' + ICON.check + "</span></button>" +
    '<button type="button" class="item-main" data-act="opentask"><span class="item-title">' + esc(t.title) + '</span><span class="item-sub">+' + esc(ptsL(pts)) + " · " + esc(fmtTime(new Date(t.completedAt))) + (lm ? " · " + fmtMin(lm) + " clocked" : "") + "</span></button></li>";
}
const CHEV_D = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function isOpen(sec, dflt) { const v = S.folds[sec]; return v == null ? dflt : !!v; }
/* a section that stays folded until you tap it, so the screen stays calm */
function fold(sec, dot, title, count, body, dflt, note) {
  const open = isOpen(sec, dflt);
  return '<section class="fold' + (open ? " open" : "") + '"><button type="button" class="fold-head" data-act="fold" data-sec="' + sec + '" aria-expanded="' + open + '">' + (dot ? '<i class="sdot ' + dot + '"></i>' : "") + '<span class="fold-title">' + title + "</span>" + (count != null ? '<span class="count">' + count + "</span>" : "") +
    (note ? '<span class="fold-note">' + note + "</span>" : "") + '<span class="chev">' + CHEV_D + "</span></button>" + (open ? '<div class="fold-body">' + body + "</div>" : "") + "</section>";
}
function staleTasks() { const cut = Date.now() - 2 * DAY; return openTasks().filter((t) => { const d = parseLocal(t.due); return d && +d < cut; }).sort(listOrder); }
function renderStale() {
  const st = staleTasks(); if (!st.length) return "";
  return '<section class="stale"><h3 class="stale-h">Still doing these?</h3><p class="stale-sub">' + (st.length === 1 ? "This has" : "These have") + " been overdue for 2+ days. Keep, finish or drop so your list stays real.</p><ul>" +
    (S.staleAll ? st : st.slice(0, 4)).map((t) => '<li data-id="' + esc(t.id) + '"><div class="stale-t"><b>' + esc(t.title) + "</b><small>" + esc(dueText(t.due, false).text) + (t.course ? " · " + esc(t.course) : "") + '</small></div><div class="stale-a"><button type="button" class="btn sm" data-act="stalekeep">Due tomorrow</button><button type="button" class="btn sm" data-act="complete">Already done</button><button type="button" class="btn sm ghost" data-act="staledrop">Drop it</button></div></li>').join("") + "</ul>" + (st.length > 4 ? '<button type="button" class="link" data-act="staleall">' + (S.staleAll ? "Show fewer" : "Show all " + st.length) + "</button>" : "") + "</section>";
}
function renderLineup(hero) {
  const list = lineup(hero && hero.id), top = list.filter((x) => x.a.tier !== "green"), later = list.filter((x) => x.a.tier === "green");
  let html = renderStale();
  if (top.length) {
    const shown = S.showAll ? top : top.slice(0, 3);
    html += '<h3 class="sec"><i class="sdot red"></i>Up next<span class="count">' + top.length + '</span><span class="sec-note">▶ clocks you in</span></h3><ul class="rows">' + shown.map(rowHtml).join("") + "</ul>";
    if (top.length > 3) html += '<button type="button" class="link more" data-act="showall">' + (S.showAll ? "Show less" : "Show " + (top.length - 3) + " more") + "</button>";
  } else if (hero) html += '<p class="empty-line calm">Nothing else is pressing today. Nice.</p>';
  if (!top.length && !later.length && !hero) html += '<p class="empty-line">Your tasks show up here. Tell the bar what’s on your plate.</p>';
  const tk = dayKey(new Date());
  const doneToday = Array.from(S.tasks.values()).filter((t) => t.status === "done" && t.completedAt && dayKey(new Date(t.completedAt)) === tk).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  html += '<div class="folds">';
  if (later.length) html += fold("later", "green", "Coming up", later.length, '<ul class="rows">' + later.map(rowHtml).join("") + "</ul>", false, "no rush yet");
  if (doneToday.length) html += fold("done", "mint", "Done today", doneToday.length, '<ul class="rows">' + doneToday.map(doneRow).join("") + "</ul>", false, "tap ✓ to undo");
  return html + "</div>";
}

/* ---------- habits row (Today) ---------- */
function habitChip(h, info, dk, live) {
  const done = habitDoneOn(h, dk, info, live), st = habitStreak(h, info), auto = h.id[0] === "_";
  const extra = h.id === "_focus" && !done ? " <small>" + Math.floor(((info.get(dk) || { m: 0 }).m || 0) + live) + "/25</small>" : "";
  const inner = '<span class="hc-box">' + (done ? ICON.check : "") + "</span><span>" + esc(h.name) + extra + "</span>" + (st > 1 ? '<span class="hc-st">🔥' + st + "</span>" : "");
  const tip = (auto ? h.tip : esc(h.name) + " · " + daysLabel(h.days)) + (st > 1 ? " · " + st + " in a row" : "") + (auto ? " (automatic)" : done ? " · tap to undo" : " · tap when done for +1 pt");
  return auto ? '<span class="hchip auto' + (done ? " on" : "") + '" data-tip="' + esc(tip) + '">' + inner + "</span>" :
    '<button type="button" class="hchip mine' + (done ? " on" : "") + '" data-act="habit" data-hid="' + esc(h.id) + '" aria-pressed="' + done + '" data-tip="' + esc(tip) + '">' + inner + "</button>";
}
function habitForm() {
  const ideas = HABIT_IDEAS.filter((n) => !habitList().some((h) => h.name.toLowerCase() === n.toLowerCase())).slice(0, 5);
  return '<form class="hb-form" data-form="habit"><input id="habitName" name="name" maxlength="40" placeholder="New habit, like Gym" autocomplete="off" aria-label="Habit name">' +
    '<select id="habitDays" name="days" aria-label="How often"><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="mwf">Mon Wed Fri</option><option value="tth">Tue Thu</option><option value="weekends">Weekends</option></select>' +
    '<button class="btn sm primary" type="submit">Add</button><button type="button" class="link" data-act="habitcancel">Cancel</button></form>' +
    (ideas.length ? '<div class="hb-ideas">' + ideas.map((n) => '<button type="button" class="qchip" data-act="habitidea" data-name="' + esc(n) + '">+ ' + esc(n) + "</button>").join("") + "</div>" : "");
}
function renderHabitsRow() {
  if (!S.loaded.habits) return "";
  const info = dayInfo(), dk = dayKey(new Date()), now = new Date(), live = S.timer ? elapsedMin(S.timer) : 0;
  const mine = habitList().filter((h) => habitScheduled(h, now)), all = AUTO_HABITS.concat(mine);
  const doneN = all.filter((h) => habitDoneOn(h, dk, info, live)).length;
  return '<section class="habits" aria-label="Today’s habits"><div class="hb-head"><span class="hb-title">Today’s habits</span><span class="hb-sum">' + doneN + " of " + all.length + "</span></div>" +
    '<div class="hb-chips">' + all.map((h) => habitChip(h, info, dk, live)).join("") + '<button type="button" class="hchip add" data-act="habitadd" aria-label="Add a habit">' + ICON.add + (habitList().length ? "" : "<span>Add yours</span>") + "</button></div>" +
    (S.habitAdd ? habitForm() : "") + "</section>";
}

/* ---------- progress tab: done history, habits, focus time ---------- */
function weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function doneGroupLabel(at, ws) { const d = new Date(at); if (d >= ws) return "This week"; const lw = new Date(ws); lw.setDate(ws.getDate() - 7); if (d >= lw) return "Last week"; return d.toLocaleDateString([], { month: "long", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }); }
function dRow(t) {
  const lm = loggedMin(t), pts = (t.log || []).filter((e) => e.k === "done").reduce((s, e) => s + (+e.p || 0), 0), due = parseLocal(t.due), at = new Date(t.completedAt);
  const early = due ? (+due - +at) / DAY : null;
  const badge = early == null ? "" : early >= 1 ? '<span class="badge good">' + (early >= 1.5 ? Math.round(early) + " days early" : "a day early") + "</span>" : early >= -0.01 ? '<span class="badge good">on time</span>' : '<span class="badge late">' + (early > -1 ? "a bit late" : Math.round(-early) + (Math.round(-early) === 1 ? " day late" : " days late")) + "</span>";
  return '<li class="drow" data-id="' + esc(t.id) + '"><button type="button" class="ag-ok" data-act="reopen" aria-label="' + esc("Put " + t.title + " back on the list") + '" data-tip="Not done? Tap to put it back.">' + ICON.check + "</button>" +
    '<button type="button" class="dr-main" data-act="opentask"><span class="dr-title">' + esc(t.title) + '</span><span class="dr-sub">' + (t.course ? '<i class="cdot" style="background:' + courseColor(t.course) + '"></i>' + esc(t.course) + " · " : "") + esc(at.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })) + (lm ? " · ⏱ " + fmtMin(lm) : "") + badge + "</span></button>" + '<span class="item-pts">+' + fmtPts(pts) + "</span></li>";
}
function habitGrid(info) {
  const today = new Date(), days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(today); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i); days.push(d); }
  const live = S.timer ? elapsedMin(S.timer) : 0, tk = dayKey(today);
  const head = '<div class="hg-row hg-headrow"><span class="hg-name"></span><span class="hg-cells">' + days.map((d) => '<i class="hg-d' + (dayKey(d) === tk ? " today" : "") + '">' + esc(d.toLocaleDateString([], { weekday: "narrow" })) + "</i>").join("") + '</span><span class="hg-st"></span><span class="hg-x"></span></div>';
  const rows = AUTO_HABITS.concat(habitList()).map((h) => {
    const auto = h.id[0] === "_", st = habitStreak(h, info), best = habitBest(h, info);
    const cells = days.map((d) => {
      const k = dayKey(d), sch = habitScheduled(h, d), done = habitDoneOn(h, k, info, k === tk ? live : 0);
      const lbl = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ": " + (done ? "done" : sch ? "missed" : "off day");
      return !auto && k === tk ? '<button type="button" class="hg-c' + (done ? " on" : "") + ' today" data-act="habit" data-hid="' + esc(h.id) + '" aria-label="' + esc(h.name + ", today") + '" data-tip="' + esc(lbl) + '"></button>' : '<i class="hg-c' + (done ? " on" : sch ? "" : " off") + (k === tk ? " today" : "") + '" data-tip="' + esc(lbl) + '"></i>';
    }).join("");
    return '<div class="hg-row"><span class="hg-name">' + esc(h.name) + "<small>" + (auto ? "automatic" : esc(daysLabel(h.days))) + "</small></span>" + '<span class="hg-cells">' + cells + "</span>" +
      '<span class="hg-st" data-tip="' + esc("Current streak " + st + ", best " + best) + '">' + (st ? "🔥" + st : "–") + "</span>" +
      (auto ? '<span class="hg-x"></span>' : '<button type="button" class="hg-x" data-act="habitdel" data-hid="' + esc(h.id) + '" aria-label="' + esc("Remove " + h.name) + '">' + ICON.del + "</button>") + "</div>";
  }).join("");
  return '<div class="hgrid">' + head + rows + "</div>" + (S.habitAdd ? habitForm() : '<button type="button" class="btn sm" data-act="habitadd">' + ICON.add + " Add a habit</button>");
}
function renderProgress(st) {
  const now = new Date(), info = dayInfo();
  let wP = 0, wM = 0, wD = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(now.getDate() - i); const v = st.days.get(dayKey(d)); if (v) { wP += v.p; wM += v.m; wD += v.done; } }
  const doneAll = Array.from(S.tasks.values()).filter((t) => t.status === "done" && t.completedAt).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  const withDue = doneAll.filter((t) => t.due).slice(0, 40);
  const ot = withDue.length ? Math.round((withDue.filter((t) => Date.parse(t.completedAt) <= +parseLocal(t.due) + 60000).length / withDue.length) * 100) : null;
  const goal = +S.settings.dailyTarget || 10;
  let goodDays = 0; for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(now.getDate() - i); if (((st.days.get(dayKey(d)) || {}).p || 0) >= goal) goodDays++; }
  const wb = dayBand(wP / 7, goal);
  const tiles = [["Points this week", fmtPts(wP) + '<small> / ' + goal * 7 + "</small>", wb.cls], ["Days at goal", goodDays + '<small> / 7</small>', goodDays >= 4 ? "good" : goodDays >= 2 ? "mid" : "low"], ["Finished this week", wD, ""], ["On time", ot == null ? "–" : ot + "%", ot == null ? "" : ot >= 80 ? "good" : ot >= 50 ? "mid" : "low"]].map((x) => '<div class="tile ' + x[2] + '"><b>' + x[1] + "</b><span>" + x[0] + "</span></div>").join("") + '<p class="week-verdict ' + wb.cls + '"><b>' + wb.word + " week so far.</b> " + wb.line + "</p>";
  // done history
  const courses = Array.from(new Set(doneAll.map((t) => t.course).filter(Boolean))).sort();
  const filt = S.progCourse && courses.indexOf(S.progCourse) >= 0 ? S.progCourse : null;
  const list = filt ? doneAll.filter((t) => t.course === filt) : doneAll;
  const shown = S.progAll ? list : list.slice(0, 8), ws = weekStart(now);
  let groups = "", last = "";
  shown.forEach((t) => { const g = doneGroupLabel(t.completedAt, ws); if (g !== last) { groups += (last ? "</ul>" : "") + '<p class="dgroup">' + esc(g) + '</p><ul class="dlist">'; last = g; } groups += dRow(t); });
  if (last) groups += "</ul>";
  const totalMin = list.reduce((s, t) => s + loggedMin(t), 0);
  const filters = courses.length ? '<div class="dfilters">' + ['<button type="button" class="qchip' + (!filt ? " on" : "") + '" data-act="dfilter" data-course="">All</button>'].concat(courses.map((c) => '<button type="button" class="qchip' + (filt === c ? " on" : "") + '" data-act="dfilter" data-course="' + esc(c) + '"><i class="cdot" style="background:' + courseColor(c) + '"></i>' + esc(c) + "</button>")).join("") + "</div>" : "";
  const doneBody = list.length ? filters + '<p class="dsum">' + list.length + (list.length === 1 ? " finished" : " finished") + " · " + ptsL(list.reduce((n, t) => n + (t.log || []).filter((e) => e.k === "done").reduce((q, e) => q + (+e.p || 0), 0), 0)) + " earned" + "</p>" + groups + (list.length > 8 ? '<button type="button" class="link more" data-act="dall">' + (S.progAll ? "Show less" : "Show all " + list.length) + "</button>" : "") : '<p class="muted">Everything you finish lands here, with the time it took and whether it was on time.</p>';
  // focus chart, 14 days
  const data = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); const v = st.days.get(dayKey(d)) || { p: 0, m: 0 }; data.push({ d, m: v.m + (i === 0 && S.timer ? elapsedMin(S.timer) : 0), p: v.p, today: i === 0 }); }
  const max = Math.max(goal * 1.6, ...data.map((x) => x.p));
  const bars = data.map((x) => { const b = dayBand(x.p, goal), tip = x.d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ": " + ptsL(x.p) + " · " + b.word; return '<div class="bar-col" tabindex="0" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '"><i class="b-' + b.cls + (x.today ? " today" : "") + (x.p ? "" : " zero") + '" style="height:' + (x.p ? Math.max((x.p / max) * 100, 3) : 0) + '%"></i></div>'; }).join("");
  const dl = data.map((x) => '<span class="' + (x.today ? "is-today" : "") + '">' + esc(x.d.toLocaleDateString([], { weekday: "narrow" })) + "</span>").join("");
  const totalM = data.reduce((s, x) => s + x.p, 0);
  const chart = '<div class="week"><div class="bars pts-bars" style="--goal:' + ((goal / max) * 100).toFixed(1) + '%"><span class="goal-line" aria-hidden="true"><em>goal ' + goal + "</em></span>" + bars + '</div><div class="days">' + dl + '</div><p class="week-line"><b>' + ptsL(totalM) + "</b> in two weeks" + (st.early != null && Math.abs(st.early) >= 0.1 ? " · finishing " + Math.abs(st.early).toFixed(1) + (st.early > 0 ? " days early" : " days late") + " on average" : "") + "</p></div>";
  const ns = nudgeStats(14);
  const nr = '<div class="nreport"><p>' + (ns.sent ? "<b>" + ns.worked + " of " + ns.sent + "</b> nudges in the last two weeks got you working (" + Math.round((ns.worked / ns.sent) * 100) + "%)." + (ns.best ? " Your best time is around " + esc(fmtTime(hmDate(new Date(), ns.best.h, 0))) + ", so the planner leans toward it." : " The planner learns which times work as more come in.") : "Once nudges start firing, this shows which ones got you moving, and the planner shifts them toward the times that work.") + "</p></div>";
  return '<div class="tiles prog-tiles">' + tiles + "</div>" + '<div class="prog-grid">' +
    '<section class="pcard"><div class="pc-head"><h3>Finished</h3><span class="muted small">every assignment you’ve done</span></div>' + doneBody + "</section>" +
    '<div class="folds">' + fold("focus14", "sun", "Points per day", null, chart, true, ptsL(totalM) + " in 2 weeks") + fold("timeclk", "", "Time clocked", null, timeChart(data), false, fmtMin(data.reduce((n, x) => n + x.m, 0)) + " in 2 weeks") + fold("ptsmean", "", "What points mean", null, pointsGuide(goal), true) + fold("nudges", "", "Nudge report", null, nr, false, ns.sent ? ns.worked + " of " + ns.sent + " worked" : "") + "</div></div>";
}

/* ---------- garden tab ---------- */
function renderGardenView(gv) {
  if (!gv.querySelector("#gbig")) gv.innerHTML = '<div class="gbig" id="gbig"></div><div id="ginfo"></div>';
  const big = $("#gbig"), sc = sceneHTML(true);
  if (big.dataset.key !== sc.key) { big.innerHTML = sc.html; big.dataset.key = sc.key; }
  const info = gardenInfo(), gi = $("#ginfo");
  if (gi.dataset.key !== info.key) { gi.innerHTML = info.html; gi.dataset.key = info.key; }
}
function gardenInfo() {
  const gd = gardenData(), need = Math.max(0, gd.curNeed - gd.curHave), key = GD.key + "|" + isDark() + "|" + JSON.stringify(S.folds);
  const grow = '<div class="grow-card"><svg class="grow-svg" viewBox="-72 -152 144 160" aria-hidden="true"><ellipse cy="3" rx="36" ry="5" fill="currentColor" opacity=".08"/>' + plantSVG(gd.cur.k, Math.max(0.06, gd.frac), gd.cur.seed, gd.cur.gold) + "</svg>" +
    '<div class="grow-main"><p class="kicker">Growing now</p><h3>Mystery tree</h3><span class="meter" role="img" aria-label="' + esc(fmtPts(gd.curHave) + " of " + gd.curNeed + " points") + '"><i style="width:' + (gd.frac * 100).toFixed(1) + '%"></i></span><p class="muted">' + fmtPts(gd.curHave) + " of " + gd.curNeed + " pts · " + (need ? fmtPts(need) + " more and it blooms. Clocking 10 min is +1." : "blooming!") + "</p></div></div>";
  const tiles = [["Big trees", gd.trees.length], ["Plants", gd.plants.length], ["Kinds found", gd.found.size + "/" + SPECIES.length], ["Points all-time", fmtPts(gd.pts)]].map((x) => '<div class="tile"><b>' + x[1] + "</b><span>" + x[0] + "</span></div>").join("");
  const how = '<div class="how"><ul>' +
    '<li><i class="hi tree"></i><span><b>Points grow the big tree.</b> Every ' + TREE_STEP + " points it blooms for good and a new mystery kind sprouts. Clocked time (+1 per 10 min), first steps, habits and finished tasks all count.</span></li>" +
    '<li><i class="hi flower"></i><span><b>Clocking in plants things.</b> A plant blooms every 25 minutes you stay clocked in, and each one lands here when you stop. Even 5 minutes plants a sprout.</span></li>' +
    '<li><i class="hi bfly"></i><span><b>Today’s points bring butterflies.</b> Your first point of the day brings the first one. Hit your daily goal and a golden one shows up.</span></li></ul></div>';
  const recent = gd.plants.slice(-8).reverse();
  const day = (at) => (at ? new Date(at).toLocaleDateString([], { month: "short", day: "numeric" }) : "Earlier");
  const col = '<div class="collection">' + (recent.length ? "<ul>" + recent.map((q) => '<li><svg viewBox="-58 -132 116 138" aria-hidden="true">' + plantSVG(q.k, Math.max(0.3, q.g), q.seed, q.gold) + "</svg><span>" + esc(plantName(q.k, q.gold)) + "<small>" + esc(day(q.at)) + "</small></span></li>").join("") + "</ul>" : '<p class="muted">Clock in on anything. Whatever grows in the timer gets planted here.</p>') + "</div>";
  const trees = gd.trees.slice().reverse();
  const tcol = '<div class="collection">' + (trees.length ? "<ul>" + trees.map((t) => '<li><svg viewBox="-70 -150 140 156" aria-hidden="true">' + plantSVG(t.k, 1, t.seed, t.gold) + "</svg><span>" + esc(plantName(t.k, t.gold)) + "<small>Bloomed " + esc(day(t.at)) + "</small></span></li>").join("") + "</ul>" : '<p class="muted">Your first big tree blooms at ' + FIRST_TREE + " points. Which kind is a surprise.</p>") + "</div>";
  const coll = '<div class="coll">' + SPECIES.map((sp) => { const got = gd.found.has(sp.k); return '<div class="cl' + (got ? "" : " ghost") + '"><i class="cl-pic"><svg viewBox="-62 -136 124 142" aria-hidden="true">' + plantSVG(sp.k, 1, 77, false) + "</svg></i><span>" + (got ? esc(sp.name) + (gd.golds.has(sp.k) ? " ✨" : "") : "???") + "</span></div>"; }).join("") + '</div><p class="muted small coll-note">Golden ones are rare, about 1 in 12.</p>';
  return { key, html: grow + '<div class="tiles">' + tiles + '</div><div class="folds">' + fold("trees", "mint", "Your big trees", gd.trees.length, tcol, true, "new surprise every " + TREE_STEP + " pts") + fold("coll", "sun", "Collection", gd.found.size + "/" + SPECIES.length, coll, false, gd.golds.size ? gd.golds.size + " golden" : "find all " + SPECIES.length) + fold("plants", "rose", "Recently planted", recent.length || null, col, false, "from the timer") + fold("how", "", "How your garden grows", null, how, false) + "</div>" };
}

/* ---------- the timer screen ---------- */
function renderHarvest(tm, idx) {
  const el = $("#fHarvest"); if (!el) return;
  if (!idx) { el.innerHTML = '<span class="hv-note">A plant blooms every 25 min you stay in. Each one gets planted.</span>'; return; }
  let h = "";
  for (let i = 0; i < Math.min(idx, 6); i++) { const k = sessionKind(tm, i); h += '<svg class="hv" viewBox="-60 -130 120 134" role="img" aria-label="' + esc(plantName(k.plant, k.gold)) + '">' + plantSVG(k.plant, 1, k.seed, k.gold) + "</svg>"; }
  el.innerHTML = '<span class="hv-note">Bloomed so far</span>' + h + (idx > 6 ? '<span class="hv-more">+' + (idx - 6) + "</span>" : "");
}
function linkForm(t, compact) {
  return '<form class="link-form' + (compact ? " compact" : "") + '" data-form="link"><label for="lnk-' + esc(t.id) + '">' + (compact ? "Save this chat so Start reopens it next time" : "Paste the chat’s link") + '</label><div class="row"><input id="lnk-' + esc(t.id) + '" name="url" type="url" inputmode="url" placeholder="https://claude.ai/chat/…" autocomplete="off"><button type="button" class="btn sm" data-act="pastelink">Paste</button><button class="btn sm primary" type="submit">Save</button></div></form>';
}
function renderFocusLayer() {
  const el = $("#focusLayer"), tm = S.timer, task = tm && S.tasks.get(tm.taskId);
  const show = !!(tm && task && S.focusOpen && ready());
  const sig = show ? [tm.taskId, tm.sid, tm.startedAt, task.title, task.firstStep, task.status, task.chatUrl || "", hasFirst(task), isDark(), S.adjust ? 1 : 0].join("|") : "";
  if (sig === S.flSig) return;
  S.flSig = sig;
  if (!show) { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("fl-on"); return; }
  el.hidden = false; document.body.classList.add("fl-on");
  const mins = elapsedMin(tm), idx = Math.floor(mins / PLANT_MIN);
  el.innerHTML = '<div class="fl-inner" data-id="' + esc(task.id) + '">' +
    '<div class="fl-top"><div class="fl-head"><p class="fl-kicker"><i class="live-dot"></i>Clocked in</p><h2 class="fl-title">' + esc(task.title) + "</h2></div>" +
    '<button type="button" class="fl-x" data-act="minfocus" aria-label="Back to the board. The timer keeps running.">' + ICON.down + "</button></div>" +
    '<div class="fl-chat">' + (task.chatUrl ? '<a class="pill-btn" href="' + esc(task.chatUrl) + '" target="_blank" rel="noopener">' + ICON.chat + "Back to your chat</a>" : '<a class="pill-btn" href="' + esc(planHref(task)) + '" target="_blank" rel="noopener" data-act="openplan">' + ICON.chat + "Open a Claude chat for it</a>") + bsBtn(task, "pill-btn") + "</div>" +
    '<div class="fl-stage"><svg viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r="96" class="fl-track"/><circle id="fRing" cx="110" cy="110" r="96" class="fl-ring" stroke-dasharray="' + f1(RING_C) + '" stroke-dashoffset="' + f1(RING_C) + '" transform="rotate(-90 110 110)"/>' +
    '<g transform="translate(110 168)"><g transform="scale(.9)">' + potSVG() + '</g><g transform="translate(0 -4)"><g class="sway"><g id="fPlant" transform="scale(.82)"></g></g></g></g></svg></div>' +
    '<div class="fl-clock" data-clock aria-live="off">0:00</div>' +
    '<p class="fl-stage-l" id="fStage"></p>' +
    '<div class="fl-stats"><span class="fstat coinstat"><b id="fPts">+0 pts</b><small id="fNext"></small></span><span class="fstat"><b id="fToday">0m</b><small>clocked today</small></span><span class="fstat treestat"><span class="meter"><i id="fTree"></i></span><small>Mystery tree <b id="fTreeTxt"></b></small></span></div>' +
    '<div class="fl-harvest" id="fHarvest"></div>' +
    '<div class="ask" data-ask hidden><span>Still working? You’ve been clocked in a while.</span><div class="row"><button type="button" class="btn sm primary" data-act="stillhere">Still going</button><button type="button" class="btn sm" data-act="adjust">I stopped earlier</button></div></div>' +
    (S.adjust ? '<form class="adjust" data-form="adjust"><label for="adjMin">How many minutes did you actually work?</label><div class="row"><input id="adjMin" name="m" type="number" min="1" max="600" value="' + Math.max(1, Math.floor(mins)) + '"><button class="btn sm primary" type="submit">Save and stop</button><button type="button" class="link" data-act="adjustno">Cancel</button></div></form>' : "") +
    (!task.chatUrl ? linkForm(task, true) : "") +
    (!hasFirst(task) ? '<div class="fl-first">' + ICON.spark + "<div><small>First step</small>" + esc(task.firstStep) + "</div></div>" : "") +
    '<div class="fl-actions"><button type="button" class="btn primary big" data-act="stoptimer">' + ICON.stop + 'Stop and save</button><button type="button" class="btn big" data-act="complete">' + ICON.check + "Done</button></div>" +
    '<p class="fl-foot">Stop whenever you’re done. It saves the time, gives you the points, and plants what grew. <button type="button" class="link" data-act="adjust">Forgot to stop?</button></p>' +
    (S.settings.why ? '<p class="fl-why">Your why: <b>' + esc(S.settings.why) + "</b></p>" : "") + "</div>";
  renderHarvest(tm, idx);
  const c = skyAt((mins % PLANT_MIN) / PLANT_MIN); el.style.setProperty("--fl-top", c[0]); el.style.setProperty("--fl-bot", c[1]);
  tick();
}
/* while clocked in and the timer screen is closed, a slim bar sits at the bottom of every tab */
function renderRunbar() {
  const el = $("#runbar"), tm = S.timer, task = tm && S.tasks.get(tm.taskId);
  const show = !!(tm && task && !S.focusOpen && ready() && !isWide());
  document.body.classList.toggle("rb-on", show);
  const sig = show ? tm.sid + "|" + task.title : "";
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  if (!show) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = '<button type="button" class="rb-main" data-act="maxfocus" aria-label="Open the timer"><svg class="rb-plant" viewBox="-62 -132 124 136" aria-hidden="true"><g id="rbPlant"></g></svg><span class="rb-txt"><span class="rb-line"><i class="live-dot"></i><span class="rb-time" data-clock>0:00</span><span class="rb-pts" id="rbPts">+0</span></span><span class="rb-title">' + esc(task.title) + '</span></span><span class="rb-ask" data-ask hidden>Still going?</span></button>' +
    '<button type="button" class="rb-stop" data-act="stoptimer">' + ICON.stop + "Stop</button>";
  tick();
}
function resultText(r) { return r.state === "fast" ? "Started " + (r.mins < 2 ? "right away" : r.mins + " min later") : r.state === "later" ? "Worked on it later that day" : r.state === "pending" ? "Just sent" : "Didn’t land"; }
function renderTaskPanel(t) {
  const a = assess(t), done = t.status === "done", due = dueText(t.due, false), ni = nudgeInfo(t, a), live = !!(S.timer && S.timer.taskId === t.id);
  const sessions = (t.log || []).filter((e) => WORK[e.k]).slice().reverse(), firstOk = hasFirst(t);
  let h = '<div class="sheet-panel task-panel" data-id="' + esc(t.id) + '"><div class="sheet-head">' + (done ? '<span class="tier-pill mint"><i></i>Done</span>' : tierPill(a.tier)) + '<button type="button" class="btn sm" data-act="closesheet" id="closeSheet">Close</button></div>' +
    '<h2 class="tp-title" id="sheetTitle">' + esc(t.title) + "</h2>" +
    '<p class="facts">' + courseTag(t) + (due ? '<span class="due ' + (done ? "" : due.cls) + '">' + esc(due.text) + "</span>" : "<span>No due date</span>") + '<span class="coin">' + ptsL(t.points) + "</span><span>~" + fmtMin(a.est) + "</span></p>";
  if (!done) h += '<div class="tp-why"><b>Why it’s ranked here</b><p>' + esc(a.why) + "</p></div>";
  h += '<div class="tp-actions">' + (done ? '<button type="button" class="btn primary" data-act="reopen">Not done, put it back</button>' :
    (live ? '<button type="button" class="btn primary" data-act="stoptimer">' + ICON.stop + 'Stop <span class="clk" data-clock>0:00</span></button>' : '<a class="btn primary" href="' + esc(planHref(t)) + '" target="_blank" rel="noopener" data-act="start">' + ICON.play + 'Start</a><button type="button" class="btn" data-act="clockin">' + ICON.play + "Just the timer</button>") +
    '<button type="button" class="btn" data-act="complete">' + ICON.check + "Done</button>") + bsBtn(t, "btn") + "</div>";
  if (!done) h += firstBtn(t, firstOk, done) + planRow(t);
  h += '<section class="tp-sec"><h3>Links</h3>' + linksRow(t) + "</section>";
  h += '<section class="tp-sec" id="tpChat"><h3>Claude chat</h3>' + (t.chatUrl ? '<p class="muted small">Start reopens this chat right where you left off.</p><div class="row"><a class="btn sm" href="' + esc(t.chatUrl) + '" target="_blank" rel="noopener">' + ICON.chat + 'Open it</a><button type="button" class="link" data-act="unlink">Forget this link</button></div>' + linkForm(t, false) : '<p class="muted small">Start opens a new Claude chat with just this task. Copy that chat’s link from Claude, paste it here, and Start reopens it from then on.</p>' + linkForm(t, false)) + "</section>";
  h += '<section class="tp-sec"><h3>Time</h3>' + timeBar(t, a, true) + (sessions.length ? '<ul class="tp-list">' + sessions.slice(0, 10).map((e) => { const pl = Array.isArray(e.plants) ? e.plants.map((q) => plantName(q.plant, q.gold)).join(", ") : e.plant ? plantName(e.plant, e.gold) : ""; return "<li><span>" + esc(fmtWhenShort(new Date(e.at))) + "</span><span>" + fmtMin(e.m) + (+e.p ? " · +" + fmtPts(e.p) : "") + (pl ? " · " + esc(pl) : "") + "</span></li>"; }).join("") + "</ul>" : '<p class="muted small">Nothing clocked yet. ▶ clocks you in.</p>') + "</section>";
  h += '<section class="tp-sec"><h3>Nudges</h3>';
  if (S.settings.nudges === false) h += '<p class="muted small">Nudges are off in Settings.</p>';
  else {
    h += '<p class="muted small">' + esc(done ? "None planned, it’s done." + (ni.histText ? " " + ni.histText : "") : [ni.planText, ni.histText].filter(Boolean).join(" ")) + "</p>";
    if (!done && ni.up.length) h += '<ul class="nlist">' + ni.up.map((n) => '<li class="up"><span class="nl-time">' + esc(fmtWhenShort(new Date(n.at))) + '</span><span class="nl-why">' + esc(n.why || a.why) + '</span><span class="nl-res">' + (n.of > 1 ? "Nudge " + n.n + " of " + n.of + " that day" : "Planned") + "</span></li>").join("") + "</ul>";
    if (ni.hist.length) h += '<ul class="nlist">' + ni.hist.slice().reverse().slice(0, 10).map((n) => { const r = nudgeResult(t, n); return '<li><span class="nl-time">' + esc(fmtWhenShort(new Date(n.at))) + '</span><span class="nl-why">' + esc(n.why || "Sent") + '</span><span class="nl-res ' + r.state + '">' + resultText(r) + "</span></li>"; }).join("") + "</ul>";
    if (!done && t.quietDay !== dayKey(new Date()) && a.tier !== "green") h += '<button type="button" class="link" data-act="quiet">No more nudges for this today</button>';
  }
  h += "</section>";
  h += '<div class="tp-actions">' + (done ? "" : '<button type="button" class="btn" data-act="choose">Make it “do this now”</button><button type="button" class="btn danger" data-act="deltask">Delete</button>') + "</div>";
  return h + "</div>";
}
function syncSend() { const b = $("#barSend"), v = $("#barInput").value.trim(); if (b) b.disabled = !v || S.busy.send; }
function renderSheet() {
  const sheet = $("#sheet"), t = S.sheetTask && S.tasks.get(S.sheetTask);
  if (S.sheetTask && !t) S.sheetTask = null;
  if (!S.settingsOpen && !t) { if (!sheet.hidden) { sheet.hidden = true; sheet.innerHTML = ""; } return; }
  sheet.hidden = false;
  const old = sheet.querySelector(".sheet-panel"), top = old ? old.scrollTop : 0, same = old && old.dataset.kind === (t ? "t" + t.id : "s");
  if (t) preserve(sheet, () => { sheet.innerHTML = renderTaskPanel(t); });
  else preserve(sheet, () => { sheet.innerHTML = settingsHtml(); });
  const np = sheet.querySelector(".sheet-panel");
  if (np) { np.dataset.kind = t ? "t" + t.id : "s"; if (same) { np.scrollTop = top; np.style.animation = "none"; } }
  if (t && S.focusLink) { S.focusLink = false; const sec = $("#tpChat"), inp = sec && sec.querySelector("input"); if (sec) sec.scrollIntoView({ block: "center" }); if (inp) inp.focus({ preventScroll: true }); }
}
function settingsHtml() {
  const s = S.settings, ck = s.checkin && s.checkin.time, blocks = Array.isArray(s.busy) ? s.busy : [];
  const checkOpts = '<option value="">Off</option>' + CHECKIN_TIMES.map((t) => { const hm = t.split(":"); const d = new Date(); d.setHours(+hm[0], +hm[1], 0, 0); return '<option value="' + t + '"' + (ck === t ? " selected" : "") + ">" + fmtTime(d) + "</option>"; }).join("") + (ck && CHECKIN_TIMES.indexOf(ck) < 0 ? '<option value="' + esc(ck) + '" selected>' + esc(ck) + "</option>" : "");
  const calNote = !S.mcp ? '<p class="warn-text small">Phone features work when Game Plan is open inside Claude.</p>' : S.calStatus && !S.calStatus.ok ? '<p class="warn-text small">' + esc(S.calStatus.msg) + "</p>" : "";
  const cap = +s.nudgeCap || 5;
  let bs;
  if (s.bsCalendarId) {
    bs = '<p><span class="ok">Connected.</span> Checked ' + esc(ago(s.lastSync)) + '.</p><div class="row"><button type="button" class="btn sm" data-act="sync"' + (S.busy.sync ? " disabled" : "") + ">" + (S.busy.sync ? "Checking…" : "Check now") + '</button><button type="button" class="link" data-act="disconnect">Disconnect</button></div>';
  } else {
    bs = '<p class="muted small">Pull class deadlines in by themselves. One-time setup:</p><ol class="steps">' +
      (s.bsFeedUrl ? '<li><button type="button" class="btn sm" data-act="copyfeed">Copy my Brightspace link</button></li>' : "<li>In Brightspace, open Calendar, press Subscribe, copy the link.</li>") +
      '<li><a class="btn sm" href="https://calendar.google.com/calendar/r/settings/addbyurl" target="_blank" rel="noopener" data-act="opengcal">Open Google Calendar</a> Paste it, press <b>Add calendar</b>.</li>' +
      '<li><button type="button" class="btn sm" data-act="detect"' + (S.busy.cals ? " disabled" : "") + ">" + (S.busy.cals ? "Looking…" : "I added it") + "</button></li></ol>" +
      '<p class="muted small">Or <label class="link" for="icsFile" style="cursor:pointer">upload a Brightspace calendar file</label>.<input type="file" id="icsFile" accept=".ics,text/calendar" class="sr-only"></p>';
  }
  return '<div class="sheet-panel"><div class="sheet-head"><h2 id="sheetTitle">Settings</h2><button type="button" class="btn sm" data-act="closesettings" id="closeSheet">Close</button></div>' +
    '<section class="set"><h3>Smart nudges</h3><p class="muted small">Everything gets ranked by deadline, work left and your free time. Urgent things get up to 3 phone pings a day, start-today things get 1, the rest none. Pings for a task stop once you start it, quiet down if you keep skipping them, and drift toward the times that work for you. Picking a time with “When?” pings you right then.</p>' +
    '<label class="switch"><span>Nudges on</span><input type="checkbox" id="nudgeToggle"' + (s.nudges !== false ? " checked" : "") + "></label>" +
    '<div class="field"><label for="capSel">Most nudges in one day</label><select id="capSel">' + [3, 4, 5, 6, 8].map((v) => '<option value="' + v + '"' + (cap === v ? " selected" : "") + ">" + v + "</option>").join("") + "</select></div>" +
    '<div class="field"><span class="flabel">Usual busy times (nudges skip these)</span>' + (blocks.length ? '<ul class="busy-list">' + blocks.map((b, i) => "<li><span>" + esc(blockText(b)) + (b.label ? " · " + esc(b.label) : "") + '</span><button type="button" class="link" data-act="delbusy" data-i="' + i + '">Remove</button></li>').join("") + "</ul>" : '<p class="muted small">None yet. Tell the bar something like “class MWF 8 to 9:30, Con Ed Tue Thu 9 to 5”.</p>') + "</div>" +
    '<div class="field"><label for="checkinSel">Daily check-in on my phone</label><select id="checkinSel"' + (S.busy.checkin ? " disabled" : "") + ">" + checkOpts + "</select></div>" +
    '<label class="switch"><span>Routine reminders: 7:00 wake up, 9:30 night prep, 10:30 screens off</span><input type="checkbox" id="anchorToggle"' + ((s.anchors || []).length ? " checked" : "") + (S.busy.anchors ? " disabled" : "") + "></label>" + calNote + "</section>" +
    '<section class="set"><h3>Points and timer</h3><p class="muted small">Clocked time: +1 point every 10 minutes, with a coin sound. A plant blooms every 25 minutes you stay in. First step: +1. Finishing a task: its points.</p><form data-form="prefs" class="grid2"><div class="field"><label for="pfTarget">Daily points goal</label><input id="pfTarget" name="dailyTarget" type="number" min="1" max="60" value="' + esc(s.dailyTarget) + '"></div>' +
    '<div class="field"><button class="btn primary sm" type="submit">Save</button></div></form>' +
    '<label class="switch"><span>Sounds (coin every point, chime when a plant blooms)</span><input type="checkbox" id="soundToggle"' + (soundOn() ? " checked" : "") + "></label></section>" +
    '<section class="set"><h3>Your why</h3><p class="muted small">Shows up in your morning ping and on the timer.</p><form data-form="why" class="field"><textarea class="field-input" id="whyInput" name="why" rows="3" maxlength="240" aria-label="Your why" placeholder="The big reason behind all this">' + esc(s.why) + '</textarea><div class="row"><button class="btn primary sm" type="submit">Save</button></div></form></section>' +
    '<section class="set"><details><summary>Brightspace (optional)</summary>' + bs + "</details></section>" +
    '<section class="set"><h3>Start over</h3>' + (S.confirmClear ? '<p>This deletes every task, your chat and your stats. Your garden, habits and settings stay.</p><div class="row"><button type="button" class="btn danger sm" data-act="clearyes">Yes, clear it all</button><button type="button" class="btn sm" data-act="clearno">Keep everything</button></div>' : '<div class="row"><button type="button" class="btn sm" data-act="clearask">Clear my board</button></div>') + "</section></div>";
}

/* ---------- how to tackle it: a short plan plus places to look, made once per task ---------- */
function helperLinks(t) {
  const out = [];
  if (t.bsUrl) out.push({ label: bsLabel(t.bsUrl), href: t.bsUrl, kind: "bs" });
  ((t.helper && t.helper.links) || []).forEach((l) => {
    const q = String(l.query || "").slice(0, 120); if (!q) return;
    const yt = l.where === "youtube";
    out.push({ label: String(l.label || q).slice(0, 48), href: (yt ? "https://www.youtube.com/results?search_query=" : "https://www.google.com/search?q=") + encodeURIComponent(q), kind: yt ? "yt" : "web" });
  });
  return out;
}
function helperHtml(t, inHero) {
  const hp = t.helper, busy = S.helperBusy[t.id];
  let body;
  if (hp && hp.steps && hp.steps.length) {
    body = '<ol class="hp-steps">' + hp.steps.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ol>";
    const links = helperLinks(t);
    if (links.length) body += '<div class="hp-links">' + links.map((l) => '<a class="hp-link ' + l.kind + '" href="' + esc(l.href) + '" target="_blank" rel="noopener">' + ICON.ext + esc(l.label) + "</a>").join("") + "</div>";
    body += '<button type="button" class="link hp-redo" data-act="helper"' + (busy ? " disabled" : "") + ">" + (busy ? "Rethinking…" : "Make a new plan") + "</button>";
  } else if (busy) body = '<p class="hp-wait">Working out how to tackle this…</p>';
  else if (!S.sample || S.sampleOff) body = '<p class="hp-wait">Open Game Plan inside Claude to get a plan for this task.</p>' + (t.bsUrl ? '<div class="hp-links"><a class="hp-link bs" href="' + esc(t.bsUrl) + '" target="_blank" rel="noopener">' + ICON.ext + esc(bsLabel(t.bsUrl)) + "</a></div>" : "");
  else body = '<button type="button" class="btn sm" data-act="helper">Show me how to tackle it</button>';
  const open = isOpen("helper", true);
  return '<section class="helper' + (inHero ? " in-hero" : "") + '"><button type="button" class="hp-head" data-act="fold" data-sec="helper" aria-expanded="' + open + '">How to tackle it<span class="chev">' + CHEV_D + "</span></button>" + (open ? '<div class="hp-body">' + body + "</div>" : "") + "</section>";
}
function maybeHelper(t) {
  if (!t || t.status !== "open" || t.helper || S.helperBusy[t.id] !== undefined || !S.sample || S.sampleOff) return;
  setTimeout(() => makeHelper(t.id), 600);
}
async function makeHelper(id) {
  const t = S.tasks.get(id); if (!t || S.helperBusy[id] || !S.sample || S.sampleOff) return;
  S.helperBusy[id] = 1; scheduleRender();
  try {
    const r = await S.sample.json("Dylan is a junior CS student at Binghamton. Give him a quick, practical plan for tackling this task, plus where to look for help.\nTask: " + JSON.stringify(t.title) + (t.course ? "\nClass: " + t.course : "") + (t.due ? "\nDue: " + fmtDueLong(t.due) : "") + (t.notes ? "\nNotes: " + JSON.stringify(t.notes.slice(0, 600)) : "") + "\nAbout " + fmtMin(+t.estMin || 30) + " of work.\n" +
      'Reply with only JSON: {"steps": [3 to 5 short imperative steps in order, each under 90 characters, the first one tiny], "links": [2 to 4 searches that would help, each {"label": short button text under 40 characters, "query": a search query, "where": "google" or "youtube"}]}', { modelTier: "quick", cache: false });
    const steps = (Array.isArray(r && r.steps) ? r.steps : []).map((x) => String(x || "").trim().slice(0, 140)).filter(Boolean).slice(0, 6);
    const links = (Array.isArray(r && r.links) ? r.links : []).filter((l) => l && l.query).slice(0, 4).map((l) => ({ label: String(l.label || l.query).slice(0, 48), query: String(l.query).slice(0, 120), where: l.where === "youtube" ? "youtube" : "google" }));
    if (steps.length && S.tasks.has(id)) patchTask(id, { helper: { steps, links, at: new Date().toISOString() } });
  } catch (e) { if (e && /not_granted|disabled|not_declared/.test(String(e.code))) S.sampleOff = true; }
  S.helperBusy[id] = 0; scheduleRender();
}

/* task names inside calendar days (wide screens), so the month reads at a glance */
function calChips(it) {
  if (!it) return "";
  const list = it.over.concat(it.due).slice(0, 2), more = it.over.length + it.due.length - list.length;
  return list.length ? '<span class="cal-chips">' + list.map((t) => '<span class="cal-chip' + (it.over.indexOf(t) >= 0 ? " over" : "") + '" style="--cc:' + courseColor(t.course) + '">' + esc(t.title) + "</span>").join("") + (more > 0 ? '<span class="cal-more">+' + more + "</span>" : "") + "</span>" : "";
}

/* the task's own Claude chat: Start opens it; paste once, change any time */
function chatRow(t) {
  if (t.chatUrl && S.editLink !== t.id) return '<div class="chat-row saved">' + ICON.chat + '<span>Start opens <a href="' + esc(t.chatUrl) + '" target="_blank" rel="noopener">your chat for this</a></span><button type="button" class="link" data-act="editlink">Change</button></div>';
  return '<form class="chat-row" data-form="link">' + ICON.chat + '<input id="hl-' + esc(t.id) + '" name="url" type="url" inputmode="url" autocomplete="off" placeholder="' + (t.chatUrl ? "Paste the new chat link" : "After Start, paste the chat’s link here") + '" aria-label="Claude chat link for this task">' +
    '<button class="btn sm" type="submit">Save</button>' + (t.chatUrl ? '<button type="button" class="link" data-act="editlink">Cancel</button>' : "") + "</form>";
}

/* turning points into a verdict: the daily goal is the line between a good day and a slow one */
function dayBand(p, goal) {
  if (p >= goal * 1.5) return { cls: "great", word: "Great", line: "Well past your goal. This is the pace that keeps everything ahead of deadlines." };
  if (p >= goal) return { cls: "good", word: "Good", line: "At or above your daily goal. Keep finishing things at this rate." };
  if (p >= goal * 0.5) return { cls: "mid", word: "Okay", line: "Some progress, but under your goal. Finishing one more task usually closes the gap." };
  if (p > 0) return { cls: "low", word: "Slow", line: "Barely started. Pick the smallest open task and finish it." };
  return { cls: "low", word: "Empty", line: "No points yet. One first step gets you on the board." };
}
function pointsGuide(goal) {
  const row = (a, b) => "<tr><td>" + a + "</td><td>" + b + "</td></tr>";
  return '<div class="pguide"><p>Points come from <b>finishing work</b>. Every task is sized when it is added, so a bigger, harder task is worth more.</p>' +
    '<table class="ptable"><thead><tr><th>Task size</th><th>Points when done</th></tr></thead><tbody>' +
    row("Under 15 min (quick email, short form)", "1") + row("15 to 30 min (discussion post, short quiz)", "2") + row("30 to 60 min (homework set, journal)", "3") +
    row("1 to 2 hours (essay section, lab)", "5") + row("2 to 4 hours or hard (project part, exam prep)", "8") + row("4+ hours, several sittings (final paper, big project)", "13") + "</tbody></table>" +
    "<p>Small extras: <b>+1</b> for doing a task's first step, <b>+1</b> for every 10 minutes on the timer. Finishing is where almost all the points are.</p>" +
    '<p>Your daily goal is <b>' + goal + " points</b>, about one or two real assignments a day. Change it in Settings.</p>" +
    '<ul class="bands"><li class="great"><b>' + Math.ceil(goal * 1.5) + "+</b> Great day</li><li class=\"good\"><b>" + goal + "+</b> Good day, goal hit</li><li class=\"mid\"><b>" + Math.ceil(goal / 2) + "–" + (goal - 1) + "</b> Okay, under goal</li><li class=\"low\"><b>0–" + (Math.ceil(goal / 2) - 1) + "</b> Slow day</li></ul></div>";
}

/* time on the timer, just for the record: it doesn't decide anything */
function timeChart(data) {
  const max = Math.max(60, ...data.map((x) => x.m)), total = data.reduce((n, x) => n + x.m, 0), days = data.filter((x) => x.m >= 1).length;
  const bars = data.map((x) => { const tip = x.d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ": " + fmtMin(x.m); return '<div class="bar-col" tabindex="0" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '"><i class="tm' + (x.today ? " today" : "") + (x.m ? "" : " zero") + '" style="height:' + (x.m ? Math.max((x.m / max) * 100, 3) : 0) + '%"></i></div>'; }).join("");
  const dl = data.map((x) => '<span class="' + (x.today ? "is-today" : "") + '">' + esc(x.d.toLocaleDateString([], { weekday: "narrow" })) + "</span>").join("");
  return '<div class="week"><div class="bars">' + bars + '</div><div class="days">' + dl + '</div><p class="week-line"><b>' + fmtMin(total) + "</b> on the timer over " + days + (days === 1 ? " day" : " days") + (days ? ", about " + fmtMin(total / days) + " on days you used it" : "") + ". Just for the record; points are what count.</p></div>";
}

function linksRow(t) {
  const links = t.links || [], adding = S.addLink === t.id;
  let h = '<div class="links-row">' + (t.bsUrl ? bsBtn(t, "bs-pill") : "") +
    links.map((l, i) => '<span class="lk"><a class="lk-pill" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + ICON.ext + esc(l.label) + '</a><button type="button" class="lk-x" data-act="dellink" data-i="' + i + '" aria-label="' + esc("Remove " + l.label) + '">' + ICON.del + "</button></span>").join("") +
    (adding ? "" : '<button type="button" class="lk-add" data-act="addlink">' + ICON.add + "Link</button>") + "</div>";
  if (adding) h += '<form class="lk-form" data-form="tasklink"><input id="tl-' + esc(t.id) + '" name="url" type="url" inputmode="url" autocomplete="off" placeholder="Paste a link (doc, video, rubric…)" aria-label="Link to add"><button class="btn sm" type="submit">Add</button><button type="button" class="link" data-act="addlink">Cancel</button></form>';
  return h;
}

/* big screens: the timer sits at the top of the right column, no overlay, no extra clicks */
const DK_C = 2 * Math.PI * 70;
function renderDock() {
  const el = $("#dock"); if (!el) return;
  const tm = S.timer, task = tm && S.tasks.get(tm.taskId), show = !!(tm && task && ready() && isWide() && !S.focusOpen && S.view === "today");
  const sig = show ? [tm.sid, task.title, task.chatUrl || "", task.status, isDark()].join("|") : "";
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  if (!show) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = '<section class="dock" data-id="' + esc(task.id) + '"><div class="dk-art"><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="70" class="dk-track"/><circle id="dkRing" cx="80" cy="80" r="70" class="dk-ring" stroke-dasharray="' + f1(DK_C) + '" stroke-dashoffset="' + f1(DK_C) + '" transform="rotate(-90 80 80)"/><g transform="translate(80 122)"><g transform="scale(.62)">' + potSVG() + '</g><g transform="translate(0 -3) scale(.56)"><g class="sway" id="dkPlant"></g></g></g></svg></div>' +
    '<div class="dk-main"><p class="dk-k"><i class="live-dot"></i>Clocked in</p><p class="dk-title">' + esc(task.title) + '</p><div class="dk-clock" data-clock>0:00</div><p class="dk-meta"><b id="dkPts">+0 pts</b> <span id="dkStage"></span></p>' +
    '<div class="dk-actions"><button type="button" class="btn sm primary" data-act="stoptimer">' + ICON.stop + 'Stop and save</button><button type="button" class="btn sm" data-act="complete">' + ICON.check + "Done</button>" +
    (task.chatUrl ? '<a class="btn sm" href="' + esc(task.chatUrl) + '" target="_blank" rel="noopener">' + ICON.chat + "Chat</a>" : "") + '<button type="button" class="link" data-act="maxfocus">Full screen</button></div>' +
    '<div class="ask" data-ask hidden><span>Still working?</span><div class="row"><button type="button" class="btn sm primary" data-act="stillhere">Still going</button><button type="button" class="btn sm" data-act="adjust">I stopped earlier</button></div></div></div></section>';
  tick();
}
