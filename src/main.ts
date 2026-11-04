// EyeSim app: the exam screen (src/ui/exam.ts) over the slit-lamp renderer; the instructor view inspects the metadata.
// URL parameters drive automated renders: ?case=ns4&view=optic_section_lens&bare&frames=48&lamp=beamX:2,slitHeight:14&lids=0.5
import { library } from "./model/library.browser.ts";
import { checkRules, resolveCase, type ResolvedEye } from "./model/resolve.ts";
import { eyeUniforms } from "./render/modules/index.ts";
import { EyeRenderer, SHADERS } from "./render/renderer.ts";
import { EXTERIOR, VIEWS, frame, fundusLensView, lampUniforms, settingsFor, type LampSettings, type ViewId } from "./exam/views.ts";
import { examLog, mountExam, type ExamScreen } from "./ui/exam.ts";
import vesselMapUrl from "../assets/conjunctiva/vessel-map.png?url";
import { useVesselImage } from "./render/vessels.ts";
import { buildRetinalVessels, VESSEL_HALF } from "./render/fundusVessels.ts";
import { DRAWN_SIDE, exteriorCamera, exteriorUniforms, slitSkinUniforms } from "./exam/exterior.ts";
import { playIntro } from "./intro.ts";
import { playLanding } from "./ui/landing.ts";
import { playLobby } from "./ui/lobby.ts";
import { playCasePrompt, type CaseRequest } from "./ui/casePrompt.ts";
import { PatientLink, openSession } from "./ui/patientLink.ts";
import { showPreparing } from "./ui/preparing.ts";
import { PROTOTYPE_TERMS, showCaseLabel } from "./ui/disclaimer.ts";
import { runCaseSheet } from "./ui/caseSheet.ts";
import { showReport } from "./ui/report.ts";
import type { Case } from "./model/generated.ts";
import type { Edit } from "./model/edits.ts";
import type { CaseOrigin } from "../server/session.ts";
import type { Comparison } from "../server/examiner.ts";

declare global {
  interface Window {
    __eyesim?: { frames: number; done: boolean; error?: string };
    /** An eye for a ?bare render that no stored case holds: the Case agent's edits, set by tools/lib/render-lib.ts. */
    __eyesimRemote?: { base: Case; edits: Edit[] };
  }
}

const qs = new URLSearchParams(location.search);
const bare = qs.has("bare");
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
if (bare) document.body.classList.add("bare");
const exam = mountExam();   // creates #view and #cv, which the renderer needs at once
let screen: ExamScreen | undefined;

// The app shows only the eye built in the realism layers (docs/realism); ?case= still opens any case for renders.
const APP_CASES = ["reference_black_brown"];
const cases = library.cases.filter(c => APP_CASES.includes(c.id) || c.id === qs.get("case"));
let caseId = cases.some(c => c.id === qs.get("case")) ? qs.get("case")! : APP_CASES[0];
let viewId = (qs.get("view") as ViewId) in VIEWS ? qs.get("view") as ViewId : "optic_section_cornea";
let exterior = qs.get("view") === EXTERIOR.id;
let dilated = qs.has("dilated");   // the trainee's dilating drop (exam conditions)
let gaze: [number, number] = (qs.get("gaze") ?? "0,0").split(",").map(Number) as [number, number];   // the patient's gaze (degrees, + lateral, + up), set by the trainee's instructions; ?gaze=h,v renders one
let lidCentre = qs.has("lids") ? 1 : 0;   // 1 while the eyes are held wide: the iris follows the lid to the middle of the opening
let lids = Number(qs.get("lids")) || 0;   // the upper lid's move: blink, open wide (uLidClose); ?lids=1 renders it closed
let crop: number[] | undefined;   // the photo's crop (mm), which bounds the field of view
let loading = true;    // textures (the vessel map, exterior) are loading: hold the accumulation until load() applies
let eye: ResolvedEye;
let lamp: LampSettings;
// The server's session: the case (a stored scenario, or the Case agent's edits over the healthy eye) and its voice patient
let remote: { id: string; base: Case; edits: Edit[] } | undefined = bare && window.__eyesimRemote ? { id: "0000", ...window.__eyesimRemote } : undefined;
let patient: PatientLink | undefined;
let caseOrigin: CaseOrigin | undefined;   // where the server's case came from, which the exam screen states
let bindable = false;   // the exam screen is bound once the session says whose eye it is (before the walk-in, which shares its conversation); ?bare binds nothing

