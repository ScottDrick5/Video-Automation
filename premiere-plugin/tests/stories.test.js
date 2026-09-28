const test = require("node:test");
const assert = require("node:assert");
const r = require("../stories/story-rules.js");

const now = 1790000000;
const long = "word ".repeat(1500);
function post(extra) {
  return { id: "a", title: "AITA for refusing to cancel my trip", score: 100, created: now - 3600, over18: false, stickied: false, distinguished: null, text: long, ...extra };
}

test("cleanPostText turns Reddit markdown into plain text", () => {
  const md = "I am not The OOP, OOP is [u/someone](https://reddit.com/u/x)\n\n**Original Post** &amp; more &lt;3\n\n&#x200B;\n\n> quoted";
  assert.strictEqual(r.cleanPostText(md), "I am not The OOP, OOP is u/someone\n\nOriginal Post & more <3\n\nquoted");
});

test("skip rules", () => {
  const used = new Set(["old"]);
  assert.strictEqual(r.skipReason(post(), used, now), "");
  assert.strictEqual(r.skipReason(post({ id: "old" }), used, now), "already used");
  assert.strictEqual(r.skipReason(post({ over18: true }), used, now), "NSFW");
  assert.strictEqual(r.skipReason(post({ stickied: true }), used, now), "moderator post");
  assert.strictEqual(r.skipReason(post({ created: now - 8 * 86400 }), used, now), "older than a week");
  assert.match(r.skipReason(post({ text: "Content Warnings: domestic violence, cheating\n" + long }), used, now), /content warning/);
  assert.strictEqual(r.skipReason(post({ text: "Content warnings: cheating\n" + long }), used, now), "");
  assert.match(r.skipReason(post({ title: "My brother was murdered" }), used, now), /title mentions/);
  assert.match(r.skipReason(post({ text: "short story" }), used, now), /too short/);
});

test("pickStories takes the most upvoted usable posts", () => {
  const posts = [
    post({ id: "1", score: 50 }), post({ id: "2", score: 500, over18: true }), post({ id: "3", score: 300 }),
    post({ id: "4", score: 200 }), post({ id: "5", score: 10 }),
  ];
  const { picked, skipped } = r.pickStories(posts, new Set(), 2, now);
  assert.deepStrictEqual(picked.map((p) => p.id), ["3", "4"]);
  assert.deepStrictEqual(skipped.map((s) => s.post.id), ["2"]);
});

test("perspective, title and file names", () => {
  assert.strictEqual(r.perspectiveOf("Perspective: Female\n\nHook options..."), "female");
  assert.strictEqual(r.perspectiveOf("**Perspective:** Male"), "male");
  assert.strictEqual(r.perspectiveOf("no idea"), null);
  assert.strictEqual(r.cleanTitle('**"I Thought I Was Going to Lose Her"**'), "I Thought I Was Going to Lose Her");
  assert.strictEqual(r.cleanTitle("1. Choose Me Instead\n2. Other"), "Choose Me Instead");
  assert.strictEqual(r.cleanTitle("Title: A Fake Family Secret"), "A Fake Family Secret");
  assert.ok(r.isVoiceoverFile("chatgpt-juniper-2026-09-27_20-21-08.aac"));
  assert.ok(!r.isVoiceoverFile("chatgpt-juniper-2026.aac.crdownload"));
  assert.strictEqual(r.voiceOfFile("chatgpt-ember-2026-09-28_03-08-28.mp3"), "ember");
  assert.ok(r.isLimitMessage("You've reached our limit of messages. Try again later."));
  assert.ok(!r.isLimitMessage("There is no limit to how much she lied."));
});

test("next free date folders (9-28-26, 10-02-26; other spellings of a date still count)", () => {
  const start = new Date(2026, 8, 28);
  assert.strictEqual(r.folderName(start), "9-28-26");
  assert.strictEqual(r.folderName(new Date(2026, 9, 2)), "10-02-26");
  const taken = new Set(["9-28-26", "09-29-26", "10-1-26"]);
  assert.deepStrictEqual(r.nextFreeDates(start, taken, 3), ["9-30-26", "10-02-26", "10-03-26"]);
});

test("ChatGPT's favourite title", () => {
  const reply = `Here are a few short, Facebook-friendly title ideas that fit the emotional tone of the story:
1. Abandoned by Both Parents ⭐ *(my favorite)*
2. Her Brother Became Dad
3. The Brother Who Never Left

I think "Abandoned by Both Parents" is the strongest because it immediately creates curiosity.`;
  assert.strictEqual(r.favoriteTitle(reply), "Abandoned by Both Parents");
  assert.strictEqual(r.favoriteTitle(reply.replace(" ⭐ *(my favorite)*", "").replace(/"Abandoned by Both Parents"/, '"Her Brother Became Dad"')), "Her Brother Became Dad");
  assert.strictEqual(r.favoriteTitle("Ideas:\n1. First One\n2. Second One"), "First One");
});

test("weekly batch: next missing date through Sunday", () => {
  const mon = new Date(2026, 8, 28); // Monday 9-28-26
  // nothing made this week yet: the whole week
  assert.deepStrictEqual(r.weekBatch(mon, new Set()), ["9-28-26", "9-29-26", "9-30-26", "10-01-26", "10-02-26", "10-03-26", "10-04-26"]);
  // Monday to Wednesday already made: Thursday to Sunday
  assert.deepStrictEqual(r.weekBatch(mon, new Set(["9-28-26", "9-29-26", "9-30-26"])), ["10-01-26", "10-02-26", "10-03-26", "10-04-26"]);
  // this week complete: all of next week
  const full = new Set(["9-28-26", "9-29-26", "9-30-26", "10-01-26", "10-02-26", "10-03-26", "10-04-26"]);
  assert.deepStrictEqual(r.weekBatch(mon, full), ["10-05-26", "10-06-26", "10-07-26", "10-08-26", "10-09-26", "10-10-26", "10-11-26"]);
  // a gap in the middle of the week is filled too
  assert.deepStrictEqual(r.weekBatch(mon, new Set(["9-28-26", "9-30-26"])), ["9-29-26", "10-01-26", "10-02-26", "10-03-26", "10-04-26"]);
});
