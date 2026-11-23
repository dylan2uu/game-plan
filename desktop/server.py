#!/usr/bin/env python3
"""Game Plan v3 server: one page at http://127.0.0.1:4317, the Obsidian vault as the database.

Localhost only. Reads and writes only the vault (plus a small machine-local state file for the
running timer, skips and notification counts). AI calls run `claude -p` from the vault folder,
so the vault's CLAUDE.md (and System/about-me.md) always comes along.

Usage: python3 server.py [--port 4317] [--vault ~/Obsidian/Vault] [--state FILE] [--dry-run]
  --dry-run   print what the page would show, as JSON, and exit (no server, no writes)
Env: GP_NO_NOTIFY=1 never sends macOS notifications (test copies of the vault).
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vault as V  # noqa: E402

APP_DIR = os.path.join(HERE, "app")
LOCK = threading.RLock()
CFG = {"vault": os.path.expanduser(os.environ.get("GP_VAULT", "~/Obsidian/Vault")),
       "state": os.path.expanduser("~/Library/Application Support/GamePlan/state.json"), "port": 4317}
DISTRACTIONS = ["instagram.com", "youtube.com/shorts", "tiktok.com", "x.com", "twitter.com", "reddit.com", "netflix.com", "hulu.com"]


class Bad(Exception):
    pass


# ---------- machine-local state: running timer, skips, notification counts ----------
def load_state():
    try:
        return json.load(open(CFG["state"]))
    except (OSError, ValueError):
        return {}


def save_state(s):
    os.makedirs(os.path.dirname(CFG["state"]), exist_ok=True)
    tmp = CFG["state"] + ".tmp"
    json.dump(s, open(tmp, "w"), indent=1)
    os.replace(tmp, CFG["state"])


def now():
    return dt.datetime.now().replace(microsecond=0)


def parse_time(s):
    try:
        return dt.datetime.fromisoformat(str(s))
    except ValueError:
        return None


# ---------- AI: `claude -p` from the vault folder ----------
def claude_bin():
    return shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")


SMART, COACH = "opus", "sonnet"      # opus: the command bar + sizing (they change your list); sonnet: Stuck + Spitball


def ai(prompt, model=COACH, timeout=120, schema=None):
    """Ask Claude through `claude -p` (your subscription) from the vault folder, so the vault's CLAUDE.md comes along.
    With a schema, the CLI validates the answer and hands back `structured_output`, so it always parses."""
    cmd = [claude_bin(), "-p", "--model", model, "--fallback-model", "sonnet" if model != "sonnet" else "haiku",
           "--strict-mcp-config", "--tools", "", "--no-session-persistence", "--settings", '{"disableAllHooks": true}',
           "--output-format", "json"] + (["--json-schema", json.dumps(schema)] if schema else []) + \
          [prompt + ("" if schema else "\n\nReply with ONLY one JSON object. No prose, no code fences.")]
    try:
        r = subprocess.run(cmd, cwd=CFG["vault"], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise Bad("Claude took too long. Try again.")
    except OSError:
        raise Bad("The claude command isn't installed.")
    try:
        d = json.loads(r.stdout)
    except ValueError:
        print("ai: unreadable output:", (r.stdout or r.stderr)[:300], flush=True)
        raise Bad("Claude didn't answer. Is Claude Code signed in? Try again.")
    if d.get("is_error"):
        print("ai error:", str(d.get("result"))[:300], flush=True)
        raise Bad("Claude couldn't answer right now: " + str(d.get("result") or "unknown error")[:120])
    if schema and isinstance(d.get("structured_output"), dict):
        return d["structured_output"]
    text = str(d.get("result") or "")
    i, j = text.find("{"), text.rfind("}")
    try:
        return json.loads(text[i:j + 1])
    except ValueError:
        raise Bad("Claude's answer wasn't readable. Try again.")

# ---------- helpers ----------
def note_path(rel, kind="assignment"):
    """Only real notes inside the vault, of the expected type (no ../ tricks)."""
    vault = os.path.realpath(CFG["vault"])
    p = os.path.realpath(os.path.join(vault, str(rel or "")))
    if not p.startswith(vault + os.sep) or not p.endswith(".md") or not os.path.isfile(p):
        raise Bad("That note isn't in the vault.")
    if V.vaultlib(CFG["vault"]).read_frontmatter(p).get("type") != kind:
        raise Bad("That note isn't a " + kind + ".")
    return p


def find_task(ts, rel):
    p = note_path(rel)
    for t in ts:
        if t["path"] == p or os.path.realpath(t["path"]) == p:
            return t
    raise Bad("That task isn't open anymore.")


def text_arg(body, key, limit, required=True):
    v = re.sub(r"\s+", " ", str(body.get(key) or "")).strip()[:limit]
    if required and not v:
        raise Bad(f"Missing {key.replace('_', ' ')}.")
    return v


def view(t, why, nd):
    up = V.done_chain(nd, t["cls"])
    return {"id": t["id"], "title": t["title"], "cls": t["cls"], "points": t["points"], "status": t["status"],
            "due": t["due"].isoformat() if t["due"] else None, "why": why, "est": V.est_min(t),
            "first_step": t["first_step"], "url": t["url"], "bs": bool(bs_item(t["url"])), "chain": up + ["Vision"] if up else ["Unsorted"],
            "note": "obsidian://open?path=" + urllib.parse.quote(t["path"])}


def unique_path(folder, base):
    path, n = os.path.join(folder, base + ".md"), 2
    while os.path.exists(path):
        path, n = os.path.join(folder, f"{base} {n}.md"), n + 1
    return path


def create_task(title, cls, due=None, points=3, first_step="", status="todo", done_date=None, actual=None,
                source="gameplan", created=None, url=None, est=None):
    """A new task note, filed by class (or 00 Inbox/Assignments) and linked up to its class or area."""
    vault = CFG["vault"]
    vl = V.vaultlib(vault)
    nd = V.nodes(vault)
    folder = os.path.join(vault, "01 Classes", cls, "Assignments") if cls in vl.CLASSES else os.path.join(vault, "00 Inbox", "Assignments")
    os.makedirs(folder, exist_ok=True)
    path = unique_path(folder, vl.safe_name((due.isoformat() + " " if due else "") + title))
    fm = {"type": "assignment", "class": cls, "due": due.isoformat() if due else "", "status": status,
          "points": V.snap_points(points), "first_step": first_step, "source": source,
          "date": (created or dt.date.today()).isoformat(), "done_date": done_date.isoformat() if done_date else None,
          "actual_min": actual, "brightspace_url": url, "est_min": est, "sized": "claude" if est else None}
    head = "".join(f"{k}: {V.yaml_value(v)}\n" if v != "" else f"{k}:\n" for k, v in fm.items() if v is not None)
    parent = V.home(nd, cls)
    body = f"# {title}\n" + (f"Part of [[{parent}]]\n" if parent else "") + \
        (f"\n## First step (5 min)\n- {first_step}\n" if first_step else "") + "\n## Notes\n"
    V.write(path, "---\n" + head + "---\n" + body)
    return path


def log_started(title, step):
    vl = V.vaultlib(CFG["vault"])
    p = vl.daily_note(CFG["vault"])
    V.write(p, V.add_under(V.read(p), "Started", f"- {now():%H:%M} {title} → {step} (Game Plan)"))


# ---------- the page ----------
def state_json():
    vault, t0 = CFG["vault"], now()
    today = t0.date()
    with LOCK:
        ts, nd, st = V.tasks(vault), V.nodes(vault), load_state()
    sched = V.schedule(vault)
    ranked = V.rank(ts, t0, sched, st.get("skipped", {}).get(today.isoformat(), []))
    sess = st.get("session")
    by_id = {t["id"]: t for t in ts}
    if sess and (sess.get("id") not in by_id or by_id[sess["id"]]["status"] == "done"):
        sess = None
    if sess:
        hero = view(by_id[sess["id"]], "Timer's running. Stay on this one.", nd)
        hero.update(started_at=sess["started_at"], minutes=sess["est"], guessed=bool(sess.get("guessed")))
    else:
        pick = (st.get("pick") or {}) if (st.get("pick") or {}).get("date") == today.isoformat() else {}
        chosen = next(((t, "You picked this one from your list.") for t, _ in ranked if t["id"] == pick.get("id")), None)
        hero = view(*(chosen or ranked[0]), nd) if ranked else None
    week = week_summary(ts, t0, sched)
    unsub = set(st.get("unsubmitted", []))
    daily = os.path.join(vault, "06 Daily", f"{today.isoformat()}.md")
    return {
        "version": version(), "now": t0.isoformat(), "today": today.isoformat(), "hero": hero,
        "week_built": V.week_built(ts, nd, today),
        "next": [view(t, why, nd) for t, why in ranked if not hero or t["id"] != hero["id"]][:5],
        "week": week, "progress": V.progress(ts, today), "identities": V.identities(ts, nd),
        "map": "obsidian://open?vault=" + urllib.parse.quote(os.path.basename(vault)) + "&file=" + urllib.parse.quote(V.CANVAS),
        "checkin_due": t0.hour >= 21 and not V.has_section(daily, "Night check-in"),
        "all": [dict(id=t["id"], title=t["title"], cls=t["cls"], points=t["points"], est=V.est_min(t), status=t["status"], url=t["url"],
                     due=t["due"].isoformat() if t["due"] else None, done=t["done_date"].isoformat() if t["done_date"] else None,
                     bs=bool(bs_item(t["url"])), unsubmitted=t["id"] in unsub,
                     note="obsidian://open?path=" + urllib.parse.quote(t["path"])) for t in ts],
        "brightspace": dict(st.get("brightspace") or {}, requested=st.get("bs_request")),
        "busy": V.busy_now(t0, sched),
        "extension_ever": bool(st.get("extension_seen")),
        "blocker": bool(parse_time(st.get("extension_seen")) and t0 - parse_time(st.get("extension_seen")) < dt.timedelta(minutes=3)),
    }


def week_summary(ts, t0, sched):
    """The next 7 days in one honest line: work left vs free time, plus what's done this week (Mon-Sun)."""
    today = t0.date()
    end = dt.datetime.combine(today + dt.timedelta(days=6), dt.time(23, 59))
    left = [t for t in ts if t["status"] != "done" and t["due"] and t["due"] <= today + dt.timedelta(days=6)]
    monday = today - dt.timedelta(days=today.weekday())
    done = [t for t in ts if t["status"] == "done" and t["done_date"] and monday <= t["done_date"] <= today]
    need, free = sum(V.est_min(t) for t in left), V.free_minutes(t0, end, sched)
    late = sum(1 for t in left if t["due"] < today)
    verdict = ("Nothing due this week. Get ahead, or rest." if not left else
               "Tight: more work than free time. Start the biggest one today." if need > free else
               "Busy but doable. Keep a not-zero day every day." if need > free * 0.6 else "On track.")
    return {"left": len(left), "late": late, "pts_left": sum(t["points"] for t in left), "need_min": need, "free_min": free,
            "done": len(done), "pts_done": sum(t["points"] for t in done), "verdict": verdict}


