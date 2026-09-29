// Rules for the Upload step (which videos go where and when, titles and descriptions). Plain JavaScript with no
// Mac or browser parts, so it can be tested with Node and loaded by uploads.js on the Mac.

// Posting times (Eastern), [hour, minute] on the date folder's date
const TIMES = {
  youtube: { full: [11, 30], parts: [[13, 30], [15, 30], [17, 30], [19, 30], [21, 30]] },
  tiktok: { full: [11, 30], parts: [[13, 30], [15, 30], [17, 30], [19, 30], [21, 30]] },
  facebook: { full: [13, 30], parts: [] }, // Facebook gets the full video only
};

const HASHTAGS = "#storytime #redditstoryteller #RelationshipDrama #reddit";

// "9-28-26" / "10-02-26" -> Date at midnight (local time), or null
function folderDay(name) {
  const m = String(name).match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(year, Number(m[1]) - 1, Number(m[2]));
}

// "AITA - Title (Full Video).mp4" -> { title: "AITA - Title (Full Video)", part: 0 }; "(Part 2)" -> part 2
function videoInfo(fileName) {
  const m = String(fileName).match(/^(AITA - .+ \((Full Video|Part (\d+))\))\.mp4$/i);
  if (!m) return null;
  return { title: m[1], part: m[3] ? Number(m[3]) : 0 };
}

// YouTube has its own title box, so its description starts with the credit; TikTok and Facebook start with the
// video's name.
function description(title, credit, platform) {
  const body = `Gameplay Video Credit: ${credit}\n\n${HASHTAGS}`;
  return platform === "youtube" ? body : `${title}\n\n${body}`;
}

// Creator's name from a video file's "Authors" info, e.g. "Orbital - No Copyright Gameplay" -> "Orbital"
function creditFromAuthor(author) {
  if (/^\(?\s*null\s*\)?$/i.test(String(author || "").trim())) return null;
  const a = String(author || "").replace(/^\(\s*"?|"?\s*\)$/g, "").replace(/^"|"$/g, "").trim();
  if (!a || a === "(null)") return null;
  return a.split(/\s+[-–|]\s+/)[0].trim() || null;
}

// Everything to upload to one platform, earliest first.
// folders: [{ name, files: [...], credit }] (finished date folders); uploaded: Set of keys already done;
// now: Date. Returns { items: [{ key, folder, file, title, description, when }], skipped: [text] }
function uploadPlan(platform, folders, uploaded, now) {
  const times = TIMES[platform];
  const items = [];
  const skipped = [];
  for (const f of folders) {
    const day = folderDay(f.name);
    if (!day) continue;
    for (const file of f.files) {
      const v = videoInfo(file);
      if (!v) continue;
      const key = `${platform}|${f.name}|${file}`;
      if (uploaded.has(key)) continue;
      const at = v.part ? times.parts[v.part - 1] : times.full;
      if (!at) {
        if (v.part && times.parts.length) skipped.push(`Part ${v.part} of ${f.name} has no posting time; post it by hand`);
        continue;
      }
      const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), at[0], at[1]);
      if (when <= new Date(now.getTime() + 15 * 60000)) {
        skipped.push(`${file} (${f.name}) is due too soon or already past; post it by hand`);
        continue;
      }
      if (!f.credit) {
        skipped.push(`${f.name}: no gameplay credit found`);
        continue;
      }
      items.push({ key, folder: f.name, file, title: v.title, description: description(v.title, f.credit, platform), when: when.getTime() });
    }
  }
  items.sort((a, b) => a.when - b.when || a.file.localeCompare(b.file));
  return { items, skipped };
}

// Date and time the way YouTube Studio shows them: "Oct 2, 2026" and "1:30 PM"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function studioDate(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function studioTime(ms) {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

if (typeof module !== "undefined") {
  module.exports = { TIMES, HASHTAGS, folderDay, videoInfo, description, creditFromAuthor, uploadPlan, studioDate, studioTime };
}
