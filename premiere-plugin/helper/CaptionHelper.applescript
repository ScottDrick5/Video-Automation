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

property winTool : "/Users/Shared/VidAuto/windows.js"
property buttonFile : "/Users/Shared/VidAuto/create-button.txt"

-- Run a command of windows.js (finds Premiere windows by size, clicks the mouse)
on winCmd(args)
	return do shell script "osascript -l JavaScript " & quoted form of winTool & " " & args
end winCmd

-- Split "a,b,c" into a list of integers
on numbersIn(t)
	set AppleScript's text item delimiters to ","
	set parts to text items of t
	set AppleScript's text item delimiters to ""
	set out to {}
	repeat with p in parts
		set end of out to (p as integer)
	end repeat
	return out
end numbersIn

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

		-- 3. Click Create captions. Premiere hides its windows from helpers and opens this one without
		--    making it active, so find it by size (macOS still reports window bounds) and click the
		--    button at the spot recorded by "Record Button Position.command", measured from the
		--    window's bottom-right corner. This works on any screen.
		try
			set rec to my numbersIn(do shell script "cat " & quoted form of buttonFile)
		on error
			logLine("RESULT: button position not recorded yet. Open the Create captions window and run 'Record Button Position.command'.")
			return
		end try
		set {dx, dy, ww, wh} to rec
		logLine("Waiting for a Premiere window of about " & ww & "x" & wh)
		set found to my winCmd("find " & ww & " " & wh & " 8")
		if found is "none" then
			logLine("RESULT: the Create captions window did not appear within 8s (or its size changed; record the button position again).")
			return
		end if
		set {wx, wy, fw, fh} to my numbersIn(found)
		set cx to wx + fw - dx
		set cy to wy + fh - dy
		logLine("Found it at " & found & "; clicking Create captions at " & cx & "," & cy)
		delay 0.5
		logLine("RESULT: " & my winCmd("click " & cx & " " & cy))
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
