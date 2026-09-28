#!/bin/bash
# Double-click (or run in Terminal) to build the caption helper app into /Users/Shared/VidAuto.
cd "$(dirname "$0")"
APP="/Users/Shared/VidAuto/VidAuto Caption Helper.app"
PLIST="$APP/Contents/Info.plist"
mkdir -p /Users/Shared/VidAuto
rm -rf "$APP"
if ! osacompile -o "$APP" "CaptionHelper.applescript"; then
  echo "Build failed -- send this window's text to Claude."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

# Let the Premiere plugin start the helper with the link vidauto-helper://captions
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.vidauto.captionhelper" "$PLIST" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.vidauto.captionhelper" "$PLIST"
/usr/libexec/PlistBuddy \
  -c "Add :CFBundleURLTypes array" \
  -c "Add :CFBundleURLTypes:0 dict" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.vidauto.captionhelper" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string vidauto-helper" \
  "$PLIST"
# Editing Info.plist breaks the app's signature; re-sign it locally and register the link with macOS
codesign --force --deep --sign - "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"

# Window finder / mouse clicker used by the helper and by Record Button Position.command
cp windows.js /Users/Shared/VidAuto/windows.js
# Draws the title and arrow pictures
cp overlays.js /Users/Shared/VidAuto/overlays.js

echo "Built: $APP"
echo
echo "IMPORTANT: macOS treats this as a new app. In System Settings > Privacy & Security > Accessibility,"
echo "remove the old 'VidAuto Caption Helper' entry (select it, click -) and allow the new one when asked."
open /Users/Shared/VidAuto
echo
read -n 1 -s -r -p "Press any key to close."
