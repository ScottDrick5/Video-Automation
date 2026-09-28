#!/bin/bash
# READ-ONLY: collects information about Adobe's plugin installer and plugin folders. Changes nothing.
# Output is saved to ~/Desktop/vidauto-diagnostics.txt -- send that file to Claude.
OUT="$HOME/Desktop/vidauto-diagnostics.txt"

section() { echo; echo "=================== $1"; }

{
  echo "VidAuto diagnostics -- $(date)"
  echo "macOS $(sw_vers -productVersion)"

  section "Premiere app folder"
  ls "/Applications/Adobe Premiere Pro 2026" 2>&1

  section "Installer logs mentioning the failed install (last 3 days)"
  find "$HOME/Library/Logs" "/Library/Logs" -type f -mtime -3 \
    \( -iname "*UPI*" -o -iname "*UnifiedPlugin*" -o -iname "*PluginInstaller*" -o -iname "*UXP*" \) 2>/dev/null |
  while read -r f; do
    echo "--- $f"
    grep -i -n -B2 -A4 "vidauto\|-204\|error\|fail" "$f" 2>/dev/null | tail -60
  done

  for base in "/Library/Application Support/Adobe/UXP" "$HOME/Library/Application Support/Adobe/UXP"; do
    section "Folders in $base (3 levels)"
    if [ -d "$base" ]; then
      find "$base" -maxdepth 3 2>/dev/null | sed "s#^$base#.#" | head -150
    else
      echo "(does not exist)"
    fi
    section "Plugin lists (PluginsInfo) in $base"
    find "$base" -path "*PluginsInfo*" -name "*.json" 2>/dev/null | while read -r f; do
      echo "--- $f"
      head -c 3000 "$f"
      echo
    done
  done

  section "Premiere preference folders"
  ls -d "$HOME/Library/Application Support/Adobe/Premiere Pro"/* 2>/dev/null
  ls -d "$HOME/Documents/Adobe/Premiere Pro"/* 2>/dev/null
} > "$OUT" 2>&1

echo "Saved to $OUT -- send that file to Claude."
read -n 1 -s -r -p "Press any key to close."
