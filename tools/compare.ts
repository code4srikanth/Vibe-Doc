// Measured comparison of a render with its reference: a side-by-side image, plus numbers for
// the acceptance checks, so a check passes or fails by measurement, not by opinion.
//   npx tsx tools/compare.ts --render a.png --ref b.png --out .tmp/cmp [--checks checks.json]
// Exit code 1 if any check fails.
//
// checks.json: { "render_px_per_mm": 51.2, "ref_px_per_mm": 51.2, "checks": [ ... ] }   (a bare array of patch checks also works)
//   patch:    { "name", "ref": [x,y,w,h], "render": [x,y,w,h], "max_de" }
//             colour difference (CIE76 delta E) of the mean colour of two rectangles (each image's own pixels)
//   position: { "type": "position", "name", "image": "ref"|"render", "line": [x0,y0,x1,y1], "channel": "luma"|"alpha",
//               "threshold": 0-255, "expect_mm", "tol_mm" }
//             distance from the line start to the first place the channel crosses the threshold (an edge), in mm
//   width:    { "type": "width", ... same fields plus "mode": "below"|"above" }
//             length in mm of the longest stretch along the line where the channel is below (default) or above the
//             threshold: a diameter or an opening. The stretch must not touch either end of the line.
// Use "alpha" to measure the cut-out opening of an RGBA layer. Geometry checks need the image's px_per_mm.
//   texture:  { "type": "texture", "name", "ref": [x,y,w,h], "render": [x,y,w,h], "metric", ...metric fields, "min_ratio", "max_ratio" }
//             a statistic of each image's own rectangle (the render is another eye with a random layout, so statistics,
//             never feature positions); passes when render/ref lies in [min_ratio, max_ratio]. Scales are mm, converted
//             with each image's px_per_mm; luma is Rec.601; blurs are gaussian (sigma in mm), padded by 3 sigma.
//             local_std:      median over the rectangle of the local std/mean of luma (fine_mm pre-blur, window_mm window)
//             crest_cv,       along lines in "axis": crests of gauss(luma, fine_mm) - gauss(luma, background_mm) above
//             crest_spacing:  crest_min and above their neighbours within 0.04 mm; the CV, or the mean (mm), of their spacing
//             profile_std:    median over lines along "axis" of std/mean of gauss(luma, scale_mm)
//             ridge_fraction: fraction of pixels whose relative drop below the background_mm blur of luma or green
//                             (minus any red drop when red_correct) exceeds threshold
//             ridge_colour:   mean sRGB of the ridge_fraction pixels; passes on CIE76 dE <= max_de
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

type Rect = [number, number, number, number];
type Line = [number, number, number, number];
type Channel = "luma" | "alpha";
interface PatchCheck { type?: "patch"; name: string; ref: Rect; render: Rect; max_de?: number }
interface GeometryCheck {
  type: "position" | "width"; name: string; image: "ref" | "render"; line: Line;
  channel?: Channel; threshold: number; mode?: "below" | "above"; expect_mm: number; tol_mm: number;
}
interface TextureCheck {
  type: "texture"; name: string; ref: Rect; render: Rect;
  metric: "local_std" | "crest_cv" | "crest_spacing" | "profile_std" | "ridge_fraction" | "ridge_colour";
  window_mm?: number; fine_mm?: number; background_mm?: number; scale_mm?: number; axis?: "x" | "y"; crest_min?: number;
  channel?: "luma" | "green"; red_correct?: boolean; threshold?: number; min_ratio?: number; max_ratio?: number; max_de?: number;
}
interface CheckFile { ref_px_per_mm?: number; render_px_per_mm?: number; checks: (PatchCheck | GeometryCheck | TextureCheck)[] }

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(/\s+/);
  return [k, v.join(" ")];
}));
const checksFile = args.checks ?? args.patches;
if (!args.render || !args.ref || !args.out) throw new Error("usage: --render <png> --ref <png> --out <dir> [--checks <json>]");
mkdirSync(args.out, { recursive: true });

// side by side at the same height: reference left, render right
const H = 720;
const [a, b] = await Promise.all([args.ref, args.render].map(f => sharp(f).resize({ height: H }).png().toBuffer({ resolveWithObject: true })));
await sharp({ create: { width: a.info.width + b.info.width + 8, height: H, channels: 3, background: "#000" } })
  .composite([{ input: a.data, left: 0, top: 0 }, { input: b.data, left: a.info.width + 8, top: 0 }])
  .png().toFile(join(args.out, "side-by-side.png"));
