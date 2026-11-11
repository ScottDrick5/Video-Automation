#!/bin/bash
# Double-click: downloads the newest Get Stories and Upload scripts from GitHub and puts them where the panel runs
# them (/Users/Shared/VidAuto/stories). If GitHub can't be reached, copies the ones in this folder instead.
# No need to rebuild the helper or re-allow anything.
cd "$(dirname "$0")"
DEST="/Users/Shared/VidAuto/stories"
RAW="https://raw.githubusercontent.com/ScottDrick5/Video-Automation/claude/video-workflow-automation-tq3ajc/premiere-plugin/stories"
FILES="stories.js story-rules.js chatgpt-prompt.txt uploads.js upload-rules.js"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
ok=1
for f in $FILES; do
  curl -fsSL -H "Cache-Control: no-cache" -o "$TMP/$f" "$RAW/$f?$(date +%s)" || { ok=0; break; }
done
if [ "$ok" = 1 ]; then
  cp "$TMP"/* "$DEST/" && echo "Downloaded the newest scripts from GitHub into $DEST:"
else
  echo "Couldn't reach GitHub; copying the scripts in this folder instead."
  for f in $FILES; do cp "$f" "$DEST/" || echo "Couldn't copy $f -- send this window's text to Claude."; done
fi
rm -rf "$TMP"
grep -ho 'Get Stories version [0-9a-z-]*' "$DEST/stories.js" | head -1
grep -ho 'Upload version [0-9a-z-]*' "$DEST/uploads.js" | head -1
grep -ho 'RULES_VERSION = "[0-9a-z-]*"' "$DEST/upload-rules.js" | head -1
echo
read -n 1 -s -r -p "Press any key to close."
