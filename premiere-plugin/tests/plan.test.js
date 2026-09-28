// Run with: node --test premiere-plugin/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert");
const { footageCheck, folderDate, foldersToDo, chooseSource, fillScale, timecodeToSeconds, videoSizeFrom, formatTime } = require("../plugin/lib/plan");

test("folder names are read as posting dates", () => {
  assert.strictEqual(folderDate("9-25-26"), 20260925);
  assert.strictEqual(folderDate("09-05-2026"), 20260905);
  assert.strictEqual(folderDate("Source Video"), null);
});

test("only date folders with a voiceover and no finished video, oldest first", () => {
  const todo = foldersToDo([
    { name: "10-1-26", files: ["chatgpt-juniper.aac"] },
    { name: "9-25-26", files: ["vo.mp3", "AITA.mp4"] }, // done
    { name: "9-27-26", files: ["b.aac", "a.aac"] },
    { name: "9-28-26", files: ["notes.txt"] }, // no voiceover yet
    { name: "9-29-26", files: ["vo.aac", "title.txt", "AITA - My Story (Full Video).mp4", "AITA - My Story (Part 1).mp4"] }, // done
    { name: "9-30-26", files: ["vo.aac", "AITA - My Story (Part 1).mp4"] }, // clips only: full video missing
    { name: "10-01-26", files: ["vo.aac", "AITA - My Story (Full Video).mp4"] }, // clips failed: make again
    { name: "10-02-26", files: ["vo.aac", "vidauto-done.txt"] }, // done
    { name: "misc", files: ["x.aac"] }, // not a date
  ]);
  assert.deepStrictEqual(todo.map((f) => [f.name, f.voiceover]), [["9-27-26", "b.aac"], ["9-30-26", "vo.aac"], ["10-1-26", "chatgpt-juniper.aac"], ["10-01-26", "vo.aac"]]);
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

test("timecode can be typed in several ways", () => {
  for (const tc of ["00;07;45;01", "7;45;01", "00:07:45:01", "7:45:01"]) {
    assert.ok(Math.abs(timecodeToSeconds(tc) - 465.03) < 0.1, tc);
  }
  assert.strictEqual(timecodeToSeconds("7:45"), 465);
  assert.strictEqual(timecodeToSeconds("seven"), null);
});

test("video size is read from the Video Info column", () => {
  assert.deepStrictEqual(videoSizeFrom("3840 x 2160 (1.0)"), { width: 3840, height: 2160 });
  assert.strictEqual(videoSizeFrom("Stereo"), null);
});

test("long durations show hours", () => {
  assert.strictEqual(formatTime(36336), "10:05:36");
  assert.strictEqual(formatTime(605.6), "10:06");
});

test("footage check for a whole batch", () => {
  const videos = [{ name: "a.mp4", created: 1 }, { name: "b.mp4", created: 2 }];
  const usage = { "a.mp4": { usedUpTo: 500, duration: 1200 }, "b.mp4": { duration: 900 } };
  // a has 700 s left: 300 + 300 fit, the third (400) moves to b (900 s)
  assert.deepStrictEqual(footageCheck(videos, usage, [300, 300, 400]), { ok: true });
  // 300+300 in a, 400+400 in b, the next 400 doesn't fit anywhere
  const r = footageCheck(videos, usage, [300, 300, 400, 400, 400]);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.done, 4);
  assert.strictEqual(usage["a.mp4"].usedUpTo, 500, "usage is not changed");
  assert.strictEqual(footageCheck([...videos, { name: "c.mp4", created: 3 }], usage, [300, 300, 400, 400, 400]).ok, null);
});
