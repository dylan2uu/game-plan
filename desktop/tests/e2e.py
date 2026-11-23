"""End-to-end: type a task -> answer the two questions -> Start -> Done, then check every file it should touch.

Run against a COPY of the vault (it really files notes and calls Claude):
  GP_NO_NOTIFY=1 python3 desktop/server.py --port 4399 --vault /tmp/vcopy --state /tmp/vcopy-state.json &
  uv run --with playwright python desktop/tests/e2e.py --base http://127.0.0.1:4399 --vault /tmp/vcopy --shots /tmp/shots
Uses the installed Google Chrome (no browser download).
"""
import argparse
import datetime as dt
import glob
import os
import re

from playwright.sync_api import expect, sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:4399")
ap.add_argument("--vault", required=True)
ap.add_argument("--shots", required=True)
a = ap.parse_args()
os.makedirs(a.shots, exist_ok=True)
today = dt.date.today().isoformat()


def read(rel):
    return open(os.path.join(a.vault, rel), encoding="utf-8").read()


def stat(rel):
    m = re.search(r"(?m)^> \*\*(\d+) pts\*\* · .*? · (\d+) done", read(rel))          # the level card under the title
    return (int(m.group(2)), int(m.group(1))) if m else (0, 0)


before = {r: stat(r) for r in ("2 Classes/CS 350/CS 350 Hub.md", "1 Map/Goals/Goal - CS Degree.md", "1 Map/Vision.md")}
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(a.base + "/")
    expect(pg.locator(".hero .title")).to_be_visible()
    pg.screenshot(path=os.path.join(a.shots, "1-busy-day.png"))
    assert pg.evaluate("document.documentElement.scrollHeight <= innerHeight"), "page scrolls at 1440x900"

    # 1. type a task
    pg.fill("#type-in", "add: outline the CS 350 PROJ3 design doc, due tomorrow, maybe 20 minutes")
    pg.press("#type-in", "Enter")
    expect(pg.locator("#cmd-result")).to_be_visible(timeout=90_000)
    print("command bar:", pg.locator("#cmd-result .cmd-text").inner_text())
    added = max(glob.glob(os.path.join(a.vault, "2 Classes/CS 350/Assignments/*.md")), key=os.path.getmtime)
    title = re.search(r"(?m)^# (.+)$", read(added)).group(1)
    assert "outline" in title.lower(), title

    # bring it to the top (skips only last for today)
    for _ in range(25):
        if title.lower() in pg.locator(".hero .title").inner_text().lower():
            break
        pg.click("#skip")
        pg.wait_for_timeout(300)
    expect(pg.locator(".hero .title")).to_contain_text(title, ignore_case=True)

    # 2. Start is one click (it shows the estimate)
    expect(pg.locator("#start .go-est")).to_contain_text("~")
    pg.click("#start")
    expect(pg.locator(".kicker")).to_have_text("On the clock")
    pg.wait_for_timeout(1500)
    pg.screenshot(path=os.path.join(a.shots, "2-on-the-clock.png"))

    # 3. Done: the burst, the chain, the guess
    pg.click("#done")
    expect(pg.locator("#burst")).to_be_visible()
    pg.wait_for_timeout(2300)
    pg.screenshot(path=os.path.join(a.shots, "3-done-burst.png"))
    walk = pg.locator("#burst .walk").inner_text()
    print("burst:", " ".join(walk.split()))
    assert "CS 350" in walk and "CS Degree" in walk and "Software Engineer" in walk, walk
    expect(pg.locator("#burst .guess-line")).to_contain_text("Estimated")
    pg.click("#burst")

    # 3b. All tasks: Submit links, Done straight from the list, Do now sends a task to the main screen
    pg.click("#tab-all")
    expect(pg.locator("#list .row").first).to_be_visible()
    assert pg.locator("#list a.t[data-ext]").count() > 0, "no Brightspace links in the list"
    pg.screenshot(path=os.path.join(a.shots, "3b-all-tasks.png"))
    row = pg.locator("#list .row:has(.tick)").first
    listed_done = row.locator(".t").inner_text()
    row.locator(".tick").click()
    expect(pg.locator("#burst")).to_be_visible()
    pg.click("#burst")
    expect(pg.locator("#list .row .t", has_text=listed_done)).to_have_count(0)
    row = pg.locator("#list .row:has(.tick)").first                           # a mis-click gets undone
    oops = row.locator(".t").inner_text().rstrip("↗")
    row.locator(".tick").click()
    expect(pg.locator("#undo")).to_be_visible()
    pg.click("#undo")
    expect(pg.locator("#list .row .t", has_text=oops)).to_have_count(1)
    row = pg.locator("#list .row:has(.tick)").nth(1)
    picked = row.locator(".t").inner_text().rstrip("↗")
    row.locator("[data-act=start]").click()                                   # Start from the list: straight onto the clock
    expect(pg.locator(".kicker")).to_have_text("On the clock")
    expect(pg.locator(".hero .title")).to_have_text(picked)
    pg.click("#stop")
    print("list: done", repr(listed_done), "| started", repr(picked))
    assert pg.locator("#next .row").count() > 0, "Up next is empty"
    pg.click("#how-points")
    expect(pg.locator("#sheet h2")).to_have_text("How points and levels work")
    pg.screenshot(path=os.path.join(a.shots, "3c-points.png"))
    pg.keyboard.press("Escape")

    # 4. an idea opens Spitball
    pg.fill("#type-in", "idea: a study group that meets right after each weekly quiz")
    pg.press("#type-in", "Enter")
    expect(pg.locator("#sheet")).to_be_visible(timeout=90_000)
    expect(pg.locator("#thread p").first).to_be_visible()
    pg.fill("#sp-in", "People skip it when it's optional.")
    pg.click("#sp-go")
    expect(pg.locator("#sp-go")).to_have_text("Send", timeout=90_000)          # Claude answered
    assert pg.locator("#thread p.me + p").count() == 1, "no reply after my answer"
    pg.screenshot(path=os.path.join(a.shots, "4-spitball.png"))
    pg.keyboard.press("Escape")

    # 5. the main screen explains itself: today's count, levels (click one), the week's build list
    pg.click("#tab-now")
    expect(pg.locator(".levels .lv").first).to_be_visible()
    pg.locator(".lv-btn").first.click()
    expect(pg.locator(".ladder tr.here")).to_be_visible()
    pg.screenshot(path=os.path.join(a.shots, "5-level.png"))
    pg.keyboard.press("Escape")
    pg.click("#share-week")
    expect(pg.locator("#week-text")).to_contain_text("This week I built")
    pg.screenshot(path=os.path.join(a.shots, "6-week.png"))
    pg.keyboard.press("Escape")
    # 6. live: a change made outside the app (like in Obsidian) shows up without a reload
    rid = pg.locator("#next .row").first.get_attribute("data-id")
    note = os.path.join(a.vault, rid)
    text = open(note, encoding="utf-8").read()
    open(note, "w", encoding="utf-8").write(re.sub(r"(?m)^status: \w+", "status: done", text, count=1).replace("---\n", f"---\ndone_date: {today}\n", 1))
    expect(pg.locator(f'#next .row[data-id="{rid}"]')).to_have_count(0, timeout=8_000)
    print("live: edited on disk →", os.path.basename(rid), "left Up next without a reload")
    b.close()