let renderer: EyeRenderer | undefined;   // created in start(), at page load; undefined when WebGL is unavailable
let live = false;            // frames are drawn only once the intro has ended (see the flow below)
let examOver = false;        // the report is up: the exam's blinks and resizes no longer reach the renderer, which draws the report's pictures
let texturesReady: Promise<unknown> = Promise.resolve();   // the vessel map and the exterior photo (started in start())
window.__eyesim = { frames: 0, done: false };

/** The same patient without the disease, the agent's edits or the case's overrides: a healthy eye of the same age. */
const healthyCase = (kase: Case): Case => ({ ...kase, diseases: [], overrides: undefined });

/** Resolves the eye being examined; the lamp is kept unless `resetLamp`. The case describes the affected eye, and the
 *  other eye is that patient's healthy eye. A ?bare render always draws the case's own eye. */
function resolve() {
  const base = remote?.base ?? library.cases.find(c => c.id === caseId)!;
  const other = !bare && !!viewedEye && viewedEye !== base.subject.eye;
  const kase = other ? { ...healthyCase(base), subject: { ...base.subject, eye: viewedEye as "OD" | "OS" } } : base;
  // the patient's gaze and the dilating drop belong to this exam, not to the case: applied on top of it. Every exam starts
  // undilated and the trainee decides; a ?bare render (no trainee) shows the case's own exam conditions.
  const overrides = gaze[0] || gaze[1]
    ? { ...kase.overrides, "eye.globe": { ...kase.overrides?.["eye.globe"], "physiology.gaze_horizontal": gaze[0], "physiology.gaze_vertical": gaze[1] } }
    : kase.overrides;
  eye = resolveCase(library, { ...kase, overrides, exam_conditions: { ...kase.exam_conditions, dilated: bare ? dilated || !!kase.exam_conditions?.dilated : dilated } }, other ? [] : remote?.edits);
  eye.issues.push(...checkRules(eye, library.rules));
}

/** The metadata has no side (+x is temporal), so the other side is the same picture flipped. ?bare renders keep the drawn side. */
const mirrored = (side: string) => !bare && side !== DRAWN_SIDE;
/** The lamp stays where the trainee put it, in screen terms; in the flipped eye's own frame that is the opposite side. */
const lampOnEye = (s: LampSettings): LampSettings => mirrored(eye.case.subject.eye)
  ? { ...s, angle: -s.angle, beamX: -s.beamX, rotation: -(s.rotation ?? 0) }
  : s;

function load() {
  resolve();
  lamp = settingsFor(viewId, eye);
  // ?lamp=slitHeight:14,background:0.1 overrides the view's lamp settings (renders of a lamp setting)
  for (const kv of (qs.get("lamp") ?? "").split(",").filter(Boolean)) {
    const [k, v] = kv.split(":");
    if (k in lamp && typeof lamp[k as keyof LampSettings] === "number") (lamp[k as keyof LampSettings] as number) = Number(v);
  }
  apply();
  if (!bare) { if (screen) screen.sync(); else if (bindable) bindScreen(); renderPanels(); }
}

/** The program for the current view: ?layer= renders take the one with the debug layers. */
const fragment = () => fundusView || fundusLens ? SHADERS.fundus : exterior ? SHADERS.exterior : qs.has("layer") ? SHADERS.slitLampLayers : SHADERS.slitLamp;

// The fundus (docs/fundus). Choosing a fundus lens shows it through the lens; ?view=fundus renders it alone, framed like
// a wide-field photograph, and ?lens=90D renders the lens view. ?eye=OD|OS picks the side (default: the case's eye).
const fundusView = qs.get("view") === "fundus" && !qs.has("lens");
let fundusLens: string | null = qs.get("lens");
let viewedEye = qs.get("eye");
let lensOrigin: [number, number] | undefined;   // the joystick's position when the lens was chosen
let fundusVessels: { key: string; tex: ReturnType<typeof buildRetinalVessels> } | undefined;
let lensView: ReturnType<typeof fundusLensView> | undefined;

