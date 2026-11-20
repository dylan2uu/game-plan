#!/usr/bin/env python3
"""Game Plan desktop server.

Serves the one-page app at http://127.0.0.1:4317 and reads/writes tasks straight from the
Obsidian vault (the same assignment notes the Brightspace sync creates). No second task system:
the vault is the database.

Usage: python3 server.py [--port 4317] [--vault ~/Obsidian/Vault] [--dry-run]
  --dry-run  print the current task state as JSON and exit (no server, no writes)
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge  # noqa: E402  (v1 database + AI on top of the vault)
import launcher  # noqa: E402  (Start → Claude Code in Terminal)

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(HERE, "app")
VAULT = os.path.expanduser(os.environ.get("GP_VAULT", "~/Obsidian/Vault"))


def load_vaultlib(vault):
    """Reuse the vault's own helpers so Game Plan and today.py read notes the same way."""
    sys.path.insert(0, os.path.join(vault, "System", "scripts"))
    import vaultlib  # noqa: E402
    return vaultlib


# ---------- task logic ----------
def why_text(t, today):
    """One plain-English line on why this task, right now."""
    if not t["due"]:
        return "No due date. A tiny start keeps it from piling up."
    days = (t["due"] - today).days
    if t["status"] == "doing":
        return "You already started. Picking it back up is the easiest win today."
    if days < 0:
        return f"It's {-days} day{'s' if -days != 1 else ''} late. Getting it in now still beats a zero."
    if days == 0:
        return "Due tonight. Five minutes now beats a panic at 11pm."
    if days == 1:
        return "Due tomorrow. Starting today means no all-nighter."
    return f"Due {t['due']:%A}. A small start now makes it way lighter later."


def rank_key(t, today):
    """Doing first, then overdue (oldest first), then soonest due. Undated last."""
    due = t["due"] or dt.date.max
    return (0 if t["status"] == "doing" else 1, due)


def task_json(vl, vault, a, today):
    rel = os.path.relpath(a["path"], vault)
    title = re.sub(r"^\d{4}-\d{2}-\d{2}\s+", "", a["title"])
    title = re.sub(r"\s*-\s*Due$", "", title)
    return {
        "id": rel, "title": title, "class": a["class"], "status": a["status"],
        "due": a["due"].isoformat() if a["due"] else None,
        "days": (a["due"] - today).days if a["due"] else None,
        "first_step": a["first_step"] or "Open it and write 3 bullets of what it's actually asking",
        "why": why_text(a, today),
        "obsidian": "obsidian://open?path=" + urllib.parse.quote(a["path"]),
    }


def state(vl, vault):
    today = dt.date.today()
    all_a = vl.assignments(vault)
    open_a = sorted([a for a in all_a if a["status"] != "done"], key=lambda a: rank_key(a, today))
    week_start = today - dt.timedelta(days=today.weekday())
    week_end = week_start + dt.timedelta(days=6)
    this_week = [a for a in all_a if a["due"] and week_start <= a["due"] <= week_end]
    month_from = today.replace(day=1) - dt.timedelta(days=7)
    cal = [task_json(vl, vault, a, today) for a in all_a
           if a["due"] and month_from <= a["due"] <= today + dt.timedelta(days=62)]
    done_on = {a["path"]: vl.read_frontmatter(a["path"]).get("done", "") for a in all_a if a["status"] == "done"}
    return {
        "today": today.isoformat(),
        "week": [task_json(vl, vault, a, today) for a in sorted(this_week, key=lambda a: a["due"])],
        "done_today": [task_json(vl, vault, a, today) for a in all_a if done_on.get(a["path"]) == today.isoformat()],
        "hero": task_json(vl, vault, open_a[0], today) if open_a else None,
        "open": [task_json(vl, vault, a, today) for a in open_a],
        "calendar": cal,
        "progress": {"done": sum(a["status"] == "done" for a in this_week), "total": len(this_week)},
    }


def safe_note(vl, vault, rel):
    """Only allow assignment notes inside the vault (no ../ tricks)."""
    p = os.path.realpath(os.path.join(vault, rel))
    if not p.startswith(os.path.realpath(vault) + os.sep) or not p.endswith(".md") or not os.path.exists(p):
        return None
    return p if vl.read_frontmatter(p).get("type") == "assignment" else None


def set_field(path, key, value):
    """Set a frontmatter field, adding it if missing (value None removes it)."""
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return
    lines = [l for l in m.group(1).split("\n") if not l.startswith(key + ":")]
    if value is not None:
        lines.append(f"{key}: {value}")
    open(path, "w", encoding="utf-8").write("---\n" + "\n".join(lines) + "\n---\n" + text[m.end():])


