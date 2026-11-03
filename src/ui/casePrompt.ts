// Screen 3, the case prompt: the nurse-writing clip plays full-bleed while a glass card captures the scenario,
// the vision in each eye (free text, which the server's agents read for severity), the patient's age band and sex. "Back to Hospital" returns to the lobby.
import "./casePrompt.css";
import nurseUrl from "../../assets/prompt/nurse.mp4?url";
import { createLogo } from "./logo.ts";

export interface CaseRequest { prompt: string; vision: { right: string; left: string }; ageBand: string; sex: "male" | "female"; age: number }

const MAX = 300;
const MAX_VISION = 40;
const ICON = {
  eye: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
  person: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
  people: `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>`,
  chevron: `<path d="M6 9l6 6 6-6"/>`,
};
const svg = (paths: string, cls = "") => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ""}>${paths}</svg>`;

// representative age per band, used to pick the walk-in clip
const AGES: { label: string; age: number }[] = [
  { label: "Under 20", age: 15 }, { label: "20-40", age: 30 }, { label: "40-60", age: 50 }, { label: "60 and over", age: 70 },
];

const visionField = (name: string, label: string) =>
  `<label><span>${label} <b>*</b></span><span class="field">${svg(ICON.eye)}<input name="${name}" type="text" required maxlength="${MAX_VISION}" autocomplete="off" placeholder="E.g. 6/18 or counting fingers"></span></label>`;

/** Shows the prompt screen; resolves with the request, or null when the user goes back to the lobby. */
export function playCasePrompt(): Promise<CaseRequest | null> {
  const root = document.createElement("div");
  root.id = "caseprompt";
  root.className = "wait";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Create a patient case");
  root.innerHTML = `<video muted loop playsinline autoplay preload="auto" aria-hidden="true" tabindex="-1"></video>
<form class="card" novalidate>
  <div class="top">
    <button type="button" class="back">${svg(`<path d="M19 12H5M11 6l-6 6 6 6"/>`)}Back to Hospital</button>
    <div class="brand"></div>
  </div>
  <div class="body">
    <div class="head">
      <span class="icon">${svg(`<path d="M12.5 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v4"/><path d="M14 3v5h5M9 12h5M9 16h2.5"/><circle cx="17.5" cy="17.5" r="4.5" fill="currentColor" stroke="none"/><path d="M17.5 15.5v4M15.5 17.5h4" stroke="#fff"/>`)}</span>
      <div><h1>Create a Patient Case</h1><p>Describe the patient or clinical scenario you want to practice.</p></div>
    </div>
    <div class="box">
      <textarea name="prompt" maxlength="${MAX}" rows="3" aria-label="Clinical scenario" placeholder="E.g. A 45-year-old patient presents with redness, pain, photophobia and blurred vision in the right eye for three days."></textarea>
      <span class="count">0/${MAX}</span>
    </div>
    <div class="label">${svg(ICON.eye)}Vision</div>
    <div class="row vision">${visionField("visionRight", "Right Eye")}${visionField("visionLeft", "Left Eye")}</div>
    <div class="row">
      <label><span>Patient Age <b>*</b></span><span class="field">${svg(ICON.person)}<select name="age" required><option value="">Select age range</option>${AGES.map((a, i) => `<option value="${i}">${a.label}</option>`).join("")}</select>${svg(ICON.chevron, "chev")}</span></label>
      <label><span>Gender <b>*</b></span><span class="field">${svg(ICON.people)}<select name="sex" required><option value="">Select gender</option><option value="female">Female</option><option value="male">Male</option></select>${svg(ICON.chevron, "chev")}</span></label>
    </div>
    <p class="err" role="alert" hidden></p>
    <button type="submit" class="go">Prepare Patient ${svg(`<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12.5 8.5 16 12l-3.5 3.5"/>`)}</button>
  </div>
</form>`;
  const brand = root.querySelector(".brand")!;
  const dept = document.createElement("div");
  dept.className = "dept"; dept.textContent = "OPHTHALMOLOGY DEPARTMENT";
  brand.append(createLogo({ height: 22, alt: "VibeDoc" }), dept);

  const video = root.querySelector("video")!;
  video.muted = true; video.src = nurseUrl;
  document.body.appendChild(root);
  video.play().catch(() => { /* autoplay refused: the first frame stays up as a still */ });

  // The card is shown together with the clip, not before it; a slow or failed load must not trap the trainee.
  const reveal = () => root.classList.remove("wait");
  if (video.readyState >= 3) reveal();
  else {
    video.addEventListener("canplay", reveal, { once: true });
    video.addEventListener("error", reveal, { once: true });
    setTimeout(reveal, 8000);
  }

  const form = root.querySelector("form")!;
  const text = form.querySelector("textarea")!;
  const count = form.querySelector(".count")!;
  const err = form.querySelector<HTMLElement>(".err")!;
  text.addEventListener("input", () => { count.textContent = `${text.value.length}/${MAX}`; });

  return new Promise(resolve => {
    const leave = (value: CaseRequest | null) => {
      root.classList.add("out");
      setTimeout(() => { video.pause(); root.remove(); resolve(value); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 450);
    };
    form.querySelector(".back")!.addEventListener("click", () => leave(null));
    form.addEventListener("submit", e => {
      e.preventDefault();
      const age = form.elements.namedItem("age") as HTMLSelectElement, sex = form.elements.namedItem("sex") as HTMLSelectElement;
      const right = (form.elements.namedItem("visionRight") as HTMLInputElement).value.trim(), left = (form.elements.namedItem("visionLeft") as HTMLInputElement).value.trim();
      const missing = !text.value.trim() ? "Please describe the patient or scenario." : !right || !left ? "Please enter the vision in both eyes." : !age.value || !sex.value ? "Please choose the patient's age range and gender." : "";
      if (missing) { err.textContent = missing; err.hidden = false; return; }
      const band = AGES[+age.value];
      leave({ prompt: text.value.trim(), vision: { right, left }, ageBand: band.label, age: band.age, sex: sex.value as "male" | "female" });
    });
  });
}
