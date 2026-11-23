"""Game Plan v3 model. The Obsidian vault is the database; this module reads and writes it.

Tasks are `type: assignment` notes (the same notes the Brightspace sync makes). The map is
Vision <- Goal <- Area <- class/project hub <- task, each linked to its parent by a
`Part of [[...]]` line. Every write goes back to plain Markdown, and only when something changed.
Standard library only (macOS python3 3.9).
"""
import datetime as dt
import json
import os
import re
import sys

POINTS = (1, 2, 3, 5, 8, 13)
MINUTES = {1: 10, 2: 25, 3: 45, 5: 90, 8: 180, 13: 300}     # typical work time per size (when nothing better is known)
RANKS = ["Walk-on", "Bench", "Rotation", "Starter", "Captain", "All-Star", "MVP", "Champion", "Hall of Famer", "Legend"]
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


def level(pts):
    """Levels come fast early and slower later: 20 pts to reach level 2, then 30 more, 40 more… Returns (level, into, need)."""
    lvl, left, need = 1, int(pts or 0), 20
    while left >= need:
        left, lvl, need = left - need, lvl + 1, need + 10
    return lvl, left, need


def threshold(lvl):
    """Total points it takes to reach a level."""
    total, need = 0, 20
    for _ in range(lvl - 1):
        total, need = total + need, need + 10
    return total


def rank_name(lvl):
    return RANKS[min(lvl, len(RANKS)) - 1]


def points_for(minutes):
    """Points always follow the time a task takes: <15 min 1, <30 2, <60 3, <2 h 5, <4 h 8, longer 13."""
    m = max(1, int(minutes))
    return 1 if m < 15 else 2 if m < 30 else 3 if m < 60 else 5 if m < 120 else 8 if m < 240 else 13


def bar(into, need, n=10):
    k = max(0, min(n, round(n * into / need))) if need else n
    return "▰" * k + "▱" * (n - k)


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
        "sized": bool(points), "sized_by": fm.get("sized", ""),
        "est": int(fm["est_min"]) if str(fm.get("est_min", "")).isdigit() else None,
        "my_est": int(fm["my_estimate_min"]) if str(fm.get("my_estimate_min", "")).isdigit() else None,
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
    """Best guess at the work time: your own guess, else the sized estimate, else the typical time for its points."""
    return t["my_est"] or t.get("est") or MINUTES[t["points"]]


def minutes_spent(t):
    return t["actual"] or est_min(t)


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


def fix_task_text(text, parent, tags, url=""):
    """Make sure a task note links up to its class/area (and to Brightspace) and carries the right status tags."""
    fm = re.match(r"^---\n.*?\n---\n", text, re.S)
    head, body = (text[:fm.end()], text[fm.end():]) if fm else ("", text)
    if parent and not re.search(r"(?m)^Part of \[\[", body):
        h1 = re.search(r"(?m)^# .+$", body)
        body = (body[:h1.end()] + f"\nPart of [[{parent}]]" + body[h1.end():]) if h1 else f"Part of [[{parent}]]\n" + body
    if url and "/d2l/" in url and "Open in Brightspace" not in body:
        anchor = re.search(r"(?m)^Part of \[\[.*$", body) or re.search(r"(?m)^# .+$", body)
        line = f"[Open in Brightspace]({url})"
        body = (body[:anchor.end()] + "\n" + line + body[anchor.end():]) if anchor else line + "\n" + body
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
        new = fix_task_text(text, home(nd, t["cls"]), tags, t["url"])
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
    open_by = {n: [] for n in nd}
    for t in ts:
        if t["status"] != "done":
            for n in chain(nd, home(nd, t["cls"])):
                open_by[n].append(t)
    for n, info in nd.items():
        text = read(info["path"])
        new = set_stat(text, stat_line(info["title"], by_node[n]))
        new = set_block(new, node_block(n, nd, open_by[n], by_node[n], today))
        if new != text:
            write(info["path"], new)
    map_canvas(vault, ts, nd, today)
    return ts, nd


# ---------- what you see when you click into a map note or hub ----------
B_START, B_END = "%% gp:start · Game Plan redraws this part %%", "%% gp:end %%"


def task_line(t, today):
    stem = os.path.splitext(os.path.basename(t["path"]))[0]
    pts = f"{t['points']} pt{'s' if t['points'] != 1 else ''}"
    if t["url"] and "/d2l/" in t["url"]:
        return f"- [{t['title']}]({t['url']}) · {due_words(t, today)} · {pts} · [[{stem}|note]]"
    return f"- [[{stem}|{t['title']}]] · {due_words(t, today)} · {pts}"


