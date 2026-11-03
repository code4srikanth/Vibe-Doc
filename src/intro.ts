// Intro scene: the patient walks in, sits behind the slit lamp and greets the doctor; Start Simulation opens the simulator.
// The scene sits on the left and the conversation panel is open on the right from the start; the trainee can talk to the
// patient once seated.
// The scene is a fixed 1280x720 stage (the video's pixels) scaled to fit the window; the lamp image has its screen
// cut out and graded to the clips' room light (tools/prepare-slit-lamp.py) and a blank screen canvas is warped into the
// hole. The lamp stands in front of the seated patient at its real size; soft edges, grain, a light wrap and contact and
// ambient shadows set it into the clip (see playIntro's styles). The walk-in clip is picked
// from videos/videos.json by the case subject's sex and age. index.html hides the app (html.intro) from the first
// paint, and the stage shows only once the clip's first frame and the lamp are loaded, so nothing pops in late.
import lampUrl from "../assets/scene/slit-lamp-cut.png?url";
import wrapUrl from "../assets/scene/slit-lamp-wrap.png?url";
import lampInfo from "../assets/scene/slit-lamp.json";
import registry from "../videos/videos.json";
import { bindSpeech } from "./ui/exam.ts";
import type { PatientLink } from "./ui/patientLink.ts";

