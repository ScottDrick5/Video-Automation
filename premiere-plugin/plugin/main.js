// VidAuto panel. "Run" makes the full video and the Facebook clips for every date folder that has a
// voiceover but no finished video yet.
// The numbered test buttons below it run single steps, for troubleshooting.

const ppro = require("premierepro");
const uxp = require("uxp");
const fs = uxp.storage.localFileSystem;
const { findCutPoint, flattenWords, aholeTerms } = require("./lib/transcript.js");
const { foldersToDo, chooseSource, fillScale, timecodeToSeconds, videoSizeFrom, formatTime } = require("./lib/plan.js");
const {
  MIN_CLIP, sequenceWords, loudnessFromWav, cutCandidates, planClips, fullArrowTimes, outputName, arrowColor,
} = require("./lib/clips.js");

// Your folders
const AITA_DIR = "/Users/drick/Documents/AITA";
const CLIPS_DIR = AITA_DIR + "/New Video Clips";       // one folder per posting date, e.g. 9-25-26
const SOURCE_DIR = AITA_DIR + "/Source Video";         // downloaded videos, used oldest first
const EXPORT_PRESET = AITA_DIR + "/AITA.epr";          // your export settings
const USAGE_FILE = AITA_DIR + "/vidauto-usage.json";   // how far into each source video we've used
const CONVERTED_DIR = AITA_DIR + "/Converted Source Video"; // Premiere-friendly copies of the source videos

const HELPER_DIR = "/Users/Shared/VidAuto";
const HELPER_APP = HELPER_DIR + "/VidAuto Caption Helper.app";
const HELPER_LOG = HELPER_DIR + "/helper-log.txt";
const TERMS_FILE = HELPER_DIR + "/terms.txt"; // words for the helper to replace (links lose "?..." parts)
const OVERLAY_JOB = HELPER_DIR + "/overlay-job.json"; // what the helper should draw
const OVERLAY_DIR = HELPER_DIR + "/overlays"; // title and arrow pictures, one folder per date
const VO_PATH_FILE = HELPER_DIR + "/voiceover-path.txt"; // voiceover the helper copies for loudness
const VO_WAV = HELPER_DIR + "/voiceover.wav";
const CONVERT_JOB = HELPER_DIR + "/convert-job.txt"; // source video to convert, and where to put the copy
const CONVERT_PROGRESS = HELPER_DIR + "/convert-progress.txt";
const TITLE_FILE = "title.txt"; // story title, in each date folder (until Stage 0 writes it)
const TITLE_TRACK = 1; // V2
const ARROW_TRACK = 2; // V3
const ARROW_SECONDS = 5;
const CLIP_ARROW_AT = 5; // seconds into each clip
const TICKS_PER_SECOND = 254016000000;
const PLUGIN_VERSION = "0.5.1";

const state = { clip: null, transcript: null, cut: null, sequence: null };

// ------------------------------------------------------------------ UI helpers

function log(msg) {
  const box = document.getElementById("log");
  const line = `${new Date().toLocaleTimeString()}  ${msg}\n`;
  box.textContent += line;
  box.scrollTop = box.scrollHeight;
}

function setStatus(n, ok, text) {
  const el = document.getElementById("s" + n);
  el.className = "status " + (ok ? "ok" : "fail");
  el.textContent = (ok ? "OK " : "FAILED ") + (text || "");
}

async function step(n, name, fn) {
  const el = document.getElementById("s" + n);
  el.className = "status";
  el.textContent = "working...";
  log(`--- Step ${n}: ${name}`);
  try {
    const summary = await fn();
    setStatus(n, true, summary);
    log(`Step ${n} OK${summary ? ": " + summary : ""}`);
  } catch (err) {
    setStatus(n, false, err.message || String(err));
    log(`Step ${n} FAILED: ${err.message || err}`);
    if (err.stack) log(err.stack);
  }
}

function secondsOf(tickTime) {
  if (!tickTime) return null;
  // Work from the raw tick count when there is one: for very long media (a 10-hour video is ~9e15
  // ticks) the ready-made "seconds" value came out 60x too small.
  try {
    if (tickTime.ticks !== undefined && typeof BigInt === "function") {
      const t = BigInt(String(tickTime.ticks));
      const whole = t / BigInt(TICKS_PER_SECOND);
      const rest = t % BigInt(TICKS_PER_SECOND);
      return Math.round((Number(whole) + Number(rest) / TICKS_PER_SECOND) * 1000) / 1000;
    }
  } catch (e) {
    // fall back to the seconds value
  }
  return Math.round(tickTime.seconds * 1000) / 1000;
}

// TickTime for a number of seconds, built from an exact tick count (safe for hours-long videos).
function tickTimeAt(seconds) {
  if (typeof BigInt === "function") {
    const ticks = BigInt(Math.round(seconds * 1000)) * BigInt(TICKS_PER_SECOND / 1000);
    return ppro.TickTime.createWithTicks(ticks.toString());
  }
  return ppro.TickTime.createWithSeconds(seconds);
}

