#!/bin/bash
# Stage 0 test: picks Reddit stories, has ChatGPT write each script and title, downloads the voiceover with
# AI Voice Saver, and puts it with title.txt into the next free date folder.
# Before the first run: Chrome > View > Developer > Allow JavaScript from Apple Events, and be signed in to
# chatgpt.com and reddit.com in Chrome. Don't use Chrome while it runs.
cd "$(dirname "$0")"
echo "VidAuto - Get Stories"
echo
read -r -p "How many stories? (press Enter for 7) " N
N=${N:-7}
echo
echo "Working... keep your hands off Chrome. Progress shows below and in"
echo "/Users/drick/Documents/AITA/vidauto-stories-log.txt"
echo
osascript -l JavaScript stories.js "$N" "$(pwd)"
echo
read -n 1 -s -r -p "Press any key to close."
