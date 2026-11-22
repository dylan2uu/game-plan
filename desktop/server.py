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


def ai(prompt, model="haiku", timeout=120):
    """Ask Claude for JSON. The vault's CLAUDE.md pulls in about-me.md, so it always knows Dylan."""
    cmd = [claude_bin(), "-p", "--model", model, "--strict-mcp-config", "--tools", "", "--no-session-persistence",
           "--settings", '{"disableAllHooks": true}', prompt + "\n\nReply with ONLY one JSON object. No prose, no code fences."]
    try:
        r = subprocess.run(cmd, cwd=CFG["vault"], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise Bad("Claude took too long. Try again.")
    except OSError:
        raise Bad("The claude command isn't installed.")
    out = r.stdout.strip()
    i, j = out.find("{"), out.rfind("}")
    try:
        return json.loads(out[i:j + 1])
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


def reward(vault):
    m = re.search(r"(?m)^Daily reward[^:]*:\s*(.+)$", V.read(os.path.join(vault, "System", "experiments.md")))
    return m.group(1).strip() if m else "Basketball"


def view(t, why, nd):
    up = V.done_chain(nd, t["cls"])
    return {"id": t["id"], "title": t["title"], "cls": t["cls"], "points": t["points"], "status": t["status"],
            "due": t["due"].isoformat() if t["due"] else None, "why": why, "est": V.est_min(t),
            "first_step": t["first_step"], "url": t["url"], "chain": up + ["Vision"] if up else ["Unsorted"],
            "note": "obsidian://open?path=" + urllib.parse.quote(t["path"])}


def unique_path(folder, base):
    path, n = os.path.join(folder, base + ".md"), 2
    while os.path.exists(path):
        path, n = os.path.join(folder, f"{base} {n}.md"), n + 1
    return path


def create_task(title, cls, due=None, points=3, first_step="", status="todo", done_date=None, actual=None,
                source="gameplan", created=None, url=None):
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
          "actual_min": actual, "brightspace_url": url}
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
        hero = view(by_id[sess["id"]], "Timer's running. Stay on the first step.", nd)
        hero.update(started_at=sess["started_at"], step=sess["step"], minutes=sess["est"])
    else:
        pick = (st.get("pick") or {}) if (st.get("pick") or {}).get("date") == today.isoformat() else {}
        chosen = next(((t, "You picked this one from your list.") for t, _ in ranked if t["id"] == pick.get("id")), None)
        hero = view(*(chosen or ranked[0]), nd) if ranked else None
    win = [t for t in ts if t["due"] and today <= t["due"] <= today + dt.timedelta(days=6)]
    groups = {}
    for t in sorted(win, key=lambda t: (t["due"], t["title"])):
        groups.setdefault(t["cls"], []).append({"id": t["id"], "title": t["title"], "points": t["points"],
                                               "done": t["status"] == "done", "due": f"{t['due']:%a}"})
    ex = V.experiments(vault)
    daily = os.path.join(vault, "06 Daily", f"{today.isoformat()}.md")
    review_due = today.weekday() == 6 and not os.path.exists(V.weekly_path(vault, today))
    return {
        "now": t0.isoformat(), "today": today.isoformat(), "hero": hero, "left": max(0, len(ranked) - 1),
        "week": {"done": sum(t["status"] == "done" for t in win), "total": len(win),
                 "groups": [{"cls": c, "items": items} for c, items in groups.items()]},
        "progress": dict(V.progress(ts, today), reward=reward(vault)),
        "experiment": {"n": ex["active"], "title": ex["title"], "text": ex["text"]},
        "map": "obsidian://open?vault=" + urllib.parse.quote(os.path.basename(vault)) + "&file=" + urllib.parse.quote(V.CANVAS),
        "checkin_due": t0.hour >= 21 and not V.has_section(daily, "Night check-in"),
        "review_due": review_due, "review": V.week_numbers(ts, today) if review_due else None,
        "all": [dict(id=t["id"], title=t["title"], cls=t["cls"], points=t["points"], status=t["status"], url=t["url"],
                     due=t["due"].isoformat() if t["due"] else None, done=t["done_date"].isoformat() if t["done_date"] else None,
                     note="obsidian://open?path=" + urllib.parse.quote(t["path"])) for t in ts],
        "busy": V.busy_now(t0, sched),
        "blocker": bool(parse_time(st.get("extension_seen")) and t0 - parse_time(st.get("extension_seen")) < dt.timedelta(minutes=3)),
    }


