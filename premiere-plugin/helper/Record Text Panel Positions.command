#!/bin/bash
# Records four spots in the FLOATING Text panel so the helper can replace ahole/asshole with A-Hole.
# Before running:
#   1. Float the Text panel: click the menu icon next to "Text" > Undock Panel. Size it how you like it.
#   2. Open its Captions tab (a caption track must exist), type anything in the search box,
#      and click Replace so the "Replace with" row is showing.
# Then double-click this file and point at each item when asked.
cd "$(dirname "$0")"
TOOL="/Users/Shared/VidAuto/windows.js"
cp windows.js "$TOOL" 2>/dev/null
OUT="/Users/Shared/VidAuto/text-panel.txt"

ask() {
  echo
  echo "Point at: $1  (keep the mouse still)"
  for i in 5 4 3 2 1; do echo "  recording in $i..."; sleep 1; done
  P=$(osascript -l JavaScript "$TOOL" point 2>&1)
  if ! [[ "$P" =~ ^-?[0-9]+,-?[0-9]+,-?[0-9]+,[0-9]+,[0-9]+$ ]]; then
    echo "Could not record: $P"
    echo "Make sure the Text panel is floating (its own window) and the pointer is on it. Nothing was saved."
    read -n 1 -s -r -p "Press any key to close."
    exit 1
  fi
  echo "  got $P"
}

ask "the SEARCH box at the top of the Captions tab";  S=$P
ask "the REPLACE button under the search box";          T=$P
ask "the 'REPLACE WITH' box";                            F=$P
ask "the 'REPLACE ALL' button";                          A=$P

IFS=, read -r _ _ _ W H <<< "$S"
for V in "$T" "$F" "$A"; do
  IFS=, read -r _ _ _ W2 H2 <<< "$V"
  if [ "$W2" != "$W" ] || [ "$H2" != "$H" ]; then
    echo; echo "The four spots were not all in the same window (${W}x${H} vs ${W2}x${H2}). Nothing was saved; try again."
    read -n 1 -s -r -p "Press any key to close."; exit 1
  fi
done
printf "%s\n%s\n%s\n%s\n" "$S" "$T" "$F" "$A" > "$OUT"
echo
echo "Saved to $OUT (Text panel window ${W}x${H})."
echo "Now click Replace again to close the 'Replace with' row and clear the search box -- the helper expects it closed."
echo "If you resize the floating Text panel later, run this again."
echo
read -n 1 -s -r -p "Press any key to close."
