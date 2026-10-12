    // back to the top of the form (it stays scrolled down from the Tags), then choose the "Schedule" option next
    // to "Share now": the "Schedule" words closest under the "Scheduling options" heading (never the
    // "Schedule" button at the bottom, which would post at whatever time is showing)
    js(id, `(function () {
      for (const e of document.querySelectorAll("div")) if (e.scrollTop > 0) e.scrollTop = 0;
      window.scrollTo(0, 0);
    })()`);
    delay(1);
    let w = fbWhen(id);
    if (w.date === null || w.time === null) {
      const r = js(id, `(function () {
        const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
        const say = (e) => (e.innerText || e.textContent || "").trim();
        const head = [...document.querySelectorAll("span, div, h2, h3")].find((e) => vis(e) && !e.children.length && say(e) === "Scheduling options");
        if (!head) return "no heading";
        const top = head.getBoundingClientRect().top;
        const opts = [...document.querySelectorAll("span, div, label, button, [role]")]
          .filter((e) => vis(e) && say(e) === "Schedule" && ![...e.children].some((c) => say(c) === "Schedule"))
          .map((e) => ({ e, dy: e.getBoundingClientRect().top - top }))
          .filter((o) => o.dy > 0 && o.dy < 250)
          .sort((a, b) => a.dy - b.dy);
        if (!opts.length) return "no option";
        const e = opts[0].e;
        const radio = e.closest("label") && e.closest("label").querySelector('input[type="radio"]');
        (radio || e.closest('[role="radio"], [role="tab"], button, [role="button"], label') || e).click();
        return "clicked";
      })()`);
      if (r !== "clicked") throw new Error(`Couldn't choose the "Schedule" option (${r})${dump(id)}`);
      delay(1.5);
      w = fbWhen(id);
    }
// VidAuto Upload: schedules the finished videos on YouTube (TikTok and Facebook come next).
// Runs on the Mac (JavaScript for Automation). It drives YouTube Studio in your signed-in Chrome; to pick the
// video file it clicks the site's "Select files" button and types the file's location into the Mac's file window,
// so Chrome must stay in front and the mouse and keyboard must be left alone while it runs.
// Run with: osascript -l JavaScript uploads.js <platform> <how many, 0 = all> <folder this file is in>

ObjC.import("Foundation");
ObjC.import("CoreGraphics");
ObjC.import("AppKit"); // the clipboard
const app = Application.currentApplication();
app.includeStandardAdditions = true;

const AITA_DIR = "/Users/drick/Documents/AITA";
const CLIPS_DIR = AITA_DIR + "/New Video Clips";
const SOURCE_DIR = AITA_DIR + "/Source Video";
const UPLOADS_FILE = AITA_DIR + "/vidauto-uploads.json"; // what has been scheduled, so nothing is posted twice
const LOG_FILE = AITA_DIR + "/vidauto-uploads-log.txt";
const YT_CHANNEL = "UCI3S3qXsupSQFBb4Qe2szpg";
const FB_ASSET = "214107491779719"; // your Facebook page in Meta Business Suite
const FB_TAGS = ["aita", "storytime", "redditstoryteller", "RelationshipDrama", "reddit"]; // the reel's Tags box
const FB_PLAYLIST = "Full Videos";
const LIMITS_FILE = AITA_DIR + "/vidauto-upload-limits.json"; // e.g. { "youtube": 15 }: most uploads per day
const DEFAULT_DAILY_LIMIT = { youtube: 10, tiktok: 10, facebook: 10 };

class AfterFilePicked extends Error {} // failed after the file was chosen: that upload already counts
class UploadLimit extends Error {} // YouTube says the daily upload limit is reached
class StopRequested extends Error {} // the panel's Stop button
const STOP_FILE = "/Users/Shared/VidAuto/stop.txt";
function checkStop() {
  if (exists(STOP_FILE)) throw new StopRequested("Stopped by you");
}
const LIMIT_TEXT = /daily upload limit|upload limit (reached|exceeded)|reached (your|the) (daily )?(upload )?limit|can.t upload more videos/i;
const DEFAULT_PAUSE_MINUTES = 1; // short wait between folders

let U = null; // upload-rules.js
const chrome = Application("Google Chrome");
const keys = Application("System Events");

// ------------------------------------------------------------------ small helpers

function readText(path) {
  const s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  return s.isNil() ? null : ObjC.unwrap(s);
}

function writeText(path, text) {
  $.NSString.alloc.initWithUTF8String(text).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
}

function exists(path) {
  return $.NSFileManager.defaultManager.fileExistsAtPath(path);
}

function listDir(path) {
  return ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(path, null)) || [];
}

function q(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function sh(cmd) {
  return app.doShellScript(cmd);
}

function log(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  console.log(line);
  try {
    sh(`echo ${q(line)} >> ${q(LOG_FILE)}`);
  } catch (e) {
    // the log file is only a copy
  }
}

// ------------------------------------------------------------------ Chrome

function findTab(id) {
  for (const w of chrome.windows()) {
    const tabs = w.tabs();
    for (let i = 0; i < tabs.length; i++) {
      if (tabs[i].id() === id) return { w, t: tabs[i], index: i + 1 };
    }
  }
  throw new Error("The Chrome tab was closed");
}

function waitLoaded(id, seconds = 60) {
  const end = Date.now() + seconds * 1000;
  delay(1);
  while (Date.now() < end && findTab(id).t.loading()) delay(0.5);
  delay(1);
}

function openTab(url) {
  if (!chrome.windows().length) chrome.Window().make();
  const w = chrome.windows[0];
  w.tabs.push(chrome.Tab({ url }));
  const t = w.tabs[w.tabs.length - 1];
  const id = t.id();
  w.activeTabIndex = w.tabs.length;
  waitLoaded(id);
  return id;
}

function front(id) {
  const { w, index } = findTab(id);
  w.activeTabIndex = index;
  w.index = 1;
  chrome.activate();
  delay(0.6);
}

function closeTab(id) {
  try {
    findTab(id).t.close();
  } catch (e) {
    // already closed
  }
}

function js(id, code) {
  const r = findTab(id).t.execute({ javascript: code });
  return r === undefined || r === null ? "" : String(r);
}

// Page code for finding things, also inside the "shadow" parts YouTube Studio is built from
const FIND_JS = `
  function everything(root) {
    const out = [];
    const walk = (r) => { for (const e of r.querySelectorAll("*")) { out.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
    walk(root);
    return out;
  }
  function visible(e) { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }
  function deep(selector) {
    const roots = [document, ...everything(document).filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
    for (const r of roots) for (const e of r.querySelectorAll(selector)) if (visible(e)) return e;
    return null;
  }
  function byText(text) {
    const want = text.toLowerCase();
    return everything(document).find((e) => visible(e) && e.children.length === 0 && (e.textContent || "").trim().toLowerCase() === want) || null;
  }
  function find(sel) { return sel.startsWith("text:") ? byText(sel.slice(5)) : deep(sel); }`;

// Is something on the page? (first selector that matches; "text:Label" finds by its words)
function has(id, selectors) {
  return js(id, `(function () { ${FIND_JS}
    for (const s of ${JSON.stringify(selectors)}) if (find(s)) return s;
    return "";
  })()`);
}

function waitFor(id, selectors, seconds, what) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const s = has(id, selectors);
    if (s) return s;
    delay(1);
  }
  throw new Error(`${what} didn't appear${dump(id)}`);
}

