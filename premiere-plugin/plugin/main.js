// VidAuto test panel: runs each automation step on its own so we can see which ones Premiere allows.

const ppro = require("premierepro");
const uxp = require("uxp");
const fs = uxp.storage.localFileSystem;
const { findCutPoint, flattenWords } = require("./lib/transcript.js");

const HELPER_DIR = "/Users/Shared/VidAuto";
const HELPER_APP = HELPER_DIR + "/VidAuto Caption Helper.app";
const HELPER_LOG = HELPER_DIR + "/helper-log.txt";
const TICKS_PER_SECOND = 254016000000;
const PLUGIN_VERSION = "0.2.0";

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
  return tickTime ? Math.round(tickTime.seconds * 1000) / 1000 : null;
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

async function clearHelperLog() {
  try {
    const entry = await fs.getEntryWithUrl("file:" + HELPER_LOG);
    await entry.write("");
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
  let clip = await findClipByPath(project, path);
  if (clip) {
    log("Already in the project, reusing it.");
  } else {
    const ok = await project.importFiles([path], true, null, false);
    if (!ok) throw new Error("Premiere refused to import the file");
    clip = need(await findClipByPath(project, path), "Imported, but could not find it in the project");
  }
  state.clip = clip;
  state.transcript = state.cut = null;
  return clip.name;
}

async function transcribe() {
  const clip = need(state.clip, "Run step 1 first");
  let json = null;
  try {
    json = await ppro.Transcript.exportToJSON(clip);
  } catch (e) {
    json = null;
  }
  if (json && json.includes("segments")) {
    log("Clip already has a transcript, using it.");
  } else {
    log("Starting Premiere transcription (can take a minute or two)...");
    const t0 = Date.now();
    const ok = await ppro.Transcript.transcribeClipProjectItem(clip);
    log(`transcribeClipProjectItem returned ${ok} after ${Math.round((Date.now() - t0) / 1000)}s`);
    if (!ok) throw new Error("Premiere reported the transcription failed");
    json = await ppro.Transcript.exportToJSON(clip);
  }
  need(json, "Transcript came back empty");
  state.transcript = JSON.parse(json);
  const saved = await saveToDataFolder("transcript-original.json", json);
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
  const clip = need(state.clip, "Run step 1 first");
  const cut = need(state.cut, "Run step 3 first");

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

  const name = "VidAuto test " + new Date().toLocaleTimeString();
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
  log("Asking the helper to replace ahole / a-hole / asshole with A-Hole in the Captions tab...");
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
  const out = folder.nativePath + "/AITA-test.mp4";
  log(`Exporting "${seq.name}" to ${out} with ${preset.nativePath}`);
  const t0 = Date.now();
  const ok = await ppro.EncoderManager.getManager().exportSequence(
    seq, ppro.Constants.ExportType.IMMEDIATELY, out, preset.nativePath
  );
  log(`exportSequence returned ${ok} after ${Math.round((Date.now() - t0) / 1000)}s`);
  if (!ok) throw new Error("Premiere reported the export failed");
  return "exported AITA-test.mp4";
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
];

STEPS.forEach(([name, fn], n) => {
  document.getElementById("b" + n).addEventListener("click", () => step(n, name, fn));
});

document.getElementById("copy").addEventListener("click", async () => {
  await navigator.clipboard.setContent({ "text/plain": document.getElementById("log").textContent });
  log("(log copied to clipboard)");
});
