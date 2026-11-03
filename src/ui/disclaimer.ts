// The copyright and training disclaimer: a small link on every screen (mountFooter) and the page it opens at /disclaimer.
// The wording lives here once; both read it.
import "./disclaimer.css";
import { createLogo } from "./logo.ts";
import type { CaseOrigin } from "../../server/session.ts";

export const DISCLAIMER_PATH = "/disclaimer";

/** Where the eye on screen came from, for a case typed by the trainee. Nothing here has had a clinician's review yet. */
export const CASE_LABELS: Partial<Record<CaseOrigin, string>> = {
  matched: "Closest case in the EyeSim library to your description. Not clinically reviewed.",
  generated: "AI-generated from your description. Not clinically reviewed, and it may contain errors.",
  fallback: "We couldn't build your case reliably, so this is a stored case instead. It may not match your description, or its diagnosis. Not clinically reviewed."
};

/** A note on the eye view saying where this case came from, so it stays in sight in fullscreen. A stored case the app chose has none. */
export function showCaseLabel(origin: CaseOrigin | undefined): void {
  const text = origin && CASE_LABELS[origin];
  if (!text) return;
  const label = document.createElement("div");
  label.id = "case-label";
  label.setAttribute("role", "note");
  label.textContent = text;
  (document.getElementById("view") ?? document.body).appendChild(label);
}

/** What the trainee accepts before the exam (src/ui/preparing.ts). */
export const PROTOTYPE_TERMS = [
  "EyeSim is a prototype built in 8 days for a hackathon. It covers a limited set of scenarios, including cataract and conjunctivitis, and more diseases will be added soon.",
  "The simulated images are AI-rendered and for training use only. AI can make mistakes, so do not rely on them for real patient care.",
  "These scenarios have not yet been clinically validated."
];

export const DISCLAIMER = [
  "EyeSim is an educational tool for training purposes only. It is not a medical device and must not be used to diagnose, treat or make decisions about real patients.",
  "All images and animations are AI-generated, mostly with Meta's AI tools. They are original synthetic works, not copied from any existing copyrighted material, and they do not depict real people. Any resemblance to a real person is coincidental. The eye findings are simulated from the project's own data and are not clinical photographs or real patient records."
];

export const isDisclaimerPage = () => location.pathname.replace(/\/+$/, "") === DISCLAIMER_PATH;

/** A fixed line at the foot of every screen. It opens the disclaimer in a new tab so an exam in progress is not lost. */
export function mountFooter(): void {
  if (new URLSearchParams(location.search).has("bare")) return;   // renders and visual tests carry no page furniture
  const foot = document.createElement("div");
  foot.id = "legal-foot";
  foot.innerHTML = `<span>Training use only · AI-generated content</span> <a href="${DISCLAIMER_PATH}" target="_blank" rel="noopener">Copyright disclaimer</a>`;
  document.body.appendChild(foot);
}

/** The disclaimer page: the text first, then a way back to the app. */
export function showDisclaimerPage(): void {
  document.title = "Disclaimer · VibeDoc";
  const page = document.createElement("main");
  page.id = "legal-page";
  const text = [...PROTOTYPE_TERMS, ...DISCLAIMER];
  page.innerHTML = `<div class="brand"></div><h1>Disclaimer</h1>${text.map(() => "<p></p>").join("")}<a class="back" href="/">Back to the simulator</a>`;
  page.querySelector(".brand")!.append(createLogo({ height: 26, alt: "VibeDoc" }));
  page.querySelectorAll("p").forEach((p, i) => { p.textContent = text[i]; });
  document.body.appendChild(page);
}
