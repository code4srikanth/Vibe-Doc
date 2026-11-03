// Builds the exterior layer (skin, lids, lashes, caruncle) from the reference photo: cuts the
// palpebral fissure traced in assets/exterior/fissure.json out of the photo, crops it to the
// slit-lamp field and relights it from daylight to the lamp in a dark room ("slit_lamp" block).
// The result is an RGBA PNG whose opening is transparent, so the eye layers can be drawn behind it.
// It also writes the opening's distance field from the upper-lid margin (for the lid shadow on the globe)
// and the uncut relit crop, which is the reference the external view is checked against.
//   npx tsx tools/cut-exterior.ts            -> assets/exterior/{exterior,skin-albedo,opening-dist}.png, .tmp/exterior/relit.png
//   npx tsx tools/cut-exterior.ts --check    -> also .tmp/exterior/{check,layer,preview}.png
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ROOT } from "./lib/library.ts";
import { OPENING_DIST_RANGE_MM } from "../src/exam/exterior-asset.ts";

type Pt = [number, number];
const dir = join(ROOT, "assets", "exterior");
const f = JSON.parse(readFileSync(join(dir, "fissure.json"), "utf8")) as {
  source: string; feather_px: number; caruncle_feather_px?: number; medial_canthus: Pt; caruncle_edge?: Pt[]; lateral_canthus: Pt; upper: Pt[]; lower: Pt[];
  slit_lamp: SlitLamp;
};
interface SlitLamp {
  px_per_mm: number;
  crop: [number, number, number, number];   // x, y, w, h in source pixels
  lamp_centre: Pt;                          // source pixels
  lamp_radius_mm: number; lamp_soft_mm: number;
  room: number;                             // light left outside the beam (fraction)
  exposure: number; contrast: number;       // linear gain, then a power on linear light
  warmth: [number, number, number];         // halogen tint, linear
  side_light: number;                       // brighter toward the lamp (lateral, +x)
  highlight_suppress: number;               // 0-1: how much daylight sparkle on skin to remove
}

// Closed outline: medial end -> upper margin -> lateral canthus -> lower margin -> back. The medial
// end is the caruncle's outer border when one is traced (the caruncle stays in the photo), else the canthus.
const ring: Pt[] = [...(f.caruncle_edge ?? [f.medial_canthus]), ...f.upper, f.lateral_canthus, ...f.lower];

// Catmull-Rom through the traced points, written as cubic Bezier segments (segment i runs from point i to i+1).
function bezier(pts: Pt[], i: number): [Pt, Pt, Pt, Pt] {
  const n = pts.length, at = (j: number) => pts[(j + n) % n];
  const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
  return [p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2];
}
function smoothPath(pts: Pt[]): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length; i++) {
    const [, c1, c2, p2] = bezier(pts, i);
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d + " Z";
}

const src = join(ROOT, f.source);
const { width, height } = await sharp(src).metadata();
const path = smoothPath(ring);
const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);

// Opening mask (white inside), feathered so the cut edge is not aliased.
const maskSvg = svg(`<rect width="100%" height="100%" fill="black"/><path d="${path}" fill="white"/>`);
const mask = (blur: number) => sharp(maskSvg).blur(Math.max(0.3, blur)).extractChannel(0).raw().toBuffer();
const opening = await mask(f.feather_px);
if (opening.length !== width! * height!) throw new Error(`mask has ${opening.length / (width! * height!)} channels, expected 1`);
// The caruncle meets the plica in a soft fold, not an edge: blend to a wider feather around it.
if (f.caruncle_edge && f.caruncle_feather_px) {
  const soft = await mask(f.caruncle_feather_px);
  const xs = f.caruncle_edge.map(p => p[0]), ys = f.caruncle_edge.map(p => p[1]);
  const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const [rx, ry] = [(Math.max(...xs) - Math.min(...xs)) / 2 + 30, (Math.max(...ys) - Math.min(...ys)) / 2 + 20];
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    if (d >= 1) continue;
    const w = 1 - d * d, i = y * width! + x;
    opening[i] = Math.round(opening[i] * (1 - w) + soft[i] * w);
  }
}
const alpha = Buffer.from(opening.map(v => 255 - v));

