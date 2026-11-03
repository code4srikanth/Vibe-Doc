// Screen 6, the exam: the view through the slit lamp, the lamp's controls, and the patient conversation
// (docs/architecture/parts/05-ui-ux.md). The screen owns no clinical values: it edits the LampSettings that
// main.ts renders, and asks main.ts to re-resolve the eye when a drop changes it (dilation).
import "./exam.css";
import { applyTheme, savedTheme, type Theme } from "./theme.ts";
import { FUNDUS_LENSES, type Filter, type LampSettings } from "../exam/views.ts";
import { createLogo } from "./logo.ts";
import { listenHandsFree, type EyeAction, type PatientLink } from "./patientLink.ts";

export interface ExamPatient { age: number; sex?: string; eye: "OD" | "OS"; caseLabel: string; validated: boolean }

export interface ExamHooks {
  lamp(): LampSettings;
  /** The lamp changed: re-render. */
  apply(): void;
  /** Put every lamp setting back to the view's starting values. */
  resetLamp(): void;
  setDilated(on: boolean): void;
  /** The patient's gaze, degrees: + toward the lateral canthus, + up. */
  setGaze(horizontal: number, vertical: number): void;
  /** The upper lid's move as a fraction of the opening's height: 1 closed, negative raised. */
  setLids(fraction: number, centre?: number): void;
  /** Width of the view's field, mm. */
  fieldWidth(): number;
  /** A fundus lens was chosen (or null, none): show the fundus through it. */
  setFundusLens(lens: string | null): void;
  /** The trainee moved to this eye: the case's own, or the patient's healthy other eye. */
  setEye(viewed: "OD" | "OS"): void;
  /** The voice patient, once the session is open; without one the chat says so. */
  patient?(): PatientLink | undefined;
  /** The trainee ended the examination: the case sheet comes next. */
  end?(): void;
}

/** The conversation panel, which the walk-in (src/intro.ts) shows over its scene: one conversation, from the greeting to the end of the exam. */
export interface ExamConversation {
  panel: HTMLElement;
  /** The patient's first words. */
  greet(): Promise<void>;
  /** Stops the trainee talking or typing while on, as until the patient is seated. */
  holdTalk(on: boolean): void;
}
export interface ExamScreen { sync(): void; conversation: ExamConversation }

/** One lamp event, for the Examiner's technique score (part 8, task 2). */
export interface ExamEvent { t: number; type: string; value: unknown }
export const examLog: ExamEvent[] = [];
const t0 = performance.now();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
/** Records an event; continuous controls (knobs, sliders, joystick) record once they settle. */
function log(type: string, value: unknown, settle = 0) {
  clearTimeout(pending.get(type));
  const push = () => examLog.push({ t: Math.round(performance.now() - t0), type, value });
  if (settle) pending.set(type, setTimeout(push, settle)); else push();
}

const ICON = {
  person: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
  book: `<path d="M3 5.5C5.5 4 8.5 4 12 6c3.5-2 6.5-2 9-.5V19c-2.5-1.5-5.5-1.5-9 .5-3.5-2-6.5-2-9-.5z"/><path d="M12 6v13.5"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`,
  eye: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
  sliders: `<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>`,
  zoom: `<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>`,
  chevron: `<path d="M6 9l6 6 6-6"/>`,
  expand: `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`,
  wave: `<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2"/>`,
  speaker: `<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>`,
  muted: `<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>`,
  send: `<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5 20 4"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
  sunDim: `<circle cx="12" cy="12" r="3.5"/><path d="M12 4v1M12 19v1M4 12h1M19 12h1M6.3 6.3l.7.7M17 17l.7.7M6.3 17.7l.7-.7M17 7l.7-.7"/>`,
  target: `<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>`,
  drop: `<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>`,
  up: `<path d="M12 19V5M6 11l6-6 6 6"/>`, down: `<path d="M12 5v14M6 13l6 6 6-6"/>`,
  left: `<path d="M19 12H5M11 6l-6 6 6 6"/>`, right: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
  blink: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><path d="M2 12h20"/>`,
  arm: `<path d="M12 21V9"/><path d="M12 9 5 4M12 9l7-5"/><circle cx="12" cy="9" r="1.6"/>`,
  stick: `<circle cx="12" cy="7" r="3.5"/><path d="M12 10.5V17M6 20h12M8 17h8"/>`,
  height: `<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>`,
  width: `<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>`,
};
const svg = (name: keyof typeof ICON, cls = "") => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ""}>${ICON[name]}</svg>`;

const LENSES = ["None", "60D", "78D", "90D", "Pan Retinal (PRP)", "Goldmann Three Mirror", "Gonioscopy Lens"];
const MAGS: LampSettings["magnification"][] = [6, 10, 16, 25, 40];
const HEIGHTS = [1, 2, 3, 5, 8, 14];   // mm, the click stops of the slit-height knob
const WIDTH_MAX = 14;                  // mm; the width slider is quadratic so the fine slits get most of its travel
const ARM_MAX = 60;                    // degrees either side
const DECENTRE_MAX = 4;                // mm
const FILTERS: { id: Filter; label: string }[] = [
  { id: "white", label: "White" }, { id: "cobalt", label: "Cobalt Blue" }, { id: "redfree", label: "Red Free" }, { id: "grey", label: "Grey" }];
// Joystick travel of the slit: lateral and height in mm, focus (forward and back) in mm from the corneal apex.
const TRAVEL = { x: 16, y: 10, focusMin: -9, focusMax: 1 };
const RATE = { x: 6, y: 4, focus: 2.5 };   // mm per second at full deflection
// How the simulated patient answers (behaviour, render-calibrated): look is the gaze asked for, degrees toward the
// patient's own left and up; the upper lid is lifted for up and down gaze, and lid moves are fractions of the
// opening's height (1 closes it).
const LOOK = [35, 22];   // sideways, up/down (degrees): a held look is a clear turn, inside the globe's gaze ranges
const LID = { up: -0.12, down: -0.12, wide: -0.18, blink: 1 };
const REACT_MS = 350;             // from the instruction to the patient's move
const BLINK_MS = [34, 22, 64];    // closing, shut, opening: 0.12 s in all
const BLINK_EVERY_MS = 8000;      // the patient's own blinks
const INSTRUCTIONS: { id: string; label: string; icon: keyof typeof ICON; say: string; look?: [number, number]; wide?: boolean }[] = [
  { id: "up", label: "Look Up", icon: "up", say: "Please look up.", look: [0, 1] },
  { id: "down", label: "Look Down", icon: "down", say: "Please look down.", look: [0, -1] },
  { id: "left", label: "Look Left", icon: "left", say: "Please look to your left.", look: [1, 0] },
  { id: "right", label: "Look Right", icon: "right", say: "Please look to your right.", look: [-1, 0] },
  { id: "blink", label: "Blink", icon: "blink", say: "Please blink.", wide: true },
  { id: "open", label: "Open Wide", icon: "eye", say: "Please open your eyes wide.", wide: true },
];
const EYE_NAME = { OD: "Right Eye", OS: "Left Eye" } as const;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace(/^-0(\.0+)?$/, "0$1");
const time = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Builds the screen. #view and #cv exist as soon as this returns, so the renderer can start behind the intro. */
export function mountExam() {
  const root = document.createElement("div");
  root.id = "exam";
  root.innerHTML = `
