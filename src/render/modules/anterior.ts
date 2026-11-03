import { genParam, type RenderModule } from "./module.ts";

export const anteriorChamber: RenderModule = {
  type: "AnteriorChamber",
  consumes: ["anatomy.depth", "optics.refractive_index", "optics.cells_grade", "optics.flare_grade"],
  uniforms: (eye, id) => ({
    uACD: eye.num(id, "anatomy.depth"),
    uAqN: eye.num(id, "optics.refractive_index"),
    uCells: eye.num(id, "optics.cells_grade"),
    uFlare: eye.num(id, "optics.flare_grade")
  })
};

// Iris surface (realism layers L4, L4b): zone albedos, interlaced fibre bundles (multi-octave noise), fBm mottling,
// a raised collarette band (L4c: sawtooth outer edge, band crypts with pale rims, a crossing fibre net), radial-lozenge crypts of many sizes, the pupillary ruff and contraction furrows, all placed in
// the pattern coordinate t (0 at the pupil margin, 1 at the root) so they move with the pupil. The limbal ring, its
// texture fade are apparent (seen through the cornea) widths, applied where the eye is drawn.
export const iris: RenderModule = {
  type: "Iris",
  consumes: ["anatomy.diameter", "anatomy.ruff_width", "anatomy.limbal_ring_width", "anatomy.limbal_ring_ramp",
    "appearance.albedo_dark", "appearance.albedo_light", "appearance.border_layer_albedo", "appearance.ciliary_albedo", "appearance.trabecula_albedo",
    "appearance.colour", "appearance.limbal_darkening", "appearance.limbal_texture_fade",
    "microstructure.fibres", "microstructure.mottling", "microstructure.collarette", "microstructure.crypts", "microstructure.contraction_furrows",
    "microstructure.collarette_position", "microstructure.collarette_dilated_scale", "microstructure.collarette_edge_roughness", "microstructure.collarette_crypt_count",
    "microstructure.collarette_crypt_length", "microstructure.collarette_rim_brightness", "microstructure.collarette_net_angle", "physiology.convexity"],
  uniforms: (eye, id) => {
    const fib = (n: string) => genParam(eye, id, "microstructure.fibres", n);
    const mot = (n: string) => genParam(eye, id, "microstructure.mottling", n);
    const col = (n: string) => genParam(eye, id, "microstructure.collarette", n);
    const cry = (n: string) => genParam(eye, id, "microstructure.crypts", n);
    const fur = (n: string) => genParam(eye, id, "microstructure.contraction_furrows", n);
    return {
      uIrisR: eye.num(id, "anatomy.diameter") / 2,
      uRuffW: eye.num(id, "anatomy.ruff_width"),
      uLimbW: eye.num(id, "anatomy.limbal_ring_width"),
      uLimbRamp: eye.num(id, "anatomy.limbal_ring_ramp"),
      uLimbDark: eye.num(id, "appearance.limbal_darkening"),
      uIris1: eye.vec(id, "appearance.albedo_dark"),
      uIris2: eye.vec(id, "appearance.albedo_light"),
      uIrisBorder: eye.vec(id, "appearance.border_layer_albedo"),
      uIrisCil: eye.vec(id, "appearance.ciliary_albedo"),
      uIrisTrab: eye.vec(id, "appearance.trabecula_albedo"),
      uIrisConvex: eye.num(id, "physiology.convexity"),
      // only when the drop really opened the pupil: a fixed pupil, or one set by the Case agent, keeps the full band
      uCollar: eye.num(id, "microstructure.collarette_position") * (eye.changed.get("eye.pupil:anatomy.diameter") === "exam_conditions.dilated" ? eye.num(id, "microstructure.collarette_dilated_scale") : 1),
      uColRough: eye.num(id, "microstructure.collarette_edge_roughness"), uColCryptN: Math.round(eye.num(id, "microstructure.collarette_crypt_count")),
      uColCryptL: eye.num(id, "microstructure.collarette_crypt_length"), uColRim: eye.num(id, "microstructure.collarette_rim_brightness"),
      uColNet: Math.tan(eye.num(id, "microstructure.collarette_net_angle") * Math.PI / 180),
      uLimbTexFade: eye.num(id, "appearance.limbal_texture_fade"),
      uFibCon: fib("contrast"), uFibSpace: fib("bundle_spacing"), uFibW: fib("bundle_width"), uFibJit: fib("spacing_jitter"),
      uFibLen: fib("bundle_length"), uFibLace: fib("interlacing"), uFibSlant: Math.tan(fib("angle_spread") * Math.PI / 180),
      uFibPupRatio: fib("pupillary_spacing_ratio"), uFibOct: Math.round(fib("octaves")), uFibGain: fib("octave_gain"), uFibBright: fib("brightness_jitter"),
      uFibWavy: fib("waviness"), uFibWaveL: fib("wave_length"), uFibH: fib("ridge_height"), uFibSeed: fib("seed") % 97,
      uMotScale: mot("scale"), uMotOct: Math.round(mot("octaves")), uMotAmp: mot("amplitude"), uMotStretch: mot("radial_stretch"), uMotSeed: mot("seed") % 97,
      uColLobes: Math.round(col("lobes")), uColAmp: col("amplitude"), uColJit: col("lobe_jitter"), uColRidgeW: col("ridge_width"),
      uColRidgeH: col("ridge_height"), uColCon: col("contrast"), uColSeed: col("seed") % 97,
      uCryptN: Math.round(cry("count")), uCryptDen: cry("density"), uCryptSize: cry("size"), uCryptAsp: cry("aspect"), uCryptJit: cry("jitter"),
      uCryptIn: cry("inner"), uCryptOut: cry("outer"), uCryptInN: Math.round(cry("inner_count")), uCryptDepth: cry("depth"), uCryptCon: cry("contrast"),
      uCryptSpread: cry("size_spread"), uCryptSoft: cry("edge_softness"), uCryptOutline: cry("outline_noise"), uCryptBridge: cry("bridging"),
      uCryptWall: cry("wall_width"), uIrisSeed: cry("seed") % 97,
      uFurN: Math.round(fur("count")), uFurIn: fur("inner"), uFurOut: fur("outer"), uFurCov: fur("coverage"), uFurW: fur("width"),
      uFurDepth: fur("depth"), uFurOn: fur("onset_pupil"), uFurFull: fur("full_pupil"), uFurCon: fur("contrast"), uFurSeed: fur("seed") % 97
    };
  }
};

// The renderer refracts through the cornea itself, so it takes the real (anatomical) pupil; the entrance
// pupil (optics.entrance_diameter) is what that refraction produces, kept in metadata for the clinician.
export const pupil: RenderModule = {
  type: "Pupil",
  consumes: ["anatomy.diameter", "anatomy.vertical_ratio", "anatomy.decentration_x", "anatomy.decentration_y"],
  uniforms: (eye, id) => ({
    uRP: eye.num(id, "anatomy.diameter") / 2,
    uPupOval: eye.num(id, "anatomy.vertical_ratio"),
    // eye coordinates (+x temporal), the same frame as every other x in the shaders
    uPupDec: [eye.num(id, "anatomy.decentration_x"), eye.num(id, "anatomy.decentration_y"), 0]
  })
};
