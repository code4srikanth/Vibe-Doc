// Renders cases x views for review.
//   npm run render -- --round 2                        all cases and views, plus blind sheets for the Doctor
//   npm run render -- --round 2-dev --cases ns4 --views optic_section_lens,retroillumination
//   npm run render -- --out .tmp/check --cases aacg    plain renders, no blind sheets
//   npm run render -- --out .tmp/L2 --cases reference_black_brown --views exterior --width 1640 --height 1093
//                                                      external view in the exterior crop's frame (51.2 px/mm)
//   ... --query eyeonly                                extra URL parameters (eyeonly: the eye layer without the exterior)
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ROOT, loadLibrary } from "./lib/library.ts";
import { renderJobs } from "./lib/render-lib.ts";
import { EXTERIOR, VIEWS } from "../src/exam/views.ts";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(/\s+/);
  return [k, v.join(" ") || "true"];
}));
const lib = loadLibrary();
const cases = args.cases ? args.cases.split(",") : lib.cases.map(c => c.id);
const views = args.views ? args.views.split(",") : Object.keys(VIEWS);
const known = [...Object.keys(VIEWS), EXTERIOR.id];
for (const c of cases) if (!lib.cases.some(k => k.id === c)) throw new Error(`Unknown case ${c}`);
for (const v of views) if (!known.includes(v)) throw new Error(`Unknown view ${v}; use ${known.join(", ")}`);

const outDir = args.out ? join(ROOT, args.out) : join(ROOT, "reviews", `round-${args.round ?? "adhoc"}`);
const renderDir = join(outDir, "renders");
const jobs = cases.flatMap(c => views.map(v => ({ case: c, view: v, out: join(renderDir, `${c}-${v}.png`), query: args.query })));
console.log(`Rendering ${jobs.length} views to ${renderDir}`);
await renderJobs(jobs, { frames: Number(args.frames) || 48, width: Number(args.width) || 960, height: Number(args.height) || 540 });

// Blind sheets for the Doctor agent: one 2x2 sheet per case, cases shuffled under letter codes.
if (args.round && args["no-blind"] !== "true") {
  const blindDir = join(outDir, "blind");
  mkdirSync(blindDir, { recursive: true });
  const shuffled = [...cases].sort(() => Math.random() - 0.5);
  const key: string[] = [];
  for (const [i, c] of shuffled.entries()) {
    const code = String.fromCharCode(65 + i);
    const tiles = await Promise.all(views.map(async (v, j) => {
      const label = Buffer.from(`<svg width="960" height="40"><text x="12" y="26" font-family="Consolas, monospace" font-size="20" font-weight="bold" fill="#ffd400">${v === EXTERIOR.id ? EXTERIOR.label : VIEWS[v as keyof typeof VIEWS].label}</text></svg>`);
      const tile = await sharp(join(renderDir, `${c}-${v}.png`)).resize(960, 540).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer();
      return { input: tile, left: (j % 2) * 960, top: Math.floor(j / 2) * 540 };
    }));
    await sharp({ create: { width: 1920, height: 540 * Math.ceil(views.length / 2), channels: 3, background: "#000" } })
      .composite(tiles).png().toFile(join(blindDir, `case-${code}.png`));
    key.push(`${code}=${c}`);
  }
  writeFileSync(join(outDir, "answer-key.txt"), key.join("\n") + "\n");
  console.log(`Blind sheets in ${blindDir} (answer key: answer-key.txt, not for the Doctor)`);
}
