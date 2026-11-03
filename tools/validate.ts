// Validates the whole eye-model library, the equivalent of a Salesforce deployment check:
// JSON Schema, type requirements, references, disease patches, grade monotonicity,
// anatomy rules on resolved eyes, fissure/lid mm values against the photo trace (fissure.json),
// and which metadata the renderer does not consume.
// Exit code 1 if anything is an error.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { MODEL, readJsonDir, loadLibrary } from "./lib/library.ts";
import { readTrace, traceMm } from "./lib/trace.ts";
import { checkRules, resolveCase, type Issue } from "../src/model/resolve.ts";
import { FACETS } from "../src/model/library.ts";
import { moduleFor } from "../src/render/modules/index.ts";
import type { Case, EyeComponent } from "../src/model/generated.ts";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default as typeof import("ajv").default;

const errors: string[] = [], warnings: string[] = [], notes: string[] = [];
const err = (m: string) => errors.push(m), warn = (m: string) => warnings.push(m);

// 1. JSON Schema
const ajv = new Ajv({ allErrors: true, strict: false });
for (const s of ["quantity", "component", "disease", "case", "rules", "type", "variant"]) {
  ajv.addSchema(JSON.parse(readFileSync(join(MODEL, "schema", `${s}.schema.json`), "utf8")));
}
const checkSchema = (schema: string, file: string, data: unknown) => {
  if (!ajv.validate(`${schema}.schema.json`, data)) {
    for (const e of ajv.errors ?? []) err(`${file}: ${e.instancePath || "/"} ${e.message}`);
  }
};
const dirs: [string, string, string?][] = [["normal", "component"], ["schema/types", "type", ".type.json"], ["diseases", "disease"], ["variants", "variant"], ["cases", "case"]];
for (const [dir, schema, suffix] of dirs) for (const { file, data } of readJsonDir(dir, suffix)) checkSchema(schema, file, data);
checkSchema("rules", "eye-model/rules/anatomy.rules.json", JSON.parse(readFileSync(join(MODEL, "rules", "anatomy.rules.json"), "utf8")));
if (errors.length) report();   // later checks assume well-formed files

const lib = loadLibrary();
const ids = new Set(lib.components.map(c => c.id));
const facetOf = (c: EyeComponent, f: string) => (c as unknown as Record<string, Record<string, unknown> | undefined>)[f];

// 2. Components: file names, types, required properties, relations, renderer coverage
const unrendered: string[] = [];
for (const { file, data: c } of readJsonDir<EyeComponent>("normal")) {
  if (basename(file) !== `${c.id}.json`) err(`${file}: file name must be ${c.id}.json`);
  const type = lib.types.find(t => t.type === c.type);
  if (!type) { err(`${c.id}: unknown type ${c.type}`); continue; }
  for (const [facet, props] of Object.entries(type.required)) {
    for (const p of props ?? []) if (!(facetOf(c, facet) && p in facetOf(c, facet)!)) err(`${c.id}: type ${c.type} requires ${facet}.${p}`);
  }
  const rel = c.relations;
  for (const r of [rel.parent, ...(rel.attached_to ?? []), ...(rel.borders ?? [])].filter(Boolean) as string[]) {
    const isGroup = r === "eye" || [...ids].some(i => i.startsWith(r + "."));
    if (!ids.has(r) && !isGroup) err(`${c.id}: relation points to unknown component ${r}`);
  }
  const mod = moduleFor(c.type);
  if (!mod) { err(`${c.id}: no render module for type ${c.type} (Developer task)`); continue; }
  for (const f of FACETS) for (const p of Object.keys(facetOf(c, f) ?? {})) {
    if (!mod.consumes.includes(`${f}.${p}`)) unrendered.push(`${c.id}:${f}.${p}`);
  }
}

