"""Game Plan v3 model. The Obsidian vault is the database; this module reads and writes it.

Tasks are `type: assignment` notes (the same notes the Brightspace sync makes). The map is
Vision <- Goal <- Area <- class/project hub <- task, each linked to its parent by a
`Part of [[...]]` line. Every write goes back to plain Markdown, and only when something changed.
Standard library only (macOS python3 3.9).
"""
import datetime as dt
import os
import re
import sys

POINTS = (1, 2, 3, 5, 8, 13)
MINUTES = {1: 10, 2: 25, 3: 45, 5: 90, 8: 180, 13: 300}     # rough work time per size
DAY_GOAL = 10
STAT = "📊 "


def vaultlib(vault):
    """Reuse the vault's own helpers so Game Plan and today.py read notes the same way."""
    sys.path.insert(0, os.path.join(vault, "System", "scripts"))
    import vaultlib as vl  # noqa: E402
    return vl


def read(path):
    try:
        return open(path, encoding="utf-8").read()
    except OSError:
        return ""


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".gp-tmp"
    open(tmp, "w", encoding="utf-8").write(text)
    os.replace(tmp, path)                       # atomic: Obsidian never sees half a note


def yaml_value(v):
    s = str(v).replace("\n", " ").strip()
    if re.search(r":\s|^[\[{>|*&!%@`'\"#-]|\s#", s):
        return '"' + s.replace('"', "'") + '"'
    return s


def set_fields(path, **kv):
    """Set or add frontmatter fields; None removes one. Returns True if the file changed."""
    text = read(path)
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return False
    lines = m.group(1).split("\n")
    for k, v in kv.items():
        idx = [i for i, l in enumerate(lines) if re.match(rf"^{re.escape(k)}:", l)]
        new = None if v is None else f"{k}: {yaml_value(v)}"
        if idx and new is None:
            del lines[idx[0]]
        elif idx:
            lines[idx[0]] = new
        elif new is not None:
            lines.append(new)
    out = "---\n" + "\n".join(lines) + "\n---\n" + text[m.end():]
    if out != text:
        write(path, out)
    return out != text


def date_or_none(s):
    try:
        return dt.date.fromisoformat(str(s or "")[:10])
    except ValueError:
        return None


def snap_points(v, default=3):
    try:
        return min(POINTS, key=lambda p: abs(p - float(v)))
    except (TypeError, ValueError):
        return default


def guess_points(title):
    """Size a synced assignment by its name until someone sizes it for real."""
    t = title.lower()
    for pat, pts in ((r"survey|feedback|evaluation|assessment|form\b|attendance|proposal|minutes|agenda", 1),
                     (r"quiz|journal|blog|linkedin|post\b|discussion|reflection", 2),
                     (r"paper|essay|presentation|draft|report", 8),
                     (r"\bproj|project", 13),
                     (r"homework|\bhw\d*\b|assignment|lab\b|chapter", 5)):
        if re.search(pat, t):
            return pts
    return 3


def clean_title(name):
    t = re.sub(r"^\d{4}-\d{2}-\d{2}\s+", "", name.strip())
    return re.sub(r"\s*-\s*Due$", "", t).strip()


def brightspace_link(uid):
    m = re.match(r"^(\d+)-(\d+)@(brightspace\.[\w.]+)$", uid or "")
    return f"https://{m.group(3)}/d2l/le/calendar/{m.group(1)}/event/{m.group(2)}/detailsview" if m else ""


def hm(minutes):
    minutes = int(minutes or 0)
    h, m = divmod(minutes, 60)
    return (f"{h}h {m}m" if m else f"{h}h") if h else f"{m}m"


def short_date(d):
    return f"{d:%b} {d.day}" if d else "—"


# ---------- tasks ----------
def load_task(vault, path, fm, text):
    h1 = re.search(r"(?m)^# (.+)$", text)
    status = fm.get("status") if fm.get("status") in ("todo", "doing", "done") else "todo"
    link = re.search(r"^## Link\s*\n\s*(https?://\S+)", text, re.M)
    points = snap_points(fm["points"]) if fm.get("points") else None
    title = clean_title(h1.group(1) if h1 else os.path.splitext(os.path.basename(path))[0])
    return {
        "id": os.path.relpath(path, vault), "path": path, "title": title,
        "cls": fm.get("class") or "Unsorted", "status": status,
        "due": date_or_none(fm.get("due")), "points": points or guess_points(title),
        "sized": bool(points), "my_est": int(fm["my_estimate_min"]) if str(fm.get("my_estimate_min", "")).isdigit() else None,
        "actual": int(fm["actual_min"]) if str(fm.get("actual_min", "")).isdigit() else None,
        "done_date": date_or_none(fm.get("done_date") or fm.get("done")) if status == "done" else None,
        "first_step": fm.get("first_step", ""), "source": fm.get("source", ""),
        "url": fm.get("brightspace_url") or fm.get("link") or (link.group(1) if link else "") or brightspace_link(fm.get("uid", "")),
    }


