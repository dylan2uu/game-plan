"""Focus sessions: ONE timer shared by every window, the menu bar app, the Chrome extension and the phone.

The session lives in <vault>/System/gameplan.json under meta.session, so it survives reloads, app
restarts and reboots. Every change goes through act(), which is idempotent per request id (double
clicks, two devices and reconnect retries can't start two timers or pay twice).

States
  active  - clock running (segments with an open end)
  paused  - clock stopped (reason: you | locked | asleep | away | break-over)
  break   - on a break until breakUntil (never counted as work)
  review  - block finished; waiting for "What moved forward?" (credit is paid exactly once there)

Clock rules
  - Work time = sum of active segments. Pauses and breaks are separate.
  - No heartbeat from any window/companion for AWAY_MIN while active = the Mac slept, locked or
    everything closed: the segment is cut at the last heartbeat, so an overnight sleep never counts.
  - A block ends at capMin active minutes (25 by default, +5 per "5 more"). The 2-minute start just
    offers "keep going" at 2 minutes; it keeps counting toward the same 25.
"""
import datetime as dt
import hashlib
import os
import re
import secrets
import uuid

import bridge

BLOCK_MIN = 25
AWAY_MIN = 6
TEST = os.environ.get("GP_TEST") == "1"

DEFAULT_SETTINGS = {
    "weekGoal": 150,
    "focusHours": 6,
    "startMin": 2,                      # default start length (2 or 25)
    "studyWindows": [                   # 0 = Monday
        {"days": [0, 1, 2, 3, 4], "start": "19:00", "end": "23:00"},
        {"days": [5, 6], "start": "13:00", "end": "17:00"},
    ],
    "quiet": {"start": "23:30", "end": "09:00"},
    "unlockPrompt": False,              # opt-in: prompt when you unlock during a study window
    "autoStart": {"enabled": False, "seconds": 15},
    "distractions": ["instagram.com", "youtube.com/shorts", "tiktok.com", "x.com", "twitter.com", "reddit.com"],
    "exceptions": [],                   # [{"pattern": "youtube.com/watch?v=...", "label": "OS lecture"}]
    "continueDelay": 20,                # seconds before "Continue anyway" unlocks
    "classAllowMin": 10,                # "It's for class" exception length
    "lan": False,                       # phone pairing listener (opt-in)
}


# ---------- time ----------
def now():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse(s):
    if not s:
        return None
    try:
        d = dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.astimezone()      # naive = local time


def local_now():
    return dt.datetime.now()


def hm_ok(s):
    return bool(re.match(r"^([01]\d|2[0-3]):[0-5]\d$", str(s or "")))


def in_range(t, start, end):
    """Is local time t (datetime) inside HH:MM..HH:MM (wraps past midnight)?"""
    m = t.hour * 60 + t.minute
    a = int(start[:2]) * 60 + int(start[3:])
    b = int(end[:2]) * 60 + int(end[3:])
    return a <= m < b if a <= b else (m >= a or m < b)


# ---------- settings ----------
def settings(store):
    s = dict(DEFAULT_SETTINGS)
    s.update({k: v for k, v in (store["meta"].get("settings") or {}).items()})
    return s


