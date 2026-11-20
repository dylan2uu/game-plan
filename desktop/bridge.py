"""Bridge between Game Plan v1 (which expects claude.ai's database + AI) and this Mac.

Database
  tasks/<id>   ↔ assignment notes in the Obsidian vault (title, class, due, status, first step live
                 in the note). Everything else v1 tracks (points, log, nudges, chat link, helper…) is
                 kept in <vault>/System/gameplan.json under "extra".
  meta/<name>  ↔ <vault>/System/gameplan.json under "meta" (settings, chat, habits, timer, lock).
AI
  sample.json(prompt) ↔ `claude -p` (your Claude subscription, no API key needed).

The vault stays the single source of truth for WHAT is due. Notes are never deleted.
"""
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading

LOCK = threading.Lock()
NOTE_FIELDS = ("title", "course", "due", "status", "firstStep")


class DBError(Exception):
    def __init__(self, code, msg=""):
        super().__init__(msg or code)
        self.code = code


# ---------- store file ----------
def store_path(vault):
    return os.path.join(vault, "System", "gameplan.json")


def load_store(vault):
    try:
        s = json.load(open(store_path(vault)))
    except (OSError, ValueError):
        s = {}
    s.setdefault("extra", {}); s.setdefault("paths", {}); s.setdefault("meta", {})
    return s


def save_store(vault, s):
    p = store_path(vault)
    tmp = p + ".tmp"
    json.dump(s, open(tmp, "w"), indent=1, sort_keys=True)
    os.replace(tmp, p)                      # atomic: never a half-written file


# ---------- notes <-> tasks ----------
def note_id(rel):
    return "n" + hashlib.sha1(rel.encode()).hexdigest()[:12]


def clean_title(name):
    t = re.sub(r"^\d{4}-\d{2}-\d{2}\s+", "", name)
    return re.sub(r"\s*-\s*Due$", "", t).strip()


def set_field(path, key, value):
    """Set/insert a frontmatter field (None removes it)."""
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return
    lines = [l for l in m.group(1).split("\n") if not l.startswith(key + ":")]
    if value is not None:
        lines.append(f"{key}: {value}")
    open(path, "w", encoding="utf-8").write("---\n" + "\n".join(lines) + "\n---\n" + text[m.end():])


def all_tasks(vl, vault, store):
    """Build v1-shaped task docs from the vault + extras. Returns {id: doc} and {id: abs path}."""
    tasks, paths = {}, {}
    known = {rel: tid for tid, rel in store["paths"].items()}
    for a in vl.assignments(vault):
        rel = os.path.relpath(a["path"], vault)
        fm = vl.read_frontmatter(a["path"])
        tid = known.get(rel) or note_id(rel)
        ex = store["extra"].get(tid, {})
        due = None
        if a["due"]:
            d = a["due"].isoformat()
            due = ex["due"] if str(ex.get("due", "")).startswith(d) else d + "T23:59"
        if fm.get("dropped") == "true":
            status = ex.get("status") if ex.get("status") in ("dismissed", "cancelled") else "dismissed"
        else:
            status = "done" if a["status"] == "done" else "open"
        doc = dict(ex)
        doc.update({
            "title": ex.get("title") or clean_title(a["title"]),
            "course": "" if a["class"] == "Unsorted" else a["class"],
            "due": due, "status": status,
            "firstStep": a["first_step"] or ex.get("firstStep") or "Open it and write 3 bullets of what it's actually asking.",
            "source": ex.get("source") or ("brightspace" if fm.get("source") == "brightspace" else "vault"),
            "sourceId": ex.get("sourceId") or fm.get("uid") or None,
            "notePath": rel,
        })
        doc.setdefault("points", 3); doc.setdefault("estMin", 45); doc.setdefault("log", [])
        doc.setdefault("createdAt", fm.get("date") or (a["due"].isoformat() + "T00:00:00" if a["due"] else "2026-01-01T00:00:00"))
        if status == "done" and not doc.get("doneAt"):
            doc["doneAt"] = (fm.get("done") or (a["due"].isoformat() if a["due"] else dt.date.today().isoformat())) + "T12:00:00"
        tasks[tid], paths[tid] = doc, a["path"]
    return tasks, paths