console.log(`side by side: ${join(args.out, "side-by-side.png")}`);

// ---- colour ---------------------------------------------------------------------------------
function lab([r, g, b]: number[]): number[] {
  const lin = (v: number) => (v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const xyz = [(0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, 0.2126 * R + 0.7152 * G + 0.0722 * B, (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883];
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const [fx, fy, fz] = xyz.map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
async function meanRgb(file: string, [x, y, w, h]: Rect) {
  // stats() reads the input, not the pipeline output, so crop to a buffer first
  const crop = await sharp(file).extract({ left: x, top: y, width: w, height: h }).removeAlpha().png().toBuffer();
  const s = await sharp(crop).stats();
  return s.channels.slice(0, 3).map(c => c.mean);
}

// ---- geometry -------------------------------------------------------------------------------
interface Raster { w: number; h: number; d: Buffer }
const rasters = new Map<string, Raster>();
async function raster(file: string): Promise<Raster> {
  let r = rasters.get(file);
  if (!r) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    r = { w: info.width, h: info.height, d: data };
    rasters.set(file, r);
  }
  return r;
}

/** Channel values at 1 px spacing along the line (index = distance from the start in px). */
function profile(r: Raster, [x0, y0, x1, y1]: Line, channel: Channel): number[] {
  const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = len ? i / len : 0;
    const xi = Math.min(r.w - 1, Math.max(0, Math.round(x0 + (x1 - x0) * t)));
    const yi = Math.min(r.h - 1, Math.max(0, Math.round(y0 + (y1 - y0) * t)));
    const o = (yi * r.w + xi) * 4;
    return channel === "alpha" ? r.d[o + 3] : 0.299 * r.d[o] + 0.587 * r.d[o + 1] + 0.114 * r.d[o + 2];
  });
}
/** Where the profile crosses the threshold between samples i and i+1 (sub-pixel). */
const crossing = (v: number[], i: number, thr: number) => i + (thr - v[i]) / (v[i + 1] - v[i]);

function measure(c: GeometryCheck, v: number[]): { px: number } | { error: string } {
  const thr = c.threshold;
  if (c.type === "position") {
    for (let i = 0; i + 1 < v.length; i++) if ((v[i] < thr) !== (v[i + 1] < thr)) return { px: crossing(v, i, thr) };
    return { error: "no edge along the line" };
  }
  const inRun = (x: number) => c.mode === "above" ? x > thr : x < thr;
  let best: [number, number] | undefined;
  for (let i = 0; i < v.length;) {
    if (!inRun(v[i])) { i++; continue; }
    let j = i;
    while (j + 1 < v.length && inRun(v[j + 1])) j++;
    if (!best || j - i > best[1] - best[0]) best = [i, j];
    i = j + 1;
  }
  if (!best) return { error: "nothing on the line passes the threshold" };
  const [i0, i1] = best;
  if (i0 === 0 || i1 === v.length - 1) return { error: "the stretch reaches the end of the line: extend the line" };
  return { px: crossing(v, i1, thr) - crossing(v, i0 - 1, thr) };
}

// ---- texture statistics ---------------------------------------------------------------------
/** Separable gaussian blur (sigma in px) with clamped edges. */
function gblur(src: Float32Array, W: number, H: number, s: number): Float32Array {
  if (s <= 0) return Float32Array.from(src);
  const r = Math.ceil(3 * s), k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * s * s)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += src[y * W + Math.min(W - 1, Math.max(0, x + i))] * k[i + r];
    tmp[y * W + x] = a;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) a += tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x] * k[i + r];
    out[y * W + x] = a;
  }
  return out;
}
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

