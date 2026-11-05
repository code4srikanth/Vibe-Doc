// The demo video's assembly shot: the healthy eye comes apart along one line into its 28 metadata components, then
// joins again, and the last frames are the full render itself. How each component gets its image:
//   rendered alone: every other component's scatter set to 0 through the metadata (cornea layers, lens layers, sclera)
//   a difference of two renders with one property changed (conjunctiva, macula, optic disc, retinal vessels)
//   cut from the one photo the renderer draws them from (lids, lashes, caruncle, skin)
//   an outline from its metadata size, when it has no pixels of its own (clear, or too thin to resolve)
//   npx tsx tools/assembly-video.ts --still 0.3,4.5,8.2,11           still frames, to check the look
//   FFMPEG=path/to/ffmpeg npx tsx tools/assembly-video.ts            the video: MP4 with libx264, or --out x.webm for VP8
// Renders are kept in .tmp/assembly/raw; add --rerender after a change to the eye, and --frames 16 on a busy machine.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { ROOT, loadLibrary } from "./lib/library.ts";
import { renderJobs, type Job } from "./lib/render-lib.ts";
import type { Edit } from "../src/model/edits.ts";
import { resolveCase } from "../src/model/resolve.ts";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(/\s+/);
  return [k, v.join(" ") || "true"];
}));
const WIDTH = 1920, HEIGHT = 1080, PIXELS = WIDTH*HEIGHT, FPS = 30, SECONDS = 14.5, CASE = "reference_black_brown";
const DIR = ".tmp/assembly", raw = join(ROOT, DIR, "raw"), parts = join(ROOT, DIR, "parts");

// ---- the renders ----
const off = (component: string, ...props: string[]): Edit[] => props.map(property => ({ component, property, value: 0, reason: "Shows another part alone in the demo video." }));
const colour = (component: string, props: string[], v: number): Edit[] => props.map(property => ({ component, property, value: [v, v, v], reason: "A matte for the demo video." }));
const EPI = off("eye.cornea.epithelium", "optics.scatter"), STROMA = off("eye.cornea.stroma", "optics.scatter"), ENDO = off("eye.cornea.endothelium", "optics.scatter");
const CAPSULE = off("eye.lens.capsule", "optics.scatter"), CORTEX = off("eye.lens.cortex", "optics.scatter", "optics.lamellar_contrast"), NUCLEUS = off("eye.lens.nucleus", "optics.scatter", "optics.density");
const NO_VESSELS = off("eye.conjunctiva", "appearance.vessel_gain", "appearance.capillary_opacity", "appearance.deep_vessel_opacity", "appearance.basal_vascularity", "appearance.fornix_vascularity", "appearance.margin_vascularity", "appearance.recess_vascularity");
const VESSELS = ["appearance.artery_colour", "appearance.vein_colour"], DISC = ["appearance.rim_colour", "appearance.cup_colour"];

