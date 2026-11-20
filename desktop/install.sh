#!/bin/zsh
# Install Game Plan as background services (launchd):
#   com.gameplan.server  → runs server.py at login and keeps it running (http://127.0.0.1:4317)
#   com.gameplan.nudge   → nudge.py at 10:30, 14:30, 19:30
# Usage: zsh install.sh [--dry-run] [--uninstall]
set -euo pipefail
DIR="${0:A:h}"; LA="$HOME/Library/LaunchAgents"; LOGS="$HOME/Library/Logs/GamePlan"; U="gui/$(id -u)"
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1

if [[ "${1:-}" == "--uninstall" ]]; then
  for j in server nudge; do launchctl bootout "$U/com.gameplan.$j" 2>/dev/null || true; rm -f "$LA/com.gameplan.$j.plist"; done
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
times='<key>StartCalendarInterval</key><array>'
for hm in 10:30 14:30 19:30; do times+="<dict><key>Hour</key><integer>${hm%:*}</integer><key>Minute</key><integer>${hm#*:}</integer></dict>"; done
times+='</array>'

if (( DRY )); then
  echo "[dry-run] would write $LA/com.gameplan.server.plist and com.gameplan.nudge.plist, logs in $LOGS"; exit 0
fi
mkdir -p "$LA" "$LOGS"
plist server server.py '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>' > "$LA/com.gameplan.server.plist"
plist nudge nudge.py "$times" > "$LA/com.gameplan.nudge.plist"
for j in server nudge; do
  plutil -lint -s "$LA/com.gameplan.$j.plist"
  launchctl bootout "$U/com.gameplan.$j" 2>/dev/null || true
  launchctl bootstrap "$U" "$LA/com.gameplan.$j.plist"
done
sleep 2
curl -fsS -o /dev/null http://127.0.0.1:4317/ && echo "✅ Game Plan running at http://127.0.0.1:4317" || echo "❌ server not answering, see $LOGS/server.err"
