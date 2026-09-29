// VidAuto Upload: schedules the finished videos on YouTube (TikTok and Facebook come next).
// Runs on the Mac (JavaScript for Automation). It drives YouTube Studio in your signed-in Chrome; to pick the
// video file it clicks the site's "Select files" button and types the file's location into the Mac's file window,
// so Chrome must stay in front and the mouse and keyboard must be left alone while it runs.
// Run with: osascript -l JavaScript uploads.js <platform> <how many, 0 = all> <folder this file is in>

ObjC.import("Foundation");
ObjC.import("CoreGraphics");
const app = Application.currentApplication();
app.includeStandardAdditions = true;

const AITA_DIR = "/Users/drick/Documents/AITA";
const CLIPS_DIR = AITA_DIR + "/New Video Clips";
const SOURCE_DIR = AITA_DIR + "/Source Video";
const UPLOADS_FILE = AITA_DIR + "/vidauto-uploads.json"; // what has been scheduled, so nothing is posted twice
const LOG_FILE = AITA_DIR + "/vidauto-uploads-log.txt";
const YT_CHANNEL = "UCI3S3qXsupSQFBb4Qe2szpg";
const LIMITS_FILE = AITA_DIR + "/vidauto-upload-limits.json"; // e.g. { "youtube": 15 }: most uploads per day
const DEFAULT_DAILY_LIMIT = { youtube: 10, tiktok: 10, facebook: 10 };

class AfterFilePicked extends Error {} // failed after the file was chosen: that upload already counts

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

// review = true: fill in everything, then stop before the final "Schedule" click and leave the tab open
// for you to check and click it yourself.
function youtube(item, review) {
  const path = `${CLIPS_DIR}/${item.folder}/${item.file}`;
  const id = openTab(`https://studio.youtube.com/channel/${YT_CHANNEL}/videos/upload?d=ud`);
  let picked = false;
  let keepOpen = false;
  try {
    waitFor(id, ["#select-files-button", "text:Select files"], 60, 'YouTube Studio\'s "Select files" button');
    realClick(id, ["#select-files-button", "text:Select files"], 'the "Select files" button');
    pickFile(path);
    picked = true;
    waitFor(id, ["#title-textarea #textbox", "#title-textarea [contenteditable]"], 90, "The video details page");
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
      jsClick(id, ["#next-button"], 'the "Next" button');
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
      delay(5);
    }
    log(`  upload status: ${status || "(not shown)"}`);
    if (review) {
      keepOpen = true;
      log("  TEST: everything is filled in. Check the title, description, date and time in the open YouTube tab,");
      log('  then click "Schedule" yourself (or fix anything first).');
      return;
    }
    jsClick(id, ["#done-button"], 'the "Schedule" button');
    delay(4);
    const after = js(id, "document.body.innerText.slice(0, 3000)");
    if (!/scheduled|video published|video saved/i.test(after)) log("  (couldn't confirm the \"Video scheduled\" message; check YouTube Studio)");
    log(`  scheduled on YouTube for ${day} ${time}`);
    delay(3);
  } catch (e) {
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
  const own = readText(source.replace(/\.[^./]+$/, "") + ".credit.txt");
  if (own && own.trim()) return own.trim();
  try {
    return U.creditFromAuthor(sh(`mdls -raw -name kMDItemAuthors ${q(source)}`).replace(/\s+/g, " "));
  } catch (e) {
    return null;
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
  if (platform !== "youtube") return `Uploading to ${platform} isn't built yet.`;

  const record = JSON.parse(readText(UPLOADS_FILE) || '{"uploads":[]}');
  const uploaded = new Set(record.uploads.map((x) => x.key));
  const folders = listDir(CLIPS_DIR)
    .filter((n) => U.folderDay(n))
    .map((n) => ({ name: n, files: listDir(`${CLIPS_DIR}/${n}`) }))
    .filter((f) => f.files.some((x) => /^vidauto-done\.txt$/i.test(x)) ||
      (f.files.some((x) => /\(full video\)\.mp4$/i.test(x)) && f.files.some((x) => /\(part 1\)\.mp4$/i.test(x))))
    .filter((f) => U.folderDay(f.name) >= new Date(new Date().setHours(0, 0, 0, 0)));
  for (const f of folders) f.credit = creditFor(f.name);

  const plan = U.uploadPlan(platform, folders, uploaded, new Date());
  let items = limit ? plan.items.slice(0, limit) : plan.items;
  // never go over the daily upload limit (counting what was already uploaded today)
  const limits = Object.assign({}, DEFAULT_DAILY_LIMIT, JSON.parse(readText(LIMITS_FILE) || "{}"));
  const today = new Date().toDateString();
  const doneToday = record.uploads.filter((x) => x.key.startsWith(platform + "|") && new Date(x.at).toDateString() === today).length;
  const room = Math.max(0, limits[platform] - doneToday);
  if (items.length > room) {
    log(`  daily limit: ${limits[platform]} a day, ${doneToday} already today, so ${room} now; the other ${items.length - room} wait for the next run`);
    items = items.slice(0, room);
  }
  log(`=== Upload to ${platform}: ${items.length} video(s) to schedule`);
  folders.forEach((f) => log(`  ${f.name}: gameplay credit "${f.credit || "?"}"`));
  plan.skipped.forEach((s) => log(`  skipped: ${s}`));

  let done = 0;
  for (const item of items) {
    log(`${item.file} -> ${U.studioDate(item.when)} ${U.studioTime(item.when)}`);
    const remember = (note) => {
      record.uploads.push({ key: item.key, when: new Date(item.when).toISOString(), at: new Date().toISOString(), ...(note ? { note } : {}) });
      writeText(UPLOADS_FILE, JSON.stringify(record, null, 2));
    };
    try {
      youtube(item, review);
      remember(review ? "test: you click Schedule" : "");
      done++;
      if (review) {
        log("=== TEST done: waiting for you to click Schedule in the open YouTube tab.");
        return "Test: everything is filled in on YouTube; check it and click Schedule in the open tab.";
      }
    } catch (e) {
      // an upload that already started is remembered, so it's never uploaded a second time
      if (e instanceof AfterFilePicked) remember("failed partway: finish by hand");
      log(`  FAILED: ${e.message}`);
      log("STOPPED so nothing gets posted twice or at the wrong time. Check YouTube Studio, then run again.");
      return `Stopped after ${done} of ${items.length}: ${e.message.split("\n")[0]}`;
    }
  }
  const extra = plan.skipped.length ? ` (${plan.skipped.length} skipped, see the log)` : "";
  log(`=== Done: ${done} of ${items.length} scheduled on ${platform}${extra}`);
  return `Done: ${done} of ${items.length} scheduled on ${platform}${extra}.`;
}