function need(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function transaction(project, name, buildActions) {
  let ok = false;
  let inner = null; // an error thrown inside Premiere's callbacks may not reach us otherwise
  project.lockedAccess(() => {
    ok = project.executeTransaction((compound) => {
      try {
        for (const action of buildActions()) compound.addAction(action);
      } catch (err) {
        inner = err;
        throw err;
      }
    }, name);
  });
  if (inner) throw inner;
  if (!ok) throw new Error(`Premiere refused the "${name}" change`);
}

async function saveToDataFolder(name, text) {
  const folder = await fs.getDataFolder();
  const file = await folder.createFile(name, { overwrite: true });
  await file.write(text);
  return file.nativePath;
}

async function readTextFile(path) {
  try {
    const entry = await fs.getEntryWithUrl("file:" + path);
    return await entry.read();
  } catch (e) {
    return null;
  }
}

async function writeTextFile(path, text) {
  const slash = path.lastIndexOf("/");
  const folder = await fs.getEntryWithUrl("file:" + path.slice(0, slash));
  const file = await folder.createFile(path.slice(slash + 1), { overwrite: true });
  await file.write(text);
}

async function listFolder(path) {
  const folder = await fs.getEntryWithUrl("file:" + path);
  return folder.getEntries();
}

async function exists(path) {
  try {
    await fs.getEntryWithUrl("file:" + path);
    return true;
  } catch (e) {
    return false;
  }
}

async function clearHelperLog() {
  try {
    const entry = await fs.getEntryWithUrl("file:" + HELPER_LOG);
    await entry.write("\n") // UXP refuses to write an empty string;
  } catch (e) {
    // no log yet; the helper creates it
  }
}

async function findClipByPath(project, path) {
  const root = await project.getRootItem();
  const queue = [...(await root.getItems())];
  let match = null;
  while (queue.length) {
    const item = queue.shift();
    const folder = ppro.FolderItem.cast(item);
    if (folder) {
      queue.push(...(await folder.getItems()));
      continue;
    }
    const clip = ppro.ClipProjectItem.cast(item);
    if (clip && (await clip.getMediaFilePath()) === path) match = clip;
  }
  return match;
}

async function importPath(project, path) {
  let clip = await findClipByPath(project, path);
  if (clip) return clip;
  const ok = await project.importFiles([path], true, null, false);
  if (!ok) throw new Error(`Premiere refused to import ${path}`);
  return need(await findClipByPath(project, path), `Imported ${path}, but could not find it in the project`);
}

async function activeProject() {
  return need(await ppro.Project.getActiveProject(), "No project is open in Premiere");
}

// ------------------------------------------------------------------ steps

async function checkSetup() {
  log(`VidAuto Test plugin ${PLUGIN_VERSION}, Premiere ${uxp.host.version}`);
  const project = await activeProject();
  log(`Project: ${project.name}`);
  const seq = await project.getActiveSequence();
  log(`Active sequence: ${seq ? seq.name : "(none)"}`);
  const apis = {
    "Transcript.transcribeClipProjectItem": ppro.Transcript && ppro.Transcript.transcribeClipProjectItem,
    "Transcript.exportToJSON": ppro.Transcript && ppro.Transcript.exportToJSON,
    "Transcript.createImportTextSegmentsAction": ppro.Transcript && ppro.Transcript.createImportTextSegmentsAction,
    "EncoderManager.exportSequence": ppro.EncoderManager && ppro.EncoderManager.getManager().exportSequence,
    "shell.openPath": uxp.shell && uxp.shell.openPath,
  };
  const missing = Object.keys(apis).filter((k) => typeof apis[k] !== "function");
  Object.keys(apis).forEach((k) => log(`  ${missing.includes(k) ? "MISSING" : "found  "} ${k}`));
  const helperThere = (await readTextFile(HELPER_APP + "/Contents/Info.plist")) !== null;
  log(`Caption helper app: ${helperThere ? "found" : "NOT found at " + HELPER_APP}`);
  if (missing.length) throw new Error(`${missing.length} API(s) missing`);
  return `Premiere ${uxp.host.version}` + (helperThere ? "" : " (helper not built yet)");
}

async function importVoiceover() {
  const project = await activeProject();
  const file = need(await fs.getFileForOpening({ types: ["mp3", "wav", "m4a", "aac", "mp4"] }), "No file picked");
  const path = file.nativePath;
  log(`Picked: ${path}`);
  const clip = await importPath(project, path);
  state.clip = clip;
  state.transcript = state.cut = null;
  return clip.name;
}

// Premiere usually transcribes new clips on import. If it hasn't after a few seconds, put the voiceover on a
// timeline of its own and open it: Premiere transcribes what's on the open timeline. That timeline is
// deleted again by dropTranscribeSequence() once the transcript is complete.
async function getTranscript(clip, maxSeconds = 600) {
  const read = async () => {
    try {
      const json = await ppro.Transcript.exportToJSON(clip);
      return json && json.includes("segments") ? json : null;
    } catch (e) {
      return null;
    }
  };
  let json = await read();
  const t0 = Date.now();
  let onTimeline = false;
  let told = false;
  while (!json && Date.now() - t0 < maxSeconds * 1000) {
    if (!onTimeline && Date.now() - t0 > 8000) {
      onTimeline = true;
      log("  no transcript yet: putting the voiceover on a timeline so Premiere transcribes it...");
      try {
        const project = await activeProject();
        const tmp = need(await project.createSequenceFromMedia("VidAuto transcribing", [clip]), "no sequence");
        state.transcribeSeq = tmp;
        await project.setActiveSequence(tmp);
        await project.openSequence(tmp);
      } catch (err) {
        log(`  making the transcribing timeline: ${err.message || err}`);
      }
      if (typeof ppro.Transcript.transcribeClipProjectItem === "function") {
        try {
          await ppro.Transcript.transcribeClipProjectItem(clip);
        } catch (err) {
          log(`  transcribe request: ${err.message || err}`);
        }
      }
    }
    if (!told && Date.now() - t0 > 90000) {
      told = true;
      const msg = "WAITING: Premiere hasn't transcribed the voiceover. In the Text panel's Transcript tab click " +
        "Transcribe; the run continues by itself once it's done.";
      log(msg);
      const status = document.getElementById("runStatus");
      if (status) status.textContent = msg;
    }
    await new Promise((r) => setTimeout(r, 3000));
    json = await read();
  }
  need(json, "No transcript after waiting");
  log(`  transcript ready after ${Math.round((Date.now() - t0) / 1000)}s`);
  return JSON.parse(json);
}

async function dropTranscribeSequence(project) {
  if (!state.transcribeSeq) return;
  try {
    await project.deleteSequence(state.transcribeSeq);
    log("  removed the transcribing timeline");
  } catch (err) {
    log(`  removing the transcribing timeline: ${err.message || err}`);
  }
  state.transcribeSeq = null;
}

async function transcribe() {
  const clip = need(state.clip, "Run step 1 first");
  state.transcript = await getTranscript(clip);
  const saved = await saveToDataFolder("transcript-original.json", JSON.stringify(state.transcript));
  const words = flattenWords(state.transcript);
  log(`Saved transcript to ${saved}`);
  log(`First words: ${words.slice(0, 25).map((w) => w.text).join(" ")}`);
  return `${words.length} words`;
}

async function findCut() {
  const transcript = need(state.transcript, "Run step 2 first");
  const cut = findCutPoint(transcript);
  if (!cut) throw new Error('"Am I the ahole" (any spelling) not found in the transcript');
  state.cut = cut;
  log(`Cut at ${cut.seconds}s`);
  log(`  deleted part ends with: ...${cut.before}`);
  log(`  video will start with:  ${cut.after}...`);
  return `cut at ${cut.seconds.toFixed(2)}s`;
}

async function audioItemInfo(seq) {
  const track = await seq.getAudioTrack(0);
  const items = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  if (!items.length) return null;
  const it = items[0];
  return {
    item: it,
    start: secondsOf(await it.getStartTime()),
    end: secondsOf(await it.getEndTime()),
    in: secondsOf(await it.getInPoint()),
  };
}

async function trimOnTimeline(project, seq, cutTime) {
  const before = need(await audioItemInfo(seq), "The new sequence has no voiceover on A1");
  log(`  timeline clip before: starts ${before.start}s, ends ${before.end}s, source in ${before.in}s`);
  const it = before.item;
  const ways = [
    ["timeline in point", () => [it.createSetInPointAction(cutTime)]],
    ["timeline start", () => [it.createSetStartAction(cutTime)]],
  ];
  let trimmed = false;
  for (const [wayName, makeActions] of ways) {
    try {
      transaction(project, "VidAuto: trim voiceover", makeActions);
      const now = await audioItemInfo(seq);
      log(`  ${wayName}: worked -> starts ${now.start}s, ends ${now.end}s, source in ${now.in}s`);
      if (now.in >= cutTime.seconds - 0.05) {
        trimmed = true;
        break;
      }
      log(`  ${wayName}: did not cut the start off, trying the next way`);
    } catch (err) {
      log(`  ${wayName}: failed: ${err.message || err}`);
    }
  }
  if (!trimmed) throw new Error("None of the ways to cut the start of the voiceover worked");

  // Slide the trimmed voiceover back to 0:00 if it isn't there.
  const now = await audioItemInfo(seq);
  if (now.start > 0.01) {
    try {
      transaction(project, "VidAuto: move voiceover to 0:00", () => [
        now.item.createMoveAction(ppro.TickTime.createWithSeconds(-now.start)),
      ]);
      const moved = await audioItemInfo(seq);
      log(`  moved to 0:00 -> starts ${moved.start}s, ends ${moved.end}s`);
    } catch (err) {
      throw new Error(`Cut worked but moving to 0:00 failed: ${err.message || err}`);
    }
  }
}

async function buildSequence() {
  const project = await activeProject();
  return makeSequence(project, need(state.clip, "Run step 1 first"), need(state.cut, "Run step 3 first"),
    "VidAuto test " + new Date().toLocaleTimeString());
}

async function makeSequence(project, clip, cut, name) {
  const cutTime = ppro.TickTime.createWithSeconds(cut.seconds);

  // Way A: start the clip itself at "Am I the ahole" before making the sequence.
  // Some commands are listed but fail inside Premiere 26.0.x, so each one is tried and checked.
  let trimmedClip = false;
  const clipWays = [
    ["clip in point", () => clip.createSetInPointAction(cutTime)],
    ["clip in+out points", async () => {
      const out = await clip.getOutPoint(ppro.Constants.MediaType.AUDIO);
      log(`  clip out point is ${secondsOf(out)}s`);
      return clip.createSetInOutPointsAction(cutTime, out);
    }],
  ];
  for (const [wayName, makeAction] of clipWays) {
    try {
      const action = await makeAction();
      transaction(project, "VidAuto: set voiceover start", () => [action]);
      trimmedClip = true;
      log(`  ${wayName}: worked`);
      break;
    } catch (err) {
      log(`  ${wayName}: failed: ${err.message || err}`);
    }
  }

  const seq = need(await project.createSequenceFromMedia(name, [clip]), "Premiere did not create the sequence");
  state.sequence = seq;
  log(`Created sequence "${name}"`);

  // Way B: if the clip couldn't be trimmed, trim the voiceover on the timeline and slide it to 0:00.
  // Keep going on failure so the sequence still gets its size and opens, and steps 6-7 can run.
  let trimError = null;
  if (!trimmedClip) {
    try {
      await trimOnTimeline(project, seq, cutTime);
    } catch (err) {
      trimError = err;
      log(`  cutting the voiceover failed: ${err.message || err}`);
    }
  }

  try {
    const settings = await seq.getSettings();
    const rect = await settings.getVideoFrameRect();
    rect.width = 1080;
    rect.height = 1920;
    await settings.setVideoFrameRect(rect);
    transaction(project, "VidAuto: 1080x1920", () => [seq.createSetSettingsAction(settings)]);
  } catch (err) {
    log(`  changing the frame size failed: ${err.message || err}`);
  }

  const size = await seq.getFrameSize();
  const timebase = Number(await seq.getTimebase());
  const fps = timebase ? Math.round((TICKS_PER_SECOND / timebase) * 1000) / 1000 : "unknown";
  log(`Frame size now ${size.width}x${size.height}, frame rate ${fps} fps`);

  const track = await seq.getAudioTrack(0);
  const items = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  if (items.length) {
    const it = items[0];
    log(`A1 clip: starts ${secondsOf(await it.getStartTime())}s, ends ${secondsOf(await it.getEndTime())}s, source in ${secondsOf(await it.getInPoint())}s`);
  } else {
    log("A1 has no clip (unexpected)");
  }
  await project.openSequence(seq);
  if (trimError) throw new Error("Sequence made, but the voiceover start was not cut: " + (trimError.message || trimError));
  if (size.width !== 1080 || size.height !== 1920) throw new Error("Frame size did not change to 1080x1920");
  return `${size.width}x${size.height} @ ${fps} fps`;
}

// Start the helper through its link (vidauto-helper://<task>). For captions, opening the app also works.
async function startHelper(task) {
  const ways = [[`link vidauto-helper://${task}`, () => uxp.shell.openExternal(`vidauto-helper://${task}`, "Start the VidAuto helper")]];
  task = task.split("?")[0];
  if (task === "captions") {
    ways.push(["opening the app", () => uxp.shell.openPath(HELPER_APP, "Open the VidAuto helper so it can press Create captions for you")]);
  }
  await clearHelperLog(); // so an old RESULT line isn't mistaken for this run's
  for (const [wayName, start] of ways) {
    try {
      const result = await start();
      if (result === "") {
        log(`  started helper with ${wayName}`);
        return;
      }
      log(`  ${wayName}: ${result}`);
    } catch (err) {
      log(`  ${wayName}: ${err.message || err}`);
    }
  }
  throw new Error("Could not start the helper (see log)");
}

// Wait until the helper writes a RESULT or ERROR line, then return its whole log.
async function waitForHelper(seconds) {
  for (let i = 0; i < seconds; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const text = (await readTextFile(HELPER_LOG)) || "";
    if (/RESULT|ERROR/.test(text)) return text;
  }
  return (await readTextFile(HELPER_LOG)) || "(no helper log found)";
}

async function createCaptions() {
  const project = await activeProject();
  const seq = need((await project.getActiveSequence()) || state.sequence, "Open the test sequence first");
  const before = await seq.getCaptionTrackCount();
  log(`Caption tracks before: ${before}`);
  await startHelper("captions");
  log("Helper started, waiting up to 90s for captions...");
  let after = before;
  for (let i = 0; i < 90 && after <= before; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    after = await seq.getCaptionTrackCount();
  }
  log("Helper log:\n" + ((await readTextFile(HELPER_LOG)) || "(no helper log found)"));
  log(`Caption tracks after: ${after}`);
  if (after <= before) throw new Error("No caption track appeared");
  return "caption track created";
}

async function fixCaptionWords() {
  await activeProject();
  const terms = aholeTerms(need(state.transcript, "Run step 2 first"));
  if (!terms.length) return "nothing to fix";
  // Only search spellings that are really there: "Replace all" closes the Replace row, but a search with
  // no results would leave it open and throw off the next word.
  log(`Asking the helper to replace ${terms.join(", ")} with A-Hole in the Captions tab...`);
  await writeTextFile(TERMS_FILE, terms.join(","));
  await startHelper("ahole");
  const helperLog = await waitForHelper(90);
  log("Helper log:\n" + helperLog);
  if (/ERROR/.test(helperLog) || !/RESULT: replaced/.test(helperLog)) throw new Error("The helper did not finish the replacements (see log)");
  return "done - check the captions";
}

async function testExport() {
  const project = await activeProject();
  const seq = need((await project.getActiveSequence()) || state.sequence, "Open the test sequence first");
  log("Pick your saved export preset (.epr file)");
  const preset = need(await fs.getFileForOpening({ types: ["epr"] }), "No preset picked");
  log("Pick a folder for the test export");
  const folder = need(await fs.getFolder(), "No folder picked");
  await exportTo(seq, folder.nativePath + "/AITA-test.mp4", preset.nativePath);
  return "exported AITA-test.mp4";
}

// Export the whole sequence, or (whole = false) only between its in and out points.
async function exportTo(seq, out, presetPath, whole = true) {
  log(`Exporting "${seq.name}" to ${out}`);
  const t0 = Date.now();
  const ok = await ppro.EncoderManager.getManager().exportSequence(seq, ppro.Constants.ExportType.IMMEDIATELY, out, presetPath, whole);
  log(`  export finished (${ok}) after ${Math.round((Date.now() - t0) / 1000)}s`);
  if (!ok) throw new Error("Premiere reported the export failed");
}


// ------------------------------------------------------------------ Stage 2: title, arrow, clips

// The story title from title.txt in the date folder (first line that isn't empty).
async function readTitle(folderPath) {
  const text = await readTextFile(folderPath + "/" + TITLE_FILE);
  const title = (text || "").split(/\r?\n/).map((l) => l.trim()).find((l) => l);
  if (!title) throw new Error(`No story title: put a ${TITLE_FILE} with the title in ${folderPath}`);
  return title;
}

// The helper draws the title pictures (one per label) and the arrow, and copies the voiceover for loudness.
async function makeOverlays(folderName, title, labels, voPath) {
  const outDir = OVERLAY_DIR + "/" + folderName;
  const color = arrowColor(folderName);
  await writeTextFile(OVERLAY_JOB, JSON.stringify({ outDir, title, labels, color }));
  await writeTextFile(VO_PATH_FILE, voPath);
  log(`  drawing the title and arrow (arrow colour: hue ${color.hue})...`);
  await startHelper("overlays");
  const helperLog = await waitForHelper(90);
  log("Helper log:\n" + helperLog);
  if (!/RESULT: ok/.test(helperLog)) throw new Error("The helper could not draw the title and arrow (see log)");
  return outDir;
}

// Loudness of the voiceover on the sequence's clock (null if the helper couldn't copy it).
async function readLoudness(cutSeconds) {
  try {
    const entry = await fs.getEntryWithUrl("file:" + VO_WAV);
    const loud = loudnessFromWav(await entry.read({ format: uxp.storage.formats.binary }));
    if (loud) loud.offset = cutSeconds;
    return loud;
  } catch (err) {
    log(`  no loudness info (${err.message || err}); using the transcript's pauses only`);
    return null;
  }
}

async function itemsOn(seq, trackIndex) {
  const track = await seq.getVideoTrack(trackIndex);
  return track ? track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false) : [];
}

