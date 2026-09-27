#!/bin/bash
# Double-click to install the VidAuto Test plugin with Adobe's plugin installer (no UXP Developer Tool needed).
# Tries two package layouts. Everything it prints is also saved to ~/Desktop/vidauto-install-log.txt.
cd "$(dirname "$0")"
LOG="$HOME/Desktop/vidauto-install-log.txt"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"

{
  echo "VidAuto plugin install -- $(date)"
  echo "macOS $(sw_vers -productVersion)"
  ls -d /Applications/Adobe\ Premiere* 2>/dev/null
  echo

  if [ ! -x "$UPIA" ]; then
    echo "Adobe's plugin installer was not found at:"
    echo "  $UPIA"
    echo "It comes with the Creative Cloud app. Send this log to Claude."
  else
    for PKG in "dist/VidAutoTest.ccx" "dist/VidAutoTest-folder.ccx"; do
      echo "=== Trying $PKG"
      "$UPIA" --install "$(pwd)/$PKG"
      STATUS=$?
      echo "exit code: $STATUS"
      if [ $STATUS -eq 0 ]; then
        echo "Installed from $PKG"
        break
      fi
      echo
    done
    echo
    echo "=== Plugins Adobe's installer knows about"
    "$UPIA" --list all
  fi
} 2>&1 | tee "$LOG"

echo
echo "Log saved to $LOG"
echo "If it says 'Installed', quit and reopen Premiere, then look under Window -> UXP Plugins -> VidAuto Test."
read -n 1 -s -r -p "Press any key to close."
