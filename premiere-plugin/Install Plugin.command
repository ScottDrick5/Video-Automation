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
    # macOS doesn't let Adobe's installer read Downloads (status -204), so install from a shared folder.
    STAGE="/Users/Shared/VidAuto"
    mkdir -p "$STAGE" && cp dist/*.ccx "$STAGE/"
    # Remove an older copy first; the installer doesn't always replace an existing install.
    "$UPIA" --remove "VidAuto Test" > /dev/null 2>&1
    "$UPIA" --remove "VidAuto" > /dev/null 2>&1
    for PKG in "VidAutoTest-folder.ccx" "VidAutoTest.ccx"; do
      echo "=== Trying $PKG"
      # The installer can print "Failed" and still exit with 0, so judge by its output.
      OUT="$("$UPIA" --install "$STAGE/$PKG" 2>&1)"
      STATUS=$?
      echo "$OUT"
      echo "exit code: $STATUS"
      if [ $STATUS -eq 0 ] && ! echo "$OUT" | grep -qi "fail"; then
        echo "Installed from $PKG"
        break
      fi
      echo "NOT installed from $PKG"
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