# ---------- Brightspace: submitted there = done here (the Chrome extension checks with your login) ----------
BS_LINK = re.compile(r"^https://([\w.-]+)/d2l/(?:lms/dropbox/user/folder_submit_files\.d2l\?ou=(\d+)&db=(\d+)"
                     r"|lms/quizzing/(?:user/quiz_summary|quizzing)\.d2l\?ou=(\d+)&qi=(\d+)|le/(\d+)/discussions/topics/(\d+))")


def bs_item(url):
    m = BS_LINK.match(url or "")
    if not m:
        return None
    g = m.groups()
    kind, ou, item = ("dropbox", g[1], g[2]) if g[1] else ("quiz", g[3], g[4]) if g[3] else ("discussion", g[5], g[6])
    return {"host": g[0], "kind": kind, "ou": ou, "item": item}


def bs_tasks():
    """What the extension should check: open Brightspace tasks, plus ones finished here in the last 2 weeks."""
    today = dt.date.today()
    out = []
    for t in V.tasks(CFG["vault"]):
        b = bs_item(t["url"])
        recent = t["status"] == "done" and t["done_date"] and (today - t["done_date"]).days <= 14
        if b and (t["status"] != "done" or recent):
            out.append(dict(b, id=t["id"], title=t["title"], status=t["status"]))
    hosts = [t["host"] for t in out]
    return {"host": max(set(hosts), key=hosts.count) if hosts else None, "tasks": out}


