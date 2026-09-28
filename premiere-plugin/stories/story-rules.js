// Rules for Stage 0 (picking Reddit stories, reading ChatGPT's replies, naming folders). Plain JavaScript with
// no Mac or browser parts, so it can be tested with Node and loaded by stories.js on the Mac.

// Content-warning words that mean a story is skipped (violent or similar topics)
const SKIP_WARNINGS = [
  "violence", "violent", "abuse", "abusive", "assault", "death", "dying", "died", "suicide", "self harm",
  "self-harm", "murder", "kill", "rape", "sexual assault", "gore", "weapon", "gun", "stab", "shooting",
  "domestic", "strangl", "torture", "overdose",
];
// Words in a post title that mean it is skipped even without a content-warning line
const SKIP_TITLE_WORDS = ["murder", "killed", "suicide", "rape", "assault", "stabbed", "shot ", "overdose", "abuse"];

const MIN_WORDS = 1000; // shorter posts don't make a 4-minute reel
const MAX_WORDS = 7000;

function decodeEntities(text) {
  return String(text || "")
    .replace(/&amp;#x200B;|&#x200B;|​/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Reddit markdown -> plain story text: links become their words, formatting marks go.
function cleanPostText(markdown) {
  return decodeEntities(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [words](link) -> words
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, "") // headings
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,!?])/g, "$1$2") // italics
    .replace(/^[ \t]*>[ \t]?/gm, "") // quotes
    .replace(/\^\(([^)]*)\)/g, "$1")
    .replace(/\^/g, "")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/^[ \t]*[-*]{3,}[ \t]*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wordCount(text) {
  return (String(text).match(/\S+/g) || []).length;
}

// The post's "Content warnings: ..." / "Trigger warning: ..." line, lower-cased ("" if none)
function contentWarnings(text) {
  const m = String(text).match(/(?:content|trigger)\s*warnings?\s*[:\-–]\s*([^\n]*)/i) || String(text).match(/\b(?:CW|TW)\s*[:\-–]\s*([^\n]*)/);
  return m ? m[1].toLowerCase() : "";
}

// Why a post can't be used, or "" if it can.
// post: { id, title, score, created (seconds), over18, stickied, distinguished, text }
function skipReason(post, used, nowSeconds) {
  if (used.has(post.id)) return "already used";
  if (post.over18) return "NSFW";
  if (post.stickied || post.distinguished) return "moderator post";
  if (nowSeconds - post.created > 7 * 24 * 3600) return "older than a week";
  const cw = contentWarnings(post.text);
  const hit = SKIP_WARNINGS.find((w) => cw.includes(w));
  if (hit) return `content warning: ${hit}`;
  const t = String(post.title).toLowerCase() + " ";
  const tHit = SKIP_TITLE_WORDS.find((w) => t.includes(w));
  if (tHit) return `title mentions "${tHit.trim()}"`;
  const words = wordCount(cleanPostText(post.text));
  if (words < MIN_WORDS) return `too short (${words} words)`;
  if (words > MAX_WORDS) return `too long (${words} words)`;
  return "";
}

// The best usable posts, most upvoted first. Returns { picked: [...], skipped: [{post, reason}] }
function pickStories(posts, used, count, nowSeconds) {
  const picked = [];
  const skipped = [];
  for (const p of [...posts].sort((a, b) => b.score - a.score)) {
    if (picked.length >= count) break;
    const reason = skipReason(p, used, nowSeconds);
    if (reason) skipped.push({ post: p, reason });
    else picked.push(p);
  }
  return { picked, skipped };
}

// "Perspective: Male" / "Perspective: Female" at the start of ChatGPT's reply -> "male" / "female" / null
function perspectiveOf(reply) {
  const m = String(reply).match(/perspective\s*[:\-–]?\s*\**\s*(male|female|man|woman)/i);
  if (!m) return null;
  return /^(female|woman)$/i.test(m[1]) ? "female" : "male";
}