/** The check's statistic over one image's rectangle (a colour for ridge_colour; null if nothing qualifies). */
async function textureStat(file: string, [x, y, w, h]: Rect, ppm: number, c: TextureCheck): Promise<number | number[] | null> {
  const r0 = await raster(file);
  const pad = Math.ceil(3 * ppm * Math.max(c.window_mm ?? 0, c.background_mm ?? 0, c.scale_mm ?? 0, 0.25));
  const L = Math.max(0, x - pad), T = Math.max(0, y - pad), R = Math.min(r0.w, x + w + pad), B = Math.min(r0.h, y + h + pad);
  const W = R - L, H = B - T, n = W * H;
  const ch = (k: number) => Float32Array.from({ length: n }, (_, i) => r0.d[((T + Math.floor(i / W)) * r0.w + L + i % W) * 4 + k]);
  const red = ch(0), grn = ch(1), blu = ch(2);
  const luma = Float32Array.from({ length: n }, (_, i) => 0.299 * red[i] + 0.587 * grn[i] + 0.114 * blu[i]);
  const ox = x - L, oy = y - T, s = (mm: number) => mm * ppm, fine = c.fine_mm ?? 0.02;
  const inside = <V>(f: (i: number) => V) => { const out: V[] = []; for (let yy = oy; yy < oy + h; yy++) for (let xx = ox; xx < ox + w; xx++) out.push(f(yy * W + xx)); return out; };
  // relative drop of a pixel below its background (vessels, crypts), minus any red drop when red_correct
  const drop = () => {
    const src = c.channel === "green" ? grn : luma;
    const sm = gblur(src, W, H, s(fine)), bg = gblur(src, W, H, s(c.background_mm!));
    const rs = c.red_correct ? gblur(red, W, H, s(fine)) : undefined, rb = c.red_correct ? gblur(red, W, H, s(c.background_mm!)) : undefined;
    return (i: number) => (bg[i] - sm[i]) / Math.max(1, bg[i]) - (rs && rb ? Math.max(0, (rb[i] - rs[i]) / Math.max(1, rb[i])) : 0);
  };
  // the signal along every second line in the check's axis
  const lines = (a: Float32Array) => {
    const out: number[][] = [];
    const nl = c.axis === "y" ? w : h, len = c.axis === "y" ? h : w;
    for (let l = 0; l < nl; l += 2) out.push(Array.from({ length: len }, (_, k) => c.axis === "y" ? a[(oy + k) * W + ox + l] : a[(oy + l) * W + ox + k]));
    return out;
  };
  switch (c.metric) {
    case "local_std": {
      const Lf = gblur(luma, W, H, s(fine)), m = gblur(Lf, W, H, s(c.window_mm!)), q = gblur(Lf.map(v => v * v), W, H, s(c.window_mm!));
      return median(inside(i => Math.sqrt(Math.max(0, q[i] - m[i] * m[i])) / Math.max(1, m[i])));
    }
    case "crest_cv": case "crest_spacing": {
      const a = gblur(luma, W, H, s(fine)), b = gblur(luma, W, H, s(c.background_mm ?? 0.2));
      const hp = a.map((v, i) => v - b[i]), nb = Math.max(1, Math.round(s(0.04))), sp: number[] = [];
      for (const sig of lines(hp)) {
        let last = -1;
        for (let k = nb; k < sig.length - nb; k++) {
          let peak = sig[k] > (c.crest_min ?? 2);
          for (let j = 1; j <= nb && peak; j++) peak = sig[k] > sig[k - j] && sig[k] >= sig[k + j];
          if (peak) { if (last >= 0) sp.push((k - last) / ppm); last = k; }
        }
      }
      if (!sp.length) return null;
      return c.metric === "crest_cv" ? std(sp) / mean(sp) : mean(sp);
    }
    case "profile_std":
      return median(lines(gblur(luma, W, H, s(c.scale_mm!))).map(sig => std(sig) / Math.max(1, mean(sig))));
    case "ridge_fraction": {
      const x = drop();
      return mean(inside(i => x(i) > c.threshold! ? 1 : 0));
    }
    case "ridge_colour": {
      const x = drop(), acc: number[][] = [[], [], []];
      inside(i => { if (x(i) > c.threshold!) { acc[0].push(red[i]); acc[1].push(grn[i]); acc[2].push(blu[i]); } return 0; });
      return acc[0].length ? acc.map(mean) : null;
    }
  }
}

