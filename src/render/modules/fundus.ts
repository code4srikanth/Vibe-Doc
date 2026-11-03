// The fundus seen through a fundus lens (docs/fundus): a flat image in retinal millimetres, fovea at the origin,
// +x temporal, +y up. The fundus shader mirrors it for the left eye. Angles are degrees counter-clockwise from temporal
// on the right eye, passed in radians.
import { RGB, type RenderModule } from "./module.ts";

const rad = Math.PI / 180;

export const retina: RenderModule = {
  type: "Retina",
  consumes: ["appearance.background_colour", "appearance.peripheral_darkening", "appearance.tessellation", "appearance.nerve_fibre_sheen"],
  uniforms: (eye, id) => ({
    uFBg: RGB(eye, id, "appearance.background_colour"),
    uFDark: eye.num(id, "appearance.peripheral_darkening"),
    uFTess: eye.num(id, "appearance.tessellation"),
    uFSheen: eye.num(id, "appearance.nerve_fibre_sheen")
  })
};

export const opticDisc: RenderModule = {
  type: "OpticDisc",
  consumes: ["anatomy.vertical_diameter", "anatomy.horizontal_diameter", "anatomy.position_x", "anatomy.position_y",
    "anatomy.cup_disc_ratio_vertical", "anatomy.cup_disc_ratio_horizontal", "anatomy.cup_decentration_x", "anatomy.cup_decentration_y",
    "anatomy.notch_depth", "anatomy.notch_angle", "anatomy.haemorrhage_length", "anatomy.haemorrhage_angle", "anatomy.peripapillary_atrophy_width",
    "appearance.rim_colour", "appearance.cup_colour", "appearance.pallor"],
  uniforms: (eye, id) => ({
    uDisc: [eye.num(id, "anatomy.position_x"), eye.num(id, "anatomy.position_y"), eye.num(id, "anatomy.horizontal_diameter") / 2, eye.num(id, "anatomy.vertical_diameter") / 2],
    uCup: [eye.num(id, "anatomy.cup_decentration_x"), eye.num(id, "anatomy.cup_decentration_y"),
      eye.num(id, "anatomy.cup_disc_ratio_horizontal"), eye.num(id, "anatomy.cup_disc_ratio_vertical")],
    uNotch: [eye.num(id, "anatomy.notch_depth"), eye.num(id, "anatomy.notch_angle") * rad, eye.num(id, "anatomy.haemorrhage_length"), eye.num(id, "anatomy.haemorrhage_angle") * rad],
    uPPA: eye.num(id, "anatomy.peripapillary_atrophy_width"),
    uRimCol: RGB(eye, id, "appearance.rim_colour"),
    uCupCol: RGB(eye, id, "appearance.cup_colour"),
    uPallor: eye.num(id, "appearance.pallor")
  })
};

export const macula: RenderModule = {
  type: "Macula",
  consumes: ["anatomy.diameter", "anatomy.fovea_diameter", "anatomy.foveola_diameter", "appearance.pigment", "appearance.foveal_reflex"],
  uniforms: (eye, id) => ({
    uMac: [eye.num(id, "anatomy.diameter") / 2, eye.num(id, "anatomy.fovea_diameter") / 2, eye.num(id, "anatomy.foveola_diameter") / 2, eye.num(id, "appearance.pigment")],
    uFovReflex: eye.num(id, "appearance.foveal_reflex")
  })
};

// The vessel network itself is generated on the CPU from these values and baked into a texture (F2).
export const retinalVessels: RenderModule = {
  type: "RetinalVessels",
  consumes: ["anatomy.vein_calibre", "anatomy.artery_vein_ratio", "anatomy.artery_calibre", "anatomy.arcade_separation", "microstructure.branch_seed",
    "appearance.artery_colour", "appearance.vein_colour", "appearance.artery_reflex"],
  uniforms: (eye, id) => ({
    uVesA: RGB(eye, id, "appearance.artery_colour"),
    uVesV: RGB(eye, id, "appearance.vein_colour"),
    uArtReflex: eye.num(id, "appearance.artery_reflex")
  })
};
