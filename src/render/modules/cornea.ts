import type { RenderModule, Uniforms } from "./module.ts";

export const cornea: RenderModule = {
  type: "Cornea",
  consumes: ["anatomy.anterior_radius", "anatomy.anterior_asphericity", "anatomy.posterior_radius", "anatomy.diameter", "anatomy.central_thickness", "optics.refractive_index"],
  uniforms: (eye, id) => ({
    uR1: eye.num(id, "anatomy.anterior_radius"),
    uCornQ: eye.num(id, "anatomy.anterior_asphericity"),   // conic front surface, in every view
    uR2: eye.num(id, "anatomy.posterior_radius"),
    uRL: eye.num(id, "anatomy.diameter") / 2,
    uCCT: eye.num(id, "anatomy.central_thickness"),
    uCornN: eye.num(id, "optics.refractive_index")
  })
};

/** Layers feed the optic section; thickness reaches the shader through the cornea's derived central thickness. */
export const corneaLayer: RenderModule = {
  type: "CorneaLayer",
  consumes: ["anatomy.thickness", "optics.scatter", "optics.scatter_tint", "optics.haze", "optics.peripheral_lipid", "anatomy.arcus_width", "anatomy.lucid_interval"],
  uniforms: (eye, id): Uniforms => {
    switch (id) {
      case "eye.cornea.epithelium": return { uScEpi: eye.num(id, "optics.scatter") };
      case "eye.cornea.endothelium": return { uScEndo: eye.num(id, "optics.scatter") };
      case "eye.cornea.stroma": return {
        uScStroma: eye.num(id, "optics.scatter"),
        uScTint: eye.vec(id, "optics.scatter_tint"),
        uHaze: eye.num(id, "optics.haze"),
        uArcus: eye.num(id, "optics.peripheral_lipid"),
        uArcW: eye.num(id, "anatomy.arcus_width"),
        uLucid: eye.num(id, "anatomy.lucid_interval")
      };
      default: return {};   // Bowman and Descemet are too thin to resolve at slit-lamp magnification
    }
  }
};
