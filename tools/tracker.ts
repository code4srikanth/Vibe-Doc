// Keeps docs/realism/TRACKER.md alive every day.
//   npx tsx tools/tracker.ts --check      for the SessionStart hook: adds today's objective snapshot row if it
//                                         is missing, and reminds the model when the scored Day log row is missing
//   npx tsx tools/tracker.ts --snapshot   same snapshot, printed (and added if missing), no reminder
// The snapshot is measured (counts from the repo), never judged. The scores and the Day log row stay a judgement
// that is written from evidence (see "How to update" in TRACKER.md).
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./lib/library.ts";

const file = join(ROOT, "docs", "realism", "TRACKER.md");
const today = process.env.TRACKER_DATE ?? new Date().toLocaleDateString("en-CA");   // YYYY-MM-DD in local time (TRACKER_DATE is for tests)
const count = (dir: string, suffix = ".json") => readdirSync(join(ROOT, "eye-model", dir)).filter(f => f.endsWith(suffix)).length;
const git = (cmd: string) => { try { return execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };

const row = `| ${today} | ${count("normal")} | ${count("diseases")} | ${count("cases")} | ${count("variants")} | ${git("rev-list --count HEAD") || "?"} | ${git("status --porcelain").split("\n").filter(Boolean).length} |`;
const header = "## Daily snapshot (automatic, measured)\n| Date | Components | Diseases | Cases | Variants | Commits | Uncommitted files |\n|---|---|---|---|---|---|---|";

if (!existsSync(file)) { console.error(`tracker: ${file} not found`); process.exit(0); }
let text = readFileSync(file, "utf8");
let added = false;
if (!text.includes("## Daily snapshot")) text = text.trimEnd() + `\n\n${header}\n`;
const lines = text.split("\n");
const start = lines.findIndex(l => l.startsWith("## Daily snapshot"));
let end = start + 1;
while (end < lines.length && (lines[end].startsWith("|") || lines[end].startsWith("## Daily") || lines[end].trim() === "")) end++;
const section = lines.slice(start, end).filter(l => l.startsWith("|"));
if (!section.some(l => l.startsWith(`| ${today} |`))) {
  const lastRow = lines.slice(start, end).reduce((n, l, i) => l.startsWith("|") ? start + i : n, start);
  lines.splice(lastRow + 1, 0, row);
  added = true;
}
if (added) writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"));

const dayLog = text.slice(text.indexOf("## Day log"), text.indexOf("## Next") > 0 ? text.indexOf("## Next") : undefined);
const scored = dayLog.includes(today);

if (process.argv.includes("--snapshot")) { console.log(row); process.exit(0); }
if (!scored) {
  const msg = `The progress tracker has no scored row for ${today} yet. Before ending today's work, add a Day log row and a score column to docs/realism/TRACKER.md, changing a score only on evidence. The measured snapshot row for today ${added ? "was just added" : "is already in the file"}.`;
  console.log(JSON.stringify({
    systemMessage: `Tracker: no scored row for ${today} yet.`,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: msg }
  }));
}
