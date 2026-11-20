# Game Plan

A desktop planner for low-motivation days. It's the full Game Plan v1 (Do this now, Make it smaller, AI input, calendar, progress, points, garden) running locally on top of an Obsidian vault. It shows the **one thing to do next and why**, gives you a 5-minute first step, and has a **Start** button that opens a fresh Claude chat about just that task.


## How it works

```
Brightspace calendar ──(7:45am sync)──▶ Obsidian vault ◀──▶ Game Plan (http://127.0.0.1:4317)
                                     01 Classes/*/Assignments/*.md
```

- **One source of truth.** Game Plan reads and writes the same assignment notes in the Obsidian vault that the Brightspace sync creates. There's no second database. Mark something done in Game Plan, and it's done in Obsidian too.
- **v1 on desktop:** `desktop/app/index.html` is the v1 artifact plus `claude-shim.js`, which provides the `window.claude` services it expected: the database becomes the vault (`desktop/bridge.py`, extras in `System/gameplan.json`), and the AI becomes local `claude -p`.
- **Auto-sizing:** new Brightspace tasks get real points and a specific first step from Claude in the background.
- **Start** marks the task `doing`, logs it in today's daily note, and opens `claude.ai/new` with the task pre-filled.
- **Nudges** at 10:30, 14:30 and 19:30 name the most urgent task you haven't started, with a reason. They skip if you started something in the last 90 minutes or if nothing's urgent.

## Run it

```bash
cd desktop
zsh install.sh            # server at login + nudges (launchd). --dry-run to preview, --uninstall to remove
open http://127.0.0.1:4317
```
For a real desktop app: open it in **Chrome → ⋮ → Cast, save, and share → Install page as app**.

Needs only macOS's built-in `python3`. The vault path defaults to `~/Obsidian/Vault` (override with `GP_VAULT=...` or `--vault`).

## Files

```
desktop/server.py     local server: reads/writes vault notes, localhost only
desktop/nudge.py      the 3x/day "what next and why" alert
desktop/install.sh    launchd setup
desktop/app/          the page (plain HTML/CSS/JS, no build step)
legacy/               v1: the claude.ai artifact version (also tagged v1-artifact)
```

## Safety

The server listens on 127.0.0.1 only, rejects requests addressed to other hostnames (DNS rebinding), requires a custom header on writes (blocks cross-site requests), and only touches notes with `type: assignment` inside the vault.

## v1

The first version ran as a Claude artifact with its own database, Google Calendar nudges, points and a garden. It's in `legacy/` and under the git tag `v1-artifact`.