<header class="top">
  <div class="brand"><span class="logo"></span><span class="rule"></span><span class="dept">OPHTHALMOLOGY SIMULATOR</span></div>
  <nav>
    <button type="button" class="chip-btn" data-pop="patient">${svg("person", "ring")}<span><small>Patient</small><b class="case-label"></b></span>${svg("chevron", "chev")}</button>
    <button type="button" class="link" data-pop="info">${svg("book")}Case Info</button>
    <button type="button" class="link" data-pop="settings">${svg("gear")}Settings</button>
    <button type="button" class="end">End Examination</button>
  </nav>
  <div class="pop" id="pop-patient" hidden></div>
  <div class="pop" id="pop-info" hidden></div>
  <div class="pop" id="pop-settings" hidden>
    <h3>Appearance</h3>
    <div class="seg theme" role="group" aria-label="Appearance"><button type="button" data-theme="light">Light</button><button type="button" data-theme="dark">Dark</button></div>
    <label class="switch-row"><span>Instructor view</span><input type="checkbox" class="switch" id="instructor"></label><p>Shows the eye's metadata and checks. Keep it off while a trainee examines.</p></div>
</header>

<section class="stage">
  <div id="view">
    <canvas id="cv"></canvas>
    <button type="button" class="fs" aria-label="Full screen">${svg("expand")}</button>
    <div class="notice" hidden></div>
    <div class="wait" id="wait" hidden>Preparing the slit lamp… (slower the first time)</div>
    <div class="hint">drag: move the slit · scroll: focus</div>
  </div>
</section>

<aside class="panel controls">
  <h2>${svg("sliders")}Examination Controls</h2>
  <div class="group"><h3>${svg("eye")}Eye Selection</h3><div class="seg eyes big" role="group" aria-label="Eye selection"></div></div>
  <div class="group"><h3>${svg("eye")}Examination Lens</h3>
    <label class="select">${svg("eye")}<select id="lens" aria-label="Examination lens">${LENSES.map(l => `<option>${l}</option>`).join("")}</select>${svg("chevron", "chev")}</label></div>
  <div class="group"><h3>${svg("zoom")}Magnification</h3>
    <div class="seg mags" role="group" aria-label="Magnification">${MAGS.map(m => `<button type="button" data-mag="${m}">${m}x</button>`).join("")}</div></div>
  <div class="group range" id="g-height"><h3>${svg("height")}Slit Height (mm)</h3><div class="row"><div class="track"><input type="range" id="height" min="0" max="${HEIGHTS.length - 1}" step="1" aria-label="Slit height"><div class="ticks"></div></div><output></output></div></div>
  <div class="group range" id="g-width"><h3>${svg("width")}Slit Width (mm)</h3><div class="row"><div class="track"><input type="range" id="width" min="0" max="1" step="0.001" aria-label="Slit width"><div class="ticks"></div></div><output></output></div></div>
  <div class="group range" id="g-arm"><h3>${svg("arm")}Illumination Arm Angle</h3><div class="row"><div class="track"><input type="range" id="arm" min="${-ARM_MAX}" max="${ARM_MAX}" step="1" aria-label="Illumination arm angle"><div class="ticks"></div></div><output></output></div></div>
  <div class="group"><h3>${svg("stick")}Joystick</h3>
    <div class="joystick">
      <div class="pad" role="application" aria-label="Joystick: drag sideways to move the slit, up and down to focus" tabindex="0"><span class="axis">FOCUS IN</span><span class="axis b">FOCUS OUT</span><div class="knob"></div></div>
      <div class="twist" role="group" aria-label="Height"><button type="button" data-h="1" aria-label="Raise">${svg("up")}</button><span>Height</span><button type="button" data-h="-1" aria-label="Lower">${svg("down")}</button></div>
      <dl class="readout"><div><dt>X</dt><dd data-r="x"></dd></div><div><dt>Y</dt><dd data-r="y"></dd></div><div><dt>Focus</dt><dd data-r="f"></dd></div></dl>
    </div></div>
  <button type="button" class="reset-lamp">Reset Slit</button>