// Put a picture on a video track from `start` to `end` (seconds), over whatever is there.
async function placePicture(project, seq, path, trackIndex, start, end) {
  const clip = await importPath(project, path);
  try {
    // a still's length on the timeline comes from its in/out points
    transaction(project, "VidAuto: picture length", () => [clip.createSetInOutPointsAction(tickTimeAt(0), tickTimeAt(end - start))]);
  } catch (err) {
    log(`  setting the picture's length first: ${err.message || err}`);
  }
  const editor = ppro.SequenceEditor.getEditor(seq);
  transaction(project, "VidAuto: add picture", () => [
    editor.createOverwriteItemAction(ppro.ProjectItem.cast(clip), tickTimeAt(start), trackIndex, 0),
  ]);
  let item = null;
  for (const it of await itemsOn(seq, trackIndex)) {
    if (Math.abs(secondsOf(await it.getStartTime()) - start) < 0.1) item = it;
  }
  need(item, `The picture did not land on V${trackIndex + 1} at ${formatTime(start)}`);
  let placedEnd = secondsOf(await item.getEndTime());
  if (Math.abs(placedEnd - end) > 0.1) {
    transaction(project, "VidAuto: picture end", () => [item.createSetEndAction(tickTimeAt(end))]);
    placedEnd = secondsOf(await item.getEndTime());
  }
  log(`  V${trackIndex + 1}: ${path.split("/").pop()} ${start.toFixed(2)}s to ${placedEnd.toFixed(2)}s`);
  if (Math.abs(placedEnd - end) > 0.2) throw new Error(`The picture on V${trackIndex + 1} ends at ${placedEnd}s instead of ${end}s`);
  return item;
}