def bs_report(body):
    """Submitted on Brightspace → done here (dated by the submission). Done here but not submitted → flagged."""
    vault, t0 = CFG["vault"], now()
    results = body.get("results") if isinstance(body.get("results"), list) else []
    updated, days = [], set()
    with LOCK:
        by = {t["id"]: t for t in V.tasks(vault)}
        st = load_state()
        unsub = set(st.get("unsubmitted", []))
        for r in results[:300]:
            t = by.get(str((r or {}).get("id")))
            if not t:
                continue
            if r.get("submitted") is True:
                unsub.discard(t["id"])
                if t["status"] != "done":
                    when = parse_time(str(r.get("date") or "").replace("Z", "+00:00"))
                    d = (when.astimezone().date() if when and when.tzinfo else when.date() if when else t0.date())
                    V.set_fields(t["path"], status="done", done_date=d.isoformat(), submitted_on_brightspace=d.isoformat(), started_at=None)
                    updated.append(t["title"])
                    days.add(d)
                    if (st.get("session") or {}).get("id") == t["id"]:
                        st["session"] = None
            elif r.get("submitted") is False and t["status"] == "done":
                unsub.add(t["id"])
        st["unsubmitted"] = sorted(unsub)
        st["brightspace"] = {"checked_at": t0.isoformat(), "checked": len(results), "updated": updated[-12:],
                             "error": str(body.get("error") or "")[:200]}
        st.pop("bs_request", None)
        save_state(st)
        if updated:
            ts, _ = V.ensure_vault(vault, t0.date())
            for d in sorted(days):
                V.refresh_day(vault, d, ts)
    return {"updated": updated}


def bs_request(body):
    with LOCK:
        st = load_state()
        st["bs_request"] = now().isoformat()
        save_state(st)


def setup_extension(body):
    """One click from the setup sheet: Chrome's extensions page plus the extension folder in Finder."""
    if os.environ.get("GP_NO_OPEN") != "1":
        subprocess.run(["open", "-a", "/Applications/Google Chrome.app", "chrome://extensions"], check=False)
        subprocess.run(["open", "-R", os.path.join(HERE, "extension", "manifest.json")], check=False)


def open_url(body):
    """Open a web link in Chrome (not the default browser)."""
    url = str(body.get("url") or "")
    if not re.match(r"^https?://[^\s\"'<>]+$", url):
        raise Bad("That isn't a web link.")
    if os.environ.get("GP_NO_OPEN") != "1":
        chrome = "/Applications/Google Chrome.app"
        subprocess.run(["open", "-a", chrome, url] if os.path.isdir(chrome) else ["open", url], check=False)


# ---------- sizing: points and minutes that fit the task ----------
def size_open(limit=15):
    """Ask Claude once per task: how many minutes of focused work will this really take Dylan?
    Calibrated with his actual times; points then follow from the minutes. 'sized: you' is never touched."""
    vault = CFG["vault"]
    ts = V.tasks(vault)
    todo = [t for t in ts if t["status"] != "done" and t["sized_by"] not in ("claude", "you")][:limit]
    if not todo:
        return []
    timed = sorted((t for t in ts if t["status"] == "done" and t["actual"]), key=lambda t: t["done_date"] or dt.date.min)[-25:]
    kind = lambda t: (bs_item(t["url"]) or {}).get("kind", "task")
    res = ai("Estimate how long each of Dylan's open tasks will really take him, in minutes of focused work. Be realistic for a "
             "CS junior: forms and surveys take minutes, a quiz or discussion post under an hour, a problem set an hour or two, a "
             "graded paper or project milestone several hours. Calibrate on his history.\n"
             "History (task | class | minutes he actually took):\n" + "\n".join(f"{t['title']} | {t['cls']} | {t['actual']}" for t in timed) +
             "\n\nOpen tasks (n | title | class | kind):\n" + "\n".join(f"{i} | {t['title']} | {t['cls']} | {kind(t)}" for i, t in enumerate(todo, 1)) +
             '\nReturn {"sizes": [{"n": number, "minutes": number}]}', SMART)
    by = {str(i): t for i, t in enumerate(todo, 1)}                     # short keys: long file names get mangled
    sized = []
    with LOCK:
        for r in res.get("sizes") or []:
            t = by.get(str((r or {}).get("n")))
            try:
                m = max(5, min(600, int(float(r.get("minutes")))))
            except (TypeError, ValueError, AttributeError):
                continue
            if t:
                V.set_fields(t["path"], points=V.points_for(m), est_min=m, sized="claude")
                sized.append(t["title"])
        if sized:
            V.ensure_vault(vault)
    return sized