// ---- run the checks -------------------------------------------------------------------------
if (checksFile) {
  const raw = JSON.parse(readFileSync(checksFile, "utf8")) as CheckFile | CheckFile["checks"];
  const file: CheckFile = Array.isArray(raw) ? { checks: raw } : raw;
  const patches = file.checks.filter((c): c is PatchCheck => c.type === undefined || c.type === "patch");
  const geometry = file.checks.filter((c): c is GeometryCheck => c.type === "position" || c.type === "width");
  const textures = file.checks.filter((c): c is TextureCheck => c.type === "texture");
  let failed = 0;

  if (patches.length) {
    console.log("\n| colour patch | reference | render | dE | limit | |\n|---|---|---|---|---|---|");
    for (const p of patches) {
      const [cr, cn] = await Promise.all([meanRgb(args.ref, p.ref), meanRgb(args.render, p.render)]);
      const [l1, l2] = [lab(cr), lab(cn)];
      const de = Math.hypot(l1[0] - l2[0], l1[1] - l2[1], l1[2] - l2[2]);
      const hex = (c: number[]) => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
      const ok = p.max_de === undefined || de <= p.max_de;
      if (!ok) failed++;
      console.log(`| ${p.name} | ${hex(cr)} | ${hex(cn)} | ${de.toFixed(1)} | ${p.max_de ?? "-"} | ${ok ? "PASS" : "FAIL"} |`);
    }
  }

  if (geometry.length) {
    console.log("\n| geometry check | image | measured | expected | |\n|---|---|---|---|---|");
    for (const c of geometry) {
      const ppm = c.image === "ref" ? file.ref_px_per_mm : file.render_px_per_mm;
      if (!ppm) throw new Error(`"${c.name}": the check file needs ${c.image}_px_per_mm`);
      const r = await raster(c.image === "ref" ? args.ref : args.render);
      const m = measure(c, profile(r, c.line, c.channel ?? "luma"));
      const expected = `${c.expect_mm} ± ${c.tol_mm} mm`;
      if ("error" in m) { failed++; console.log(`| ${c.name} | ${c.image} | ${m.error} | ${expected} | FAIL |`); continue; }
      const mm = m.px / ppm, ok = Math.abs(mm - c.expect_mm) <= c.tol_mm;
      if (!ok) failed++;
      console.log(`| ${c.name} | ${c.image} | ${mm.toFixed(2)} mm | ${expected} | ${ok ? "PASS" : "FAIL"} |`);
    }
  }
  if (textures.length) {
    if (!file.ref_px_per_mm || !file.render_px_per_mm) throw new Error("texture checks need ref_px_per_mm and render_px_per_mm");
    console.log("\n| texture check | metric | reference | render | ratio / dE | limit | |\n|---|---|---|---|---|---|---|");
    const hex = (c: number[]) => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
    for (const c of textures) {
      const [vr, vn] = await Promise.all([textureStat(args.ref, c.ref, file.ref_px_per_mm, c), textureStat(args.render, c.render, file.render_px_per_mm, c)]);
      const limit = c.metric === "ridge_colour" ? `dE ≤ ${c.max_de ?? "-"}` : `${c.min_ratio ?? 0}-${c.max_ratio ?? "inf"}`;
      if (vr === null || vn === null) { failed++; console.log(`| ${c.name} | ${c.metric} | ${vr === null ? "none" : "-"} | ${vn === null ? "none" : "-"} | - | ${limit} | FAIL |`); continue; }
      if (Array.isArray(vr) && Array.isArray(vn)) {
        const [l1, l2] = [lab(vr), lab(vn)];
        const de = Math.hypot(l1[0] - l2[0], l1[1] - l2[1], l1[2] - l2[2]), ok = de <= (c.max_de ?? Infinity);
        if (!ok) failed++;
        console.log(`| ${c.name} | ${c.metric} | ${hex(vr)} | ${hex(vn)} | dE ${de.toFixed(1)} | ${limit} | ${ok ? "PASS" : "FAIL"} |`);
        continue;
      }
      const ratio = (vn as number) / (vr as number), ok = ratio >= (c.min_ratio ?? 0) && ratio <= (c.max_ratio ?? Infinity);
      if (!ok) failed++;
      console.log(`| ${c.name} | ${c.metric} | ${(vr as number).toFixed(4)} | ${(vn as number).toFixed(4)} | ${ratio.toFixed(2)} | ${limit} | ${ok ? "PASS" : "FAIL"} |`);
    }
  }
  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nall checks passed");
}