def node_block(n, nd, open_ts, done_ts, today, limit=12):
    kids = sorted((c for c in nd if nd[c]["parent"] == n), key=lambda c: nd[c]["title"].lower())
    pts = sum(t["points"] for t in done_ts)
    lvl, into, need = level(pts)
    monday = today - dt.timedelta(days=today.weekday())
    week = sum(t["points"] for t in done_ts if t["done_date"] and t["done_date"] >= monday)
    out = [B_START,
           f"> [!gp-level] {rank_name(lvl)} · level {lvl} · {into} / {need} to {rank_name(lvl + 1)}",
           f'> <progress value="{into}" max="{need}"></progress>',
           f"> about {round(sum(minutes_spent(t) for t in done_ts) / 60)} hours of real work · "
           f"{'+' + str(week) + ' pts this week' if week else 'nothing finished here this week yet'} · {len(open_ts)} open", ""]
    if kids:
        out += ["**Inside:** " + " · ".join(f"[[{c}|{nd[c]['title']}]]" for c in kids), ""]
    ordered = sorted(open_ts, key=lambda t: (t["due"] or dt.date.max, t["title"].lower()))
    out.append(f"> [!gp-open] Open · {len(open_ts)}")
    out += ["> " + task_line(t, today) for t in ordered[:limit]] or ["> Nothing open. Take the win."]
    if len(open_ts) > limit:
        out.append(f"> - +{len(open_ts) - limit} more on the [[Map.canvas|map]]")
    recent = sorted((t for t in done_ts if t["done_date"]), key=lambda t: t["done_date"], reverse=True)[:6]
    if recent:
        out += ["", f"> [!gp-done]- Built lately · {len(done_ts)} total"]
        out += [f"> - [[{os.path.splitext(os.path.basename(t['path']))[0]}|{t['title']}]] · {short_date(t['done_date'])} · {t['points']} pt{'s' if t['points'] != 1 else ''}"
                for t in recent]
    out.append(B_END)
    return "\n".join(out)


def set_block(text, block):
    """Replace the generated section; first time, it takes over a hub's Deadlines query or goes at the end."""
    i, j = text.find(B_START), text.find(B_END)
    if i >= 0 and j > i:
        return text[:i] + block + text[j + len(B_END):]
    dl = re.search(r"(?m)^## Deadlines[ \t]*\n(?:```dataview\n.*?\n```[ \t]*\n?)?", text, re.S)
    if dl:
        return text[:dl.start()] + "## Deadlines\n" + block + "\n" + text[dl.end():]
    return text.rstrip("\n") + "\n\n" + block + "\n"           # after your own words (goal and area notes)


# ---------- the map, drawn: 07 Map/Map.canvas ----------
CANVAS = os.path.join("07 Map", "Map.canvas")
COLORS = {"vision": "#A99AD9", "late": "#EE6A5F", "soon": "#EF7A2E", "doing": "#E0B36E"}
BRANCH = ["#7FB2D9", "#86B98A", "#D98FA0", "#6CC0B3", "#E0B36E", "#CDBB94", "#A99AD9"]   # one color per goal branch


def _id(prefix, s):
    import hashlib
    return prefix + hashlib.sha1(s.encode()).hexdigest()[:12]


def due_words(t, today):
    if not t["due"]:
        return "no due date"
    d = (t["due"] - today).days
    return ("overdue since " + short_date(t["due"])) if d < 0 else "due today" if d == 0 else "due tomorrow" if d == 1 \
        else f"due {t['due']:%a} {short_date(t['due'])}"


