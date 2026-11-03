// The case sheet, shown after End Examination: the trainee writes the history, what they saw in each structure, the
// diagnosis and the plan. Submitting sends it to the Examiner (server/examiner.ts) and resolves with the report.
import "./caseSheet.css";
import { createLogo } from "./logo.ts";
import type { CaseSheet, Report } from "../../server/examiner.ts";

type Field = { id: keyof CaseSheet; label: string; hint: string; rows: number };

const HISTORY: Field[] = [
  { id: "history", label: "History and presenting complaint", hint: "What brought the patient in, onset, symptoms, relevant history…", rows: 4 },
];
// Written once per eye: `lids` is sent as lidsRight and lidsLeft
const FINDINGS: { id: string; label: string; hint: string }[] = [
  { id: "lids", label: "Lids and adnexa", hint: "Position, swelling, lashes, margins…" },
  { id: "conjunctiva", label: "Conjunctiva and sclera", hint: "Redness and its pattern, vessels, discharge…" },
  { id: "cornea", label: "Cornea", hint: "Clarity, epithelium, infiltrates, deposits…" },
  { id: "chamber", label: "Anterior chamber", hint: "Depth, cells, flare…" },
  { id: "iris", label: "Iris and pupil", hint: "Colour, pupil size, shape, reaction…" },
  { id: "lens", label: "Lens", hint: "Clarity, where any opacity sits, red reflex…" },
];
const ASSESSMENT: Field[] = [
  { id: "diagnosis", label: "Diagnosis", hint: "Your main diagnosis", rows: 2 },
  { id: "differentials", label: "Differential diagnoses", hint: "What else could this be?", rows: 2 },
  { id: "plan", label: "Management plan", hint: "Investigations, treatment, urgency, follow-up", rows: 3 },
];
const EYES = [{ key: "Right", name: "Right Eye", code: "OD" }, { key: "Left", name: "Left Eye", code: "OS" }];
const MAX = 2000;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const area = (name: string, hint: string, rows: number, label = "") =>
  `<textarea name="${name}" rows="${rows}" maxlength="${MAX}" placeholder="${esc(hint)}"${label ? ` aria-label="${esc(label)}"` : ""}></textarea>`;
const fields = (title: string, list: Field[]) =>
  `<fieldset><legend>${title}</legend>${list.map(f => `<label><span>${f.label}</span>${area(f.id, f.hint, f.rows)}</label>`).join("")}</fieldset>`;
const findings = () => `<fieldset class="both"><legend>Slit-lamp findings</legend>
  <div class="eyes" aria-hidden="true">${EYES.map(e => `<b>${e.name} (${e.code})</b>`).join("")}</div>
  ${FINDINGS.map(f => `<div class="finding" role="group" aria-label="${esc(f.label)}"><span>${f.label}</span>${EYES.map(e =>
    `<label><small>${e.name} (${e.code})</small>${area(f.id + e.key, f.hint, 2, `${f.label}, ${e.name}`)}</label>`).join("")}</div>`).join("")}
</fieldset>`;

/** Shows the sheet. `submit` scores it; a failure is shown on the sheet and the trainee can send it again. */
export function runCaseSheet(submit: (sheet: CaseSheet) => Promise<Report>): Promise<Report> {
  const root = document.createElement("div");
  root.id = "casesheet";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Case sheet");
  const sections = fields("History", HISTORY) + findings() + fields("Assessment", ASSESSMENT);
  root.innerHTML = `<form class="sheet" novalidate>
  <header><div class="brand"></div><h1>Case Sheet</h1><p>Write what you found. Your sheet, the questions you asked and how you used the slit lamp are scored against the hidden answer key.</p></header>
  <div class="fields">${sections}</div>
  <footer><p class="err" role="alert" hidden></p><button type="submit" class="go">Submit for Evaluation</button></footer>
  <div class="busy" hidden><div class="spin" aria-hidden="true"></div><h2>Evaluating your examination…</h2><p>This takes up to a minute.</p></div>
</form>`;
  root.querySelector(".brand")!.append(createLogo({ height: 24, alt: "VibeDoc" }));
  document.body.appendChild(root);

  const form = root.querySelector("form")!, err = root.querySelector<HTMLElement>(".err")!, busy = root.querySelector<HTMLElement>(".busy")!;
  return new Promise(resolve => {
    form.onsubmit = async e => {
      e.preventDefault();
      const sheet = Object.fromEntries([...form.querySelectorAll("textarea")].map(t => [t.name, t.value.trim()])) as CaseSheet;
      err.hidden = true; busy.hidden = false;
      try {
        const report = await submit(sheet);
        root.remove();
        resolve(report);
      } catch (x) {
        busy.hidden = true;
        err.textContent = `The evaluation could not be completed (${(x as Error).message}). Your sheet is kept: try again.`;
        err.hidden = false;
      }
    };
  });
}
