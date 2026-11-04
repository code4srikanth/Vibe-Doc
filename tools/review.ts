// Prompt to judgement with no site: Meta's Case agent builds each eye, headless Chrome renders it, and a separate Meta
// judge says what it sees in the images. Writes a table with a column for the AI and one for a clinician.
// Alongside the builder, Muse Image edits the healthy eye's render to fit the same prompt. This is an illustration to
// compare by eye; no judge sees it.
//   npm run review                                     every prompt in the file, medium quality, to .tmp/review/<run>/
//   npm run review -- --ids CAT-001                    only these prompts
//   npm run review -- --concurrency 3 --frames 16      renders at once (default 2), and frames per render (default 32)
//   npm run review -- --final                          48 frames, published to docs/evaluation/
//   npm run review -- --file docs/evaluation/x.prompts.json
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { ROOT, loadLibrary } from "./lib/library.ts";
import { renderJobs, type Job } from "./lib/render-lib.ts";
import { TABLE_VIEWS, blindCodes, buildBlindSheet, buildTable, weakBuild, type ClinicalReview, type EvalRow, type TableView } from "./lib/eval-table.ts";
import { EXTERIOR, VIEWS } from "../src/exam/views.ts";
import { BASE_CASE_ID, baseCase } from "../server/harness.ts";
import type { Intended } from "../server/judge.ts";

interface PromptFile {
  disease: string;
  title: string;
  /** Extra URL parameters for the render, e.g. "dilated". */
  query?: string;
  /** The table's columns, if not the cataract ones. */
  views?: TableView[];
  prompts: { id: string; description: string; prompt: string; intended: Intended }[];
}

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(/\s+/);
  return [k, v.join(" ") || "true"];
}));
const final = args.final === "true";
const frames = Number(args.frames) || (final ? 48 : 32);
const concurrency = Number(args.concurrency) || 2;
const file: PromptFile = JSON.parse(readFileSync(join(ROOT, args.file ?? "docs/evaluation/cataract.prompts.json"), "utf8"));
const views = file.views ?? TABLE_VIEWS;
const ids = args.ids?.split(",");
const prompts = file.prompts.filter(p => !ids || ids.includes(p.id));
if (!prompts.length) throw new Error(`No prompts match ${args.ids}.`);

// The builders run together, and the 60 calls a minute in gateway.ts is this project's own cap for visitors.
process.env.META_MAX_CALLS_PER_MINUTE ??= "300";
const { editImage, meta } = await import("../server/gateway.ts");
const { runCaseAgent } = await import("../server/case-agent.ts");
const { compareToIntent, judge } = await import("../server/judge.ts");

const evalDir = join(ROOT, "docs", "evaluation");
const run = new Date().toISOString().replace(/[:.]/g, "-");
const workDir = join(ROOT, ".tmp", "review", run);
const outDir = final ? evalDir : workDir;
const imageDir = join(outDir, "images");
mkdirSync(imageDir, { recursive: true });
mkdirSync(workDir, { recursive: true });
const lib = loadLibrary();
const seconds = (since: number) => Math.round((Date.now() - since) / 1000);
const timings: Record<string, number> = {};

// Muse Image: started now, so it runs alongside the builders. A failure only leaves that cell empty.
let started = Date.now();
// The healthy eye is rendered once per run, in the same view and exam conditions, so an edit starts from today's renderer.
const normalEye = join(imageDir, `${file.disease}-normal-eye-exterior.png`);
const normalRendered = renderJobs([{ case: BASE_CASE_ID, view: EXTERIOR.id, out: normalEye, query: file.query }], { frames, concurrency: 1 }).then(() => readFileSync(normalEye));
const editing = prompts.map(async p => {
  const prompt = `Edit this image of a healthy human eye so that it shows ${p.intended.diagnosis}, as it would look in this patient: ${p.prompt}. Change only what this condition would change. Keep the same eye, framing, eyelids, lashes, iris colour and lighting. No text, labels or watermarks.`;
  try {
    const path = join(imageDir, `${p.id}-muse-image-normal-eye.png`);
    writeFileSync(path, await editImage(prompt, await normalRendered));
    timings.edit_s = seconds(started);
    return { image: relative(outDir, path).replaceAll("\\", "/"), prompt };
  } catch (e) {
    console.error(`  ${p.id} normal-eye image: ${(e as Error).message}`);
    return { prompt, error: (e as Error).message };
  }
});

// Builders: all at once. One failing does not stop the others.
console.log(`Building ${prompts.length} eye(s), with the normal eye and its Muse Image edit alongside`);
const built = await Promise.all(prompts.map(async p => {
  try {
    const result = await runCaseAgent(lib, p.prompt, { model: meta, onStep: s => console.log(`  ${p.id}: ${s}`) });
    writeFileSync(join(workDir, `${p.id}.transcript.json`), JSON.stringify(result.transcript, null, 2));
    return { p, result };
  } catch (e) {
    console.error(`  ${p.id}: ${(e as Error).message}`);
    return { p, error: (e as Error).message };
  }
}));
timings.build_s = seconds(started);
const edited = new Map(prompts.map((p, i) => [p.id, editing[i]]));
// The normal eye's render shares the CPU with the renders below, so it finishes first.
await Promise.all(editing);
timings.build_and_illustrations_s = seconds(started);