// ---- crop to the slit-lamp field and relight -------------------------------------------
const sl = f.slit_lamp;
const [cx0, cy0, cw, ch] = sl.crop;
const region = { left: cx0, top: cy0, width: cw, height: ch };
const rgb = await sharp(src).extract(region).removeAlpha().raw().toBuffer();
const a = Buffer.alloc(cw * ch);
for (let y = 0; y < ch; y++) alpha.copy(a, y * cw, (cy0 + y) * width! + cx0, (cy0 + y) * width! + cx0 + cw);
const toLin = (v: number) => Math.pow(v / 255, 2.2), toSrgb = (v: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2));
const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Daylight photo pixels -> the same tissue under the slit lamp's diffused beam in a dark room.
 *  graded false: the daylight pixels with the sparkle removed only (the skin albedo the slit views relight). */
async function relight(px: Buffer, graded = true): Promise<Buffer> {
  // local mean brightness, to tell specular sparkle (brighter than its surroundings) from bright skin
  const localMean = await sharp(px, { raw: { width: cw, height: ch, channels: 3 } }).greyscale().blur(4).raw().toBuffer();
  const out = Buffer.alloc(px.length);
  for (let y = 0, i = 0; y < ch; y++) for (let x = 0; x < cw; x++, i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255, Lb = localMean[i] / 255;
    const mx = Math.max(r, g, b), sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
    // daylight sparkle: bright, colourless, brighter than the skin around it
    const spec = sstep(0.02, 0.12, L - Lb) * sstep(0.35, 0.1, sat) * sstep(0.55, 0.85, L) * sl.highlight_suppress;
    const keep = 1 - spec * (1 - Lb / Math.max(L, 1e-3));
    const dx = (cx0 + x - sl.lamp_centre[0]) / sl.px_per_mm, dy = (cy0 + y - sl.lamp_centre[1]) / sl.px_per_mm;
    const beam = sstep(sl.lamp_radius_mm + sl.lamp_soft_mm, sl.lamp_radius_mm - sl.lamp_soft_mm, Math.hypot(dx, dy));
    const light = (sl.room + (1 - sl.room) * beam) * (1 + sl.side_light * Math.max(-1, Math.min(1, dx / sl.lamp_radius_mm)));
    for (let c = 0; c < 3; c++) {
      const lin = toLin(px[i * 3 + c]) * keep;
      out[i * 3 + c] = !graded ? toSrgb(lin) : toSrgb(Math.pow(lin * sl.exposure * light * sl.warmth[c], sl.contrast));
    }
  }
  return out;
}

const out = join(dir, "exterior.png");
const relit = await relight(rgb);
await sharp(relit, { raw: { width: cw, height: ch, channels: 3 } }).joinChannel(a, { raw: { width: cw, height: ch, channels: 1 } }).png().toFile(out);
// The same layer before the lamp grade: the slit-lamp views light it with the room and the slit beam.
const albedoOut = join(dir, "skin-albedo.png");
await sharp(await relight(rgb, false), { raw: { width: cw, height: ch, channels: 3 } }).joinChannel(a, { raw: { width: cw, height: ch, channels: 1 } }).png().toFile(albedoOut);
console.log(`skin albedo layer: ${albedoOut}`);
console.log(`exterior layer: ${out} (${cw}x${ch}, ${(cw / sl.px_per_mm).toFixed(1)} x ${(ch / sl.px_per_mm).toFixed(1)} mm)`);

// Uncut relit crop: the reference for the external view's acceptance checks.
const tmpDir = join(ROOT, ".tmp", "exterior");
mkdirSync(tmpDir, { recursive: true });
await sharp(relit, { raw: { width: cw, height: ch, channels: 3 } }).png().toFile(join(tmpDir, "relit.png"));
console.log(`relit reference: ${join(tmpDir, "relit.png")}`);

