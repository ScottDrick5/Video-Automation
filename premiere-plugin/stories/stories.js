// VidAuto Stage 0: Reddit story -> ChatGPT script and title -> voiceover download -> date folder.
// Runs on the Mac (JavaScript for Automation) and drives Google Chrome directly (no mouse clicks), which needs
// Chrome's View > Developer > Allow JavaScript from Apple Events.
// Run with: osascript -l JavaScript stories.js <how many stories> <folder this file is in>

ObjC.import("Foundation");
const app = Application.currentApplication();
app.includeStandardAdditions = true;

const HOME = ObjC.unwrap($.NSHomeDirectory());
const AITA_DIR = "/Users/drick/Documents/AITA";
const CLIPS_DIR = AITA_DIR + "/New Video Clips";
const USED_FILE = AITA_DIR + "/vidauto-stories.json"; // stories already made, so none is used twice
const LOG_FILE = AITA_DIR + "/vidauto-stories-log.txt";
const MY_PROMPT = AITA_DIR + "/chatgpt-prompt.txt"; // your own copy of the prompt, if you want to change it
const DOWNLOADS = HOME + "/Downloads";
const SUBREDDIT = "BestofRedditorUpdates";
const TITLE_QUESTION = "Can you give me a good, few-word title for this script?";
const PICK_QUESTION = "Which one of those titles is the best? Reply with only that title.";
const VOICES = { female: "Juniper", male: "Ember" };
const KNOWN_VOICES = ["Juniper", "Ember", "Breeze", "Cove", "Maple", "Sol", "Spruce", "Arbor", "Vale"];

let R = null; // story-rules.js
const chrome = Application("Google Chrome");

class LimitReached extends Error {}

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

function openTab(url) {
  if (!chrome.windows().length) chrome.Window().make();
  const w = chrome.windows[0];
  w.tabs.push(chrome.Tab({ url }));
  const t = w.tabs[w.tabs.length - 1];
  const id = t.id();
  w.activeTabIndex = w.tabs.length; // keep it the visible tab: some pages only work when shown
  waitLoaded(id);
  return id;
}

function showTab(id) {
  const { w, index } = findTab(id);
  w.activeTabIndex = index;
}

function closeTab(id) {
  try {
    findTab(id).t.close();
  } catch (e) {
    // already closed
  }
}

function waitLoaded(id, seconds = 60) {
  const end = Date.now() + seconds * 1000;
  delay(1);
  while (Date.now() < end && findTab(id).t.loading()) delay(0.5);
  delay(1);
}

// Run JavaScript in the tab; the code's value comes back as a string.
function js(id, code) {
  const r = findTab(id).t.execute({ javascript: code });
  return r === undefined || r === null ? "" : String(r);
}

// Run a promise-returning function in the page and wait for its JSON result.
function jsAsync(id, fnSource, seconds = 60) {
  js(id, `window.__vaR = ""; Promise.resolve().then(${fnSource}).then(
    (v) => { window.__vaR = JSON.stringify({ ok: v }); },
    (e) => { window.__vaR = JSON.stringify({ err: String(e) }); }); "started"`);
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    delay(1);
    const r = js(id, "window.__vaR || ''");
    if (r) {
      const o = JSON.parse(r);
      if (o.err) throw new Error(o.err);
      return o.ok;
    }
  }
  throw new Error("timed out waiting for the page");
}

// ------------------------------------------------------------------ Reddit

function redditPosts() {
  const id = openTab(`https://www.reddit.com/r/${SUBREDDIT}/`);
  try {
    return jsAsync(id, `() => fetch("/r/${SUBREDDIT}/top.json?t=week&limit=100&raw_json=1", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => j.data.children.map((c) => c.data).map((d) => ({
        id: d.id, title: d.title, score: d.score, created: d.created_utc, over18: d.over_18,
        stickied: d.stickied, distinguished: d.distinguished, flair: d.link_flair_text,
        text: d.selftext, url: "https://www.reddit.com" + d.permalink })))`, 90);
  } finally {
    closeTab(id);
  }
}

// ------------------------------------------------------------------ ChatGPT

const STATE_JS = `(function () {
  const msgs = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const last = msgs[msgs.length - 1];
  const stop = !!document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop" i]');
  return JSON.stringify({ n: msgs.length, stop, text: last ? last.innerText : "",
    editor: !!document.querySelector("#prompt-textarea"), body: document.body.innerText.slice(-1500) });
})()`;