def tasks(vault):
    vl = vaultlib(vault)
    out = []
    for p in vl.iter_notes(vault, "01 Classes", "00 Inbox"):
        fm = vl.read_frontmatter(p)
        if fm.get("type") == "assignment" and fm.get("dropped") != "true":
            out.append(load_task(vault, p, fm, read(p)))
    return out


def est_min(t):
    return t["my_est"] or MINUTES[t["points"]]


# ---------- the map ----------
def nodes(vault):
    """name -> {path, title, parent, kind} for map notes (07 Map) and class/project hubs."""
    vl = vaultlib(vault)
    out = {}
    paths = list(vl.iter_notes(vault, "07 Map"))
    for folder in ("01 Classes", "03 Projects"):
        root = os.path.join(vault, folder)
        for d in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            p = os.path.join(root, d, f"{d} Hub.md")
            if os.path.exists(p):
                paths.append(p)
    for p in paths:
        text = read(p)
        name = os.path.splitext(os.path.basename(p))[0]
        h1 = re.search(r"(?m)^# (.+)$", text)
        up = re.search(r"(?m)^Part of \[\[([^\]|#]+)", text)
        kind = "hub" if name.endswith(" Hub") else name.split(" - ")[0].lower() if " - " in name else name.lower()
        out[name] = {"path": p, "title": h1.group(1).strip() if h1 else name, "parent": up.group(1).strip() if up else None,
                     "kind": kind}
    return out


def home(nd, cls):
    """The map note a task's `class` belongs to: a class/project hub or an area."""
    for name in (f"{cls} Hub", f"Area - {cls}"):
        if name in nd:
            return name
    return None


def chain(nd, name):
    out, seen = [], set()
    while name and name in nd and name not in seen:
        out.append(name)
        seen.add(name)
        name = nd[name]["parent"]
    return out


def homes(nd):
    """Everything a task or idea can belong to: classes, projects, areas (display names)."""
    return [nd[n]["title"] for n in nd if nd[n]["kind"] in ("hub", "area")]


def done_chain(nd, cls):
    """What a finished task feeds, for the Done screen: its class/area, then the goals above it."""
    names = chain(nd, home(nd, cls))
    return [nd[n]["title"] for i, n in enumerate(names) if i == 0 or nd[n]["kind"] == "goal"]


def stat_line(title, done):
    pts = sum(t["points"] for t in done)
    mins = sum(t["actual"] or 0 for t in done)
    last = max((t["done_date"] for t in done if t["done_date"]), default=None)
    return f"{STAT}{title}: {len(done)} done · {pts} pts · {hm(mins)} · last: {short_date(last)}"


def set_stat(text, line):
    """Replace the 📊 line, or put one right under the title (or the frontmatter)."""
    if re.search(rf"(?m)^{STAT}.*$", text):
        return re.sub(rf"(?m)^{STAT}.*$", lambda m: line, text, count=1)
    h1 = re.search(r"(?m)^# .+$", text)
    if h1:
        return text[:h1.end()] + "\n" + line + text[h1.end():]
    fm = re.match(r"^---\n.*?\n---\n", text, re.S)
    i = fm.end() if fm else 0
    return text[:i] + line + "\n" + text[i:]


def fix_task_text(text, parent, tags):
    """Make sure a task note links up to its class/area and carries exactly the right status tags."""
    fm = re.match(r"^---\n.*?\n---\n", text, re.S)
    head, body = (text[:fm.end()], text[fm.end():]) if fm else ("", text)
    if parent and not re.search(r"(?m)^Part of \[\[", body):
        h1 = re.search(r"(?m)^# .+$", body)
        body = (body[:h1.end()] + f"\nPart of [[{parent}]]" + body[h1.end():]) if h1 else f"Part of [[{parent}]]\n" + body
    stripped = re.sub(r"(?m)^#(done|overdue)[ \t]*(\n|\Z)", "", body)
    if tags:
        stripped = stripped.rstrip("\n") + "\n\n" + " ".join(tags) + "\n"
    elif stripped != body:
        stripped = stripped.rstrip("\n") + "\n"
    return head + stripped


