#!/bin/bash
# Double-click (or run in Terminal) to build the caption helper app into /Users/Shared/VidAuto.
cd "$(dirname "$0")"
mkdir -p /Users/Shared/VidAuto
rm -rf "/Users/Shared/VidAuto/VidAuto Caption Helper.app"
if osacompile -o "/Users/Shared/VidAuto/VidAuto Caption Helper.app" "CaptionHelper.applescript"; then
  echo "Built: /Users/Shared/VidAuto/VidAuto Caption Helper.app"
  open /Users/Shared/VidAuto
else
  echo "Build failed -- send this window's text to Claude."
fi
echo
read -n 1 -s -r -p "Press any key to close."