// JavaScript click (for buttons that don't need a real mouse)
function jsClick(id, selectors, what) {
  const r = js(id, `(function () { ${FIND_JS}
    for (const s of ${JSON.stringify(selectors)}) {
      const e = find(s);
      if (e) { (e.closest("button, [role=button], tp-yt-paper-radio-button, ytcp-button") || e).click(); return "clicked"; }
    }
    return "";
  })()`);
  if (r !== "clicked") throw new Error(`Couldn't find ${what}${dump(id)}`);
}

// A real mouse click (file pickers only open for real clicks): the element's spot on the screen
function realClick(id, selectors, what) {
  front(id);
  const r = js(id, `(function () { ${FIND_JS}
    for (const s of ${JSON.stringify(selectors)}) {
      const e = find(s);
      if (!e) continue;
      e.scrollIntoView({ block: "center" });
      const b = e.getBoundingClientRect();
      const x = window.screenX + (window.outerWidth - window.innerWidth) / 2 + b.left + b.width / 2;
      const y = window.screenY + (window.outerHeight - window.innerHeight) + b.top + b.height / 2;
      return JSON.stringify({ x, y });
    }
    return "";
  })()`);
  if (!r) throw new Error(`Couldn't find ${what}${dump(id)}`);
  const { x, y } = JSON.parse(r);
  const pt = $.CGPointMake(x, y);
  const post = (type) => $.CGEventPost(0, $.CGEventCreateMouseEvent(null, type, pt, 0));
  post(5); // move
  delay(0.4);
  post(1); // down
  delay(0.1);
  post(2); // up
}

// Put the cursor in a box on the page and type into it with the real keyboard (replacing what's there)
function typeInto(id, selectors, text, what, pressReturn) {
  front(id);
  const r = js(id, `(function () { ${FIND_JS}
    for (const s of ${JSON.stringify(selectors)}) {
      const e = find(s);
      if (e) { e.scrollIntoView({ block: "center" }); e.focus(); return "ok"; }
    }
    return "";
  })()`);
  if (r !== "ok") throw new Error(`Couldn't find ${what}${dump(id)}`);
  delay(0.3);
  keys.keystroke("a", { using: "command down" });
  delay(0.2);
  keys.keystroke(text);
  delay(0.4);
  if (pressReturn) keys.keyCode(36);
  delay(0.6);
}

// Set a text box's contents without the keyboard (for long text with line breaks)
function setText(id, selectors, text, what) {
  const r = js(id, `(function (text) { ${FIND_JS}
    for (const s of ${JSON.stringify(selectors)}) {
      const e = find(s);
      if (!e) continue;
      e.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
      return (e.innerText || e.value || "").trim().slice(0, 200);
    }
    return "\\u0000";
  })(${JSON.stringify(text)})`);
  if (r === "\u0000") throw new Error(`Couldn't find ${what}${dump(id)}`);
  return r;
}

// What the page shows, for the log when something can't be found (so it can be fixed)
function dump(id) {
  try {
    return "\n    page shows: " + js(id, `(function () { ${FIND_JS}
      return everything(document).filter((e) => visible(e) && /^(BUTTON|YTCP-BUTTON|TP-YT-PAPER-RADIO-BUTTON|INPUT|A)$/.test(e.tagName) || (e.id && visible(e) && /button|input|textbox|radio/i.test(e.id)))
        .slice(0, 40).map((e) => (e.id ? "#" + e.id : e.tagName.toLowerCase()) + (e.textContent ? " '" + e.textContent.trim().replace(/\\s+/g, " ").slice(0, 30) + "'" : "")).join(" | ");
    })()`);
  } catch (e) {
    return "";
  }
}

// The Mac's "choose a file" window: go to the file's exact location and open it
function pickFile(path) {
  delay(2);
  keys.keystroke("g", { using: ["command down", "shift down"] });
  delay(1.2);
  keys.keystroke(path);
  delay(1);
  keys.keyCode(36); // Return: go to the file
  delay(1.5);
  keys.keyCode(36); // Return: open it
  delay(2);
}

// ------------------------------------------------------------------ YouTube