# ---------- actions ----------
def start(body):
    step, t0 = text_arg(body, "step", 140), now()
    try:
        minutes = max(1, min(600, int(body.get("minutes"))))
    except (TypeError, ValueError):
        raise Bad("How many minutes? A number, like 25.")
    with LOCK:
        t = find_task(V.tasks(CFG["vault"]), body.get("id"))
        V.set_fields(t["path"], status="doing", first_step=step, my_estimate_min=minutes, started_at=t0.isoformat())
        st = load_state()
        st["session"] = {"id": t["id"], "title": t["title"], "step": step, "est": minutes, "started_at": t0.isoformat(), "allow": []}
        st["last_start"] = {"id": t["id"], "at": t0.isoformat()}
        st.setdefault("nudges", {}).setdefault("ignored", {}).pop(t["id"], None)
        save_state(st)
        log_started(t["title"], step)


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
        before = V.progress(ts, t0.date())["today"]
        V.set_fields(t["path"], status="done", done_date=t0.date().isoformat(), actual_min=actual, started_at=None)
        if sess:
            st["session"] = None
            save_state(st)
        ts, nd = V.ensure_vault(vault, t0.date())
        V.refresh_day(vault, t0.date(), ts)
        after = V.progress(ts, t0.date())["today"]
    return {"title": t["title"], "points": t["points"], "chain": V.done_chain(nd, t["cls"]), "est": t["my_est"], "actual": actual,
            "today": after, "goal": V.DAY_GOAL, "reward_hit": before < V.DAY_GOAL <= after, "reward": reward(vault)}


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


def file_typed(body):
    """The type box: Claude files it as a task, a finished thing, or an idea, and links it up."""
    text = text_arg(body, "text", 500)
    vault, today = CFG["vault"], dt.date.today()
    with LOCK:
        ts, nd = V.tasks(vault), V.nodes(vault)
    homes = V.homes(nd)
    open_ts = [t for t in ts if t["status"] != "done"][:40]
    res = ai(f"Dylan typed this into Game Plan's one box: \"\"\"{text}\"\"\"\nToday is {today:%A} {today}.\n"
             f"Homes (pick exactly one, or \"\"): {', '.join(homes)}\n"
             "Open tasks (id | title | home):\n" + "\n".join(f"{t['id']} | {t['title']} | {t['cls']}" for t in open_ts) + "\n\n"
             "kind: \"task\" = something to do. \"done\" = he says he already did it (past tense); if it is one of the open "
             "tasks, set match_id. \"idea\" = a thought, plan, question or opinion to think through.\n"
             'Return {"kind": "task|done|idea", "title": "short, his words, max 70 chars", "home": "...", '
             '"points": 1|2|3|5|8|13 (1 <15 min, 2 15-30, 3 30-60, 5 1-2 h, 8 2-4 h, 13 4 h+), "due": "YYYY-MM-DD or empty", '
             '"first_step": "a 2-minute physical first action, max 100 chars (tasks only)", "match_id": "id or empty", '
             '"questions": ["ideas only: 2-3 sharp questions, or one counter-argument. Never a finished answer."]}')
    kind = res.get("kind") if res.get("kind") in ("task", "done", "idea") else "task"
    title = V.vaultlib(vault).safe_name(str(res.get("title") or text), 70)
    cls = str(res.get("home") or "")
    cls = cls if cls in homes else "Unsorted"
    due = V.date_or_none(res.get("due"))
    step = re.sub(r"\s+", " ", str(res.get("first_step") or "")).strip()[:120]
    if kind == "done":
        match = next((t for t in open_ts if t["id"] == res.get("match_id")), None)
        rel = match["id"] if match else os.path.relpath(create_task(title, cls, due, res.get("points"), step), vault)
        return {"kind": "done", "done": finish(rel)}
    if kind == "idea":
        qs = [re.sub(r"\s+", " ", str(q)).strip()[:300] for q in (res.get("questions") or []) if str(q).strip()][:3]
        with LOCK:
            folder = os.path.join(vault, "00 Inbox", "Ideas")
            path = unique_path(folder, V.vaultlib(vault).safe_name(f"{today} {title}"))
            parent = V.home(nd, cls)
            V.write(path, f"---\ntype: idea\ndate: {today}\nclass: {cls}\n---\n# {title}\n"
                    + (f"Part of [[{parent}]]\n" if parent else "") + f"\n#idea\n\n## Thought\n{text}\n\n## Spitball\n"
                    + "".join(f"- **Claude:** {q}\n" for q in qs))
        return {"kind": "idea", "idea": {"id": os.path.relpath(path, vault), "title": title, "cls": cls, "questions": qs}}
    with LOCK:
        create_task(title, cls, due, res.get("points"), step)
        V.ensure_vault(vault)
    return {"kind": "task", "task": {"title": title, "cls": cls, "points": V.snap_points(res.get("points")),
                                     "due": due.isoformat() if due else None}}


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
    ran = "yes" if body.get("experiment") in (True, "yes") else "no"
    ex = V.experiments(vault)
    with LOCK:
        p = V.vaultlib(vault).daily_note(vault, today)
        V.write(p, V.replace_section(V.read(p), "Night check-in",
                                     f"- Got done that mattered: {got}\n- Got in the way: {way}\n"
                                     f"- Ran this week's experiment (#{ex['active']} {ex['title']}): {ran}"))