def resize(body):
    """Your call beats the estimate: set a task's points by hand (the minutes follow)."""
    try:
        p = int(body.get("points"))
    except (TypeError, ValueError):
        raise Bad("Pick a size: 1, 2, 3, 5, 8 or 13.")
    if p not in V.POINTS:
        raise Bad("Pick a size: 1, 2, 3, 5, 8 or 13.")
    with LOCK:
        t = find_task(V.tasks(CFG["vault"]), body.get("id"))
        V.set_fields(t["path"], points=p, est_min=None, sized="you")
        V.ensure_vault(CFG["vault"])


# ---------- live updates: a cheap fingerprint of everything the page shows ----------
WATCH = ("00 Inbox", "01 Classes", "03 Projects", "06 Daily", "07 Map")


def version():
    newest, count = 0, 0
    for folder in WATCH:
        for root, _, files in os.walk(os.path.join(CFG["vault"], folder)):
            for f in files:
                if f.endswith((".md", ".canvas")):
                    try:
                        newest = max(newest, os.stat(os.path.join(root, f)).st_mtime_ns)
                    except OSError:
                        continue
                    count += 1
    try:
        state_m = os.stat(CFG["state"]).st_mtime_ns
    except OSError:
        state_m = 0
    return f"{newest}.{count}.{state_m}"


# ---------- actions ----------
def start(body):
    """One click. A minutes guess is optional; without one the task's size sets the clock."""
    t0 = now()
    try:
        guess = max(1, min(600, int(body["minutes"]))) if body.get("minutes") not in (None, "") else None
    except (TypeError, ValueError):
        raise Bad("Minutes should be a number, like 25.")
    with LOCK:
        t = find_task(V.tasks(CFG["vault"]), body.get("id"))
        V.set_fields(t["path"], status="doing", started_at=t0.isoformat(), **({"my_estimate_min": guess} if guess else {}))
        minutes = guess or V.est_min(t)
        st = load_state()
        st["session"] = {"id": t["id"], "title": t["title"], "step": "", "est": minutes, "guessed": bool(guess),
                         "started_at": t0.isoformat(), "allow": []}
        st["last_start"] = {"id": t["id"], "at": t0.isoformat()}
        st.setdefault("nudges", {}).setdefault("ignored", {}).pop(t["id"], None)
        save_state(st)
        log_started(t["title"], f"{minutes} min" + (" (my guess)" if guess else ""))


def finish(rel):
    """Mark done: note, #done tag, daily note, every 📊 line up the chain. Returns what the Done screen shows."""
    vault, t0 = CFG["vault"], now()
    with LOCK:
        ts = V.tasks(vault)
        t = find_task(ts, rel)
        if t["status"] == "done":
            raise Bad("Already done.")
        st = load_state()
        sess = st.get("session") if (st.get("session") or {}).get("id") == t["id"] else None
        actual = max(1, round((t0 - parse_time(sess["started_at"])).total_seconds() / 60)) if sess else t["actual"]
        guess = sess["est"] if sess else V.est_min(t)
        before = V.progress(ts, t0.date())["today"]
        levels_before = {g["name"]: g["level"] for g in V.identities(ts, V.nodes(vault))}
        V.set_fields(t["path"], status="done", done_date=t0.date().isoformat(), actual_min=actual, started_at=None)
        if sess:
            st["session"] = None
            save_state(st)
        ts, nd = V.ensure_vault(vault, t0.date())
        V.refresh_day(vault, t0.date(), ts)
        after = V.progress(ts, t0.date())["today"]
    up = set(V.chain(nd, V.home(nd, t["cls"])))
    levels = [dict(g, up=g["level"] > levels_before.get(g["name"], g["level"])) for g in V.identities(ts, nd) if g["name"] in up]
    return {"id": t["id"], "title": t["title"], "points": t["points"], "chain": V.done_chain(nd, t["cls"]), "est": guess, "actual": actual,
            "today": after, "goal": V.DAY_GOAL, "producer_day": before < V.DAY_GOAL <= after,
            "built_today": len(V.progress(ts, t0.date())["built"]), "levels": levels}


def undo_done(body):
    """Undo a Done (a mis-click): back on the list, off today's daily note, stats redrawn."""
    vault = CFG["vault"]
    with LOCK:
        p = note_path(body.get("id"))
        fm = V.vaultlib(vault).read_frontmatter(p)
        if fm.get("status") != "done":
            raise Bad("That task isn't marked done.")
        day = V.date_or_none(fm.get("done_date") or fm.get("done"))
        V.set_fields(p, status="todo", done_date=None, done=None, actual_min=None, submitted_on_brightspace=None)
        ts, _ = V.ensure_vault(vault)
        if day:
            V.unlog_day(vault, day, os.path.splitext(os.path.basename(p))[0])
            V.refresh_day(vault, day, ts)


