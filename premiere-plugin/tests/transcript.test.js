// Run with: node --test premiere-plugin/tests
const test = require("node:test");
const assert = require("node:assert");
const { findCutPoint, fixAHole, flattenWords } = require("../plugin/lib/transcript");

function transcriptFrom(...segments) {
  let t = 0;
  return {
    language: "en-us",
    speakers: [{ id: "631fbbc0-9c02-47c4-bb8c-732c020fa24f", name: "Unknown" }],
    segments: segments.map((text) => {
      const start = t;
      const words = text.split(" ").map((w) => {
        const word = { confidence: 1, duration: 0.3, eos: /[.?!]$/.test(w), start: t, tags: [], text: w, type: "word" };
        t = Math.round((t + 0.4) * 1000) / 1000;
        return word;
      });
      return { duration: t - start, language: "en-us", speaker: "631fbbc0-9c02-47c4-bb8c-732c020fa24f", start, words };
    }),
  };
}

const HOOKS = "Prospective female hook. Option one. She said I should have died instead. Hook option two.";

test("finds the first 'Am I the ahole' after the hooks", () => {
  const t = transcriptFrom(HOOKS, "Am I the ahole for never telling my mom? When I was 15,");
  const cut = findCutPoint(t);
  assert.ok(cut);
  assert.strictEqual(flattenWords(t)[cut.wordIndex].text, "Am");
  assert.strictEqual(cut.seconds, flattenWords(t)[cut.wordIndex].start);
  assert.strictEqual(cut.wordIndex, HOOKS.split(" ").length);
});

test("accepts a-hole, asshole and 'a hole' spellings", () => {
  for (const phrase of ["Am I the a-hole for", "Am I the asshole for", "am I the A hole for", "Am I the AHOLE for"]) {
    assert.ok(findCutPoint(transcriptFrom("Intro words here.", phrase)), phrase);
  }
});

test("returns null when the phrase is missing", () => {
  assert.strictEqual(findCutPoint(transcriptFrom("Am I wrong for leaving?")), null);
});

test("fixes every spelling to A-Hole and keeps punctuation", () => {
  const t = transcriptFrom("Am I the ahole for this? He called me an asshole. Such an a-hole, honestly.");
  const { transcript, changes } = fixAHole(t);
  const text = flattenWords(transcript).map((w) => w.text).join(" ");
  assert.strictEqual(text, "Am I the A-Hole for this? He called me an A-Hole. Such an A-Hole, honestly.");
  assert.strictEqual(changes.length, 3);
  // original is untouched
  assert.ok(flattenWords(t).some((w) => w.text === "ahole"));
});

test("merges 'a hole' into one word", () => {
  const { transcript } = fixAHole(transcriptFrom("Am I the a hole? Yes."));
  const words = flattenWords(transcript);
  assert.deepStrictEqual(words.map((w) => w.text), ["Am", "I", "the", "A-Hole?", "Yes."]);
  assert.strictEqual(words[3].duration, 0.7);
});

test("leaves an already-correct A-Hole alone", () => {
  assert.strictEqual(fixAHole(transcriptFrom("Am I the A-Hole here?")).changes.length, 0);
});