// Take everything off a video track (switch it off if Premiere won't remove it).
async function clearTrack(project, seq, trackIndex) {
  const items = await itemsOn(seq, trackIndex);
  if (!items.length) return;
  try {
    let selection = null;
    ppro.TrackItemSelection.createEmptySelection((sel) => {
      selection = sel;
    });
    need(selection, "no selection");
    items.forEach((it) => selection.addItem(it, true));
    const editor = ppro.SequenceEditor.getEditor(seq);
    transaction(project, "VidAuto: clear track", () => [
      editor.createRemoveItemsAction(selection, false, ppro.Constants.MediaType.VIDEO),
    ]);
  } catch (err) {
    log(`  couldn't remove V${trackIndex + 1}'s pictures (${err.message || err}); switching them off instead`);
    transaction(project, "VidAuto: pictures off", () => items.map((it) => it.createSetDisabledAction(true)));
  }
}

// Where the clips go, from the transcript's pauses and the voiceover's quiet spots.
function clipCuts(total, transcript, cutSeconds, loud) {
  const words = sequenceWords(transcript, cutSeconds);
  const cuts = planClips(total, cutCandidates(words, loud));
  cuts.slice(1).forEach((end, i) => {
    const before = words.filter((w) => w.end <= end + 0.05).slice(-6).map((w) => w.text).join(" ");
    log(`  Part ${i + 1}: ${formatTime(cuts[i])} to ${formatTime(end)} (${(end - cuts[i]).toFixed(1)}s), ends "...${before}"`);
  });
  return cuts;
}