// Distance (mm) from the lid margins of the opening outline, in the crop's pixels. R: the upper margin (upper
// points to the lateral canthus); the eye renderer darkens the globe within the lid's penumbra of this line and
// lays the upper tear meniscus along it. G: the lower margin (lateral canthus along the lower points, back to
// the medial end), for the lower tear meniscus.
{
  const nc = (f.caruncle_edge ?? [f.medial_canthus]).length, maxPx = OPENING_DIST_RANGE_MM * sl.px_per_mm;
  const upper = distanceField(nc, nc + f.upper.length), lower = distanceField(nc + f.upper.length, ring.length);
  const enc = Buffer.alloc(cw * ch * 3);
  const level = (q: number) => Math.round(Math.min(1, Math.sqrt(q) / maxPx) * 255);
  for (let i = 0; i < cw * ch; i++) { enc[i * 3] = level(upper[i]); enc[i * 3 + 1] = level(lower[i]); }
  const distOut = join(dir, "opening-dist.png");
  await sharp(enc, { raw: { width: cw, height: ch, channels: 3 } }).png().toFile(distOut);
  console.log(`lid-margin distance field: ${distOut} (R upper, G lower; 0-255 = 0-${OPENING_DIST_RANGE_MM} mm)`);
}

/** Squared pixel distance to the ring's Bezier segments i0 .. i1 - 1, capped at the encoding range. */
function distanceField(i0: number, i1: number): Float32Array {
  const maxPx = OPENING_DIST_RANGE_MM * sl.px_per_mm;
  const d2 = new Float32Array(cw * ch).fill(maxPx * maxPx);
  for (let i = i0; i < i1; i++) {
    const [p0, p1, p2, p3] = bezier(ring, i);
    const steps = Math.ceil(Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) * 1.5);   // about 1 px along the curve (distance error < 0.15 px)
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      const x = w[0] * p0[0] + w[1] * p1[0] + w[2] * p2[0] + w[3] * p3[0] - cx0;
      const y = w[0] * p0[1] + w[1] * p1[1] + w[2] * p2[1] + w[3] * p3[1] - cy0;
      // pixel centres within reach of this curve point
      for (let py = Math.max(0, Math.floor(y - maxPx)); py <= Math.min(ch - 1, Math.ceil(y + maxPx)); py++) {
        const dy = py + 0.5 - y, row = py * cw;
        for (let px = Math.max(0, Math.floor(x - maxPx)); px <= Math.min(cw - 1, Math.ceil(x + maxPx)); px++) {
          const dx = px + 0.5 - x, q = dx * dx + dy * dy;
          if (q < d2[row + px]) d2[row + px] = q;
        }
      }
    }
  }
  return d2;
}

if (process.argv.includes("--check")) {
  const checkDir = tmpDir;
  const dots = ring.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="yellow"/>`).join("");
  await sharp(src).composite([{ input: svg(`<path d="${path}" fill="rgba(0,255,120,0.35)" stroke="#00ff78" stroke-width="2"/>${dots}<rect x="${cx0}" y="${cy0}" width="${cw}" height="${ch}" fill="none" stroke="yellow" stroke-width="3"/>`) }])
    .toFile(join(checkDir, "check.png"));
  // the layer over a checkerboard, so the transparent opening is visible
  const cb = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><defs><pattern id="c" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#444"/><rect width="20" height="20" fill="#777"/><rect x="20" y="20" width="20" height="20" fill="#777"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/></svg>`;
  await sharp(Buffer.from(cb)).composite([{ input: out }]).toFile(join(checkDir, "layer.png"));
  // a plain sclera-like fill in the opening, lit by the same lamp, to judge the edges
  const fill = [0xe6, 0xd9, 0xd2], filled = Buffer.alloc(rgb.length);
  for (let i = 0; i < a.length; i++) for (let c = 0; c < 3; c++) filled[i * 3 + c] = Math.round((rgb[i * 3 + c] * a[i] + fill[c] * (255 - a[i])) / 255);
  await sharp(await relight(filled), { raw: { width: cw, height: ch, channels: 3 } }).png().toFile(join(checkDir, "preview.png"));
  console.log(`check images in ${checkDir}`);
}
