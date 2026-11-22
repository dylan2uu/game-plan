#!/usr/bin/env python3
"""Game Plan nudge: pops the app onto your screen at random moments to get you working.

launchd runs this every 15 minutes. Each run rolls the dice; the closer a deadline, the likelier a pop:
  overdue or due today 55% · due in 1-2 days 35% · due in 3-6 days 20% · nothing due this week: never
Guard rails (so it nudges, not nags):
  - only 9:30-22:30 (11:00 on weekends) or inside a study window, never in quiet hours; at most 6 a day, 60+ min apart
  - never during a focus block or break, or within 60 min of starting something
  - never while you're snoozed ("In 1 hour" / "Done for today" in the app)
A pop opens Game Plan in its own window with a "25 minutes on <task>?" card on top.

Usage: python3 nudge.py [--dry-run] [--force] [--vault PATH]
"""
import argparse
import datetime as dt
import json
import os
import random
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bridge  # noqa: E402
import focus  # noqa: E402
import server  # noqa: E402

APP_URL = "http://127.0.0.1:4317/"
STATE = os.path.expanduser("~/Library/Application Support/GamePlan/nudge.json")
MAX_PER_DAY, GAP_MIN = 6, 60


def parse_iso(s):
    try:
        d = dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d.astimezone().replace(tzinfo=None) if d.tzinfo else d
    except (TypeError, ValueError):
        return None


def started_recently(vault, now, minutes=60):
    p = os.path.join(vault, "06 Daily", f"{now.date().isoformat()}.md")
    if not os.path.exists(p):
        return False
    for hh, mm in re.findall(r"^- (\d{1,2}):(\d{2}) ", open(p, encoding="utf-8").read(), re.M):
        t = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        if dt.timedelta(0) <= now - t <= dt.timedelta(minutes=minutes):
            return True
    return False


def pick(tasks, now):
    """Most pressing open task: due time minus the time it needs (4x its estimate)."""
    best = None
    for tid, t in tasks.items():
        due = parse_iso(t.get("due"))
        if t.get("status") != "open" or not due:
            continue
        key = due - dt.timedelta(minutes=4 * int(t.get("estMin") or 45))
        if best is None or key < best[0]:
            best = (key, tid, t, due)
    return best


def chance(days):
    if days <= 0:
        return 0.55
    if days <= 2:
        return 0.35
    if days <= 6:
        return 0.20
    return 0.0


def load_state(today):
    try:
        s = json.load(open(STATE))
    except (OSError, ValueError):
        s = {}
    if s.get("day") != today:
        s = {"day": today, "count": 0, "last": None}
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="decide and print, don't pop")
    ap.add_argument("--force", action="store_true", help="skip the dice and the guard rails")
    ap.add_argument("--vault", default=server.VAULT)
    a = ap.parse_args()
    vault = os.path.expanduser(a.vault)
    vl = server.load_vaultlib(vault)
    now = dt.datetime.now()
    stamp = f"{now:%Y-%m-%d %H:%M}"
    snap = bridge.snapshot(vl, vault)
    meta = snap.get("meta", {})
    st = load_state(now.date().isoformat())

    def skip(why):
        print(stamp, "skip:", why)

    if not a.force:
        store = bridge.load_store(vault)
        fst = focus.settings(store)
        if focus.in_quiet(fst, now):
            return skip("quiet hours")
        start_h = 11.0 if now.weekday() >= 5 else 9.5
        hour = now.hour + now.minute / 60
        if not (start_h <= hour <= 22.5) and not focus.in_study_window(fst, now):
            return skip("outside hours")
        if st["count"] >= MAX_PER_DAY:
            return skip("daily cap")
        last = parse_iso(st.get("last"))
        if last and now - last < dt.timedelta(minutes=GAP_MIN):
            return skip("popped recently")
        sess = focus.state(vl, vault)["session"] or {}             # reconciled: a slept/abandoned block isn't "running"
        ended = parse_iso(sess.get("pausedAt"))
        if sess.get("state") in ("active", "break") or (sess.get("state") == "review" and ended and now - ended < dt.timedelta(hours=2)):
            return skip("focus block running")
        snooze = parse_iso((meta.get("nudge") or {}).get("snoozeUntil"))
        if snooze and now < snooze:
            return skip("snoozed")
        if started_recently(vault, now):
            return skip("started something in the last hour")

    best = pick(snap["tasks"], now)
    if not best:
        return skip("nothing open with a due date")
    _, tid, t, due = best
    days = (due.date() - now.date()).days
    p = 1.0 if a.force else chance(days)
    roll = random.random()
    if roll >= p:
        return skip(f"dice ({roll:.2f} >= {p:.2f}) for {t['title']}")

    url = APP_URL + "?nudge=" + tid
    print(stamp, "pop:", t["title"], url)
    if a.dry_run:
        return
    st["count"] += 1
    st["last"] = now.isoformat(timespec="minutes")
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(st, open(STATE, "w"))
    chrome = "/Applications/Google Chrome.app"
    if os.path.isdir(chrome):   # its own window, no tabs or address bar
        subprocess.run(["open", "-na", chrome, "--args", "--app=" + url], check=False)
    else:
        subprocess.run(["open", url], check=False)


if __name__ == "__main__":
    main()