def stuck(body):
    with LOCK:
        t = find_task(V.tasks(CFG["vault"]), body.get("id"))
    try:
        level = max(0, min(2, int(body.get("level") or 0)))
    except (TypeError, ValueError):
        level = 0
    notes = re.sub(r"^---\n.*?\n---\n", "", V.read(t["path"]), flags=re.S)[:1500]
    asks = ["Ask ONE question that gets him thinking about where to start. No hints, no answers.",
            "Give ONE concrete hint that moves him forward. Still not the answer.",
            "Show a short, fully worked example of a SIMILAR problem (different content or numbers), "
            "then one line telling him to do his own the same way."]
    no_ai = " MATH 314 bans AI-generated work: never solve or draft his actual problem." if "math" in t["cls"].lower() else ""
    res = ai(f"Dylan pressed Stuck in Game Plan (rule 2: make him think first).\nTask: {t['title']} ({t['cls']}), "
             f"due {t['due'] or 'no date'}. His first step: {t['first_step'] or 'none yet'}.\nNote:\n{notes}\n\n"
             f"{asks[level]} Never do his actual work.{no_ai} Under 110 words, casual. "
             'Return {"text": "..."}', "sonnet")
    return {"level": level, "text": str(res.get("text") or "").strip()[:1500]}


CMD_SCHEMA = {
    "type": "object",
    "properties": {
        "actions": {"type": "array", "items": {"type": "object", "properties": {
            "do": {"type": "string", "enum": ["add", "done", "update", "drop", "reopen", "idea", "answer"]},
            "task": {"type": "integer", "description": "number of an existing task from the lists"},
            "title": {"type": "string"}, "home": {"type": "string"},
            "due": {"type": "string", "description": "YYYY-MM-DD, or 'none' to clear it"},
            "minutes": {"type": "integer"}, "text": {"type": "string"},
            "questions": {"type": "array", "items": {"type": "string"}}},
            "required": ["do"]}},
        "summary": {"type": "string", "description": "what you did, past tense, at most 18 words, no advice"}},
    "required": ["actions", "summary"]}
SNAP = ("status", "due", "due_by", "points", "est_min", "sized", "class", "dropped", "done_date", "actual_min", "started_at")


def snapshot(path):
    fm = V.vaultlib(CFG["vault"]).read_frontmatter(path)
    h1 = re.search(r"(?m)^# (.+)$", V.read(path))
    return {"path": path, "fields": {k: fm.get(k) for k in SNAP}, "h1": h1.group(1) if h1 else None}


def set_title(path, title):
    text = V.read(path)
    V.write(path, re.sub(r"(?m)^# .+$", lambda m: "# " + title, text, count=1))