def clean_settings(data):
    """Validate a settings patch from the UI. Unknown keys are ignored."""
    out = {}
    for k, v in (data or {}).items():
        if k in ("weekGoal", "focusHours", "continueDelay", "classAllowMin", "startMin"):
            try:
                out[k] = max(0, min(1000, int(v)))
            except (TypeError, ValueError):
                continue
        elif k in ("unlockPrompt", "lan"):
            out[k] = bool(v)
        elif k == "autoStart" and isinstance(v, dict):
            try:
                secs = int(v.get("seconds") or 15)
            except (TypeError, ValueError):
                secs = 15
            out[k] = {"enabled": bool(v.get("enabled")), "seconds": max(5, min(120, secs))}
        elif k == "quiet" and isinstance(v, dict) and hm_ok(v.get("start")) and hm_ok(v.get("end")):
            out[k] = {"start": v["start"], "end": v["end"]}
        elif k == "studyWindows" and isinstance(v, list):
            out[k] = [{"days": _days(w.get("days")), "start": w["start"], "end": w["end"]}
                      for w in v[:7] if isinstance(w, dict) and hm_ok(w.get("start")) and hm_ok(w.get("end"))]
        elif k in ("distractions",) and isinstance(v, list):
            out[k] = [norm_pattern(p) for p in v[:60] if norm_pattern(p)]
        elif k == "exceptions" and isinstance(v, list):
            out[k] = [{"pattern": norm_pattern(e.get("pattern")), "label": str(e.get("label") or "")[:60]}
                      for e in v[:60] if isinstance(e, dict) and norm_pattern(e.get("pattern"))]
    return out


def _days(v):
    out = set()
    for d in v if isinstance(v, list) else []:
        try:
            d = int(d)
        except (TypeError, ValueError):
            continue
        if 0 <= d <= 6:
            out.add(d)
    return sorted(out)


def norm_pattern(p):
    p = re.sub(r"^\s*(https?://)?(www\.|m\.)?", "", str(p or "").strip().lower())
    return p.rstrip("/")[:200]


def in_study_window(st, t=None):
    t = t or local_now()
    wins = st.get("studyWindows") if isinstance(st.get("studyWindows"), list) else []
    return any(isinstance(w, dict) and t.weekday() in (w.get("days") or []) and hm_ok(w.get("start")) and hm_ok(w.get("end"))
               and in_range(t, w["start"], w["end"]) for w in wins)


def in_quiet(st, t=None):
    q = st.get("quiet") or {}
    return bool(hm_ok(q.get("start")) and hm_ok(q.get("end")) and in_range(t or local_now(), q["start"], q["end"]))


def snoozed(store, t=None):
    until = parse((store["meta"].get("nudge") or {}).get("snoozeUntil"))
    return bool(until and (t or now()) < until)


# ---------- session clock ----------
def active_min(sess, t=None):
    t = t or now()
    total = 0.0
    for seg in sess.get("segments", []):
        s, e = parse(seg["s"]), parse(seg.get("e")) or t
        total += max(0.0, (e - s).total_seconds())
    return total / 60


def _close(sess, at):
    seg = sess["segments"][-1] if sess.get("segments") else None
    if seg and not seg.get("e"):
        seg["e"] = iso(max(parse(seg["s"]), at))


def reconcile(sess, t=None):
    """Apply the clock to a session: away detection, block end, break expiry. Returns True if it changed."""
    if not sess:
        return False
    t = t or now()
    changed = False
    if sess["state"] == "active":
        beat = parse(sess.get("beat")) or parse(sess["segments"][-1]["s"])
        if (t - beat).total_seconds() > AWAY_MIN * 60:
            _close(sess, beat + dt.timedelta(seconds=30))
            sess.update(state="paused", reason="away", pausedAt=iso(beat))
            changed = True
        elif active_min(sess, t) >= sess["capMin"]:
            over = active_min(sess, t) - sess["capMin"]
            _close(sess, t - dt.timedelta(minutes=over))
            sess.update(state="review", reason="done", pausedAt=sess["segments"][-1]["e"])
            changed = True
    if sess["state"] == "break" and t >= parse(sess["breakUntil"]):
        sess.update(state="paused", reason="break-over", pausedAt=sess["breakUntil"])
        changed = True
    return changed