// Title and arrows, full video export, then each clip. `folderPath` is where the videos go.
async function titleArrowAndClips(project, seq, folderPath, title, voPath, total) {
  const folderName = folderPath.split("/").pop();
  const trackCount = await seq.getVideoTrackCount();
  log(`  sequence has ${trackCount} video track(s)`);
  // one title picture per possible clip; how many are used depends on where the pauses fall
  const most = Math.ceil(total / MIN_CLIP) + 1;
  const labels = ["Full Video", ...Array.from({ length: most }, (_, i) => `Part ${i + 1}`)];
  const dir = await makeOverlays(folderName, title, labels, voPath);
  const loud = await readLoudness(state.cut.seconds);
  if (loud) log(`  loudness read (${loud.rms.length} steps)`);
  const cuts = clipCuts(total, state.transcript, state.cut.seconds, loud);

  // Full video: title the whole way, arrow at 1/5, 2/5, 3/5 and 4/5
  await placePicture(project, seq, `${dir}/title-1.png`, TITLE_TRACK, 0, total);
  for (const t of fullArrowTimes(total)) {
    await placePicture(project, seq, `${dir}/arrow.png`, ARROW_TRACK, t, Math.min(total, t + ARROW_SECONDS));
  }
  const fullName = outputName(title, "Full Video");
  await exportTo(seq, `${folderPath}/${fullName}`, EXPORT_PRESET, true);

  // Clips: "(Part N)" titles, arrow 5 seconds into each
  await clearTrack(project, seq, ARROW_TRACK);
  await clearTrack(project, seq, TITLE_TRACK);
  const parts = cuts.length - 1;
  for (let k = 0; k < parts; k++) {
    await placePicture(project, seq, `${dir}/title-${k + 2}.png`, TITLE_TRACK, cuts[k], cuts[k + 1]);
    const at = cuts[k] + CLIP_ARROW_AT;
    if (at + ARROW_SECONDS < cuts[k + 1]) {
      await placePicture(project, seq, `${dir}/arrow.png`, ARROW_TRACK, at, at + ARROW_SECONDS);
    }
  }
  for (let k = 0; k < parts; k++) {
    transaction(project, "VidAuto: clip in/out", () => [
      seq.createSetInPointAction(tickTimeAt(cuts[k])),
      seq.createSetOutPointAction(tickTimeAt(cuts[k + 1])),
    ]);
    log(`  in/out now ${secondsOf(await seq.getInPoint())}s to ${secondsOf(await seq.getOutPoint())}s`);
    await exportTo(seq, `${folderPath}/${outputName(title, `Part ${k + 1}`)}`, EXPORT_PRESET, false);
  }
  return { fullName, parts };
}

// Test step: title, arrow and clips for the sequence made in steps 1-4 (captions optional).
async function testTitleAndClips() {
  const project = await activeProject();
  const seq = need(state.sequence, "Run steps 1-4 first");
  need(state.transcript && state.cut, "Run steps 2-3 first");
  log("Pick a folder with a title.txt in it; the test videos are saved there");
  const folder = need(await fs.getFolder(), "No folder picked");
  const title = await readTitle(folder.nativePath);
  const total = need(await audioItemInfo(seq), "The voiceover is missing from the sequence").end;
  const done = await titleArrowAndClips(project, seq, folder.nativePath, title, await state.clip.getMediaFilePath(), total);
  return `${done.fullName} + ${done.parts} clip(s)`;
}

// ------------------------------------------------------------------ full run

async function loadUsage() {
  try {
    return JSON.parse((await readTextFile(USAGE_FILE)) || "{}");
  } catch (e) {
    log(`  could not read ${USAGE_FILE}, starting fresh: ${e.message}`);
    return {};
  }
}

async function saveUsage(usage) {
  await writeTextFile(USAGE_FILE, JSON.stringify(usage, null, 2));
}

async function sourceVideos() {
  const entries = await listFolder(SOURCE_DIR);
  const videos = [];
  for (const e of entries) {
    if (!e.isFile || !/\.(mp4|mov|m4v|mkv|webm)$/i.test(e.name)) continue;
    let created = 0;
    let size = null;
    try {
      const meta = await e.getMetadata();
      created = new Date(meta.dateCreated || meta.dateModified || 0).getTime();
      size = meta.size !== undefined ? Number(meta.size) : null;
    } catch (err) {
      // fall back to name order
    }
    videos.push({ name: e.name, created, size, path: e.nativePath });
  }
  return videos;
}

