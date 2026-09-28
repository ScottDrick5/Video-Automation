// Draws the title and "Follow For More Videos!!" arrow as see-through 1080x1920 PNG pictures
// (JavaScript for Automation, using the Mac's own drawing tools and your installed fonts).
// Run with: osascript -l JavaScript overlays.js <job.json>
//
// job.json: { "outDir": "...", "title": "I Ruined Her Graduation", "labels": ["Full Video", "Part 1", ...],
//             "color": { "hue": 330, "saturation": 60, "lightness": 32 }, "style": { ...optional overrides } }
// Writes title-1.png, title-2.png ... (one per label) and arrow.png into outDir, and prints "ok" or "error: ...".
//
// Sizes and positions match your Camtasia screenshot. To change them, put the same keys in
// /Users/Shared/VidAuto/overlay-style.json, e.g. { "titleSize": 76, "titleCenterY": 540 }.

ObjC.import("AppKit");
ObjC.import("CoreGraphics");

const W = 1080;
const H = 1920;
const STYLE = {
  titleFont: "Zilla Slab",
  titleWeight: "Bold", // tried first; falls back to SemiBold, Medium, Regular
  titleSize: 70, // largest size; long titles shrink so the widest line fits titleMaxWidth
  titleMaxWidth: 1000,
  titleLineHeight: 1.16,
  titleCenterY: 530, // middle of the three lines, from the top
  titleOutline: 3.5, // outline thickness in pixels
  titleOutlineColor: "#222222",
  titleColor: "#FFFFFF",
  arrowFont: "Montserrat",
  arrowWeight: "Regular",
  arrowTextSize: 50,
  arrowLines: ["Follow For More", "Videos!!"],
  arrowLeft: 273,
  arrowShaftRight: 745,
  arrowTip: 915,
  arrowCenterY: 1103,
  arrowShaftHeight: 141,
  arrowHeadHeight: 230,
  arrowTextCenterX: 542,
  arrowShine: 1,
};

function readJson(path) {
  const data = $.NSData.dataWithContentsOfFile(path);
  if (data.isNil()) return null;
  return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
}

function hex(h) {
  const n = parseInt(h.replace("#", ""), 16);
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1);
}

function hsl(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(f(0), f(8), f(4), 1);
}

const WEIGHTS = { Thin: 2, Light: 3, Regular: 5, Medium: 6, SemiBold: 8, Bold: 9, ExtraBold: 10, Black: 11 };

// A font by family and weight name, trying lighter weights if that one isn't installed.
function font(family, weight, size) {
  const names = [weight, "SemiBold", "Medium", "Regular"];
  for (const name of names) {
    const direct = $.NSFont.fontWithNameSize(`${family.replace(/\s/g, "")}-${name}`, size);
    if (!direct.isNil()) return direct;
  }
  const mgr = $.NSFontManager.sharedFontManager;
  const f = mgr.fontWithFamilyTraitsWeightSize(family, weight === "Bold" ? 2 : 0, WEIGHTS[weight] || 5, size);
  if (!f.isNil()) return f;
  throw new Error(`the font "${family}" is not installed on this Mac`);
}

function canvas() {
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, W, H, 8, 4, true, false, $("NSDeviceRGBColorSpace"), 0, 0);
  const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext(ctx);
  $.NSColor.clearColor.set;
  $.NSRectFillUsingOperation({ origin: { x: 0, y: 0 }, size: { width: W, height: H } }, 1); // 1 = copy: fully see-through
  return { rep, ctx };
}

function save(c, path) {
  c.ctx.flushGraphics;
  $.NSGraphicsContext.restoreGraphicsState;
  const png = c.rep.representationUsingTypeProperties(4, $({})) // 4 = PNG;
  if (!png.writeToFileAtomically(path, true)) throw new Error(`could not write ${path}`);
}

function attrs(f, color, stroke) {
  const d = $.NSMutableDictionary.dictionary;
  d.setObjectForKey(f, $.NSFontAttributeName);
  d.setObjectForKey(color, $.NSForegroundColorAttributeName);
  if (stroke) {
    d.setObjectForKey(stroke.color, $.NSStrokeColorAttributeName);
    d.setObjectForKey($(stroke.width), $.NSStrokeWidthAttributeName); // positive = outline only
  }
  return d;
}

function textWidth(text, f) {
  return $.NSString.alloc.initWithString(text).sizeWithAttributes(attrs(f, hex("#FFFFFF"))).width;
}

// Draw one line centred on x, with its middle (between cap top and baseline) at y from the top.
function drawLine(text, f, cx, cy, fill, outline) {
  const str = $.NSString.alloc.initWithString(text);
  const width = textWidth(text, f);
  const baselineFromTop = cy + f.capHeight / 2;
  // drawAtPoint places the bottom of the line (below the baseline by the font's descender)
  const origin = { x: cx - width / 2, y: H - baselineFromTop + f.descender };
  if (outline) {
    // stroke width is a percentage of the font size; the stroke is centred on the letter edge,
    // so draw it twice as thick and paint the letters over it
    const pct = ((outline.px * 2) / f.pointSize) * 100;
    $.CGContextSetLineJoin($.NSGraphicsContext.currentContext.CGContext, 1); // round corners on the outline
    str.drawAtPointWithAttributes(origin, attrs(f, fill, { color: outline.color, width: pct }));
  }
  str.drawAtPointWithAttributes(origin, attrs(f, fill));
}

