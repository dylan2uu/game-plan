"""Game Plan v3 tests on a throwaway vault. Claude and notifications are stubbed.

Run: python3 -m unittest discover -s desktop/tests -v
Needs the vault's System/scripts/vaultlib.py (copied from $GP_VAULT, default ~/Obsidian/Vault).
"""
import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ["GP_NO_NOTIFY"] = "1"
import import_history as I  # noqa: E402
import server as S  # noqa: E402
import vault as V  # noqa: E402

REAL = os.path.expanduser(os.environ.get("GP_VAULT", "~/Obsidian/Vault"))
TODAY = dt.date.today()


def put(root, rel, text):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", encoding="utf-8").write(text)
    return p


def task(root, name, cls="CS 350", due=None, status="todo", extra=""):
    folder = f"01 Classes/{cls}/Assignments" if cls == "CS 350" else "00 Inbox/Assignments"
    return put(root, f"{folder}/{name}.md", f"---\ntype: assignment\nclass: {cls}\ndue: {due or ''}\nstatus: {status}\n"
               f"first_step: Open it\nsource: brightspace\n{extra}---\n# {name} - Due\n\n## Notes\n")


def make_vault():
    root = tempfile.mkdtemp(prefix="gp-test-")
    os.makedirs(os.path.join(root, "System", "scripts"))
    shutil.copy(os.path.join(REAL, "System", "scripts", "vaultlib.py"), os.path.join(root, "System", "scripts"))
    put(root, "System/Templates/Daily.md", "---\ntype: daily\ndate: {{date:YYYY-MM-DD}}\nenergy:\n---\n# {{date:dddd, MMM D}}\n\n"
        "## Started\n-\n\n## Done\n-\n")
    put(root, "System/schedule.md", "## Sleep\n- Daily 22:30-07:00 sleep\n\n## Busy\n- Mon/Wed/Fri 08:00-09:30 MATH 314\n"
        "- ?? CS 350 (days)\n\n## Breaks\n- 2026-11-25 to 2026-11-29 No classes\n")
    put(root, "System/experiments.md", "Active: 4\nNext: 1\nDaily reward (10 pts): Basketball.\n\n## Queue\n"
        "1. **The gym is the alarm.** Sleep in gym clothes.\n2. **Night lock** plus phone away.\n"
        "3. **The homework is the quiz.** 20 minutes by hand.\n4. **Ship ugly.** Freeze the resume.\n\n## Log\n- start\n")
    put(root, "07 Map/Vision.md", "---\ntype: vision\n---\n# Vision\n\nBig picture.\n")
    put(root, "07 Map/Goal - Software Engineer.md", "---\ntype: goal\n---\n# Software Engineer\nPart of [[Vision]]\n")
    put(root, "07 Map/Goal - CS Degree.md", "---\ntype: goal\n---\n# CS Degree\nPart of [[Goal - Software Engineer]]\n")
    put(root, "07 Map/Goal - Body.md", "---\ntype: goal\n---\n# Body\nPart of [[Vision]]\n")
    put(root, "07 Map/Area - School.md", "---\ntype: area\n---\n# School\nPart of [[Goal - CS Degree]]\n")
    put(root, "07 Map/Area - Body.md", "---\ntype: area\n---\n# Body\nPart of [[Goal - Body]]\n")
    put(root, "01 Classes/CS 350/CS 350 Hub.md", "---\ntype: hub\nkind: class\n---\n# CS 350\nPart of [[Area - School]]\n\n## Overview\n")
    return root


class Base(unittest.TestCase):
    def setUp(self):
        self.v = make_vault()
        S.CFG.update(vault=self.v, state=os.path.join(self.v, ".state.json"))
        self.calls = []
        S.ai = self.fake_ai

    def tearDown(self):
        shutil.rmtree(self.v, ignore_errors=True)

    def fake_ai(self, prompt, model="haiku", timeout=0):
        self.calls.append(prompt)
        return self.answer