// 3. Diseases: targets exist, grades monotonic
for (const d of lib.diseases) {
  for (const a of d.affects) if (!ids.has(a)) err(`${d.id}: affects unknown component ${a}`);
  const series = new Map<string, number[]>();
  for (const [grade, patch] of Object.entries(d.grades)) {
    for (const [id, props] of Object.entries(patch)) {
      const c = lib.components.find(x => x.id === id);
      if (!c) { err(`${d.id}@${grade}: unknown component ${id}`); continue; }
      if (!d.affects.includes(id)) warn(`${d.id}@${grade}: patches ${id}, which is not listed in "affects"`);
      for (const [path, v] of Object.entries(props as Record<string, unknown>)) {
        const [f, p, param] = path.split(".");
        const prop = facetOf(c, f)?.[p] as { params?: Record<string, number> } | undefined;
        if (prop === undefined || (param && !(prop.params && param in prop.params))) err(`${d.id}@${grade}: ${id} has no ${path} (capability gap: Anatomist must add it to the schema first)`);
        if (typeof v === "number") series.set(`${id}:${path}`, [...(series.get(`${id}:${path}`) ?? []), v]);
      }
    }
  }
  for (const [key, vals] of series) {
    const up = vals.every((v, i) => i === 0 || v >= vals[i - 1]), down = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
    if (!up && !down) err(`${d.id}: ${key} is not monotonic across grades (${vals.join(", ")})`);
  }
  for (const [name, p] of Object.entries(d.params ?? {})) {
    if (!ids.has(p.target)) err(`${d.id}: param ${name} targets unknown component ${p.target}`);
  }
}

// 4. Resolve eyes and run anatomy rules: normal at three ages, every disease grade alone, every case
const probes: Case[] = [
  ...[20, 50, 80].map(age => ({ id: `normal_age_${age}`, title: "probe", subject: { age, eye: "OD" as const }, diseases: [] })),
  ...lib.diseases.flatMap(d => Object.keys(d.grades).map(g => ({ id: `${d.id}@${g}`, title: "probe", subject: { age: 65, eye: "OD" as const }, diseases: [{ id: d.id, grade: g }] }))),
  ...lib.cases
];
for (const k of probes) {
  const eye = resolveCase(lib, k);
  const issues: Issue[] = [...eye.issues, ...checkRules(eye, lib.rules)];
  for (const i of issues) {
    const line = `${k.id}: ${i.where}: ${i.message}`;
    if (i.level === "error") err(line);
    else if (i.level === "warning") (lib.cases.includes(k) ? notes : warnings).push(line);
  }
}

// 5. Fissure and lid metadata (mm) must match the photo trace in assets/exterior/fissure.json
{
  const TRACE_TOL_MM = 0.05;
  const normal = resolveCase(lib, probes[0]);
  for (const [key, mm] of Object.entries(traceMm(readTrace()))) {
    const [id, path] = key.split(":");
    try {
      const v = normal.num(id, path);
      if (Math.abs(v - mm) > TRACE_TOL_MM) err(`${key} = ${v} mm but the fissure.json trace gives ${mm.toFixed(2)} mm (tolerance ${TRACE_TOL_MM})`);
    } catch (e) { err(`${key}: ${(e as Error).message} (needed for the fissure.json trace check)`); }
  }
}

// 6. Shader compile cost: on Windows (D3D) every unrolled loop and every extra call site of a big function is inlined
// again, and the slit-lamp program once took minutes to compile and crashed the GPU process. Loops keep uZero in
// their bound (it stays rolled) and the big functions keep one call site each.
{
  const file = "src/render/shaders/eye.frag.glsl";
  const src = readFileSync(join(MODEL, "..", file), "utf8").replace(/\/\/.*$/gm, "");
  src.split("\n").forEach((line, i) => {
    for (const loop of line.match(/for\s*\(int[^;]*;[^;]*;/g) ?? []) if (!loop.includes("uZero")) err(`${file}:${i + 1}: loop bound without "+ uZero" (the D3D compiler unrolls it): ${loop.trim()}`);
  });
  for (const fn of ["shade", "cornealPath", "sclera", "irisShade"]) {
    const calls = (src.match(new RegExp(`\\b${fn}\\(`, "g")) ?? []).length - (src.match(new RegExp(`\\bvec3 ${fn}\\(`, "g")) ?? []).length;
    if (calls > 1) err(`${file}: ${fn}() has ${calls} call sites; keep one (each call inlines the whole function into the program)`);
  }
}

notes.push(`${unrendered.length} metadata properties are not consumed by the renderer: ${summarise(unrendered)}`);
report();

function summarise(keys: string[]) {
  return keys.length ? keys.map(k => k.replace(/^eye\./, "")).join(", ") : "none";
}

function report(): never {
  const block = (title: string, lines: string[]) => lines.length && console.log(`\n${title} (${lines.length})\n` + lines.map(l => `  - ${l}`).join("\n"));
  block("ERRORS", errors);
  block("WARNINGS", warnings);
  block("NOTES", notes);
  console.log(`\nvalidate: ${errors.length ? "FAILED" : "passed"} - ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
