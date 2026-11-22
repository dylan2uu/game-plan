#!/bin/zsh
# Install Game Plan as a login service (launchd):
#   com.gameplan.server  → runs server.py at login and keeps it running (http://127.0.0.1:4317).
#                          It also writes the midnight daily notes and sends the notifications.
#   ~/Applications/Game Plan.app → opens the app in its own Chrome window (⌘Space → "Game Plan")
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
  launchctl bootout "$U/com.gameplan.server" 2>/dev/null || true
  rm -f "$LA/com.gameplan.server.plist"; rm -rf "$HOME/Applications/Game Plan.app"
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
osacompile -o "$APP" -e 'do shell script "if [ -d \"/Applications/Google Chrome.app\" ]; then open -na \"/Applications/Google Chrome.app\" --args --app=http://127.0.0.1:4317/; else open http://127.0.0.1:4317/; fi"'
cp "$DIR/app/icon.icns" "$APP/Contents/Resources/applet.icns" 2>/dev/null || true
echo "✅ Game Plan.app in ~/Applications (⌘Space → Game Plan, or drag it to the Dock)"
echo "ℹ️  Chrome extension: chrome://extensions → Game Plan Focus → reload (first time: Developer mode → Load unpacked → $DIR/extension)"
sleep 2
curl -fsS -o /dev/null http://127.0.0.1:4317/api/state && echo "✅ Game Plan running at http://127.0.0.1:4317" || echo "❌ server not answering, see $LOGS/server.err"