@unittest.skipUnless(os.path.exists(os.path.join(REAL, "System", "scripts", "vaultlib.py")), "needs vaultlib.py")
class ModelTests(Base):
    def test_schedule_free_time_and_breaks(self):
        sched = V.schedule(self.v)
        mon = dt.date(2026, 11, 23)                       # a Monday
        a, b = dt.datetime.combine(mon, dt.time(7)), dt.datetime.combine(mon, dt.time(12))
        # 07:00-12:00 minus class 08:00-09:30 minus assumed busy 09:30-17:00 (a ?? line is still open) = 60
        self.assertEqual(V.free_minutes(a, b, sched), 60)
        self.assertEqual(V.busy_now(dt.datetime.combine(mon, dt.time(8, 30)), sched), "MATH 314")
        self.assertEqual(V.busy_now(dt.datetime.combine(mon, dt.time(23, 30)), sched), "sleep")
        wed_break = dt.datetime.combine(dt.date(2026, 11, 25), dt.time(8, 30))
        self.assertIsNone(V.busy_now(wed_break, sched))                          # no class during the break

    def test_rank_order(self):
        d = lambda n: (TODAY + dt.timedelta(days=n)).isoformat()
        task(self.v, "Old", due=d(-9))
        task(self.v, "Late", due=d(-1))
        task(self.v, "Started", due=d(5), status="doing")
        task(self.v, "Tonight", due=d(0))
        task(self.v, "Soon big", due=d(2), extra="points: 13\n")
        task(self.v, "Soon small", due=d(3), extra="points: 1\n")
        task(self.v, "Someday", cls="Body")
        now = dt.datetime.combine(TODAY, dt.time(12))
        order = [t["title"] for t, _ in V.rank(V.tasks(self.v), now, V.schedule(self.v))]
        self.assertEqual(order, ["Tonight", "Started", "Soon big", "Soon small", "Late", "Old", "Someday"])
        why = dict((t["title"], w) for t, w in V.rank(V.tasks(self.v), now, V.schedule(self.v)))
        self.assertIn("Due tonight", why["Tonight"])
        self.assertIn("Tightest fit", why["Soon big"])
        self.assertIn("1 day late", why["Late"])
        skipped = V.rank(V.tasks(self.v), now, V.schedule(self.v), skip=["01 Classes/CS 350/Assignments/Tonight.md"])
        self.assertEqual(skipped[0][0]["title"], "Started")

    def test_ensure_vault_links_tags_points_and_stats(self):
        p = task(self.v, "Homework 4", due=(TODAY - dt.timedelta(days=2)).isoformat())
        V.ensure_vault(self.v)
        text = V.read(p)
        self.assertIn("Part of [[CS 350 Hub]]", text)
        self.assertIn("#overdue", text)
        self.assertIn("points: 5", text)                   # guessed from "Homework"
        V.ensure_vault(self.v)
        self.assertEqual(V.read(p), text)                  # idempotent
        V.set_fields(p, status="done", done_date=TODAY.isoformat(), actual_min=30)
        V.ensure_vault(self.v)
        text = V.read(p)
        self.assertIn("#done", text)
        self.assertNotIn("#overdue", text)
        hub = V.read(os.path.join(self.v, "01 Classes/CS 350/CS 350 Hub.md"))
        self.assertIn(f"📊 CS 350: 1 done · 5 pts · 30m · last: {V.short_date(TODAY)}", hub)
        self.assertIn("📊 Vision: 1 done · 5 pts", V.read(os.path.join(self.v, "07 Map/Vision.md")))
        self.assertIn("📊 Body: 0 done · 0 pts", V.read(os.path.join(self.v, "07 Map/Goal - Body.md")))

    def test_zero_day_and_progress(self):
        V.refresh_day(self.v, TODAY - dt.timedelta(days=1), [])
        note = V.read(os.path.join(self.v, "06 Daily", f"{TODAY - dt.timedelta(days=1)}.md"))
        self.assertIn("📊 Game Plan: 0 done · 0 pts", note)
        for i in (0, 1, 3):
            task(self.v, f"T{i}", due=TODAY.isoformat(), status="done", extra=f"done_date: {TODAY - dt.timedelta(days=i)}\npoints: 2\n")
        pr = V.progress(V.tasks(self.v), TODAY)
        self.assertEqual((pr["today"], pr["streak"], len(pr["days"])), (2, 2, 14))
        self.assertEqual(pr["days"][-3]["total"], 0)       # zero day shows as 0

    def test_experiment_swap(self):
        ex = V.decide_experiment(self.v, "swap", "", TODAY)
        self.assertEqual((ex["active"], ex["next"], ex["title"]), (1, 2, "The gym is the alarm"))
        self.assertIn("swapped #4 Ship ugly → #1 The gym is the alarm", V.read(os.path.join(self.v, "System/experiments.md")))


