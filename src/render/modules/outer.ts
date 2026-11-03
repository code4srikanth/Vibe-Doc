import { genParam, type RenderModule, type Uniforms } from "./module.ts";
import { vesselRect, vesselTexture } from "../vessels.ts";

// Conjunctiva (realism layer L3): vessels baked in globe-surface coordinates (sphere plus fornix fillet), one blood
// absorber for the vessels and the wash (basal, toward the fornices, along the lower lid), mottle, the plica crescent,
// the medial recess and the medial folds. Shared by the external view and the slit-lamp views.
export const conjunctiva: RenderModule = {
  type: "Conjunctiva",
  consumes: ["appearance.injection", "appearance.ciliary_flush", "appearance.ciliary_flush_width","appearance.mottle", "appearance.mottle_scale", "appearance.vessel_colour",
    "appearance.deep_vessel_colour", "appearance.vessel_vis_limbal", "appearance.vessel_vis_mid", "appearance.vessel_vis_peripheral", "appearance.vessel_vis_canthal_nasal", "appearance.vessel_vis_canthal_temporal", "appearance.vessel_vis_mid_at", "appearance.vessel_vis_peripheral_at", "appearance.vessel_gain", "appearance.vessel_fade", "appearance.vessel_fade_scale", "appearance.deep_vessel_opacity", "appearance.deep_vessel_blur", "appearance.capillary_opacity", "appearance.capillary_scale", "appearance.venule_colour", "appearance.basal_vascularity", "appearance.fornix_vascularity", "appearance.margin_vascularity",
    "appearance.injection_blush_gain", "appearance.injection_ramp_width", "appearance.injection_limbal_fraction", "appearance.plica_colour", "appearance.plica_gloss", "appearance.plica_texture", "appearance.plica_texture_scale", "appearance.plica_opacity", "appearance.fornix_occlusion",
    "anatomy.fornix_fillet_width", "anatomy.fornix_blush_width", "anatomy.margin_blush_width", "anatomy.plica_width", "anatomy.plica_height",
    "anatomy.plica_offset", "anatomy.plica_length", "anatomy.plica_centre_height", "anatomy.plica_curvature", "anatomy.plica_tilt", "anatomy.vessel_limbal_reach", "anatomy.vessel_reach_blend", "appearance.plica_edge_softness",
    "appearance.plica_foot_shadow", "appearance.plica_shadow_width", "appearance.recess_vascularity", "appearance.recess_occlusion",
    "appearance.recess_contact_shadow", "appearance.recess_contact_width", "microstructure.vessels", "microstructure.medial_folds"],
  uniforms: (eye, id) => {
    const v = (name: string) => genParam(eye, id, "microstructure.vessels", name);
    const f = (name: string) => genParam(eye, id, "microstructure.medial_folds", name);
    const geometry = {
      scleraR: eye.num("eye.sclera", "anatomy.radius"),
      filletW: eye.num(id, "anatomy.fornix_fillet_width"),
      limbusR: eye.num("eye.cornea", "anatomy.diameter") / 2,
      medialX: eye.num("eye.adnexa.palpebral_fissure", "anatomy.medial_canthus_x"),
      lateralX: eye.num("eye.adnexa.palpebral_fissure", "anatomy.lateral_canthus_x")
    };
    const tex = vesselTexture({
      seed: v("seed"), density: v("density"), width: v("width"), nasal_bias: v("nasal_bias"), branch_depth: v("branch_depth"),
      taper: v("taper"), tortuosity: v("tortuosity"), limbal_clear_zone: v("limbal_clear_zone"), deep_fraction: v("deep_fraction"),
      dilation: v("dilation"), mesh_width: v("mesh_width"), mesh_cell: v("mesh_cell"), anastomosis: v("anastomosis"),
      kink_length: v("kink_length"), kink_angle: v("kink_angle"), min_calibre: v("min_calibre"), thick_vessel_width: v("thick_vessel_width"), injection: eye.num(id, "appearance.injection")
    }, geometry);
    const [rx, ry, rw, rh] = vesselRect(geometry);
    return {
      uConjMottle: eye.num(id, "appearance.mottle"),
      uConjMottleL: eye.num(id, "appearance.mottle_scale"),
      uInj: eye.num(id, "appearance.injection"),
      uInjBlush: eye.num(id, "appearance.injection_blush_gain"),
      uInjRamp: eye.num(id, "appearance.injection_ramp_width"),
      uInjLimb: eye.num(id, "appearance.injection_limbal_fraction"),
      uVesReach: eye.num(id, "anatomy.vessel_limbal_reach"),
      uVesBlend: eye.num(id, "anatomy.vessel_reach_blend"),
      uFlush: eye.num(id, "appearance.ciliary_flush"),
      uFlushW: eye.num(id, "appearance.ciliary_flush_width"),
      uVesCol: eye.vec(id, "appearance.vessel_colour"),
      uVesDeepCol: eye.vec(id, "appearance.deep_vessel_colour"),
      uVesVis: [eye.num(id, "appearance.vessel_vis_limbal"), eye.num(id, "appearance.vessel_vis_mid"), eye.num(id, "appearance.vessel_vis_peripheral"), eye.num(id, "appearance.vessel_gain")],
      uVesAt: [eye.num(id, "appearance.vessel_vis_mid_at"), eye.num(id, "appearance.vessel_vis_peripheral_at"), eye.num(id, "appearance.vessel_vis_canthal_nasal"), eye.num(id, "appearance.vessel_vis_canthal_temporal")],
      uVesFade: eye.num(id, "appearance.vessel_fade"),
      uVesFadeL: eye.num(id, "appearance.vessel_fade_scale"),
      uVesDeepOp: eye.num(id, "appearance.deep_vessel_opacity"),
      uVesDeepBlur: eye.num(id, "appearance.deep_vessel_blur"),
      uCapOp: eye.num(id, "appearance.capillary_opacity"),
      uCapL: eye.num(id, "appearance.capillary_scale"),
      uVenCol: eye.vec(id, "appearance.venule_colour"),
      uVesTex: tex,
      uVesRect: [rx, ry, rw, rh],
      uBasalVasc: eye.num(id, "appearance.basal_vascularity"),
      uFornixVasc: eye.num(id, "appearance.fornix_vascularity"),
      uMarginVasc: eye.num(id, "appearance.margin_vascularity"),
      uFornixBlushW: eye.num(id, "anatomy.fornix_blush_width"),
      uMarginBlushW: eye.num(id, "anatomy.margin_blush_width"),
      uPlicaCol: eye.vec(id, "appearance.plica_colour"),
      uPlicaTex: eye.num(id, "appearance.plica_texture"),
      uPlicaTexL: eye.num(id, "appearance.plica_texture_scale"),
      uPlicaOpac: eye.num(id, "appearance.plica_opacity"),
      uPlicaGloss: eye.num(id, "appearance.plica_gloss"),
      uPlicaW: eye.num(id, "anatomy.plica_width"),
      uPlicaH: eye.num(id, "anatomy.plica_height"),
      uPlicaOff: eye.num(id, "anatomy.plica_offset"),
      uPlicaL: eye.num(id, "anatomy.plica_length"),
      uPlicaYc: eye.num(id, "anatomy.plica_centre_height"),
      uPlicaCurv: eye.num(id, "anatomy.plica_curvature"),
      uPlicaTilt: Math.tan(eye.num(id, "anatomy.plica_tilt") * Math.PI / 180),
      uPlicaSoft: eye.num(id, "appearance.plica_edge_softness"),
      uPlicaFoot: eye.num(id, "appearance.plica_foot_shadow"),
      uPlicaShadowW: eye.num(id, "appearance.plica_shadow_width"),
      // medial recess (lacus) between the plica and the caruncle
      uRecessVasc: eye.num(id, "appearance.recess_vascularity"),
      uRecessOcc: eye.num(id, "appearance.recess_occlusion"),
      uRecessContact: eye.num(id, "appearance.recess_contact_shadow"),
      uRecessContactW: eye.num(id, "appearance.recess_contact_width"),
      uFoldN: Math.round(f("count")), uFoldSp: f("spacing"), uFoldDepth: f("depth"), uFoldLen: f("length"), uFoldSeed: f("seed") % 97,
      // fornix fillet: the concave skirt around the globe silhouette that closes the canthal ends of the opening
      uFilletW: eye.num(id, "anatomy.fornix_fillet_width"),
      uFornixOcc: eye.num(id, "appearance.fornix_occlusion")
    };
  }
};

