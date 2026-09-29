const test = require("node:test");
const assert = require("node:assert");
const u = require("../stories/upload-rules.js");

const files = [
  "chatgpt-juniper.aac", "title.txt", "vidauto-done.txt",
  "AITA - Choosing My Daughter Over My DIL? (Full Video).mp4",
  "AITA - Choosing My Daughter Over My DIL? (Part 1).mp4",
  "AITA - Choosing My Daughter Over My DIL? (Part 2).mp4",
  "AITA - Choosing My Daughter Over My DIL? (Part 6).mp4",
];

test("video names and descriptions", () => {
  assert.deepStrictEqual(u.videoInfo(files[3]), { title: "AITA - Choosing My Daughter Over My DIL? (Full Video)", part: 0 });
  assert.deepStrictEqual(u.videoInfo(files[5]), { title: "AITA - Choosing My Daughter Over My DIL? (Part 2)", part: 2 });
  assert.strictEqual(u.videoInfo("title.txt"), null);
  assert.strictEqual(
    u.description("AITA - Choosing My Daughter Over My DIL? (Part 1)", "Orbital"),
    "AITA - Choosing My Daughter Over My DIL? (Part 1)\n\nGameplay Video Credit: Orbital\n\n#storytime #redditstoryteller #RelationshipDrama #reddit",
  );
  assert.strictEqual(u.creditFromAuthor('(\n    "Orbital - No Copyright Gameplay"\n)'.replace(/\n\s*/g, "")), "Orbital");
  assert.strictEqual(u.creditFromAuthor("(null)"), null);
});

test("YouTube plan: full video 11:30 AM, parts every two hours from 1:30 PM, no Part 6", () => {
  const now = new Date(2026, 8, 29, 9, 0);
  const { items, skipped } = u.uploadPlan("youtube", [{ name: "10-02-26", files, credit: "Orbital" }], new Set(), now);
  assert.deepStrictEqual(items.map((i) => [i.file.match(/\((.*)\)/)[1], u.studioDate(i.when), u.studioTime(i.when)]), [
    ["Full Video", "Oct 2, 2026", "11:30 AM"],
    ["Part 1", "Oct 2, 2026", "1:30 PM"],
    ["Part 2", "Oct 2, 2026", "3:30 PM"],
  ]);
  assert.match(skipped[0], /Part 6 of 10-02-26/);
});

test("Facebook gets only the full video at 1:30 PM; done uploads and past times are skipped", () => {
  const now = new Date(2026, 8, 29, 9, 0);
  const fb = u.uploadPlan("facebook", [{ name: "10-02-26", files, credit: "Orbital" }], new Set(), now);
  assert.deepStrictEqual(fb.items.map((i) => u.studioTime(i.when)), ["1:30 PM"]);
  const done = new Set(["youtube|10-02-26|" + files[3]]);
  assert.strictEqual(u.uploadPlan("youtube", [{ name: "10-02-26", files, credit: "Orbital" }], done, now).items.length, 2);
  const noon = new Date(2026, 8, 29, 12, 0);
  const late = u.uploadPlan("youtube", [{ name: "9-29-26", files, credit: "Orbital" }], new Set(), noon);
  assert.deepStrictEqual(late.items.map((i) => u.studioTime(i.when)), ["1:30 PM", "3:30 PM"]);
  assert.match(late.skipped[0], /Full Video.*too soon or already past/);
});
