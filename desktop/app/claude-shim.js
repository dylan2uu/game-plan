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
      cache = await r.json();
      listeners.forEach(fire);
    } catch (e) { listeners.forEach((l) => l.err && l.err({ code: "unavailable" })); }
  }
  const ready = pull();
  setInterval(pull, 3000);                                        // pick up Brightspace syncs + Obsidian edits
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });

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
    if (j.db) { cache = j.db; setTimeout(() => listeners.forEach(fire), 0); }
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
