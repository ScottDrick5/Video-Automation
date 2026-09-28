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

// Date folder name like the ones you use: 9-28-26
function folderName(date) {
  return `${date.getMonth() + 1}-${date.getDate()}-${String(date.getFullYear()).slice(-2)}`;
}

// The next `count` dates from `start` (today) that have no folder yet. taken: Set of existing folder names.
function nextFreeDates(start, taken, count) {
  const out = [];
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let i = 0; out.length < count && i < 400; i++) {
    const name = folderName(d);
    if (!taken.has(name)) out.push(name);
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
    perspectiveOf, cleanTitle, folderName, nextFreeDates, isVoiceoverFile, voiceOfFile, isLimitMessage,
  };
}
