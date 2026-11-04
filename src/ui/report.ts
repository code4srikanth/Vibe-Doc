// The evaluation report (docs/architecture/parts/08-examiner.md task 6): the score, each dimension with its evidence,
// what was found and missed, and where to improve. It says plainly that this is AI feedback, not a clinical assessment.
import "./report.css";
import { createLogo } from "./logo.ts";
import { VIEWS } from "../exam/views.ts";
import type { Comparison, FurtherReading, Report } from "../../server/examiner.ts";

/** Draws one eye in one view and resolves with its image: healthy, or this patient's. */
export type DrawEye = (view: Comparison["view"], healthy: boolean) => Promise<string>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const list = (items: string[], cls = "") => items.length ? `<ul class="${cls}">${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : "";
const NAMES: Record<keyof Report["dimensions"], string> = {
  diagnosis: "Diagnosis", observations: "Slit-lamp observations", history: "History taking", technique: "Slit-lamp technique", safety: "Safety"
};
const tone = (n: number) => n >= 75 ? "good" : n >= 50 ? "fair" : "low";

/** The external pages for one section of the report, or nothing. */
const reading = (r: Report, section: FurtherReading["sections"][number]) => {
  const links = r.furtherReading.filter(l => l.sections.includes(section));
  return links.length ? `<p class="reading">Read more: ${links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.source)}: ${esc(l.title)}</a>`).join(" · ")}</p>` : "";
};

const shot = (c: Comparison, healthy: boolean) => {
  const who = healthy ? "Healthy eye, same age" : "This patient";
  return `<figure><div class="shot" data-view="${c.view}" data-healthy="${healthy}" data-alt="${esc(`${VIEWS[c.view].label}: ${who.toLowerCase()}`)}"><span>Drawing…</span></div><figcaption>${who}</figcaption></figure>`;
};
const comparison = (c: Comparison) => `<div class="compare">
  <h4>${esc(VIEWS[c.view].label)}</h4>
  ${c.signs.length ? `<p class="you-missed">You missed this here:</p>${list(c.signs, "crosses")}` : ""}
  ${c.caption ? `<p class="reveal">${esc(c.caption)}</p>` : ""}
  <div class="pair">${shot(c, true)}${shot(c, false)}</div>
</div>`;

/** A cataract's views, each drawn in this eye beside a healthy one, whether or not any sign was missed. */
const compareSection = (r: Report) => r.comparisons.length ? `<section class="block missed"><h3>Normal vs this eye</h3>
    <p class="sim">Both pictures are simulated in the same view.</p>
    ${r.comparisons.map(comparison).join("")}
    ${reading(r, "signs")}
  </section>` : "";

/** Missed signs no picture above shows, as a plain list. */
function missedSigns(r: Report): string {
  const shown = new Set(r.comparisons.flatMap(c => c.signs));
  const rest = r.signsMissed.filter(s => !shown.has(s));
  if (!rest.length) return "";
  return `<section class="block missed"><h3>${shown.size ? "Other signs you missed" : "Signs you missed"}</h3>
    ${list(rest, "crosses")}
    ${r.comparisons.length ? "" : reading(r, "signs")}
  </section>`;
}

/** Draws the pictures one at a time, since they share one renderer. A view that can't be drawn says so and leaves its text. */
async function drawShots(root: HTMLElement, draw: DrawEye) {
  for (const box of root.querySelectorAll<HTMLElement>(".shot")) {
    try {
      const img = new Image();
      img.alt = box.dataset.alt!;
      img.src = await draw(box.dataset.view as Comparison["view"], box.dataset.healthy === "true");
      box.replaceChildren(img);
    } catch (e) {
      console.warn("Report picture:", e);
      box.closest(".pair")?.replaceWith(Object.assign(document.createElement("p"), { className: "sim", textContent: "This view could not be drawn." }));
    }
  }
}

export function showReport(r: Report, onAgain: () => void, draw?: DrawEye) {
  const root = document.createElement("div");
  root.id = "report";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Examination report");
  const dims = (Object.keys(NAMES) as (keyof typeof NAMES)[]).map(k => {
    const d = r.dimensions[k];
    return `<section class="dim ${tone(d.score)}">
      <header><h3>${NAMES[k]}</h3><b>${d.score}<small>/100</small></b></header>
      <div class="bar" role="img" aria-label="${d.score} out of 100"><i style="width:${d.score}%"></i></div>
      <p class="weight">Counts for ${d.weight}% of the total</p>
      <p>${esc(d.comment)}</p>
      ${d.evidence.length ? `<blockquote>${d.evidence.map(e => `<q>${esc(e)}</q>`).join("")}</blockquote>` : ""}
      ${k === "diagnosis" || k === "technique" ? reading(r, k) : ""}
    </section>`;
  }).join("");
  const block = (title: string, body: string) => body ? `<section class="block"><h3>${title}</h3>${body}</section>` : "";
  root.innerHTML = `<div class="page">
  <header class="top"><div class="brand"></div><button type="button" class="again">Start Another Case</button></header>
  <div class="hero">
    <div class="ring ${tone(r.total)}" style="--p:${r.total}"><span><b>${r.total}</b><small>out of 100</small></span></div>
    <div><h1>Examination report</h1>
      <p class="key"><b>Your diagnosis:</b> ${r.yourDiagnosis ? esc(r.yourDiagnosis) : "Not written"}</p>
      <p class="key"><b>Answer key:</b> ${esc(r.key.diagnosis)}</p>
      ${r.safetyFlags.length ? `<div class="flag" role="alert"><b>Safety:</b> ${r.safetyFlags.map(esc).join(" ")}</div>` : ""}
    </div>
  </div>
  ${block("Where to improve", list(r.improvements, "steps"))}
  ${compareSection(r)}
  ${missedSigns(r)}
  ${block("What went well", list(r.strengths, "ticks"))}
  <div class="dims">${dims}</div>
  <div class="cols">
    ${block("Signs you found", list(r.signsFound, "ticks"))}
    ${block("Findings that are not in this eye", list(r.incorrectClaims, "crosses"))}
    ${block("History you took", list(r.historyAsked, "ticks"))}
    ${block("History you did not take", list(r.historyMissed, "crosses"))}
  </div>
  <p class="note">This is AI feedback from rubric version ${esc(r.rubricVersion)}, not a clinical assessment. The rubric has not yet been reviewed by a clinician.${r.furtherReading.length ? " The links lead to external resources that are not affiliated with VibeDoc." : ""}</p>
</div>`;
  root.querySelector(".brand")!.append(createLogo({ height: 24, alt: "VibeDoc" }));
  root.querySelector<HTMLButtonElement>(".again")!.onclick = onAgain;
  document.body.appendChild(root);
  root.scrollTop = 0;
  if (draw) void drawShots(root, draw);
  else root.querySelectorAll(".pair").forEach(p => p.remove());
}
