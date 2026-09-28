#!/bin/bash
# Records where the "Create captions" button is, so the helper can click it.
# 1. In Premiere, open the Create captions window (Text panel > CC button, or Control+Option+Command+C).
# 2. Double-click this file, then within 5 seconds rest the mouse pointer on the blue "Create captions" button.
POS_FILE="/Users/Shared/VidAuto/create-button.txt"
mkdir -p /Users/Shared/VidAuto

echo "Put the mouse pointer on the blue 'Create captions' button in Premiere and keep it still."
for i in 5 4 3 2 1; do
  echo "  recording in $i..."
  sleep 1
done

POS=$(osascript -l JavaScript -e '
ObjC.import("CoreGraphics");
var p = $.CGEventGetLocation($.CGEventCreate(null));
Math.round(p.x) + "," + Math.round(p.y);
')

if [[ "$POS" =~ ^-?[0-9]+,-?[0-9]+$ ]]; then
  echo "$POS" > "$POS_FILE"
  echo
  echo "Saved button position $POS to $POS_FILE"
  echo "You can press Cancel in Premiere's Create captions window now."
else
  echo
  echo "Could not read the mouse position (got: $POS). Send this window's text to Claude."
fi
echo
read -n 1 -s -r -p "Press any key to close."