function applyFundus(r: EyeRenderer) {
  r.setFragment(SHADERS.fundus);
  // the gaze and the drop re-resolve the eye, but the vessels depend only on these
  const num = (id: string, ...props: string[]) => props.map(p => eye.num(id, p));
  const key = [...num("eye.retinal_vessels", "microstructure.branch_seed", "anatomy.vein_calibre", "anatomy.artery_calibre", "anatomy.arcade_separation"),
    ...num("eye.optic_disc", "anatomy.position_x", "anatomy.position_y", "anatomy.vertical_diameter", "anatomy.cup_decentration_x", "anatomy.cup_decentration_y"),
    ...num("eye.macula", "anatomy.foveola_diameter", "anatomy.diameter")].join();
  if (fundusVessels?.key !== key) { fundusVessels?.tex.dispose(); fundusVessels = { key, tex: buildRetinalVessels(eye) }; }
  const left = (viewedEye ?? eye.case.subject.eye) === "OS";
  const common = { ...eyeUniforms(eye), uVessels: fundusVessels.tex, uVesHalf: VESSEL_HALF, uLidClose: lids, uBloom: 0, uGrain: 0, uEye: 0, uMirror: 0 };   // the fundus shader handles its own side
  if (fundusLens) {
    lensOrigin ??= [lamp.beamX - (lamp.decentre ?? 0), lamp.beamY ?? 0];
    lensView = fundusLensView(lamp, eye, { lens: fundusLens, left, dilated: dilated || !!eye.case.exam_conditions?.dilated, aspect: aspect(), origin: lensOrigin });
    r.setUniforms({ ...common, ...lampUniforms(lamp, eye), ...lensView.uniforms }, lensView.camera);
  } else {
    // the photograph's centre is 1.4 mm nasal of the fovea
    const cam: [number, number] = [left ? -1.4 : 1.4, 0.2];
    r.setUniforms({ ...common, uFov: 25, uFieldR: 12, uLens: [left ? 1 : -1, 1, 1, 0], uFC: [0, 0, cam[0], cam[1]], uFN: [1, 1, 1], uBlurMM: 0 }, cam);
  }
}

const SHOT_SIZE = [720, 405], SHOT_PATIENCE = 5400;   // pixels; animation frames to wait with nothing drawn (a compile, a GPU reset), about 90 s
const SHOT_IRIS_MARGIN = 1.15;   // the report's field height over the iris diameter, so the whole iris fits with a small margin (framing, not anatomy)

/** The report's picture of this patient's eye in a standard view, or of a healthy eye of the same age: the disease, the
 *  agent's edits and the case's own overrides come off, and the lamp and exam conditions stay. The exam is over, so this borrows its renderer. */
async function drawForReport(view: Comparison["view"], healthy: boolean): Promise<string> {
  const r = renderer;
  if (!r || !remote) throw new Error("Nothing to draw with");
  const kase: Case = healthy ? healthyCase(remote.base) : remote.base;
  const e = resolveCase(library, kase, healthy ? [] : remote.edits);
  r.resize(SHOT_SIZE[0], SHOT_SIZE[1]);
  if (view === "fundus") {
    // the photograph of the fundus, on the case's own side, whatever the exam last showed
    eye = e; fundusLens = null; viewedEye = null; lids = 0;
    applyFundus(r);
  } else {
    const skin = await slitSkinUniforms(), settings = settingsFor(view, e), aspectRatio = SHOT_SIZE[0] / SHOT_SIZE[1];
    const f = frame(settings, aspectRatio, skin.uExtRect as number[], e.num("eye.iris", "anatomy.diameter") * SHOT_IRIS_MARGIN * aspectRatio);
    r.setFragment(SHADERS.slitLamp);
    r.setUniforms({ ...eyeUniforms(e), ...skin, ...lampUniforms(settings, e, f), uLidClose: 0, uLidCentre: 0, uMirror: mirrored(kase.subject.eye) ? 1 : 0 }, f.centre);
  }
  for (let idle = 0; !r.done && idle < SHOT_PATIENCE;) {
    await new Promise(requestAnimationFrame);
    if (!r.step()) idle++;
  }
  if (!r.done) throw new Error("The view could not be drawn");
  return $<HTMLCanvasElement>("cv").toDataURL("image/jpeg", 0.9);
}