def snapshot(vl, vault):
    with LOCK:
        store = load_store(vault)
        tasks, _ = all_tasks(vl, vault, store)
        return {"tasks": tasks, "meta": store["meta"]}


def deep_set(obj, dotted, value):
    keys = dotted.split(".")
    for k in keys[:-1]:
        obj = obj.setdefault(k, {})
    obj[keys[-1]] = value


def write_note_fields(vl, path, doc, today):
    """Mirror the note-owned fields of a v1 task onto its note's frontmatter."""
    if "status" in doc:
        st = doc["status"]
        cur = vl.read_frontmatter(path).get("status", "todo")
        if st == "done":
            vl.set_frontmatter_field(path, "status", "done"); set_field(path, "done", today); set_field(path, "dropped", None)
        elif st in ("dismissed", "cancelled"):
            vl.set_frontmatter_field(path, "status", "done"); set_field(path, "dropped", "true")
        else:
            vl.set_frontmatter_field(path, "status", cur if cur in ("todo", "doing") else "todo")
            set_field(path, "done", None); set_field(path, "dropped", None)
    if doc.get("due"):
        set_field(path, "due", str(doc["due"])[:10])
    if doc.get("firstStep"):
        set_field(path, "first_step", re.sub(r"\s+", " ", str(doc["firstStep"]))[:140])
    if "course" in doc and doc["course"]:
        set_field(path, "class", doc["course"])


def create_note(vl, vault, doc):
    cls = vl.detect_class(doc.get("course", "") + " " + doc.get("title", "")) if not doc.get("course") in vl.CLASSES else doc["course"]
    folder = os.path.join(vault, "01 Classes", cls, "Assignments") if cls else os.path.join(vault, "00 Inbox", "Assignments")
    os.makedirs(folder, exist_ok=True)
    due = str(doc.get("due") or "")[:10]
    base = vl.safe_name((due + " " if due else "") + doc.get("title", "Untitled task"))
    path, n = os.path.join(folder, base + ".md"), 2
    while os.path.exists(path):
        path = os.path.join(folder, f"{base} {n}.md"); n += 1
    step = re.sub(r"\s+", " ", str(doc.get("firstStep") or ""))[:140]
    open(path, "w", encoding="utf-8").write(
        "---\ntype: assignment\n"
        f"class: {cls or doc.get('course') or 'Unsorted'}\ndue: {due}\nstatus: todo\nfirst_step: {step}\n"
        f"source: gameplan\ndate: {dt.date.today().isoformat()}\n---\n"
        f"# {doc.get('title', 'Untitled task')}\n\n## First step (5 min)\n- {step}\n\n## Notes\n")
    return path


def write(vl, vault, op, path, data):
    """Apply one v1 database write. Raises DBError like Firestore would."""
    coll, _, doc_id = (path or "").partition("/")
    if coll not in ("tasks", "meta") or not doc_id or "/" in doc_id:
        raise DBError("invalid_argument", "bad path")
    today = dt.date.today().isoformat()
    with LOCK:
        store = load_store(vault)
        if coll == "meta":
            cur = store["meta"].get(doc_id)
            if op == "set":
                store["meta"][doc_id] = data or {}
            elif op == "update":
                cur = store["meta"].setdefault(doc_id, {})   # upsert: v1 would fall back to set() anyway
                for k, v in (data or {}).items():
                    deep_set(cur, k, v)
            elif op == "delete":
                store["meta"].pop(doc_id, None)
            save_store(vault, store); return

        tasks, paths = all_tasks(vl, vault, store)
        exists = doc_id in tasks
        if op == "update" and not exists:
            raise DBError("invalid_argument", "no such document")
        if op == "delete":
            if exists:                       # never delete notes: mark dropped instead
                write_note_fields(vl, paths[doc_id], {"status": "dismissed"}, today)
            store["extra"].pop(doc_id, None)
            save_store(vault, store); return
        if not exists:                       # a brand-new task from Game Plan → a new vault note
            p = create_note(vl, vault, data or {})
            store["paths"][doc_id] = os.path.relpath(p, vault)
            paths[doc_id] = p
        doc = dict(data or {}) if op == "set" else dict(data or {})
        extra = {} if op == "set" else store["extra"].get(doc_id, {})
        for k, v in doc.items():
            if k not in ("notePath",):
                deep_set(extra, k, v)
        store["extra"][doc_id] = extra
        write_note_fields(vl, paths[doc_id], doc, today)
        save_store(vault, store)


