"""A made-up vault for README screenshots (no real data), plus the screenshots themselves.

  uv run --with playwright python desktop/tests/demo.py DEST [--shots docs/screenshots]
Builds DEST as a demo vault. With --shots: serves it on port 4397 and captures the page,
the running clock and the Done moment at 1440x900 (installed Chrome, Claude never called).
"""
import argparse
import datetime as dt
import os
import random
import shutil
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ["GP_NO_NOTIFY"] = "1"

ap = argparse.ArgumentParser()
ap.add_argument("dest")
ap.add_argument("--shots")
a = ap.parse_args()
root, today = os.path.abspath(a.dest), dt.date.today()
shutil.rmtree(root, ignore_errors=True)


def put(rel, text):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", encoding="utf-8").write(text)


os.makedirs(os.path.join(root, "System", "scripts"))
shutil.copy(os.path.join(os.path.expanduser(os.environ.get("GP_VAULT", "~/Obsidian/Vault")), "System", "scripts", "vaultlib.py"),
            os.path.join(root, "System", "scripts"))
put("System/Templates/Daily.md", "---\ntype: daily\ndate: {{date:YYYY-MM-DD}}\n---\n# {{date:dddd, MMM D}}\n\n## Started\n-\n\n## Done\n-\n")
put("System/schedule.md", "## Sleep\n- Daily 23:00-07:00 sleep\n\n## Busy\n- Mon/Wed/Fri 10:00-11:15 Operating Systems\n"
    "- Tue/Thu 13:00-14:15 Discrete Math\n")
put("System/experiments.md", "Active: 1\nNext: 2\nDaily reward (10 pts): A pickup game.\n\n## Queue\n"
    "1. **Phone in the hallway.** It charges outside the room after 11.\n2. **Hard thing first.** Before any email.\n")
put("07 Map/Vision.md", "---\ntype: vision\n---\n# Vision\n\nShip work people use, stay strong, stay kind.\n")
for name, parent in (("Software Engineer", "Vision"), ("Degree", "Goal - Software Engineer"), ("Health", "Vision")):
    put(f"07 Map/Goal - {name}.md", f"---\ntype: goal\n---\n# {name}\nPart of [[{parent}]]\n")
for name, parent in (("School", "Degree"), ("Body", "Health"), ("Career", "Software Engineer")):
    put(f"07 Map/Area - {name}.md", f"---\ntype: area\n---\n# {name}\nPart of [[Goal - {parent}]]\n")
for c in ("Operating Systems", "Discrete Math", "Writing"):
    put(f"01 Classes/{c}/{c} Hub.md", f"---\ntype: hub\nkind: class\n---\n# {c}\nPart of [[Area - School]]\n")


def task(title, cls, due=None, points=3, status="todo", done=None, mins=None):
    d = (today + dt.timedelta(days=due)).isoformat() if due is not None else ""
    extra = (f"done_date: {today - dt.timedelta(days=done)}\n" if done is not None else "") + (f"actual_min: {mins}\n" if mins else "")
    url = f'brightspace_url: "https://lms.example.edu/submit/{abs(hash(title)) % 9999}"\n' if cls in ("Operating Systems", "Discrete Math", "Writing") else ""
    put(f"00 Inbox/Assignments/{title}.md", f"---\ntype: assignment\nclass: {cls}\ndue: {d}\nstatus: {status}\npoints: {points}\n"
        f"first_step: Open it\n{url}{extra}---\n# {title}\n")


task("Lab 4: page tables", "Operating Systems", 0, 8)
task("Reading response", "Writing", 1, 2)
task("Leg day", "Body", 1, 2)
task("Problem set 9", "Discrete Math", 2, 5)
task("Quiz review", "Discrete Math", 3, 3)
task("Portfolio README", "Career", None, 2)
task("Lab 5: file systems", "Operating Systems", 12, 13)
task("Essay draft", "Writing", 6, 5)
task("Midterm review", "Discrete Math", 9, 5)
task("Lab 3: scheduler", "Operating Systems", -2, 8, "done", 0, 70)
task("Proof warm-ups", "Discrete Math", 0, 2, "done", 0, 20)
rng = random.Random(4)
for i in range(1, 14):
    if i in (4, 9):
        continue                                           # two honest zero days
    for j in range(rng.randint(1, 3)):
        cls = rng.choice(["Operating Systems", "Discrete Math", "Writing", "Body", "Career"])
        task(f"Earlier {cls} task {i}-{j}", cls, -i, rng.choice([1, 2, 3, 5]), "done", i, rng.choice([15, 25, 40]))
print("demo vault:", root)

if a.shots:
    import server as S
    from http.server import ThreadingHTTPServer
    from playwright.sync_api import expect, sync_playwright
    S.CFG.update(vault=root, state=os.path.join(root, ".state.json"), port=4397)
    S.upkeep(S.now(), force=True)
    srv = ThreadingHTTPServer(("127.0.0.1", 4397), S.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    os.makedirs(a.shots, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome")
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        pg.goto("http://127.0.0.1:4397/")
        expect(pg.locator(".hero .title")).to_be_visible()
        pg.screenshot(path=os.path.join(a.shots, "now.png"))
        pg.click('.chip-btn[data-min="60"]')
        pg.click("#start")
        expect(pg.locator(".kicker")).to_have_text("On the clock")
        pg.wait_for_timeout(1200)
        pg.screenshot(path=os.path.join(a.shots, "clock.png"))
        pg.click("#done")
        pg.wait_for_timeout(2400)
        pg.screenshot(path=os.path.join(a.shots, "done.png"))
        pg.click("#burst")
        pg.click("#tab-all")
        pg.wait_for_selector("#list .row")
        pg.screenshot(path=os.path.join(a.shots, "all.png"))
        b.close()
    srv.shutdown()
    print("screenshots:", a.shots)
