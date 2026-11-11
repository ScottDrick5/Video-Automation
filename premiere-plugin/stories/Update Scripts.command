#!/bin/bash
# Double-click after downloading a new copy: puts the newest Get Stories and Upload scripts where the panel runs
# them (/Users/Shared/VidAuto/stories). No need to rebuild the helper or re-allow anything.
cd "$(dirname "$0")"
DEST="/Users/Shared/VidAuto/stories"
mkdir -p "$DEST"
cp stories.js story-rules.js chatgpt-prompt.txt uploads.js upload-rules.js "$DEST/" && {
  echo "Updated the scripts in $DEST:"
  grep -ho 'Get Stories version [0-9a-z-]*' "$DEST/stories.js" | head -1
  grep -ho 'Upload version [0-9a-z-]*' "$DEST/uploads.js" | head -1
  grep -ho 'RULES_VERSION = "[0-9a-z-]*"' "$DEST/upload-rules.js" | head -1
} || echo "Couldn't copy the scripts -- send this window's text to Claude."
echo
read -n 1 -s -r -p "Press any key to close."
