#!/bin/bash
# Tells the Upload step that every video up to and including a date is already posted (e.g. uploaded by hand),
# so it's never uploaded again.
cd "$(dirname "$0")"
echo "VidAuto - Mark videos as already uploaded"
echo
read -r -p "Already uploaded through which date folder? (e.g. 10-05-26) " D
read -r -p "On which platforms? (Enter = youtube; or e.g.: youtube tiktok facebook) " P
P=${P:-youtube}
echo
osascript -l JavaScript - "$D" $P <<'JS'
ObjC.import("Foundation");
function run(argv) {
  const [through, ...platforms] = argv;
  const day = (name) => {
    const m = String(name).match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
    return m ? new Date(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null;
  };
  const last = day(through);
  if (!last) return `"${through}" isn't a date like 10-05-26. Nothing changed.`;
  const clips = "/Users/drick/Documents/AITA/New Video Clips";
  const path = "/Users/drick/Documents/AITA/vidauto-uploads.json";
  const fm = $.NSFileManager.defaultManager;
  const list = (p) => ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError(p, null)) || [];
  const s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  const rec = s.isNil() ? { uploads: [] } : JSON.parse(ObjC.unwrap(s));
  const have = new Set(rec.uploads.map((u) => u.key));
  let added = 0;
  const folders = [];
  for (const f of list(clips)) {
    const d = day(f);
    if (!d || d > last) continue;
    let n = 0;
    for (const file of list(`${clips}/${f}`)) {
      if (!/^AITA - .+ \((Full Video|Part \d+)\)\.mp4$/i.test(file)) continue;
      for (const p of platforms) {
        const key = `${p.toLowerCase()}|${f}|${file}`;
        if (have.has(key)) continue;
        rec.uploads.push({ key, at: new Date().toISOString(), note: "marked as already uploaded" });
        have.add(key);
        added++;
        n++;
      }
    }
    if (n) folders.push(f);
  }
  $.NSString.alloc.initWithUTF8String(JSON.stringify(rec, null, 2)).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
  return `Done: ${added} video(s) marked as already uploaded on ${platforms.join(", ")}` +
    (folders.length ? ` (folders: ${folders.join(", ")}).` : ". (They were all marked already.)");
}
JS
echo
read -n 1 -s -r -p "Press any key to close."
