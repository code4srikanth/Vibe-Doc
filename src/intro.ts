// Intro scene: the patient walks in, sits behind the slit lamp and greets the doctor; Start Simulation opens the simulator.
// The scene fills the window's height on the left. On the right is the exam screen's own conversation panel, lifted over
// the scene, so the talk taken here simply carries on in the exam; the trainee can talk to the patient once seated.
// The scene is a fixed 1280x720 stage (the video's pixels) scaled to cover its area; the lamp image has its screen
// cut out and graded to the clips' room light (tools/prepare-slit-lamp.py) and a dark screen canvas is warped into the
// hole. The lamp stands in front of the seated patient at its real size; soft edges, grain, a light wrap and contact and
// ambient shadows set it into the clip (see playIntro's styles). The walk-in clip is picked
// from videos/videos.json by the case subject's sex and age. index.html hides the app (html.intro) from the first
// paint, and the stage shows only once the clip's first frame and the lamp are loaded, so nothing pops in late.
import lampUrl from "../assets/scene/slit-lamp-cut.png?url";
import wrapUrl from "../assets/scene/slit-lamp-wrap.png?url";
import lampInfo from "../assets/scene/slit-lamp.json";
import registry from "../videos/videos.json";
import type { ExamConversation } from "./ui/exam.ts";