function drawTitle(lines, st, path) {
  let size = st.titleSize;
  let f = font(st.titleFont, st.titleWeight, size);
  const widest = Math.max(...lines.map((l) => textWidth(l, f)));
  if (widest > st.titleMaxWidth) {
    size = Math.floor((size * st.titleMaxWidth) / widest);
    f = font(st.titleFont, st.titleWeight, size);
  }
  const pitch = size * st.titleLineHeight;
  const c = canvas();
  const outline = { px: st.titleOutline, color: hex(st.titleOutlineColor) };
  lines.forEach((line, i) => {
    const cy = st.titleCenterY + (i - (lines.length - 1) / 2) * pitch;
    drawLine(line, f, W / 2, cy, hex(st.titleColor), outline);
  });
  save(c, path);
  return size;
}

function drawArrow(color, st, path) {
  const c = canvas();
  const y = (top) => H - top; // Mac drawing counts from the bottom
  const cy = st.arrowCenterY;
  const r = st.arrowShaftHeight / 2;
  const sTop = cy - r;
  const sBot = cy + r;
  const hTop = cy - st.arrowHeadHeight / 2;
  const hBot = cy + st.arrowHeadHeight / 2;
  const x0 = st.arrowLeft;
  const xs = st.arrowShaftRight;
  const xt = st.arrowTip;
  const p = $.NSBezierPath.bezierPath;
  const pt = (x, t) => ({ x, y: y(t) });
  // rounded left end
  p.moveToPoint(pt(x0 + r, sBot));
  p.appendBezierPathWithArcWithCenterRadiusStartAngleEndAngleClockwise(pt(x0 + r, cy), r, 270, 90, true);
  // top edge, then the arrow head with softly rounded corners
  p.lineToPoint(pt(xs - 12, sTop));
  p.appendBezierPathWithArcFromPointToPointRadius(pt(xs, sTop), pt(xs, hTop), 12);
  p.appendBezierPathWithArcFromPointToPointRadius(pt(xs, hTop), pt(xt, cy), 16);
  p.appendBezierPathWithArcFromPointToPointRadius(pt(xt, cy), pt(xs, hBot), 14);
  p.appendBezierPathWithArcFromPointToPointRadius(pt(xs, hBot), pt(xs, sBot), 16);
  p.appendBezierPathWithArcFromPointToPointRadius(pt(xs, sBot), pt(x0 + r, sBot), 12);
  p.lineToPoint(pt(x0 + r, sBot));
  p.closePath;
  const top = hsl(color.hue, Math.max(25, color.saturation - 20), Math.min(60, color.lightness + 20));
  const bottom = hsl(color.hue, Math.min(90, color.saturation + 15), Math.max(18, color.lightness - 6));
  const grad = $.NSGradient.alloc.initWithStartingColorEndingColor(bottom, top);
  grad.drawInBezierPathAngle(p, 90); // light at the top, dark at the bottom

  // Shine: a glossy light band over the top half, a brighter highlight strip along the top of the
  // shaft, and a thin light rim. arrowShine 0 turns it off, 1 is normal, higher is shinier.
  const shine = st.arrowShine;
  if (shine > 0) {
    const white = (alpha) => $.NSColor.colorWithSRGBRedGreenBlueAlpha(1, 1, 1, Math.min(1, alpha * shine));
    $.NSGraphicsContext.saveGraphicsState;
    p.addClip;
    const band = $.NSGradient.alloc.initWithStartingColorEndingColor(white(0), white(0.35));
    band.drawInRectAngle({ origin: { x: x0, y: y(cy + 6) }, size: { width: xt - x0, height: cy + 6 - hTop } }, 90);
    const strip = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(
      { origin: { x: x0 + r * 0.45, y: y(sTop + 8 + r * 0.5) }, size: { width: xs - x0 - r * 0.45 - 6, height: r * 0.5 } },
      r * 0.25, r * 0.25);
    const gloss = $.NSGradient.alloc.initWithStartingColorEndingColor(white(0.05), white(0.5));
    gloss.drawInBezierPathAngle(strip, 90);
    $.NSGraphicsContext.restoreGraphicsState;
    white(0.3).setStroke;
    p.setLineWidth(2.5);
    p.stroke;
  }

  const f = font(st.arrowFont, st.arrowWeight, st.arrowTextSize);
  const pitch = st.arrowTextSize * 1.22;
  st.arrowLines.forEach((line, i) => {
    const ly = cy + (i - (st.arrowLines.length - 1) / 2) * pitch;
    drawLine(line, f, st.arrowTextCenterX, ly, hex("#FFFFFF"), null);
  });
  save(c, path);
}

function run(argv) {
  try {
    const job = readJson(argv[0]);
    if (!job) return `error: can't read ${argv[0]}`;
    const st = Object.assign({}, STYLE, readJson("/Users/Shared/VidAuto/overlay-style.json") || {}, job.style || {});
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(job.outDir, true, $(), null);
    let size = 0;
    job.labels.forEach((label, i) => {
      size = drawTitle(["AITA", job.title, `(${label})`], st, `${job.outDir}/title-${i + 1}.png`);
    });
    drawArrow(job.color, st, `${job.outDir}/arrow.png`);
    if (job.preview) {
      // both pictures on a grey background, to check the look
      const c = canvas();
      hex("#6b5a4e").set;
      $.NSRectFillUsingOperation({ origin: { x: 0, y: 0 }, size: { width: W, height: H } }, 1);
      for (const name of ["title-1.png", "arrow.png"]) {
        const img = $.NSImage.alloc.initWithContentsOfFile(`${job.outDir}/${name}`);
        img.drawInRectFromRectOperationFraction({ origin: { x: 0, y: 0 }, size: { width: W, height: H } },
          { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } }, 2, 1); // 2 = source over
      }
      save(c, `${job.outDir}/preview.png`);
    }
    return `ok: ${job.labels.length} title picture(s) at ${size}px and the arrow`;
  } catch (e) {
    return "error: " + (e.message || e);
  }
}