# 6. the files
note = [f for f in glob.glob(os.path.join(a.vault, "2 Classes/CS 350/Assignments/*.md")) if title.lower() in read(f).lower()][0]
text = read(note)
for want in ("status: done", f"done_date: {today}", "actual_min:", "Part of [[CS 350 Hub]]", "#done", "est_min:", "sized: claude"):
    assert want in text, f"task note missing {want!r}"
stem = os.path.splitext(os.path.basename(note))[0]
daily = read(f"5 Days/{today}.md")
assert f"[[{stem}]]" in daily and "## Started" in daily, "daily note not updated"
for rel, (n, pts) in before.items():
    n2, pts2 = stat(rel)
    exact = rel.endswith("CS 350 Hub.md")      # the list's Done can also feed the goals and the vision
    assert (n2 == n + 1 if exact else n2 >= n + 1) and pts2 > pts, f"{rel}: {n}/{pts} -> {n2}/{pts2}"
    print(f"{rel}: {n} → {n2} done, {pts} → {pts2} pts")
idea = sorted(glob.glob(os.path.join(a.vault, "4 Life/Ideas/*.md")), key=os.path.getmtime)[-1]
assert "#idea" in read(idea) and "**Me:** People skip" in read(idea)
print("E2E OK:", os.path.relpath(note, a.vault), "|", os.path.relpath(idea, a.vault))