def log_started(vl, vault, title, step):
    """Add '- HH:MM title → step' under ## Started in today's daily note (same format as /start)."""
    p = vl.daily_note(vault)
    text = open(p, encoding="utf-8").read()
    line = f"- {dt.datetime.now():%H:%M} {title} → {step} (Game Plan)"
    if "## Started" in text:
        text = re.sub(r"(## Started\n)(-\s*\n)?", lambda m: m.group(1) + line + "\n", text, count=1)
    else:
        text = text.rstrip() + "\n\n## Started\n" + line + "\n"
    open(p, "w", encoding="utf-8").write(text)


def claude_url(t):
    due = f", due {t['due']}" if t["due"] else ""
    prompt = (f"Help me start this {t['class']} task: {t['title']}{due}.\n"
              f"My first step: {t['first_step']}.\n"
              "Keep it small: walk me through just the first step, then ask before going further.")
    return "https://claude.ai/new?q=" + urllib.parse.quote(prompt)


# ---------- HTTP ----------
class Handler(BaseHTTPRequestHandler):
    vl = None
    vault = VAULT
    port = 4317

    def log_message(self, fmt, *args):  # quiet
        pass

    def _host_ok(self):
        # Block DNS-rebinding: only answer requests addressed to this machine.
        return self.headers.get("Host", "") in (f"127.0.0.1:{self.port}", f"localhost:{self.port}")

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "forbidden"})
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/state":
            return self._send(200, state(self.vl, self.vault))
        if path == "/api/db":
            bridge.size_pending(self.vl, self.vault)      # background; returns immediately
            return self._send(200, bridge.snapshot(self.vl, self.vault))
        types = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
                 ".json": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png"}
        name = "index.html" if path == "/" else path.lstrip("/")
        full = os.path.realpath(os.path.join(APP_DIR, name))
        ext = os.path.splitext(full)[1]
        if full.startswith(os.path.realpath(APP_DIR) + os.sep) and ext in types and os.path.isfile(full):
            return self._send(200, open(full, "rb").read(), types[ext])
        self._send(404, {"error": "not found"})

    def do_POST(self):
        # Custom header = browsers must preflight cross-site requests, which we never approve.
        if not self._host_ok() or self.headers.get("X-Game-Plan") != "1":
            return self._send(403, {"error": "forbidden"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 2) or b"{}")
        except ValueError:
            return self._send(400, {"error": "bad json"})
        route = urllib.parse.urlparse(self.path).path
        if route == "/api/db":
            try:
                bridge.write(self.vl, self.vault, body.get("op"), body.get("path"), body.get("data"))
            except bridge.DBError as e:
                return self._send(400, {"code": e.code, "error": str(e)})
            return self._send(200, {"ok": True, "db": bridge.snapshot(self.vl, self.vault)})
        if route == "/api/launch":
            try:
                folder = launcher.launch(self.vl, self.vault, body.get("task", ""))
            except (ValueError, OSError, subprocess.CalledProcessError) as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, {"ok": True, "folder": folder})
        if route == "/api/ai":
            try:
                return self._send(200, {"result": bridge.ai_json(str(body.get("prompt", ""))[:20000], body.get("tier", "quick"))})
            except bridge.DBError as e:
                return self._send(502, {"code": e.code, "error": str(e)})
        p = safe_note(self.vl, self.vault, str(body.get("id", "")))
        if not p:
            return self._send(404, {"error": "no such assignment"})
        today = dt.date.today()
        if route == "/api/status":
            status = body.get("status")
            if status not in ("todo", "doing", "done"):
                return self._send(400, {"error": "bad status"})
            self.vl.set_frontmatter_field(p, "status", status)
            set_field(p, "done", today.isoformat() if status == "done" else None)
            return self._send(200, {"ok": True})
        if route == "/api/start":
            a = next(x for x in self.vl.assignments(self.vault) if x["path"] == p)
            t = task_json(self.vl, self.vault, a, today)
            if a["status"] != "doing":
                self.vl.set_frontmatter_field(p, "status", "doing")
            log_started(self.vl, self.vault, t["title"], t["first_step"])
            return self._send(200, {"ok": True, "url": claude_url(t)})
        self._send(404, {"error": "not found"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4317)
    ap.add_argument("--vault", default=VAULT)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    vault = os.path.expanduser(a.vault)
    vl = load_vaultlib(vault)
    if a.dry_run:
        print(json.dumps(state(vl, vault), indent=2)); return
    Handler.vl, Handler.vault, Handler.port = vl, vault, a.port
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)   # localhost only, never the network
    print(f"Game Plan → http://127.0.0.1:{a.port}  (vault: {vault})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