def command(body):
    """The command bar: Claude (Opus) turns what you typed into actions on your list. Every change can be undone."""
    text = text_arg(body, "text", 600)
    vault, t0 = CFG["vault"], now()
    today = t0.date()
    with LOCK:
        ts, nd = V.tasks(vault), V.nodes(vault)
    homes = V.homes(nd)
    open_ts = sorted((t for t in ts if t["status"] != "done"), key=lambda t: (t["due"] or dt.date.max, t["title"]))
    done_ts = sorted((t for t in ts if t["status"] == "done" and t["done_date"] and (today - t["done_date"]).days <= 7),
                     key=lambda t: t["done_date"], reverse=True)[:30]
    ref = {i: t for i, t in enumerate(open_ts, 1)}
    ref.update({100 + i: t for i, t in enumerate(done_ts, 1)})
    days = ", ".join(f"{today + dt.timedelta(days=k):%a} {today + dt.timedelta(days=k)}" for k in range(1, 9))
    line = lambda n, t: (f"{n} | {t['title']} | {t['cls']} | " + (f"due {t['due']}{' (overdue)' if t['due'] < today else ''}" if t["due"] else "no due date")
                         + f" | {t['points']} pts | {t['status']}")
    res = ai(f"You are the command bar of Dylan's Game Plan. Turn what he typed into actions on his task list.\n"
             f"Today is {today:%A} {today}. Next days: {days}.\nHomes (classes, projects, areas): {', '.join(homes)}\n\n"
             "Open tasks (n | title | home | due | points | status):\n" + "\n".join(line(n, t) for n, t in ref.items() if n < 100) +
             "\n\nFinished in the last 7 days (n | title | home | finished):\n" +
             "\n".join(f"{n} | {t['title']} | {t['cls']} | {t['done_date']}" for n, t in ref.items() if n >= 100) +
             f'\n\nHe typed: """{text}"""\n\n'
             "Actions: add = a NEW thing to do (title in his words, home, due if given, realistic minutes for him). "
             "done = he finished or submitted existing task(s). update = change existing task(s): due (move, push, reschedule, "
             "'is due'), title (rename), minutes (how big it is), home. drop = he no longer needs to do it. reopen = a finished task "
             "isn't actually finished. idea = a thought or plan to think through (not a to-do): 2-3 sharp questions, never an answer. "
             "answer = he asks about his tasks or schedule: 1-3 short sentences, using only the lists.\n"
             "Rules: if he is talking about a task on the lists, change THAT task; never add a duplicate. One message can change "
             "several tasks (e.g. 'move the 3 overdue ones to tomorrow except the CS 301 paper' is 3 update actions). Resolve days "
             f"with the dates above (tomorrow = {today + dt.timedelta(days=1)}). Never invent tasks. If it's truly unclear, use one "
             "answer action that asks a short question.", SMART, schema=CMD_SCHEMA)
    actions = [a for a in (res.get("actions") or []) if isinstance(a, dict)][:25]
    changes, created, moved, finished, out = [], [], [], [], {"summary": str(res.get("summary") or "").strip()[:200]}
    done_card = None
    with LOCK:
        for a in actions:
            do, t = a.get("do"), ref.get(a.get("task")) if isinstance(a.get("task"), int) else None
            if do in ("done", "update", "drop", "reopen") and not t:
                continue
            if do in ("done", "update", "drop") and t["status"] == "done" and do != "update":
                continue
            if t:
                changes.append(snapshot(t["path"]))
            if do == "done":
                done_card = finish(t["id"])
                finished.append(t["title"])
            elif do == "drop":
                V.set_fields(t["path"], dropped="true", started_at=None)
                moved.append(t["title"])
            elif do == "reopen" and t["status"] == "done":
                undo_done({"id": t["id"]})
                moved.append(t["title"])
            elif do == "update":
                fields = {}
                due = str(a.get("due") or "").strip()
                if due.lower() == "none":
                    fields.update(due="", due_by="you")
                elif V.date_or_none(due):
                    fields.update(due=V.date_or_none(due).isoformat(), due_by="you")
                if a.get("minutes"):
                    m = max(5, min(600, int(a["minutes"])))
                    fields.update(est_min=m, points=V.points_for(m), sized="you")
                if a.get("home") in homes and a["home"] != t["cls"]:
                    fields["class"] = a["home"]
                    parent = V.home(nd, a["home"])
                    V.write(t["path"], re.sub(r"(?m)^Part of \[\[[^\]]+\]\]", f"Part of [[{parent}]]", V.read(t["path"]), count=1))
                if fields:
                    V.set_fields(t["path"], **fields)
                if str(a.get("title") or "").strip() and a["title"].strip() != t["title"]:
                    set_title(t["path"], V.vaultlib(vault).safe_name(a["title"], 90))
                moved.append(t["title"])
            elif do == "add":
                title = V.vaultlib(vault).safe_name(str(a.get("title") or text), 70)
                cls = a.get("home") if a.get("home") in homes else "Unsorted"
                try:
                    mins = max(5, min(600, int(a.get("minutes") or 0))) or None
                except (TypeError, ValueError):
                    mins = None
                p = create_task(title, cls, V.date_or_none(a.get("due")), V.points_for(mins) if mins else 2, est=mins)
                created.append(p)
                moved.append(title)
            elif do == "idea":
                title = V.vaultlib(vault).safe_name(str(a.get("title") or text), 70)
                cls = a.get("home") if a.get("home") in homes else "Unsorted"
                qs = [re.sub(r"\s+", " ", str(q)).strip()[:300] for q in (a.get("questions") or []) if str(q).strip()][:3]
                path = unique_path(os.path.join(vault, "00 Inbox", "Ideas"), V.vaultlib(vault).safe_name(f"{today} {title}"))
                parent = V.home(nd, cls)
                V.write(path, f"---\ntype: idea\ndate: {today}\nclass: {cls}\n---\n# {title}\n" + (f"Part of [[{parent}]]\n" if parent else "")
                        + f"\n#idea\n\n## Thought\n{text}\n\n## Spitball\n" + "".join(f"- **Claude:** {q}\n" for q in qs))
                created.append(path)
                out["idea"] = {"id": os.path.relpath(path, vault), "title": title, "cls": cls, "questions": qs}
            elif do == "answer":
                out["answer"] = str(a.get("text") or "").strip()[:600]
        if changes or created:
            st = load_state()
            st["last_command"] = {"text": text, "at": t0.isoformat(), "changes": changes, "created": created}
            save_state(st)
            V.ensure_vault(vault)
    out["undo"] = bool(changes or created)
    if done_card and len(finished) == 1 and not moved:
        out["done"] = done_card                                    # one finish: play the Done moment
    if not out["summary"]:
        out["summary"] = "Done." if out["undo"] else "Nothing to change."
    return out


def undo_command(body):
    """Put back exactly what the last command changed (and remove anything it created)."""
    vault = CFG["vault"]
    with LOCK:
        st = load_state()
        last = st.get("last_command")
        if not last:
            raise Bad("Nothing to undo.")
        for c in reversed(last["changes"]):
            fm = V.vaultlib(vault).read_frontmatter(c["path"])
            if fm.get("status") == "done" and c["fields"].get("status") != "done":
                day = V.date_or_none(fm.get("done_date"))
                if day:
                    V.unlog_day(vault, day, os.path.splitext(os.path.basename(c["path"]))[0])
            V.set_fields(c["path"], **{k: (v if v not in (None, "") else None) for k, v in c["fields"].items()})
            if c["h1"]:
                set_title(c["path"], c["h1"])
        for p in last["created"]:
            if os.path.isfile(p) and os.path.realpath(p).startswith(os.path.realpath(vault) + os.sep):
                os.remove(p)
        st["last_command"] = None
        save_state(st)
        ts, _ = V.ensure_vault(vault)
        V.refresh_day(vault, dt.date.today(), ts)
    return {"summary": f"Undid: {last['text'][:80]}"}


