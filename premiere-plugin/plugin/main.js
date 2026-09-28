// VidAuto test panel: runs each automation step on its own so we can see which ones Premiere allows.

const ppro = require("premierepro");
const uxp = require("uxp");
const fs = uxp.storage.localFileSystem;
const { findCutPoint, fixAHole, flattenWords } = require("./lib/transcript.js");

const HELPER_DIR = "/Users/Shared/VidAuto";
const HELPER_APP = HELPER_DIR + "/VidAuto Caption Helper.app";
const HELPER_LOG = HELPER_DIR + "/helper-log.txt";
const TICKS_PER_SECOND = 254016000000;
const PLUGIN_VERSION = "0.1.5";

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

function describe(value) {
  if (value === null || value === undefined) return String(value);
  const name = value.constructor && value.constructor.name;
  return `${typeof value}${name ? " " + name : ""}`;
}

// Premiere versions differ in how a transcript is turned back into TextSegments, so try each known way
// and log exactly which part fails.
async function importTranscript(project, clip, json) {
  log(`clip is ${describe(clip)}; Transcript.importFromJSON: ${typeof ppro.Transcript.importFromJSON}; ` +
      `TextSegments.importFromJSON: ${typeof (ppro.TextSegments && ppro.TextSegments.importFromJSON)}`);
  const attempts = [
    ["Transcript.importFromJSON", async () => ppro.Transcript.importFromJSON(json)],
    ["TextSegments.importFromJSON (callback)", () => new Promise((resolve, reject) => {
      let settled = false;
      const ok = ppro.TextSegments.importFromJSON(json, (segments) => { settled = true; resolve(segments); });
      log(`  TextSegments.importFromJSON returned ${ok}`);
      setTimeout(() => settled || reject(new Error("callback never called")), 5000);
    })],
  ];
  // The clip object from step 1 may be stale, so also try one looked up again by its file path.
  const freshClip = await findClipByPath(project, await clip.getMediaFilePath());
  const clips = [["clip from step 1", clip], ["clip looked up again", freshClip]].filter(([, c]) => c);
  const errors = [];
  for (const [name, make] of attempts) {
    let segments;
    try {
      segments = await make();
      log(`  ${name} gave ${describe(segments)}`);
      if (!segments || typeof segments !== "object") throw new Error(`got ${describe(segments)}`);
    } catch (err) {
      log(`  ${name}: failed while making TextSegments: ${err.message || err}`);
      errors.push(`${name} (making TextSegments)`);
      continue;
    }
    for (const [clipName, target] of clips) {
      try {
        // Like Adobe's sample, create the action inside the locked transaction.
        transaction(project, "VidAuto: fix A-Hole", () => [ppro.Transcript.createImportTextSegmentsAction(segments, target)]);
        log(`  ${name} + ${clipName}: worked`);
        return;
      } catch (err) {
        log(`  ${name} + ${clipName}: failed: ${err.message || err}`);
        errors.push(`${name} + ${clipName}`);
      }
    }
  }
  throw new Error("Could not put the fixed transcript back: " + errors.join("; "));
}

async function readTranscriptBack(project, clip) {
  const path = await clip.getMediaFilePath();
  for (let i = 1; i <= 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    for (const [name, target] of [["clip from step 1", clip], ["clip looked up again", await findClipByPath(project, path)]]) {
      if (!target) continue;
      try {
        const json = await ppro.Transcript.exportToJSON(target);
        if (json && json.includes("segments")) {
          log(`  read back after ${i}s using ${name}`);
          return JSON.parse(json);
        }
        log(`  read-back ${i}s (${name}): got ${describe(json)}`);
      } catch (err) {
        log(`  read-back ${i}s (${name}): ${err.message || err}`);
      }
    }
  }
  log("  Could not read the transcript back after 10s.");
  return null;
}

async function fixTranscript() {
  const project = await activeProject();
  const clip = need(state.clip, "Run step 1 first");
  const { transcript, changes } = fixAHole(need(state.transcript, "Run step 2 first"));
  changes.forEach((c) => log(`  ${c.seconds}s: "${c.from}" -> "${c.to}"`));
  if (!changes.length) return "nothing to change";
  const json = JSON.stringify(transcript);
  await saveToDataFolder("transcript-fixed.json", json);
  await importTranscript(project, clip, json);
  // Read it back to prove Premiere kept the change. Premiere may still be applying the import, so retry.
  const back = await readTranscriptBack(project, clip);
  if (!back) {
    state.transcript = transcript;
    return `${changes.length} fixed (Premiere accepted it; check the Transcript panel to confirm)`;
  }
  const count = flattenWords(back).filter((w) => w.text.includes("A-Hole")).length;
  log(`Transcript in Premiere now contains "A-Hole" ${count} time(s)`);
  state.transcript = back;
  if (!count) throw new Error("Premiere accepted the change but the transcript still has no A-Hole");
  return `${changes.length} fixed`;
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

async function createCaptions() {
  const project = await activeProject();
  const seq = need((await project.getActiveSequence()) || state.sequence, "Open the test sequence first");
  const before = await seq.getCaptionTrackCount();
  log(`Caption tracks before: ${before}`);
  // Start the helper through its link first; opening the .app file directly failed on Premiere 26.0.2.
  let started = false;
  const ways = [
    ["link vidauto-helper://captions", () => uxp.shell.openExternal("vidauto-helper://captions", "Start the VidAuto helper so it can press Create captions for you")],
    ["opening the app", () => uxp.shell.openPath(HELPER_APP, "Open the VidAuto helper so it can press Create captions for you")],
  ];
  for (const [wayName, start] of ways) {
    try {
      const result = await start();
      if (result === "") {
        log(`  started helper with ${wayName}`);
        started = true;
        break;
      }
      log(`  ${wayName}: ${result}`);
    } catch (err) {
      log(`  ${wayName}: ${err.message || err}`);
    }
  }
  if (!started) throw new Error("Could not start the helper (see log)");
  log("Helper opened, waiting up to 90s for captions...");
  let after = before;
  for (let i = 0; i < 90 && after <= before; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    after = await seq.getCaptionTrackCount();
  }
  const helperLog = await readTextFile(HELPER_LOG);
  log("Helper log:\n" + (helperLog || "(no helper log found)"));
  log(`Caption tracks after: ${after}`);
  if (after <= before) throw new Error("No caption track appeared");
  return "caption track created";
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
  ["Fix A-Hole", fixTranscript],
  ["Build sequence", buildSequence],
  ["Create captions", createCaptions],
  ["Test export", testExport],
];

STEPS.forEach(([name, fn], n) => {
  document.getElementById("b" + n).addEventListener("click", () => step(n, name, fn));
});

document.getElementById("copy").addEventListener("click", async () => {
  await navigator.clipboard.setContent({ "text/plain": document.getElementById("log").textContent });
  log("(log copied to clipboard)");
});
