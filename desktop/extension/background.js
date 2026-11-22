/* Game Plan Focus: watches tab URLs (typed, clicked, and in-page navigation like YouTube → Shorts).
   During an active Game Plan block, a matching site is replaced by return.html.
   Rules come from Game Plan; if Game Plan closes, the last rules stay on only until the block would have ended. */
import { norm, matches, isProtecting } from "./rules.js";

const DEFAULT_BASE = "http://127.0.0.1:4317";
let cache = null;

async function base() { const { base } = await chrome.storage.local.get("base"); return base || DEFAULT_BASE; }

async function state(force) {
  if (!force && cache && Date.now() - cache.at < 2500) return cache.data;
  try {
    const r = await fetch((await base()) + "/api/focus", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    cache = { at: Date.now(), data };
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
  const st = await state();
  if (!isProtecting(st)) return;
  const now = Date.now(), p = st.protect || {};
  if ((p.exceptions || []).some((e) => matches(n, e.pattern))) return;
  if ((st.session.allow || []).some((a) => new Date(a.until) > now && matches(n, a.pattern))) return;
  const { passes = {} } = await chrome.storage.session.get("passes");
  if (Object.entries(passes).some(([k, until]) => until > now && matches(n, k))) return;
  if ((p.distractions || []).some((d) => matches(n, d))) redirect(tabId, url, false);
}

function redirect(tabId, url, test) {
  if (recent.get(tabId) === url) return;
  recent.set(tabId, url);
  setTimeout(() => recent.delete(tabId), 1500);
  chrome.tabs.update(tabId, { url: chrome.runtime.getURL("return.html") + "?from=" + encodeURIComponent(url) + (test ? "&test=1" : "") });
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
chrome.alarms.onAlarm.addListener(hello);
chrome.runtime.onStartup.addListener(hello);
chrome.runtime.onInstalled.addListener(hello);
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg && msg.type === "hello") { hello().then(() => reply({ ok: true })); return true; }
  if (msg && msg.type === "state") { state(true).then((st) => reply(st)); return true; }
});
hello();