interface Source { view?: string; query?: string; edits?: Edit[] }
const SHARP: Record<string, Source> = {   // the images the full eye and the cut-outs are made from, at full size
  full: {}, skin: { query: "layer=1" }, sclera: { query: "layer=2" }, iris: { query: "layer=3" }
};
const FAINT: Record<string, Source> = {   // parts seen small and apart, so half the size and half the samples
  lens: { query: "layer=5&dilated" },
  tear_film: { query: "layer=4", edits: [...EPI, ...STROMA, ...ENDO] },
  epithelium: { query: "layer=4", edits: [...STROMA, ...ENDO] },
  stroma: { query: "layer=4", edits: [...EPI, ...ENDO] },
  endothelium: { query: "layer=4", edits: [...EPI, ...STROMA] },
  capsule: { query: "layer=5&dilated", edits: [...CORTEX, ...NUCLEUS] },
  cortex: { query: "layer=5&dilated", edits: [...CAPSULE, ...NUCLEUS] },
  nucleus: { query: "layer=5&dilated", edits: [...CAPSULE, ...CORTEX] },
  sclera_alone: { query: "layer=2", edits: NO_VESSELS }
};
const FUNDUS: Record<string, Source> = {
  retina: { view: "fundus" },
  retina_no_macula: { view: "fundus", edits: off("eye.macula", "appearance.pigment", "appearance.foveal_reflex") },
  vessels_black: { view: "fundus", edits: colour("eye.retinal_vessels", VESSELS, 0) },
  vessels_white: { view: "fundus", edits: colour("eye.retinal_vessels", VESSELS, 1) },
  disc_black: { view: "fundus", edits: colour("eye.optic_disc", DISC, 0) },
  disc_white: { view: "fundus", edits: colour("eye.optic_disc", DISC, 1) }
};
const lib = loadLibrary();
const base = lib.cases.find(c => c.id === CASE)!;
const pending = (set: Record<string, Source>): Job[] => Object.entries(set).filter(([name]) => !existsSync(join(raw, `${name}.png`)))
  .map(([name, s]) => ({ case: CASE, view: s.view ?? "diffuse", query: s.query, out: join(raw, `${name}.png`), ...(s.edits && { remote: { base, edits: s.edits } }) }));
if (args.rerender) rmSync(raw, { recursive: true, force: true });
for (const [set, opts] of [[SHARP, { frames: Number(args.frames) || 32, width: WIDTH, height: HEIGHT, concurrency: 1 }], [FAINT, { frames: 16, width: WIDTH/2, height: HEIGHT/2 }], [FUNDUS, { frames: 16, width: WIDTH, height: HEIGHT }]] as const) {
  const jobs = pending(set);
  if (jobs.length) await renderJobs(jobs, opts);
}