// Your Premiere can't report a clip's length or size directly, so make a throwaway sequence from the
// whole video and read them off it; if that doesn't work, read Premiere's Project panel columns.
async function measureVideo(project, vclip) {
  try {
    transaction(project, "VidAuto: clear video in/out", () => [vclip.createClearInOutPointsAction()]);
  } catch (err) {
    log(`  clearing the video's in/out: ${err.message || err}`);
  }
  let duration = null;
  let size = null;
  let sawPicture = false;
  try {
    const tmp = need(await project.createSequenceFromMedia("VidAuto measuring", [vclip]), "no sequence");
    for (let attempt = 1; attempt <= 5 && !sawPicture; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      for (const [kind, getTrack] of [["V1", () => tmp.getVideoTrack(0)], ["A1", () => tmp.getAudioTrack(0)]]) {
        const track = await getTrack();
        const items = track ? track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false) : [];
        const endTime = items.length ? await items[0].getEndTime() : null;
        const end = secondsOf(endTime);
        log(`  measuring (try ${attempt}): ${kind} has ${items.length} clip(s), end ${end}s` +
          (endTime ? ` (ticks ${endTime.ticks}, seconds value ${endTime.seconds})` : ""));
        if (kind === "V1" && end > 0) {
          sawPicture = true;
          duration = end;
        }
        if (kind === "A1" && end > 0 && !duration) duration = end;
      }
    }
    // The sequence only takes the video's size if the picture actually came in.
    const fs_ = await tmp.getFrameSize();
    if (sawPicture && fs_ && fs_.width > 0) size = { width: fs_.width, height: fs_.height };
    await project.deleteSequence(tmp);
  } catch (err) {
    log(`  measuring with a sequence: ${err.message || err}`);
  }
  let cols = "";
  try {
    cols = String(await ppro.Metadata.getProjectColumnsMetadata(ppro.ProjectItem.cast(vclip)));
    log(`  Project panel columns: ${cols.slice(0, 800)}`);
  } catch (err) {
    log(`  reading the Project panel columns: ${err.message || err}`);
  }
  if (!size) {
    const vi = cols.match(/Video Info[^0-9]*([0-9][^"]*)/);
    if (vi) size = videoSizeFrom(vi[1]);
  }
  const tc = cols.match(/Media Duration[^0-9]*(\d+[:;]\d+[:;]\d+[:;]\d+)/);
  const columnDuration = tc ? timecodeToSeconds(tc[1]) : null;
  if (columnDuration) log(`  Media Duration column: ${tc[1]} (${formatTime(columnDuration)})`);
  if (columnDuration && (!duration || Math.abs(columnDuration - duration) / columnDuration > 0.02)) {
    if (duration) log(`  WARNING: sequence said ${formatTime(duration)}, column says ${formatTime(columnDuration)}; using the column`);
    duration = columnDuration;
  }
  if (!sawPicture && !size) {
    throw new Error(`Premiere only sees sound in ${vclip.name}, no picture. It's probably in a format Premiere can't read ` +
      "(YouTube downloads are often AV1 or VP9). Download it as H.264 MP4, or convert it, and try again.");
  }
  need(duration, "Could not read the video's length (see log)");
  need(size, "Could not read the video's size (see log)");
  log(`  measured ${vclip.name}: ${formatTime(duration)}, ${size.width}x${size.height}`);
  return { duration, width: size.width, height: size.height, measured: 3 };
}

// Take the source video's own sound off the timeline (A2), so it's silent and can't end up in the
// captions. If Premiere won't remove it, mute A2 and switch its clips off instead.
async function removeVideoSound(project, seq) {
  const a2 = await seq.getAudioTrack(1);
  if (!a2) return;
  const items = a2.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  if (!items.length) return;
  try {
    let selection = null;
    ppro.TrackItemSelection.createEmptySelection((sel) => {
      selection = sel;
    });
    need(selection, "no selection");
    items.forEach((it) => selection.addItem(it, true));
    const editor = ppro.SequenceEditor.getEditor(seq);
    transaction(project, "VidAuto: remove video sound", () => [
      editor.createRemoveItemsAction(selection, false, ppro.Constants.MediaType.AUDIO),
    ]);
    log("  removed the video's own sound");
  } catch (err) {
    log(`  couldn't remove the video's sound (${err.message || err}); muting it instead`);
    await a2.setMute(true);
    transaction(project, "VidAuto: video sound off", () => items.map((it) => it.createSetDisabledAction(true)));
  }
}

async function setScale(project, item, percent) {
  const chain = await item.getComponentChain();
  let scale = null;
  for (let i = 0; i < chain.getComponentCount() && !scale; i++) {
    const comp = chain.getComponentAtIndex(i);
    if (!/motion/i.test(await comp.getMatchName())) continue;
    for (let j = 0; j < comp.getParamCount(); j++) {
      const p = comp.getParam(j);
      if (p.displayName === "Scale") scale = p;
    }
  }
  need(scale, "Could not find the video's Scale setting");
  transaction(project, "VidAuto: scale not animated", () => [scale.createSetTimeVaryingAction(false)]);
  const key = scale.createKeyframe(percent);
  transaction(project, "VidAuto: fill frame", () => [scale.createSetValueAction(key, true)]);
}

// A copy of the source video made with the Mac's own converter (standard 8-bit H.264, same size), which
// Premiere plays and exports quickly whatever the download's encoding. Made once per source video
// (a few minutes for 20 minutes of 4K) and reused. If converting fails, the original is used.
async function editablePath(v) {
  if (v.editPath) return v.editPath;
  const base = v.name.replace(/\.[^.]+$/, "");
  const out = `${CONVERTED_DIR}/${base} (${v.size || 0}).mp4`;
  if (await exists(out)) {
    v.editPath = out;
    return out;
  }
  log(`  converting ${v.name} into a Premiere-friendly copy (once per video; a few minutes)...`);
  const status = document.getElementById("runStatus");
  await writeTextFile(CONVERT_JOB, `${v.path}\n${out}\n`);
  await writeTextFile(CONVERT_PROGRESS, "\n");
  await startHelper("convert");
  const t0 = Date.now();
  let helperLog = "";
  let lastShown = 0;
  while (Date.now() - t0 < 3 * 3600 * 1000) {
    await new Promise((r) => setTimeout(r, 5000));
    helperLog = (await readTextFile(HELPER_LOG)) || "";
    if (/RESULT|ERROR/.test(helperLog)) break;
    if (Date.now() - lastShown > 30000) {
      lastShown = Date.now();
      const tail = ((await readTextFile(CONVERT_PROGRESS)) || "").trim().split(/[\r\n]+/).pop() || "";
      const pct = tail.match(/(\d+(?:\.\d+)?)\s*%/);
      const shown = pct ? `${Math.round(Number(pct[1]))}%` : tail.slice(-40);
      log(`  still converting (${Math.round((Date.now() - t0) / 60000)} min)${shown ? ": " + shown : ""}`);
      if (status) status.textContent = `converting ${v.name}${pct ? " " + shown : ""}... keep hands off the mouse`;
    }
  }
  log("Helper log:\n" + helperLog);
  if (/RESULT: converted/.test(helperLog) && (await exists(out))) {
    log(`  converted in ${Math.round((Date.now() - t0) / 1000)}s: ${out}`);
    v.editPath = out;
    return out;
  }
  log(`  WARNING: couldn't convert ${v.name}; using the original (exports may be slow)`);
  v.editPath = v.path;
  return v.path;
}

// Put the next unused part of the source video on V1: muted, filling the 1080x1920 frame, same length
// as the voiceover. Returns what was used so the usage record can be updated after export.
async function addVideo(project, seq, needed, usage) {
  const videos = await sourceVideos();
  if (!videos.length) throw new Error(`No videos in ${SOURCE_DIR}`);
  // measurements from before 0.3.3 could be wrong (sound-only, or 60x too short), so measure again.
  // A file replaced by a different video under the same name (its size changed) is a new video:
  // measure it again and start from 0:00. Videos measured before sizes were kept are measured once more.
  const changed = new Set();
  for (const v of videos) {
    const u = usage[v.name];
    if (!u) continue;
    const replaced = u.fileSize !== undefined && v.size !== null && u.fileSize !== v.size;
    if (replaced) {
      log(`  ${v.name} is a different file than before (size changed): measuring it again, starting at 0:00`);
      u.usedUpTo = 0;
    }
    if (u.duration !== undefined && (u.measured !== 3 || replaced || (u.fileSize === undefined && v.size !== null))) {
      delete u.duration;
      delete u.exhausted;
      changed.add(v.name);
    }
  }
  let pick = chooseSource(videos, usage, needed);
  while (pick.needsMeasuring) {
    const v = videos.find((x) => x.name === pick.name);
    const vclip = await importPath(project, await editablePath(v));
    if (changed.has(v.name)) {
      // Premiere may still describe the old file that had this name
      try {
        await vclip.refreshMedia();
      } catch (err) {
        log(`  refreshing ${v.name} in Premiere: ${err.message || err}`);
      }
    }
    usage[v.name] = { ...(usage[v.name] || {}), ...(await measureVideo(project, vclip)), fileSize: v.size === null ? undefined : v.size };
    await saveUsage(usage);
    pick = chooseSource(videos, usage, needed);
  }
  for (const s of pick.skipped || []) {
    usage[s.name].exhausted = true; // too little left for this voiceover: move on for good
    log(`  ${s.name} has only ${formatTime(s.left)} left, moving to the next video`);
  }
  if (pick.skipped && pick.skipped.length) await saveUsage(usage);
  if (pick.error) throw new Error(pick.error);

  const v = videos.find((x) => x.name === pick.name);
  const vclip = await importPath(project, await editablePath(v));
  const info = usage[v.name];
  log(`  video: ${v.name} from ${formatTime(pick.start)} to ${formatTime(pick.start + needed)}`);
  transaction(project, "VidAuto: video in/out", () => [
    vclip.createSetInOutPointsAction(tickTimeAt(pick.start), tickTimeAt(pick.start + needed)),
  ]);
  await placeOnV1(project, seq, vclip);

  const vItems = (await seq.getVideoTrack(0)).getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  const vItem = need(vItems[0], "The video did not land on V1");
  log(`  V1: ${secondsOf(await vItem.getStartTime())}s to ${secondsOf(await vItem.getEndTime())}s`);

  await removeVideoSound(project, seq);

  const scale = fillScale(info.width, info.height);
  await setScale(project, vItem, scale);
  log(`  scaled to ${scale}% to fill the frame`);
  return { name: v.name, start: pick.start, end: pick.start + needed, remainingAfter: pick.remainingAfter };
}

// Video on V1, its own sound on A2 (the voiceover stays on A1). Adobe's sample passes a plain
// ProjectItem, and Premiere 26.0.2 rejected a ClipProjectItem, so try the forms it may accept.
async function placeOnV1(project, seq, vclip) {
  const editor = ppro.SequenceEditor.getEditor(seq);
  const asProjectItem = ppro.ProjectItem.cast(vclip);
  const zero = ppro.TickTime.TIME_ZERO;
  const ways = [
    ["overwrite (project item)", () => editor.createOverwriteItemAction(asProjectItem, zero, 0, 1)],
    ["overwrite (clip)", () => editor.createOverwriteItemAction(vclip, zero, 0, 1)],
    ["insert (project item)", () => editor.createInsertProjectItemAction(asProjectItem, zero, 0, 1, true)],
  ];
  for (const [name, make] of ways) {
    try {
      transaction(project, "VidAuto: add video", () => [make()]);
      const items = (await seq.getVideoTrack(0)).getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
      log(`  ${name}: worked, V1 has ${items.length} clip(s)`);
      if (items.length) return;
    } catch (err) {
      log(`  ${name}: ${err.message || err}`);
    }
  }
  throw new Error("Could not put the video on V1 (see log)");
}

async function makeVideo(project, folderPath, voiceoverName, usage) {
  const vo = folderPath + "/" + voiceoverName;
  const title = await readTitle(folderPath); // check first, before any work
  log(`  title: ${title}`);
  state.clip = await importPath(project, vo);
  log(`  voiceover: ${voiceoverName}`);
  state.transcript = await getTranscript(state.clip);
  // Premiere may still be writing the transcript: wait until it has the phrase and stops growing.
  let words = flattenWords(state.transcript).length;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const again = await getTranscript(state.clip, 30);
    const n = flattenWords(again).length;
    state.transcript = again;
    if (n === words && n > 0 && findCutPoint(again)) break;
    log(`  transcript still growing (${n} words)...`);
    words = n;
  }
  await dropTranscribeSequence(project);
  state.cut = need(findCutPoint(state.transcript), '"Am I the ahole" (any spelling) not found in the voiceover');
  log(`  cut at ${state.cut.seconds.toFixed(2)}s -> starts "${state.cut.after}..."`);

  await makeSequence(project, state.clip, state.cut, folderPath.split("/").pop());
  const seq = state.sequence;
  const needed = need(await audioItemInfo(seq), "The voiceover is missing from the sequence").end;
  log(`  voiceover length ${formatTime(needed)}`);

  const used = await addVideo(project, seq, needed, usage);
  await project.setActiveSequence(seq);
  await project.openSequence(seq);

  await createCaptions();
  await fixCaptionWords();
  // the footage counts as used once the full video is being made
  usage[used.name] = { ...usage[used.name], usedUpTo: used.end };
  await saveUsage(usage);
  const done = await titleArrowAndClips(project, seq, folderPath, title, vo, needed);
  return { ...used, ...done };
}

async function runAll() {
  const status = document.getElementById("runStatus");
  const button = document.getElementById("run");
  button.setAttribute("disabled", "");
  status.className = "status";
  status.textContent = "working... keep hands off the mouse";
  log("=== Run");
  try {
    const project = await activeProject();
    log(`Project: ${project.name}`);
    for (const [path, what] of [[CLIPS_DIR, "date folders"], [SOURCE_DIR, "source videos"], [EXPORT_PRESET, "export preset"]]) {
      if (!(await exists(path))) throw new Error(`Can't find the ${what}: ${path}`);
    }
    const folders = [];
    for (const e of await listFolder(CLIPS_DIR)) {
      if (e.isFolder) folders.push({ name: e.name, files: (await e.getEntries()).map((f) => f.name) });
    }
    const todo = foldersToDo(folders);
    if (!todo.length) {
      status.className = "status ok";
      status.textContent = "Nothing to do: every date folder with a voiceover already has its full video";
      log(status.textContent);
      return;
    }
    log(`To do: ${todo.map((f) => f.name).join(", ")}`);
    const usage = await loadUsage();
    let last = null;
    for (const [i, f] of todo.entries()) {
      log(`--- ${f.name} (${i + 1} of ${todo.length})`);
      status.textContent = `working on ${f.name} (${i + 1} of ${todo.length})... keep hands off the mouse`;
      last = await makeVideo(project, CLIPS_DIR + "/" + f.name, f.voiceover, usage);
      log(`  done: ${f.name}: ${last.fullName} and ${last.parts} clip(s). ${last.name} has ${formatTime(last.remainingAfter)} left`);
    }
    status.className = "status ok";
    status.textContent = `Done: ${todo.length} video(s). ${last.name} has ${formatTime(last.remainingAfter)} of footage left.`;
    log(status.textContent);
    await showSourceStatus();
  } catch (err) {
    status.className = "status fail";
    status.textContent = "STOPPED: " + (err.message || err);
    log("STOPPED: " + (err.message || err));
    if (err.stack) log(err.stack);
  } finally {
    button.removeAttribute("disabled");
  }
}

// Shows the current source video and lets you set where it's used up to (e.g. 00;07;45;01).
async function showSourceStatus() {
  const el = document.getElementById("sourceStatus");
  try {
    const videos = (await sourceVideos()).sort((a, b) => a.created - b.created || a.name.localeCompare(b.name));
    const usage = await loadUsage();
    let current = videos.find((v) => !(usage[v.name] || {}).exhausted);
    if (!current && videos.length) {
      // everything is marked used up: still show the newest so its start can be reset
      current = videos[videos.length - 1];
      el.textContent = `Source video: ${current.name} is marked used up. Set a start below to reuse it, or add a new video.`;
      state.currentSource = current.name;
      return;
    }
    if (!current) {
      el.textContent = "No usable source video. Download one into Source Video.";
      return;
    }
    const u = usage[current.name] || {};
    const left = u.duration !== undefined ? ` (${formatTime(u.duration - (u.usedUpTo || 0))} left)` : "";
    el.textContent = `Source video: ${current.name}, used up to ${formatTime(u.usedUpTo || 0)}${left}`;
    state.currentSource = current.name;
  } catch (err) {
    el.textContent = `Source video: can't read ${SOURCE_DIR} (${err.message || err})`;
  }
}

async function setUsedUpTo() {
  const tc = document.getElementById("usedUpTo").value;
  const seconds = timecodeToSeconds(tc);
  if (!state.currentSource) {
    log(`Couldn't set the start: no source video found in ${SOURCE_DIR}`);
    return;
  }
  if (seconds === null) {
    log(`Couldn't read "${tc}" as a timecode. Type it like 00;07;45;01 or 7:45:01`);
    return;
  }
  const usage = await loadUsage();
  usage[state.currentSource] = { ...(usage[state.currentSource] || {}), usedUpTo: seconds };
  delete usage[state.currentSource].exhausted; // setting a start means "use this video again from here"
  await saveUsage(usage);
  log(`${state.currentSource}: next video starts at ${tc} (${formatTime(seconds)})`);
  await showSourceStatus();
}

// ------------------------------------------------------------------ wiring

const STEPS = [
  ["Check setup", checkSetup],
  ["Import voiceover", importVoiceover],
  ["Transcribe", transcribe],
  ["Find cut point", findCut],
  ["Build sequence", buildSequence],
  ["Create captions", createCaptions],
  ["Fix A-Hole in captions", fixCaptionWords],
  ["Test export", testExport],
  ["Title, arrow & clips", testTitleAndClips],
];

STEPS.forEach(([name, fn], n) => {
  document.getElementById("b" + n).addEventListener("click", () => step(n, name, fn));
});

document.getElementById("run").addEventListener("click", runAll);
document.getElementById("setUsed").addEventListener("click", setUsedUpTo);
showSourceStatus();

document.getElementById("copy").addEventListener("click", async () => {
  await navigator.clipboard.setContent({ "text/plain": document.getElementById("log").textContent });
  log("(log copied to clipboard)");
});
