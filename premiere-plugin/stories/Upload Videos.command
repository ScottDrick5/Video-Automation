#!/bin/bash
# Schedules the finished videos on YouTube or Facebook (TikTok comes next).
# Before the first run: be signed in to YouTube / Facebook in Chrome; Chrome > View > Developer > Allow JavaScript from
# Apple Events is on (as for Get Stories). macOS will ask to let Terminal control Chrome and System Events, and
# Terminal needs Accessibility (System Settings > Privacy & Security > Accessibility) to type into the file window.
# Don't touch the mouse or keyboard while it runs.
cd "$(dirname "$0")"
echo "VidAuto - Upload Videos"
echo
read -r -p "Where to? (f = Facebook, y = YouTube) " P
PLATFORM="youtube"
[[ "$P" =~ ^[Ff] ]] && PLATFORM="facebook"
read -r -p "Test with just one video? (y = one, filled in but you click Schedule; Enter = all) " T
ARGS="$PLATFORM 0"
[[ "$T" =~ ^[Yy] ]] && ARGS="$PLATFORM 1 review"
echo
echo "Working... hands off the mouse and keyboard. Progress shows below and in"
echo "/Users/drick/Documents/AITA/vidauto-uploads-log.txt"
echo
osascript -l JavaScript uploads.js $ARGS "$(pwd)"
echo
read -n 1 -s -r -p "Press any key to close."
