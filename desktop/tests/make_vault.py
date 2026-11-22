#!/usr/bin/env python3
"""Make a throwaway copy of the vault for tests (assignment notes, scripts, Game Plan data only).

  python3 make_vault.py DEST [--empty] [--overdue] [--legacy] [--long]
Never copies anything outside 01 Classes / System/scripts / System/gameplan.json (no Con Ed, no journals).
"""
import argparse, json, os, re, shutil, datetime as dt

SRC = os.path.expanduser(os.environ.get("GP_VAULT", "~/Obsidian/Vault"))
ap = argparse.ArgumentParser()
ap.add_argument("dest")
ap.add_argument("--empty", action="store_true", help="no assignments at all")
ap.add_argument("--overdue", action="store_true", help="every assignment already late")
ap.add_argument("--legacy", action="store_true", help="add a v1 timer + v1 focus log to migrate")
ap.add_argument("--long", action="store_true", help="add an assignment with a very long title, no link")
a = ap.parse_args()
dst = os.path.abspath(a.dest)
shutil.rmtree(dst, ignore_errors=True)
os.makedirs(os.path.join(dst, "System"))
os.makedirs(os.path.join(dst, "06 Daily"))
shutil.copytree(os.path.join(SRC, "System", "scripts"), os.path.join(dst, "System", "scripts"),
                ignore=shutil.ignore_patterns("*.bak", "__pycache__"))
store = json.load(open(os.path.join(SRC, "System", "gameplan.json")))
store["meta"].pop("session", None); store["meta"].pop("nudge", None); store["meta"].pop("integrations", None)
if not a.empty:
    shutil.copytree(os.path.join(SRC, "01 Classes"), os.path.join(dst, "01 Classes"),
                    ignore=shutil.ignore_patterns("*.bak"))
    today = dt.date.today()
    for root, _, files in os.walk(os.path.join(dst, "01 Classes")):
        for f in files:
            p = os.path.join(root, f)
            if not f.endswith(".md"):
                continue
            t = open(p, encoding="utf-8").read()
            if "type: assignment" not in t:
                continue
            if a.overdue:
                t = re.sub(r"^due: .*$", f"due: {(today - dt.timedelta(days=2)).isoformat()}", t, flags=re.M)
                t = re.sub(r"^status: done$", "status: todo", t, flags=re.M)
            open(p, "w", encoding="utf-8").write(t)
if a.long:
    d = os.path.join(dst, "01 Classes", "CS 301", "Assignments"); os.makedirs(d, exist_ok=True)
    long = "Technical Research Paper Final Submission Including Abstract, Social Impact Analysis, Figures, Conclusion, References, and Peer Review Responses"
    open(os.path.join(d, long + ".md"), "w").write(
        "---\ntype: assignment\nclass: CS 301\ndue: %s\nstatus: todo\nfirst_step: Open the rubric and list every required section\nsource: gameplan\n---\n# %s\n"
        % ((dt.date.today() + dt.timedelta(days=3)).isoformat(),
           "Technical Research Paper Final Submission Including Abstract, Social Impact Analysis, Figures, Conclusion, References, and Peer Review Responses"))
if a.legacy:
    tid = next(iter(store["extra"]), None)
    store["meta"]["timer"] = {"taskId": tid, "startedAt": (dt.datetime.utcnow() - dt.timedelta(minutes=20)).isoformat() + "Z", "mode": "up"}
json.dump(store, open(os.path.join(dst, "System", "gameplan.json"), "w"), indent=1)
print(dst)
