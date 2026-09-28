#!/bin/bash
# Records where the "Create captions" button sits INSIDE the Create captions window, so the helper can
# click it wherever the window opens (any screen, one monitor or three).
# 1. Build the helper first (Build Caption Helper.command).
# 2. In Premiere, open the Create captions window (click the Text panel, then Control+Option+Command+C).
# 3. Double-click this file, then within 5 seconds rest the mouse pointer on the blue "Create captions" button.
cd "$(dirname "$0")"
TOOL="/Users/Shared/VidAuto/windows.js"
[ -f "$TOOL" ] || cp windows.js "$TOOL" 2>/dev/null
OUT="/Users/Shared/VidAuto/create-button.txt"

# Spoken prompts and sounds, so you can follow along while Premiere covers this window
speak() { say "$1" 2>/dev/null || true; }
countdown() { for ((i = $1; i > 0; i--)); do echo "  recording in $i..."; afplay /System/Library/Sounds/Tink.aiff 2>/dev/null & sleep 1; done; }
gotit() { afplay /System/Library/Sounds/Glass.aiff 2>/dev/null & }

echo "Put the mouse pointer on the blue 'Create captions' button in Premiere and keep it still."
speak "Point at the Create captions button"
countdown 5
gotit

REC=$(osascript -l JavaScript "$TOOL" record 2>&1)
if [[ "$REC" =~ ^-?[0-9]+,-?[0-9]+,[0-9]+,[0-9]+$ ]]; then
  echo "$REC" > "$OUT"
  IFS=, read -r DX DY W H <<< "$REC"
  echo
  echo "Saved: the Create captions window is ${W}x${H}, and the button is ${DX} from its right edge and ${DY} from its bottom."
  echo "You can press Cancel in Premiere's Create captions window now."
else
  echo
  echo "Could not record the position: $REC"
  echo "Make sure the Create captions window is open and the pointer is on its button, then try again."
fi
echo
read -n 1 -s -r -p "Press any key to close."