</aside>

<aside class="panel chat">
  <h2>${svg("wave")}Patient Conversation<button type="button" class="mute" aria-pressed="false">${svg("speaker")}<span>Mute Patient</span></button></h2>
  <ol class="msgs" aria-live="polite"><li class="note">Take the history before and during the examination. Tap the microphone to talk hands-free, or type below.</li></ol>
  <div class="talk">
    <button type="button" class="ptt" aria-label="Turn hands-free listening on or off">${svg("mic")}</button><span class="ptt-label">Tap to Talk</span>
    <button type="button" class="spk" aria-label="Patient voice volume">${svg("speaker")}</button>
  </div>
  <form class="type"><input type="text" placeholder="Type a message (optional)…" aria-label="Message to the patient"><button type="submit" aria-label="Send">${svg("send")}</button></form>
</aside>

<section class="panel filters">
  <h2>${svg("sliders")}Filters &amp; Illumination</h2>
  <h3 class="sub">Illumination Filter</h3>
  <div class="tiles" role="group" aria-label="Illumination filter">${FILTERS.map(f => `<button type="button" data-filter="${f.id}"><i class="dot ${f.id}"></i>${f.label}</button>`).join("")}</div>
  <div class="toggles">
    <label><span>Diffuser</span><input type="checkbox" class="switch" id="diffuser"></label>
    <label><span>Yellow Filter</span><input type="checkbox" class="switch" id="barrier"></label>
    <label><span>${svg("drop")}Dilate Pupil</span><input type="checkbox" class="switch" id="dilate"></label>
  </div>
</section>

<section class="panel dials">
  <h2>${svg("gear")}Slit Lamp Controls</h2>
  <div class="knobs"></div>
</section>

<section class="panel instructions">
  <h2>${svg("person")}Patient Instructions</h2>
  <div class="grid">${INSTRUCTIONS.map(i => `<button type="button" data-say="${i.id}"${i.wide ? ` class="wide"` : ""}>${svg(i.icon)}${i.label}</button>`).join("")}</div>
</section>

<div class="drawer" hidden>
  <div class="drawer-head"><h2>Instructor view</h2><button type="button" class="close" aria-label="Close">×</button></div>
  <label class="field">Case <select id="case"></select></label>
  <div id="subject"></div>
  <h3>Component metadata</h3>
  <select id="component" aria-label="Component"></select>
  <p id="summary"></p>
  <div class="scroll"><table id="props"></table></div>
  <h3>Validation</h3>
  <ul id="issues"></ul>
</div>

<dialog class="end-dialog">
  <h2>End the examination?</h2>
  <p>You will write your case sheet next. You can't return to the slit lamp afterwards.</p>
  <div class="actions"><button type="button" value="stay" class="ghost">Keep Examining</button><button type="button" value="end" class="danger">End Examination</button></div>
</dialog>`;
  root.querySelector(".logo")!.append(createLogo({ height: 26, alt: "VibeDoc" }));
  document.body.prepend(root);
  return { root, bind: (hooks: ExamHooks, patient: ExamPatient): ExamScreen => bindExam(root, hooks, patient) };
}

function bindExam(root: HTMLElement, hooks: ExamHooks, patient: ExamPatient): ExamScreen {
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)! as T;
  const qa = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
  const L = hooks.lamp;
  const change = (type: string, value: unknown, settle = 0) => { hooks.apply(); sync(); log(type, value, settle); };

  // ---- header: patient, case info, settings, end ----
  q(".case-label").textContent = patient.caseLabel;
  q("#pop-patient").innerHTML = `<dl><div><dt>Age</dt><dd>${patient.age} years</dd></div><div><dt>Sex</dt><dd>${patient.sex ?? "not stated"}</dd></div><div><dt>Presenting eye</dt><dd>${patient.eye} (${EYE_NAME[patient.eye]})</dd></div></dl>`;
  q("#pop-info").innerHTML = `<p class="badge ${patient.validated ? "ok" : ""}">${patient.validated ? "Clinically validated scenario" : "Not clinically validated"}</p>
