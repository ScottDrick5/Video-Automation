# VidAuto Premiere test plugin

A **test** panel for Premiere Pro. It runs each step of the AITA workflow on its own button, so we can
see which ones Premiere allows before building the real thing. It only works on a copy of a voiceover
and never deletes anything.

| Button | What it checks |
|---|---|
| 0. Check setup | Premiere version, open project, and that the plugin can reach everything it needs |
| 1. Import voiceover | Brings a voiceover file into the open project |
| 2. Transcribe | Runs Premiere's own transcription and reads every word with its time |
| 3. Find cut point | Finds the first "Am I the ahole" (any spelling) and shows the time. Nothing is cut yet. |
| 4. Fix A-Hole | Changes ahole / a-hole / asshole / a hole to **A-Hole** in Premiere's transcript |
| 5. Build sequence | Starts the voiceover at "Am I the ahole" and makes a new 1080×1920 sequence from it |
| 6. Create captions | Opens the small Mac helper, which presses Create captions for you |
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
4. It tries two versions of the installer file and saves what happened to `vidauto-install-log.txt` on your Desktop.
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