function fail(e: unknown) {
  window.__eyesim = { frames: 0, done: true, error: (e as Error).message };
  console.error(e);
}

function apply() {
  loading = false;
  if (!renderer || examOver) return;   // no WebGL: the controls still work, nothing is drawn
  const r = renderer;
  try {
    if (fundusView || fundusLens) { applyFundus(r); window.__eyesim = { frames: 0, done: false }; return; }
    r.setFragment(fragment());
    if (exterior) {
      loading = true;
      const forEye = eye;
      exteriorUniforms().then(u => {
        if (!exterior || eye !== forEye) return;
        r.setUniforms({ ...eyeUniforms(eye), ...u, uExtShow: qs.has("eyeonly") ? 0 : 1, uMirror: 0 }, exteriorCamera());   // ?eyeonly: the eye layer alone
        loading = false;
      }).catch(fail);
    }
    else {
      // slit-lamp views: the layered eye behind the exterior photo, which the beam relights
      loading = true;
      const forEye = eye;
      slitSkinUniforms().then(u => {
        if (exterior || eye !== forEye) return;
        crop = bare ? undefined : u.uExtRect as number[];   // renders keep the standard field
        const f = field();
        r.setUniforms({ ...eyeUniforms(eye), ...u, ...lampUniforms(lampOnEye(lamp), eye, f), uLidClose: lids, uLidCentre: lidCentre, uLayer: Number(qs.get("layer")) || 0, uMirror: mirrored(eye.case.subject.eye) ? 1 : 0 }, f.centre);
        loading = false;
      }).catch(fail);
    }
    window.__eyesim = { frames: 0, done: false };
  } catch (e) { fail(e); }
}

// Each frame ray-marches every pixel, so a large view on a high-DPI screen can take long enough for the OS to reset
// the GPU, after which the browser turns WebGL off. The app caps the pixels it renders; the canvas is scaled up.
const MAX_PIXELS = 1.1e6;
let shownAspect = 0;
function resize() {
  if (examOver) return;
  const view = $("view"), w = view.clientWidth, h = view.clientHeight;
  const dpr = bare ? 1 : Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
  renderer!.resize(Math.round(w * dpr), Math.round(h * dpr));
  if (lamp && aspect() !== shownAspect) apply();   // the field of view follows the view's shape
}
/** The field shown: renders (?bare) keep the standard one, whatever the window. */
const field = () => frame(lamp, aspect(), crop);
/** The view's width / height. */
function aspect() {
  const view = $("view");
  return shownAspect = bare || !view.clientHeight ? 16 / 9 : view.clientWidth / view.clientHeight;
}

function loop() {
  const r = renderer!;
  const wait = $("wait");
  wait.hidden = r.ready && !loading;
  const say = r.lost ? "The graphics card was reset. Restoring the slit lamp…" : "Preparing the slit lamp… (slower the first time)";
  if (!wait.hidden && wait.textContent !== say) wait.textContent = say;
  if (live && !loading && r.step()) {
    window.__eyesim = { frames: r.frame, done: r.done };
  }
  requestAnimationFrame(loop);
}

