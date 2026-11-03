// A full-screen loading screen between the choice screens and the walk-in video. It stays up until everything the exam
// needs has loaded: the patient (the Case agent can take about 40 s for a typed prompt), the textures and the eye shader
// (its first compile can take a minute or more on Windows laptops). Each step ticks off as it finishes.
import "./preparing.css";
import { createLogo } from "./logo.ts";
import { startGrid } from "./grid.ts";

/** A step and the work it waits for; false (or a rejection) marks it unavailable, and the exam goes on without it. */
export type PreparingStep = [label: string, work: Promise<unknown>];

/** Turns the loading screen into the terms, and resolves when the trainee accepts them. */
function accepted(root: HTMLElement, terms: string[]): Promise<void> {
  root.querySelector(".spin")!.remove();
  root.querySelector(".steps")!.remove();
  root.querySelector("h1")!.textContent = "Before you begin";
  const detail = root.querySelector("p")!;
  const text = terms.map(t => { const p = document.createElement("p"); p.className = "term"; p.textContent = t; return p; });
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "accept";
  accept.textContent = "I understand and accept";
  detail.replaceWith(...text, accept);
  accept.focus();
  return new Promise(resolve => accept.addEventListener("click", () => resolve(), { once: true }));
}

/** Shows the loading screen until every step has settled, then, if there are terms, until the trainee accepts them, and removes it. */
export async function showPreparing(message: string, detail: string, steps: PreparingStep[], terms?: string[]): Promise<void> {
  const root = document.createElement("div");
  root.id = "preparing";
  root.setAttribute("role", "status");
  root.innerHTML = `<canvas aria-hidden="true"></canvas><div class="box"><div class="brand"></div><div class="spin" aria-hidden="true"></div><h1></h1><p></p><ul class="steps"></ul></div>`;
  root.querySelector("h1")!.textContent = message;
  root.querySelector("p")!.textContent = detail;
  root.querySelector(".brand")!.append(createLogo({ height: 26, alt: "VibeDoc" }));
  const list = root.querySelector("ul")!;
  document.body.appendChild(root);
  const stopGrid = startGrid(root, root.querySelector("canvas")!);
  await Promise.all(steps.map(async ([label, work]) => {
    const li = document.createElement("li");
    li.textContent = label;
    list.append(li);
    const ok = await work.then(v => v !== false, e => { console.warn(`${label}:`, e); return false; });
    li.className = ok ? "done" : "failed";
    if (!ok) li.textContent = `${label} (unavailable)`;
  }));
  if (terms) await accepted(root, terms);
  stopGrid();
  root.remove();
}
