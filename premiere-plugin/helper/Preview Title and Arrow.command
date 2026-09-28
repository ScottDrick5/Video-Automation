#!/bin/bash
# Double-click to see what the title and arrow will look like (no Premiere needed).
# Makes a sample with "I Ruined Her Graduation" and opens it. To try your own title, type it after
# the command in Terminal: bash "Preview Title and Arrow.command" "My Sister Ruined My Wedding"
cd "$(dirname "$0")"
TITLE="${1:-I Ruined Her Graduation}"
OUT=/Users/Shared/VidAuto/preview
mkdir -p "$OUT"
HUE=$((RANDOM % 360))
cat > "$OUT/job.json" <<JSON
{ "outDir": "$OUT", "title": "$TITLE", "labels": ["Full Video", "Part 1"],
  "color": { "hue": $HUE, "saturation": 62, "lightness": 33 }, "preview": true }
JSON
RESULT=$(osascript -l JavaScript overlays.js "$OUT/job.json")
echo "$RESULT"
if [[ "$RESULT" == ok* ]]; then
  open "$OUT/preview.png"
  echo
  echo "Opened the preview. Run it again for another random arrow colour."
else
  echo "Send this window's text to Claude."
fi
read -n 1 -s -r -p "Press any key to close."