// Renders: a queue, because they share the CPU.
const jobs: Job[] = built.flatMap(({ p, result }) => !result ? [] : views.map(v => ({
  case: BASE_CASE_ID, view: v.view ?? v.id, out: join(imageDir, `${p.id}-${v.id}.png`), query: [file.query, v.query].filter(Boolean).join("&") || undefined,
  remote: { base: baseCase(lib, result.intent), edits: result.edits }
})));
console.log(`Rendering ${jobs.length} image(s), ${concurrency} at a time, ${frames} frames`);
started = Date.now();
await renderJobs(jobs, { frames, concurrency }).catch(e => console.error((e as Error).message));
timings.render_s = seconds(started);

// Judges: all at once, seeing the images only.
const labels: Record<string, string> = { [EXTERIOR.id]: EXTERIOR.label, ...Object.fromEntries(Object.entries(VIEWS).map(([id, v]) => [id, v.label])) };
const toTable = (path: string) => relative(outDir, path).replaceAll("\\", "/");
console.log("Judging");
started = Date.now();
const rows: EvalRow[] = await Promise.all(built.map(async ({ p, result, error }) => {
  const base = { id: p.id, description: p.description, prompt: p.prompt, intended: p.intended, edited: await edited.get(p.id) };
  if (!result) return { ...base, edits: [], diagnosis: "", signs: [], valid: false, steps: 0, flags: ["build failed"], images: {}, error };
  const paths = views.map(v => ({ view: v.id, label: v.label ?? labels[v.view ?? v.id], path: join(imageDir, `${p.id}-${v.id}.png`) })).filter(x => existsSync(x.path));
  const row: EvalRow = {
    ...base, edits: result.edits, diagnosis: result.diagnosis, signs: result.signs, valid: result.valid, steps: result.steps,
    flags: weakBuild(result),
    images: Object.fromEntries(paths.map(x => [x.view, toTable(x.path)]))
  };
  if (paths.length < views.length) return { ...row, error: "a render failed" };
  try {
    const judgement = await judge(paths.map(x => ({ view: x.view, label: x.label, mime: "image/png", base64: readFileSync(x.path).toString("base64") })), meta);
    return { ...row, judge: judgement, match: compareToIntent(judgement, p.intended) };
  } catch (e) {
    return { ...row, error: (e as Error).message };
  }
}));
timings.judge_s = seconds(started);

// Results. A published run replaces its own rows and keeps the others.
const readJson = <T>(path: string, fallback: T): T => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as T : fallback;
const resultsFile = join(outDir, `${file.disease}.results.json`);
const earlier = readJson<{ rows: EvalRow[] }>(resultsFile, { rows: [] }).rows.filter(r => !rows.some(x => x.id === r.id));
const allRows = [...earlier, ...rows].sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(resultsFile, JSON.stringify({ run, frames, timings, rows: allRows }, null, 2));

// Judge 2 is only ever read here. The key stays out of the blind folder, which is what the clinician receives.
const clinical = readJson<Record<string, ClinicalReview>>(join(evalDir, "clinical", `${file.disease}.json`), {});
const tableFile = join(outDir, `${file.disease}.md`);
writeFileSync(tableFile, buildTable(file.title, allRows, clinical, views));

const keyFile = join(outDir, `${file.disease}.blind-key.json`);
const codes = blindCodes(allRows, readJson<Record<string, string>>(keyFile, {}));
writeFileSync(keyFile, JSON.stringify(codes, null, 2));
const blindDir = join(outDir, "blind", file.disease);
const sheet = buildBlindSheet(allRows, codes, Math.random, views);
rmSync(blindDir, { recursive: true, force: true });   // this tool's own output: older shuffles must not linger
mkdirSync(blindDir, { recursive: true });
for (const { from, to } of sheet.copies) copyFileSync(join(dirname(tableFile), from), join(blindDir, to));
writeFileSync(join(blindDir, "sheet.md"), sheet.markdown);

for (const r of rows) {
  console.log(`\n${r.id}: ${r.valid ? "valid" : "NOT valid"} after ${r.steps} steps, ${r.edits.length} edits${r.flags.length ? ` (weak build: ${r.flags.join(", ")})` : ""}`);
  for (const e of r.edits) console.log(`  ${e.component}:${e.property} = ${JSON.stringify(e.value)}  (${e.reason})`);
  if (r.judge) console.log(`  Judge: ${r.judge.diagnosis}, ${r.judge.severity}, realism ${r.judge.realism}/5, match ${JSON.stringify(r.match)}\n  ${r.judge.note}`);
  if (r.error) console.log(`  Error: ${r.error}`);
}
console.log(`\nBuild ${timings.build_s} s, with the normal eye and Muse Image alongside ${timings.build_and_illustrations_s} s (edit done at ${timings.edit_s ?? "failed"}). Render ${timings.render_s} s, judge ${timings.judge_s} s.\nTable: ${relative(ROOT, tableFile)}\nTranscripts: ${relative(ROOT, workDir)}`);
