#!/bin/bash
# Double-click in Finder to process everything in the inbox folder.
cd "$(dirname "$0")/.."
./.venv/bin/vidauto inbox inbox
status=$?
open output
echo
read -n 1 -s -r -p "Finished. Press any key to close."
exit $status
