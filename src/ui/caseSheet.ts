// The case sheet, shown after End Examination: the trainee writes the history, what they saw in each structure, the
// diagnosis and the plan. Submitting sends it to the Examiner (server/examiner.ts) and resolves with the report.
import "./caseSheet.css";
import { createLogo } from "./logo.ts";
import type { CaseSheet, Report } from "../../server/examiner.ts";

const FIELDS: { id: keyof CaseSheet; label: string; hint: string; group: "history" | "exam" | "decision"; rows: number }[] = [
  { id: "history", label: "History and presenting complaint", hint: "What brought the patient in, onset, symptoms, relevant history…", group: "history", rows: 4 },
  { id: "lids", label: "Lids and adnexa", hint: "Position, swelling, lashes, margins…", group: "exam", rows: 2 },
  { id: "conjunctiva", label: "Conjunctiva and sclera", hint: "Redness and its pattern, vessels, discharge…", group: "exam", rows: 2 },
  { id: "cornea", label: "Cornea", hint: "Clarity, epithelium, infiltrates, deposits…", group: "exam", rows: 2 },
  { id: "chamber", label: "Anterior chamber", hint: "Depth, cells, flare…", group: "exam", rows: 2 },
  { id: "iris", label: "Iris and pupil", hint: "Colour, pupil size, shape, reaction…", group: "exam", rows: 2 },
  { id: "lens", label: "Lens", hint: "Clarity, where any opacity sits, red reflex…", group: "exam", rows: 2 },
  { id: "diagnosis", label: "Diagnosis", hint: "Your main diagnosis", group: "decision", rows: 2 },
  { id: "differentials", label: "Differential diagnoses", hint: "What else could this be?", group: "decision", rows: 2 },
  { id: "plan", label: "Management plan", hint: "Investigations, treatment, urgency, follow-up", group: "decision", rows: 3 },
];
const GROUPS = { history: "History", exam: "Slit-lamp findings", decision: "Assessment" };
const MAX = 2000;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Shows the sheet. `submit` scores it; a failure is shown on the sheet and the trainee can send it again. */
export function runCaseSheet(submit: (sheet: CaseSheet) => Promise<Report>): Promise<Report> {
  const root = document.createElement("div");
  root.id = "casesheet";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Case sheet");
  const sections = (Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map(g => `<fieldset><legend>${GROUPS[g]}</legend>${FIELDS.filter(f => f.group === g).map(f =>
    `<label><span>${f.label}</span><textarea name="${f.id}" rows="${f.rows}" maxlength="${MAX}" placeholder="${esc(f.hint)}"></textarea></label>`).join("")}</fieldset>`).join("");
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
      const sheet = Object.fromEntries(FIELDS.map(f => [f.id, form.querySelector<HTMLTextAreaElement>(`[name=${f.id}]`)!.value.trim()])) as unknown as CaseSheet;
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
