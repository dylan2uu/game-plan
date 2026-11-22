# Game Plan

Open your Mac and already know what to do. Game Plan shows **one assignment and the first physical action**, and one key (Enter) opens the exact assignment and starts the timer. While you work, the step owns the screen. If you drift to a distraction mid-block, a return screen sends you back to the tab you left.

```
Brightspace calendar ──(7:45am sync)──▶ Obsidian vault ◀──▶ Game Plan server (127.0.0.1:4317)
                                     01 Classes/*/Assignments/*.md          │
                         System/gameplan.json (session, history, settings)  │
        ┌────────────────────────┬──────────────────────┬──────────────────┼─────────────────┐
   app window (Now/Plan/History)  menu bar timer (Swift)  Chrome extension   phone (paired, same Wi-Fi)
```

## Launch

```bash
cd ~/Projects/game-plan/desktop
zsh install.sh            # server at login, nudges, Game Plan.app, menu bar timer. Add --login to start the timer at login.
open http://127.0.0.1:4317
```
Then, from anywhere: **⌘Space → Game Plan**, or **⌥⌘G** once the menu bar timer is running.

### One-time setup
1. **Chrome extension** (distraction return screen): `chrome://extensions` → Developer mode → **Load unpacked** → pick `desktop/extension`. Then Game Plan → Settings → **Test protection** should say it passed.
2. **Menu bar timer**: `install.sh` builds and opens it (needs `xcode-select --install`). Settings → "Start menu bar app at login" makes it permanent.
3. **Unlock prompts** (optional): Settings → set study windows and quiet hours → "Prompt me when I unlock during a study window". Add the countdown if you want it to open and start on its own.
4. **Phone** (optional): Settings → Phone → "Let paired phones connect" → **Pair a phone** → scan the QR code on the same Wi-Fi → Share → Add to Home Screen. Download the **.ics** there for study-block reminders that open the current task.
5. **Class folder docs** (optional): System Settings → Privacy & Security → Full Disk Access → add `/usr/bin/python3`.

### Uninstall
`zsh install.sh --uninstall` removes the services, Game Plan.app and the menu bar app. Remove the extension in `chrome://extensions`. Your vault isn't touched.

## How it works

- **Now** (key 1): one recommended assignment (deadline, size, pins, importance, saved next steps), the step as the biggest text, and *Open X & start*. If the link is missing, you can paste it inline or start without it. Coming back to something you'd started shows your saved next step. Press C to choose another.
- **Timer**: a 2-minute start by default, with "keep going" for the rest of a 25-minute block, or 25 minutes directly. There's one session for every window, the menu bar and the phone. Double clicks and retries are deduplicated by request id. Pauses, breaks and work are tracked separately. Lock or sleep pauses it. If nothing has checked in for 6 minutes, the clock stops at the last heartbeat, so an overnight sleep never counts. You can correct a wrong block in History.
- **After a block**, it asks "What moved forward?" with one-tap checkpoints written for that assignment (Claude writes them during background sizing; otherwise they're picked by assignment type), plus an optional next step. Credit is paid once per session: 1 pt per 5 min, +2 for a checkpoint (it needs a real minute of work). Confirming you submitted pays the assignment's size, with +50% if it's a day early. Opening the submission page and confirming you submitted are separate steps.
- **Rewards**: point rewards you choose (History → Rewards), plus a small reward tied to this block's checkpoint (for example, a 5-min music break once you've captured the questions).
- **Plan** (key 2): workload vs. focus time per day and course. Click a day to act on it. "I have 30m" cuts big projects into a checkpoint that fits. You can pin, set academic importance (separate from app points) and plan a work day. **Real Brightspace deadlines are never rewritten.**
- **History** (key 3): focused minutes per day, and what you produced alongside the time.
- **Protection**: during an active block, the sites you choose (default Instagram, YouTube Shorts, TikTok, X, Reddit) show "You were *opening the prompt and jotting the two questions* for Discussion 10" with **Return to assignment**, which focuses the tab you left. You also get *It's for class* (a short exception), *Continue anyway* (after a delay) and *End focus*. Class videos can be permanent exceptions. Rules expire when the block ends, even if Game Plan has closed.

## Files

```
desktop/server.py      local server (localhost) + opt-in phone listener (paired devices only)
desktop/focus.py       the shared session: clock, credit-once, checkpoints, settings, pairing, migration
desktop/bridge.py      vault notes ↔ task docs; background sizing (points, first step, checkpoints)
desktop/nudge.py       occasional pop-ups (respects sessions, quiet hours, snooze)
desktop/mac/           GamePlanBar.swift + build.sh (menu bar timer, ⌥⌘G, lock/unlock prompts)
desktop/extension/     Chrome MV3 extension (return screen)
desktop/app/           the page (plain HTML/CSS/JS, no build step); old v1 at /v1
desktop/tests/         make_vault.py (throwaway vault copies for tests)
```

## Safety

The main server listens on 127.0.0.1 only. It rejects other Host headers (DNS rebinding) and requires a custom header on writes. The phone listener is off by default. When it's on, every request needs a per-device token (stored hashed and revocable), and phones can't trigger anything on the Mac. It's plain HTTP on your Wi-Fi, so turn it off on networks you don't trust. Nothing touches Con Ed folders.

## iPhone app shielding

Not included. Screen Time shielding (FamilyControls/ManagedSettings) needs a native iOS app built in full Xcode, a paid Apple Developer account, and Apple's approval of the Family Controls entitlement. This Mac has only the Command Line Tools, so the phone gets the web companion and calendar reminders instead.
