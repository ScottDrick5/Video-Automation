-- VidAuto Caption Helper (test version)
-- Brings Premiere to the front, looks for a "Create captions" menu item, clicks it,
-- then confirms the Create captions window. Everything it sees is written to
-- /Users/Shared/VidAuto/helper-log.txt so the panel can show it.

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

on run
	do shell script "mkdir -p /Users/Shared/VidAuto && : > " & quoted form of logPath
	logLine("Helper started")
	try
		set p to premiereProcess()
		tell application "System Events"
			my logLine("Found process: " & (name of p))
			set frontmost of p to true
			delay 0.7

			-- 1. Find menu items that mention captions (top level and one submenu down)
			set found to {}
			set targetPath to missing value
			repeat with mbi in (menu bar items of menu bar 1 of p)
				set topName to name of mbi
				try
					repeat with mi in (menu items of menu 1 of mbi)
						set n to name of mi
						if n is not missing value then
							if n contains "aption" then
								set end of found to (topName & " > " & n & "  (enabled: " & (enabled of mi) & ")")
								if targetPath is missing value and (n contains "Create" or n contains "Generate") then set targetPath to {topName, n}
							end if
							if exists menu 1 of mi then
								repeat with sub in (menu items of menu 1 of mi)
									set sn to name of sub
									if sn is not missing value and sn contains "aption" then
										set end of found to (topName & " > " & n & " > " & sn & "  (enabled: " & (enabled of sub) & ")")
										if targetPath is missing value and (sn contains "Create" or sn contains "Generate") then set targetPath to {topName, n, sn}
									end if
								end repeat
							end if
						end if
					end repeat
				end try
			end repeat
		end tell

		logLine("Menu search finished")
		if found is {} then
			logLine("No menu items mention captions.")
		else
			repeat with f in found
				logLine("Menu: " & f)
			end repeat
		end if
		if targetPath is missing value then
			logLine("RESULT: no Create captions menu item. Next test will use a keyboard shortcut or the CC button position.")
			return
		end if

		-- 2. Click it. Menu items that open a window can block System Events, so don't wait for a reply.
		set AppleScript's text item delimiters to " > "
		logLine("Clicking menu: " & (targetPath as text))
		set AppleScript's text item delimiters to ""
		tell application "System Events"
			ignoring application responses
				if (count of targetPath) is 2 then
					click menu item (item 2 of targetPath) of menu 1 of menu bar item (item 1 of targetPath) of menu bar 1 of p
				else
					click menu item (item 3 of targetPath) of menu 1 of menu item (item 2 of targetPath) of menu 1 of menu bar item (item 1 of targetPath) of menu bar 1 of p
				end if
			end ignoring
		end tell
		delay 0.5
		do shell script "killall 'System Events' > /dev/null 2>&1 || true"
		delay 2

		-- 3. Confirm the Create captions window
		set p to premiereProcess()
		tell application "System Events"
			set dlg to missing value
			repeat with w in (windows of p)
				set wn to name of w
				my logLine("Window: " & wn)
				if wn is not missing value and wn contains "aption" then set dlg to w
			end repeat
			if dlg is not missing value then
				set bnames to {}
				try
					repeat with b in (buttons of dlg)
						set end of bnames to (name of b as text)
					end repeat
				end try
				set AppleScript's text item delimiters to ", "
				my logLine("Buttons in captions window: " & (bnames as text))
				set AppleScript's text item delimiters to ""
				try
					click (first button of dlg whose name contains "Create")
					my logLine("RESULT: clicked the Create captions button.")
					return
				end try
			end if
			key code 36 -- Return presses the window's default (blue) button
			my logLine("RESULT: pressed Return to confirm.")
		end tell
	on error errMsg number errNum
		if errNum is -1719 or errNum is -25211 or errNum is -1743 then
			logLine("ERROR: Mac permission missing (" & errNum & "). Allow 'VidAuto Caption Helper' in System Settings > Privacy & Security > Accessibility (and Automation), then try again.")
		else
			logLine("ERROR " & errNum & ": " & errMsg)
		end if
	end try
end run