// ---------------- UI ----------------
function bindScreen() {
  const kase = eye.case;
  screen = exam.bind({
    lamp: () => lamp,
    apply,
    resetLamp() { lamp = settingsFor(viewId, eye); lensOrigin = undefined; apply(); },
    setDilated(on) { dilated = on; resolve(); apply(); renderPanels(); },
    setGaze(h, v) { gaze = [h, v]; resolve(); apply(); renderPanels(); },
    setLids(f, centre = 0) { lids = f; lidCentre = centre; if (!examOver) renderer?.setUniforms({ uLidClose: f, uLidCentre: centre }, fundusLens && lensView ? lensView.camera : field().centre); },
    // through a lens the lamp moves over the lens's image, so the view follows the pointer at the image's scale
    fieldWidth: () => fundusLens && lensView ? lensView.fov * lensView.mag : field().width,
    setFundusLens(lens) {
      // moving over the fundus used the joystick: leaving the lens puts the slit back where it was
      if (!lens && lensOrigin) { lamp.beamX = lensOrigin[0] + (lamp.decentre ?? 0); lamp.beamY = lensOrigin[1]; lensOrigin = undefined; }
      fundusLens = lens;
      apply();
    },
    setEye(viewed) { viewedEye = viewed; resolve(); apply(); renderPanels(); },
    patient: () => patient,
    // End Examination: the case sheet, then the Examiner's report; "Start Another Case" begins again from the landing screen
    end() {
      runCaseSheet(sheet => {
        if (!patient) return Promise.reject(new Error("the server is not connected"));
        return patient.evaluate(sheet, examLog);
      }).then(report => {
        examOver = true; live = false;
        showReport(report, () => location.reload(), drawForReport);
      });
    }
  }, {
    age: kase.subject.age, sex: kase.subject.sex, eye: kase.subject.eye as "OD" | "OS",
    caseLabel: `Case ${String(remote ? parseInt(remote.id.slice(0, 4), 16) % 900 + 100 : cases.findIndex(c => c.id === caseId) + 1).padStart(3, "0")}`,
    validated: false   // no case carries a clinical sign-off yet (docs/architecture/parts/06-validation.md)
  });
}

function buildInstructor() {
  const sel = $<HTMLSelectElement>("case");
  for (const c of cases) sel.add(new Option(`${c.title} (${c.id})`, c.id, false, c.id === caseId));
  sel.onchange = () => { caseId = sel.value; load(); };
  $<HTMLSelectElement>("component").onchange = renderInspector;
}

function renderPanels() {
  const kase = eye.case;
  $("subject").textContent = `${kase.subject.eye} · ${kase.subject.age} y ${kase.subject.sex ?? ""} · ${kase.diseases.length ? kase.diseases.map(d => `${d.id.split(".").pop()} ${d.grade}`).join(", ") : "no disease"}`;
  const issues = eye.issues.filter(i => i.level !== "info");
  $("issues").innerHTML = issues.length
    ? issues.map(i => `<li class="${i.level}"><b>${i.level}</b> ${i.where}: ${i.message}</li>`).join("")
    : `<li class="ok">All anatomy rules pass.</li>`;
  const comp = $<HTMLSelectElement>("component");
  const keep = comp.value;
  comp.innerHTML = "";
  for (const id of eye.components.keys()) comp.add(new Option(id, id, false, id === (keep || "eye.lens.nucleus")));
  renderInspector();
}

function renderInspector() {
  const id = $<HTMLSelectElement>("component").value;
  const c = eye.components.get(id)!;
  $("summary").textContent = c.summary;
  const rows: string[] = [];
  for (const facet of ["anatomy", "optics", "appearance", "microstructure", "physiology"] as const) {
    for (const [prop, raw] of Object.entries((c[facet] ?? {}) as Record<string, unknown>)) {
      const path = `${facet}.${prop}`;
      let shown: string;
      try {
        const v = eye.value(id, path);
        const unit = (raw as { unit?: string }).unit ?? "";
        shown = Array.isArray(v) ? `[${v.map(x => x.toFixed(2)).join(", ")}]` : typeof v === "number" ? `${Math.round(v * 1000) / 1000} ${unit}` : String(v);
      } catch { shown = "generator"; }
      const by = eye.changed.get(`${id}:${path}`);
      rows.push(`<tr${by ? ` class="changed" title="Set by ${by}"` : ""}><td>${path}</td><td>${shown}</td></tr>`);
    }
  }
  $("props").innerHTML = rows.join("");
}

