// Visual regression test: renders the reference set and compares each image with its
// stored reference. Run with --update after an intended visual change.
import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { ROOT } from "./lib/library.ts";
import { renderJobs } from "./lib/render-lib.ts";

const config = JSON.parse(readFileSync(join(ROOT, "tests", "visual.json"), "utf8")) as {
  frames: number; threshold: number; max_diff_ratio: number; renders: { case: string; view: string }[];
};
const update = process.argv.includes("--update");
const refDir = join(ROOT, "tests", "reference"), outDir = join(ROOT, ".tmp", "visual");
mkdirSync(refDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const jobs = config.renders.map(r => ({ ...r, out: join(outDir, `${r.case}-${r.view}.png`) }));
await renderJobs(jobs, { frames: config.frames });

let failed = 0;
for (const j of jobs) {
  const name = `${j.case}-${j.view}.png`, ref = join(refDir, name);
  if (update || !existsSync(ref)) {
    copyFileSync(j.out, ref);
    console.log(`  reference ${update ? "updated" : "created"}: ${name}`);
    continue;
  }
  const a = PNG.sync.read(readFileSync(ref)), b = PNG.sync.read(readFileSync(j.out));
  if (a.width !== b.width || a.height !== b.height) { console.log(`  FAIL ${name}: size changed`); failed++; continue; }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: config.threshold });
  const ratio = n / (a.width * a.height);
  if (ratio > config.max_diff_ratio) {
    writeFileSync(join(outDir, name.replace(".png", ".diff.png")), PNG.sync.write(diff));
    console.log(`  FAIL ${name}: ${(ratio * 100).toFixed(2)}% of pixels differ (diff image in .tmp/visual)`);
    failed++;
  } else {
    console.log(`  ok   ${name}: ${(ratio * 100).toFixed(3)}% differ`);
  }
}
console.log(`\ntest:visual: ${failed ? `FAILED (${failed} of ${jobs.length})` : "passed"}`);
process.exit(failed ? 1 : 0);
