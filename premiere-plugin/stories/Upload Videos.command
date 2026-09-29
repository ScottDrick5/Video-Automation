#!/bin/bash
# Schedules the finished videos on YouTube (TikTok and Facebook come next).
# Before the first run: be signed in to YouTube in Chrome; Chrome > View > Developer > Allow JavaScript from
# Apple Events is on (as for Get Stories). macOS will ask to let Terminal control Chrome and System Events, and
# Terminal needs Accessibility (System Settings > Privacy & Security > Accessibility) to type into the file window.
# Don't touch the mouse or keyboard while it runs.
cd "$(dirname "$0")"
echo "VidAuto - Upload Videos (YouTube)"
echo
read -r -p "Test with just one video? (y = one, Enter = all) " T
N=0
[[ "$T" =~ ^[Yy] ]] && N=1
echo
echo "Working... hands off the mouse and keyboard. Progress shows below and in"
echo "/Users/drick/Documents/AITA/vidauto-uploads-log.txt"
echo
osascript -l JavaScript uploads.js youtube "$N" "$(pwd)"
echo
read -n 1 -s -r -p "Press any key to close."
