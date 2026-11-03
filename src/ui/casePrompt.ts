// Screen 3, the case prompt: the nurse-writing clip plays full-bleed while a glass card captures the scenario
// (free text or an example chip), the patient's age band and sex. "Back to Hospital" returns to the lobby.
import "./casePrompt.css";
import nurseUrl from "../../assets/prompt/nurse.mp4?url";
import { createLogo } from "./logo.ts";

export interface CaseRequest { prompt: string; ageBand: string; sex: "male" | "female"; age: number }

const MAX = 300;
const ICON = {
  eye: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
  glasses: `<circle cx="6" cy="15" r="3.5"/><circle cx="18" cy="15" r="3.5"/><path d="M9.5 15h5M2.5 15 4 8h2M21.5 15 20 8h-2"/>`,
  target: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor"/>`,
  pen: `<path d="M4 20l4-1L19 8l-3-3L5 16l-1 4zM14 7l3 3"/>`,
  clipboard: `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 15h4"/>`,
  person: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
  people: `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>`,
  chevron: `<path d="M6 9l6 6 6-6"/>`,
};
const svg = (paths: string, cls = "") => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ""}>${paths}</svg>`;

const EXAMPLES: { label: string; icon: keyof typeof ICON; text: string }[] = [
  { label: "Red, painful eye", icon: "eye", text: "A 45-year-old patient presents with redness, pain, photophobia and blurred vision in the right eye for three days." },
  { label: "Blurred vision", icon: "eye", text: "A patient reports gradually blurred vision in both eyes over several months, worse in bright light and when driving at night." },
  { label: "Dry eye symptoms", icon: "glasses", text: "A patient complains of burning, grittiness and watering in both eyes, worse in the evening and when using screens." },
  { label: "Corneal injury", icon: "target", text: "A patient presents after a scratch to the eye while gardening, with pain, tearing and light sensitivity since this morning." },
  { label: "Postoperative follow-up", icon: "pen", text: "A patient returns one week after cataract surgery for a routine review, with mild irritation and no pain." },
  { label: "Diabetic eye exam", icon: "clipboard", text: "A patient with long-standing type 2 diabetes attends for an annual eye exam, with no new visual symptoms." },
];
// representative age per band, used to pick the walk-in clip
const AGES: { label: string; age: number }[] = [
  { label: "Under 20", age: 15 }, { label: "20-40", age: 30 }, { label: "40-60", age: 50 }, { label: "60 and over", age: 70 },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

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
      <textarea name="prompt" maxlength="${MAX}" rows="3" aria-label="Clinical scenario" placeholder="E.g. ${esc(EXAMPLES[0].text)}"></textarea>
      <span class="count">0/${MAX}</span>
    </div>
    <div class="label">${svg(`<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>`)}Or try an example scenario</div>
    <div class="chips">${EXAMPLES.map((e, i) => `<button type="button" class="chip" data-i="${i}">${svg(ICON[e.icon])}${e.label}</button>`).join("")}</div>
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
  const chips = [...form.querySelectorAll<HTMLElement>(".chip")];
  const sync = () => {
    count.textContent = `${text.value.length}/${MAX}`;
    chips.forEach((c, i) => c.classList.toggle("on", text.value === EXAMPLES[i].text));
  };
  text.addEventListener("input", sync);
  chips.forEach(c => c.addEventListener("click", () => { text.value = EXAMPLES[+c.dataset.i!].text; sync(); text.focus(); }));

  return new Promise(resolve => {
    const leave = (value: CaseRequest | null) => {
      root.classList.add("out");
      setTimeout(() => { video.pause(); root.remove(); resolve(value); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 450);
    };
    form.querySelector(".back")!.addEventListener("click", () => leave(null));
    form.addEventListener("submit", e => {
      e.preventDefault();
      const age = form.elements.namedItem("age") as HTMLSelectElement, sex = form.elements.namedItem("sex") as HTMLSelectElement;
      if (!age.value || !sex.value) { err.textContent = "Please choose the patient's age range and gender."; err.hidden = false; return; }
      const band = AGES[+age.value];
      leave({ prompt: text.value.trim(), ageBand: band.label, age: band.age, sex: sex.value as "male" | "female" });
    });
  });
}
