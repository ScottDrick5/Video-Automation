#!/bin/bash
# Run the inbox watcher in the background, starting automatically when you log in.
# Remove it again with:  mac/install_watcher.sh --uninstall
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LABEL="com.vidauto.watch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl unload "$PLIST" 2>/dev/null || true
if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$PLIST"
  echo "Watcher removed."
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/inbox"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ROOT/.venv/bin/vidauto</string>
    <string>inbox</string>
    <string>$ROOT/inbox</string>
    <string>--watch</string>
    <string>--config</string>
    <string>$ROOT/config.yaml</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT/output/watcher.log</string>
  <key>StandardErrorPath</key><string>$ROOT/output/watcher.log</string>
</dict>
</plist>
EOF
mkdir -p "$ROOT/output"
launchctl load "$PLIST"
echo "Watching $ROOT/inbox -- drop files in and finished videos appear in $ROOT/output."
echo "Log: $ROOT/output/watcher.log"
