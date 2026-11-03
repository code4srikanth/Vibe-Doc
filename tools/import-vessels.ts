// Builds the conjunctival vessel map used by the app from a hand-refined superficial-vessel image.
//   npm run import:vessels -- --in <superficial.png> [--gain 0.45] [--floor 45] [--thick 0.5]
// Input: any size, 2:1, black disc (the cornea) in the middle. It is scaled so the disc matches the limbus ring of
// the map (vessel-map/map-info.json), the disc is cleared, and the deep and calibre channels are derived from it.
// Output: assets/conjunctiva/vessel-map.png (R superficial, G deep, B calibre; row 0 = +v) and vessel-map/refined/*.png.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ROOT } from "./lib/library.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter(a => a.length));
if (!args.in) throw new Error("usage: import-vessels --in <superficial.png>");
const info = JSON.parse(readFileSync(join(ROOT, "vessel-map", "map-info.json"), "utf8"));
const W = info.width_px as number, H = info.height_px as number, ringPx = info.limbus_radius_px as number;
const gain = Number(args.gain ?? 0.45), floor = Number(args.floor ?? 45);
const thick = Number(args.thick ?? 0.5);   // width kept by the large and trunk vessels (10 px and wider on the map); 1 = unchanged

const src = await sharp(args.in).greyscale().raw().toBuffer({ resolveWithObject: true });
const sw = src.info.width, sh = src.info.height, d = src.data;
// the black disc: longest dark run through the middle row and column
const run = (get: (i: number) => number, n: number): [number, number] => { let l = n >> 1, r = l; while (l > 0 && get(l - 1) < 14) l--; while (r < n - 1 && get(r + 1) < 14) r++; return [l, r]; };
const [x0, x1] = run(x => d[(sh >> 1) * sw + x], sw), [y0, y1] = run(y => d[y * sw + (sw >> 1)], sh);
const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rSrc = ((x1 - x0) + (y1 - y0)) / 4;
const k = ringPx / (rSrc * W / sw);   // enlargement that brings the disc to the map's limbus ring
const cw = sw / k, ch = cw / 2, left = Math.round(cx - cw / 2), top = Math.round(cy - ch / 2);
console.log(`source ${sw}x${sh}, disc r ${rSrc.toFixed(1)} px at (${cx.toFixed(0)}, ${cy.toFixed(0)}); scale x${k.toFixed(3)}, crop ${left},${top} ${Math.round(cw)}x${Math.round(ch)}`);
if (left < 0 || top < 0 || left + cw > sw + 1 || top + ch > sh + 1) throw new Error("disc is too far off centre or too large to fit the map");

const fit = await sharp(args.in).greyscale().extract({ left, top, width: Math.round(cw), height: Math.round(ch) }).resize(W, H, { kernel: "lanczos3" }).raw().toBuffer();
const R = Buffer.alloc(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, r = Math.hypot(x + .5 - W / 2, y + .5 - H / 2);
  if (r < ringPx + 6) continue;   // the cornea, and a hair outside it, stays clear
  R[i] = Math.round(255 * Math.min(1, Math.max(0, (fit[i] - floor) / (255 - floor)) * gain));
}

// Large and trunk vessels (10 px / 0.15 mm and wider) are narrowed to `thick` of their width about their centreline,
// blending in from 8 px so a vessel does not jump in width where it passes the limit.
if (thick < 1) {
  const bin = (i: number) => R[i] >= 25;
  const D = new Float32Array(W * H);   // chamfer 3-4 distance to the nearest non-vessel pixel
  for (let i = 0; i < W * H; i++) D[i] = bin(i) ? 1e9 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; let v = D[i]; if (!v) continue;
    if (x > 0) v = Math.min(v, D[i - 1] + 1); if (y > 0) { v = Math.min(v, D[i - W] + 1); if (x > 0) v = Math.min(v, D[i - W - 1] + 1.414); if (x < W - 1) v = Math.min(v, D[i - W + 1] + 1.414); } D[i] = v; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; let v = D[i]; if (!v) continue;
    if (x < W - 1) v = Math.min(v, D[i + 1] + 1); if (y < H - 1) { v = Math.min(v, D[i + W] + 1); if (x < W - 1) v = Math.min(v, D[i + W + 1] + 1.414); if (x > 0) v = Math.min(v, D[i + W - 1] + 1.414); } D[i] = v; }
  const RL = new Float32Array(W * H);   // local half-width: the largest disc covering the pixel (painted from the centreline maxima)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, d = D[i]; if (d < 4) continue;
    let top = true; for (let dy = -1; dy <= 1 && top; dy++) for (let dx = -1; dx <= 1; dx++) if (D[i + dy * W + dx] > d) { top = false; break; }
    if (!top) continue;
    const rad = Math.ceil(d);
    for (let yy = Math.max(0, y - rad); yy <= Math.min(H - 1, y + rad); yy++) for (let xx = Math.max(0, x - rad); xx <= Math.min(W - 1, x + rad); xx++)
      if ((xx - x) ** 2 + (yy - y) ** 2 <= d * d && d > RL[yy * W + xx]) RL[yy * W + xx] = d;
  }
  const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < W * H; i++) {
    const rl = RL[i]; if (rl <= 4 || !bin(i)) continue;
    const keep = 1 - (1 - thick) * ss(4, 5, rl);                      // fraction of the half-width kept
    R[i] = Math.round(R[i] * Math.min(1, Math.max(0, D[i] - rl * (1 - keep) + 0.5)));
  }
}
const blur = (b: Buffer, s: number) => sharp(b, { raw: { width: W, height: H, channels: 1 } }).blur(s).raw().toBuffer();
const near = await blur(R, 2.5);                                   // thick vessels survive the blur, twigs fade: calibre
const wide = Buffer.alloc(W * H); for (let i = 0; i < wide.length; i++) wide[i] = near[i] > 95 ? R[i] : 0;   // only the trunks
const deepBlur = await blur(wide, 7);
const G = Buffer.alloc(W * H), B = Buffer.alloc(W * H);
for (let i = 0; i < W * H; i++) { G[i] = Math.min(255, Math.round(deepBlur[i] * 2.2)); B[i] = R[i] > 40 ? Math.min(255, Math.round(near[i] * 1.6)) : 0; }

const rgba = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { rgba[i * 4] = R[i]; rgba[i * 4 + 1] = G[i]; rgba[i * 4 + 2] = B[i]; rgba[i * 4 + 3] = 255; }
mkdirSync(join(ROOT, "assets", "conjunctiva"), { recursive: true });
mkdirSync(join(ROOT, "vessel-map", "refined"), { recursive: true });
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(ROOT, "assets", "conjunctiva", "vessel-map.png"));
for (const [n, b] of [["superficial-vessels", R], ["deep-vessels", G], ["calibre", B]] as const)
  await sharp(b, { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(ROOT, "vessel-map", "refined", `${n}.png`));
console.log("wrote assets/conjunctiva/vessel-map.png and vessel-map/refined/");
