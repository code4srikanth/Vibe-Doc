// Slit-lamp settings for each standard view. These are exam technique, not anatomy,
// so they live in code rather than eye-model metadata.
import type { ResolvedEye } from "../model/resolve.ts";
import type { UniformValue } from "../render/modules/module.ts";

export type ViewId = "diffuse" | "optic_section_cornea" | "optic_section_lens" | "retroillumination";
export type Filter = "white" | "cobalt" | "redfree" | "grey";

export interface LampSettings {
  slitWidth: number;   // mm
  slitHeight: number;  // mm
  angle: number;       // degrees, negative = arm on the patient's right
  beamX: number;       // mm, beam position relative to the visual axis (null-like NaN = auto)
  intensity: number;
  background: number;  // diffuse background illumination 0-1.2
  focus: number;       // mm from the corneal apex, negative = deeper
  magnification: 6 | 10 | 16 | 25 | 40;
  filter: Filter;
  eyepiece: boolean;
  beamY?: number;      // mm, beam centre above the visual axis (the joystick's height)
  rotation?: number;   // degrees, slit rotated about the beam axis, + clockwise as the examiner sees it, 0 = vertical
  diffuser?: boolean;  // frosted screen in front of the beam
  barrier?: boolean;   // yellow barrier filter on the viewing side
  decentre?: number;   // mm, the beam's offset from the joystick's position (included in beamX)
}

export const VIEWS: Record<ViewId, { label: string; settings: Omit<LampSettings, "filter" | "eyepiece"> }> = {
  diffuse: { label: "Diffuse", settings: { slitWidth: 14, slitHeight: 14, angle: -30, beamX: 0, intensity: 0.3, background: 0.8, focus: -1.0, magnification: 6 } },
  optic_section_cornea: { label: "Optic section · cornea", settings: { slitWidth: 0.5, slitHeight: 8, angle: -33, beamX: -0.9, intensity: 3.2, background: 0.84, focus: -0.3, magnification: 6 } },
  optic_section_lens: { label: "Optic section · lens", settings: { slitWidth: 0.12, slitHeight: 9, angle: -35, beamX: 0, intensity: 3.6, background: 0.1, focus: -5.2, magnification: 16 } },
  retroillumination: { label: "Retroillumination", settings: { slitWidth: 1.0, slitHeight: 3, angle: -2, beamX: NaN, intensity: 2.2, background: 0.06, focus: -4.2, magnification: 10 } }
};

const FILTERS: Record<Filter, [number, number, number]> = { white: [1, 0.86, 0.64], cobalt: [0.12, 0.26, 1.2], redfree: [0.25, 1, 0.35], grey: [0.3, 0.26, 0.19] };
// Yellow barrier (Wratten 12 type): blocks blue. Nothing in the eye fluoresces yet, so it is applied to the beam's colour,
// which looks the same for light that is only scattered.
const BARRIER: [number, number, number] = [1, 0.92, 0.04];
// The diffuser spreads the beam into a broad, soft, dimmer field.
const DIFFUSED = { size: 16, intensity: 0.35 };
const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export function settingsFor(view: ViewId, eye: ResolvedEye): LampSettings {
  const s = { ...VIEWS[view].settings, filter: "white" as Filter, eyepiece: false };
  // Retroillumination: put the beam just inside the (decentred) pupil margin.
  if (Number.isNaN(s.beamX)) s.beamX = Math.round((eye.num("eye.pupil", "anatomy.decentration_x") + eye.num("eye.pupil", "anatomy.diameter") / 2 * 0.8) * 100) / 100;
  return s;
}

/** The view's aspect ratio that the field of view is quoted for. Every view keeps that field's height (a wider one shows
 *  more at the sides, a narrower one less), so the eye fills the view. */
const FIELD_ASPECT = 16 / 9;
export interface Frame { width: number; centre: [number, number] }
/** The field (width in mm, centre) at this magnification, for a view of this aspect ratio (width / height). With the
 *  photo's crop ([left, top, width, height], mm), the lowest magnification frames the whole photo; a higher one is
 *  narrowed if it is larger than the photo, and its centre is slid inside it, so the photo's clamped edge never shows. */
export function frame(s: LampSettings, aspect = FIELD_ASPECT, crop?: number[]): Frame {
  let width = 160 / s.magnification * aspect / FIELD_ASPECT, [x, y] = cameraCentre(s);
  if (crop) {
    const [x0, y0, cw, ch] = crop;
    width = s.magnification <= 6 ? Math.min(cw, ch * aspect) : Math.min(width, cw, ch * aspect);
    const hw = width / 2, hh = width / aspect / 2;
    x = Math.min(Math.max(x, x0 + hw), x0 + cw - hw);
    y = Math.min(Math.max(y, y0 - ch + hh), y0 - hh);
  }
  return { width, centre: [x, y] };
}

/** Handheld fundus lenses (docs/fundus): the fundus image's size over the real fundus. */
export const FUNDUS_LENSES: Record<string, { magnification: number }> = {
  "60D": { magnification: 1.15 }, "78D": { magnification: 0.93 }, "90D": { magnification: 0.76 }
};
// Render calibration: mm of retina seen (radius) per mm of pupil diameter; where the lamp focuses the lens's image, and
// the blur (mm on the fundus) per mm away from it.
const PUPIL_FIELD = 1.4, LENS_FOCUS = -1.5, BLUR_PER_MM = 0.35;

