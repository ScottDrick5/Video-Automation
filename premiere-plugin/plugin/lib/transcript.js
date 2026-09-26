// Pure helpers for Premiere transcript JSON (no Premiere APIs here, so they can be tested with Node).
//
// Premiere's transcript JSON looks like:
//   { language, speakers: [...], segments: [ { start, duration, words: [ { text, start, duration, type, eos, ... } ] } ] }
// Times are in seconds from the start of the audio file.

const AHOLE_WORDS = new Set(["ahole", "asshole"]);

function norm(text) {
  return String(text || "").toLowerCase().replace(/[^a-z]/g, "");
}

// Every spoken word in order, with a pointer back to where it lives in the JSON.
function flattenWords(transcript) {
  const out = [];
  (transcript.segments || []).forEach((seg, s) => {
    (seg.words || []).forEach((w, i) => {
      if (w.type === "punctuation") return;
      out.push({ text: w.text, start: w.start, duration: w.duration, seg: s, idx: i });
    });
  });
  return out;
}

// Length of the "ahole" phrase starting at words[i]: 1 for "ahole"/"a-hole"/"asshole", 2 for "a hole", else 0.
function aholeLength(words, i) {
  if (i >= words.length) return 0;
  if (AHOLE_WORDS.has(norm(words[i].text))) return 1;
  if (norm(words[i].text) === "a" && i + 1 < words.length && norm(words[i + 1].text) === "hole") return 2;
  return 0;
}

// First "Am I the ahole" (any spelling). Returns null if it isn't in the transcript.
function findCutPoint(transcript) {
  const words = flattenWords(transcript);
  for (let i = 0; i + 3 < words.length; i++) {
    if (norm(words[i].text) === "am" && norm(words[i + 1].text) === "i" && norm(words[i + 2].text) === "the") {
      const n = aholeLength(words, i + 3);
      if (n) {
        const before = words.slice(Math.max(0, i - 6), i).map((w) => w.text).join(" ");
        const after = words.slice(i, i + 3 + n + 6).map((w) => w.text).join(" ");
        return { seconds: words[i].start, wordIndex: i, before, after };
      }
    }
  }
  return null;
}

function splitPunct(text) {
  const m = String(text).match(/^([^A-Za-z]*)(.*?)([^A-Za-z]*)$/);
  return { lead: m[1], trail: m[3] };
}

// Replace every ahole spelling with "A-Hole", keeping punctuation. Returns a new transcript and a list of changes.
function fixAHole(transcript) {
  const copy = JSON.parse(JSON.stringify(transcript));
  const changes = [];
  const words = flattenWords(copy);
  const removals = [];
  for (let i = 0; i < words.length; i++) {
    const n = aholeLength(words, i);
    if (!n) continue;
    const first = copy.segments[words[i].seg].words[words[i].idx];
    const last = copy.segments[words[i + n - 1].seg].words[words[i + n - 1].idx];
    const original = n === 1 ? first.text : `${first.text} ${last.text}`;
    const fixed = splitPunct(first.text).lead + "A-Hole" + splitPunct(last.text).trail;
    if (original !== fixed) {
      changes.push({ seconds: first.start, from: original, to: fixed });
      first.text = fixed;
      if (n === 2) {
        // "a hole" -> one word spanning both
        first.duration = Math.round((last.start + last.duration - first.start) * 1000) / 1000;
        first.eos = last.eos;
        removals.push(words[i + 1]);
      }
    }
    i += n - 1;
  }
  // remove merged words back to front so indexes stay valid
  removals.sort((a, b) => b.seg - a.seg || b.idx - a.idx).forEach((w) => copy.segments[w.seg].words.splice(w.idx, 1));
  return { transcript: copy, changes };
}

module.exports = { norm, flattenWords, findCutPoint, fixAHole };
