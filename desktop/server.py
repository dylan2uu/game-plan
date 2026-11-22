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
import plistlib
import re
import subprocess
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge  # noqa: E402  (v1 database + AI on top of the vault)
import focus  # noqa: E402  (the one shared focus session)
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


# ---------- docs: class folders on this Mac ----------
SCHOOL = os.path.realpath(os.path.expanduser("~/Documents/School"))
BLOCKED = ("/02 Con Ed/",)          # hard rule: never surface Con Ed material
DOC_EXT = {".pdf", ".docx", ".doc", ".pages", ".pptx", ".key", ".xlsx", ".csv", ".txt", ".md", ".html",
           ".zip", ".png", ".jpg", ".jpeg", ".c", ".h", ".py", ".ipynb", ".tex"}


def course_folder(vl, vault, course):
    d = os.path.realpath(os.path.expanduser(launcher.FOLDERS.get(course or "", "")))
    return d if course in launcher.FOLDERS and os.path.isdir(d) else None


def list_files(vl, vault, course, limit=60):
    d = course_folder(vl, vault, course)
    if not d:
        return {"folder": None, "files": []}
    out, denied = [], []
    for root, dirs, files in os.walk(d, onerror=denied.append):
        dirs[:] = [x for x in dirs if not x.startswith(".") and x not in ("node_modules", "__pycache__")]
        if root.count(os.sep) - d.count(os.sep) > 2:
            dirs[:] = []
        for f in files:
            full = os.path.join(root, f)
            if f.startswith(".") or os.path.splitext(f)[1].lower() not in DOC_EXT:
                continue
            try:
                m = os.path.getmtime(full)
            except OSError:
                continue
            out.append({"name": f, "path": full.replace(os.path.expanduser("~"), "~", 1),
                        "dir": os.path.relpath(root, d) if root != d else "", "mtime": int(m)})
    out.sort(key=lambda x: -x["mtime"])
    if denied and not out:      # macOS privacy: the background server can't read ~/Documents yet
        return {"folder": d.replace(os.path.expanduser("~"), "~", 1), "files": [], "denied": True}
    return {"folder": d.replace(os.path.expanduser("~"), "~", 1), "files": out[:limit]}


def openable(vault, path):
    """Only files/folders under ~/Documents/School or the vault, never Con Ed."""
    p = os.path.realpath(os.path.expanduser(str(path or "")))
    roots = (SCHOOL, os.path.realpath(vault))
    if not any(p == r or p.startswith(r + os.sep) for r in roots) or any(b in p + "/" for b in BLOCKED):
        return None
    return p if os.path.exists(p) else None


def note_body(path, limit=2500):
    text = open(path, encoding="utf-8").read()
    text = re.sub(r"^---\n.*?\n---\n", "", text, count=1, flags=re.S)
    return text.strip()[:limit]


# ---------- Mac integrations ----------
APP_SUPPORT = os.path.expanduser("~/Library/Application Support/GamePlan")
BAR_APP = os.path.expanduser("~/Applications/GamePlanBar.app")
BAR_PLIST = os.path.expanduser("~/Library/LaunchAgents/com.gameplan.bar.plist")


def login_item(enable):
    """Opt-in: start the menu bar companion at login (a LaunchAgent you can remove any time)."""
    uid = os.getuid()
    if enable:
        if not os.path.isdir(BAR_APP):
            raise OSError("Build the menu bar app first: zsh desktop/mac/build.sh")
        exe = os.path.join(BAR_APP, "Contents", "MacOS", "GamePlanBar")
        os.makedirs(os.path.dirname(BAR_PLIST), exist_ok=True)
        with open(BAR_PLIST, "wb") as f:
            plistlib.dump({"Label": "com.gameplan.bar", "ProgramArguments": [exe], "RunAtLoad": True,
                           "KeepAlive": {"SuccessfulExit": False}, "ProcessType": "Interactive"}, f)
        if not os.environ.get("GP_NO_OPEN"):
            subprocess.run(["launchctl", "bootout", f"gui/{uid}/com.gameplan.bar"], capture_output=True)
            r = subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", BAR_PLIST], capture_output=True, text=True)
            if r.returncode not in (0, 37):         # 37: already loaded (it's running right now)
                os.remove(BAR_PLIST)
                raise OSError("macOS didn't accept the login item: " + (r.stderr.strip() or str(r.returncode)))
    else:
        if not os.environ.get("GP_NO_OPEN"):
            subprocess.run(["launchctl", "bootout", f"gui/{uid}/com.gameplan.bar"], capture_output=True)
        if os.path.exists(BAR_PLIST):
            os.remove(BAR_PLIST)
    return os.path.exists(BAR_PLIST)


