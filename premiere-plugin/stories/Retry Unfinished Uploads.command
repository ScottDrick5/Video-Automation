#!/bin/bash
# Lists uploads that stopped partway (marked "failed partway") and, if you say yes, forgets them so the next
# Upload run tries them again. Delete their stopped drafts in YouTube Studio first, so they aren't there twice.
cd "$(dirname "$0")"
echo "VidAuto - Retry unfinished uploads"
echo
osascript -l JavaScript - list <<'JS'
ObjC.import("Foundation");
function run(argv) {
  const path = "/Users/drick/Documents/AITA/vidauto-uploads.json";
  const s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (s.isNil()) return "No uploads recorded yet.";
  const rec = JSON.parse(ObjC.unwrap(s));
  const bad = rec.uploads.filter((u) => /failed partway/.test(u.note || ""));
  if (!bad.length) return "Nothing to retry: no upload stopped partway.";
  return "Stopped partway (will be forgotten if you answer y):\n" + bad.map((u) => "  " + u.key.split("|").slice(1).join("  ")).join("\n");
}
JS
echo
read -r -p "Forget these so they're uploaded again next time? (y/N) " A
if [[ "$A" =~ ^[Yy] ]]; then
  osascript -l JavaScript <<'JS'
ObjC.import("Foundation");
function run() {
  const path = "/Users/drick/Documents/AITA/vidauto-uploads.json";
  const s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (s.isNil()) return "No uploads recorded yet.";
  const rec = JSON.parse(ObjC.unwrap(s));
  const before = rec.uploads.length;
  rec.uploads = rec.uploads.filter((u) => !/failed partway/.test(u.note || ""));
  $.NSString.alloc.initWithUTF8String(JSON.stringify(rec, null, 2)).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
  return `Done: ${before - rec.uploads.length} upload(s) will be tried again on the next Upload run.`;
}
JS
else
  echo "Nothing changed."
fi
echo
read -n 1 -s -r -p "Press any key to close."