if (!bare) buildInstructor();
// Landing -> lobby -> the walk-in scene, which plays over the app until the trainee presses Start Simulation.
// ?bare renders and ?intro=0 skip the whole flow. The simulator loads at once, behind the flow: the shader compiles in the
// background and the textures load while the trainee is on the first screens. It draws no frames until the flow ends
// (live), because running the ray-march shader under the videos can stall or reset the GPU.
// The landing (logo screen) comes first, then the lobby (choose a mode); ?bare and ?landing=0 skip both.
// "Create a Patient Case" opens the prompt screen (nurse clip + form); "Assign Me a Patient" goes straight to the walk-in.
// The prompt text is captured but not used yet: the case agent is built later (docs/architecture/parts/05-ui-ux.md).
const skipFlow = bare || qs.get("intro") === "0";
const skipLanding = bare || qs.get("landing") === "0";
start();

/** The lobby, then the prompt screen when asked for; "Back to Hospital" returns to the lobby. */
async function chooseCase(): Promise<CaseRequest | undefined> {
  for (;;) {
    if (await playLobby() === "random") return undefined;
    const request = await playCasePrompt();
    if (request) return request;
  }
}

/** The scenarios "Assign Me a Patient" draws from, until the random case generator is built (part 2, task 10). */
const RANDOM_CASES = ["aacg", "ns2", "ns4"];

/** Opens the session on the server: the Case agent from the typed prompt, or a stored scenario. Without a server the app
 *  runs on its own, with no patient. Resolves true when the patient is ready. */
async function openPatient(request: CaseRequest | undefined): Promise<boolean> {
  try {
    const id = await openSession(request ? { prompt: request.prompt, vision: request.vision, sex: request.sex, age: request.age } : { caseId: caseId });
    const data = await (await fetch(`/api/sessions/${id}/eye`)).json();
    remote = { id, base: data.base, edits: data.edits };
    caseOrigin = data.origin;
    patient = new PatientLink(id, { age: data.subject.age, sex: data.subject.sex });
    return true;
  } catch (e) {
    console.warn("No voice patient:", e);
    return false;
  }
}

(async () => {
  let request: CaseRequest | undefined;
  if (!skipLanding) { await playLanding(); request = await chooseCase(); }
  if (!request && !bare && !qs.has("case")) caseId = RANDOM_CASES[Math.floor(Math.random() * RANDOM_CASES.length)];
  // The loading screen stays up until the patient, the textures and the eye shader are all ready; the walk-in video
  // starts only then, so the patient can speak and the eye draws the moment the exam screen appears.
  if (!bare) {
    await showPreparing(request ? "Preparing your patient…" : "Assigning you a patient…",
      request ? "Building the eye from your description. This can take up to a minute." : "Just a moment.", [
        [request ? "Building the patient from your description" : "Choosing a patient", openPatient(request)],
        ["Loading the eye's textures", texturesReady],
        ["Preparing the slit lamp", renderer ? renderer.whenReady() : Promise.resolve(false)]
      ], skipFlow ? undefined : PROTOTYPE_TERMS);
  }
  bindable = true;
  load();
  if (!skipFlow) {
    const subject = library.cases.find(c => c.id === caseId)!.subject;
    await playIntro(request ? { ...subject, sex: request.sex, age: request.age } : subject, screen!.conversation);
  }
  live = true;
  showCaseLabel(caseOrigin);
})();

function start() {
  try {
    renderer = new EyeRenderer($("cv"), Number(qs.get("frames")) || 64, fragment());
  } catch (e) {
    fail(e);
    $("wait").textContent = "WebGL is not available. The browser may have turned off the GPU after a crash: restart the browser, or check that hardware acceleration is on.";
    $("wait").hidden = false;
    load();   // the eye and the controls still load, so the screen is usable
    return;
  }
  // the refined vessel map (assets/conjunctiva); ?vessels=generated uses the generated network instead
  const vessels = qs.get("vessels") === "generated" ? Promise.resolve() : useVesselImage(vesselMapUrl);
  vessels.catch(console.warn).then(load);
  texturesReady = Promise.all([vessels, slitSkinUniforms()]);
  new ResizeObserver(resize).observe($("view"));
  resize();
  requestAnimationFrame(loop);
}
