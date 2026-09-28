// Run with: node --test premiere-plugin/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert");
const { folderDate, foldersToDo, chooseSource, fillScale, timecodeToSeconds, formatTime } = require("../plugin/lib/plan");

test("folder names are read as posting dates", () => {
  assert.strictEqual(folderDate("9-25-26"), 20260925);
  assert.strictEqual(folderDate("09-05-2026"), 20260905);
  assert.strictEqual(folderDate("Source Video"), null);
});

test("only date folders with a voiceover and no AITA.mp4, oldest first", () => {
  const todo = foldersToDo([
    { name: "10-1-26", files: ["chatgpt-juniper.aac"] },
    { name: "9-25-26", files: ["vo.mp3", "AITA.mp4"] }, // done
    { name: "9-27-26", files: ["b.aac", "a.aac"] },
    { name: "9-28-26", files: ["notes.txt"] }, // no voiceover yet
    { name: "misc", files: ["x.aac"] }, // not a date
  ]);
  assert.deepStrictEqual(todo.map((f) => [f.name, f.voiceover]), [["9-27-26", "b.aac"], ["10-1-26", "chatgpt-juniper.aac"]]);
});

test("continues the oldest video where the last one stopped", () => {
  const videos = [{ name: "new.mp4", created: 2 }, { name: "old.mp4", created: 1 }];
  const usage = { "old.mp4": { usedUpTo: 465, duration: 1800 }, "new.mp4": { duration: 1200 } };
  assert.deepStrictEqual(chooseSource(videos, usage, 467), { name: "old.mp4", start: 465, remainingAfter: 868, skipped: [] });
});

test("moves to the next video when the current one is too short", () => {
  const videos = [{ name: "old.mp4", created: 1 }, { name: "new.mp4", created: 2 }];
  const usage = { "old.mp4": { usedUpTo: 1500, duration: 1800 }, "new.mp4": { duration: 1200 } };
  const pick = chooseSource(videos, usage, 467);
  assert.strictEqual(pick.name, "new.mp4");
  assert.strictEqual(pick.start, 0);
  assert.deepStrictEqual(pick.skipped, [{ name: "old.mp4", left: 300 }]);
});

test("explains when no video has enough left", () => {
  const pick = chooseSource([{ name: "old.mp4", created: 1 }], { "old.mp4": { usedUpTo: 1500, duration: 1800 } }, 467);
  assert.match(pick.error, /needs 7:47/);
  assert.match(pick.error, /old\.mp4 has 5:00 left/);
});

test("asks to measure a video it hasn't seen before", () => {
  assert.deepStrictEqual(chooseSource([{ name: "v.mp4" }], {}, 100), { name: "v.mp4", start: 0, needsMeasuring: true, skipped: [] });
});

test("fill scale covers the vertical frame", () => {
  const s = fillScale(3840, 2160);
  assert.ok(s >= 88.89 && s < 89, s);
  assert.ok((3840 * s) / 100 >= 1080 && (2160 * s) / 100 >= 1920);
  assert.ok(fillScale(1920, 1080) >= 177.78);
});

test("drop-frame timecode converts to real seconds", () => {
  assert.ok(Math.abs(timecodeToSeconds("00;07;45;01") - 465.03) < 0.05);
  assert.ok(Math.abs(timecodeToSeconds("00;10;00;00") - 600) < 0.01);
  assert.strictEqual(formatTime(467.4), "7:47");
});
