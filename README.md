# Game Plan

A one-page desktop planner for low-motivation days. It shows the **one thing to do next and why**, gives you a 5-minute first step, and has a **Start** button that opens a fresh Claude chat about just that task.

No habit tracking, no points, no timers. Just: what, why, first step, go.

## How it works

```
Brightspace calendar ──(7:45am sync)──▶ Obsidian vault ◀──▶ Game Plan (http://127.0.0.1:4317)
                                     01 Classes/*/Assignments/*.md
```

- **One source of truth.** Game Plan reads and writes the same assignment notes in the Obsidian vault that the Brightspace sync creates. There's no second database. Mark something done in Game Plan, and it's done in Obsidian too.
- **One page:** START HERE card (what / why / first step), Up next (overdue, this week, later), a month calendar and this week's progress.
- **Start** marks the task `doing`, logs it in today's daily note, and opens `claude.ai/new` with the task pre-filled.
- **Nudges** at 10:30, 14:30 and 19:30 name the most urgent task you haven't started, with a reason. They skip if you started something in the last 90 minutes or if nothing's urgent.

## Run it

```bash
cd desktop
zsh install.sh            # server at login + nudges (launchd). --dry-run to preview, --uninstall to remove
open http://127.0.0.1:4317
```
For a real desktop app: open it in **Safari → File → Add to Dock**.

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
