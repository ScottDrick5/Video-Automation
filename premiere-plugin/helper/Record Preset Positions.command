#!/bin/bash
# Records where the "Caption preset" menu and your AITA preset are in the Create captions window, so the
# helper can pick AITA before clicking Create captions. Measured from the window's top-left corner, so it
# works on any screen. Run "Record Button Position.command" first (this uses the window size it saved).
# 1. In Premiere, open the Create captions window (click the Text panel, then Control+Option+Command+C).
# 2. Double-click this file and follow the prompts.
cd "$(dirname "$0")"
TOOL="/Users/Shared/VidAuto/windows.js"
cp windows.js "$TOOL" 2>/dev/null
BUTTON="/Users/Shared/VidAuto/create-button.txt"
OUT="/Users/Shared/VidAuto/preset-spots.txt"

if [ ! -f "$BUTTON" ]; then
  echo "Run 'Record Button Position.command' first."; read -n 1 -s -r -p "Press any key to close."; exit 1
fi
IFS=, read -r _ _ W H < "$BUTTON"

# Spoken prompts and sounds, so you can follow along while Premiere covers this window
speak() { say "$1" 2>/dev/null || true; }
countdown() { for ((i = $1; i > 0; i--)); do echo "  recording in $i..."; afplay /System/Library/Sounds/Tink.aiff 2>/dev/null & sleep 1; done; }
gotit() { afplay /System/Library/Sounds/Glass.aiff 2>/dev/null & }

ask() { # $1 = what to point at, $2 = seconds, $3 = what to say out loud
  echo
  echo "Point at: $1  (keep the mouse still)"
  speak "$3"
  countdown "$2"
  P=$(osascript -l JavaScript "$TOOL" rel "$W" "$H" 2>&1)
  if ! [[ "$P" =~ ^-?[0-9]+,-?[0-9]+$ ]]; then
    echo "Could not record: $P"
    echo "Make sure the Create captions window is open (same size as when you recorded the button). Nothing was saved."
    read -n 1 -s -r -p "Press any key to close."; exit 1
  fi
  echo "  got $P"
  gotit
}

ask "the 'Caption preset' menu (the box that says Subtitle default / AITA)" 5 "Point at the caption preset menu"; MENU=$P
echo
echo "Now CLICK that menu so its list opens, then rest the pointer on AITA in the list."
ask "AITA in the open list" 8 "Click the menu open, then point at AITA"; ITEM=$P

printf "%s\n%s\n" "$MENU" "$ITEM" > "$OUT"
echo
echo "Saved to $OUT. Close the list (press Escape) and click Cancel in Premiere."
echo "If you add or remove caption presets later (so AITA moves in the list), run this again."
echo
read -n 1 -s -r -p "Press any key to close."