// On YouTube's details window for one video (new upload or draft): title, credit, "not made for kids", then the
// schedule. review = true stops before the final "Schedule" click and returns true (leave the tab open).
function fillAndSchedule(id, item, review, limitShown) {
    delay(2);
    log(`  uploading; title: ${setText(id, ["#title-textarea #textbox", "#title-textarea [contenteditable]"], item.title, "the title box")}`);
    // keep your saved default description; change only the credit's name
    const descBox = ["#description-textarea #textbox", "#description-textarea [contenteditable]"];
    const current = js(id, `(function () { ${FIND_JS}
      for (const s of ${JSON.stringify(descBox)}) { const e = find(s); if (e) return e.innerText; }
      return "";
    })()`);
    const wanted = U.withCredit(current, item.credit, item.description);
    if (wanted.trim() !== current.trim()) setText(id, descBox, wanted, "the description box");
    log(`  description: ${wanted.split("\n")[0]}${current.trim() ? "" : " (your default description was empty, so the full one was filled in)"}`);
    try {
      jsClick(id, ['tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]'], '"No, it\'s not made for kids"');
    } catch (e) {
      log("  (couldn't tick \"not made for kids\"; leaving your default)");
    }
    // Details -> Video elements -> Checks -> Visibility
    for (let i = 0; i < 3; i++) {
      try {
        jsClick(id, ["#next-button"], 'the "Next" button');
      } catch (e) {
        // YouTube hides "Next" when it refuses the upload (e.g. the daily limit)
        if (limitShown() || !has(id, ["#next-button"])) throw new UploadLimit("YouTube stopped the upload (no \"Next\" button; most likely the daily upload limit)");
        throw e;
      }
      delay(2);
    }
    waitFor(id, ["#second-container-expand-button", 'tp-yt-paper-radio-button[name="SCHEDULE"]', "text:Schedule"], 30, "The visibility page");
    jsClick(id, ["#second-container-expand-button", 'tp-yt-paper-radio-button[name="SCHEDULE"]', "text:Schedule"], 'the "Schedule" option');
    delay(1.5);
    const day = U.studioDate(item.when);
    const time = U.studioTime(item.when);
    jsClick(id, ["#datepicker-trigger", "ytcp-date-picker #datepicker-trigger", "ytcp-text-dropdown-trigger#datepicker-trigger"], "the schedule date");
    delay(1);
    typeInto(id, ["ytcp-date-picker tp-yt-paper-input input", "#date-picker input", "tp-yt-paper-dialog tp-yt-paper-input input"], day, "the date box", true);
    typeInto(id, ["#time-of-day-container input", "#time-of-day-trigger input", "ytcp-form-input-container#time-of-day-container input"], time, "the time box", true);
    const shown = js(id, `(function () { ${FIND_JS}
      const d = deep("#datepicker-trigger"); const t = deep("#time-of-day-container input");
      return ((d && d.innerText) || "?").trim() + " " + ((t && t.value) || "?");
    })()`);
    log(`  schedule set to ${shown.replace(/\s+/g, " ")} (wanted ${day} ${time})`);

    // wait for the upload itself to finish before scheduling
    const end = Date.now() + 45 * 60000;
    let status = "";
    while (Date.now() < end) {
      status = js(id, `(function () { ${FIND_JS}
        const p = deep("ytcp-video-upload-progress") || deep(".progress-label");
        return p ? p.innerText.replace(/\\s+/g, " ").trim() : "";
      })()`);
      if (status && !/uploading/i.test(status)) break;
      if (!status && Date.now() > end - 45 * 60000 + 15000) break; // no progress shown (e.g. a finished draft)
      delay(5);
    }
    log(`  upload status: ${status || "(not shown)"}`);
    if (review) {
      log("  TEST: everything is filled in. Check the title, description, date and time in the open YouTube tab,");
      log('  then click "Schedule" yourself (or fix anything first).');
      return true;
    }
    jsClick(id, ["#done-button"], 'the "Schedule" button');
    delay(4);
    const after = js(id, "document.body.innerText.slice(0, 3000)");
    if (!/scheduled|video published|video saved/i.test(after)) log("  (couldn't confirm the \"Video scheduled\" message; check YouTube Studio)");
    log(`  scheduled on YouTube for ${day} ${time}`);
    delay(3);
  return false;
}

// One video on its own (used for the test). review = true: fill in everything, then stop before the final "Schedule" click and leave the tab open
// for you to check and click it yourself.
function youtube(item, review) {
  const path = `${CLIPS_DIR}/${item.folder}/${item.file}`;
  const id = openTab(`https://studio.youtube.com/channel/${YT_CHANNEL}/videos/upload?d=ud`);
  let picked = false;
  let keepOpen = false;
  try {
    const limitShown = () => LIMIT_TEXT.test(js(id, "document.body.innerText"));
    waitFor(id, ["#select-files-button", "text:Select files"], 60, 'YouTube Studio\'s "Select files" button');
    if (limitShown()) throw new UploadLimit("YouTube says the daily upload limit is reached");
    realClick(id, ["#select-files-button", "text:Select files"], 'the "Select files" button');
    pickFile(path);
    picked = true;
    // wait for the details page, watching for YouTube's upload-limit message
    const until = Date.now() + 90000;
    while (!has(id, ["#title-textarea #textbox", "#title-textarea [contenteditable]"])) {
      if (limitShown()) throw new UploadLimit("YouTube says the daily upload limit is reached");
      if (Date.now() > until) throw new Error(`The video details page didn't appear${dump(id)}`);
      delay(1);
    }
    if (fillAndSchedule(id, item, review, limitShown)) keepOpen = true;
  } catch (e) {
    if (e instanceof UploadLimit) {
      // YouTube refused it. If it got as far as the details page, a stopped draft may be left in YouTube Studio.
      if (picked) log("  (if YouTube Studio shows this video as a stopped draft, delete that draft; it will be uploaded again next run)");
      throw e;
    }
    if (picked) {
      // the video is already on YouTube (counts toward the daily limit): leave it open to finish by hand
      keepOpen = true;
      throw new AfterFilePicked(`${e.message}\n    The video is already uploading in the open YouTube tab: finish its details and schedule it by hand there.`);
    }
    throw e;
  } finally {
    if (!keepOpen) closeTab(id);
  }
}

// The Mac's "choose files" window: go to one file by its full location (that's reliable: it opens its folder
// with the file selected), then select every file in that folder and open them.
function pickAllIn(folder, firstFile) {
  delay(2);
  keys.keystroke("g", { using: ["command down", "shift down"] });
  delay(1.2);
  keys.keystroke(`${folder}/${firstFile}`);
  delay(1.2);
  keys.keyCode(36); // Return: go to the file (its folder opens with the file selected)
  delay(2);
  keys.keystroke("a", { using: "command down" }); // select all the files in that folder
  delay(1);
  keys.keyCode(36); // Return: open them
  delay(3);
}

