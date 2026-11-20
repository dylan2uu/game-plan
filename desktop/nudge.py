#!/usr/bin/env python3
"""Game Plan nudge: a Mac alert saying what to do next and why. Scheduled 3x/day by install.sh.

Rules (keep it gentle):
- Picks the most urgent task you HAVEN'T started (status todo), due within 7 days or overdue.
- Skips if you logged a start in the last 90 minutes (you're already working).
- Skips if nothing's urgent.
- "Open Game Plan" opens the app; "Later" just closes it. Auto-dismisses after 5 minutes.

Usage: python3 nudge.py [--dry-run] [--vault PATH]
"""
import argparse
import datetime as dt
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server  # noqa: E402  (reuses the same ranking + "why" logic as the app)

APP_URL = "http://127.0.0.1:4317"


def started_recently(vault, minutes=90):
    p = os.path.join(vault, "06 Daily", f"{dt.date.today().isoformat()}.md")
    if not os.path.exists(p):
        return False
    now = dt.datetime.now()
    for hh, mm in re.findall(r"^- (\d{1,2}):(\d{2}) ", open(p, encoding="utf-8").read(), re.M):
        t = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        if timedelta_ok(now - t, minutes):
            return True
    return False


def timedelta_ok(delta, minutes):
    return dt.timedelta(0) <= delta <= dt.timedelta(minutes=minutes)


def pick(state):
    for t in state["open"]:
        if t["status"] == "todo" and t["days"] is not None and t["days"] <= 7:
            return t
    return None


def osa_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--vault", default=server.VAULT)
    a = ap.parse_args()
    vault = os.path.expanduser(a.vault)
    vl = server.load_vaultlib(vault)
    stamp = f"{dt.datetime.now():%Y-%m-%d %H:%M}"

    if started_recently(vault):
        print(stamp, "skip: started something in the last 90 min"); return
    t = pick(server.state(vl, vault))
    if not t:
        print(stamp, "skip: nothing urgent"); return

    title = f"Next: {t['title']}"[:80]
    body = f"{t['why']}\n\n5-min step: {t['first_step']}"
    print(stamp, "nudge:", title)
    if a.dry_run:
        print(body); return
    script = (f'display alert {osa_str(title)} message {osa_str(body)} '
              'buttons {"Later", "Open Game Plan"} default button "Open Game Plan" giving up after 300')
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if "Open Game Plan" in r.stdout:
        subprocess.run(["open", APP_URL])


if __name__ == "__main__":
    main()
