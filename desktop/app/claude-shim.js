/* Game Plan desktop adapter.
   v1 was built as a claude.ai artifact and calls window.claude.use("db" | "sample" | "user" | "mcp").
   This file provides the same API on your Mac, backed by server.py:
     db     → your Obsidian vault (assignment notes) + System/gameplan.json
     sample → local `claude -p` (your Claude subscription)
     user   → always the owner (it's your machine)
     mcp    → not available yet (Google Calendar nudges stay off) */
(function () {
  "use strict";
  const H = { "Content-Type": "application/json", "X-Game-Plan": "1" };
  let cache = null;
  const listeners = [];
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

  async function pull() {
    try {
      const r = await fetch("/api/db", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const prev = cache;
      cache = await r.json();
      announce(prev);
      listeners.forEach(fire);
    } catch (e) { listeners.forEach((l) => l.err && l.err({ code: "unavailable" })); }
  }
  const ready = pull();
  setInterval(pull, 3000);                                        // pick up Brightspace syncs + Obsidian edits
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });

  /* tell the dopamine layer what changed: gp:data every refresh, gp:done when a task gets finished */
  function announce(prev) {
    window.__gp = cache;
    document.dispatchEvent(new CustomEvent("gp:data", { detail: cache }));
    if (!prev) return;
    Object.entries(cache.tasks || {}).forEach(([id, t]) => {
      const before = prev.tasks && prev.tasks[id];
      if (t.status === "done" && before && before.status !== "done")
        document.dispatchEvent(new CustomEvent("gp:done", { detail: { id, title: t.title, points: t.points || 1, course: t.course } }));
    });
  }
  function docData(path) {
    const [c, id] = path.split("/");
    const src = c === "tasks" ? cache.tasks : cache.meta;
    return src ? src[id] : undefined;
  }
  function docSnap(path) {
    const d = docData(path), id = path.split("/")[1];
    return { id, exists: d != null, data: () => clone(d) };
  }
  function fire(l) {
    if (!cache) return;
    const val = l.col ? cache.tasks : docData(l.path) ?? null;
    const sig = JSON.stringify(val);
    if (sig === l.last) return;
    l.last = sig;
    try { l.cb(l.col ? { docs: Object.keys(cache.tasks).map((id) => docSnap("tasks/" + id)) } : docSnap(l.path)); }
    catch (e) { console.error(e); }
  }
  async function write(op, path, data) {
    const r = await fetch("/api/db", { method: "POST", headers: H, body: JSON.stringify({ op, path, data: clone(data) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw { code: j.code || "unavailable", message: j.error || "write failed" };
    if (j.db) { const prev = cache; cache = j.db; announce(prev); setTimeout(() => listeners.forEach(fire), 0); }
  }
  function listen(entry) {
    listeners.push(entry); fire(entry);
    return () => { const i = listeners.indexOf(entry); if (i >= 0) listeners.splice(i, 1); };
  }

  const db = {
    collection: (name) => ({ onSnapshot: (cb, err) => listen({ col: true, cb, err }) }),
    doc: (path) => ({
      get: async () => { await pull(); return docSnap(path); },
      set: (data) => write("set", path, data),
      update: (data) => write("update", path, data),
      delete: () => write("delete", path, null),
      onSnapshot: (cb, err) => listen({ path, cb, err }),
    }),
  };

  const sample = {
    async json(prompt, opts) {
      const r = await fetch("/api/ai", { method: "POST", headers: H, body: JSON.stringify({ prompt, tier: (opts && opts.modelTier) || "quick" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw { code: j.code || "unavailable", message: j.error };
      return j.result;
    },
  };

  window.claude = {
    use: async (name) => {
      if (name === "db") { await ready; return cache ? db : null; }
      if (name === "sample") return sample;
      if (name === "user") return { isOwner: async () => true };
      return null;   // "mcp": Google Calendar isn't wired up on desktop yet
    },
  };
})();

/* ---------- Start → Claude Code in Terminal (on this Mac only) ----------
   v1's Start/quick-start links point at claude.ai/new?q=<task>. On the Mac we stop the browser
   from opening that link and ask the server to open Terminal with Claude Code instead.
   v1's own click handler still runs (timer, "first step done", points). Phones keep claude.ai. */
(function () {
  const onMac = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && /Mac/.test(navigator.platform);
  if (!onMac) return;
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="https://claude.ai/new?q="]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;     // ⌘-click still opens claude.ai
    e.preventDefault();                                           // no new tab; v1 handlers still fire
    const task = new URL(a.href).searchParams.get("q") || "";
    fetch("/api/launch", { method: "POST", headers: { "Content-Type": "application/json", "X-Game-Plan": "1" }, body: JSON.stringify({ task }) })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => window.open(a.href, "_blank", "noopener"));   // fallback: claude.ai
  }, true);
})();
