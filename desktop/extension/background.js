/* Game Plan Focus: watches tab URLs (typed, clicked, and in-page navigation like YouTube → Shorts).
   During a Game Plan timer, a matching site is replaced by return.html.
   Night lock: 10:30pm-7am, streaming and short-video sites need a typed sentence to open (works even if Game Plan is off).
   Rules come from Game Plan; if Game Plan closes, the last rules stay on only until the block would have ended. */
import { norm, matches, isProtecting } from "./rules.js";
import { latestLe, parseMySubmissions, parseFolderList, parseQuizSummary } from "./bs.js";

const DEFAULT_BASE = "http://127.0.0.1:4317";
const NIGHT = ["youtube.com", "netflix.com", "hulu.com", "tiktok.com", "instagram.com"];
const nightNow = (d = new Date()) => { const m = d.getHours() * 60 + d.getMinutes(); return m >= 22 * 60 + 30 || m < 7 * 60; };
let cache = null;

async function base() { const { base } = await chrome.storage.local.get("base"); return base || DEFAULT_BASE; }

async function state(force) {
  if (!force && cache && Date.now() - cache.at < 2500) return cache.data;
  try {
    const r = await fetch((await base()) + "/api/focus", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    cache = { at: Date.now(), data };
    if (data.bs_check) bsCheck();                 // Game Plan asked: check Brightspace now
    await chrome.storage.session.set({ last: data });
    badge(data);
    return data;
  } catch {
    const { last } = await chrome.storage.session.get("last");
    const ok = isProtecting(last);
    badge(ok ? last : null);
    return ok ? last : null;          // Game Plan is closed: protect only until the block's end
  }
}

function badge(st) {
  chrome.action.setBadgeText({ text: isProtecting(st) ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#F97316" });
}

const recent = new Map();            // tabId → last url handled (avoid double redirects)
async function check(tabId, url) {
  if (!url || !/^https?:/.test(url) || tabId < 0) return;
  const n = norm(url);
  if (/^(127\.0\.0\.1|localhost)\/__gp_test_distraction/.test(n)) return redirect(tabId, url, true);
  if (nightNow() && NIGHT.some((s) => matches(n, s))) {
    const { nightUntil = 0 } = await chrome.storage.local.get("nightUntil");
    if (Date.now() > nightUntil) return redirect(tabId, url, false, true);
  }
  const st = await state();
  if (!isProtecting(st)) return;
  const now = Date.now(), p = st.protect || {};
  if ((p.exceptions || []).some((e) => matches(n, e.pattern))) return;
  if ((st.session.allow || []).some((a) => new Date(a.until) > now && matches(n, a.pattern))) return;
  const { passes = {} } = await chrome.storage.session.get("passes");
  if (Object.entries(passes).some(([k, until]) => until > now && matches(n, k))) return;
  if ((p.distractions || []).some((d) => matches(n, d))) redirect(tabId, url, false);
}

function redirect(tabId, url, test, night) {
  if (recent.get(tabId) === url) return;
  recent.set(tabId, url);
  setTimeout(() => recent.delete(tabId), 1500);
  chrome.tabs.update(tabId, { url: chrome.runtime.getURL("return.html") + "?from=" + encodeURIComponent(url) + (test ? "&test=1" : "") + (night ? "&night=1" : "") });
}

chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url) check(tabId, info.url); });
chrome.tabs.onActivated.addListener(async ({ tabId }) => { try { const t = await chrome.tabs.get(tabId); check(tabId, t.url); } catch {} });
chrome.webNavigation.onBeforeNavigate.addListener((d) => { if (d.frameId === 0) check(d.tabId, d.url); });
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => { if (d.frameId === 0) check(d.tabId, d.url); });

async function hello() {
  try {
    await fetch((await base()) + "/api/focus", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Game-Plan": "1" },
      body: JSON.stringify({ action: "hello", device: "extension", version: chrome.runtime.getManifest().version }),
    });
  } catch {}
  state(true);
}
chrome.alarms.create("hello", { periodInMinutes: 1 });
chrome.alarms.create("bs", { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((a) => (a.name === "bs" ? bsCheck() : hello()));
chrome.runtime.onStartup.addListener(hello);
chrome.runtime.onInstalled.addListener(hello);
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg && msg.type === "hello") { hello().then(() => reply({ ok: true })); return true; }
  if (msg && msg.type === "state") { state(true).then((st) => reply(st)); return true; }
  if (msg && msg.type === "bscheck") { bsCheck().then((r) => reply(r)); return true; }
});
hello();

/* ---------- Brightspace: submitted there = done in Game Plan ----------
   Uses the Brightspace login already in this Chrome. Only reads; never submits or changes anything there. */
let bsRunning = null;
function bsCheck() {
  if (!bsRunning) bsRunning = runBsCheck().finally(() => { bsRunning = null; });
  return bsRunning;
}
async function runBsCheck() {
  const gp = await base();
  let list;
  try { list = await (await fetch(gp + "/api/brightspace/tasks", { cache: "no-store" })).json(); } catch { return { error: "Game Plan isn't running" }; }
  const { host, tasks } = list;
  if (!host || !tasks.length) return { checked: 0 };
  if (!(await chrome.permissions.contains({ origins: [`https://${host}/*`] }))) return report(gp, [], "not_connected");
  const root = `https://${host}`, get = (path) => fetch(root + path, { credentials: "include", cache: "no-store" });
  let ver = "1.67";
  try { const v = await get("/d2l/api/versions/"); if (v.ok && !/login/i.test(v.url)) ver = latestLe(await v.json()) || ver; } catch {}
  const results = [], pages = {};
  for (const t of tasks) {
    let r = null;
    try {
      if (t.kind === "dropbox") {
        const res = await get(`/d2l/api/le/${ver}/${t.ou}/dropbox/folders/${t.item}/submissions/mysubmissions/`);
        if (/\/login/i.test(res.url)) return report(gp, [], "login");
        if (res.ok && /json/.test(res.headers.get("content-type") || "")) r = parseMySubmissions(await res.json());
        if (!r || r.submitted === null) {
          pages[t.ou] = pages[t.ou] || await (await get(`/d2l/lms/dropbox/user/folders_list.d2l?ou=${t.ou}&isprv=0`)).text();
          r = parseFolderList(pages[t.ou], t.item);
        }
      } else if (t.kind === "quiz") {
        const res = await get(`/d2l/lms/quizzing/user/quiz_summary.d2l?ou=${t.ou}&qi=${t.item}`);
        if (/\/login/i.test(res.url)) return report(gp, [], "login");
        r = parseQuizSummary(await res.text());
      }
    } catch {}
    results.push({ id: t.id, submitted: r ? r.submitted : null, date: (r && r.date) || null });
  }
  return report(gp, results, "");
}
async function report(gp, results, error) {
  try {
    const r = await fetch(gp + "/api/brightspace/report", { method: "POST", headers: { "Content-Type": "application/json", "X-Game-Plan": "1" },
                                                           body: JSON.stringify({ results, error }) });
    const out = await r.json();
    return { checked: results.length, updated: out.updated || [], error };
  } catch { return { error: "Game Plan isn't running" }; }
}
chrome.runtime.onInstalled.addListener(async () => {   // first install or reload: offer the one-click connect
  try {
    const { host } = await (await fetch((await base()) + "/api/brightspace/tasks")).json();
    if (host && !(await chrome.permissions.contains({ origins: [`https://${host}/*`] }))) chrome.tabs.create({ url: chrome.runtime.getURL("connect.html") });
    else bsCheck();
  } catch {}
});