// A whole date folder at once: upload all its videos together (they arrive as private drafts), then open each
// draft from the Content list and fill in its credit and schedule. remember(item, note) records an upload.
// Returns how many were scheduled; throws UploadLimit when YouTube refuses more.
function youtubeFolder(group, remember) {
  const batch = "/Users/Shared/VidAuto/upload-batch";
  sh(`rm -rf ${q(batch)} && mkdir -p ${q(batch)}`);
  for (const it of group) {
    const src = `${CLIPS_DIR}/${it.folder}/${it.file}`;
    sh(`ln -f ${q(src)} ${q(batch + "/" + it.file)} 2>/dev/null || cp ${q(src)} ${q(batch + "/")}`);
  }
  const id = openTab(`https://studio.youtube.com/channel/${YT_CHANNEL}/videos/upload?d=ud`);
  const limitShown = () => LIMIT_TEXT.test(js(id, "document.body.innerText"));
  let uploaded = false;
  let scheduled = 0;
  const pending = new Set(group.map((g) => g.key));
  try {
    waitFor(id, ["#select-files-button", "text:Select files"], 60, 'YouTube Studio\'s "Select files" button');
    if (limitShown()) throw new UploadLimit("YouTube says the daily upload limit is reached");
    realClick(id, ["#select-files-button", "text:Select files"], 'the "Select files" button');
    pickAllIn(batch, group[0].file);

    // wait until YouTube has taken every file
    const until = Date.now() + 60 * 60000;
    let text = "";
    let lastNote = 0;
    const started = Date.now();
    for (;;) {
      delay(5);
      if (!uploaded) checkStop(); // nothing uploaded yet: safe to stop
      text = js(id, "document.body.innerText");
      const busy = /uploading\s*\d+\s*%|waiting\b|upload(ing)? (in progress|starting)/i.test(text);
      if (/upload complete|processing|checks complete|uploads complete/i.test(text) && !busy) break;
      if (!uploaded && !/select files|drag and drop/i.test(text)) uploaded = true;
      if (!uploaded && Date.now() - started > 45000) {
        // the file window didn't hand over the files: nothing was uploaded
        throw new Error("The videos weren't picked in the Mac's file window (nothing was uploaded). Close any open file window and run Upload again.");
      }
      if (Date.now() - lastNote > 60000) {
        lastNote = Date.now();
        const pct = text.match(/uploading\s*\d+\s*%/gi);
        log(`  uploading ${group.length} video(s)${pct ? ": " + pct.join(", ") : "..."}`);
      }
      if (Date.now() > until) throw new Error("The uploads didn't finish within an hour");
    }
    uploaded = true;
    log(`  all ${group.length} uploaded as drafts${LIMIT_TEXT.test(text) ? " (YouTube says the upload limit was reached for some)" : ""}`);
    try {
      jsClick(id, ["#close-button", "#ytcp-uploads-dialog-close-button", 'ytcp-button[aria-label="Close"]'], "the upload window's close button");
    } catch (e) {
      // it may close by itself
    }
    delay(2);

    for (const item of group) {
      checkStop(); // the rest stay private drafts (listed in the log)
      // the Content list, newest first, where each draft has an "Edit draft" button
      js(id, `location.href = "https://studio.youtube.com/channel/${YT_CHANNEL}/videos/upload"; "ok"`);
      waitLoaded(id);
      const end = Date.now() + 60000;
      let row = "";
      while (Date.now() < end) {
        row = js(id, `(function (title) { ${FIND_JS}
          const rows = everything(document).filter((e) => e.tagName === "YTCP-VIDEO-ROW" && visible(e));
          const r = rows.find((x) => (x.innerText || "").includes(title));
          return r ? r.innerText.replace(/\\s+/g, " ").slice(0, 300) : "";
        })(${JSON.stringify(item.title)})`);
        if (row) break;
        delay(2);
      }
      if (!row) throw new Error(`Couldn't find the draft "${item.title}" in the Content list${dump(id)}`);
      if (LIMIT_TEXT.test(row)) {
        // YouTube refused this one: nothing usable was uploaded
        pending.delete(item.key);
        throw new UploadLimit(`YouTube refused "${item.title}" (daily upload limit). Delete its draft in YouTube Studio; it goes up on the next run.`);
      }
      log(`${item.file} -> ${U.studioDate(item.when)} ${U.studioTime(item.when)}`);
      const opened = js(id, `(function (title) { ${FIND_JS}
        const r = everything(document).filter((e) => e.tagName === "YTCP-VIDEO-ROW").find((x) => (x.innerText || "").includes(title));
        if (!r) return "no row";
        const b = everything(r).find((e) => e.children.length === 0 && /^edit draft$/i.test((e.textContent || "").trim()));
        if (!b) return "no Edit draft button";
        (b.closest("button, ytcp-button, [role=button]") || b).click();
        return "ok";
      })(${JSON.stringify(item.title)})`);
      if (opened !== "ok") throw new Error(`Couldn't open the draft "${item.title}" (${opened})${dump(id)}`);
      waitFor(id, ["#title-textarea #textbox", "#title-textarea [contenteditable]"], 60, "The draft's details window");
      fillAndSchedule(id, item, false, limitShown);
      remember(item, "");
      pending.delete(item.key);
      scheduled++;
      delay(2);
    }
    return scheduled;
  } catch (e) {
    if (uploaded && pending.size) {
      // Videos left unscheduled are private drafts in YouTube Studio. Ones YouTube refused (upload limit) aren't
      // usable: they go up again next run. The others are remembered so they're never uploaded twice.
      const finish = [];
      const redo = [];
      for (const item of group) {
        if (!pending.has(item.key)) continue;
        let row = "";
        try {
          row = js(id, `(function (title) { ${FIND_JS}
            const r = everything(document).filter((x) => x.tagName === "YTCP-VIDEO-ROW").find((x) => (x.innerText || "").includes(title));
            return r ? r.innerText : "";
          })(${JSON.stringify(item.title)})`);
        } catch (err) {
          // page gone; treat as a usable draft
        }
        if (LIMIT_TEXT.test(row)) redo.push(item.title);
        else {
          remember(item, "draft on YouTube: finish its details by hand");
          finish.push(item.title);
        }
      }
      if (finish.length) e.message += `\n    Private drafts to finish and schedule by hand in YouTube Studio: ${finish.join("; ")}`;
      if (redo.length) e.message += `\n    Refused by YouTube (delete these drafts; they're uploaded again next run): ${redo.join("; ")}`;
    }
    e.scheduled = scheduled;
    throw e;
  } finally {
    closeTab(id);
  }
}