<p>Take a history, examine both the anterior segment and the adnexa with the slit lamp, then end the examination to write your diagnosis.</p>`;
  const pops = qa(".pop");
  const closePops = () => { pops.forEach(p => p.hidden = true); qa("[data-pop]").forEach(b => b.setAttribute("aria-expanded", "false")); };
  qa("[data-pop]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const pop = q(`#pop-${b.dataset.pop}`), open = pop.hidden;
    closePops();
    if (open) {
      const r = b.getBoundingClientRect(), h = q(".top").getBoundingClientRect();
      pop.style.right = `${Math.max(8, h.right - r.right)}px`;
      pop.hidden = false; b.setAttribute("aria-expanded", "true");
    }
  }));
  document.addEventListener("click", e => { if (!(e.target as HTMLElement).closest(".pop")) closePops(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePops(); });

  const themeBtns = qa<HTMLButtonElement>(".theme button");
  const setTheme = (t: Theme, save = false) => { applyTheme(root, t, save); themeBtns.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.theme === t))); };
  setTheme(savedTheme());
  q(".theme").addEventListener("click", e => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.theme as Theme | undefined;
    if (t) setTheme(t, true);
  });

  const drawer = q(".drawer");
  q<HTMLInputElement>("#instructor").onchange = e => { drawer.hidden = !(e.target as HTMLInputElement).checked; };
  q(".drawer .close").onclick = () => { drawer.hidden = true; q<HTMLInputElement>("#instructor").checked = false; };

  const dialog = q<HTMLDialogElement>(".end-dialog");
  q(".end").onclick = () => dialog.showModal();
  dialog.addEventListener("click", e => {
    const v = (e.target as HTMLElement).closest("button")?.value;
    if (v === "stay") dialog.close();
    if (v === "end") {
      log("end", true);
      stopListening(); turn?.abort(); hooks.patient?.()?.stopSpeaking();
      dialog.close();
      hooks.end?.();
    }
  });

  // ---- view: eye, full screen, notices, mouse as joystick ----
  const view = q("#view"), notice = q(".notice");
  let viewed: "OD" | "OS" = patient.eye, lens = "None", wasFundus = false;
  for (const g of qa(".seg.eyes")) {
    g.innerHTML = (["OD", "OS"] as const).map(e => `<button type="button" data-eye="${e}"><b>${e}</b><span>${EYE_NAME[e]}</span></button>`).join("");
    g.addEventListener("click", e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      viewed = b.dataset.eye as "OD" | "OS";
      hooks.setEye(viewed); look(); showLens(); sync(); log("eye", viewed);
    });
  }
  const isFundus = () => lens in FUNDUS_LENSES;
  const showLens = () => { if (isFundus() || wasFundus) hooks.setFundusLens(isFundus() ? lens : null); wasFundus = isFundus(); };
  q<HTMLSelectElement>("#lens").onchange = e => { lens = (e.target as HTMLSelectElement).value; showLens(); sync(); log("lens", lens); };
  q(".fs").onclick = () => document.fullscreenElement ? document.exitFullscreen() : view.requestFullscreen().catch(() => { /* not allowed: stay inline */ });

  // ---- examination controls ----
  q(".mags").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (b) { L().magnification = Number(b.dataset.mag) as LampSettings["magnification"]; change("magnification", L().magnification); }
  });
  const widthOf = (t: number) => WIDTH_MAX * t * t, tOfWidth = (w: number) => Math.sqrt(clamp(w, 0, WIDTH_MAX) / WIDTH_MAX);
  const height = q<HTMLInputElement>("#height"), width = q<HTMLInputElement>("#width"), arm = q<HTMLInputElement>("#arm");
  height.oninput = () => { L().slitHeight = HEIGHTS[+height.value]; change("slitHeight", L().slitHeight); };
  width.oninput = () => { L().slitWidth = Math.round(widthOf(+width.value) * 100) / 100; change("slitWidth", L().slitWidth, 400); };
  arm.oninput = () => { L().angle = +arm.value; change("angle", L().angle, 400); };
  ticks("#g-height", HEIGHTS.map((h, i) => [i / (HEIGHTS.length - 1), String(h)]));
  ticks("#g-width", [0, 1, 2, 4, 8, 14].map(w => [tOfWidth(w), String(w)]));
  ticks("#g-arm", [-60, -30, 0, 30, 60].map(a => [(a + ARM_MAX) / (2 * ARM_MAX), a ? `${Math.abs(a)}${a < 0 ? "R" : "L"}` : "0"]));
  function ticks(group: string, marks: [number, string][]) {
    q(`${group} .ticks`).innerHTML = marks.map(([t, s]) => `<span style="left:${t * 100}%">${s}</span>`).join("");
  }

  // Joystick: tilt moves the slit sideways and its focus forward and back, twist raises and lowers it. The view stays
  // on the eye. The decentration knob below offsets the beam from the joystick's position. Rate control, like holding
  // a real stick over.
  const decentre = () => L().decentre ?? 0;
  const stickX = () => L().beamX - decentre();
  const move = (dx: number, dy: number, df: number) => {
    const s = L();
    const x = clamp(stickX() + dx, -TRAVEL.x, TRAVEL.x), y = clamp((s.beamY ?? 0) + dy, -TRAVEL.y, TRAVEL.y);
    s.beamX = x + decentre(); s.beamY = y;
    s.focus = clamp(s.focus + df, TRAVEL.focusMin, TRAVEL.focusMax);
    change("joystick", { x: +fmt(x, 2), y: +fmt(y, 2), focus: +fmt(s.focus, 2) }, 500);
  };
  const pad = q(".pad"), stickKnob = q(".knob");
  let defl: [number, number] | null = null, last = 0;
  const tick = (now: number) => {
    if (!defl) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // a small dead zone, then a squared response so small deflections give fine moves
    const shape = (v: number) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.08) ** 2 / 0.92 ** 2;
    if (defl[0] || defl[1]) move(shape(defl[0]) * RATE.x * dt, 0, -shape(defl[1]) * RATE.focus * dt);
    requestAnimationFrame(tick);
  };
  const deflect = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect(), rad = r.width / 2;
    let x = (e.clientX - r.left - rad) / rad, y = (e.clientY - r.top - rad) / rad;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    defl = [x, y];
    stickKnob.style.translate = `${x * 34}% ${y * 34}%`;
  };
  pad.addEventListener("pointerdown", e => { pad.setPointerCapture(e.pointerId); deflect(e); last = performance.now(); requestAnimationFrame(tick); });
  pad.addEventListener("pointermove", e => { if (defl) deflect(e); });
  const release = () => { defl = null; stickKnob.style.translate = ""; };
  pad.addEventListener("pointerup", release); pad.addEventListener("pointercancel", release);
  pad.addEventListener("keydown", e => {
    const k: Record<string, [number, number, number]> = { ArrowLeft: [-0.1, 0, 0], ArrowRight: [0.1, 0, 0], ArrowUp: [0, 0, 0.1], ArrowDown: [0, 0, -0.1], PageUp: [0, 0.1, 0], PageDown: [0, -0.1, 0] };
    if (k[e.key]) { e.preventDefault(); move(...k[e.key]); }
  });
  // twist: hold to raise or lower
  for (const b of qa<HTMLButtonElement>(".twist button")) {
    let timer = 0;
    const stop = () => clearInterval(timer);
    b.addEventListener("pointerdown", () => { const d = +b.dataset.h! * 0.08; move(0, d, 0); timer = window.setInterval(() => move(0, d, 0), 40); });
    b.addEventListener("pointerup", stop); b.addEventListener("pointerleave", stop); b.addEventListener("pointercancel", stop);
    b.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); move(0, +b.dataset.h! * 0.1, 0); } });
  }
  // the view itself: drag moves the slit (sideways and up/down), scroll focuses
  {
    const mmPerPx = () => hooks.fieldWidth() / view.clientWidth;
    let drag: { x: number; y: number } | null = null;
    view.addEventListener("pointerdown", e => {
      if ((e.target as HTMLElement).closest("button")) return;
      drag = { x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId);
    });
    view.addEventListener("pointermove", e => {
      if (!drag) return;
      const k = mmPerPx();
      move((e.clientX - drag.x) * k, -(e.clientY - drag.y) * k, 0);   // the slit follows the pointer
      drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { drag = null; };
    view.addEventListener("pointerup", end); view.addEventListener("pointercancel", end);
    view.addEventListener("wheel", e => { e.preventDefault(); move(0, 0, -Math.sign(e.deltaY) * 0.15); }, { passive: false });
  }

  // ---- filters and illumination ----
  q(".tiles").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (b) { L().filter = b.dataset.filter as Filter; change("filter", L().filter); }
  });
  q<HTMLInputElement>("#diffuser").onchange = e => { L().diffuser = (e.target as HTMLInputElement).checked; change("diffuser", L().diffuser); };
  q<HTMLInputElement>("#barrier").onchange = e => { L().barrier = (e.target as HTMLInputElement).checked; change("barrier", L().barrier); };
  q<HTMLInputElement>("#dilate").onchange = e => { const on = (e.target as HTMLInputElement).checked; hooks.setDilated(on); log("dilate", on); };

  q(".reset-lamp").addEventListener("click", () => { hooks.resetLamp(); sync(); log("reset", true); });

  // ---- knobs ----
  const knobs = [
    knob(q(".knobs"), { label: "Illumination Intensity", icon: "sun", min: 0, max: 100, step: 1, ends: ["0", "100"], show: v => `${fmt(v, 0)}%`,
      get: () => L().intensity / 5 * 100, set: v => { L().intensity = v / 100 * 5; change("intensity", +fmt(v, 0), 400); } }),
    knob(q(".knobs"), { label: "Background Light", icon: "sunDim", min: 0, max: 100, step: 1, ends: ["0", "100"], show: v => `${fmt(v, 0)}%`,
      get: () => L().background / 1.2 * 100, set: v => { L().background = v / 100 * 1.2; change("background", +fmt(v, 0), 400); } }),
    knob(q(".knobs"), { label: "Beam Rotation", icon: "target", min: -90, max: 90, step: 1, ends: ["-90", "+90"], top: "0", show: v => `${fmt(v, 0)}°`,
      get: () => L().rotation ?? 0, set: v => { L().rotation = v; change("rotation", v, 400); } }),
    knob(q(".knobs"), { label: "Beam Decentration", icon: "target", min: -DECENTRE_MAX, max: DECENTRE_MAX, step: 0.05, ends: [`-${DECENTRE_MAX}`, `+${DECENTRE_MAX}`], top: "0", show: v => `${fmt(v, 1)} mm`,
      get: decentre, set: v => { L().beamX += v - decentre(); L().decentre = v; change("decentration", +fmt(v, 2), 400); } }),
  ];

  // ---- patient conversation ----
  const msgs = q(".msgs");
  const say = (who: "You" | "Patient", text: string) => {
    const li = document.createElement("li");
    li.className = who === "You" ? "you" : "patient";
    li.innerHTML = `<span class="avatar">${svg("person")}</span><div><p class="meta"><b></b><time></time></p><p class="text"></p></div>`;
    li.querySelector("b")!.textContent = who; li.querySelector("time")!.textContent = time(); li.querySelector(".text")!.textContent = text;
    msgs.append(li); msgs.scrollTop = msgs.scrollHeight;
    log("say", text);
    return li.querySelector<HTMLElement>(".text")!;
  };
  const input = q<HTMLInputElement>(".type input");
  let muted = false, turn: AbortController | undefined;
  // What the trainee says goes to the voice patient: its sentences appear as they arrive and are spoken; a new
  // question cuts off the one before. The patient's eye actions play through the same code as the buttons.
  const ask = async (text: string) => {
    say("You", text);
    const link = hooks.patient?.();
    if (!link) { say("Patient", "(The patient is not ready yet. Try again in a moment.)"); return; }
    turn?.abort(); link.stopSpeaking();
    const mine = turn = new AbortController();
    const typing = say("Patient", "…");
    let first = true;
    try {
      for await (const ev of link.chat(text, mine.signal)) {
        if (ev.type === "say") {
          typing.textContent = first ? ev.text : `${typing.textContent} ${ev.text}`; first = false;
          if (!muted) link.speak(ev.text);
          msgs.scrollTop = msgs.scrollHeight;
        } else if (ev.type === "action") act(ev.action);
      }
      if (first) typing.textContent = "(no reply)";
    } catch (e) {
      if (mine.signal.aborted) return;
      typing.textContent = `(The patient could not answer: ${(e as Error).message})`;
    }
  };
  // the patient speaks first; if the trainee speaks before the history is ready, that turn takes over
  const greet = async () => {
    const link = hooks.patient?.();
    if (!link) return;
    const mine = turn = new AbortController(), line = say("Patient", "…");
    try {
      const hello = await link.greet(mine.signal);
      line.textContent = hello;
      if (!muted) link.speak(hello);
      msgs.scrollTop = msgs.scrollHeight;
    } catch {
      line.closest("li")?.remove();
    }
  };
  q<HTMLFormElement>(".type").onsubmit = e => { e.preventDefault(); const t = input.value.trim(); if (t) { input.value = ""; void ask(t); } };
  // Instructions: the patient looks, blinks or opens wide a moment after being asked, and holds a gaze or a wide
  // opening until asked again; asking for the held one again releases it.
  let held: string | null = null, wide = false, lidWide = false, lidNow = 0, lidAnim = 0;   // lidWide: the iris follows a lid raised for wide eyes, not for a gaze
  const lidRest = () => wide ? LID.wide : held === "up" ? LID.up : held === "down" ? LID.down : 0;
  /** Holds the gaze asked for, in the viewed eye's frame: the patient's left is lateral in a left eye. */
  const look = () => {
    const [side, up] = INSTRUCTIONS.find(x => x.id === held)?.look ?? [0, 0];
    hooks.setGaze(side * LOOK[0] * (viewed === "OS" ? 1 : -1), up * LOOK[1]);
  };
  const lidsTo = (to: number, ms: number) => new Promise<void>(done => {
    const from = lidNow, t0 = performance.now(), id = ++lidAnim;
    const step = (now: number) => {
      if (id !== lidAnim) return done();
      const t = Math.min(1, Math.max(0, (now - t0) / ms)), e = t * t * (3 - 2 * t);
      hooks.setLids(lidNow = from + (to - from) * e, lidWide ? 1 : 0);
      if (t < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  const respond = async (id: string, release: boolean) => {
    const i = INSTRUCTIONS.find(x => x.id === id)!;
    if (i.look) {
      held = release ? null : id;
      lidsTo(lidRest(), 120);
      look();
    } else if (id === "open") {
      wide = !release;
      lidWide = true;
      lidsTo(lidRest(), 220).then(() => { lidWide = wide; });
    } else if (id === "blink") {
      await lidsTo(LID.blink, BLINK_MS[0]);
      await new Promise(r => setTimeout(r, BLINK_MS[1]));
      await lidsTo(lidRest(), BLINK_MS[2]);
    }
    qa<HTMLButtonElement>("[data-say]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.say === held || (b.dataset.say === "open" && wide))));
  };
  // the patient also blinks on their own, but not while holding the eyes wide or while the lids are moving
  setInterval(() => { if (!wide && !document.hidden && lidNow === lidRest()) void respond("blink", false); }, BLINK_EVERY_MS);
  const act = (a: EyeAction) => {
    const look = { look_up: "up", look_down: "down", look_left: "left", look_right: "right" }[a as string];
    if (look) void respond(look, false);
    else if (a === "look_ahead" && held) void respond(held, true);
    else if (a === "blink") void respond("blink", false);
    else if (a === "open_wide" && !wide) void respond("open", false);
    else if (a === "relax" && wide) void respond("open", true);
  };
  qa<HTMLButtonElement>("[data-say]").forEach(b => b.onclick = () => {
    const i = INSTRUCTIONS.find(x => x.id === b.dataset.say)!;
    const release = i.id === held || (i.id === "open" && wide);
    say("You", release ? (i.look ? "Now look straight ahead, please." : "You can relax your eyes now.") : i.say);
    log("instruction", release ? `${i.id}:release` : i.id);
    setTimeout(() => respond(i.id, release), REACT_MS);
  });
  const mute = q(".mute");
  mute.onclick = () => {
    const on = mute.getAttribute("aria-pressed") !== "true";
    muted = on; if (on) hooks.patient?.()?.stopSpeaking();
    mute.setAttribute("aria-pressed", String(on));
    mute.querySelector("span")!.textContent = on ? "Unmute Patient" : "Mute Patient";
    mute.querySelector("svg")!.innerHTML = ICON[on ? "muted" : "speaker"];
    q(".spk svg").innerHTML = ICON[on ? "muted" : "speaker"];
  };
  q(".spk").onclick = () => mute.click();
  const stopListening = bindSpeech(q(".ptt"), q(".ptt-label"), ask, () => hooks.patient?.());

  // ---- reflect the lamp in every control ----
  function sync() {
    const s = L();
    qa<HTMLButtonElement>("[data-eye]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.eye === viewed)));
    qa<HTMLButtonElement>("[data-mag]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.mag! === s.magnification)));
    qa<HTMLButtonElement>("[data-filter]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.filter === s.filter)));
    const hi = HEIGHTS.reduce((best, h, i) => Math.abs(h - s.slitHeight) < Math.abs(HEIGHTS[best] - s.slitHeight) ? i : best, 0);
    height.value = String(hi); fill(height); q("#g-height output").textContent = `${fmt(s.slitHeight, s.slitHeight % 1 ? 1 : 0)} mm`;
    width.value = String(tOfWidth(s.slitWidth)); fill(width); q("#g-width output").textContent = `${fmt(s.slitWidth, s.slitWidth < 1 ? 2 : 1)} mm`;
    arm.value = String(s.angle); fill(arm); q("#g-arm output").textContent = s.angle ? `${Math.abs(s.angle)}° ${s.angle < 0 ? "R" : "L"}` : "0°";
    q("[data-r=x]").textContent = `${fmt(stickX(), 1)} mm`; q("[data-r=y]").textContent = `${fmt(s.beamY ?? 0, 1)} mm`; q("[data-r=f]").textContent = `${fmt(s.focus, 2)} mm`;
    q<HTMLInputElement>("#diffuser").checked = !!s.diffuser; q<HTMLInputElement>("#barrier").checked = !!s.barrier;
    knobs.forEach(k => k.sync());
    q(".hint").textContent = isFundus() ? "drag: move over the fundus · scroll: focus" : "drag: move the slit · scroll: focus";
    const msg = isFundus() ? ""
      : viewed !== patient.eye ? `Only the ${EYE_NAME[patient.eye].toLowerCase()} (${patient.eye}) is modelled in this case.`
      : lens !== "None" ? `${lens}: the view through this lens is not simulated yet.` : "";
    notice.textContent = msg; notice.hidden = !msg;
  }
  sync();
  return { sync, conversation: { panel: q(".chat"), greet, holdTalk: on => { qa(".talk, .type").forEach(el => { el.inert = on; }); } } };
}

/** Colours a range input's track up to its thumb. */
function fill(input: HTMLInputElement) {
  const t = (+input.value - +input.min) / (+input.max - +input.min);
  input.style.setProperty("--t", `${t * 100}%`);
}

interface KnobSpec {
  label: string; icon: keyof typeof ICON; min: number; max: number; step: number;
  ends: [string, string]; top?: string; show(v: number): string; get(): number; set(v: number): void;
}
const SWEEP = 135;   // degrees either side of top

/** A rotary knob: turn it by dragging round it (clockwise raises the value), scroll, or use the arrow keys. */
function knob(parent: HTMLElement, k: KnobSpec) {
  const el = document.createElement("div");
  el.className = "dial";
  el.innerHTML = `<h3>${svg(k.icon)}${k.label}</h3>
<div class="face" role="slider" tabindex="0" aria-label="${k.label}" aria-valuemin="${k.min}" aria-valuemax="${k.max}">
  <svg viewBox="0 0 100 100" aria-hidden="true" class="scale">${Array.from({ length: 28 }, (_, i) => {
    const a = (-SWEEP + i * 2 * SWEEP / 27) * Math.PI / 180;
    return `<line x1="${50 + 44 * Math.sin(a)}" y1="${50 - 44 * Math.cos(a)}" x2="${50 + 40 * Math.sin(a)}" y2="${50 - 40 * Math.cos(a)}"/>`;
  }).join("")}</svg>
  <div class="cap"><i></i></div>
  <span class="lim l">${k.ends[0]}</span><span class="lim r">${k.ends[1]}</span>${k.top ? `<span class="lim t">${k.top}</span>` : ""}
</div>
<output></output>
<input type="range" class="dial-slider" min="${k.min}" max="${k.max}" step="${k.step}" aria-label="${k.label}">`;
  parent.append(el);
  const face = el.querySelector<HTMLElement>(".face")!, cap = el.querySelector<HTMLElement>(".cap")!, out = el.querySelector("output")!, slider = el.querySelector<HTMLInputElement>(".dial-slider")!;
  const put = (v: number) => { k.set(clamp(Math.round(v / k.step) * k.step, k.min, k.max)); };
  // the pointer's bearing round the knob's centre, degrees clockwise from the top
  const bearing = (e: PointerEvent) => {
    const r = face.getBoundingClientRect();
    return Math.atan2(e.clientX - r.left - r.width / 2, r.top + r.height / 2 - e.clientY) * 180 / Math.PI;
  };
  slider.oninput = () => put(+slider.value);
  let drag: { a: number; v: number } | null = null;
  face.addEventListener("pointerdown", e => { drag = { a: bearing(e), v: k.get() }; face.setPointerCapture(e.pointerId); });
  face.addEventListener("pointermove", e => {
    if (!drag) return;
    const a = bearing(e), turn = ((a - drag.a + 540) % 360) - 180;   // the shortest way round, so crossing the bottom does not jump
    drag = { a, v: clamp(drag.v + turn / (2 * SWEEP) * (k.max - k.min), k.min, k.max) };
    put(drag.v);
  });
  face.addEventListener("pointerup", () => { drag = null; }); face.addEventListener("pointercancel", () => { drag = null; });
  face.addEventListener("wheel", e => { e.preventDefault(); put(k.get() - Math.sign(e.deltaY) * (k.max - k.min) / 50); }, { passive: false });
  face.addEventListener("keydown", e => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (d) { e.preventDefault(); put(k.get() + d * Math.max(k.step, (k.max - k.min) / 100)); }
    if (e.key === "Home") put(k.min); if (e.key === "End") put(k.max);
  });
  return {
    sync() {
      const v = k.get(), t = (v - k.min) / (k.max - k.min);
      cap.style.rotate = `${-SWEEP + t * 2 * SWEEP}deg`;
      out.textContent = k.show(v);
      slider.value = String(v); fill(slider);
      face.setAttribute("aria-valuenow", String(+fmt(v, 2))); face.setAttribute("aria-valuetext", k.show(v));
    }
  };
}

// Speech input. With a voice patient the microphone button turns hands-free listening on and off: each phrase is cut
// at a pause, transcribed by the server (Muse Voice Transcribe) and sent, and listening waits while the patient talks.
// Without a recording microphone the browser's own speech recognition is used, held like a push-to-talk button.
interface Recognition { lang: string; interimResults: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null }
const OFF_LABEL = "Tap to Talk", HANDS_FREE_ON = "Listening: just speak";
// Returns a function that closes the microphone for good when the conversation ends: what it was still hearing is dropped.
function bindSpeech(button: HTMLElement, label: HTMLElement, onText: (t: string) => void, link: () => PatientLink | undefined): () => void {
  const Ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition });
  const Rec = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition;
  const canRecord = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  if (!Rec && !canRecord) { button.setAttribute("disabled", ""); label.textContent = "Speech not supported here: type below"; return () => {}; }
  button.setAttribute("aria-label", canRecord ? "Turn hands-free listening on or off" : "Hold to speak");

  if (canRecord) {
    let session: Promise<{ stop(): void }> | null = null, queue: Promise<void> = Promise.resolve();
    const off = (text = OFF_LABEL) => { button.classList.remove("on"); button.setAttribute("aria-pressed", "false"); label.textContent = text; };
    const patientTalking = () => !!link()?.speaking;
    const listening = () => session !== null;
    // utterances are transcribed one at a time, so the questions reach the patient in the order they were asked
    const handle = (recording: Blob) => {
      queue = queue.then(async () => {
        const patient = link();
        if (!patient || !session) return;
        try {
          const text = (await patient.transcribe(recording)).trim();
          if (listening() && text) onText(text);
        } catch (e) { console.warn(e); }
      });
    };
    const toggle = async () => {
      if (session) { const s = session; session = null; (await s).stop(); off(); return; }
      if (!link()) { label.textContent = "Patient not ready yet"; return; }
      button.classList.add("on"); button.setAttribute("aria-pressed", "true"); label.textContent = HANDS_FREE_ON;
      const mine: Promise<{ stop(): void }> = session = listenHandsFree({
        onUtterance: handle, paused: patientTalking,
        onState: s => { if (session) label.textContent = s === "hearing" ? "Hearing you…" : HANDS_FREE_ON; }
      });
      mine.catch(() => { if (session === mine) session = null; off("Microphone blocked: type below"); });
    };
    off();
    button.addEventListener("click", () => void toggle());
    return () => { if (session) void toggle(); };
  }

  const idle = () => { button.classList.remove("on"); label.textContent = "Hold to Speak"; };
  let held = false, rec: Recognition | null = null, heard = "";
  idle();
  const start = () => {
    if (rec || !Rec) return;
    held = true;
    rec = new Rec(); rec.lang = "en-GB"; rec.interimResults = false; heard = "";
    rec.onresult = e => { heard = Array.from(e.results, r => r[0].transcript).join(" ").trim(); };
    rec.onend = () => { rec = null; idle(); if (heard) onText(heard); };
    try { rec.start(); button.classList.add("on"); label.textContent = "Listening…"; } catch { rec = null; }
  };
  const stop = () => { if (!held) return; held = false; rec?.stop(); };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", stop); button.addEventListener("pointerleave", stop); button.addEventListener("pointercancel", stop);
  button.addEventListener("keydown", e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); start(); } });
  button.addEventListener("keyup", e => { if (e.key === " " || e.key === "Enter") stop(); });
  return () => { if (rec) { rec.onresult = null; heard = ""; } stop(); };
}
