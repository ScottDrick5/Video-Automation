// Pure helpers for Stage 2 (no Premiere APIs, so they can be tested with Node): where to cut the
// Facebook clips, names for the exported files, and the arrow colour for a date.

const MAX_CLIP = 118; // 1:58
const MIN_CLIP = 60; // anything shorter counts as too short

// Spoken words on the sequence's clock (the voiceover starts at "Am I the ahole" = 0:00).
// Keeps Premiere's end-of-sentence flag so cuts can prefer the end of a sentence.
function sequenceWords(transcript, cutSeconds) {
  const out = [];
  for (const seg of transcript.segments || []) {
    for (const w of seg.words || []) {
      if (w.type === "punctuation") {
        if (out.length && /[.!?]/.test(w.text || "")) out[out.length - 1].eos = true;
        continue;
      }
      const start = w.start - cutSeconds;
      if (start < 0) continue;
      out.push({ text: w.text, start, end: start + (w.duration || 0), eos: !!w.eos || /[.!?]["')]*$/.test(w.text || "") });
    }
  }
  return out;
}

// Loudness of a 16-bit mono WAV, one RMS value per `step` seconds. Returns { step, rms, average } or null.
function loudnessFromWav(buffer, step = 0.05) {
  const view = new DataView(buffer);
  if (view.byteLength < 44 || view.getUint32(0, false) !== 0x52494646) return null; // "RIFF"
  let rate = 0;
  let bits = 0;
  let channels = 1;
  let pos = 12;
  while (pos + 8 <= view.byteLength) {
    const id = view.getUint32(pos, false);
    const size = view.getUint32(pos + 4, true);
    if (id === 0x666d7420) {
      // "fmt "
      channels = view.getUint16(pos + 10, true);
      rate = view.getUint32(pos + 12, true);
      bits = view.getUint16(pos + 22, true);
    } else if (id === 0x64617461) {
      // "data"
      if (!rate || bits !== 16) return null;
      const frame = channels * 2;
      const perStep = Math.max(1, Math.round(rate * step));
      const total = Math.floor(Math.min(size, view.byteLength - pos - 8) / frame);
      const rms = [];
      for (let i = 0; i < total; i += perStep) {
        let sum = 0;
        const n = Math.min(perStep, total - i);
        for (let j = 0; j < n; j++) {
          const v = view.getInt16(pos + 8 + (i + j) * frame, true) / 32768;
          sum += v * v;
        }
        rms.push(Math.sqrt(sum / n));
      }
      const speaking = rms.filter((r) => r > 0.005);
      const average = speaking.length ? speaking.reduce((a, b) => a + b, 0) / speaking.length : 0;
      return { step, rms, average };
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

// Quietest moment between from and to (sequence seconds). loud.offset = sequence 0:00 in the audio file.
function quietest(loud, from, to) {
  if (!loud || !loud.average) return null;
  const a = Math.max(0, Math.floor((from + loud.offset) / loud.step));
  const b = Math.min(loud.rms.length - 1, Math.ceil((to + loud.offset) / loud.step));
  let best = null;
  for (let i = a; i <= b; i++) if (best === null || loud.rms[i] < loud.rms[best]) best = i;
  if (best === null) return null;
  return { time: best * loud.step + loud.step / 2 - loud.offset, level: loud.rms[best] / loud.average };
}

// Every place between two words where a cut could go, with how good a spot it is:
// a longer pause, the end of a sentence, and a dip in the sound (lower than average) all count.
function cutCandidates(words, loud) {
  const out = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i];
    const b = words[i + 1];
    const gap = Math.max(0, b.start - a.end);
    const q = quietest(loud, a.end - 0.05, b.start + 0.05);
    const dip = q ? Math.max(0, 1 - q.level) : 0; // 1 = silent, 0 = as loud as average speech
    const time = q && q.time > a.end - 0.05 && q.time < b.start + 0.05 ? q.time : (a.end + b.start) / 2;
    const score = Math.min(gap, 1.5) * 3 + (a.eos ? 1.5 : 0) + dip * 2;
    out.push({ time, score, gap, eos: a.eos, after: a.text });
  }
  return out;
}

// Best spot to cut between from and to (sequence seconds), leaning slightly toward `target`.
// If there is no break between words at all there, cut at `target` (mid-sentence, the last resort).
function bestCut(cands, from, to, target) {
  let best = null;
  const span = Math.max(1, to - from);
  for (const c of cands) {
    if (c.time < from || c.time > to) continue;
    const s = c.score - (Math.abs(c.time - target) / span) * 0.75;
    if (!best || s > best.s) best = { ...c, s };
  }
  return best ? best.time : target;
}

// Where to cut the full video into clips of at most 1:58, each ending at a pause.
// Clips are filled up to 1:58; if the last one would be under a minute, the last two share the time
// evenly; if that still leaves one under a minute, every clip gets the same length.
// Returns the clip boundaries in seconds: [0, cut1, cut2, ..., total].
function planClips(total, cands, max = MAX_CLIP, min = MIN_CLIP) {
  if (total <= max) return [0, total];
  const LOOK = 20; // how far before the limit to look for a pause
  const cuts = [0];
  while (total - cuts[cuts.length - 1] > max) {
    const from = cuts[cuts.length - 1];
    cuts.push(bestCut(cands, from + max - LOOK, from + max, from + max));
  }
  cuts.push(total);
  const last = () => cuts[cuts.length - 1] - cuts[cuts.length - 2];
  if (last() >= min) return cuts;

  // Split the last two evenly
  const a = cuts[cuts.length - 3];
  const both = total - a;
  if (both >= 2 * min) {
    const mid = a + both / 2;
    const lo = Math.max(a + min, total - max);
    const hi = Math.min(a + max, total - min);
    cuts[cuts.length - 2] = bestCut(cands, Math.max(lo, mid - 10), Math.min(hi, mid + 10), mid);
    return cuts;
  }

  // Even that is too short: give every clip the same length
  const n = cuts.length - 1;
  const even = [0];
  for (let k = 1; k < n; k++) {
    const target = (total * k) / n;
    const prev = even[k - 1];
    const lo = Math.max(prev + min, target - 10);
    const hi = Math.min(prev + max, target + 10, total - min * (n - k));
    even.push(bestCut(cands, Math.min(lo, hi), hi, target));
  }
  even.push(total);
  return even;
}

// Start times of the arrow: 1/5, 2/5, 3/5 and 4/5 of the way through the full video.
function fullArrowTimes(total, count = 4) {
  const out = [];
  for (let k = 1; k <= count; k++) out.push(Math.round(((total * k) / (count + 1)) * 100) / 100);
  return out;
}

// "AITA - I Ruined Her Graduation (Part 2).mp4". Characters macOS can't have in a name become "-".
function outputName(title, which) {
  const clean = String(title).replace(/[/:]/g, "-").replace(/\s+/g, " ").trim();
  return `AITA - ${clean} (${which}).mp4`;
}

// A random-looking arrow colour that is the same every time for the same date folder
// (so the full video and its clips match). Dark and rich enough for white text.
function arrowColor(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  return { hue: Math.round(rnd() * 360), saturation: 55 + Math.round(rnd() * 20), lightness: 30 + Math.round(rnd() * 8) };
}

module.exports = {
  MAX_CLIP, MIN_CLIP, sequenceWords, loudnessFromWav, cutCandidates, bestCut, planClips,
  fullArrowTimes, outputName, arrowColor,
};
