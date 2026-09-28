-- VidAuto Caption Helper
-- Brings Premiere to the front, activates the Text panel (Window > Text), presses the
-- Create Captions shortcut (Control+Option+Command+C, assigned in Premiere's Keyboard
-- Shortcuts under Text Panel > Create Captions), then confirms the Create captions window.
-- Everything it does is written to /Users/Shared/VidAuto/helper-log.txt.
--
-- Runs when double-clicked, or when the plugin opens the link vidauto-helper://captions.

property logPath : "/Users/Shared/VidAuto/helper-log.txt"

on logLine(t)
	set stamp to do shell script "date '+%H:%M:%S'"
	do shell script "echo " & quoted form of (stamp & "  " & t) & " >> " & quoted form of logPath
end logLine

on premiereProcess()
	tell application "System Events"
		set procs to (every application process whose name contains "Premiere")
		if procs is {} then error "Premiere Pro is not running"
		return item 1 of procs
	end tell
end premiereProcess

-- The check mark next to a menu item ("" when there is none)
on markOf(menuItem)
	try
		tell application "System Events" to set m to value of attribute "AXMenuItemMarkChar" of menuItem
		if m is missing value then return ""
		return m as text
	on error
		return ""
	end try
end markOf

-- Position of the Create captions button saved by "Record Button Position.command", or missing value
on savedButtonPosition()
	try
		set t to do shell script "cat /Users/Shared/VidAuto/create-button.txt"
		set AppleScript's text item delimiters to ","
		set parts to text items of t
		set AppleScript's text item delimiters to ""
		return {(item 1 of parts) as integer, (item 2 of parts) as integer}
	on error
		set AppleScript's text item delimiters to ""
		return missing value
	end try
end savedButtonPosition

-- Click the left mouse button at screen position {x, y}, then put the pointer back where it was.
-- Event numbers: tap 0 = HID, 5 = mouse moved, 1 = left down, 2 = left up, button 0 = left.
on clickAt(pos)
	set js to "ObjC.import('CoreGraphics');" & ¬
		"var back = $.CGEventGetLocation($.CGEventCreate(null));" & ¬
		"var pt = $.CGPointMake(" & (item 1 of pos) & "," & (item 2 of pos) & ");" & ¬
		"function post(type, where) { $.CGEventPost(0, $.CGEventCreateMouseEvent(null, type, where, 0)); }" & ¬
		"post(5, pt); delay(0.15); post(1, pt); delay(0.08); post(2, pt); delay(0.15); post(5, back); 'mouse events'"
	try
		return do shell script "osascript -l JavaScript -e " & quoted form of js
	on error errMsg
		my logLine("Mouse events failed (" & errMsg & "); trying System Events click")
		tell application "System Events" to click at pos
		return "System Events click"
	end try
end clickAt

on logWindows(p)
	tell application "System Events"
		repeat with w in (windows of p)
			my logLine("Window: " & (name of w))
		end repeat
	end tell
end logWindows

on createCaptions()
	do shell script "mkdir -p /Users/Shared/VidAuto && : > " & quoted form of logPath
	logLine("Helper started")
	try
		set p to premiereProcess()
		tell application "System Events"
			my logLine("Found process: " & (name of p))
			set frontmost of p to true
			delay 0.7

			-- 1. Activate the Text panel so its shortcut works
			set textItem to missing value
			try
				set textItem to menu item "Text" of menu 1 of menu bar item "Window" of menu bar 1 of p
			end try
			if textItem is missing value then
				my logLine("No Window > Text menu item found")
			else
				set mark to my markOf(textItem)
				my logLine("Window > Text check mark before click: '" & mark & "'")
				click textItem
				delay 1
				-- If that click closed an already-open panel, click again to reopen and focus it
				set mark2 to my markOf(textItem)
				if mark is not "" and mark2 is "" then
					my logLine("Text panel was closed by the click; reopening")
					click textItem
					delay 1
				end if
			end if

			-- 2. Press the Create Captions shortcut
			my logLine("Pressing Control+Option+Command+C")
			keystroke "c" using {control down, option down, command down}
			delay 2
		end tell

		-- 3. Confirm the Create captions window. Wait up to 5s in case it can be found by name;
		--    otherwise click the button at the recorded position.
		set dlg to missing value
		repeat 10 times
			tell application "System Events"
				repeat with w in (windows of p)
					set wn to name of w
					if wn is not missing value and wn contains "aption" then set dlg to w
				end repeat
			end tell
			if dlg is not missing value then exit repeat
			delay 0.5
		end repeat
		my logWindows(p)
		tell application "System Events"
			if dlg is not missing value then
				set bnames to {}
				try
					repeat with b in (buttons of dlg)
						set end of bnames to (name of b as text)
					end repeat
				end try
				set AppleScript's text item delimiters to ", "
				my logLine("Found captions window '" & (name of dlg) & "', buttons: " & (bnames as text))
				set AppleScript's text item delimiters to ""
				try
					click (first button of dlg whose name contains "Create")
					my logLine("RESULT: clicked the Create captions button.")
					return
				end try
			end if
		end tell

		-- Premiere doesn't show its windows to helpers and opens this one without making it active,
		-- so click the button at the position recorded with "Record Button Position.command".
		set pos to my savedButtonPosition()
		if pos is missing value then
			logLine("RESULT: no saved button position. Open the Create captions window and run 'Record Button Position.command', then try again.")
			return
		end if
		logLine("Clicking the Create captions button at " & (item 1 of pos) & "," & (item 2 of pos))
		set r to my clickAt(pos)
		logLine("RESULT: clicked (" & r & "). If captions did not appear, record the button position again.")
	on error errMsg number errNum
		if errNum is -1719 or errNum is -25211 or errNum is -1743 or errNum is 1002 then
			logLine("ERROR: Mac permission missing (" & errNum & "). Allow 'VidAuto Caption Helper' in System Settings > Privacy & Security > Accessibility (and Automation), then try again.")
		else
			logLine("ERROR " & errNum & ": " & errMsg)
		end if
	end try
end createCaptions

on run
	createCaptions()
end run

on open location theURL
	createCaptions()
end open location