function chatState(id) {
  return JSON.parse(js(id, STATE_JS) || "{}");
}

function waitForEditor(id) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (chatState(id).editor) return;
    delay(1);
  }
  throw new Error("ChatGPT's message box didn't appear. Are you signed in to chatgpt.com in Chrome?");
}

// Send a message and return ChatGPT's complete reply.
function ask(id, text) {
  showTab(id);
  const before = chatState(id).n || 0;
  const typed = Number(js(id, `(function (text) {
    const ed = document.querySelector("#prompt-textarea");
    if (!ed) return "-1";
    ed.focus();
    if (ed.tagName === "TEXTAREA") {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ed, text);
      ed.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
    }
    return String((ed.value || ed.innerText || "").length);
  })(${JSON.stringify(text)})`));
  if (typed < text.length * 0.8) {
    // fall back to pasting
    js(id, `(function (text) {
      const ed = document.querySelector("#prompt-textarea");
      ed.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    })(${JSON.stringify(text)})`);
  }
  delay(1.5);
  let sent = "";
  for (let i = 0; i < 10 && sent !== "sent"; i++) {
    sent = js(id, `(function () {
      const b = document.querySelector('[data-testid="send-button"], #composer-submit-button, button[aria-label="Send prompt"]');
      if (!b) return "no button";
      if (b.disabled) return "disabled";
      b.click();
      return "sent";
    })()`);
    if (sent !== "sent") delay(1);
  }
  if (sent !== "sent") throw new Error(`Couldn't press ChatGPT's send button (${sent})`);

  // wait for the reply to start...
  let end = Date.now() + 120000;
  let s = chatState(id);
  while (s.n <= before && Date.now() < end) {
    if (R.isLimitMessage(s.body)) throw new LimitReached("ChatGPT says the message limit was reached");
    delay(2);
    s = chatState(id);
  }
  if (s.n <= before) {
    if (R.isLimitMessage(s.body)) throw new LimitReached("ChatGPT says the message limit was reached");
    throw new Error("ChatGPT didn't start replying within 2 minutes");
  }
  // ...and to finish (not writing any more, text unchanged for a few seconds)
  end = Date.now() + 10 * 60000;
  let lastText = "";
  let steady = 0;
  while (Date.now() < end) {
    delay(2);
    s = chatState(id);
    if (!s.stop && s.text && s.text === lastText) steady++;
    else steady = 0;
    lastText = s.text;
    if (steady >= 3) break;
  }
  if (R.isLimitMessage(lastText)) throw new LimitReached("ChatGPT says the message limit was reached");
  if (!lastText) throw new Error("ChatGPT's reply was empty");
  return lastText;
}

// ------------------------------------------------------------------ AI Voice Saver player

// Page code shared by the player functions: finds the first voiceover player (under the script reply),
// looking inside extension "shadow" parts of the page too.
const PLAYER_JS = `
  const VOICES = ${JSON.stringify(KNOWN_VOICES)};
  function everything(root) {
    const out = [];
    const walk = (r) => { for (const e of r.querySelectorAll("*")) { out.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
    walk(root);
    return out;
  }
  function visible(e) { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }
  function findPlayer() {
    const all = everything(document);
    for (const e of all) {
      if (e.closest && e.closest("#prompt-textarea")) continue;
      let voice = null;
      if (e.tagName === "SELECT") {
        const opt = [...e.options].find((o) => VOICES.includes(o.text.trim()));
        if (opt) voice = e.options[e.selectedIndex] ? e.options[e.selectedIndex].text.trim() : opt.text.trim();
      } else if (e.children.length === 0 && VOICES.includes((e.textContent || "").trim())) {
        voice = e.textContent.trim();
      }
      if (!voice || !visible(e)) continue;
      // the player: the nearest box around the voice button that has the audio or its "0:00 / 6:10" time
      let box = null;
      let up = e;
      for (let i = 0; i < 8 && up.parentElement && !box; i++) {
        up = up.parentElement;
        if (up.querySelector("audio") || /\\d+:\\d\\d\\s*\\/\\s*\\d+:\\d\\d/.test(up.innerText || "")) box = up;
      }
      if (!box) box = (e.parentElement && e.parentElement.parentElement) || e.parentElement || e;
      return { el: e, voice, box };
    }
    return null;
  }`;