export const sclera: RenderModule = {
  type: "Sclera",
  consumes: ["anatomy.radius", "anatomy.limbal_zone_width", "anatomy.overlap_superior", "anatomy.overlap_inferior",
    "anatomy.translucent_width_horizontal", "anatomy.translucent_width_vertical", "appearance.base_colour", "appearance.yellowing"],
  uniforms: (eye, id) => {
    // Place the scleral sphere so it meets the cornea exactly at the limbus.
    const r1 = eye.num("eye.cornea", "anatomy.anterior_radius");
    const rl = eye.num("eye.cornea", "anatomy.diameter") / 2;
    const rs = eye.num(id, "anatomy.radius");
    const zLimbus = -r1 + Math.sqrt(r1 * r1 - rl * rl);
    return {
      uScR: rs,
      uScZ: zLimbus - Math.sqrt(rs * rs - rl * rl),
      uLimbZone: eye.num(id, "anatomy.limbal_zone_width"),
      // limbal cover (L5): the sclera's overlap of the cornea above and below, and the translucent band's
      // 10-90% width at 3/9 and 12/6 o'clock
      uOvSup: eye.num(id, "anatomy.overlap_superior"),
      uOvInf: eye.num(id, "anatomy.overlap_inferior"),
      uLimbWH: eye.num(id, "anatomy.translucent_width_horizontal"),
      uLimbWV: eye.num(id, "anatomy.translucent_width_vertical"),
      uScBase: eye.vec(id, "appearance.base_colour"),
      uScYellow: eye.num(id, "appearance.yellowing")
    };
  }
};

