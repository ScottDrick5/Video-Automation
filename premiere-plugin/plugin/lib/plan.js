// Pure planning helpers for a full run (no Premiere APIs, so they can be tested with Node).

// "9-25-26" / "09-25-2026" -> sortable number 20260925, or null if the name isn't a date.
function folderDate(name) {
  const m = String(name).match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return year * 10000 + Number(m[1]) * 100 + Number(m[2]);
}

// Date folders that still need a video, oldest posting date first. A folder is done once it has
// vidauto-done.txt (written after the full video and all clips are exported), the full video plus its Part 1
// (folders finished before that file existed), or AITA.mp4 from before the clips were automated.
// A folder with only the full video (the clips failed) is made again.
// folders: [{ name, files: [fileName, ...] }]
const AUDIO = /\.(aac|mp3|wav|m4a)$/i;
function isDone(files) {
  const has = (re) => files.some((n) => re.test(n));
  return has(/^vidauto-done\.txt$/i) || has(/^aita\.mp4$/i) || (has(/\(full video\)\.mp4$/i) && has(/\(part 1\)\.mp4$/i));
}
function foldersToDo(folders) {
  return folders
    .filter((f) => folderDate(f.name) !== null)
    .filter((f) => !isDone(f.files))
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

// Before making a batch of videos: is there enough footage for all of them? needs: seconds per video, in order.
// Walks through the source videos the same way the run will (see chooseSource), without changing `usage`.
// Returns { ok: true }, { ok: false, error, done } (done = how many fit) or { ok: null, note } when a
// video hasn't been measured yet so its length is unknown.
function footageCheck(videos, usage, needs) {
  const u = JSON.parse(JSON.stringify(usage || {}));
  for (const [i, need] of needs.entries()) {
    const pick = chooseSource(videos, u, need);
    for (const s of pick.skipped || []) u[s.name] = { ...u[s.name], exhausted: true };
    if (pick.needsMeasuring) {
      return { ok: null, note: `${pick.name} hasn't been measured yet, so the footage can only be checked while the videos are made` };
    }
    if (pick.error) {
      return { ok: false, done: i, error: `Enough footage for ${i} of ${needs.length} videos. ${pick.error}` };
    }
    u[pick.name] = { ...u[pick.name], usedUpTo: pick.start + need };
  }
  return { ok: true };
}

// Which date folders the user typed: "10-06-26, 10-08-26" and/or ranges "10-06-26 to 10-09-26".
// folderNames: the existing date folders. Returns the matching folder names, oldest first, or null if the text
// has something that isn't a date.
function foldersInText(text, folderNames) {
  const parts = String(text).toLowerCase().replace(/\bthrough\b|\bthru\b/g, " to ").split(/[,;]|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
  const wanted = [];
  for (const part of parts) {
    const range = part.split(/\s+to\s+/).map((x) => x.trim());
    const pieces = range.length === 2 ? range : part.split(/\s+/);
    if (range.length === 2) {
      const [a, b] = range.map(folderDate);
      if (a === null || b === null) return null;
      wanted.push([Math.min(a, b), Math.max(a, b)]);
    } else {
      for (const p of pieces) {
        const d = folderDate(p);
        if (d === null) return null;
        wanted.push([d, d]);
      }
    }
  }
  return folderNames
    .filter((n) => folderDate(n) !== null && wanted.some(([a, b]) => folderDate(n) >= a && folderDate(n) <= b))
    .sort((x, y) => folderDate(x) - folderDate(y));
}

// Scale (percent) that makes a w x h video cover a frameW x frameH frame, centred, with no black edges.
function fillScale(w, h, frameW = 1080, frameH = 1920) {
  return Math.ceil(Math.max(frameW / w, frameH / h) * 100 * 100 + 5) / 100; // tiny overshoot avoids a 1px edge
}

// Timecode -> seconds. Accepts "00;07;45;01" / "00:07:45:01" (h m s frames), "7;45;01" / "7:45:01"
// (m s frames) and "7:45" (m s). At 29.97/59.94 fps it's read as drop-frame timecode, the way Premiere
// shows it, whichever separator was typed. Returns null if it can't read it.
function timecodeToSeconds(tc, fps = 29.97) {
  const text = String(tc).trim();
  const parts = text.split(/[:;.]/).map((x) => x.trim());
  if (parts.length < 2 || parts.length > 4 || parts.some((x) => !/^\d+$/.test(x))) return null;
  const n = parts.map(Number);
  if (parts.length === 2) return n[0] * 60 + n[1];
  const [h, mi, s, f] = parts.length === 4 ? n : [0, ...n];
  const nominal = Math.round(fps);
  let frames = (h * 3600 + mi * 60 + s) * nominal + f;
  if (nominal !== fps) {
    const drop = nominal === 60 ? 4 : 2;
    const minutes = h * 60 + mi;
    frames -= drop * (minutes - Math.floor(minutes / 10));
  }
  return frames / fps;
}

// Size from Premiere's "Video Info" column, e.g. "3840 x 2160 (1.0)".
function videoSizeFrom(text) {
  const m = String(text).match(/(\d{3,5})\s*x\s*(\d{3,5})/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

module.exports = { folderDate, foldersToDo, foldersInText, chooseSource, footageCheck, fillScale, timecodeToSeconds, videoSizeFrom, formatTime };
