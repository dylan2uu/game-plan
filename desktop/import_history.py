#!/usr/bin/env python3
"""One-time import of Game Plan history (v1 export) into the vault.

- Dismissed tasks are skipped. Old class names map to vault classes via class-map.json next to the export;
  anything unmapped is filed by Claude.
- A task that matches a note the Brightspace sync already made updates that note (status, done date,
  points, minutes, link) instead of creating a duplicate.
- Everything else becomes a task note with its real dates, points and class.
- Then: v2 sizes (System/gameplan.json) fill in points for notes that still have none, links/tags/📊
  lines get refreshed, and every day something was finished gets its daily note.

Usage: python3 import_history.py [FILE] [--vault PATH] [--dry-run]
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server as S  # noqa: E402
import vault as V  # noqa: E402

GENERIC = "Open it and write 3 bullets"


def norm(title):
    return re.sub(r"[^a-z0-9]", "", V.clean_title(title).lower())


def local_date(stamp):
    """'2026-10-21T21:31:28.193Z' (UTC) or '2026-10-20T23:59' (local) → local date."""
    if not stamp:
        return None
    s = str(stamp)
    if s.endswith("Z"):
        return dt.datetime.fromisoformat(s[:19]).replace(tzinfo=dt.timezone.utc).astimezone().date()
    return V.date_or_none(s)


def match(h, notes):
    """The vault note for a history task: same title (or a long shared prefix), due within 3 weeks."""
    n, due = norm(h["title"]), V.date_or_none(h.get("due"))
    best = None
    for t in notes:
        m = norm(t["title"])
        same = m == n or (min(len(m), len(n)) >= 20 and (m.startswith(n) or n.startswith(m)))
        gap = abs((t["due"] - due).days) if t["due"] and due else 99
        if same and gap <= 21 and (best is None or gap < best[0]):
            best = (gap, t)
    return best[1] if best else None


def classify(titles, homes):
    if not titles:
        return {}
    res = S.ai("File each of Dylan's old tasks under exactly one home from this list: " + ", ".join(homes) +
               ".\nTasks:\n" + "\n".join(f"- {t}" for t in titles) +
               '\nReturn {"homes": {"<task exactly as written>": "<home>"}}')
    got = res.get("homes") or {}
    return {t: (got.get(t) if got.get(t) in homes else "Unsorted") for t in titles}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "import", "game-plan-history.json"))
    ap.add_argument("--vault", default=S.CFG["vault"])
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    vault = os.path.expanduser(a.vault)
    S.CFG["vault"] = vault
    hist = [t for t in json.load(open(a.file))["tasks"] if t.get("status") != "dismissed"]
    cmap = os.path.join(os.path.dirname(os.path.abspath(a.file)), "class-map.json")    # old class name → vault class (private, next to the export)
    CLASS_MAP = json.load(open(cmap)) if os.path.exists(cmap) else {}
    notes, nd = V.tasks(vault), V.nodes(vault)
    homes = V.homes(nd)
    unknown = [t["title"] for t in hist if not CLASS_MAP.get(t.get("class") or "")]
    guessed = classify(unknown, homes)
    made = updated = 0
    for h in hist:
        cls = CLASS_MAP.get(h.get("class") or "") or guessed.get(h["title"], "Unsorted")
        done = h["status"] == "done"
        fin, due = local_date(h.get("finished")) if done else None, V.date_or_none(h.get("due"))
        pts, mins = V.snap_points(h.get("points")), h.get("minutes")
        url, step = h.get("brightspace_url") or None, (h.get("first_step") or "").strip()[:140]
        t = match(h, notes)
        if t:
            fields = {"points": pts, "brightspace_url": url if url and "brightspace_url" not in V.read(t["path"]) else None}
            if done and t["status"] != "done":
                fields.update(status="done", done_date=fin.isoformat())
            elif done and not t["done_date"]:
                fields["done_date"] = fin.isoformat()
            if mins and not t["actual"]:
                fields["actual_min"] = int(mins)
            if step and (not t["first_step"] or t["first_step"].startswith(GENERIC)):
                fields["first_step"] = step
            fields = {k: v for k, v in fields.items() if v is not None}
            flag = "  (was " + t["status"] + ")" if done and t["status"] != "done" else ""
            print(f"update  {t['id'][:70]:70} ← {h['status']}{flag}")
            if not a.dry_run:
                V.set_fields(t["path"], **fields)
            updated += 1
        else:
            print(f"create  {cls:18} {h['status']:4} due {due} {h['title'][:60]}")
            if not a.dry_run:
                S.create_task(V.vaultlib(vault).safe_name(h["title"], 70), cls, due, pts, step,
                              "done" if done else "todo", fin, int(mins) if mins else None, "history",
                              local_date(h.get("created")), url)
            made += 1
    # v2 sizes for notes nothing else sized
    store = json.load(open(os.path.join(vault, "System", "gameplan.json"))) if os.path.exists(os.path.join(vault, "System", "gameplan.json")) else {}
    ids = {rel: tid for tid, rel in (store.get("paths") or {}).items()}
    sized = 0
    for t in V.tasks(vault):
        ex = (store.get("extra") or {}).get(ids.get(t["id"]) or "n" + hashlib.sha1(t["id"].encode()).hexdigest()[:12], {})
        if not t["sized"] and ex.get("points"):
            sized += 1
            if not a.dry_run:
                V.set_fields(t["path"], points=V.snap_points(ex["points"]))
    print(f"\n{made} created, {updated} updated, {sized} sized from v2, {len(unknown)} classified by Claude"
          + (" (dry run: nothing written)" if a.dry_run else ""))
    if a.dry_run:
        return
    ts, _ = V.ensure_vault(vault)
    days = sorted({t["done_date"] for t in ts if t["done_date"]})
    for d in days:
        V.refresh_day(vault, d, ts)
    print(f"daily notes refreshed: {len(days)} days with finished work")


if __name__ == "__main__":
    main()