function playerInfo(id) {
  return JSON.parse(js(id, `(function () { ${PLAYER_JS}
    const p = findPlayer();
    if (!p) return JSON.stringify(null);
    const m = (p.box.innerText || "").match(/\\/\\s*(\\d+):(\\d\\d)/);
    return JSON.stringify({ voice: p.voice, seconds: m ? Number(m[1]) * 60 + Number(m[2]) : 0 });
  })()`) || "null");
}

function waitForPlayer(id, voice, seconds) {
  const end = Date.now() + seconds * 1000;
  let p = null;
  while (Date.now() < end) {
    p = playerInfo(id);
    if (p && (!voice || p.voice === voice)) return p;
    delay(2);
  }
  return p;
}

// Switch the player to the wanted voice, then reload so the extension makes that voiceover.
function chooseVoice(id, voice) {
  let p = waitForPlayer(id, null, 60);
  if (!p) throw new Error("The AI Voice Saver player didn't appear under the reply");
  if (p.voice === voice) return;
  log(`  switching the voice from ${p.voice} to ${voice}`);
  const first = js(id, `(function (want) { ${PLAYER_JS}
    const p = findPlayer();
    if (!p) return "no player";
    if (p.el.tagName === "SELECT") {
      const opt = [...p.el.options].find((o) => o.text.trim() === want);
      if (!opt) return "no option";
      p.el.value = opt.value;
      p.el.dispatchEvent(new Event("input", { bubbles: true }));
      p.el.dispatchEvent(new Event("change", { bubbles: true }));
      return "set";
    }
    (p.el.closest("button, [role=button]") || p.el).click();
    return "opened";
  })(${JSON.stringify(voice)})`);
  if (first === "opened") {
    delay(1);
    const picked = js(id, `(function (want) { ${PLAYER_JS}
      const p = findPlayer();
      const choice = everything(document).find((e) => e !== (p && p.el) && e.children.length === 0 &&
        (e.textContent || "").trim() === want && visible(e));
      if (!choice) return "not in the list";
      (choice.closest("button, [role=option], [role=menuitem], li") || choice).click();
      return "set";
    })(${JSON.stringify(voice)})`);
    if (picked !== "set") throw new Error(`Couldn't choose ${voice} in the voice list (${picked})`);
  } else if (first !== "set") {
    throw new Error(`Couldn't change the voice (${first})`);
  }
  delay(1);
  js(id, "location.reload(); 'ok'");
  waitLoaded(id);
  p = waitForPlayer(id, voice, 120);
  if (!p || p.voice !== voice) throw new Error(`After reloading, the player shows ${p ? p.voice : "nothing"} instead of ${voice}`);
}

function clickDownload(id) {
  const r = js(id, `(function () { ${PLAYER_JS}
    const p = findPlayer();
    if (!p) return "no player";
    const btns = everything(p.box).filter((e) => /^(BUTTON|A)$/.test(e.tagName) || e.getAttribute("role") === "button");
    const byName = btns.find((b) => b.hasAttribute("download") ||
      /download|save/i.test((b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + (b.textContent || "")));
    const b = byName || btns[btns.length - 1];
    if (!b) return "no button";
    b.click();
    return "clicked";
  })()`);
  if (r !== "clicked") throw new Error(`Couldn't click the download button (${r})`);
}

// ------------------------------------------------------------------ Downloads

function voiceoverFiles() {
  const out = sh(`stat -f '%m|%z|%N' ${q(DOWNLOADS)}/chatgpt-* 2>/dev/null || true`);
  return out.split(/\r?\n/).filter((l) => l).map((l) => {
    const [m, z, ...rest] = l.split("|");
    const path = rest.join("|");
    return { mtime: Number(m), size: Number(z), path, name: path.split("/").pop() };
  }).filter((f) => R.isVoiceoverFile(f.name));
}

// The new voiceover in Downloads, once it has finished downloading.
function waitForDownload(sinceSeconds, seconds = 300) {
  const end = Date.now() + seconds * 1000;
  let last = null;
  let steady = 0;
  while (Date.now() < end) {
    delay(2);
    const fresh = voiceoverFiles().filter((f) => f.mtime >= sinceSeconds - 5).sort((a, b) => b.mtime - a.mtime)[0];
    if (!fresh || fresh.size === 0) continue;
    if (last && last.path === fresh.path && last.size === fresh.size) steady++;
    else steady = 0;
    last = fresh;
    if (steady >= 2) return fresh;
  }
  throw new Error("No voiceover showed up in Downloads within 5 minutes");
}

// ------------------------------------------------------------------ one story