// ---- helpers on full-size images: rgb is 3 bytes a pixel, a mask 1 ----
const load = async (name: string) => (await sharp(join(raw, `${name}.png`)).removeAlpha().resize(WIDTH, HEIGHT, { kernel: "lanczos3" }).raw().toBuffer()) as Buffer;
const luma = (rgb: Uint8Array) => {
  const out = new Uint8Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) out[i] = .3*rgb[3*i] + .59*rgb[3*i + 1] + .11*rgb[3*i + 2];
  return out;
};
const blurGray = async (mask: Uint8Array, sigma: number) => new Uint8Array(await sharp(Buffer.from(mask), { raw: { width: WIDTH, height: HEIGHT, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer());
const blurRgb = async (rgb: Uint8Array, sigma: number) => new Uint8Array(await sharp(Buffer.from(rgb), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).blur(sigma).raw().toBuffer());
/** Fills the masked pixels from their surroundings: a blur that ignores what is under the mask. */
const fill = async (rgb: Uint8Array, hole: Uint8Array, sigma: number) => {
  const kept = new Uint8Array(rgb), keep = new Uint8Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) {
    keep[i] = hole[i] > 40 ? 0 : 255;
    if (!keep[i]) kept[3*i] = kept[3*i + 1] = kept[3*i + 2] = 0;
  }
  const b = await blurRgb(kept, sigma), w = await blurGray(keep, sigma), out = new Uint8Array(rgb);
  for (let i = 0; i < PIXELS; i++) if (!keep[i]) for (const c of [0, 1, 2]) out[3*i + c] = Math.min(255, 255*b[3*i + c]/Math.max(w[i], 1));
  return out;
};
/** The dark region connected to (x, y): the lid opening or the pupil, without dark lashes or crypts elsewhere. */
const flood = (gray: Uint8Array, x: number, y: number, below: number) => {
  const out = new Uint8Array(PIXELS), stack = [y*WIDTH + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (out[i] || gray[i] >= below) continue;
    out[i] = 255;
    const c = i % WIDTH;
    if (c > 0) stack.push(i - 1);
    if (c < WIDTH - 1) stack.push(i + 1);
    if (i >= WIDTH) stack.push(i - WIDTH);
    if (i < WIDTH*(HEIGHT - 1)) stack.push(i + WIDTH);
  }
  return out;
};
/** Pixels from the nearest set pixel of the mask (chamfer distance). */
const distance = (mask: Uint8Array) => {
  const d = new Float32Array(PIXELS).fill(1e6), D = 1.414;
  for (let i = 0; i < PIXELS; i++) if (mask[i]) d[i] = 0;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const i = y*WIDTH + x;
    if (x) d[i] = Math.min(d[i], d[i - 1] + 1);
    if (y) { d[i] = Math.min(d[i], d[i - WIDTH] + 1); if (x) d[i] = Math.min(d[i], d[i - WIDTH - 1] + D); if (x < WIDTH - 1) d[i] = Math.min(d[i], d[i - WIDTH + 1] + D); }
  }
  for (let y = HEIGHT - 1; y >= 0; y--) for (let x = WIDTH - 1; x >= 0; x--) {
    const i = y*WIDTH + x;
    if (x < WIDTH - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
    if (y < HEIGHT - 1) { d[i] = Math.min(d[i], d[i + WIDTH] + 1); if (x < WIDTH - 1) d[i] = Math.min(d[i], d[i + WIDTH + 1] + D); if (x) d[i] = Math.min(d[i], d[i + WIDTH - 1] + D); }
  }
  return d;
};
const save = async (name: string, rgb: Uint8Array, alpha: (i: number) => number) => {
  const out = Buffer.alloc(PIXELS*4);
  for (let i = 0; i < PIXELS; i++) {
    out[4*i] = rgb[3*i]; out[4*i + 1] = rgb[3*i + 1]; out[4*i + 2] = rgb[3*i + 2];
    out[4*i + 3] = Math.max(0, Math.min(255, alpha(i)));
  }
  await sharp(out, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toFile(join(parts, `${name}.png`));
};
const soft = (x: number, a: number, b: number) => { const t = Math.max(0, Math.min(1, (x - a)/(b - a))); return t*t*(3 - 2*t); };
const xOf = (i: number) => i % WIDTH, yOf = (i: number) => Math.floor(i/WIDTH);

rmSync(parts, { recursive: true, force: true });
mkdirSync(parts, { recursive: true });

// ---- lids, lashes, caruncle and skin: cut from the one photo ----
const skinRgb = await load("skin"), skinGray = luma(skinRgb);
const opening = flood(skinGray, WIDTH >> 1, HEIGHT >> 1, 8);
let medial = WIDTH, medialY = 0, sumY = 0, nOpen = 0;
for (let i = 0; i < PIXELS; i++) if (opening[i]) { sumY += yOf(i); nOpen++; if (xOf(i) < medial) { medial = xOf(i); medialY = yOf(i); } }
const midY = sumY/nOpen, toOpening = distance(opening);
const localGray = await blurGray(skinGray, 14);
const lashAlpha = new Uint8Array(PIXELS);
for (let i = 0; i < PIXELS; i++) if (!opening[i] && toOpening[i] < 430) lashAlpha[i] = 255*soft((yOf(i) < midY ? .68 : .8)*localGray[i] - skinGray[i], 0, yOf(i) < midY ? 22 : 12);
const lashHole = await blurGray(lashAlpha, 2);
const bareSkin = await fill(skinRgb, lashHole, 12);
const dark = new Uint8Array(PIXELS*3);   // lashes are their own dark colour wherever the cut leaves them
for (let i = 0; i < PIXELS; i++) for (const c of [0, 1, 2]) dark[3*i + c] = Math.min(skinRgb[3*i + c], 60);
await save("upper_lashes", dark, i => (yOf(i) < midY ? lashAlpha[i] : 0));
await save("lower_lashes", dark, i => (yOf(i) >= midY ? lashAlpha[i] : 0));
const caruncleAt = (i: number) => Math.hypot(xOf(i) - medial, yOf(i) - medialY);
const CARUNCLE_R = 130, UPPER_LID = 120, LOWER_LID = 80;
const outside = (i: number) => soft(toOpening[i], 1, 3);   // past the dark rim the opening's edge leaves in the photo
await save("caruncle", skinRgb, i => outside(i)*255*(1 - soft(caruncleAt(i), CARUNCLE_R - 10, CARUNCLE_R + 10)));
const lidEdge = (i: number, band: number) => outside(i)*255*(1 - soft(toOpening[i], band - 4, band + 4))*soft(caruncleAt(i), CARUNCLE_R - 10, CARUNCLE_R + 10);
await save("upper_lid", bareSkin, i => (yOf(i) < midY ? lidEdge(i, UPPER_LID) : 0));
await save("lower_lid", bareSkin, i => (yOf(i) >= midY ? lidEdge(i, LOWER_LID) : 0));
await save("skin", bareSkin, i => outside(i)*255*soft(toOpening[i], (yOf(i) < midY ? UPPER_LID : LOWER_LID) - 12, (yOf(i) < midY ? UPPER_LID : LOWER_LID) - 4));

// ---- sclera and conjunctiva: the render without the conjunctiva's blood, and what the blood takes away ----
const openWide = await blurGray(opening, 5);
const inFissure = (i: number) => Math.min(255, 2*openWide[i]);
const scleraFull = await load("sclera"), scleraAlone = await load("sclera_alone");
await save("sclera", scleraAlone, inFissure);
const fullGray = luma(scleraFull), aloneGray = luma(scleraAlone);
await save("conjunctiva", scleraFull, i => inFissure(i)*soft(1 - fullGray[i]/Math.max(aloneGray[i], 1), .01, .22));

// ---- iris and pupil ----
const irisRgb = await load("iris"), irisGray = luma(irisRgb);
let x0 = WIDTH, x1 = 0, y0 = HEIGHT, y1 = 0;
for (let i = 0; i < PIXELS; i++) if (irisGray[i] > 14) { x0 = Math.min(x0, xOf(i)); x1 = Math.max(x1, xOf(i)); y0 = Math.min(y0, yOf(i)); y1 = Math.max(y1, yOf(i)); }
const cx = (x0 + x1) >> 1, cy = (y0 + y1) >> 1, irisR = (x1 - x0)/2;
const pupil = await blurGray(flood(irisGray, cx, cy, 10), 1.5);
await save("iris", irisRgb, i => (1 - soft(Math.hypot(xOf(i) - cx, yOf(i) - cy), irisR - 30, irisR))*(255 - pupil[i]));
const black = new Uint8Array(PIXELS*3).fill(14);
const pupilWide = await blurGray(pupil, 4);   // runs under the iris, so nothing shows between them
await save("pupil", black, i => Math.min(255, 2.2*pupilWide[i]));

// ---- cornea and lens layers: light on black, which the scene shows as tinted glass, brought up so a faint layer can be seen ----
const lensGray = luma(await load("lens"));
let lx0 = WIDTH, lx1 = 0;
for (let i = 0; i < PIXELS; i++) if (lensGray[i] > 5 && yOf(i) === cy) { lx0 = Math.min(lx0, xOf(i)); lx1 = Math.max(lx1, xOf(i)); }
const lensR = (lx1 - lx0)/2, lensCx = (lx0 + lx1)/2;
const lightPart = async (name: string, centre: number, radius: number) => {
  const rgb = await load(name), gray = luma(rgb);
  const reflex = await blurGray(gray.map(v => (v > 110 ? 255 : 0)), 7);
  const clean = await fill(rgb, reflex, 30);   // the corneal reflex shows in these renders too; it is the tear film's
  const smooth = await blurRgb(clean, 1.5), g = luma(smooth), levels: number[] = [];
  for (let i = 0; i < PIXELS; i += 7) if (Math.hypot(xOf(i) - centre, yOf(i) - cy) < radius) levels.push(g[i]);
  levels.sort((a, b) => a - b);
  const gain = Math.min(14, 85/Math.max(levels[Math.floor(levels.length*.98)], 1));
  console.log(`  ${name}: brought up x${gain.toFixed(1)}`);
  const out = new Uint8Array(PIXELS*3);
  for (let i = 0; i < PIXELS; i++) {
    const edge = 1 - soft(Math.hypot(xOf(i) - centre, yOf(i) - cy), radius - 14, radius);
    for (const c of [0, 1, 2]) out[3*i + c] = Math.min(255, smooth[3*i + c]*gain*edge);
  }
  await save(name, out, () => 255);
};
const corneaR = irisR*1.02;
for (const name of ["epithelium", "stroma", "endothelium"]) await lightPart(name, cx, corneaR);
for (const name of ["capsule", "cortex", "nucleus"]) await lightPart(name, lensCx, lensR);
const tearGray = luma(await load("tear_film"));
await save("tear_film", new Uint8Array(PIXELS*3).fill(255), i => soft(tearGray[i], 60, 180)*255);

// ---- the fundus: squares round its field ----
const FIELD = HEIGHT, FX = (WIDTH - FIELD) >> 1;
const saveFundus = async (name: string, rgb: Uint8Array, alpha: (i: number) => number) => {
  const out = Buffer.alloc(FIELD*FIELD*4);
  for (let y = 0; y < FIELD; y++) for (let x = 0; x < FIELD; x++) {
    const o = 4*(y*FIELD + x), i = y*WIDTH + x + FX;
    out[o] = rgb[3*i]; out[o + 1] = rgb[3*i + 1]; out[o + 2] = rgb[3*i + 2];
    out[o + 3] = Math.max(0, Math.min(255, alpha(i)))*(1 - soft(Math.hypot(x - FIELD/2, y - FIELD/2), FIELD/2 - 12, FIELD/2 - 4));
  }
  await sharp(out, { raw: { width: FIELD, height: FIELD, channels: 4 } }).png().toFile(join(parts, `${name}.png`));
};
const matte = (a: Uint8Array, b: Uint8Array) => {   // where a colour change shows: the part's own coverage
  const out = new Uint8Array(PIXELS);
  let top = 1;
  for (let i = 0; i < PIXELS; i++) { out[i] = Math.abs(a[i] - b[i]); top = Math.max(top, out[i]); }
  return out.map(v => Math.min(255, 255*v/top*1.6));
};
const fundus = await load("retina"), noMacula = await load("retina_no_macula");
const vesselMask = matte(luma(await load("vessels_black")), luma(await load("vessels_white")));
const discMask = matte(luma(await load("disc_black")), luma(await load("disc_white")));
await saveFundus("retinal_vessels", fundus, i => vesselMask[i]);
const discWhole = await blurGray(discMask, 9);   // whole, though vessels cross it
await saveFundus("optic_disc", fundus, i => 255*soft(discWhole[i], 70, 110));
const fundusGray = luma(fundus), noMacGray = luma(noMacula);
await saveFundus("macula", new Uint8Array(PIXELS*3).fill(10), i => 255*soft(1 - fundusGray[i]/Math.max(noMacGray[i], 1), .01, .25)*(1 - vesselMask[i]/255));
const holes = await blurGray(vesselMask.map((v, i) => Math.max(v, discWhole[i] > 40 ? 255 : 0)), 2);
await saveFundus("retina", await fill(noMacula, holes, 60), () => 255);

// ---- what has no pixels of its own: its outline, at its size in the metadata ----
const eye = resolveCase(lib, base);
const pxPerMm = irisR/(eye.num("eye.cornea", "anatomy.diameter")/2);
const outline = (name: string, r: number, fillOpacity = .06) => sharp(Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#0b8693" fill-opacity="${fillOpacity}" stroke="#0b8693" stroke-width="6"/></svg>`)).png().toFile(join(parts, `${name}.png`));
await outline("cornea", corneaR);
await outline("bowman", corneaR*.98, .03);
await outline("descemet", corneaR*.94, .03);
await outline("anterior_chamber", irisR*.9, .1);
await outline("lens_shape", eye.num("eye.lens", "anatomy.equatorial_diameter")/2*pxPerMm);
await outline("globe", Math.min(eye.num("eye.globe", "anatomy.radius")*pxPerMm, HEIGHT/2 - 8), .04);
// the fissure's outline, from the opening itself
const fissureEdge = await blurGray(opening, 2.5);
await save("palpebral_fissure", new Uint8Array(PIXELS*3).map((_, k) => [11, 134, 147][k % 3]), i => 255*soft(127 - Math.abs(fissureEdge[i] - 127), 60, 120) + (opening[i] ? 18 : 0));

// ---- the counts on screen come from the metadata ----
const isQuantity = (o: object) => "unit" in o && ("value" in o || "age" in o || "derived" in o);
const countQuantities = (o: unknown): number => {
  if (!o || typeof o !== "object") return 0;
  if (isQuantity(o)) return 1;
  return Object.values(o).reduce((n: number, v) => n + countQuantities(v), 0);
};
const files = readdirSync(join(ROOT, "eye-model/normal")).filter(f => f.endsWith(".json"));
const quantities = files.reduce((n, f) => n + countQuantities(JSON.parse(readFileSync(join(ROOT, "eye-model/normal", f), "utf8"))), 0);
console.log(`  ${files.length} components, ${quantities} quantities`);
await sharp(join(raw, "full.png")).toFile(join(parts, "full.png"));

// ---- film the scene frame by frame ----
const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0 } });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("console", m => { if (m.type() === "error" && !m.text().includes("404")) console.log(`  [page] ${m.text().slice(0, 500)}`); });
  page.on("pageerror", e => console.log(`  [page] ${e.message}`));
  await page.goto(`${server.resolvedUrls!.local[0]}tools/assembly/scene.html?dir=${DIR}/parts&components=${files.length}&quantities=${quantities}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as unknown as { sceneReady?: boolean }).sceneReady, null, { timeout: 180_000 });
  const seek = (t: number) => page.evaluate(x => (window as unknown as { seek(t: number): void }).seek(x), t);

  if (args.still) {
    const stills = join(ROOT, DIR, "stills");
    mkdirSync(stills, { recursive: true });
    for (const t of args.still.split(",").map(Number)) {
      await seek(t);
      await page.screenshot({ path: join(stills, `t${t}.png`) });
      console.log(`  still at ${t} s`);
    }
  } else {
    const out = args.out ?? join(ROOT, DIR, "eye-assembly.mp4");
    const codec = out.endsWith(".webm") ? ["-c:v", "vp8", "-qmin", "0", "-qmax", "30", "-crf", "6", "-b:v", "16M", "-deadline", "good", "-speed", "1"] : ["-c:v", "libx264", "-crf", "16", "-preset", "slow", "-movflags", "+faststart"];
    const ffmpeg = spawn(process.env.FFMPEG ?? "ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0", ...codec, "-vf", "scale=in_range=full:out_range=tv,format=yuv420p", out], { stdio: ["pipe", "ignore", "inherit"] });
    const done = new Promise<void>((ok, no) => { ffmpeg.on("error", no); ffmpeg.on("close", c => (c ? no(new Error(`ffmpeg exited with ${c}`)) : ok())); });
    const total = FPS*SECONDS;
    for (let f = 0; f < total; f++) {
      await seek(f/FPS);
      const jpeg = await page.screenshot({ type: "jpeg", quality: 98 });
      if (!ffmpeg.stdin.write(jpeg)) await new Promise(ok => ffmpeg.stdin.once("drain", ok));
      if (f % 30 === 0) console.log(`  frame ${f} of ${total}`);
    }
    ffmpeg.stdin.end();
    await done;
    console.log(`  wrote ${out}`);
  }
} finally {
  await browser.close();
  await server.close();
}
