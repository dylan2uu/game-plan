const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const st = document.getElementById("st"), baseIn = document.getElementById("base");
chrome.storage.local.get("base").then(({ base }) => { baseIn.value = base || ""; });
document.getElementById("save").onclick = async () => {
  const v = baseIn.value.trim();
  if (v && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(v)) { st.textContent = "Use http://127.0.0.1:PORT"; return; }
  await chrome.storage.local.set({ base: v || null }); chrome.runtime.sendMessage({ type: "hello" }); refresh();
};
async function refresh() {
  const s = await chrome.runtime.sendMessage({ type: "state" }).catch(() => null);
  if (!s) { st.innerHTML = '<span class="dot"></span>Game Plan isn\'t reachable (or no block is running).'; return; }
  const ss = s.session;
  st.innerHTML = ss && ss.state === "active"
    ? `<span class="dot on"></span>Protecting: ${esc(ss.title)}. ${Math.round(ss.remainingSec / 60)} min left.`
    : `<span class="dot on"></span>Connected. Protection turns on when a block starts.`;
}
refresh();
