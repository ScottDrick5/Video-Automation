# VidAuto Premiere plugin

A **test** panel for Premiere Pro. It runs each step of the AITA workflow on its own button, so we can
see which ones Premiere allows before building the real thing. It only works on a copy of a voiceover
and never deletes anything.

## Weekly use (one click)

1. Open Chrome (signed in to chatgpt.com and reddit.com) and Premiere with **AITA Template.prproj**, Text panel
   floating.
2. In the **VidAuto** panel click **Run** and keep your hands off the mouse and Chrome (about 1-1.5 hours for a week).
   - First it gets this week's stories (see *Stage 0* below): one voiceover and `title.txt` per missing date,
     Monday to Sunday.
   - Then it measures the voiceovers and checks there is enough footage for all of them; if not, it stops before
     making any video and says so.
   - Then it makes the full video and clips for every date folder that has a voiceover but no full video.
   - When it finishes (or stops), your Mac shows a notification with a sound.
3. **Get stories only** and **Make videos only** run one half, e.g. to check the voiceovers first.
   `stories/Get Stories.command` still works on its own too.

The first Run after building the helper, macOS asks whether *VidAuto Caption Helper* may control Google Chrome and
use Downloads: click **OK/Allow**.

## Daily use

1. Put each voiceover in its posting-date folder: `/Users/drick/Documents/AITA/New Video Clips/<M-D-YY>/`,
   together with a `title.txt` holding the story title on one line (e.g. `I Ruined Her Graduation`).
2. Keep downloaded videos in `/Users/drick/Documents/AITA/Source Video/` (used oldest first).
3. Open **AITA Template.prproj** in Premiere, with the Text panel floating.
4. In the **VidAuto** panel click **Run** and keep your hands off the mouse. For every date folder that has a
   voiceover but no full video yet, oldest date first, it:
   - imports the voiceover and waits for Premiere's transcript,
   - cuts everything before "Am I the ahole" and makes a 1080×1920, 29.97 fps sequence named after the folder,
   - puts the next unused part of the source video on V1 (starting where the last video stopped), filling the
     frame, same length as the voiceover, with the video's own sound removed,
   - creates captions with your AITA preset and fixes ahole / a-hole / asshole → A-Hole,
   - puts the title (AITA / title / (Full Video)) on V2 for the whole video and the arrow on V3 for 5 seconds at
     1/5, 2/5, 3/5 and 4/5 of the way through; the arrow gets a random colour for each date,
   - exports `AITA - <title> (Full Video).mp4` into the date folder with `/Users/drick/Documents/AITA/AITA.epr`,
   - cuts the clips (at most 1:58, at a pause or a dip in the voice; if the last clip would be under a minute
     the last two share the time evenly, and if that is still too short every clip gets the same length),
     swaps the title to (Part 1), (Part 2)..., puts the arrow 5 seconds into each clip, and exports
     `AITA - <title> (Part 1).mp4` and so on into the date folder.
5. The first time a source video is used, your Mac makes a Premiere-friendly copy of it (standard H.264, same
   size) in `/Users/drick/Documents/AITA/Converted Source Video/`, using macOS's own converter. That takes a few
   minutes once per video and keeps Premiere's playback and exports fast whatever the download's encoding.
   You can delete a copy once its video is used up.
6. If there isn't enough video left for a voiceover, it moves to the next source video; if there is none, it
   stops and tells you before building anything.

The panel shows the current source video and how much is left. To start the next video at a particular point
(for example after cutting a video by hand), type the timecode, e.g. `00;07;45;01`, and click
**Set start of next video**. Progress is kept in `/Users/drick/Documents/AITA/vidauto-usage.json`.

## Upload (YouTube for now; TikTok and Facebook next)