def map_canvas(vault, ts, nd, today, per_column=6):
    """A tidy top-down tree, redrawn whenever the vault changes: Vision → goals → areas → classes and
    projects → their open tasks (overdue red, due within 2 days orange). Every card links to its note."""
    kids = {n: [] for n in nd}
    roots = []
    for n, info in nd.items():
        (kids[info["parent"]] if info["parent"] in nd else roots).append(n)
    rank_kind = {"vision": 0, "goal": 1, "area": 2, "hub": 3}
    size = lambda n: 1 + sum(size(c) for c in kids[n])                    # biggest branch first, reading left to right
    for n in list(kids) + [None]:
        (kids.get(n) if n else roots).sort(key=lambda c: (rank_kind.get(nd[c]["kind"], 9), -size(c), nd[c]["title"].lower()))
    todo, stats, rects = {}, {n: [0, 0, 0] for n in nd}, {}
    for t in ts:
        up = home(nd, t["cls"])
        if t["status"] != "done":
            todo.setdefault(up, []).append(t)
        for n in chain(nd, up):
            stats[n][0 if t["status"] == "done" else 2] += 1
            stats[n][1] += t["points"] if t["status"] == "done" else 0
    for v in todo.values():
        v.sort(key=lambda t: (t["due"] or dt.date.max, t["title"].lower()))
    W, GAP, ROW, CARD = 260, 44, 210, 96
    nodes, edges, cursor = [], [], [0]

    def text_node(key, text, cx, y, w, h, color=None, branch=None):
        node = {"id": key, "type": "text", "text": text, "x": int(cx - w / 2), "y": int(y), "width": w, "height": h}
        if color:
            node["color"] = color
        nodes.append(node)
        if branch:
            rects.setdefault(branch, []).append(node)
        return key

    def tasks_column(owner, items, depth, cx, branch=None):
        top, prev = depth * ROW, owner
        for i, t in enumerate(items[:per_column]):
            stem = os.path.splitext(os.path.basename(t["path"]))[0]
            late, soon = t["due"] and t["due"] < today, t["due"] and 0 <= (t["due"] - today).days <= 2
            color = COLORS["late"] if late else COLORS["doing"] if t["status"] == "doing" else COLORS["soon"] if soon else None
            pts = f"{t['points']} pt{'s' if t['points'] != 1 else ''}"
            label = (f"**[{t['title']}]({t['url']})**\n{due_words(t, today)} · {pts} · [[{stem}|note]]" if t["url"] and "/d2l/" in t["url"]
                     else f"[[{stem}|{t['title']}]]\n{due_words(t, today)} · {pts}")
            key = text_node(_id("t-", t["id"]), label, cx, top + i * (CARD + 12), W, CARD, color, branch)
            if i == 0:
                edges.append({"id": _id("e-", (owner or "") + key), "fromNode": owner, "fromSide": "bottom", "toNode": key, "toSide": "top"})
            prev = key
        if len(items) > per_column:
            text_node(_id("m-", str(owner)), f"+{len(items) - per_column} more", cx, top + per_column * (CARD + 12), W, 44, None, branch)
        return prev

    def place(n, depth, branch=None, color=None):
        """Returns the x-center of n after placing its subtree (leaves get the next free column)."""
        if branch is None and nd[n]["kind"] != "vision":
            branch, color = n, BRANCH[len(rects) % len(BRANCH)]
            rects.setdefault(branch, [])
        cols = kids[n] + (["__tasks__"] if todo.get(n) else [])
        xs = []
        for c in cols:
            if c == "__tasks__":
                xs.append(cursor[0])
                cursor[0] += W + GAP
            else:
                xs.append(place(c, depth + 1, branch, color))
        if not xs:
            xs = [cursor[0]]
            cursor[0] += W + GAP
        cx = (xs[0] + xs[-1]) / 2
        info, (done, pts, open_) = nd[n], stats[n]
        key = _id("n-", n)
        lvl, into, need = level(pts)
        if info["kind"] == "vision":
            body = read(info["path"])
            body = body[body.find("\n# "):] if "\n# " in body else body
            body = next((p.strip() for p in body.split("\n\n")[1:] if p.strip() and not p.lstrip().startswith(("📊", "Part of", "%%", ">", "#"))), "")
            text_node(key, f"# [[{n}|{info['title']}]]\n{body}\n\n**Level {lvl}** {bar(into, need)} · {done} done · {pts} pts",
                      cx, depth * ROW - 90, 2 * W, 210, COLORS["vision"])        # sits above the goal groups
        else:
            text_node(key, f"### [[{n}|{info['title']}]]\n**Level {lvl}** {bar(into, need)}\n{done} done" + (f" · **{open_} open**" if open_ else ""),
                      cx, depth * ROW, W, 130, color, branch)
        for c in kids[n]:
            edges.append({"id": _id("e-", n + c), "fromNode": key, "fromSide": "bottom", "toNode": _id("n-", c), "toSide": "top"})
        if todo.get(n):
            tasks_column(key, todo[n], depth + 1, xs[-1], branch)
        return cx

    for r in sorted(roots, key=lambda r: (nd[r]["kind"] != "vision", r)):
        place(r, 1)
    if todo.get(None):
        cx = cursor[0]
        cursor[0] += W + GAP
        tasks_column(text_node("unsorted", "### Unsorted\nTasks without a class yet", cx, ROW, W, 110), todo[None], 2, cx)
    text_node("legend", "**🧭 Map** · each color is one goal and everything feeding it. Levels grow with every point you finish.\n"
              "Click a task's name to open it in Brightspace, *note* for its note. Red: overdue · Orange: due within 2 days",
              min(n["x"] for n in nodes) + 330 if nodes else 0, 0, 660, 90)
    groups = []
    for b, members in rects.items():
        if not members:
            continue
        x0, y0 = min(m["x"] for m in members) - 24, min(m["y"] for m in members) - 24
        x1, y1 = max(m["x"] + m["width"] for m in members) + 24, max(m["y"] + m["height"] for m in members) + 24
        lvl = level(stats[b][1])[0]
        groups.append({"id": _id("g-", b), "type": "group", "label": f"{nd[b]['title']} · {rank_name(lvl)} · level {lvl}", "x": x0, "y": y0,
                       "width": x1 - x0, "height": y1 - y0, "color": members[0].get("color") or "#A99AD9"})
    nodes = groups + nodes                       # groups first so they sit behind the cards
    out = json.dumps({"nodes": nodes, "edges": edges}, indent=1)
    p = os.path.join(vault, CANVAS)
    if read(p) != out:
        write(p, out)
    return p