def view(sess, t=None):
    """Session plus derived numbers for clients."""
    if not sess:
        return None
    t = t or now()
    v = dict(sess)
    v["activeSec"] = round(active_min(sess, t) * 60)
    v["now"] = iso(t)
    v["offer"] = sess["state"] == "active" and sess["plannedMin"] < sess["capMin"] and v["activeSec"] >= sess["plannedMin"] * 60
    v["remainingSec"] = max(0, round(sess["capMin"] * 60 - v["activeSec"]))
    if sess["state"] == "active":
        v["protectUntil"] = iso(t + dt.timedelta(seconds=v["remainingSec"] + 60))
    else:
        v["protectUntil"] = None
    return v


# ---------- checkpoints ----------
CHECKS = [
    (r"discussion|forum", ["Captured the questions", "Drafted my answer", "Posted my answer", "Replied to classmates"]),
    (r"journal|reflection|blog|linkedin|post\b", ["Picked what to write about", "Wrote a rough draft", "Polished it", "Submitted"]),
    (r"proj|program|lab\b|xv6|code", ["Read the spec", "Got the code running", "Finished one part", "Tests passing", "Submitted"]),
    (r"homework|\bhw|problem|assignment \d", ["Did the first problem", "Got halfway", "Drafted every problem", "Submitted"]),
    (r"quiz|exam|test\b", ["Reviewed my notes", "Took the quiz"]),
    (r"presentation|slides|deck", ["Outlined the slides", "Drafted the slides", "Practiced once", "Submitted"]),
    (r"paper|essay|letter|report|draft|brainstorm|evaluation|abstract", ["Outlined it", "Drafted a section", "Full draft done", "Edited it", "Submitted"]),
]
DEFAULT_CHECKS = ["Figured out what it's asking", "Made real progress", "Finished a draft", "Submitted"]


def checkpoints(task):
    """Concrete past-tense outcomes for a task, each with a rough minute size."""
    steps = task.get("steps")
    if isinstance(steps, list) and steps and all(isinstance(s, dict) and s.get("text") for s in steps):
        return [{"text": str(s["text"])[:60], "min": int(s.get("min") or 20)} for s in steps[:6]]
    title = (task.get("title") or "").lower()
    names = next((c for pat, c in CHECKS if re.search(pat, title)), DEFAULT_CHECKS)
    est = int(task.get("estMin") or 45)
    work = [n for n in names if n != "Submitted"]
    per = max(10, round(est / max(1, len(work))))
    return [{"text": n, "min": 2 if n == "Submitted" else per} for n in names]


def next_checkpoint(task):
    done = {p.get("text") for p in task.get("progress", []) if isinstance(p, dict)}
    return next((c for c in checkpoints(task) if c["text"] not in done), None)


# ---------- actions ----------
class ActError(Exception):
    pass


def _task(vl, vault, store, task_id):
    tasks, paths = bridge.all_tasks(vl, vault, store)
    if task_id not in tasks:
        raise ActError("That assignment isn't in Game Plan anymore.")
    return tasks[task_id], paths[task_id]