def spitball(body):
    """Reply in an idea note; Claude answers with sharp questions or a counter-argument, never the answer."""
    reply = text_arg(body, "reply", 1000)
    vault = CFG["vault"]
    with LOCK:
        p = note_path(body.get("id"), "idea")
        V.write(p, V.read(p).rstrip("\n") + f"\n- **Me:** {reply}\n")
        nd = V.nodes(vault)
    note = re.sub(r"^---\n.*?\n---\n", "", V.read(p), flags=re.S)[:4000]
    res = ai("Spitball with Dylan on this idea note from his vault (rule 2: make him think; never hand him a finished "
             f"answer).\n{note}\n\nRespond to his last reply with 2-3 sharp questions, or one counter-argument plus one "
             f"question. Under 80 words total. Also pick up to 2 map notes it connects to from: {', '.join(nd)}.\n"
             'Return {"questions": ["..."], "related": ["exact names from the list"]}', "sonnet")
    qs = [re.sub(r"\s+", " ", str(q)).strip()[:300] for q in (res.get("questions") or []) if str(q).strip()][:3]
    rel = [r for r in (res.get("related") or []) if r in nd][:2]
    with LOCK:
        text = V.read(p).rstrip("\n") + "\n" + "".join(f"- **Claude:** {q}\n" for q in qs)
        new = [r for r in rel if f"[[{r}]]" not in text]
        if new:
            text = re.sub(r"(?m)^(# .+)$", lambda m: m.group(1) + "\nRelated: " + " · ".join(f"[[{r}]]" for r in new), text, count=1)
        V.write(p, text)
    return {"questions": qs, "related": rel}


def checkin(body):
    vault, today = CFG["vault"], dt.date.today()
    got, way = text_arg(body, "got_done", 400, False) or "—", text_arg(body, "in_the_way", 400, False) or "—"
    with LOCK:
        p = V.vaultlib(vault).daily_note(vault, today)
        V.write(p, V.replace_section(V.read(p), "Night check-in",
                                     f"- Got done that mattered: {got}\n- Got in the way: {way}"))


# ---------- focus blocker (Chrome extension) ----------
def focus_view():
    st, t0 = load_state(), now()
    sess = st.get("session")
    protect = {"distractions": DISTRACTIONS, "exceptions": [], "continueDelay": 20, "classAllowMin": 10}
    asked = parse_time(st.get("bs_request"))
    bs_check = bool(asked and t0 - asked < dt.timedelta(minutes=10))
    if not sess:
        return {"session": None, "protect": protect, "bs_check": bs_check}
    elapsed = (t0 - parse_time(sess["started_at"])).total_seconds()
    try:
        p = note_path(sess["id"])
        url = V.load_task(CFG["vault"], p, V.vaultlib(CFG["vault"]).read_frontmatter(p), V.read(p))["url"]
    except Bad:
        url = ""
    return {"session": {"state": "active", "title": sess["title"], "step": sess["step"],
                        "remainingSec": max(0, round(sess["est"] * 60 - elapsed)),
                        "protectUntil": (t0 + dt.timedelta(minutes=2)).isoformat(), "url": url,
                        "allow": [a for a in sess.get("allow", []) if parse_time(a["until"]) and parse_time(a["until"]) > t0]},
            "protect": protect, "bs_check": bs_check}


def focus_act(body):
    with LOCK:
        st = load_state()
        sess = st.get("session")
        if body.get("action") == "allow" and sess:
            mins = max(1, min(60, int(body.get("minutes") or 10)))
            sess.setdefault("allow", []).append({"pattern": str(body.get("pattern") or "")[:200],
                                                 "until": (now() + dt.timedelta(minutes=mins)).isoformat()})
        elif body.get("action") in ("endFocus", "stop"):
            st["session"] = None
        elif body.get("action") == "hello":
            st["extension_seen"] = now().isoformat()
        save_state(st)
    return focus_view()


# ---------- background: midnight notes, upkeep, notifications ----------
def notify(title, message):
    if os.environ.get("GP_NO_NOTIFY") == "1":
        print("notify (muted):", title, "|", message, flush=True)
        return
    subprocess.run(["osascript", "-e", "on run argv", "-e",
                    'display notification (item 2 of argv) with title "Game Plan" subtitle (item 1 of argv)', "-e", "end run",
                    title, message], capture_output=True)


def nudge(t0):
    """At most 4 a day, only in free gaps, never within 90 min of a Start; ignored tasks get fewer."""
    vault = CFG["vault"]
    sched = V.schedule(vault)
    with LOCK:
        st = load_state()
        n = st.setdefault("nudges", {})
        if n.get("date") != t0.date().isoformat():
            n.update(date=t0.date().isoformat(), sent=0, tasks=[])
        last_start = parse_time((st.get("last_start") or {}).get("at"))
        last = parse_time(n.get("last"))
        if st.get("session") or n["sent"] >= 4 or V.busy_now(t0, sched) or \
                (last_start and t0 - last_start < dt.timedelta(minutes=90)) or (last and t0 - last < dt.timedelta(minutes=90)):
            return None
        ignored = n.setdefault("ignored", {})
        if n.get("last_id") and not (last_start and last and last_start > last and (st.get("last_start") or {}).get("id") == n["last_id"]):
            ignored[n["last_id"]] = ignored.get(n["last_id"], 0) + 1
            n["last_id"] = None
        ranked = V.rank(V.tasks(vault), t0, sched, st.get("skipped", {}).get(t0.date().isoformat(), []))
        pick = next((t for t, _ in ranked if not (ignored.get(t["id"], 0) >= 3 and t["id"] in n["tasks"])), None)
        if not pick:
            return None
        n.update(sent=n["sent"] + 1, last=t0.isoformat(), last_id=pick["id"])
        n["tasks"].append(pick["id"])
        save_state(st)
    notify(pick["title"], f"{V.due_words(pick, t0.date()).capitalize()} · {pick['points']} pts. Open Game Plan and press Start.")
    return pick["id"]