def review(body):
    vault, today = CFG["vault"], dt.date.today()
    worked, way = text_arg(body, "worked", 600, False) or "—", text_arg(body, "in_the_way", 600, False) or "—"
    decision = body.get("decision") if body.get("decision") in ("keep", "change", "swap") else "keep"
    note = text_arg(body, "note", 300, False)
    with LOCK:
        ts = V.tasks(vault)
        n = V.week_numbers(ts, today)
        ex = V.experiments(vault)
        after = V.decide_experiment(vault, decision, note, today)
        days = " · ".join(f"[[{(today - dt.timedelta(days=i)).isoformat()}]]" for i in range(6, -1, -1))
        V.write(V.weekly_path(vault, today),
                f"---\ntype: weekly\ndate: {today}\nexperiment: \"#{ex['active']} {ex['title']}\"\n---\n"
                f"# Week of {V.short_date(today - dt.timedelta(days=6))} – {V.short_date(today)}\n"
                f"{V.STAT}{n['points']} pts · {n['done']} done · {n['not_zero_days']}/7 not-zero days · best: {n['best_day']} · "
                f"top: {n['top']} · {n['estimate']}\n\nDays: {days}\n\n## What worked?\n{worked}\n\n## What got in the way?\n{way}\n\n"
                f"## Experiment: {decision}\n#{ex['active']} {ex['title']}" + (f": {note}" if note else "")
                + (f"\nNext week: #{after['active']} {after['title']}" if decision == "swap" else "") + "\n")


# ---------- focus blocker (Chrome extension) ----------
def focus_view():
    st, t0 = load_state(), now()
    sess = st.get("session")
    protect = {"distractions": DISTRACTIONS, "exceptions": [], "continueDelay": 20, "classAllowMin": 10}
    if not sess:
        return {"session": None, "protect": protect}
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
            "protect": protect}


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
    step = re.sub(r"^([^:>]{2,40}>\s*)+[^:]{2,80}:\s*", "", pick["first_step"] or "")    # drop "Brightspace > Class > Item:"
    notify(pick["title"], "First step: " + (step or "open it and write 3 bullets of what it's asking"))
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
    last_full = 0.0
    while True:
        try:
            t0, full = now(), time.time() - last_full > 600
            upkeep(t0, force=full)
            last_full = time.time() if full else last_full
            nudge(t0)
        except Exception as e:  # never take the server down over upkeep
            print("ticker:", type(e).__name__, e, flush=True)
        time.sleep(60)


# ---------- HTTP ----------
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".json": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png"}
ROUTES = {
    "/api/start": lambda b: (start(b), {})[1],
    "/api/done": lambda b: {"done": finish(b.get("id"))},
    "/api/skip": lambda b: (skip(b), {})[1],
    "/api/pick": lambda b: (pick(b), {})[1],
    "/api/stop": lambda b: (focus_act({"action": "stop"}), {})[1],
    "/api/stuck": stuck,
    "/api/type": file_typed,
    "/api/spitball": spitball,
    "/api/checkin": lambda b: (checkin(b), {})[1],
    "/api/review": lambda b: (review(b), {})[1],
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
