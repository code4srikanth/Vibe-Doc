import type { RenderModule } from "./module.ts";

// Tear film (realism layer L5): the wet optical front surface. Its reflectance makes the corneal reflex
// (Purkinje I) and the lid-margin menisci are concave fluid fillets whose glint and refraction the external
// view draws along the opening's edges. The 2.1% reflectance also replaces the slit view's fixed tear Fresnel.
export const tearFilm: RenderModule = {
  type: "TearFilm",
  consumes: ["anatomy.lower_meniscus_height", "anatomy.upper_meniscus_height", "anatomy.meniscus_taper", "anatomy.lower_meniscus_radius",
    "anatomy.upper_meniscus_radius", "anatomy.irregularity_scale", "optics.refractive_index", "optics.normal_reflectance", "optics.surface_irregularity",
    "optics.discharge", "anatomy.discharge_band_width", "appearance.discharge_albedo"],
  uniforms: (eye, id) => ({
    uTearN: eye.num(id, "optics.refractive_index"),
    uTearF0: eye.num(id, "optics.normal_reflectance"),
    uTMH: eye.num(id, "anatomy.lower_meniscus_height"),
    uTMHU: eye.num(id, "anatomy.upper_meniscus_height"),
    uTMR: eye.num(id, "anatomy.lower_meniscus_radius"),
    uTMRU: eye.num(id, "anatomy.upper_meniscus_radius"),
    uTMTaper: eye.num(id, "anatomy.meniscus_taper"),
    uTearIrr: eye.num(id, "optics.surface_irregularity"),
    uTearIrrL: eye.num(id, "anatomy.irregularity_scale"),
    uDis: eye.num(id, "optics.discharge"),
    uDisW: eye.num(id, "anatomy.discharge_band_width"),
    uDisAlb: eye.vec(id, "appearance.discharge_albedo")
  })
};