def ensure_vault(vault, today=None):
    """Idempotent upkeep: task links + tags + points, and every map/hub 📊 line. Returns (tasks, nodes)."""
    today = today or dt.date.today()
    nd = nodes(vault)
    ts = tasks(vault)
    for t in ts:
        tags = ["#done"] if t["status"] == "done" else (["#overdue"] if t["due"] and t["due"] < today else [])
        text = read(t["path"])
        new = fix_task_text(text, home(nd, t["cls"]), tags)
        if new != text:
            write(t["path"], new)
        if not t["sized"]:
            set_fields(t["path"], points=t["points"])
            t["sized"] = True
    by_node = {n: [] for n in nd}
    for t in ts:
        if t["status"] == "done":
            for n in chain(nd, home(nd, t["cls"])):
                by_node[n].append(t)
    for n, info in nd.items():
        text = read(info["path"])
        new = set_stat(text, stat_line(info["title"], by_node[n]))
        if new != text:
            write(info["path"], new)
    return ts, nd


# ---------- daily + weekly notes ----------
def add_under(text, heading, line):
    """Insert a bullet right under `## heading` (dropping the template's lone '-'), or add the section."""
    m = re.search(rf"(?m)^## {re.escape(heading)}[ \t]*\n", text)
    if not m:
        return text.rstrip("\n") + f"\n\n## {heading}\n{line}\n"
    rest = text[m.end():]
    rest = re.sub(r"\A-[ \t]*\n", "", rest)
    return text[:m.end()] + line + "\n" + rest


def refresh_day(vault, day, ts):
    """The day's note: a 📊 line with points (zero days too) and a link to everything finished that day."""
    vl = vaultlib(vault)
    p = vl.daily_note(vault, day)
    done = [t for t in ts if t["status"] == "done" and t["done_date"] == day]
    text = read(p)
    new = set_stat(text, f"{STAT}Game Plan: {len(done)} done · {sum(t['points'] for t in done)} pts")
    for t in sorted(done, key=lambda t: t["title"]):
        stem = os.path.splitext(os.path.basename(t["path"]))[0]
        if f"[[{stem}]]" not in new:
            new = add_under(new, "Done", f"- [[{stem}]] · +{t['points']} pts · {t['cls']}")
    if new != text:
        write(p, new)
    return p


def replace_section(text, heading, body):
    m = re.search(rf"(?m)^## {re.escape(heading)}[ \t]*\n", text)
    block = f"## {heading}\n{body.rstrip()}\n"
    if not m:
        return text.rstrip("\n") + "\n\n" + block
    nxt = re.search(r"(?m)^## ", text[m.end():])
    end = m.end() + nxt.start() if nxt else len(text)
    return text[:m.start()] + block + ("\n" + text[end:] if nxt else "")


def has_section(path, heading):
    return bool(re.search(rf"(?m)^## {re.escape(heading)}[ \t]*$", read(path)))


def weekly_path(vault, sunday):
    return os.path.join(vault, "06 Daily", "Weekly", f"{sunday.isoformat()} Weekly Review.md")


# ---------- experiments ----------
def experiments(vault):
    text = read(os.path.join(vault, "System", "experiments.md"))
    items = {int(m.group(1)): (m.group(2).strip().rstrip("."), m.group(3).strip())
             for m in re.finditer(r"(?m)^(\d+)\. \*\*(.+?)\*\*\s*(.*)$", text)}
    num = lambda k: int(re.search(rf"(?m)^{k}:\s*(\d+)", text).group(1)) if re.search(rf"(?m)^{k}:\s*\d+", text) else None
    active = num("Active")
    return {"active": active, "next": num("Next"), "items": items,
            "title": items.get(active, ("", ""))[0], "text": items.get(active, ("", ""))[1]}