// ------------------------------------------------------------------ gameplay credit

// The creator's name for a date folder: <source video>.credit.txt if you made one, else the "Authors" info in
// the source video file (e.g. "Orbital - No Copyright Gameplay" -> "Orbital").
function creditFor(folder) {
  let source = (readText(`${CLIPS_DIR}/${folder}/source.txt`) || "").trim();
  if (!source) {
    // folders made before source.txt existed: use the newest source video
    const vids = listDir(SOURCE_DIR).filter((n) => /\.(mp4|mov|m4v)$/i.test(n));
    const newest = vids.map((n) => ({ n, t: Number(sh(`stat -f %m ${q(SOURCE_DIR + "/" + n)}`)) })).sort((a, b) => b.t - a.t)[0];
    if (!newest) return null;
    source = `${SOURCE_DIR}/${newest.n}`;
  }
  const name = source.split("/").pop();
  const own = readText(source.replace(/\.[^./]+$/, "") + ".credit.txt");
  if (own && own.trim()) return { credit: own.trim(), source: name, how: "set in the panel" };
  try {
    const c = U.creditFromAuthor(sh(`mdls -raw -name kMDItemAuthors ${q(source)}`).replace(/\s+/g, " "));
    if (c) return { credit: c, source: name, how: "from the video's file info" };
  } catch (e) {
    // no Spotlight info
  }
  return { credit: null, source: name, how: "no creator in its file info" };
}


// ------------------------------------------------------------------ Facebook (Meta Business Suite)

const FB_COMPOSER = `https://business.facebook.com/latest/composer/?asset_id=${FB_ASSET}&nav_ref=internal_nav&ref=biz_web_home_create_post&context_ref=HOME`;

// Put text on the clipboard and paste it into the box that has the cursor (keeps the blank lines)
function paste(text) {
  const pb = $.NSPasteboard.generalPasteboard;
  pb.clearContents;
  pb.setStringForType($(text), $("public.utf8-plain-text"));
  delay(0.3);
  keys.keystroke("a", { using: "command down" });
  delay(0.2);
  keys.keystroke("v", { using: "command down" });
  delay(1);
}

// Click a button by its exact words; `last` picks the lowest one on the page (e.g. the bottom "Schedule"
// button rather than the "Schedule" tab above it)
function fbButton(id, words, last) {
  return js(id, `(function () {
    const want = ${JSON.stringify(words.toLowerCase())};
    const all = [...document.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"]')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (b.innerText || "").trim().toLowerCase() === want &&
        b.getAttribute("aria-disabled") !== "true" && !b.disabled;
    });
    all.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const b = ${last ? "all[all.length - 1]" : "all[0]"};
    if (!b) return "";
    b.click();
    return "clicked";
  })()`) === "clicked";
}

// The schedule's date and time boxes: { date, time } as shown, plus where they are for clicking
const FB_WHEN_JS = `(function () {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inputs = [...document.querySelectorAll("input")].filter(vis);
  const date = inputs.find((e) => /^[A-Z][a-z]{2} \\d{1,2}, \\d{4}$/.test(e.value) || /date/i.test(e.getAttribute("aria-label") || e.placeholder || ""));
  const time = inputs.find((e) => /^\\d{1,2}:\\d{2}\\s*[AP]M$/i.test(e.value) || /time/i.test(e.getAttribute("aria-label") || e.placeholder || ""));
  const mark = (e, name) => { if (e) e.setAttribute("data-vidauto", name); };
  mark(date, "date");
  mark(time, "time");
  return JSON.stringify({ date: date ? date.value : null, time: time ? time.value : null });
})()`;

function fbWhen(id) {
  return JSON.parse(js(id, FB_WHEN_JS) || "{}");
}


// Page code: the section (box) that has a heading with these exact words, e.g. "Tags" or "Add to playlist"
const FB_SECTION_JS = `function section(words, inside) {
    // the heading may read "Tags · optional"; take the smallest element that says it
    const re = new RegExp("^" + words.replace(/[.*+?^$()|[\\]\\\\]/g, "\\\\$&") + "(\\\\s*[·•-][\\\\s\\\\S]*)?$", "i");
    const labels = [...document.querySelectorAll("span, div, label, h2, h3, h4")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && re.test((e.innerText || "").trim()) && (e.innerText || "").length < 60;
    });
    labels.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
    for (const label of labels) {
      let box = label.parentElement;
      while (box && box !== document.body && !box.querySelector(inside)) box = box.parentElement;
      if (box && box !== document.body) return box;
    }
    return null;
  }`;

// Scroll Business Suite's form down a bit (sections further down only appear once they're scrolled to)
function fbScroll(id) {
  js(id, `(function () {
    for (const e of document.querySelectorAll("div")) {
      const st = getComputedStyle(e);
      if (e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(st.overflowY)) e.scrollTop += 500;
    }
    window.scrollBy(0, 500);
  })()`);
  delay(1);
}

// Wait (scrolling down) until a section shows; true if found
function fbFindSection(id, words, inside) {
  for (let i = 0; i < 20; i++) {
    checkStop();
    const found = js(id, `(function () { ${FB_SECTION_JS}
      const box = section(${JSON.stringify(words)}, ${JSON.stringify(inside)});
      if (!box) return "";
      box.scrollIntoView({ block: "center" });
      return "ok";
    })()`);
    if (found === "ok") return true;
    fbScroll(id);
  }
  return false;
}