// The exterior photo (realism layer L1) is the lids, lashes and skin in every view. Of their metadata the renderer
// reads the upper lid's margin depth, the occluder that casts the lid shadow on the globe, and each lid's swelling,
// which warps the photo near that margin toward the eye; the lid shape is checked against the photo trace by
// tools/validate.ts.
export const eyelid: RenderModule = {
  type: "Eyelid",
  consumes: ["anatomy.margin_depth", "anatomy.swelling"],
  uniforms: (eye, id): Uniforms => id === "eye.adnexa.upper_lid"
    ? { uLidDepth: eye.num(id, "anatomy.margin_depth"), uSwellU: eye.num(id, "anatomy.swelling") }
    : { uSwellL: eye.num(id, "anatomy.swelling") }
};

export const lashes: RenderModule = { type: "Lashes", consumes: [], uniforms: () => ({}) };

// Swollen lid skin reddens: a blood absorber (the conjunctiva's blood spectrum) proportional to the local swelling.
export const skin: RenderModule = {
  type: "Skin",
  consumes: ["appearance.oedema_blood"],
  uniforms: (eye, id) => ({ uSwellBlood: eye.num(id, "appearance.oedema_blood") })
};

// Gaze turns the globe under the fixed lids: uGaze is its forward axis in the image (+x toward the lateral canthus
// of this eye, wherever that lies on screen, +y up).
export const globe: RenderModule = {
  type: "Globe",
  consumes: ["physiology.gaze_horizontal", "physiology.gaze_vertical"],
  uniforms: (eye, id) => {
    const fissure = "eye.adnexa.palpebral_fissure", d = Math.PI / 180;
    const lateral = Math.sign(eye.num(fissure, "anatomy.lateral_canthus_x") - eye.num(fissure, "anatomy.medial_canthus_x"));
    const h = eye.num(id, "physiology.gaze_horizontal") * d, v = eye.num(id, "physiology.gaze_vertical") * d;
    return { uGaze: [lateral * Math.sin(h) * Math.cos(v), Math.sin(v), Math.cos(h) * Math.cos(v)] };
  }
};

export const fissure: RenderModule = {
  type: "Fissure",
  consumes: ["anatomy.medial_canthus_x", "anatomy.medial_canthus_y", "anatomy.lateral_canthus_x", "anatomy.lateral_canthus_y"],
  uniforms: (eye, id) => ({
    uCanMX: eye.num(id, "anatomy.medial_canthus_x"),
    uCanMY: eye.num(id, "anatomy.medial_canthus_y"),
    uCanLX: eye.num(id, "anatomy.lateral_canthus_x"),
    uCanLY: eye.num(id, "anatomy.lateral_canthus_y")
  })
};

export const caruncle: RenderModule = {
  type: "Caruncle",
  consumes: ["anatomy.size"],
  uniforms: (eye, id) => ({ uCarSize: eye.num(id, "anatomy.size") })
};
