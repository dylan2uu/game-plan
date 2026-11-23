#!/bin/zsh
# Install Game Plan as a login service (launchd):
#   com.gameplan.server  → runs server.py at login and keeps it running (http://127.0.0.1:4317).
#                          It also writes the midnight daily notes and sends the notifications.
#   ~/Applications/Game Plan.app → opens the app in its own Chrome window (⌘Space → "Game Plan"), reusing it if open
#   com.gameplan.hotkey  → Option-Command-G from anywhere opens Game Plan (mac/hotkey.swift, built here)
# The Brightspace → vault morning sync is the vault's own job (System/scripts/today.py); this leaves it alone.
# Usage: zsh install.sh [--dry-run] [--uninstall]
set -euo pipefail
DIR="${0:A:h}"; LA="$HOME/Library/LaunchAgents"; LOGS="$HOME/Library/Logs/GamePlan"; U="gui/$(id -u)"

retire_v2() {   # v2's random pop-up job and menu bar app: v3 replaces both
  for j in nudge bar; do launchctl bootout "$U/com.gameplan.$j" 2>/dev/null || true; rm -f "$LA/com.gameplan.$j.plist"; done
  pkill -x GamePlanBar 2>/dev/null || true
  rm -rf "$HOME/Applications/GamePlanBar.app"
}

if [[ "${1:-}" == "--uninstall" ]]; then
  retire_v2
  for j in server hotkey; do launchctl bootout "$U/com.gameplan.$j" 2>/dev/null || true; rm -f "$LA/com.gameplan.$j.plist"; done
  rm -rf "$HOME/Applications/Game Plan.app" "$HOME/Library/Application Support/GamePlan/gp-hotkey"
  echo "Also remove the Chrome extension: chrome://extensions → Game Plan Focus → Remove."
  echo "Uninstalled. (Your vault and this folder are untouched.)"; exit 0
fi
if [[ "${1:-}" == "--dry-run" ]]; then
  echo "[dry-run] would write $LA/com.gameplan.server.plist (python3 $DIR/server.py), remove the v2 nudge + menu bar jobs, and make ~/Applications/Game Plan.app"
  exit 0
fi

mkdir -p "$LA" "$LOGS"
retire_v2
cat > "$LA/com.gameplan.server.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.gameplan.server</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>-W</string><string>ignore</string><string>$DIR/server.py</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/server.err</string>
</dict></plist>
EOF
plutil -lint -s "$LA/com.gameplan.server.plist"
launchctl bootout "$U/com.gameplan.server" 2>/dev/null || true
launchctl bootstrap "$U" "$LA/com.gameplan.server.plist"

# A real app to pull it up fast (Spotlight, Dock). Opens Chrome's app window (no tabs), else the default browser.
APP="$HOME/Applications/Game Plan.app"; mkdir -p "$HOME/Applications"; rm -rf "$APP"
cat > /tmp/gameplan-launcher.applescript <<'AS'
set u to "http://127.0.0.1:4317/"
if application "Google Chrome" is running then
  try
    tell application "Google Chrome"
      repeat with w in windows
        if URL of active tab of w starts with u then
          set index of w to 1
          activate
          return
        end if
      end repeat
    end tell
  end try
end if
do shell script "if [ -d '/Applications/Google Chrome.app' ]; then open -na '/Applications/Google Chrome.app' --args --app=" & u & "; else open " & u & "; fi"
AS
osacompile -o "$APP" /tmp/gameplan-launcher.applescript && rm -f /tmp/gameplan-launcher.applescript
cp "$DIR/app/icon.icns" "$APP/Contents/Resources/applet.icns" 2>/dev/null || true

# Option-Command-G from anywhere
SUP="$HOME/Library/Application Support/GamePlan"; mkdir -p "$SUP"
if command -v swiftc >/dev/null && swiftc -O -o "$SUP/gp-hotkey" "$DIR/mac/hotkey.swift" 2>"$LOGS/hotkey-build.err"; then
  cat > "$LA/com.gameplan.hotkey.plist" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.gameplan.hotkey</string>
  <key>ProgramArguments</key><array><string>$SUP/gp-hotkey</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardErrorPath</key><string>$LOGS/hotkey.err</string>
</dict></plist>
EOF2
  launchctl bootout "$U/com.gameplan.hotkey" 2>/dev/null || true
  launchctl bootstrap "$U" "$LA/com.gameplan.hotkey.plist" && echo "✅ Option-Command-G opens Game Plan from anywhere"
else
  echo "ℹ️  Skipped the Option-Command-G shortcut (needs Xcode Command Line Tools: xcode-select --install)"
fi
echo "✅ Game Plan.app in ~/Applications (⌘Space → Game Plan, or drag it to the Dock)"
echo "ℹ️  Chrome extension: chrome://extensions → Game Plan Focus → reload (first time: Developer mode → Load unpacked → $DIR/extension)"
sleep 2
curl -fsS -o /dev/null http://127.0.0.1:4317/api/state && echo "✅ Game Plan running at http://127.0.0.1:4317" || echo "❌ server not answering, see $LOGS/server.err"