function makeStory(post, folder, prompt) {
  log(`Story for ${folder}: "${post.title}" (${post.score} upvotes)`);
  log(`  ${post.url}`);
  const story = R.cleanPostText(post.text);
  const id = openTab("https://chatgpt.com/");
  try {
    waitForEditor(id);
    log(`  sending your prompt with the story (${R.wordCount(story)} words)...`);
    const script = ask(id, `${prompt}\n\n${post.title}\n\n${story}`);
    const who = R.perspectiveOf(script);
    if (!who) throw new Error('ChatGPT\'s reply has no "Perspective: Male/Female" line');
    const voice = VOICES[who];
    log(`  script written; perspective ${who}, so the voice is ${voice}`);

    log("  asking for a title...");
    const options = ask(id, TITLE_QUESTION);
    const best = ask(id, PICK_QUESTION);
    const title = R.cleanTitle(best) || R.cleanTitle(options);
    if (!title) throw new Error("Couldn't read a title from ChatGPT's answer");
    log(`  title: ${title}`);

    chooseVoice(id, voice);
    const ready = waitForPlayer(id, voice, 180);
    if (ready && ready.seconds) log(`  voiceover ready (${Math.floor(ready.seconds / 60)}:${String(ready.seconds % 60).padStart(2, "0")})`);
    const since = Math.floor(Date.now() / 1000);
    log("  downloading the voiceover...");
    clickDownload(id);
    const file = waitForDownload(since);
    const got = R.voiceOfFile(file.name);
    if (got && got !== voice.toLowerCase()) log(`  WARNING: the file says ${got}, expected ${voice}`);

    const dir = `${CLIPS_DIR}/${folder}`;
    sh(`mkdir -p ${q(dir)} && mv -n ${q(file.path)} ${q(dir + "/")}`);
    writeText(`${dir}/title.txt`, title + "\n");
    log(`  saved ${file.name} and title.txt in ${folder}`);
    return { title, voice, file: file.name };
  } finally {
    closeTab(id);
  }
}

// ------------------------------------------------------------------ main

function run(argv) {
  const count = Math.max(1, Number(argv[0]) || 7);
  const here = argv[1] || ".";
  R = eval(`(function () { var module = { exports: {} }; ${readText(here + "/story-rules.js")}
    return module.exports; })()`);
  const prompt = (readText(MY_PROMPT) || readText(here + "/chatgpt-prompt.txt") || "").trim();
  if (!prompt) return "Couldn't find the ChatGPT prompt (chatgpt-prompt.txt).";

  const usedData = JSON.parse(readText(USED_FILE) || '{"stories":[]}');
  const used = new Set(usedData.stories.map((s) => s.id));
  const taken = new Set(ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(CLIPS_DIR, null)) || []);
  const dates = R.nextFreeDates(new Date(), taken, count);

  log(`=== Getting ${count} stor${count === 1 ? "y" : "ies"} for ${dates.join(", ")}`);
  let posts;
  try {
    posts = redditPosts();
  } catch (e) {
    return `Couldn't read Reddit: ${e.message}`;
  }
  const { picked, skipped } = R.pickStories(posts, used, count * 2, Date.now() / 1000);
  log(`Reddit: ${posts.length} posts this week, ${picked.length} usable (skipped ${skipped.length})`);
  skipped.slice(0, 15).forEach((s) => log(`  skipped "${s.post.title.slice(0, 70)}": ${s.reason}`));

  let made = 0;
  let next = 0;
  for (const folder of dates) {
    let done = false;
    while (!done && next < picked.length) {
      const post = picked[next++];
      try {
        const r = makeStory(post, folder, prompt);
        usedData.stories.push({ id: post.id, redditTitle: post.title, url: post.url, folder, title: r.title, voice: r.voice, made: new Date().toISOString() });
        writeText(USED_FILE, JSON.stringify(usedData, null, 2));
        made++;
        done = true;
      } catch (e) {
        if (e instanceof LimitReached) {
          log(`STOPPED: ${e.message}. Made ${made} of ${count}. Run again after the limit resets.`);
          return `Stopped: ChatGPT limit reached after ${made} of ${count} stories.`;
        }
        log(`  FAILED: ${e.message}. Trying the next story.`);
      }
    }
    if (!done) {
      log("Ran out of usable stories on Reddit this week.");
      break;
    }
  }
  log(`=== Done: ${made} of ${count} stories ready.`);
  return `Done: ${made} of ${count} stories ready. Details in ${LOG_FILE}`;
}