def decide_experiment(vault, decision, note, today):
    """Sunday decision: keep, change (log the tweak) or swap to the next experiment in the queue."""
    p = os.path.join(vault, "System", "experiments.md")
    text = read(p)
    ex = experiments(vault)
    cur, order = ex["active"], sorted(ex["items"])
    if not order or cur is None:
        return ex
    after = lambda n: order[(order.index(n) + 1) % len(order)] if n in order else order[0]
    if decision == "swap":
        new = ex["next"] if ex["next"] and ex["next"] != cur else after(cur)
        nxt = after(new)
        nxt = after(nxt) if nxt == cur else nxt
        text = re.sub(r"(?m)^Active:\s*\d+", f"Active: {new}", text)
        text = re.sub(r"(?m)^Next:\s*\d+", f"Next: {nxt}", text) if re.search(r"(?m)^Next:", text) else text
        line = f"- {today}: swapped #{cur} {ex['items'][cur][0]} → #{new} {ex['items'][new][0]}." + (f" {note}" if note else "")
    elif decision == "change":
        line = f"- {today}: changed #{cur} {ex['items'][cur][0]}: {note or '(no details)'}"
    else:
        line = f"- {today}: kept #{cur} {ex['items'][cur][0]}." + (f" {note}" if note else "")
    text = add_log(text, line)
    write(p, text)
    return experiments(vault)


def add_log(text, line):
    if re.search(r"(?m)^## Log[ \t]*$", text):
        return text.rstrip("\n") + "\n" + line + "\n"
    return text.rstrip("\n") + "\n\n## Log\n" + line + "\n"


# ---------- schedule: when am I free? ----------
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
ASSUMED = "assumed busy (fill in System/schedule.md)"


def schedule(vault):
    """Busy blocks from System/schedule.md: [(days, start_min, end_min, label, is_class)], breaks [(d1, d2)]."""
    vl = vaultlib(vault)
    blocks, breaks, unknown = [], [], False
    for line in read(os.path.join(vault, "System", "schedule.md")).splitlines():
        s = line.strip()
        if s.startswith("- ??"):
            unknown = True
            continue
        m = re.match(r"^- (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\b", s)
        if m:
            breaks.append((date_or_none(m.group(1)), date_or_none(m.group(2))))
            continue
        m = re.match(r"^- ([A-Za-z/]+) (\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(.*)$", s)
        if not m:
            continue
        spec = m.group(1).lower()
        days = set(range(7)) if spec == "daily" else {0, 1, 2, 3, 4} if spec == "weekdays" else {5, 6} if spec == "weekends" \
            else {WEEKDAYS.index(x[:3]) for x in spec.split("/") if x[:3] in WEEKDAYS}
        start, end = int(m.group(2)) * 60 + int(m.group(3)), int(m.group(4)) * 60 + int(m.group(5))
        blocks.append((days, start, end, m.group(6).strip(), bool(vl.detect_class(m.group(6)))))
    if unknown:   # shortcut: unknown class/work hours count as busy, until schedule.md is filled in
        blocks.append(({0, 1, 2, 3, 4}, 9 * 60 + 30, 17 * 60, ASSUMED, False))
    return blocks, breaks


def busy_intervals(day, sched):
    blocks, breaks = sched
    off = any(a and b and a <= day <= b for a, b in breaks)
    out = []
    for days, start, end, label, is_class in blocks:
        if day.weekday() in days and not (is_class and off):
            s = dt.datetime.combine(day, dt.time()) + dt.timedelta(minutes=start)
            e = dt.datetime.combine(day, dt.time()) + dt.timedelta(minutes=end)
            out.append((s, e + dt.timedelta(days=1) if e <= s else e, label))
    return out