Click **Upload** in the panel (or double-click `stories/Upload Videos.command`), or tick **Upload at the end of Run**.
For every finished date folder from today on, it schedules on YouTube (Eastern time, on the folder's date):
the full video at 11:30 AM and Part 1-5 at 1:30, 3:30, 5:30, 7:30 and 9:30 PM. A Part 6 or later isn't scheduled
(the log says so). Title = the video's name. On YouTube your saved default description is kept and only the name
after "Gameplay Video Credit:" is changed. On TikTok and Facebook the text is the video's name, a blank line, then:

    Gameplay Video Credit: <creator>

    #storytime #redditstoryteller #RelationshipDrama #reddit

The creator comes from the source video's "Authors" info ("Orbital - No Copyright Gameplay" -> "Orbital"); to set it
yourself, put `<source video name>.credit.txt` next to that video in Source Video. Each date folder notes its source
video in `source.txt`. What's been scheduled is kept in `/Users/drick/Documents/AITA/vidauto-uploads.json`, so
nothing is posted twice; the log is `vidauto-uploads-log.txt`.

It drives YouTube Studio in Chrome and types the file's location into the Mac's file window, so leave the mouse
and keyboard alone while it runs.

Protecting your daily upload limit:
- **Test: just one** uploads one video and fills everything in, but doesn't click the final **Schedule**: the tab
  stays open for you to check and click it yourself.
- If something fails after the file was chosen (so the upload already counts), the tab is left open to finish by
  hand, that video is remembered so it's never uploaded twice, and the run stops.
- It never uploads more than your daily limit (counting today's earlier uploads). Default 10 a day; to change it,
  create `/Users/drick/Documents/AITA/vidauto-upload-limits.json` with e.g. `{ "youtube": 15 }`.

## Stage 0: Get stories (testing, separate for now)

Double-click `premiere-plugin/stories/Get Stories.command` and press Enter. It makes a story for every date from
the next date without a folder through that week's Sunday (weeks run Monday to Sunday), so a fresh week gets 7 and
a half-done week gets the rest. (Type a number instead to make exactly that many.) For each one it:
1. picks the most upvoted post of the week on r/BestofRedditorUpdates that isn't NSFW, wasn't used before, has
   no violent content warnings and is long enough for a 4-8 minute video (only the main post's text is used),
2. opens a new ChatGPT chat in Chrome and sends your prompt with the story,
3. reads "Perspective: Male/Female" and picks the voice: Ember (male) or Juniper (female),
4. asks "Can you give me a good, few-word title for this script?" and takes the one ChatGPT marks as its favorite (⭐),
5. switches AI Voice Saver's voice if needed (and reloads the page), clicks its download button and waits for the
   file in Downloads,
6. moves the voiceover into the next date folder that doesn't exist yet (named like 9-28-26 or 10-02-26; it creates
   it) and writes `title.txt`.

Used stories are listed in `/Users/drick/Documents/AITA/vidauto-stories.json` so none is used twice; the full log is
in `vidauto-stories-log.txt` next to it. To change the prompt, put your version in
`/Users/drick/Documents/AITA/chatgpt-prompt.txt`. If ChatGPT's message limit is reached, it stops and says how many
stories it finished.

Before the first run: in Chrome turn on **View → Developer → Allow JavaScript from Apple Events**, and be signed in
to chatgpt.com and reddit.com. The first time, macOS asks whether Terminal may control Google Chrome and access
Downloads: click **OK/Allow**.

## Test steps (troubleshooting)

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
| 8. Title, arrow & clips | Adds the title and arrow to the test sequence and exports the full video and clips into a folder you pick (it needs a `title.txt`) |

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

The three *Record…* files below talk you through each spot out loud (turn your sound on), tick once a
second while counting down, and chime when a spot is recorded, so it doesn't matter if Premiere covers the
Terminal window.

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
   the search box, the **Replace** button with the circular-arrow icon directly under the search box (not the
   small Replace button at the right end of the Replace with row), the Replace with box, and Replace all.
4. When it says *Saved*, click **Replace** again to close that row and clear the search box.

Run it again if you resize the floating Text panel. If you work with different screen setups (for example
the laptop screen on its own and your desk monitors), record once in each setup: every size is kept, and the
helper uses whichever one is open.

### 5e. Record where the AITA caption preset is (once)
Premiere doesn't keep the AITA preset selected, so the helper picks it in the Create captions window.
1. Open the Create captions window (click the Text panel, then Control + Option + Command + C).
2. Double-click `premiere-plugin/helper/Record Preset Positions.command`.
3. Point at the **Caption preset** menu when asked; then click it open and point at **AITA** in the list.
4. Press Escape and click Cancel.

Run it again if you add or remove caption presets.

### 5f. Check the title and arrow (once)
The title (Zilla Slab) and arrow (Montserrat) are drawn by your Mac, so both fonts must be installed (they are
if Camtasia could use them). Double-click `premiere-plugin/helper/Preview Title and Arrow.command`: it opens a
picture of the title and arrow on a plain background. Run it again for another random arrow colour.
If something should be bigger, smaller or moved, tell Claude; the numbers can be changed in
`/Users/Shared/VidAuto/overlay-style.json` without rebuilding anything.

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