def lan_ip():
    for iface in ("en0", "en1"):
        r = subprocess.run(["ipconfig", "getifaddr", iface], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    return None


def integrations(vl, vault):
    store = bridge.load_store(vault)
    integ = store["meta"].get("integrations", {})
    st = focus.settings(store)

    def fresh(key, sec):
        seen = focus.parse((integ.get(key) or {}).get("lastSeen"))
        return bool(seen and (focus.now() - seen).total_seconds() < sec)
    files = list_files(vl, vault, "Internship Course", limit=1)
    return {
        "server": True,
        "menuBar": {"built": os.path.isdir(BAR_APP), "running": fresh("mac", 90), "loginItem": os.path.exists(BAR_PLIST)},
        "extension": {"connected": fresh("extension", 150), "version": (integ.get("extension") or {}).get("version", ""),
                      "lastSeen": (integ.get("extension") or {}).get("lastSeen"),
                      "lastTest": (integ.get("extensionTest") or {}).get("lastSeen")},
        "unlockPrompt": st["unlockPrompt"],
        "files": {"ok": not files.get("denied"), "folder": files.get("folder")},
        "lan": {"enabled": st["lan"], "ip": lan_ip() if st["lan"] else None, "port": LAN_PORT,
                "listening": LAN["srv"] is not None, "pausedOtherNetwork": LAN.get("paused", False),
                "devices": [{k: d.get(k) for k in ("id", "name", "created", "lastSeen")} for d in store["meta"].get("devices", [])]},
    }


def ics(vault, url):
    """Calendar file with your study windows for the next 4 weeks, each opening the current task."""
    st = focus.settings(bridge.load_store(vault))
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Game Plan//EN", "CALSCALE:GREGORIAN"]
    today = dt.date.today()
    for i in range(28):
        d = today + dt.timedelta(days=i)
        for w in st["studyWindows"]:
            if not isinstance(w, dict) or not focus.hm_ok(w.get("start")) or not focus.hm_ok(w.get("end")) or d.weekday() not in (w.get("days") or []):
                continue
            s = dt.datetime.combine(d, dt.time(int(w["start"][:2]), int(w["start"][3:])))
            e = dt.datetime.combine(d, dt.time(int(w["end"][:2]), int(w["end"][3:])))
            if e <= s:
                e += dt.timedelta(days=1)
            lines += ["BEGIN:VEVENT", f"UID:gp-{d.isoformat()}-{w['start']}@gameplan", f"DTSTAMP:{dt.datetime.utcnow():%Y%m%dT%H%M%SZ}",
                      f"DTSTART:{s:%Y%m%dT%H%M%S}", f"DTEND:{e:%Y%m%dT%H%M%S}", "SUMMARY:Game Plan: study block",
                      f"URL:{url}", f"DESCRIPTION:Open Game Plan: {url}",
                      "BEGIN:VALARM", "TRIGGER:PT0M", "ACTION:DISPLAY", "DESCRIPTION:Study block: open Game Plan", "END:VALARM", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return ("\r\n".join(lines) + "\r\n").encode()


TEST_PAGE = b"""<!doctype html><meta charset=utf-8><title>Protection test</title>
<body style="font:16px system-ui;background:#0d0f12;color:#eceef1;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:440px;text-align:center"><h1>The extension didn't step in.</h1>
<p>If protection were on, this page would have been replaced by the return screen. Check that the Game Plan extension
is installed and enabled in chrome://extensions, then run the test again from Game Plan.</p></div>"""


# ---------- HTTP ----------
LAN_PORT = 4318
LAN = {"srv": None, "ip": None, "paused": False}


class Handler(BaseHTTPRequestHandler):
    vl = None
    vault = VAULT
    port = 4317
    lan = False          # True on the phone listener: needs a paired-device token, no Mac side effects

    def log_message(self, fmt, *args):  # quiet
        pass

    def _host_ok(self):
        # Block DNS-rebinding: only answer requests addressed to this machine.
        if self.lan:
            return self.headers.get("Host", "") == f"{LAN['ip']}:{LAN_PORT}"
        return self.headers.get("Host", "") in (f"127.0.0.1:{self.port}", f"localhost:{self.port}")

    def _token(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if q.get("k"):
            return q["k"][0]
        m = re.search(r"(?:^|;\s*)gp_k=([\w-]+)", self.headers.get("Cookie", ""))
        return m.group(1) if m else self.headers.get("X-GP-Token")

    def _auth(self):
        """Localhost is you. On the LAN listener every request needs a paired, unrevoked device."""
        if not self.lan:
            return True
        d = focus.device_for(self.vault, self._token())
        if d:
            focus.touch_device(self.vault, d["id"])
        return d

    def _send(self, code, body, ctype="application/json", headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "forbidden"})
        u = urllib.parse.urlparse(self.path)
        path, q = u.path, urllib.parse.parse_qs(u.query)
        dev = self._auth()
        if not dev:
            return self._send(401, b"<h1>Not paired</h1><p>Open the pairing link from Game Plan on your Mac.</p>", "text/html; charset=utf-8")
        if self.lan and q.get("k"):                 # first visit from the pairing link: keep the token in a cookie
            return self._send(302, b"", "text/plain", {"Location": "/", "Set-Cookie": f"gp_k={q['k'][0]}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000"})
        if path == "/api/state":
            return self._send(200, state(self.vl, self.vault))
        if path == "/api/focus":
            return self._send(200, focus.state(self.vl, self.vault))
        if path == "/api/settings":
            return self._send(200, focus.settings(bridge.load_store(self.vault)))
        if path == "/api/integrations" and not self.lan:
            return self._send(200, integrations(self.vl, self.vault))
        if path == "/api/reminders.ics":
            base = f"http://{LAN['ip']}:{LAN_PORT}/" if self.lan else f"http://127.0.0.1:{self.port}/"
            return self._send(200, ics(self.vault, base), "text/calendar; charset=utf-8",
                              {"Content-Disposition": 'attachment; filename="game-plan-study-blocks.ics"'})
        if path == "/__gp_test_distraction":
            return self._send(200, TEST_PAGE, "text/html; charset=utf-8")
        if path == "/api/files" and not self.lan:
            return self._send(200, list_files(self.vl, self.vault, (q.get("course") or [""])[0]))
        if path == "/api/note":
            p = safe_note(self.vl, self.vault, (q.get("id") or [""])[0])
            return self._send(200, {"body": note_body(p)}) if p else self._send(404, {"error": "no such note"})
        if path == "/v1":
            path = "/v1.html"
        if path == "/api/db":
            if not self.lan:
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
        dev = self._auth()
        if not dev:
            return self._send(401, {"error": "not paired"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 2) or b"{}")
        except ValueError:
            return self._send(400, {"error": "bad json"})
        route = urllib.parse.urlparse(self.path).path
        if self.lan and route not in ("/api/db", "/api/focus", "/api/log/edit"):
            return self._send(403, {"error": "not available from a paired phone"})
        if route == "/api/db":
            ok, why = db_write_allowed(body, self.lan)
            if not ok:
                return self._send(403, {"error": why})
            if str(body.get("path", "")) == "meta/settings":
                body = dict(body, data=sanitize_v1_settings(body.get("data")))
            try:
                bridge.write(self.vl, self.vault, body.get("op"), body.get("path"), body.get("data"))
            except bridge.DBError as e:
                return self._send(400, {"code": e.code, "error": str(e)})
            return self._send(200, {"ok": True, "db": bridge.snapshot(self.vl, self.vault)})
        if route == "/api/focus":
            device = "phone" if self.lan else str(body.get("device") or "web")[:20]
            try:
                out = focus.act(self.vl, self.vault, body, device)
            except focus.ActError as e:
                return self._send(400, {"error": str(e)})
            if out.get("started"):                      # same bookkeeping as before: note → doing, daily log
                self._mark_started(out["session"])
            return self._send(200, out)
        if route == "/api/log/edit":
            try:
                return self._send(200, {"ok": True, "entry": focus.edit_block(self.vault, str(body.get("taskId")), str(body.get("sid")), body.get("minutes", 0))})
            except (focus.ActError, TypeError, ValueError) as e:
                return self._send(400, {"error": str(e)})
        if route == "/api/settings":
            try:
                patch = focus.clean_settings(body)
                mins = max(0, min(24 * 60, int(body.get("snoozeMin") or 0))) if "snoozeMin" in body else None
            except (TypeError, ValueError, AttributeError):
                return self._send(400, {"error": "Some settings weren't valid. Check the times and numbers."})
            with bridge.LOCK:
                store = bridge.load_store(self.vault)
                store["meta"].setdefault("settings", {}).update(patch)
                if patch.get("lan"):
                    store["meta"]["lanIp"] = lan_ip()          # pairing is tied to the network you turned it on in
                if mins is not None:
                    store["meta"].setdefault("nudge", {})["snoozeUntil"] = focus.iso(focus.now() + dt.timedelta(minutes=mins)) if mins else None
                bridge.save_store(self.vault, store)
            if "lan" in patch:
                lan_sync(self.vault)
            return self._send(200, focus.settings(bridge.load_store(self.vault)))
        if route == "/api/ext/tested":
            with bridge.LOCK:
                store = bridge.load_store(self.vault)
                store["meta"].setdefault("integrations", {})["extensionTest"] = {"lastSeen": focus.iso(focus.now())}
                bridge.save_store(self.vault, store)
            return self._send(200, {"ok": True})
        if route == "/api/open-url":                     # used when no click started it (auto-start countdown)
            url = str(body.get("url") or "")
            if not re.match(r"^https?://[^\s\"']+$", url):
                return self._send(400, {"error": "Not a web link."})
            if not os.environ.get("GP_NO_OPEN"):
                subprocess.run(["open", url], check=False)
            return self._send(200, {"ok": True})
        if route == "/api/mac/login":
            try:
                return self._send(200, {"ok": True, "loginItem": login_item(bool(body.get("enable")))})
            except OSError as e:
                return self._send(400, {"error": str(e)})
        if route == "/api/mac/app":
            if not os.path.isdir(BAR_APP):
                return self._send(400, {"error": "Build it first: zsh desktop/mac/build.sh"})
            if not os.environ.get("GP_NO_OPEN"):
                subprocess.run(["open", BAR_APP], check=False)
            return self._send(200, {"ok": True})
        if route == "/api/devices":
            d, tok = focus.pair(self.vault, body.get("name"))
            ip = lan_ip()
            return self._send(200, {"device": {k: d[k] for k in ("id", "name", "created")},
                                    "url": f"http://{ip}:{LAN_PORT}/?k={tok}" if ip else None})
        if route == "/api/devices/revoke":
            return self._send(200, {"ok": focus.revoke(self.vault, str(body.get("id")))})
        if route == "/api/launch":
            try:
                folder = launcher.launch(self.vl, self.vault, body.get("task", ""))
            except (ValueError, OSError, subprocess.CalledProcessError) as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, {"ok": True, "folder": folder})
        if route == "/api/open":
            target = body.get("path")
            if body.get("course"):
                target = course_folder(self.vl, self.vault, body.get("course"))
            p = openable(self.vault, target)
            if not p:
                return self._send(404, {"error": "That file isn't in your School folder or the vault."})
            if not os.environ.get("GP_NO_OPEN"):
                subprocess.run(["open", p], check=False)
            return self._send(200, {"ok": True})
        if route == "/api/ai":
            try:
                return self._send(200, {"result": bridge.ai_json(str(body.get("prompt", ""))[:20000], body.get("tier", "quick"))})
            except bridge.DBError as e:
                return self._send(502, {"code": e.code, "error": str(e)})
        self._send(404, {"error": "not found"})

    def _mark_started(self, sess):
        try:
            store = bridge.load_store(self.vault)
            _, paths = bridge.all_tasks(self.vl, self.vault, store)
            p = paths.get(sess["taskId"])
            if p:
                if self.vl.read_frontmatter(p).get("status") == "todo":
                    self.vl.set_frontmatter_field(p, "status", "doing")
                log_started(self.vl, self.vault, sess["title"], sess["step"] or "focus block")
        except Exception as e:  # bookkeeping only; never break the timer
            print("start bookkeeping failed:", e, flush=True)


PROTECTED_META = {"devices", "session", "integrations", "reqs", "lastResult", "settingsVersion", "lanIp"}


def db_write_allowed(body, lan):
    """/api/db is the generic store. Focus/session/pairing data only changes through their own routes."""
    path = str(body.get("path") or "")
    coll, _, doc = path.partition("/")
    if coll == "meta" and doc in PROTECTED_META:
        return False, "That data changes through its own controls."
    if lan and not (coll == "tasks" or path == "meta/rewards"):
        return False, "Not available from a paired phone."
    return True, ""


def sanitize_v1_settings(data):
    """The old v1 page still writes meta/settings: validate known keys, keep only harmless extras."""
    data = data or {}
    out = focus.clean_settings({k: v for k, v in data.items() if k in focus.DEFAULT_SETTINGS})
    out.pop("lan", None)                                  # pairing only through Settings
    for k in ("lastCheckin",):
        if k in data:
            out[k] = str(data[k])[:20]
    return out


class LanHandler(Handler):
    lan = True


def lan_sync(vault):
    """Start or stop the phone listener to match settings.lan.
    The listener only runs on the network it was turned on in: if the Mac's address changes (another Wi-Fi),
    it stops and waits for you to turn it on again there. If Wi-Fi wasn't up yet, the watcher retries."""
    store = bridge.load_store(vault)
    want, home = focus.settings(store)["lan"], store["meta"].get("lanIp")
    ip = lan_ip()
    if LAN["srv"] and (not want or ip != LAN["ip"]):
        LAN["srv"].shutdown(); LAN["srv"].server_close()
        LAN.update(srv=None, ip=None, paused=bool(want))
        return
    if want and not LAN["srv"]:
        if not ip or (home and ip != home):
            LAN["paused"] = bool(ip)
            return
        try:
            srv = ThreadingHTTPServer((ip, LAN_PORT), LanHandler)
        except OSError as e:
            print("phone listener failed:", e, flush=True)
            return
        LAN.update(srv=srv, ip=ip, paused=False)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        print(f"Phone listener on http://{ip}:{LAN_PORT} (paired devices only)", flush=True)


def lan_watch(vault):
    import time
    while True:
        time.sleep(60)
        try:
            lan_sync(vault)
        except Exception as e:  # never take the server down over this
            print("phone listener check failed:", e, flush=True)


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
    focus.migrate(vault)
    Handler.vl, Handler.vault, Handler.port = vl, vault, a.port
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)   # localhost only; the phone listener is separate and opt-in
    lan_sync(vault)
    threading.Thread(target=lan_watch, args=(vault,), daemon=True).start()
    print(f"Game Plan → http://127.0.0.1:{a.port}  (vault: {vault})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
