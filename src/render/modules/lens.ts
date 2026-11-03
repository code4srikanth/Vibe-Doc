import type { RenderModule, Uniforms } from "./module.ts";

export const lens: RenderModule = {
  type: "Lens",
  consumes: ["anatomy.thickness", "anatomy.anterior_radius", "anatomy.posterior_radius", "anatomy.equatorial_diameter", "optics.refractive_index", "optics.surface_reflectance", "optics.diffuse_scatter_gain"],
  uniforms: (eye, id) => ({
    uLT: eye.num(id, "anatomy.thickness"),
    uLR1: eye.num(id, "anatomy.anterior_radius"),
    uLR2: eye.num(id, "anatomy.posterior_radius"),
    uLensEqR: eye.num(id, "anatomy.equatorial_diameter") / 2,
    uLensN: eye.num(id, "optics.refractive_index"),          // equivalent index: refraction of the Purkinje IV path
    uLensRefl: eye.num(id, "optics.surface_reflectance"),    // front and back surface reflectance (Purkinje III, IV)
    uLensDiffuse: eye.num(id, "optics.diffuse_scatter_gain") // how much room light the lens's scatter returns in the external view
  })
};

export const lensLayer: RenderModule = {
  type: "LensLayer",
  consumes: [
    "optics.scatter", "optics.posterior_subcapsular_opacity", "optics.lamellar_contrast", "optics.spoke_density", "anatomy.spoke_location",
    "anatomy.relative_size", "optics.density", "optics.scatter_colour", "optics.milky_scatter", "optics.absorption_tint"
  ],
  uniforms: (eye, id): Uniforms => {
    switch (id) {
      case "eye.lens.capsule": return {
        uCapSc: eye.num(id, "optics.scatter"),
        uPSC: eye.num(id, "optics.posterior_subcapsular_opacity")
      };
      case "eye.lens.cortex": return {
        uLensBase: eye.num(id, "optics.scatter"),
        uLamellar: eye.num(id, "optics.lamellar_contrast"),
        uCort: eye.num(id, "optics.spoke_density"),
        uCortLoc: eye.str(id, "anatomy.spoke_location") === "inferior" ? 1 : 0
      };
      case "eye.lens.nucleus": return {
        uNucBase: eye.num(id, "optics.scatter"),
        uNuc: eye.num(id, "optics.density"),
        uNucCol: eye.vec(id, "optics.scatter_colour"),
        uNucMilk: eye.num(id, "optics.milky_scatter"),
        uNucAbs: eye.vec(id, "optics.absorption_tint"),
        uNucSize: eye.num(id, "anatomy.relative_size")
      };
      default: throw new Error(`LensLayer module has no slot for ${id}`);
    }
  }
};