export interface FundusOptions {
  lens: string; left: boolean; dilated: boolean; aspect: number;
  /** The joystick's position when the lens was chosen: the view starts on the posterior pole. */
  origin: [number, number];
}
/** The fundus through a handheld lens: a real, inverted image, its field set by the pupil, looked at with the lamp. */
export function fundusLensView(s: LampSettings, eye: ResolvedEye, o: FundusOptions) {
  const mag = FUNDUS_LENSES[o.lens].magnification, P = "eye.pupil", d = Math.PI / 180;
  const pupil = Math.max(eye.num(P, "anatomy.diameter"), o.dilated ? eye.num(P, "anatomy.dilated_diameter") : 0);
  const R = eye.num("eye.sclera", "anatomy.radius"), D = "eye.optic_disc", G = "eye.globe";
  const decentre = s.decentre ?? 0;
  // the lamp moves over the image, 1:1 in the image's plane; the patient's gaze brings another part of the fundus to the pole
  const pan: [number, number] = [(s.beamX - decentre - o.origin[0]) / mag, ((s.beamY ?? 0) - o.origin[1]) / mag];
  const centre = [eye.num(D, "anatomy.position_x") / 2 + R * eye.num(G, "physiology.gaze_horizontal") * d,
    eye.num(D, "anatomy.position_y") / 2 + R * eye.num(G, "physiology.gaze_vertical") * d];
  // relative to white, and squared: the fundus reflects so little but red that a filter's leak of red would otherwise
  // outweigh the colour it passes (red-free must look green, with dark vessels)
  const filt = FILTERS[s.filter].map((c, i) => ((s.barrier ? c * BARRIER[i] : c) / FILTERS.white[i]) ** 2) as [number, number, number];
  const fov = frame(s, o.aspect).width / mag;
  return {
    camera: pan, fov, mag,
    uniforms: {
      uFov: fov, uFieldR: PUPIL_FIELD * pupil,
      uLens: [o.left ? -1 : 1, -1, mag, 1] as [number, number, number, number],   // inverted: temporal on the screen's right in a right eye
      uFC: [centre[0], centre[1], 0, 0] as [number, number, number, number],
      uFN: filt, uBlurMM: Math.abs(s.focus - LENS_FOCUS) * BLUR_PER_MM, uDec: decentre / mag
    } as Record<string, UniformValue>
  };
}

export function lampUniforms(s: LampSettings, eye: ResolvedEye, field = frame(s)): Record<string, UniformValue> {
  const rp = eye.num("eye.pupil", "anatomy.diameter") / 2, dx = eye.num("eye.pupil", "anatomy.decentration_x");
  const filt = FILTERS[s.filter].map((c, i) => s.barrier ? c * BARRIER[i] : c) as [number, number, number];
  const bw = s.diffuser ? DIFFUSED.size : s.slitWidth, bh = s.diffuser ? DIFFUSED.size : s.slitHeight;
  return {
    uExterior: 0, uGrain: 1,
    uFov: field.width,
    uAng: s.angle * Math.PI / 180,
    uBW: bw, uBH: bh, uBX: s.beamX, uBY: s.beamY ?? 0, uBR: -(s.rotation ?? 0) * Math.PI / 180,
    uBI: s.diffuser ? s.intensity * DIFFUSED.intensity : s.intensity, uAmb: s.background, uFocus: s.focus,
    uAper: s.magnification <= 6 ? 0.3 : 0.7,
    uEye: s.eyepiece ? 1 : 0,
    uFilt: filt,
    // A near-coaxial beam entering the pupil lights the fundus and gives the red reflex.
    uRetro: sstep(9, 2, Math.abs(s.angle)) * sstep(rp + 0.6, rp - 0.2, Math.abs(s.beamX - dx)) * Math.min(1, bw * bh / 2.5)
  };
}

/**
 * External view built in realism layers (docs/realism): the eye ray-marched behind the relit exterior
 * photo (L1). Framing and the lamp grade come from assets/exterior/fissure.json (src/exam/exterior.ts);
 * these are the diffuser's settings that the photo does not fix.
 */
export const EXTERIOR = {
  id: "exterior",
  label: "External (slit lamp, diffuse)",
  // The lamp the wet surfaces mirror (corneal reflex, lens reflexes, meniscus glints): degrees, + azimuth = arm on
  // the temporal side; reflexSize is the half-size of the diffuser seen from the eye, radians. The diffuser's full
  // glow (diffuserHalfAngle) only sets the lid penumbra; reflected, it would give a reflex several mm wide instead
  // of the small bright patch of a real lamp.
  lamp: { azimuth: 25, elevation: 12, reflexSize: 0.055 },
  diffuserHalfAngle: 27,                   // degrees: half-angle of the diffuser seen from the eye; sets the lid penumbra
  shadowAtMargin: 0.45,                    // fraction of the diffuser's light reaching the globe right at the upper-lid margin
  // n.v of the mid temporal sclera where eye.sclera base_colour was sampled from the photo: that colour already
  // carries the diffuser's (1 + n.v)/2 shading there, so the true albedo is base_colour / ((1 + albedoSampleNv)/2)
  albedoSampleNv: 0.7
};

/** Camera centre in eye coordinates: framed like a photograph at low power, centred on the pupil at high power. */
export const cameraCentre = (s: LampSettings): [number, number] => s.magnification <= 6 ? [-0.55, 1.4] : [0, 0];