type Clip = { file: string; sex: string; age: [number, number]; chinY: number };
const clipUrls = import.meta.glob("../videos/*.mp4", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** The clip for this subject: same sex and age in range; else same sex, nearest age range; else the first clip. */
function pickClip(subject: { sex?: string; age: number }): Clip {
  const clips = registry.videos as Clip[];
  const gap = (c: Clip) => Math.max(0, c.age[0] - subject.age, subject.age - c.age[1]);
  const same = clips.filter(c => c.sex === subject.sex).sort((a, b) => gap(a) - gap(b));
  return same[0] ?? clips[0];
}

const W = 1280, H = 720, CHAT_W = 360, CHAT_GAP = 10;
// the Start button's centre and text size on the stage: over the clips' corner mark (about 50 px across), which it covers once shown
const START = { x: 1160, y: 600, font: 16 };
// the seated patient on the stage, measured on the clips' last frames: the chin's x and the head's width are the same in
// every clip, and the chin's height is each clip's own (chinY in videos/videos.json)
const CHIN_X = 639, HEAD = 84;
// 1 cm = HEAD / 15 px (a head is about 15 cm wide); the lamp is lowered 3 cm from the eye line
const DROP = 3 * HEAD / 15;
// lamp size: the pedestal runs on below the frame, so the lamp is enlarged until the table top spans about 430 px of the stage
const SCALE = 0.5;
// the screen glass in lamp-image pixels (TL, TR, BR, BL), the same quad that was cut out of the image
const SCREEN = lampInfo.screen as [number, number][];

/** The lamp's place for a patient whose chin is at this height: the eyepieces sit over the patient's eyes. */
function placeLamp(chinY: number) {
  const eyeY = chinY - 0.7 * HEAD + DROP;
  const LAMP = { scale: SCALE, x: CHIN_X - lampInfo.chin[0] * SCALE, y: eyeY - lampInfo.eyes[1] * SCALE, w: lampInfo.size[0], h: lampInfo.size[1] };
  const toStage = ([x, y]: [number, number]): [number, number] => [LAMP.x + x * LAMP.scale, LAMP.y + y * LAMP.scale];
  return { LAMP, toStage, quad: SCREEN.map(toStage) };
}

/** CSS matrix3d mapping the rectangle (0,0)-(w,h) onto a quad (TL, TR, BR, BL). */
function rectToQuad(w: number, h: number, q: [number, number][]): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
  // unit square -> quad, then pre-scale by 1/w, 1/h
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.join(",")})`;
}

/** A tile of grey noise for the lamp's film grain (the clips carry a faint grain; a clean still would look pasted on). */
function grainTile(n = 128): string {
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const c = cv.getContext("2d")!, img = c.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 90;
    img.data.set([v, v, v, 255], i * 4);
  }
  c.putImageData(img, 0, 0);
  return cv.toDataURL();
}

/** The lamp's screen, switched off: dark glass with the room's reflection, a faint diagonal sheen brighter towards the top. */
function darkScreen(cv: HTMLCanvasElement) {
  const c = cv.getContext("2d")!, w = cv.width, h = cv.height;
  c.fillStyle = "#0a0d10"; c.fillRect(0, 0, w, h);
  const sheen = c.createLinearGradient(0, 0, w * 0.6, h);
  sheen.addColorStop(0, "rgba(255,255,255,.10)"); sheen.addColorStop(0.45, "rgba(255,255,255,.03)"); sheen.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = sheen; c.fillRect(0, 0, w, h);
}

/** Shows the intro over the app; resolves once the trainee has pressed Start Simulation. */
export function playIntro(subject: { sex?: string; age: number }, conversation: ExamConversation): Promise<void> {
  const clip = pickClip(subject), { LAMP, toStage, quad } = placeLamp(clip.chinY);
  // depth: the room and patient sit a little softer than the lamp; the lamp body casts a faint ambient shadow on the patient
  // only (masked to the head and torso, the wall is metres behind); the base gets a contact shadow on the table
  const box = `left: ${LAMP.x}px; top: ${LAMP.y}px; width: ${LAMP.w * LAMP.scale}px; height: ${LAMP.h * LAMP.scale}px;`;
  const mask = (url: string) => `-webkit-mask: url("${url}") 0 0 / 100% 100%; mask: url("${url}") 0 0 / 100% 100%;`;
  const headShade = `radial-gradient(ellipse ${2 * HEAD}px ${3.2 * HEAD}px at ${CHIN_X}px ${clip.chinY + 1.4 * HEAD}px, #000 45%, transparent 100%)`;
  const [bx, by] = toStage([lampInfo.base[0], lampInfo.base[1]]), brx = lampInfo.base[2] * LAMP.scale, bry = lampInfo.base[3] * LAMP.scale;
  const css = document.createElement("style");
  css.textContent = `
#intro { position: fixed; inset: 0; z-index: 100; background: #eceeef; overflow: hidden; transition: opacity .6s ease; }
#intro.out { opacity: 0; pointer-events: none; }
#intro .scene { position: absolute; left: 0; top: 0; bottom: 0; overflow: hidden; }
#intro .scene.zoom { transition: width 1s cubic-bezier(.6,0,.3,1); }
#intro .stage { position: absolute; left: 50%; top: 50%; width: ${W}px; height: ${H}px; transform-origin: 0 0; opacity: 0; transition: opacity .25s ease; }
#intro .scene.zoom .stage { transition: transform 1s cubic-bezier(.6,0,.3,1), left 1s cubic-bezier(.6,0,.3,1), opacity .25s ease; }
#intro .stage.shown { opacity: 1; }
#intro video, #intro .lamp, #intro canvas, #intro .fx { position: absolute; left: 0; top: 0; user-select: none; -webkit-user-drag: none; pointer-events: none; }
#intro video { width: ${W}px; height: ${H}px; filter: blur(.6px); }
#intro .lamp { ${box} filter: blur(.3px); }
#intro .ambient { inset: 0; -webkit-mask: ${headShade}; mask: ${headShade}; }
#intro .ambient img { position: absolute; ${box} transform: translate(0, ${0.08 * HEAD}px); filter: brightness(0) blur(${0.12 * HEAD}px); opacity: .16; }
#intro .contact { left: ${bx - brx}px; top: ${by - bry}px; width: ${2 * brx}px; height: ${2 * bry}px; mix-blend-mode: multiply;
  background: radial-gradient(closest-side, rgba(70, 64, 58, .55), rgba(70, 64, 58, .25) 55%, transparent); filter: blur(1.5px); }
#intro .wrap { ${box} ${mask(wrapUrl)} background: #f2f1ec; mix-blend-mode: screen; opacity: .22; }
#intro .grain { ${box} ${mask(lampUrl)} mix-blend-mode: overlay; opacity: .07; background-size: 128px 128px; }
#intro .stage.playing .grain { animation: grain .5s steps(6) infinite; }
@keyframes grain { 0% { background-position: 0 0; } 100% { background-position: 77px 53px; } }
#intro canvas { transform-origin: 0 0; filter: blur(.35px) contrast(.92); }
/* the same button as the lobby's "Enter Cabin" (lobby.css): navy face, mint text, a turning rim */
#intro .start { --ink: #0b1230; position: absolute; translate: -50% -50%; isolation: isolate; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .3em; width: 7em; height: 7em; padding: 0 .6em; border: 0; border-radius: 50%; background: none; color: #7df3d9; white-space: normal; text-align: center; font: 600 18px/1.15 "Barlow", "Segoe UI", system-ui, sans-serif; box-shadow: 0 0 14px rgba(20, 179, 148, .4); cursor: pointer; transition: opacity .4s ease, box-shadow .2s ease; }
#intro .start:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
#intro .start:disabled::before { animation: none; }
#intro .start.gone { opacity: 0; pointer-events: none; }
#intro .start::before { content: ""; position: absolute; z-index: -2; left: 50%; top: 50%; width: 200%; aspect-ratio: 1; translate: -50% -50%; background: conic-gradient(#fff, #5eead4 18%, #14b394 38%, #fff 55%, #67e8f9 78%, #fff); animation: intro-spin 3.2s linear infinite; will-change: rotate; }
#intro .start::after { content: ""; position: absolute; z-index: -1; inset: 1.5px; border-radius: inherit; background: linear-gradient(180deg, #16264f, var(--ink)); }
#intro .start:not(:disabled):hover, #intro .start:focus-visible { box-shadow: 0 0 30px 4px rgba(24, 214, 186, .75); }
#intro .start:focus-visible { outline: 3px solid #0b8f86; outline-offset: 3px; }
@keyframes intro-spin { to { rotate: 360deg; } }
@media (prefers-reduced-motion: reduce) { #intro .start::before { animation: none; } }
#intro .tap { position: absolute; inset: 0; display: grid; place-items: center; font: 600 22px var(--f-display, sans-serif); color: #fff; background: rgba(0,0,0,.35); cursor: pointer; }`;
  document.head.append(css);

  const root = document.createElement("div");
  root.id = "intro";
  root.innerHTML = `<div class="scene"><div class="stage"><video muted playsinline preload="auto"></video><div class="fx ambient"><img alt=""></div><canvas width="480" height="214"></canvas><img class="lamp" alt="Slit lamp"><div class="fx contact"></div><div class="fx wrap"></div><div class="fx grain"></div></div><button type="button" class="start" disabled>Start Simulation</button></div>`;
  document.body.append(root);
  const scene = root.querySelector<HTMLDivElement>(".scene")!, stage = root.querySelector<HTMLDivElement>(".stage")!, video = root.querySelector("video")!, cv = root.querySelector("canvas")!;
  const lamp = root.querySelector<HTMLImageElement>(".lamp")!;
  lamp.src = root.querySelector<HTMLImageElement>(".ambient img")!.src = lampUrl;
  root.querySelector<HTMLDivElement>(".grain")!.style.backgroundImage = `url(${grainTile()})`;
  // the grain moves only while the clip plays; on the held last frame it is still, like the video's own
  for (const ev of ["play", "pause", "ended"]) video.addEventListener(ev, () => stage.classList.toggle("playing", !video.paused && !video.ended));
  video.src = clipUrls[`../videos/${clip.file}`];

  // the canvas fills the screen quad, grown by 2.5 px so no seam shows under the thin bezel
  const ctr = quad.reduce(([a, b], [x, y]) => [a + x / 4, b + y / 4], [0, 0]);
  const grown = quad.map(([x, y]) => { const dx = x - ctr[0], dy = y - ctr[1], l = Math.hypot(dx, dy); return [x + 2.5 * dx / l, y + 2.5 * dy / l] as [number, number]; });
  cv.style.transform = rectToQuad(cv.width, cv.height, grown);

  const start = root.querySelector<HTMLButtonElement>(".start")!;
  // the exam's conversation panel stands over the scene's right side for the whole walk-in
  const { panel, greet, holdTalk } = conversation, exam = panel.closest<HTMLElement>("#exam")!;
  root.style.background = getComputedStyle(exam).getPropertyValue("--bg");
  exam.classList.add("over-intro");
  holdTalk(true);   // talking starts once the patient is seated

  // the video covers its area, with no gaps; the lamp is on the same stage, so it keeps its place on the video
  const layout = () => {
    const chatW = Math.min(CHAT_W, innerWidth * 0.42), avail = innerWidth - chatW - 2 * CHAT_GAP;
    Object.assign(panel.style, { top: `${CHAT_GAP}px`, right: `${CHAT_GAP}px`, bottom: `${CHAT_GAP}px`, width: `${chatW}px` });
    const fit = Math.max(avail / W, innerHeight / H);
    scene.style.width = `${avail}px`;
    stage.style.left = `${avail / 2}px`;
    stage.style.transform = `translate(${-W * fit / 2}px, ${-H * fit / 2}px) scale(${fit})`;
    // the button sits on its mark in the video and grows with it, but stays inside the scene when the sides are cropped
    start.style.fontSize = `${START.font * fit}px`;
    const halfW = start.offsetWidth / 2, halfH = start.offsetHeight / 2;
    start.style.left = `${Math.max(halfW + 12, Math.min(avail - halfW - 12, avail / 2 + (START.x - W / 2) * fit))}px`;
    start.style.top = `${Math.min(innerHeight - halfH - 28, innerHeight / 2 + (START.y - H / 2) * fit)}px`;
  };
  layout();
  addEventListener("resize", layout);

  darkScreen(cv);

  /** Slides the panel from over the scene to its place on the exam screen, while the scene zooms away. */
  const dockPanel = () => {
    exam.classList.remove("over-intro");
    panel.removeAttribute("style");
    const slot = panel.getBoundingClientRect();
    exam.classList.add("over-intro");
    layout();
    void panel.offsetWidth;   // settle the styles, so the slide starts from where the panel is now
    if (slot.width && slot.bottom <= innerHeight) {
      panel.style.transition = ["top", "right", "bottom", "width"].map(p => `${p} .7s cubic-bezier(.6,0,.3,1)`).join();
      Object.assign(panel.style, { top: `${slot.top}px`, right: `${innerWidth - slot.right}px`, bottom: `${innerHeight - slot.bottom}px`, width: `${slot.width}px` });
    }
  };

  return new Promise(resolve => {
    let done = false;
    start.addEventListener("click", () => {
      if (done) return;
      done = true;
      removeEventListener("resize", layout);
      start.classList.add("gone");
      dockPanel();
      // zoom into the screen, then the exam screen fades in round the panel; the conversation is not interrupted
      scene.classList.add("zoom");
      scene.style.width = "100%";
      stage.style.left = "50%";
      const z = Math.min(innerWidth / (quad[1][0] - quad[0][0]), innerHeight / (quad[3][1] - quad[0][1]));
      stage.style.transform = `translate(${-ctr[0] * z}px, ${-ctr[1] * z}px) scale(${z})`;
      setTimeout(() => {
        document.documentElement.classList.remove("intro");
        root.classList.add("out");
        panel.removeAttribute("style");
        exam.classList.replace("over-intro", "intro-reveal");
      }, 700);
      setTimeout(() => { exam.classList.remove("intro-reveal"); root.remove(); css.remove(); resolve(); }, 1300);
    });

    // seated: the last frame holds, the patient greets the doctor and the simulation can start. A clip that cannot play
    // goes straight here, so the trainee can always go on.
    let seated = false;
    const seat = () => {
      if (seated) return;
      seated = true;
      start.disabled = false;
      holdTalk(false);
      void greet();
    };
    video.addEventListener("ended", seat);
    video.addEventListener("error", seat);
    // show the stage and start once the first frame and the lamp are both ready
    const firstFrame = new Promise(r => video.readyState >= 2 ? r(0) : video.addEventListener("loadeddata", r, { once: true }));
    Promise.all([firstFrame, lamp.decode().catch(() => {})]).then(() => {
      stage.classList.add("shown");
      video.play().catch(() => {
        // autoplay blocked: ask for one click to start the scene
        const tap = document.createElement("div");
        tap.className = "tap"; tap.textContent = "Click to enter the clinic";
        scene.append(tap);
        tap.addEventListener("click", () => { tap.remove(); video.play(); }, { once: true });
      });
    });
  });
}
