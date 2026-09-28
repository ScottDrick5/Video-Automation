const test = require("node:test");
const assert = require("node:assert");
const {
  sequenceWords, loudnessFromWav, cutCandidates, planClips, fullArrowTimes, outputName, arrowColor,
} = require("../plugin/lib/clips.js");

// Speech with a word every 0.4 s and a 0.8 s pause after every sentence (every 12 words).
function speech(seconds) {
  const words = [];
  let t = 0;
  let n = 0;
  while (t < seconds) {
    n++;
    words.push({ text: n % 12 === 0 ? "end." : "word", start: t, end: t + 0.3, eos: n % 12 === 0 });
    t += n % 12 === 0 ? 1.1 : 0.4;
  }
  return words;
}

function lengths(cuts) {
  return cuts.slice(1).map((c, i) => c - cuts[i]);
}

test("sequenceWords drops words before the cut and marks sentence ends", () => {
  const transcript = {
    segments: [{
      words: [
        { text: "Hi", start: 1, duration: 0.2 },
        { text: "Am", start: 5, duration: 0.2 },
        { text: "done", start: 6, duration: 0.3 },
        { text: ".", start: 6.3, duration: 0, type: "punctuation" },
        { text: "Next", start: 7, duration: 0.3 },
      ],
    }],
  };
  const w = sequenceWords(transcript, 5);
  assert.deepStrictEqual(w.map((x) => x.text), ["Am", "done", "Next"]);
  assert.strictEqual(w[0].start, 0);
  assert.strictEqual(w[1].eos, true);
  assert.strictEqual(w[2].eos, false);
});

test("a video under 1:58 is one clip", () => {
  assert.deepStrictEqual(planClips(100, cutCandidates(speech(100))), [0, 100]);
});

test("clips are at most 1:58, at least 1:00, and cut at pauses", () => {
  for (const total of [240, 300, 360, 420, 480, 250, 125, 237]) {
    const words = speech(total);
    const cuts = planClips(total, cutCandidates(words));
    const lens = lengths(cuts);
    assert.ok(lens.every((l) => l <= 118.01), `${total}: ${lens}`);
    assert.ok(lens.every((l) => l >= 59.99), `${total}: ${lens}`);
    for (const c of cuts.slice(1, -1)) {
      const inPause = words.some((w, i) => i + 1 < words.length && w.eos && c > w.end && c < words[i + 1].start);
      assert.ok(inPause, `${total}: cut at ${c} is not at the end of a sentence`);
    }
  }
});

test("a short last clip makes the last two share the time evenly", () => {
  const cuts = planClips(250, cutCandidates(speech(250)));
  const lens = lengths(cuts);
  assert.strictEqual(lens.length, 3);
  assert.ok(lens[0] > 100, `first clip stays long: ${lens}`);
  assert.ok(Math.abs(lens[1] - lens[2]) < 22, `last two about even: ${lens}`);
});

test("with no pauses at all it still cuts, mid-sentence", () => {
  const cuts = planClips(300, []);
  assert.ok(lengths(cuts).every((l) => l <= 118 && l >= 60), String(lengths(cuts)));
});

test("a dip in the sound beats an equal pause without one", () => {
  const words = [
    { text: "a", start: 0, end: 1, eos: false },
    { text: "b", start: 1.2, end: 2, eos: false },
    { text: "c", start: 2.2, end: 3, eos: false },
  ];
  // loudness every 0.05 s: loud everywhere except in the pause after "b"
  const rms = Array.from({ length: 80 }, (_, i) => (i * 0.05 > 2 && i * 0.05 < 2.2 ? 0.01 : 0.3));
  const cands = cutCandidates(words, { step: 0.05, rms, average: 0.3, offset: 0 });
  assert.ok(cands[1].score > cands[0].score);
});

test("loudnessFromWav reads a 16-bit mono WAV", () => {
  const rate = 1000;
  const samples = 1000; // 1 s: first half loud, second half silent
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) v.setInt16(44 + i * 2, i < 500 ? (i % 2 ? 16000 : -16000) : 0, true);
  const loud = loudnessFromWav(buf, 0.1);
  assert.strictEqual(loud.rms.length, 10);
  assert.ok(loud.rms[0] > 0.4 && loud.rms[9] === 0);
  assert.ok(Math.abs(loud.average - loud.rms[0]) < 1e-9);
});

test("arrow times, file names and colours", () => {
  assert.deepStrictEqual(fullArrowTimes(500), [100, 200, 300, 400]);
  assert.strictEqual(outputName("I Ruined Her Graduation", "Full Video"), "AITA - I Ruined Her Graduation (Full Video).mp4");
  assert.strictEqual(outputName(" Mom/Dad:  fight ", "Part 2"), "AITA - Mom-Dad- fight (Part 2).mp4");
  assert.deepStrictEqual(arrowColor("9-28-26"), arrowColor("9-28-26"));
  const c = arrowColor("9-28-26");
  assert.ok(c.hue >= 0 && c.hue <= 360 && c.lightness >= 30 && c.lightness <= 38);
  assert.notDeepStrictEqual(arrowColor("9-28-26"), arrowColor("9-29-26"));
});
