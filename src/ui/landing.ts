// Screen 1, the landing: a faint blue grid (grid.ts) draws in outward from the centre while the VibeDoc wordmark
// slides in (DOM/CSS, src/ui/landing.css), then waits for a click or key, or continues on its own.
// index.html hides the app under html.landing until this screen is gone, so nothing flashes on load.
import "./landing.css";
import { LOGO, logo2xUrl } from "./logo.ts";
import { startGrid } from "./grid.ts";

const AUTO_MS = 4500;     // continues on its own this long after it appears
const OUT_MS = 550;       // fade-out, matches #landing transition
export interface LandingOptions { onDone?: () => void }

/** Shows the landing over the page; resolves (and calls onDone) once it has faded out. */
export function playLanding({ onDone }: LandingOptions = {}): Promise<void> {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.createElement("div");
  root.id = "landing";
  root.setAttribute("role", "button");
  root.setAttribute("aria-label", "VibeDoc. Click or press any key to continue");
  root.style.setProperty("--logo", `url("${logo2xUrl}")`);
  root.style.setProperty("--logo-ratio", `${LOGO.width} / ${LOGO.height}`);
  root.style.setProperty("--split", `${(LOGO.split * 100).toFixed(2)}%`);
  root.innerHTML = `<canvas aria-hidden="true"></canvas>
<div class="lockup"><div class="move">
  <div class="half vibe"><img alt="VibeDoc" decoding="async" draggable="false"></div>
  <div class="half doc" aria-hidden="true"><img alt="" decoding="async" draggable="false"></div>
  <div class="sweep" aria-hidden="true"></div>
</div></div>
<p class="hint">Click or press any key to continue</p>`;
  for (const img of root.querySelectorAll("img")) { img.width = LOGO.width; img.height = LOGO.height; img.src = logo2xUrl; }
  document.body.appendChild(root);

  const stopGrid = startGrid(root, root.querySelector("canvas")!);

  return new Promise(resolve => {
    let leaving = false;
    const leave = () => {
      if (leaving) return;
      leaving = true;
      clearTimeout(auto);
      removeEventListener("keydown", onKey);
      root.classList.add("out");
      setTimeout(() => {
        stopGrid();
        root.remove();
        document.documentElement.classList.remove("landing");
        onDone?.();
        resolve();
      }, still ? 200 : OUT_MS);
    };
    const onKey = (e: KeyboardEvent) => { if (!e.repeat) leave(); };
    const auto = setTimeout(leave, AUTO_MS);
    root.addEventListener("pointerdown", leave, { once: true });
    addEventListener("keydown", onKey);
  });
}
