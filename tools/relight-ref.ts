// Puts a user reference image into the exterior check frame and relights it like the exterior photo, so the
// L3/L4b checks can compare it with a render. Recipe (docs/realism/L3-conjunctiva.md, Design "Check reference"):
// resample to the frame's px/mm with the limbus centre on the frame's iris centre, apply one linear exposure gain
// (it sets the reference's temporal mid sclera to the luma of the L2 reference), then the fissure.json slit_lamp
// relight with the lamp centre mapped by mm (the same math as tools/cut-exterior.ts relight()).
//   npx tsx tools/relight-ref.ts                     -> .tmp/L3/ref-gen-frame.png, .tmp/L3/ref-gen-relit.png
//   npx tsx tools/relight-ref.ts --gain 1.8 --src assets/refs/iris/gen-brown-01.png --ppm 47.5 --centre 901,450 --out .tmp/L3
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ROOT } from "./lib/library.ts";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(/\s+/);
  return [k, v.join(" ")];
}));
// Defaults: the user's brown-eye reference (47.5 px/mm, limbus centre (901, 450) px; measured in L3 Anatomy).
const SRC = join(ROOT, args.src ?? "assets/refs/iris/gen-brown-01.png");
const SRC_PPM = Number(args.ppm ?? 47.5);
const [scx, scy] = (args.centre ?? "901,450").split(",").map(Number);
const GAIN = Number(args.gain ?? 1.8);
const outDir = join(ROOT, args.out ?? ".tmp/L3");

const sl = JSON.parse(readFileSync(join(ROOT, "assets", "exterior", "fissure.json"), "utf8")).slit_lamp as {
  px_per_mm: number; crop: [number, number, number, number]; lamp_centre: [number, number]; lamp_radius_mm: number; lamp_soft_mm: number;
  room: number; exposure: number; contrast: number; warmth: [number, number, number]; side_light: number; highlight_suppress: number;
};
const fissure = JSON.parse(readFileSync(join(ROOT, "assets", "exterior", "fissure.json"), "utf8")) as { iris_centre_px: [number, number] };
// check frame: the exterior crop (1640x1093 at 51.2 px/mm), iris centre in crop pixels
const [, , FW, FH] = sl.crop;
const fcx = fissure.iris_centre_px[0] - sl.crop[0], fcy = fissure.iris_centre_px[1] - sl.crop[1];
const k = sl.px_per_mm / SRC_PPM;

const meta = await sharp(SRC).metadata();
const g = await sharp(SRC).removeAlpha().resize(Math.round(meta.width! * k), Math.round(meta.height! * k), { kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
const gw = g.info.width, gh = g.info.height;
const offX = Math.round(fcx - scx * k), offY = Math.round(fcy - scy * k);
const frame = Buffer.alloc(FW * FH * 3);
for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
  const sx = x - offX, sy = y - offY;
  if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) continue;
  for (let c = 0; c < 3; c++) frame[(y * FW + x) * 3 + c] = g.data[(sy * gw + sx) * 3 + c];
}
mkdirSync(outDir, { recursive: true });
await sharp(frame, { raw: { width: FW, height: FH, channels: 3 } }).png().toFile(join(outDir, "ref-gen-frame.png"));

// relight, lamp centre mapped into the frame through the crop
const lcx = sl.lamp_centre[0] - sl.crop[0], lcy = sl.lamp_centre[1] - sl.crop[1];
const localMean = await sharp(frame, { raw: { width: FW, height: FH, channels: 3 } }).greyscale().blur(4).raw().toBuffer();
const toLin = (v: number) => GAIN * Math.pow(v / 255, 2.2), toSrgb = (v: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2));
const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const out = Buffer.alloc(frame.length);
for (let y = 0, i = 0; y < FH; y++) for (let x = 0; x < FW; x++, i++) {
  const r = frame[i * 3], gg = frame[i * 3 + 1], b = frame[i * 3 + 2];
  const L = (0.299 * r + 0.587 * gg + 0.114 * b) / 255, Lb = localMean[i] / 255;
  const mx = Math.max(r, gg, b), sat = mx ? (mx - Math.min(r, gg, b)) / mx : 0;
  const spec = sstep(0.02, 0.12, L - Lb) * sstep(0.35, 0.1, sat) * sstep(0.55, 0.85, L) * sl.highlight_suppress;
  const keep = 1 - spec * (1 - Lb / Math.max(L, 1e-3));
  const dx = (x - lcx) / sl.px_per_mm, dy = (y - lcy) / sl.px_per_mm;
  const beam = sstep(sl.lamp_radius_mm + sl.lamp_soft_mm, sl.lamp_radius_mm - sl.lamp_soft_mm, Math.hypot(dx, dy));
  const light = (sl.room + (1 - sl.room) * beam) * (1 + sl.side_light * Math.max(-1, Math.min(1, dx / sl.lamp_radius_mm)));
  for (let c = 0; c < 3; c++) out[i * 3 + c] = toSrgb(Math.pow(toLin(frame[i * 3 + c]) * keep * sl.exposure * light * sl.warmth[c], sl.contrast));
}
await sharp(out, { raw: { width: FW, height: FH, channels: 3 } }).png().toFile(join(outDir, "ref-gen-relit.png"));
console.log(`relit reference: ${join(outDir, "ref-gen-relit.png")} (gain ${GAIN}, ${FW}x${FH}, offset ${offX},${offY})`);
