#!/bin/zsh
# Build the Game Plan menu bar companion into ~/Applications/GamePlanBar.app (needs only Xcode Command Line Tools).
# Usage: zsh build.sh [--out DIR]
set -euo pipefail
DIR="${0:A:h}"; OUT="${2:-$HOME/Applications}"; [[ "${1:-}" == "--out" ]] || OUT="$HOME/Applications"
APP="$OUT/GamePlanBar.app"
command -v swiftc >/dev/null || { echo "Needs swiftc: run xcode-select --install"; exit 1; }
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/GamePlanBar" "$DIR/GamePlanBar.swift" -framework Cocoa -framework Carbon
cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.gameplan.bar</string>
  <key>CFBundleName</key><string>GamePlanBar</string>
  <key>CFBundleDisplayName</key><string>Game Plan Timer</string>
  <key>CFBundleExecutable</key><string>GamePlanBar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PL
[[ -f "$DIR/../app/icon.icns" ]] && cp "$DIR/../app/icon.icns" "$APP/Contents/Resources/icon.icns"
codesign --force --sign - "$APP" 2>/dev/null || true
echo "✅ Built $APP"
