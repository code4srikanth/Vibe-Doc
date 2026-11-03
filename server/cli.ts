// Run the Case agent once from the terminal and save the full run for inspection.
// npm run agent -- "62-year-old man, gradual blurred vision for two years"
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadLibrary } from "../tools/lib/library.ts";
import { meta } from "./gateway.ts";
import { runCaseAgent } from "./case-agent.ts";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) { console.error('Usage: npm run agent -- "<patient description>"'); process.exit(1); }

const result = await runCaseAgent(loadLibrary(), prompt, { model: meta, onStep: s => console.log(`... ${s}`) });
console.log("\nIntent:", result.intent);
console.log(`\nEdits (${result.edits.length}):`);
for (const e of result.edits) console.log(`  ${e.component}:${e.property} = ${JSON.stringify(e.value)}  (${e.reason})`);
console.log(`\nDiagnosis: ${result.diagnosis}\nSigns:\n${result.signs.map(s => `  - ${s}`).join("\n")}`);
console.log(`\n${result.valid ? "Valid" : "NOT valid"} after ${result.steps} steps.`);

const dir = join(ROOT, ".tmp", "agent");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ prompt, ...result }, null, 2));
console.log(`Saved ${file}`);