@unittest.skipUnless(os.path.exists(os.path.join(REAL, "System", "scripts", "vaultlib.py")), "needs vaultlib.py")
class FlowTests(Base):
    def test_start_then_done(self):
        p = task(self.v, "PROJ3", due=TODAY.isoformat(), extra="points: 8\n")
        rel = os.path.relpath(p, self.v)
        S.start({"id": rel, "step": "Open the spec", "minutes": "40"})
        fm = V.vaultlib(self.v).read_frontmatter(p)
        self.assertEqual((fm["status"], fm["my_estimate_min"], fm["first_step"]), ("doing", "40", "Open the spec"))
        self.assertEqual(S.load_state()["session"]["id"], rel)
        self.assertIn("PROJ3 → Open the spec", V.read(os.path.join(self.v, "06 Daily", f"{TODAY}.md")))
        self.assertEqual(S.focus_view()["session"]["state"], "active")
        st = S.state_json()
        self.assertEqual(st["hero"]["id"], rel)
        res = S.finish(rel)
        self.assertEqual(res["chain"], ["CS 350", "CS Degree", "Software Engineer"])
        self.assertEqual((res["points"], res["est"], res["actual"], res["today"]), (8, 40, 1, 8))
        fm = V.vaultlib(self.v).read_frontmatter(p)
        self.assertEqual((fm["status"], fm["done_date"], fm["actual_min"]), ("done", TODAY.isoformat(), "1"))
        self.assertNotIn("started_at", fm)
        self.assertIsNone(S.load_state()["session"])
        daily = V.read(os.path.join(self.v, "06 Daily", f"{TODAY}.md"))
        self.assertIn("[[PROJ3]] · +8 pts · CS 350", daily)
        self.assertIn("📊 Game Plan: 1 done · 8 pts", daily)
        p2 = task(self.v, "Quiz", due=TODAY.isoformat(), extra="points: 2\n")
        self.assertTrue(S.finish(os.path.relpath(p2, self.v))["reward_hit"])      # 8 + 2 crosses 10
        with self.assertRaises(S.Bad):
            S.finish(rel)

    def test_bad_ids_rejected(self):
        for bad in ("../../etc/passwd", "07 Map/Vision.md", "nope.md", None):
            with self.assertRaises(S.Bad):
                S.finish(bad)

    def test_type_box_task_idea_done(self):
        self.answer = {"kind": "task", "title": "Email the professor about the quiz", "home": "CS 350", "points": 2,
                       "due": (TODAY + dt.timedelta(days=1)).isoformat(), "first_step": "Open Outlook"}
        out = S.file_typed({"text": "need to email the prof about the quiz tmrw"})
        self.assertEqual(out["task"]["cls"], "CS 350")
        p = os.path.join(self.v, "01 Classes/CS 350/Assignments", f"{TODAY + dt.timedelta(days=1)} Email the professor about the quiz.md")
        self.assertIn("Part of [[CS 350 Hub]]", V.read(p))
        self.answer = {"kind": "idea", "title": "A study group after quizzes", "home": "Nowhere", "questions": ["Who uses it?", "Why now?"]}
        out = S.file_typed({"text": "what if we ran a study group right after each quiz"})
        idea = os.path.join(self.v, out["idea"]["id"])
        self.assertIn("#idea", V.read(idea))
        self.assertIn("- **Claude:** Who uses it?", V.read(idea))
        self.answer = {"questions": ["What breaks first?"], "related": ["Area - School", "Made Up"]}
        out = S.spitball({"id": out["idea"]["id"], "reply": "people skip when it is optional"})
        text = V.read(idea)
        self.assertIn("- **Me:** people skip", text)
        self.assertIn("Related: [[Area - School]]", text)
        self.assertNotIn("Made Up", text)
        self.answer = {"kind": "done", "title": "Email the professor", "match_id": os.path.relpath(p, self.v)}
        out = S.file_typed({"text": "emailed the prof"})
        self.assertEqual(out["done"]["points"], 2)
        self.assertIn("status: done", V.read(p))

    def test_checkin_and_review(self):
        S.checkin({"got_done": "PROJ3 spec", "in_the_way": "shorts", "experiment": "yes"})
        self.assertIn("- Ran this week's experiment (#4 Ship ugly): yes", V.read(os.path.join(self.v, "06 Daily", f"{TODAY}.md")))
        S.review({"worked": "gym", "in_the_way": "sleep", "decision": "swap"})
        wk = V.read(V.weekly_path(self.v, TODAY))
        self.assertIn("## Experiment: swap", wk)
        self.assertIn("Next week: #1 The gym is the alarm", wk)

    def test_nudges(self):
        sat = dt.datetime.combine(TODAY + dt.timedelta(days=(5 - TODAY.weekday()) % 7), dt.time(13))  # a free Saturday afternoon
        task(self.v, "Paper", due=(sat.date() + dt.timedelta(days=1)).isoformat(), extra="points: 8\n")
        task(self.v, "Quiz", due=(sat.date() + dt.timedelta(days=3)).isoformat(), extra="points: 2\n")
        self.assertIsNone(S.nudge(dt.datetime.combine(sat.date(), dt.time(23, 30))))  # asleep
        self.assertTrue(S.nudge(sat).endswith("Paper.md"))
        self.assertIsNone(S.nudge(sat + dt.timedelta(minutes=30)))           # 90 min spacing
        sent = [S.nudge(sat + dt.timedelta(minutes=95 * i)) for i in range(1, 6)]
        names = [os.path.basename(x)[:-3] if x else None for x in sent]
        # Paper ignored 3 times → it stops for today and Quiz gets the 4th; then the daily cap (4) holds
        self.assertEqual(names, ["Paper", "Paper", "Quiz", None, None])
        S.start({"id": "01 Classes/CS 350/Assignments/Paper.md", "step": "Open it", "minutes": 10})
        self.assertNotIn("01 Classes/CS 350/Assignments/Paper.md", S.load_state()["nudges"]["ignored"])      # starting resets it