def finalize(vl, vault, store, sess, moved=(), next_step=None, submitted=False, t=None):
    """Pay for a block exactly once (keyed by session id) and record what moved forward."""
    t = t or now()
    if sess["state"] == "active":
        _close(sess, t)
    tid, sid = sess["taskId"], sess["id"]
    ex = store["extra"].setdefault(tid, {})
    log = ex.setdefault("log", [])
    already = next((e for e in log if e.get("sid") == sid and e.get("k") == "block"), None)
    m = int(active_min(sess, t))
    moved = [str(x)[:80] for x in moved if str(x).strip()][:6]
    result = {"sid": sid, "taskId": tid, "m": m, "moved": moved, "next": None, "at": iso(t), "p": 0, "unlocked": None, "submitted": bool(submitted)}
    if not already:
        p = m // 5 + (2 if moved and m >= 1 else 0)     # checkpoint bonus needs real work behind it
        entry = {"at": iso(t), "k": "block", "sid": sid, "s": sess["startedAt"], "m": m, "p": p, "moved": moved}
        log.append(entry)
        result["p"] = p
        for text in moved:
            ex.setdefault("progress", []).append({"at": iso(t), "sid": sid, "text": text})
    else:
        result["p"] = already.get("p", 0)
    if next_step is not None and str(next_step).strip():
        ex["nextStep"] = str(next_step).strip()[:160]
    result["next"] = ex.get("nextStep")
    rw = sess.get("reward") or {}
    if rw.get("checkpoint") and rw["checkpoint"] in moved:
        result["unlocked"] = rw
    if submitted and not already:
        task, path = _task(vl, vault, store, tid)
        base = int(task.get("points") or 3)
        due = parse(task.get("due"))
        early = bool(due and (due - t).total_seconds() >= 86400)
        bonus = base + (-(-base // 2) if early else 0)
        log.append({"at": iso(t), "k": "done", "sid": sid + ":done", "p": bonus, "m": 0, "early": early})
        ex.update(status="done", doneAt=iso(t), pinned=False)
        bridge.write_note_fields(vl, path, {"status": "done"}, dt.date.today().isoformat())
        result["p"] += bonus
        result["doneBonus"] = bonus
    store["meta"]["lastResult"] = result
    store["meta"]["session"] = None
    return result


def act(vl, vault, body, device="web"):
    """Apply one session action. Returns {"session": view, "result"?: ...}."""
    action = str(body.get("action") or "")
    req = str(body.get("reqId") or "")[:64]
    t = now()
    with bridge.LOCK:
        store = bridge.load_store(vault)
        meta = store["meta"]
        reqs = meta.setdefault("reqs", [])
        sess = meta.get("session")
        reconcile(sess, t)
        out = {}
        if req and req in reqs:                       # duplicate click / retry: no second effect
            out["duplicate"] = True
        else:
            out.update(_apply(vl, vault, store, sess, action, body, device, t) or {})
            if req:
                reqs.append(req)
                del reqs[:-200]
        integ = meta.setdefault("integrations", {})
        integ[device] = {"lastSeen": iso(t), "version": str(body.get("version") or "")[:20] or integ.get(device, {}).get("version", "")}
        bridge.save_store(vault, store)
        out["session"] = view(meta.get("session"), t)
        out["lastResult"] = meta.get("lastResult")
        return out


def _apply(vl, vault, store, sess, action, body, device, t):
    meta = store["meta"]
    st = settings(store)
    if action in ("heartbeat", "hello", "state"):
        if sess and sess["state"] == "active" and action == "heartbeat":
            sess["beat"] = iso(t)
        return None
    if action == "start":
        tid = str(body.get("taskId") or "")
        if sess and sess["taskId"] == tid and sess["state"] in ("active", "paused", "break"):
            if sess["state"] != "active":
                sess["segments"].append({"s": iso(t), "e": None})
                sess.update(state="active", reason=None, beat=iso(t), breakUntil=None)
            return {"reused": True}
        if sess:                                       # switching tasks: bank the current block first
            finalize(vl, vault, store, sess, t=t)
        task, _ = _task(vl, vault, store, tid)
        mins = body.get("minutes")
        planned = float(mins) if TEST and mins else (25 if str(mins) == "25" else 2)
        cap = float(body.get("capMin")) if TEST and body.get("capMin") else BLOCK_MIN
        nxt = next_checkpoint(dict(task, progress=store["extra"].get(tid, {}).get("progress", [])))
        meta["session"] = {
            "id": "s_" + uuid.uuid4().hex[:12], "taskId": tid, "title": task["title"], "course": task.get("course", ""),
            "url": task.get("link") or "", "step": (store["extra"].get(tid, {}).get("nextStep") or task.get("firstStep") or "")[:200],
            "goal": nxt["text"] if nxt else None, "state": "active", "reason": None,
            "plannedMin": planned, "capMin": max(planned, cap), "startedAt": iso(t), "beat": iso(t),
            "segments": [{"s": iso(t), "e": None}], "breakUntil": None, "allow": [], "device": device,
            "reward": body.get("reward") if isinstance(body.get("reward"), dict) else None,
        }
        meta["lastResult"] = None
        return {"started": True}
    if not sess:
        if action in ("unlock", "wake"):
            return {"prompt": prompt_kind(store, None, t)}
        if action in ("lock", "sleep", "pause", "resume", "finish", "break", "extend", "plus5", "cancel", "endFocus", "allow", "endBreak"):
            return {"noSession": True}
        if action == "review":
            return {"noSession": True}
        raise ActError("Unknown action")
    s = sess["state"]
    if action in ("pause", "lock", "sleep") and s == "active":
        _close(sess, t)
        sess.update(state="paused", reason={"pause": "you", "lock": "locked", "sleep": "asleep"}[action], pausedAt=iso(t))
    elif action in ("resume", "endBreak") and s in ("paused", "break"):
        sess["segments"].append({"s": iso(t), "e": None})
        sess.update(state="active", reason=None, beat=iso(t), breakUntil=None)
    elif action in ("unlock", "wake"):
        return {"prompt": prompt_kind(store, sess, t)}
    elif action == "extend":                           # 2-minute start → keep going to the full block
        sess["plannedMin"] = sess["capMin"]
    elif action == "plus5":
        sess["capMin"] = sess["capMin"] + 5
        sess["plannedMin"] = sess["capMin"]
        if s == "review":
            sess["segments"].append({"s": iso(t), "e": None})
            sess.update(state="active", reason=None, beat=iso(t))
    elif action in ("finish", "endFocus") and s in ("active", "paused", "break"):
        _close(sess, t)
        sess.update(state="review", reason="you", pausedAt=iso(t), breakUntil=None)
    elif action == "break":
        mins = float(body.get("minutes") or 5)
        mins = mins if TEST else max(1, min(60, round(mins)))
        if s == "active":
            _close(sess, t)
        sess.update(state="break", reason=None, breakFrom=iso(t), breakUntil=iso(t + dt.timedelta(minutes=mins)),
                    breakLabel=str(body.get("label") or "Break")[:60])
    elif action == "allow":
        pat = norm_pattern(body.get("pattern"))
        mins = float(body.get("minutes") or st["classAllowMin"])
        if pat:
            sess.setdefault("allow", []).append({"pattern": pat, "until": iso(t + dt.timedelta(minutes=min(60, mins)))})
            sess["allow"] = [a for a in sess["allow"] if parse(a["until"]) > t][-20:]
    elif action == "review":
        res = finalize(vl, vault, store, sess, body.get("moved") or [], body.get("next"), bool(body.get("submitted")), t)
        return {"result": res}
    elif action == "cancel":                           # started the wrong thing: no credit, no log
        meta["session"] = None
    elif action == "step":
        sess["step"] = str(body.get("step") or "")[:200]
    elif action == "reward":
        sess["reward"] = body.get("reward") if isinstance(body.get("reward"), dict) else None
    return None


def prompt_kind(store, sess, t):
    """What the Mac should show after an unlock/wake (or None)."""
    st = settings(store)
    lt = t.astimezone().replace(tzinfo=None)
    if not st["unlockPrompt"] or in_quiet(st, lt) or snoozed(store, t) or not in_study_window(st, lt):
        return None
    if not sess:
        return "start"
    if sess["state"] == "paused":
        return "resume"
    if sess["state"] == "review":
        return "review"
    return None                                        # active or on a break: leave you alone


def state(vl, vault):
    """Light read for the extension, menu bar and phone. Reconciles (and saves) the clock."""
    t = now()
    with bridge.LOCK:
        store = bridge.load_store(vault)
        sess = store["meta"].get("session")
        if reconcile(sess, t):
            bridge.save_store(vault, store)
        st = settings(store)
        return {
            "session": view(sess, t), "lastResult": store["meta"].get("lastResult"),
            "protect": {"distractions": st["distractions"], "exceptions": st["exceptions"],
                        "continueDelay": st["continueDelay"], "classAllowMin": st["classAllowMin"]},
            "snoozeUntil": (store["meta"].get("nudge") or {}).get("snoozeUntil"),
            "studyNow": in_study_window(st), "quietNow": in_quiet(st),
            "unlockPrompt": st["unlockPrompt"], "autoStart": st["autoStart"],
        }


def edit_block(vault, task_id, sid, minutes):
    """Fix a wrongly logged block: set its minutes (points follow)."""
    with bridge.LOCK:
        store = bridge.load_store(vault)
        log = store["extra"].get(task_id, {}).get("log", [])
        e = next((x for x in log if x.get("sid") == sid or x.get("at") == sid), None)
        if not e or e.get("k") not in ("block", "time", "focus"):
            raise ActError("Couldn't find that block.")
        m = max(0, min(240, int(minutes)))
        bonus = 2 if e.get("moved") and m >= 1 else 0
        e.update(m=m, p=m // 5 + bonus, edited=iso(now()))
        bridge.save_store(vault, store)
        return e


# ---------- migration of older data ----------
def migrate(vault):
    """v1/v2 timers → a session; keep every old log entry (they still count as focus history)."""
    with bridge.LOCK:
        store = bridge.load_store(vault)
        meta = store["meta"]
        changed = False
        old = meta.pop("timer", None)
        if old is not None:
            changed = True
            started = parse(old.get("startedAt"))
            if started and not meta.get("session") and (now() - started).total_seconds() < 3 * 3600:
                tid = old.get("taskId")
                if tid and store["extra"].get(tid, {}).get("status") not in ("done", "dismissed"):
                    meta["session"] = {
                        "id": "s_" + uuid.uuid4().hex[:12], "taskId": tid, "title": "", "course": "", "url": "", "step": "",
                        "goal": None, "state": "paused", "reason": "away", "plannedMin": BLOCK_MIN, "capMin": BLOCK_MIN,
                        "startedAt": iso(started), "beat": iso(started), "segments": [{"s": iso(started), "e": iso(started)}],
                        "breakUntil": None, "allow": [], "device": "migrated", "reward": None,
                    }
        if "settingsVersion" not in meta:
            meta["settingsVersion"] = 3
            changed = True
        if changed:
            bridge.save_store(vault, store)
        return changed


# ---------- phone pairing ----------
def _hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


def pair(vault, name):
    tok = secrets.token_urlsafe(24)
    with bridge.LOCK:
        store = bridge.load_store(vault)
        devs = store["meta"].setdefault("devices", [])
        d = {"id": "d_" + secrets.token_hex(4), "name": str(name or "Phone")[:40], "hash": _hash(tok), "created": iso(now()), "lastSeen": None}
        devs.append(d)
        bridge.save_store(vault, store)
    return d, tok


def revoke(vault, dev_id):
    with bridge.LOCK:
        store = bridge.load_store(vault)
        before = len(store["meta"].get("devices", []))
        store["meta"]["devices"] = [d for d in store["meta"].get("devices", []) if d["id"] != dev_id]
        bridge.save_store(vault, store)
        return before != len(store["meta"]["devices"])


def device_for(vault, tok):
    if not tok:
        return None
    h = _hash(tok)
    store = bridge.load_store(vault)
    for d in store["meta"].get("devices", []):
        if secrets.compare_digest(d["hash"], h):
            return d
    return None


def touch_device(vault, dev_id):
    with bridge.LOCK:
        store = bridge.load_store(vault)
        for d in store["meta"].get("devices", []):
            if d["id"] == dev_id:
                last = parse(d.get("lastSeen"))
                if not last or (now() - last).total_seconds() > 60:
                    d["lastSeen"] = iso(now())
                    bridge.save_store(vault, store)
                return