def free_minutes(a, b, sched):
    """Minutes between a and b that aren't class, work or sleep."""
    if b <= a:
        return 0
    spans = []
    d = a.date() - dt.timedelta(days=1)
    while d <= b.date():
        spans += [(max(s, a), min(e, b)) for s, e, _ in busy_intervals(d, sched) if e > a and s < b]
        d += dt.timedelta(days=1)
    covered, cur_s, cur_e = 0, None, None
    for s, e in sorted(spans):
        if cur_e is None or s > cur_e:
            covered += (cur_e - cur_s).total_seconds() if cur_e else 0
            cur_s, cur_e = s, e
        else:
            cur_e = max(cur_e, e)
    covered += (cur_e - cur_s).total_seconds() if cur_e else 0
    return int(((b - a).total_seconds() - covered) // 60)


def busy_now(now, sched):
    """The busy block you're in right now (label), or None if this is free time."""
    for d in (now.date() - dt.timedelta(days=1), now.date()):
        for s, e, label in busy_intervals(d, sched):
            if s <= now < e:
                return label
    return None


# ---------- what to do now ----------
def rank(ts, now, sched, skip=()):
    """Open tasks in the order to do them, each with one line on why. Deadline, size and free time."""
    today = now.date()
    todo = [t for t in ts if t["status"] != "done" and t["id"] not in skip]

    def free_until(t):
        return free_minutes(now, dt.datetime.combine(t["due"], dt.time(23, 59)), sched)

    def late(t):
        return (today - t["due"]).days if t["due"] and t["due"] < today else 0

    out = []
    tonight = sorted([t for t in todo if t["due"] == today], key=lambda t: free_until(t) - est_min(t))
    for t in tonight:
        free = free_until(t)
        out.append((t, f"Due tonight. ~{hm(est_min(t))} of work, {hm(free)} free before bed."
                    + (" Tight, so start ugly." if free < est_min(t) else "")))
    for t in sorted([t for t in todo if t["status"] == "doing" and t not in tonight], key=lambda t: t["due"] or dt.date.max):
        out.append((t, "You already started this. Picking it back up is the easiest win."))
    week = [t for t in todo if t["due"] and today < t["due"] <= today + dt.timedelta(days=7) and t["status"] != "doing"]
    week.sort(key=lambda t: (free_until(t) - est_min(t), t["due"]))
    for i, t in enumerate(week):
        out.append((t, f"Due {t['due']:%A}. ~{hm(est_min(t))} of work, {hm(free_until(t))} free before then"
                    + (". Tightest fit this week." if i == 0 else ".")))
    recent = sorted([t for t in todo if 0 < late(t) <= 3 and t["status"] != "doing"], key=late)
    for t in recent:
        n = late(t)
        out.append((t, f"{n} day{'s' if n > 1 else ''} late. Getting it in now still beats a zero."))
    old = sorted([t for t in todo if late(t) > 3 and t["status"] != "doing"], key=lambda t: t["due"], reverse=True)
    for t in old:
        out.append((t, f"Overdue since {short_date(t['due'])}. Finish it, or hit Done if it's handled."))
    later = sorted([t for t in todo if t["due"] and t["due"] > today + dt.timedelta(days=7) and t["status"] != "doing"], key=lambda t: t["due"])
    for t in later:
        out.append((t, f"Due {short_date(t['due'])}. Nothing sooner, so a head start is free."))
    undated = sorted([t for t in todo if not t["due"] and t["status"] != "doing"], key=lambda t: t["points"])
    for t in undated:
        out.append((t, "No deadline. Smallest thing on your list: a fast point."))
    return out


# ---------- progress ----------
def progress(ts, today, days=14):
    done = [t for t in ts if t["status"] == "done" and t["done_date"]]
    span = [today - dt.timedelta(days=i) for i in range(days - 1, -1, -1)]
    out = []
    for d in span:
        by = {}
        for t in done:
            if t["done_date"] == d:
                by[t["cls"]] = by.get(t["cls"], 0) + t["points"]
        out.append({"date": d.isoformat(), "label": f"{d:%a}"[:2], "day": d.day, "total": sum(by.values()), "by": by})
    have = {t["done_date"] for t in done}
    streak, d = 0, today if today in have else today - dt.timedelta(days=1)
    while d in have:
        streak += 1
        d -= dt.timedelta(days=1)
    return {"days": out, "today": sum(t["points"] for t in done if t["done_date"] == today), "goal": DAY_GOAL, "streak": streak}


def week_numbers(ts, sunday):
    """Mon-Sun numbers for the Sunday review."""
    monday = sunday - dt.timedelta(days=6)
    done = [t for t in ts if t["status"] == "done" and t["done_date"] and monday <= t["done_date"] <= sunday]
    per_day = {}
    for t in done:
        per_day[t["done_date"]] = per_day.get(t["done_date"], 0) + t["points"]
    timed = [t for t in done if t["actual"] and t["my_est"]]
    by_cls = {}
    for t in done:
        by_cls[t["cls"]] = by_cls.get(t["cls"], 0) + t["points"]
    best = max(per_day.items(), key=lambda kv: kv[1]) if per_day else None
    return {"from": monday.isoformat(), "to": sunday.isoformat(), "done": len(done), "points": sum(per_day.values()),
            "not_zero_days": len(per_day), "best_day": f"{best[0]:%A} ({best[1]} pts)" if best else "none yet",
            "top": max(by_cls, key=by_cls.get) if by_cls else "none yet",
            "estimate": (f"you guessed {sum(t['my_est'] for t in timed)} min, took {sum(t['actual'] for t in timed)}"
                         if timed else "no timed tasks yet")}