// A title from ChatGPT's answer: first real line, without quotes, numbering, "Title:" or markdown.
function cleanTitle(reply) {
  const lines = String(reply).split(/\n/).map((l) => l.trim()).filter((l) => l);
  for (let line of lines) {
    line = line
      .replace(/\*\*|__|`/g, "")
      .replace(/^(\d+[.)]|[-*•])\s*/, "")
      .replace(/^(best\s+)?title\s*[:\-–]\s*/i, "")
      .replace(/^["“'‘]+|["”'’]+$/g, "")
      .trim();
    if (line && wordCount(line) <= 12) return line;
  }
  return null;
}

// ChatGPT's favourite from its list of titles: the one marked with a star or "(my favorite)", else the one it
// calls the strongest/best in quotes, else the first one in the list.
function favoriteTitle(reply) {
  const text = String(reply);
  const lines = text.split(/\n/).map((l) => l.trim()).filter((l) => l);
  const marked = lines.find((l) => /⭐|★|\(my favou?rite\)/i.test(l));
  const tidy = (l) => cleanTitle(l.replace(/⭐|★|🌟|\uFE0F/g, "").replace(/\*?\(my favou?rite\)\*?/i, "").replace(/[_*]+\s*$/, ""));
  if (marked) return tidy(marked);
  const praised = text.match(/["“]([^"”\n]{2,80})["”][^.\n]{0,40}\b(strongest|best|favou?rite|top pick)\b/i);
  if (praised) return cleanTitle(praised[1]);
  const first = lines.find((l) => /^(\d+[.)]|[-*•])\s+/.test(l));
  return first ? tidy(first) : cleanTitle(text);
}

// Date folder name like yours: month without a leading zero, two-digit day, two-digit year: 9-28-26, 10-02-26
function pad2(n) {
  return String(n).padStart(2, "0");
}

function folderName(date) {
  return `${date.getMonth() + 1}-${pad2(date.getDate())}-${String(date.getFullYear()).slice(-2)}`;
}

// "9-28-26" and "09-28-26" are the same date
function sameDateKey(name) {
  const m = String(name).match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  return m ? `${Number(m[1])}-${Number(m[2])}-${m[3].slice(-2)}` : String(name);
}

// The next `count` dates from `start` (today) that have no folder yet. taken: existing folder names.
function nextFreeDates(start, taken, count) {
  const have = new Set([...taken].map(sameDateKey));
  const out = [];
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let i = 0; out.length < count && i < 400; i++) {
    const name = folderName(d);
    if (!have.has(sameDateKey(name))) out.push(name);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// This week's batch: from the next date without a folder through that week's Sunday (weeks run Monday to
// Sunday), skipping dates that already have a folder. If a whole week is missing, that's 7 dates.
function weekBatch(start, taken) {
  const have = new Set([...taken].map(sameDateKey));
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let i = 0; i < 400 && have.has(sameDateKey(folderName(d))); i++) d.setDate(d.getDate() + 1);
  const out = [];
  const daysToSunday = (7 - d.getDay()) % 7; // getDay: Sunday 0, Monday 1 ... Saturday 6
  for (let i = 0; i <= daysToSunday; i++) {
    const name = folderName(d);
    if (!have.has(sameDateKey(name))) out.push(name);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// A voiceover download from the AI Voice Saver extension: chatgpt-<voice>-<date>.<ext>
function isVoiceoverFile(name) {
  return /^chatgpt-[a-z]+-.*\.(aac|mp3|wav|m4a|opus|ogg)$/i.test(name);
}

function voiceOfFile(name) {
  const m = String(name).match(/^chatgpt-([a-z]+)-/i);
  return m ? m[1].toLowerCase() : null;
}

// ChatGPT's "you've hit the limit" messages
function isLimitMessage(text) {
  return /(you['’]ve|you have)\s+(hit|reached)\s+(the|your|our)\b[^.]{0,40}\blimit|usage (limit|cap)|limit resets|try again (later|after)/i.test(String(text));
}

if (typeof module !== "undefined") {
  module.exports = {
    SKIP_WARNINGS, MIN_WORDS, MAX_WORDS, cleanPostText, wordCount, contentWarnings, skipReason, pickStories,
    perspectiveOf, cleanTitle, favoriteTitle, folderName, nextFreeDates, weekBatch, isVoiceoverFile, voiceOfFile, isLimitMessage,
  };
}
