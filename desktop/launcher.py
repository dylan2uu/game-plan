"""Start button → Claude Code in Terminal (Mac only).

Writes a small .command file and opens it with Terminal (no AppleScript permissions needed).
The task text is always shell-quoted, so nothing in a task title can run as a command.
"""
import os
import re
import shlex
import subprocess

import bridge

HOME = os.path.expanduser("~")
FOLDERS = {   # where Claude Code starts for each class/project (falls back to the vault)
    "CS 350": "~/Documents/School/CS350 - Operating Systems",
    "CS 301": "~/Documents/School/CS301 - Ethics & Prof Practice",
    "Math 314": "~/Documents/School/Math 314 - Discrete Math",
    "Internship Course": "~/Documents/School/CDCI 395 - Career Dev",
    "Game Plan": "~/Projects/game-plan",
}


def pick_folder(vl, vault, text):
    if re.search(r"game ?plan", text, re.I):
        key = "Game Plan"
    else:
        key = vl.detect_class(text) or ""
    d = os.path.expanduser(FOLDERS.get(key, vault))
    return d if os.path.isdir(d) else vault


def launch(vl, vault, task_text):
    task_text = re.sub(r"[\x00-\x08\x0b-\x1f]", " ", str(task_text))[:1500].strip()
    if not task_text:
        raise ValueError("empty task")
    folder = pick_folder(vl, vault, task_text)
    prompt = (f"I'm starting this from Game Plan.\n{task_text}\n\n"
              "Look in this folder for the assignment files or notes first. "
              "Then help me do ONLY the first step: keep it small and concrete, and ask before going further.")
    title = task_text.splitlines()[0][:80]
    d = os.path.join(HOME, "Library", "Application Support", "GamePlan")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "start.command")
    with open(path, "w") as f:
        f.write("#!/bin/zsh\n"
                f"cd {shlex.quote(folder)} || cd ~\n"
                "clear\n"
                f"print -P {shlex.quote('%F{yellow}▶ Game Plan%f  ' + title)}\n"
                f"print -P {shlex.quote('%F{8}in ' + folder.replace(HOME, '~') + '%f')}\n\n"
                f"exec {shlex.quote(bridge.claude_bin())} {shlex.quote(prompt)}\n")
    os.chmod(path, 0o700)
    if not os.environ.get("GP_NO_OPEN"):          # tests set this to skip opening Terminal
        subprocess.run(["open", "-a", "Terminal", path], check=True)
    return folder