// The reel's Tags: add any of FB_TAGS that aren't there yet (type each one and press Return)
function fbTags(id) {
  const have = () => JSON.parse(js(id, `(function () { ${FB_SECTION_JS}
    const box = section("Tags", "input");
    if (!box) return "null";
    box.querySelector("input").setAttribute("data-vidauto", "tags");
    return JSON.stringify(box.innerText.split(/\\n/).map((t) => t.trim().toLowerCase()).filter(Boolean));
  })()`) || "null");
  if (!fbFindSection(id, "Tags", "input")) throw new Error(`Couldn't find the reel's Tags box${dump(id)}`);
  delay(0.5);
  let now = have();
  if (!now) throw new Error(`Couldn't find the reel's Tags box${dump(id)}`);
  for (const tag of FB_TAGS) {
    if (now.includes(tag.toLowerCase())) continue;
    typeInto(id, ['input[data-vidauto="tags"]'], tag, "the Tags box", true);
    delay(0.8);
    now = have() || now;
  }
  const missing = FB_TAGS.filter((t) => !now.includes(t.toLowerCase()));
  if (missing.length) throw new Error(`Couldn't add the tag(s) ${missing.join(", ")} (Tags shows: ${now.join(", ")})`);
  log(`  tags: ${FB_TAGS.join(", ")}`);
}

// Share step: "Add to playlist" switched on, with the FB_PLAYLIST playlist chosen
function fbPlaylist(id) {
  const state = () => JSON.parse(js(id, `(function () { ${FB_SECTION_JS}
    const box = section("Add to playlist", 'input[type="checkbox"], [role="switch"], [role="checkbox"]');
    if (!box) return "null";
    const sw = box.querySelector('input[type="checkbox"], [role="switch"], [role="checkbox"]');
    sw.setAttribute("data-vidauto", "playlist-switch");
    const on = sw.checked === true || sw.getAttribute("aria-checked") === "true";
    const pick = box.querySelector('[role="combobox"], [aria-haspopup], select, [role="button"]');
    if (pick) pick.setAttribute("data-vidauto", "playlist-pick");
    return JSON.stringify({ on, text: box.innerText });
  })()`) || "null");
  if (!fbFindSection(id, "Add to playlist", 'input[type="checkbox"], [role="switch"], [role="checkbox"]')) {
    throw new Error(`Couldn't find "Add to playlist"${dump(id)}`);
  }
  delay(0.5);
  let st = state();
  if (!st) throw new Error(`Couldn't find "Add to playlist"${dump(id)}`);
  if (!st.on) {
    jsClick(id, ['[data-vidauto="playlist-switch"]'], 'the "Add to playlist" switch');
    delay(1.5);
    st = state() || st;
    if (!st.on) throw new Error(`Couldn't switch on "Add to playlist"${dump(id)}`);
  }
  if (!st.text.includes(FB_PLAYLIST)) {
    jsClick(id, ['[data-vidauto="playlist-pick"]'], "the Playlists menu");
    delay(1.5);
    const picked = js(id, `(function () {
      const want = ${JSON.stringify(FB_PLAYLIST.toLowerCase())};
      const opt = [...document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="checkbox"], span, div')]
        .find((e) => e.getBoundingClientRect().width > 0 && (e.innerText || "").trim().toLowerCase() === want &&
          !e.closest('[data-vidauto="playlist-pick"]'));
      if (!opt) return "";
      (opt.closest('[role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="checkbox"], label') || opt).click();
      return "ok";
    })()`);
    delay(1);
    keys.keyCode(53); // Escape: close the menu if it stays open
    delay(1);
    st = state() || st;
    if (picked !== "ok" || !st.text.includes(FB_PLAYLIST)) throw new Error(`Couldn't choose the "${FB_PLAYLIST}" playlist${dump(id)}`);
  }
  log(`  playlist: ${FB_PLAYLIST}`);
}

// "Oct 2, 2026" + "01:30 PM" the way Business Suite shows them
function fbTime(ms) {
  const t = U.studioTime(ms);
  return t.length < 8 ? "0" + t : t;
}
const sameTime = (a, b) => String(a || "").replace(/^0/, "").replace(/\s+/g, " ").toUpperCase() === String(b || "").replace(/^0/, "").replace(/\s+/g, " ").toUpperCase();

