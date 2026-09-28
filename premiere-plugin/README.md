# VidAuto Premiere test plugin

A **test** panel for Premiere Pro. It runs each step of the AITA workflow on its own button, so we can
see which ones Premiere allows before building the real thing. It only works on a copy of a voiceover
and never deletes anything.

| Button | What it checks |
|---|---|
| 0. Check setup | Premiere version, open project, and that the plugin can reach everything it needs |
| 1. Import voiceover | Brings a voiceover file into the open project |
| 2. Transcribe | Uses Premiere's own transcript (Premiere makes it automatically on import) |
| 3. Find cut point | Finds the first "Am I the ahole" (any spelling) and shows the time |
| 4. Build sequence | Starts the voiceover at "Am I the ahole" at 0:00 in a new 1080×1920, 29.97 fps sequence |
| 5. Create captions | The Mac helper presses Create Captions (keyboard shortcut) and clicks its Create button |
| 6. Fix A-Hole | The helper uses Find and Replace in the floating Text panel: ahole / a-hole / asshole → **A-Hole** |
| 7. Test export | Exports the test sequence with your export preset as `AITA-test.mp4` |

## One-time setup (about 10 minutes)

### 1. Download this folder
On GitHub, switch to the branch `claude/video-workflow-automation-tq3ajc`, click **Code → Download ZIP**,
and unzip it. You need the `premiere-plugin` folder.

### 2. Turn on developer mode in Premiere
**Premiere Pro → Settings → Plugins → check "Enable developer mode"**, then quit and reopen Premiere.

### 3. Install Adobe's UXP Developer Tool
Open the **Creative Cloud** app, search for **UXP Developer Tool**, and install it (free).

### 4. Load the plugin

There are two ways. If one gives an error, try the other and send Claude the error text.

**Way 1: installer file (no Developer Tool)**
1. Make sure the **Creative Cloud** app is open and you're signed in. Adobe's installer only works then.
2. Quit Premiere.
3. Double-click `premiere-plugin/Install Plugin.command`. If macOS won't open it: right-click → **Open** → **Open**.
4. It copies the installer files to `/Users/Shared/VidAuto` (macOS blocks Adobe's installer from reading
   Downloads), tries two versions, and saves what happened to `vidauto-install-log.txt` on your Desktop.
5. If it says **Installed**, open Premiere and look under **Window → UXP Plugins → VidAuto Test**.
6. If it fails, send Claude the log text.

You can also try double-clicking `premiere-plugin/dist/VidAutoTest.ccx` directly. That opens Creative Cloud's installer.

**Way 2: UXP Developer Tool**
1. Open Premiere and your project.
2. Open **UXP Developer Tool** and click **Add Plugin**.
3. Pick `premiere-plugin/plugin/manifest.json`.
4. Click the **•••** next to "VidAuto Test" and choose **Load**.
5. The panel appears in Premiere. If you don't see it, look under **Window → UXP Plugins → VidAuto Test**.

Premiere forgets developer plugins when it restarts, so repeat step 4 (just **Load**) after reopening Premiere.

### 5. Build the caption helper
Double-click `premiere-plugin/helper/Build Caption Helper.command`.

- If your Mac says it can't be opened: right-click it → **Open** → **Open**.
- If it still won't open: open **Terminal**, type `bash ` (with a space), drag the file into the window, and press Enter.

It creates `VidAuto Caption Helper` in `/Users/Shared/VidAuto`.

### 5b. Give Create Captions a keyboard shortcut
The helper creates captions by pressing a shortcut. In Premiere, open **Premiere Pro → Keyboard Shortcuts**,
search **caption**, and under **Text Panel → Create Captions** click the Shortcut space and press
**Control + Option + Command + C**. Click **OK**.

After rebuilding the helper, macOS treats it as a new app: in **System Settings → Privacy & Security →
Accessibility**, remove the old *VidAuto Caption Helper* entry (select it, click **−**) and allow the new one.

### 5c. Record where the Create captions button is (once)
Premiere opens the Create captions window without making it active and hides it from helpers, so the helper
finds that window by its size and clicks the button inside it. The spot is measured from the window's corner,
so it works on any screen, with one monitor or three.
1. Build the helper first (step 5).
2. In Premiere, open the Create captions window (click the Text panel, then Control + Option + Command + C).
3. Double-click `premiere-plugin/helper/Record Button Position.command`.
4. Within 5 seconds, rest the mouse pointer on the blue **Create captions** button and keep it still.
5. When it says *Saved*, press **Cancel** in Premiere.

Record again only if Premiere changes the size of that window (for example after an update).

### 5d. Float the Text panel and record its Find and Replace spots (once)
The helper fixes ahole / a-hole / asshole → A-Hole with Find and Replace in the Captions tab. It needs the
Text panel as its own window so it can find it on any screen.
1. Click the **☰** next to *Text* → **Undock Panel**. Size and place it how you like.
2. Open its **Captions** tab (a caption track must exist), type anything in the search box, and click
   **Replace** so the *Replace with* row shows.
3. Double-click `premiere-plugin/helper/Record Text Panel Positions.command` and point at each item when asked:
   the search box, the Replace button, the Replace with box, and Replace all.
4. When it says *Saved*, click **Replace** again to close that row and clear the search box.

Run it again if you resize the floating Text panel.

### 6. Save your export preset as a file
In Premiere's **Export** page, click **•••** next to *Preset* → **Save preset**, and name it `AITA`.
Step 7 needs the preset as an `.epr` file. Open the preset manager (Preset → **More presets**), select `AITA`,
and use its **Export** option to save `AITA.epr` to your Desktop. If you can't find that option, skip step 7
and tell Claude.

### 7. Save your caption settings as a preset
In the **Create captions** window (Transcript tab → CC button), set your usual settings (24 characters,
3.5 seconds, 0 frames, Single line). Click **•••** next to *Caption preset* → **Save**, then **Cancel**.

## Running the test

1. Make a **copy** of one of your ChatGPT voiceovers.
2. In Premiere, open a project (a new empty one is safest) and open the **Text** panel (**Window → Text**).
3. In the VidAuto Test panel, click the buttons **0 through 7 in order**. Each one shows **OK** or **FAILED**.
4. The first time step 6 runs:
   - Premiere asks whether the plugin may open the helper: click **Allow**.
   - macOS asks to let the helper control your computer: open **System Settings → Privacy & Security →
     Accessibility**, turn on **VidAuto Caption Helper**, and run step 6 again.
   - If macOS asks to let it control **System Events**, click **OK**.
5. Click **Copy log** and paste the text into Claude. No screenshots needed.

**Useful extra info for the next round:** in Premiere, open **Premiere Pro → Keyboard Shortcuts**, search
for `caption`, and tell Claude which commands show up.