# ---------- daily notes ----------
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


def unlog_day(vault, day, stem):
    """Take a task's line back out of that day's daily note (after an undo)."""
    p = os.path.join(vault, "06 Daily", f"{day.isoformat()}.md")
    text = read(p)
    new = re.sub(rf"(?m)^- \[\[{re.escape(stem)}\]\].*\n?", "", text)
    if new != text:
        write(p, new)


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
    built = [t for t in done if t["done_date"] == today]
    return {"days": out, "today": sum(t["points"] for t in built), "goal": DAY_GOAL, "streak": streak,
            "built": [t["title"] for t in sorted(built, key=lambda t: -t["points"])]}


def identities(ts, nd):
    """Each goal is someone you're becoming. Finished points are proof, and proof levels them up.
    A level also stands for real hours: every finished task adds the time it took (or its estimate)."""
    acc = {n: {"pts": 0, "min": 0, "done": []} for n in nd if nd[n]["kind"] in ("goal", "vision")}
    for t in ts:
        if t["status"] == "done":
            for n in chain(nd, home(nd, t["cls"])):
                if n in acc:
                    acc[n]["pts"] += t["points"]
                    acc[n]["min"] += minutes_spent(t)
                    acc[n]["done"].append(t)
    out = []
    for n, a in acc.items():
        lvl, into, need = level(a["pts"])
        dated = sorted((t for t in a["done"] if t["done_date"]), key=lambda t: t["done_date"])
        out.append({"name": n, "title": nd[n]["title"], "kind": nd[n]["kind"], "pts": a["pts"], "level": lvl, "into": into,
                    "need": need, "rank": rank_name(lvl), "next_rank": rank_name(lvl + 1), "hours": round(a["min"] / 60),
                    "since": dated[0]["done_date"].isoformat() if dated else None, "count": len(a["done"]),
                    "recent": [{"title": t["title"], "cls": t["cls"], "points": t["points"], "date": t["done_date"].isoformat()}
                               for t in reversed(dated[-6:])],
                    "feeds": sorted(nd[c]["title"] for c in nd if nd[c]["parent"] == n)})
    return sorted(out, key=lambda g: (g["kind"] != "vision", -g["pts"], g["title"]))


def week_built(ts, nd, today):
    """Mon-today, grouped by the big goal each thing fed: the list you can send to someone."""
    monday = today - dt.timedelta(days=today.weekday())
    done = [t for t in ts if t["status"] == "done" and t["done_date"] and monday <= t["done_date"] <= today]
    tops = {}
    for t in sorted(done, key=lambda t: (t["done_date"], t["title"])):
        up = chain(nd, home(nd, t["cls"]))
        top = next((n for n in reversed(up) if nd[n]["kind"] == "goal"), None)
        tops.setdefault(nd[top]["title"] if top else "Other", []).append(t)
    before = {g["title"]: level(g["pts"] - sum(t["points"] for t in tops.get(g["title"], [])))[0] for g in identities(ts, nd)}
    groups = [{"goal": g, "pts": sum(t["points"] for t in items), "items": [{"title": t["title"], "cls": t["cls"], "points": t["points"]} for t in items]}
              for g, items in sorted(tops.items(), key=lambda kv: -sum(t["points"] for t in kv[1]))]
    levels = [{"title": g["title"], "from": before.get(g["title"], g["level"]), "to": g["level"]} for g in identities(ts, nd)
              if g["kind"] == "goal" and g["title"] in tops]
    return {"from": monday.isoformat(), "to": today.isoformat(), "count": len(done), "pts": sum(t["points"] for t in done),
            "hours": round(sum(minutes_spent(t) for t in done) / 60, 1), "groups": groups, "levels": levels}


