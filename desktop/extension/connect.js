const $ = (s) => document.querySelector(s);
async function base() { const { base } = await chrome.storage.local.get("base"); return base || "http://127.0.0.1:4317"; }
const st = (msg, cls = "") => { $("#st").textContent = msg; $("#st").className = cls; };

let host = null;
(async () => {
  try { host = (await (await fetch((await base()) + "/api/brightspace/tasks")).json()).host; } catch {}
  if (!host) { $("#go").disabled = true; st("Game Plan isn't running, or has no Brightspace tasks yet. Open Game Plan, then reload this page.", "bad"); return; }
  if (await chrome.permissions.contains({ origins: [`https://${host}/*`] })) { $("#go").textContent = "Check Brightspace now"; st(`Connected to ${host}.`, "ok"); }
})();

$("#go").onclick = async () => {
  if (!host) return;
  if (!(await chrome.permissions.request({ origins: [`https://${host}/*`] }))) return st("Not connected. Press the button again when you're ready.", "bad");
  $("#go").disabled = true;
  st("Connected. Checking your submissions…");
  const r = await chrome.runtime.sendMessage({ type: "bscheck" });
  $("#go").disabled = false;
  $("#go").textContent = "Check Brightspace now";
  if (r && r.error === "login") return st(`Log in to ${host} in this Chrome, then press the button again.`, "bad");
  if (!r || r.error) return st((r && r.error) || "The check didn't finish. Try again.", "bad");
  st(`Checked ${r.checked} assignments. ` + (r.updated.length ? `Marked done in Game Plan: ${r.updated.join(", ")}.` : "Nothing new to mark done."), "ok");
};