@unittest.skipUnless(os.path.exists(os.path.join(REAL, "System", "scripts", "vaultlib.py")), "needs vaultlib.py")
class HttpTests(Base):
    def test_guards(self):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), S.Handler)
        S.CFG["port"] = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{S.CFG['port']}"
        try:
            st = json.load(urllib.request.urlopen(base + "/api/state"))
            self.assertIn("progress", st)
            self.assertIn(b"<!doctype html>", urllib.request.urlopen(base + "/").read().lower())
            for headers in ({}, {"X-Game-Plan": "1", "Host": "evil.example"}):
                req = urllib.request.Request(base + "/api/skip", data=b"{}", headers=headers, method="POST")
                with self.assertRaises(urllib.error.HTTPError) as e:
                    urllib.request.urlopen(req)
                self.assertEqual(e.exception.code, 403)
            req = urllib.request.Request(base + "/../server.py")
            with self.assertRaises(urllib.error.HTTPError):
                urllib.request.urlopen(req)
        finally:
            srv.shutdown()


class ImportTests(unittest.TestCase):
    def test_match_and_dates(self):
        notes = [{"title": "Journal 4", "due": dt.date(2026, 11, 21)}, {"title": "Homework 10", "due": dt.date(2026, 11, 25)}]
        self.assertIs(I.match({"title": "Journal #4", "due": "2026-11-08T23:59"}, notes), notes[0])
        self.assertIsNone(I.match({"title": "Homework 1", "due": "2026-11-25T23:59"}, notes))
        self.assertIsNone(I.match({"title": "Journal #4", "due": "2026-09-01T23:59"}, notes))   # too far apart
        self.assertEqual(I.local_date("2026-10-22T02:00:00.000Z"), dt.date(2026, 10, 21))       # UTC night = local evening


if __name__ == "__main__":
    unittest.main()
