// Pure planning helpers for a full run (no Premiere APIs, so they can be tested with Node).

// "9-25-26" / "09-25-2026" -> sortable number 20260925, or null if the name isn't a date.
function folderDate(name) {
  const m = String(name).match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return year * 10000 + Number(m[1]) * 100 + Number(m[2]);
}

// Date folders that still need a video, oldest posting date first.
// folders: [{ name, files: [fileName, ...] }]
const AUDIO = /\.(aac|mp3|wav|m4a)$/i;
function foldersToDo(folders) {
  return folders
    .filter((f) => folderDate(f.name) !== null)
    .filter((f) => !f.files.some((n) => n.toLowerCase() === "aita.mp4"))
    .map((f) => ({ ...f, voiceover: f.files.filter((n) => AUDIO.test(n)).sort().pop() || null }))
    .filter((f) => f.voiceover)
    .sort((a, b) => folderDate(a.name) - folderDate(b.name));
}

// Choose where the next video comes from.
// videos: [{ name, created }] in the Source Video folder; usage: { [name]: { usedUpTo, duration, exhausted } }
// needed: seconds of video required. Durations may be unknown (undefined) for videos not measured yet.
// Returns { name, start, remainingAfter } or { error } explaining why nothing fits.
// Videos are used oldest first; a video that can't fit the next voiceover is marked exhausted and
// skipped from then on, so the story always moves forward through the footage.
function chooseSource(videos, usage, needed) {
  const ordered = [...videos].sort((a, b) => (a.created || 0) - (b.created || 0) || a.name.localeCompare(b.name));
  const skipped = [];
  for (const v of ordered) {
    const u = usage[v.name] || {};
    if (u.exhausted) continue;
    const start = u.usedUpTo || 0;
    if (u.duration === undefined) return { name: v.name, start, needsMeasuring: true, skipped };
    const left = u.duration - start;
    if (left >= needed) return { name: v.name, start, remainingAfter: left - needed, skipped };
    skipped.push({ name: v.name, left });
  }
  const detail = skipped.map((s) => `${s.name} has ${formatTime(s.left)} left`).join("; ");
  return {
    error: `Not enough video left: this voiceover needs ${formatTime(needed)}.` +
      (detail ? ` (${detail}.)` : "") + " Download a new video into the Source Video folder.",
    skipped,
  };
}

// Scale (percent) that makes a w x h video cover a frameW x frameH frame, centred, with no black edges.
function fillScale(w, h, frameW = 1080, frameH = 1920) {
  return Math.ceil(Math.max(frameW / w, frameH / h) * 100 * 100 + 5) / 100; // tiny overshoot avoids a 1px edge
}

// Premiere timecode "00;07;45;01" (drop-frame) or "00:07:45:01" -> seconds, at the given frame rate.
function timecodeToSeconds(tc, fps = 29.97) {
  const m = String(tc).trim().match(/^(\d+)[:;](\d+)[:;](\d+)([:;])(\d+)$/);
  if (!m) return null;
  const [h, mi, s, sep, f] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4], Number(m[5])];
  const nominal = Math.round(fps);
  let frames = (h * 3600 + mi * 60 + s) * nominal + f;
  if (sep === ";") {
    const drop = nominal === 60 ? 4 : 2;
    const minutes = h * 60 + mi;
    frames -= drop * (minutes - Math.floor(minutes / 10));
  }
  return frames / fps;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

module.exports = { folderDate, foldersToDo, chooseSource, fillScale, timecodeToSeconds, formatTime };
