// Helpers for finding Premiere's windows by size and position (JavaScript for Automation).
// macOS reports every window's bounds even when an app hides its contents from Accessibility.
// Run with: osascript -l JavaScript windows.js <command> [args]
//   record                      -> find the Premiere window under the mouse, print "dx,dy,w,h"
//                                  (button position measured from the window's right and bottom edges)
//   find <w> <h> <timeoutSec>   -> wait for a Premiere window of about that size, print "x,y,w,h" or "none"
//   point                       -> for the Premiere window under the mouse, print "left,top,right,w,h"
//                                  (pointer distance from the window's left, top and right edges, and its size)
//   click <x> <y>               -> click the left mouse button there and put the pointer back

ObjC.import("CoreGraphics");

function premiereWindows() {
  // 1 = on-screen windows only, 0 = no relative window
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))) || [];
  return list
    .filter((w) => String(w.kCGWindowOwnerName || "").includes("Premiere") && w.kCGWindowBounds)
    .map((w) => ({ x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, w: w.kCGWindowBounds.Width, h: w.kCGWindowBounds.Height }));
}

function mouse() {
  const p = $.CGEventGetLocation($.CGEventCreate(null));
  return { x: p.x, y: p.y };
}

function record() {
  const m = mouse();
  const under = premiereWindows()
    .filter((w) => m.x >= w.x && m.x <= w.x + w.w && m.y >= w.y && m.y <= w.y + w.h)
    .sort((a, b) => a.w * a.h - b.w * b.h); // smallest window under the pointer = the dialog
  if (!under.length) return "error: the mouse is not over a Premiere window";
  const d = under[0];
  return [d.x + d.w - m.x, d.y + d.h - m.y, d.w, d.h].map(Math.round).join(",");
}

function smallestUnderMouse() {
  const m = mouse();
  const under = premiereWindows()
    .filter((w) => m.x >= w.x && m.x <= w.x + w.w && m.y >= w.y && m.y <= w.y + w.h)
    .sort((a, b) => a.w * a.h - b.w * b.h);
  return under.length ? { m, d: under[0] } : null;
}

function point() {
  const hit = smallestUnderMouse();
  if (!hit) return "error: the mouse is not over a Premiere window";
  const { m, d } = hit;
  return [m.x - d.x, m.y - d.y, d.x + d.w - m.x, d.w, d.h].map(Math.round).join(",");
}

function find(w, h, timeout) {
  const end = Date.now() + timeout * 1000;
  do {
    const match = premiereWindows().find((win) => Math.abs(win.w - w) <= 12 && Math.abs(win.h - h) <= 12);
    if (match) return [match.x, match.y, match.w, match.h].map(Math.round).join(",");
    delay(0.25);
  } while (Date.now() < end);
  return "none";
}

function click(x, y) {
  const back = $.CGEventGetLocation($.CGEventCreate(null));
  const pt = $.CGPointMake(x, y);
  // tap 0 = HID; events 5 = mouse moved, 1 = left down, 2 = left up; button 0 = left
  const post = (type, where) => $.CGEventPost(0, $.CGEventCreateMouseEvent(null, type, where, 0));
  post(5, pt);
  delay(0.15);
  post(1, pt);
  delay(0.08);
  post(2, pt);
  delay(0.15);
  post(5, back);
  return "clicked";
}

function run(argv) {
  const [cmd, a, b, c] = argv;
  if (cmd === "record") return record();
  if (cmd === "point") return point();
  if (cmd === "find") return find(Number(a), Number(b), Number(c || 8));
  if (cmd === "click") return click(Number(a), Number(b));
  return "usage: record | point | find <w> <h> <timeout> | click <x> <y>";
}