# ---------- AI ----------
def claude_bin():
    return shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")


def ai_json(prompt, tier="quick", timeout=120):
    """Run `claude -p` and return parsed JSON. Raises DBError(code) on failure."""
    model = "haiku" if tier == "quick" else "sonnet"
    full = prompt + "\n\nReply with ONLY valid JSON. No prose, no code fences."
    try:
        r = subprocess.run([claude_bin(), "-p", "--model", model, "--settings", '{"disableAllHooks": true}', full],
                           capture_output=True, text=True, timeout=timeout, cwd=tempfile.gettempdir())
    except subprocess.TimeoutExpired:
        raise DBError("rate_limited", "Claude took too long")
    except OSError:
        raise DBError("not_granted", "claude CLI not found")
    out = r.stdout.strip()
    m = re.search(r"(\{.*\}|\[.*\])", out, re.S)
    if not m:
        raise DBError("invalid_json", out[:200])
    try:
        return json.loads(m.group(1))
    except ValueError:
        raise DBError("invalid_json", out[:200])


# ---------- background sizing: real points + a specific first step for every task ----------
GENERIC_STEP = "Open it and write 3 bullets of what it's actually asking"
_sizing = {"busy": False, "last": 0.0}


def size_pending(vl, vault, force=False):
    """Ask Claude (in a background thread) to size open tasks that haven't been sized yet.
    Writes points/estMin to gameplan.json and a specific first step into the note.
    Runs at most every 10 minutes and never blocks the page."""
    import time
    if _sizing["busy"] or (not force and time.time() - _sizing["last"] < 600):
        return
    with LOCK:
        store = load_store(vault)
        tasks, paths = all_tasks(vl, vault, store)
    todo = [(tid, t) for tid, t in tasks.items() if t["status"] == "open" and not t.get("sized")][:15]
    if not todo:
        return
    _sizing.update(busy=True, last=time.time())

    def run():
        try:
            items = [{"id": tid, "title": t["title"], "class": t["course"], "due": t["due"]} for tid, t in todo]
            prompt = ("Dylan is a junior CS student at Binghamton (CS 350 Operating Systems/xv6, CS 301 Ethics in Computing, "
                      "Math 314 Discrete Math, CDCI 395 internship course). For each assignment, estimate size and give a "
                      "specific 2-minute first step that names the actual thing to open or do (not generic advice). "
                      "Points scale by effort: 1 (<15 min), 2 (15-30), 3 (30-60), 5 (1-2 h), 8 (2-4 h), 13 (4+ h). "
                      'Return a JSON array: [{"id": string, "points": number, "estMin": number, "firstStep": string under 110 chars}].\n'
                      + json.dumps(items))
            res = ai_json(prompt, "quick", timeout=180)
            with LOCK:
                store = load_store(vault)
                for r in res if isinstance(res, list) else []:
                    tid = str(r.get("id", ""))
                    if tid not in paths:
                        continue
                    pts = min([1, 2, 3, 5, 8, 13], key=lambda x: abs(x - float(r.get("points") or 3)))
                    ex = store["extra"].setdefault(tid, {})
                    ex.update(points=pts, estMin=int(r.get("estMin") or 45), sized="claude")
                    step = re.sub(r"\s+", " ", str(r.get("firstStep") or "")).strip()[:140]
                    cur = vl.read_frontmatter(paths[tid]).get("first_step", "")
                    if step and (not cur or cur.startswith(GENERIC_STEP)):
                        set_field(paths[tid], "first_step", step)
                save_store(vault, store)
        except Exception as e:  # sizing is a bonus; never break the app
            print("sizing failed:", e, flush=True)
        finally:
            _sizing["busy"] = False

    threading.Thread(target=run, daemon=True).start()
