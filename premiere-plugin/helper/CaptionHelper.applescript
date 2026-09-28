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

		-- 3. Confirm the Create captions window. Wait up to 5s for it; if it can't be recognised by name,
		--    press Return, which triggers its default (blue) Create captions button.
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
			else
				my logLine("Captions window not recognised by name (see windows above); pressing Return.")
			end if
			set frontmost of p to true
			delay 0.3
			key code 36 -- Return
			my logLine("RESULT: pressed Return to confirm.")
		end tell
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