type Clip = { file: string; sex: string; age: [number, number] };
const clipUrls = import.meta.glob("../videos/*.mp4", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** The clip for this subject: same sex and age in range; else same sex, nearest age range; else the first clip. */
function pickClip(subject: { sex?: string; age: number }): string {
  const clips = registry.videos as Clip[];
  const gap = (c: Clip) => Math.max(0, c.age[0] - subject.age, subject.age - c.age[1]);
  const same = clips.filter(c => c.sex === subject.sex).sort((a, b) => gap(a) - gap(b));
  return clipUrls[`../videos/${(same[0] ?? clips[0]).file}`];
}

const W = 1280, H = 720, CHAT_W = 360;
// the seated patient in the clips (all share one framing): chin point and head width on the stage, measured on the last frames
const CHIN = [639, 266], HEAD = 84;
// 1 cm = HEAD / 15 px (a head is about 15 cm wide); the lamp is lowered 3 cm from the eye line
const DROP = 3 * HEAD / 15;
const EYE_Y = CHIN[1] - 0.7 * HEAD + DROP;
// lamp placement: the eyepieces sit over the seated patient's eyes; the pedestal runs on below the frame, so the lamp
// is enlarged until the table top spans about 430 px of the stage
const SCALE = 0.5;
const LAMP = { scale: SCALE, x: CHIN[0] - lampInfo.chin[0] * SCALE, y: EYE_Y - lampInfo.eyes[1] * SCALE, w: lampInfo.size[0], h: lampInfo.size[1] };
// the screen glass in lamp-image pixels (TL, TR, BR, BL), the same quad that was cut out of the image
const SCREEN = lampInfo.screen as [number, number][];
const toStage = ([x, y]: [number, number]): [number, number] => [LAMP.x + x * LAMP.scale, LAMP.y + y * LAMP.scale];
const quad = SCREEN.map(toStage);

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

/** The lamp's screen: blank white, with the room's reflection on the glass, a faint diagonal sheen brighter towards the top. */
function blankScreen(cv: HTMLCanvasElement) {
  const c = cv.getContext("2d")!, w = cv.width, h = cv.height;
  c.fillStyle = "#fff"; c.fillRect(0, 0, w, h);
  const sheen = c.createLinearGradient(0, 0, w * 0.6, h);
  sheen.addColorStop(0, "rgba(255,255,255,.10)"); sheen.addColorStop(0.45, "rgba(255,255,255,.03)"); sheen.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = sheen; c.fillRect(0, 0, w, h);
}

/** Shows the intro over the app; resolves once the trainee has pressed Start Simulation (or skipped). */
export function playIntro(subject: { sex?: string; age: number }, patient?: PatientLink): Promise<void> {
  // depth: the room and patient sit a little softer than the lamp; the lamp body casts a faint ambient shadow on the patient
  // only (masked to the head and torso, the wall is metres behind); the base gets a contact shadow on the table
  const box = `left: ${LAMP.x}px; top: ${LAMP.y}px; width: ${LAMP.w * LAMP.scale}px; height: ${LAMP.h * LAMP.scale}px;`;
  const mask = (url: string) => `-webkit-mask: url("${url}") 0 0 / 100% 100%; mask: url("${url}") 0 0 / 100% 100%;`;
  const headShade = `radial-gradient(ellipse ${2 * HEAD}px ${3.2 * HEAD}px at ${CHIN[0]}px ${CHIN[1] + 1.4 * HEAD}px, #000 45%, transparent 100%)`;
  const [bx, by] = toStage([lampInfo.base[0], lampInfo.base[1]]), brx = lampInfo.base[2] * LAMP.scale, bry = lampInfo.base[3] * LAMP.scale;
  const css = document.createElement("style");
  css.textContent = `
#intro { position: fixed; inset: 0; z-index: 100; background: #eceeef; overflow: hidden; transition: opacity .6s ease; }
#intro.out { opacity: 0; pointer-events: none; }
#intro .stage { position: absolute; left: 50%; top: 50%; width: ${W}px; height: ${H}px; transform-origin: 0 0; opacity: 0; transition: transform 1s cubic-bezier(.6,0,.3,1), left 1s cubic-bezier(.6,0,.3,1), opacity .25s ease; }
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
#intro .start { position: absolute; right: 60px; bottom: 58px; width: 112px; height: 112px; padding: 10px; border: 3px solid #fff; border-radius: 50%; background: #1f8f85; color: #fff; font: 700 16px/1.15 var(--f-display, sans-serif); letter-spacing: .02em; box-shadow: 0 4px 18px rgba(0,12,46,.35); cursor: pointer; opacity: 0; pointer-events: none; transition: opacity .4s ease, background .15s ease; }
#intro .start.on { opacity: 1; pointer-events: auto; }
#intro .start:hover { background: #177a71; }
#intro .start:focus-visible { outline: 3px solid #000c2e; outline-offset: 2px; }
#intro .skip { position: absolute; top: 14px; right: 16px; font: 500 14px var(--f-display, sans-serif); letter-spacing: .05em; background: rgba(15,18,21,.55); color: #fff; border: 1px solid rgba(255,255,255,.3); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
#intro .chat { position: absolute; top: 60px; right: 16px; bottom: 16px; width: ${CHAT_W}px; display: flex; flex-direction: column; background: #fff; border-radius: 12px; box-shadow: 0 6px 28px rgba(0,12,46,.18); color: #000c2e; font: 400 15px/1.4 var(--f-body, system-ui, sans-serif); transition: opacity .6s ease; }
#intro .chat:not(.open) { opacity: 0; pointer-events: none; }
#intro .chat h2 { margin: 0; padding: 14px 16px; font: 600 18px var(--f-display, sans-serif); letter-spacing: .03em; border-bottom: 1px solid #e3e7ec; }
#intro .chat ol { flex: 1; margin: 0; padding: 12px 14px; list-style: none; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
#intro .chat li { max-width: 86%; padding: 8px 12px; border-radius: 12px; background: #eef1f5; align-self: flex-start; }
#intro .chat li.you { background: #00b386; color: #fff; align-self: flex-end; }
#intro .chat li.note { max-width: 100%; background: none; padding: 0; color: #5b6575; font-size: 13px; }
#intro .chat li b { display: block; font: 600 12px var(--f-display, sans-serif); letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
#intro .chat form { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #e3e7ec; }
#intro .chat input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #cfd6df; border-radius: 8px; font: inherit; }
#intro .chat .ptt { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border: 0; border-radius: 8px; background: #000c2e; color: #fff; font: 600 13px var(--f-display, sans-serif); cursor: pointer; white-space: nowrap; }
#intro .chat .ptt.on { background: #d6334a; }
#intro .chat .ptt:disabled { opacity: .5; cursor: default; }
#intro .tap { position: absolute; inset: 0; display: grid; place-items: center; font: 600 22px var(--f-display, sans-serif); color: #fff; background: rgba(0,0,0,.35); cursor: pointer; }`;
  document.head.append(css);

  const root = document.createElement("div");
  root.id = "intro";
  root.innerHTML = `<div class="stage"><video muted playsinline preload="auto"></video><div class="fx ambient"><img alt=""></div><canvas width="480" height="214"></canvas><img class="lamp" alt="Slit lamp"><div class="fx contact"></div><div class="fx wrap"></div><div class="fx grain"></div><button type="button" class="start" tabindex="-1">Start Simulation</button></div><button type="button" class="skip">Skip intro ▸</button><aside class="chat open"><h2>Conversation with the patient</h2><ol><li class="note">Once seated, the patient will greet you. Take the history by holding the button to speak, or by typing. Press Start Simulation when you are ready to examine.</li></ol><form><button type="button" class="ptt"><span class="ptt-label">Hold to Speak</span></button><input type="text" placeholder="Type to the patient" aria-label="Type to the patient"></form></aside>`;
  document.body.append(root);
  const stage = root.querySelector<HTMLDivElement>(".stage")!, video = root.querySelector("video")!, cv = root.querySelector("canvas")!;
  const lamp = root.querySelector<HTMLImageElement>(".lamp")!;
  lamp.src = root.querySelector<HTMLImageElement>(".ambient img")!.src = lampUrl;
  root.querySelector<HTMLDivElement>(".grain")!.style.backgroundImage = `url(${grainTile()})`;
  // the grain moves only while the clip plays; on the held last frame it is still, like the video's own
  for (const ev of ["play", "pause", "ended"]) video.addEventListener(ev, () => stage.classList.toggle("playing", !video.paused && !video.ended));
  video.src = pickClip(subject);

  // the canvas fills the screen quad, grown by 2.5 px so no seam shows under the thin bezel
  const ctr = quad.reduce(([a, b], [x, y]) => [a + x / 4, b + y / 4], [0, 0]);
  const grown = quad.map(([x, y]) => { const dx = x - ctr[0], dy = y - ctr[1], l = Math.hypot(dx, dy); return [x + 2.5 * dx / l, y + 2.5 * dy / l] as [number, number]; });
  cv.style.transform = rectToQuad(cv.width, cv.height, grown);

  let fit = 1;
  // the scene leaves room for the transcript on the right
  const chatOpen = true;
  const layout = () => {
    const avail = innerWidth - (chatOpen ? CHAT_W + 32 : 0);
    fit = Math.min(avail / W, innerHeight / H);
    stage.style.left = `${avail / 2}px`;
    stage.style.transform = `translate(${-W * fit / 2}px, ${-H * fit / 2}px) scale(${fit})`;
  };
  layout();
  addEventListener("resize", layout);

  blankScreen(cv);

  // the voice conversation: the trainee speaks first; the patient's sentences appear as they arrive and are spoken
  const chat = root.querySelector<HTMLElement>(".chat");
  let turn: AbortController | undefined, stopListening: (() => void) | undefined, greetDoctor: (() => Promise<void>) | undefined;
  const unsupported = new Set<Element>();
  if (chat) {
    const msgs = chat.querySelector("ol")!, input = chat.querySelector("input")!;
    const add = (who: string, text: string) => {
      const li = document.createElement("li");
      li.className = who === "You" ? "you" : "";
      li.innerHTML = "<b></b><span></span>";
      li.querySelector("b")!.textContent = who; li.querySelector("span")!.textContent = text;
      msgs.append(li); msgs.scrollTop = msgs.scrollHeight;
      return li.querySelector("span")!;
    };
    // the patient speaks first; if the trainee speaks before the history is ready, that turn takes over
    greetDoctor = async () => {
      if (!patient) return;
      const mine = turn = new AbortController(), line = add("Patient", "…");
      try {
        const hello = await patient.greet(mine.signal);
        line.textContent = hello;
        patient.speak(hello);
        msgs.scrollTop = msgs.scrollHeight;
      } catch {
        line.closest("li")?.remove();
      }
    };
    const ask = async (text: string) => {
      add("You", text);
      if (!patient) { add("Patient", "(The voice patient is not connected. Start the server with npm run server.)"); return; }
      turn?.abort(); patient.stopSpeaking();
      const mine = turn = new AbortController(), reply = add("Patient", "…");
      let first = true;
      try {
        for await (const ev of patient.chat(text, mine.signal)) {
          if (ev.type !== "say") continue;
          reply.textContent = first ? ev.text : `${reply.textContent} ${ev.text}`; first = false;
          patient.speak(ev.text);
          msgs.scrollTop = msgs.scrollHeight;
        }
        if (first) reply.textContent = "(no reply)";
      } catch (e) {
        if (!mine.signal.aborted) reply.textContent = `(The patient could not answer: ${(e as Error).message})`;
      }
    };
    chat.querySelector("form")!.addEventListener("submit", e => { e.preventDefault(); const t = input.value.trim(); if (t) { input.value = ""; void ask(t); } });
    stopListening = bindSpeech(chat.querySelector(".ptt")!, chat.querySelector(".ptt-label")!, ask, () => patient);
    // talking starts once the patient is seated; a button the browser cannot support stays off
    for (const el of chat.querySelectorAll<HTMLButtonElement | HTMLInputElement>(".ptt, input")) { if (el.disabled) unsupported.add(el); el.disabled = true; }
  }

  return new Promise(resolve => {
    let done = false;
    const finish = (zoom: boolean) => {
      if (done) return;
      done = true;
      stopListening?.(); turn?.abort(); patient?.stopSpeaking();
      if (zoom) {
        // zoom into the screen, then fade the scene away
        stage.style.left = "50%";
        chat?.classList.remove("open");
        const z = Math.min(innerWidth / (quad[1][0] - quad[0][0]), innerHeight / (quad[3][1] - quad[0][1]));
        stage.style.transform = `translate(${-ctr[0] * z}px, ${-ctr[1] * z}px) scale(${z})`;
      }
      setTimeout(() => { document.documentElement.classList.remove("intro"); root.classList.add("out"); }, zoom ? 700 : 0);
      setTimeout(() => { removeEventListener("resize", layout); root.remove(); css.remove(); resolve(); }, zoom ? 1300 : 600);
    };
    const start = root.querySelector<HTMLButtonElement>(".start")!;
    start.addEventListener("click", () => finish(true));
    root.querySelector(".skip")!.addEventListener("click", () => finish(false));
    addEventListener("keydown", function esc(e) { if (e.key === "Escape") { removeEventListener("keydown", esc); finish(false); } });

    // seated: the last frame holds, the patient greets the doctor and the simulation can start
    video.addEventListener("ended", () => {
      start.classList.add("on"); start.tabIndex = 0;
      root.querySelector(".skip")!.textContent = "Skip ▸";
      void greetDoctor?.();
      for (const el of chat?.querySelectorAll<HTMLButtonElement | HTMLInputElement>(".ptt, input") ?? []) if (!unsupported.has(el)) el.disabled = false;
    });
    // show the stage and start once the first frame and the lamp are both ready
    const firstFrame = new Promise(r => video.readyState >= 2 ? r(0) : video.addEventListener("loadeddata", r, { once: true }));
    Promise.all([firstFrame, lamp.decode().catch(() => {})]).then(() => {
      stage.classList.add("shown");
      video.play().catch(() => {
        // autoplay blocked: ask for one click to start the scene
        const tap = document.createElement("div");
        tap.className = "tap"; tap.textContent = "Click to enter the clinic";
        root.append(tap);
        tap.addEventListener("click", () => { tap.remove(); video.play(); }, { once: true });
      });
    });
  });
}