def upkeep(t0, force=False):
    """Links, tags and 📊 lines; at midnight, finish every past day's daily note (zero days included)."""
    vault = CFG["vault"]
    with LOCK:
        st = load_state()
        roll = V.date_or_none(st.get("rollover")) or t0.date() - dt.timedelta(days=2)
        yesterday = t0.date() - dt.timedelta(days=1)
        if not force and roll >= yesterday:
            return False
        ts, _ = V.ensure_vault(vault, t0.date())
        d = roll + dt.timedelta(days=1)
        while d <= yesterday:
            V.refresh_day(vault, d, ts)
            d += dt.timedelta(days=1)
        st["rollover"] = max(roll, yesterday).isoformat()
        save_state(st)
    return True


def ticker():
    seen, last_nudge, last_size = None, 0.0, 0.0
    while True:
        try:
            t0, v = now(), version()
            if v != seen:                              # something changed (Obsidian, the sync, the app): redraw
                upkeep(t0, force=True)
                seen = version()
            else:
                upkeep(t0)                             # still finishes yesterday's daily note at midnight
            if time.time() - last_nudge > 60:
                nudge(t0)
                last_nudge = time.time()
            if time.time() - last_size > 600 and os.environ.get("GP_NO_SIZE") != "1":
                last_size = time.time()
                done = size_open()
                if done:
                    print("sized:", ", ".join(done), flush=True)
                    seen = None
        except Exception as e:  # never take the server down over upkeep
            print("ticker:", type(e).__name__, e, flush=True)
        time.sleep(3)


# ---------- HTTP ----------
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".json": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png"}
ROUTES = {
    "/api/start": lambda b: (start(b), {})[1],
    "/api/done": lambda b: {"done": finish(b.get("id"))},
    "/api/skip": lambda b: (skip(b), {})[1],
    "/api/pick": lambda b: (pick(b), {})[1],
    "/api/open": lambda b: (open_url(b), {})[1],
    "/api/setup/extension": lambda b: (setup_extension(b), {})[1],
    "/api/brightspace/report": bs_report,
    "/api/brightspace/check": lambda b: (bs_request(b), {})[1],
    "/api/stop": lambda b: (focus_act({"action": "stop"}), {})[1],
    "/api/stuck": stuck,
    "/api/undo": lambda b: (undo_done(b), {})[1],
    "/api/size": lambda b: (resize(b), {})[1],
    "/api/command": command,
    "/api/command/undo": undo_command,
    "/api/spitball": spitball,
    "/api/checkin": lambda b: (checkin(b), {})[1],
}


def pick(body):
    """'Do now' from the list: this task becomes today's one thing."""
    with LOCK:
        t = find_task(V.tasks(CFG["vault"]), body.get("id"))
        st = load_state()
        st["pick"] = {"date": dt.date.today().isoformat(), "id": t["id"]}
        st["skipped"] = {k: [i for i in v if i != t["id"]] for k, v in st.get("skipped", {}).items()}
        save_state(st)


def skip(body):
    with LOCK:
        t = find_task(V.tasks(CFG["vault"]), body.get("id"))
        st = load_state()
        today = dt.date.today().isoformat()
        st["skipped"] = {today: st.get("skipped", {}).get(today, []) + [t["id"]]}    # only today's skips are kept
        save_state(st)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _host_ok(self):   # DNS-rebinding guard: only answer requests addressed to this machine
        return self.headers.get("Host", "") in (f"127.0.0.1:{CFG['port']}", f"localhost:{CFG['port']}")

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "forbidden"})
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/api/state":
                return self._send(200, state_json())
            if path == "/api/focus":
                return self._send(200, focus_view())
            if path == "/api/brightspace/tasks":
                return self._send(200, bs_tasks())
            if path == "/api/version":
                return self._send(200, {"v": version()})
        except Exception as e:
            print("GET", path, type(e).__name__, e, flush=True)
            return self._send(500, {"error": "Something broke reading the vault. Check the server log."})
        name = "index.html" if path == "/" else path.lstrip("/")
        full = os.path.realpath(os.path.join(APP_DIR, name))
        ext = os.path.splitext(full)[1]
        if full.startswith(os.path.realpath(APP_DIR) + os.sep) and ext in TYPES and os.path.isfile(full):
            return self._send(200, open(full, "rb").read(), TYPES[ext])
        self._send(404, {"error": "not found"})

    def do_POST(self):
        # Custom header = browsers must preflight cross-site requests, which we never approve.
        if not self._host_ok() or self.headers.get("X-Game-Plan") != "1":
            return self._send(403, {"error": "forbidden"})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 100_000)) or b"{}")
            assert isinstance(body, dict)
        except (ValueError, AssertionError):
            return self._send(400, {"error": "bad json"})
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/api/focus":
                return self._send(200, focus_act(body))
            if path not in ROUTES:
                return self._send(404, {"error": "not found"})
            out = ROUTES[path](body)
            out["state"] = state_json()
            return self._send(200, out)
        except Bad as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            print("POST", path, type(e).__name__, e, flush=True)
            return self._send(500, {"error": "Something broke. Your notes are fine; check the server log."})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=CFG["port"])
    ap.add_argument("--vault", default=CFG["vault"])
    ap.add_argument("--state", default=CFG["state"])
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    CFG.update(vault=os.path.expanduser(a.vault), state=os.path.expanduser(a.state), port=a.port)
    if a.dry_run:
        print(json.dumps(state_json(), indent=1))
        return
    upkeep(now(), force=True)
    threading.Thread(target=ticker, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)   # localhost only
    print(f"Game Plan → http://127.0.0.1:{a.port}  (vault: {CFG['vault']})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
