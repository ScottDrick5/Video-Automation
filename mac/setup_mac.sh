#!/bin/bash
# One-time setup on a Mac: installs ffmpeg + Python deps and creates config.yaml and inbox/.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it from https://brew.sh then run this again."
  exit 1
fi

brew list ffmpeg >/dev/null 2>&1 || brew install ffmpeg
command -v python3 >/dev/null 2>&1 || brew install python

python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -e .

[ -f config.yaml ] || cp config.example.yaml config.yaml
mkdir -p inbox output
chmod +x "mac/Process Inbox.command" mac/install_watcher.sh

echo
echo "Done. Next:"
echo "  1. Edit config.yaml if you want different settings."
echo "  2. Put my-video.mp4 + my-video.mp3 in the inbox folder."
echo "  3. Double-click 'mac/Process Inbox.command' (or run mac/install_watcher.sh to process automatically)."