// One full video as a Facebook reel. review = true fills in everything and stops before the final "Schedule"
// click (the tab stays open for you to check and click it).
function facebook(item, review) {
  const path = `${CLIPS_DIR}/${item.folder}/${item.file}`;
  const id = openTab(FB_COMPOSER);
  let keepOpen = false;
  try {
    waitFor(id, ["text:Add photo/video"], 60, 'Business Suite\'s "Add photo/video" button');
    realClick(id, ["text:Add photo/video"], 'the "Add photo/video" button');
    delay(1.5);
    if (has(id, ["text:Upload from computer"])) realClick(id, ["text:Upload from computer"], '"Upload from computer"');
    pickFile(path);
    keepOpen = true; // from here on, leave the tab open if anything goes wrong so you can see it

    // the window turns into "Create reel"; wait for the video to finish uploading (the bar reaches 100%)
    waitFor(id, ["text:Create reel", "text:Reel details"], 90, 'The "Create reel" window');
    const end = Date.now() + 45 * 60000;
    let pct = "";
    while (Date.now() < end) {
      checkStop();
      pct = js(id, `(function () {
        const m = [...document.querySelectorAll("span, div")].map((e) => (e.children.length ? "" : e.innerText || "").trim())
          .filter((t) => /^\\d{1,3}%$/.test(t));
        return m.length ? m[0] : "";
      })()`);
      if (pct === "100%") break;
      delay(3);
    }
    log(`  uploaded (${pct || "no progress bar shown"})`);

    // description: name, credit, hashtags
    const box = js(id, `(function () {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const eds = [...document.querySelectorAll('[contenteditable="true"], textarea')].filter(vis);
      const e = eds.find((x) => /viewers know|describe|description/i.test((x.getAttribute("aria-label") || "") + (x.getAttribute("aria-placeholder") || "") +
        (x.getAttribute("placeholder") || "") + ((x.parentElement && x.parentElement.innerText) || ""))) || eds[0];
      if (!e) return "";
      e.scrollIntoView({ block: "center" });
      e.focus();
      return "ok";
    })()`);
    if (box !== "ok") throw new Error(`Couldn't find the reel's description box${dump(id)}`);
    front(id);
    paste(item.description);
    const got = js(id, `(document.activeElement && (document.activeElement.innerText || document.activeElement.value) || "").trim()`);
    if (!got.includes(item.title) || !got.includes(item.credit)) {
      throw new Error(`The description didn't go in right (it shows: "${got.replace(/\s+/g, " ").slice(0, 150)}")`);
    }
    log(`  description: ${item.title} / Gameplay Video Credit: ${item.credit} / hashtags`);
    fbTags(id);

    // Create -> Edit -> Share
    for (const step of ["Edit", "Share"]) {
      if (!fbButton(id, "Next", true)) throw new Error(`Couldn't press "Next" to go to the ${step} step${dump(id)}`);
      delay(3);
    }
    waitFor(id, ["text:Scheduling options"], 30, 'The "Scheduling options" step');
    // choose the "Schedule" option (next to "Share now") unless its date and time boxes already show. Only click
    // it when the bottom "Schedule" button is there too, so the top one is surely the option, not the button.
    let w = fbWhen(id);
    if (w.date === null || w.time === null) {
      const count = Number(js(id, `String([...document.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"]')]
        .filter((b) => b.getBoundingClientRect().width > 0 && (b.innerText || "").trim() === "Schedule").length)`));
      if (count < 2 || !fbButton(id, "Schedule", false)) throw new Error(`Couldn't choose the "Schedule" option${dump(id)}`);
      delay(1.5);
      w = fbWhen(id);
    }

    const day = U.studioDate(item.when);
    const time = fbTime(item.when);
    if (w.date === null || w.time === null) throw new Error(`Couldn't find the schedule's date and time boxes${dump(id)}`);
    if (w.date !== day) {
      typeInto(id, ['input[data-vidauto="date"]'], day, "the date box", true);
      keys.keyCode(53); // Escape: close the calendar if it opened
      delay(0.8);
    }
    w = fbWhen(id);
    if (!sameTime(w.time, time)) {
      typeInto(id, ['input[data-vidauto="time"]'], time, "the time box", true);
      delay(0.8);
    }
    w = fbWhen(id);
    log(`  schedule set to ${w.date} ${w.time} (wanted ${day} ${time})`);
    if (w.date !== day || !sameTime(w.time, time)) {
      throw new Error(`The schedule shows ${w.date} ${w.time} instead of ${day} ${time}. Nothing was posted; ` +
        "fix the date and time in the open tab and click Schedule yourself, or close the tab");
    }
    fbPlaylist(id);
    // the playlist menu can shift things; check the date and time once more
    w = fbWhen(id);
    if (w.date !== day || !sameTime(w.time, time)) {
      throw new Error(`The schedule changed to ${w.date} ${w.time} instead of ${day} ${time}. Nothing was posted; fix it in the open tab and click Schedule yourself, or close the tab`);
    }

    if (review) {
      log("  TEST: everything is filled in. Check the description, date and time in the open Business Suite tab,");
      log('  then click "Schedule" yourself (or fix anything first).');
      return true;
    }
    if (!fbButton(id, "Schedule", true)) throw new Error(`Couldn't press the "Schedule" button${dump(id)}`);
    // done when the reel window closes or Business Suite says it's scheduled
    const until = Date.now() + 90000;
    let ok = false;
    while (Date.now() < until) {
      delay(2);
      const page = js(id, "location.href + ' ' + document.body.innerText.slice(0, 4000)");
      if (/scheduled/i.test(page) || !/Scheduling options/.test(page)) {
        ok = true;
        break;
      }
    }
    if (!ok) throw new AfterFilePicked("Pressed Schedule, but Business Suite didn't confirm it; check Planner in Business Suite (it may be scheduled)");
    log(`  scheduled on Facebook for ${day} ${time}`);
    keepOpen = false;
    return false;
  } finally {
    if (!keepOpen) closeTab(id);
  }
}

// ------------------------------------------------------------------ main

