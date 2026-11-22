import { norm, matches, patternFor, gerund } from "./rules.js";

const q = new URLSearchParams(location.search);
const from = q.get("from") || "";
const test = q.get("test") === "1";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const site = (() => { try { return new URL(from).hostname.replace(/^www\./, ""); } catch { return "that site"; } })();

async function base() { const { base } = await chrome.storage.local.get("base"); return base || "http://127.0.0.1:4317"; }
async function post(body) {
  const r = await fetch((await base()) + "/api/focus", { method: "POST", headers: { "Content-Type": "application/json", "X-Game-Plan": "1" }, body: JSON.stringify(Object.assign({ device: "extension", reqId: crypto.randomUUID() }, body)) });
  if (!r.ok) throw new Error("Game Plan didn't answer");
  return r.json();
}
const lower = (s) => s ? s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, "") : "";
const step = (s) => String(s || "").replace(/^([^:>]{2,40}>\s*)+[^:]{2,80}:\s*/, "");

async function main() {
  if (test) {
    try { await fetch((await base()) + "/api/ext/tested", { method: "POST", headers: { "Content-Type": "application/json", "X-Game-Plan": "1" }, body: "{}" }); } catch {}
    $("#m").innerHTML = `<div class="k ok">Protection test passed</div><h1>The extension stepped in.</h1><p>During a focus block, the sites you picked get this screen instead. You can close this tab.</p><div class="row"><button class="go" id="close">Close test tab</button></div>`;
    $("#close").onclick = () => chrome.tabs.getCurrent((t) => chrome.tabs.remove(t.id));
    $("#close").focus();
    return;
  }
  const st = await chrome.runtime.sendMessage({ type: "state" }).catch(() => null);
  const s = st && st.session;
  if (!s) {
    $("#m").innerHTML = `<h1>No focus block right now.</h1><p>Go ahead.</p><div class="row"><button class="go" id="cont">Continue to ${esc(site)}</button></div>`;
    $("#cont").onclick = () => (location.href = from);
    return;
  }
  const delay = (st.protect && st.protect.continueDelay) ?? 20, classMin = (st.protect && st.protect.classAllowMin) || 10;
  const left = Math.max(0, Math.round((s.remainingSec || 0) / 60));
  $("#m").innerHTML = `<div class="k">Focus block · ${left} min left</div>
    <h1>You were ${esc(gerund(s.step) || "working on " + s.title)} for ${esc(s.title)}.</h1>
    <p>${esc(site)} can wait ${left} minutes. Your timer is still running.</p>
    <div class="row"><button class="go" id="ret">Return to ${esc(s.title.length > 30 ? "assignment" : s.title)}</button></div>
    <div class="row" style="margin-top:14px">
      <button id="cls">It's for class (${classMin} min)</button>
      <button id="cont" disabled>Continue anyway</button>
      <button class="ghost" id="end">End focus</button>
    </div>
    <p class="small" id="note">${delay ? `"Continue anyway" unlocks in <span id="sec">${delay}</span>s.` : ""}</p>`;
  $("#ret").focus();
  $("#ret").onclick = async () => {
    const me = await chrome.tabs.getCurrent();
    const want = s.url ? norm(s.url).split("?")[0] : null;
    const tabs = want ? await chrome.tabs.query({}) : [];
    const hit = tabs.find((t) => t.id !== me.id && t.url && norm(t.url).split("?")[0] === want) || tabs.find((t) => t.id !== me.id && t.url && want && matches(norm(t.url), want.split("/")[0]) && /brightspace/.test(want));
    if (hit) {
      await chrome.tabs.update(hit.id, { active: true });
      await chrome.windows.update(hit.windowId, { focused: true });
      chrome.tabs.remove(me.id);
    } else if (s.url) location.href = s.url;
    else location.href = (await base()) + "/";
  };
  $("#cls").onclick = async () => {
    try { await post({ action: "allow", pattern: patternFor(from), minutes: classMin }); } catch {}
    location.href = from;
  };
  $("#end").onclick = async () => {
    try { await post({ action: "endFocus" }); } catch {}
    location.href = from;
  };
  let n = delay;
  const btn = $("#cont");
  const unlock = () => { btn.disabled = false; $("#note").textContent = "Continuing gives you 5 minutes on this site."; };
  if (!n) unlock();
  else { const iv = setInterval(() => { n--; const e = $("#sec"); if (e) e.textContent = n; if (n <= 0) { clearInterval(iv); unlock(); } }, 1000); }
  btn.onclick = async () => {
    const { passes = {} } = await chrome.storage.session.get("passes");
    passes[patternFor(from)] = Date.now() + 5 * 60000;
    await chrome.storage.session.set({ passes });
    location.href = from;
  };
}
main();
