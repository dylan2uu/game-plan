#!/bin/zsh
# Install Game Plan as background services (launchd):
#   com.gameplan.server  → runs server.py at login and keeps it running (http://127.0.0.1:4317)
#   com.gameplan.nudge   → nudge.py every 15 min (it decides at random whether to pop the app up)
#   ~/Applications/Game Plan.app → opens the app in its own window (Spotlight: ⌘Space "Game Plan")
#   ~/Applications/GamePlanBar.app → menu bar timer, ⌥⌘G, lock/unlock prompts (built here with swiftc)
# Login item for the menu bar app is opt-in: Settings → "Start menu bar app at login", or --login.
# Usage: zsh install.sh [--dry-run] [--uninstall] [--login]
set -euo pipefail
DIR="${0:A:h}"; LA="$HOME/Library/LaunchAgents"; LOGS="$HOME/Library/Logs/GamePlan"; U="gui/$(id -u)"
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1

if [[ "${1:-}" == "--uninstall" ]]; then
  for j in server nudge bar; do launchctl bootout "$U/com.gameplan.$j" 2>/dev/null || true; rm -f "$LA/com.gameplan.$j.plist"; done
  pkill -x GamePlanBar 2>/dev/null || true
  rm -rf "$HOME/Applications/GamePlanBar.app" "$HOME/Applications/Game Plan.app"
  echo "Also remove the Chrome extension: chrome://extensions → Game Plan Focus → Remove."
  echo "Uninstalled. (Your vault and this folder are untouched.)"; exit 0
fi

plist() { # name script extra-xml
cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.gameplan.$1</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>$DIR/$2</string></array>
  $3
  <key>StandardOutPath</key><string>$LOGS/$1.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$1.err</string>
</dict></plist>
EOF
}
times='<key>StartInterval</key><integer>900</integer>'

if (( DRY )); then
  echo "[dry-run] would write $LA/com.gameplan.server.plist and com.gameplan.nudge.plist, logs in $LOGS, and ~/Applications/Game Plan.app"; exit 0
fi
mkdir -p "$LA" "$LOGS"
plist server server.py '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>' > "$LA/com.gameplan.server.plist"
plist nudge nudge.py "$times" > "$LA/com.gameplan.nudge.plist"
for j in server nudge; do
  plutil -lint -s "$LA/com.gameplan.$j.plist"
  launchctl bootout "$U/com.gameplan.$j" 2>/dev/null || true
  launchctl bootstrap "$U" "$LA/com.gameplan.$j.plist"
done
# A real app to pull it up fast: Spotlight, Dock, Launchpad. Opens Chrome's app window (no tabs), else the default browser.
APP="$HOME/Applications/Game Plan.app"; mkdir -p "$HOME/Applications"; rm -rf "$APP"
osacompile -o "$APP" -e 'do shell script "if [ -d \"/Applications/Google Chrome.app\" ]; then open -na \"/Applications/Google Chrome.app\" --args --app=http://127.0.0.1:4317/; else open http://127.0.0.1:4317/; fi"'
cp "$DIR/app/icon.icns" "$APP/Contents/Resources/applet.icns" 2>/dev/null || true
echo "✅ Game Plan.app in ~/Applications (⌘Space → Game Plan, or drag it to the Dock)"
if command -v swiftc >/dev/null; then
  pkill -x GamePlanBar 2>/dev/null || true
  zsh "$DIR/mac/build.sh" && open "$HOME/Applications/GamePlanBar.app"
  if [[ "${1:-}" == "--login" ]]; then
    curl -fsS -m 5 -H 'Content-Type: application/json' -H 'X-Game-Plan: 1' -d '{"enable":true}' http://127.0.0.1:4317/api/mac/login >/dev/null 2>&1 || true
  fi
else
  echo "ℹ️  Skipped the menu bar app (needs Xcode Command Line Tools: xcode-select --install)"
fi
echo "ℹ️  Chrome extension (one time): chrome://extensions → Developer mode → Load unpacked → $DIR/extension"
sleep 2
curl -fsS -o /dev/null http://127.0.0.1:4317/ && echo "✅ Game Plan running at http://127.0.0.1:4317" || echo "❌ server not answering, see $LOGS/server.err"