function run(argv) {
  const platform = (argv[0] || "youtube").toLowerCase();
  const limit = Number(argv[1]) || 0;
  const review = argv.length > 3 && argv[2] === "review"; // test: stop before the final click
  const here = argv[argv.length - 1] || ".";
  U = eval(`(function () { var module = { exports: {} }; ${readText(here + "/upload-rules.js")}
    return module.exports; })()`);
  if (platform !== "youtube" && platform !== "facebook") return `Uploading to ${platform} isn't built yet.`;

  const record = JSON.parse(readText(UPLOADS_FILE) || '{"uploads":[]}');
  const uploaded = new Set(record.uploads.map((x) => x.key));
  const folders = listDir(CLIPS_DIR)
    .filter((n) => U.folderDay(n))
    .map((n) => ({ name: n, files: listDir(`${CLIPS_DIR}/${n}`) }))
    .filter((f) => f.files.some((x) => /^vidauto-done\.txt$/i.test(x)) ||
      (f.files.some((x) => /\(full video\)\.mp4$/i.test(x)) && f.files.some((x) => /\(part 1\)\.mp4$/i.test(x))))
    .filter((f) => U.folderDay(f.name) >= new Date(new Date().setHours(0, 0, 0, 0)));
  const missing = new Set();
  for (const f of folders) {
    const c = creditFor(f.name);
    f.credit = c ? c.credit : null;
    f.creditNote = c ? `${c.source}, ${c.how}` : "no source video found";
    if (!f.credit && c) missing.add(c.source);
  }

  const plan = U.uploadPlan(platform, folders, uploaded, new Date());
  let items = limit ? plan.items.slice(0, limit) : plan.items;
  // never go over the daily upload limit (counting what was already uploaded today)
  const limits = Object.assign({}, DEFAULT_DAILY_LIMIT, JSON.parse(readText(LIMITS_FILE) || "{}"));
  const today = new Date().toDateString();
  // real uploads today only: videos you marked as already uploaded (posted by hand) don't count
  const doneToday = record.uploads.filter((x) => x.key.startsWith(platform + "|") && new Date(x.at).toDateString() === today &&
    !/marked as already uploaded/i.test(x.note || "")).length;
  const room = Math.max(0, limits[platform] - doneToday);
  if (items.length > room) {
    log(`  daily limit: ${limits[platform]} a day, ${doneToday} already today, so ${room} now; the other ${items.length - room} wait for the next run`);
    items = items.slice(0, room);
  }
  log(`=== Upload to ${platform}: ${items.length} video(s) to schedule`);
  folders.forEach((f) => log(`  ${f.name}: gameplay credit "${f.credit || "?"}" (${f.creditNote})`));
  missing.forEach((m) => log(`  NO CREDIT for ${m}: in the VidAuto panel type the creator's name next to "Gameplay credit" and click Set, then run Upload again.`));
  plan.skipped.forEach((s) => log(`  skipped: ${s}`));

  // YouTube already said "limit reached" today: don't try again until tomorrow
  if (record.limitHit && record.limitHit[platform] === today && items.length) {
    log(`YouTube's daily upload limit was reached earlier today; the ${items.length} waiting video(s) go up on the next run tomorrow.`);
    return `YouTube's daily limit was already reached today; ${items.length} video(s) wait for tomorrow.`;
  }
  const pause = Number(limits.pauseMinutes === undefined ? DEFAULT_PAUSE_MINUTES : limits.pauseMinutes);

  let done = 0;
  const remember = (item, note) => {
    record.uploads.push({ key: item.key, when: new Date(item.when).toISOString(), at: new Date().toISOString(), ...(note ? { note } : {}) });
    writeText(UPLOADS_FILE, JSON.stringify(record, null, 2));
  };
  const limitStop = (left) => {
    record.limitHit = { ...(record.limitHit || {}), [platform]: today };
    writeText(UPLOADS_FILE, JSON.stringify(record, null, 2));
    log(`YouTube's daily upload limit reached after ${done} upload(s) this run; ${left} waiting video(s) go up on the next run (tomorrow).`);
    return `YouTube's daily limit reached after ${done}; ${left} video(s) wait for tomorrow.`;
  };

  if (review) {
    // test: one video, filled in, you click Schedule
    const item = items[0];
    if (!item) return "Nothing to upload.";
    log(`${item.file} -> ${U.studioDate(item.when)} ${U.studioTime(item.when)}`);
    const site = platform === "facebook" ? "Business Suite" : "YouTube";
    try {
      if (platform === "facebook") facebook(item, true);
      else youtube(item, true);
      remember(item, "test: you click Schedule");
      log(`=== TEST done: waiting for you to click Schedule in the open ${site} tab.`);
      return `Test: everything is filled in on ${site}; check it and click Schedule in the open tab.`;
    } catch (e) {
      if (e instanceof UploadLimit) return limitStop(items.length);
      if (e instanceof AfterFilePicked) remember(item, "failed partway: finish by hand");
      log(`  FAILED: ${e.message}`);
      return `Stopped: ${e.message.split("\n")[0]}`;
    }
  }

  // Facebook: one full video at a time
  if (platform === "facebook") {
    for (const item of items) {
      if (exists(STOP_FILE)) {
        log(`STOPPED by you after ${done} of ${items.length}.`);
        return `Stopped by you after ${done} of ${items.length}.`;
      }
      log(`--- ${item.folder}: ${item.file} -> ${U.studioDate(item.when)} ${fbTime(item.when)}`);
      try {
        facebook(item, false);
        remember(item);
        done++;
      } catch (e) {
        if (e instanceof StopRequested) {
          log(`STOPPED by you after ${done} of ${items.length}.`);
          return `Stopped by you after ${done} of ${items.length}.`;
        }
        if (e instanceof AfterFilePicked) remember(item, "pressed Schedule but not confirmed: check Planner");
        log(`  FAILED: ${e.message}`);
        log("STOPPED so nothing gets posted twice or at the wrong time. The Business Suite tab is left open; check Planner, then run again.");
        return `Stopped after ${done} of ${items.length}: ${e.message.split("\n")[0]}`;
      }
    }
    log(`=== Done: ${done} of ${items.length} scheduled on facebook`);
    return `Done: ${done} of ${items.length} scheduled on Facebook.`;
  }

  // one date folder at a time: upload its videos together, then fill in and schedule each
  const groups = [];
  for (const item of items) {
    const g = groups[groups.length - 1];
    if (g && g[0].folder === item.folder) g.push(item);
    else groups.push([item]);
  }
  for (const [n, group] of groups.entries()) {
    if (n > 0 && pause > 0) {
      log(`  waiting ${pause} minute(s) before the next folder...`);
      delay(pause * 60);
    }
    if (exists(STOP_FILE)) {
      log(`STOPPED by you after ${done} of ${items.length}.`);
      return `Stopped by you after ${done} of ${items.length}.`;
    }
    log(`--- ${group[0].folder}: uploading ${group.length} video(s) together`);
    try {
      done += youtubeFolder(group, remember);
    } catch (e) {
      done += e.scheduled || 0;
      if (e instanceof UploadLimit) {
        log(`  ${e.message}`);
        return limitStop(items.length - done);
      }
      if (e instanceof StopRequested) {
        log(`STOPPED by you after ${done} of ${items.length}.${e.message.replace(/^Stopped by you/, "")}`);
        return `Stopped by you after ${done} of ${items.length}.`;
      }
      log(`  FAILED: ${e.message}`);
      log("STOPPED so nothing gets posted twice or at the wrong time. Check YouTube Studio, then run again.");
      return `Stopped after ${done} of ${items.length}: ${e.message.split("\n")[0]}`;
    }
  }
  const extra = plan.skipped.length ? ` (${plan.skipped.length} skipped, see the log)` : "";
  log(`=== Done: ${done} of ${items.length} scheduled on ${platform}${extra}`);
  return `Done: ${done} of ${items.length} scheduled on ${platform}${extra}.`;
}
