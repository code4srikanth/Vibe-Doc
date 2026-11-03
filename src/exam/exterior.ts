// External view (realism layers L1 + L2): the relit exterior photo (skin, lids, lashes, caruncle) is drawn
// in front of the ray-marched eye, which shows only through the photo's transparent opening. The frame,
// the photo px <-> mm mapping and the lamp grade are read from assets/exterior/fissure.json, so the eye
// is lit exactly like the photo (tools/cut-exterior.ts relight()).
import * as THREE from "three";
import fissure from "../../assets/exterior/fissure.json";
import layerUrl from "../../assets/exterior/exterior.png?url";
import distUrl from "../../assets/exterior/opening-dist.png?url";
import skinUrl from "../../assets/exterior/skin-albedo.png?url";
import { OPENING_DIST_RANGE_MM } from "./exterior-asset.ts";
import { EXTERIOR } from "./views.ts";
import type { UniformValue } from "../render/modules/module.ts";

const sl = fissure.slit_lamp;
const [ix, iy] = fissure.iris_centre_px;
const k = sl.px_per_mm;
const [cx, cy, cw, ch] = sl.crop;
/** photo pixel (y down) -> eye mm (origin at the iris centre, y up) */
const mm = (px: number, py: number): [number, number] => [(px - ix) / k, -(py - iy) / k];

/** Frame centre in eye mm: the centre of the exterior crop. */
export const exteriorCamera = (): [number, number] => mm(cx + cw / 2, cy + ch / 2);

// Raw texel values: no premultiplication, no colour management, top row first.
async function texture(url: string): Promise<THREE.Texture> {
  const loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const t = new THREE.Texture(await loader.loadAsync(url));
  t.flipY = false;
  t.premultiplyAlpha = false;
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Per photo column of the crop: the upper (r) and lower (g) lid margin heights in eye mm, the height of the still
 *  skin's edge above the lid (b, fissure.json lid_fold), a = 1 where the column has an opening. The opening spans every pixel that is not fully opaque (the soft margin edge included), plus the caruncle
 *  and the pink tissue in the lateral canthus, which stay in the photo (fissure.json) but are hidden by a closed lid. It is widened by one pixel each way and across
 *  the neighbouring columns, so a closed lid (blink) leaves nothing of the eye showing, canthi included. The lid moves
 *  (blink, open wide, gaze) are measured from these margins. */
function lidRows(image: ImageBitmap): THREE.DataTexture {
  const w = image.width, h = image.height;
  const ctx = new OffscreenCanvas(w, h).getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  // the canthi: the pink pixels joined to the opening, medially up to the caruncle's traced edge, laterally past the
  // opening's tip (not along the lid rims)
  const dir = Math.sign(fissure.lateral_canthus[0] - fissure.medial_canthus[0]);
  const medialEnd = ((dir > 0 ? Math.max : Math.min)(...fissure.caruncle_edge.map(p => p[0])) - cx) * w / cw + dir * fissure.caruncle_feather_px;
  let tip = dir > 0 ? 0 : w;
  for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] < 255) tip = dir > 0 ? Math.max(tip, i % w) : Math.min(tip, i % w);
  const canthal = (x: number) => dir * (x - medialEnd) <= 0 || dir * (x - tip) > 0;
  const pink = (i: number) => px[i] > 60 && px[i] - px[i + 1] > 38 && px[i + 1] - px[i + 2] < 18;   // skin is browner: more green than blue
  const cover = new Uint8Array(w * h), queue = new Int32Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] < 255) { cover[i] = 1; queue[n++] = i; }
  for (let k = 0; k < n; k++) {
    const i = queue[k], x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= w * h || cover[j] || !canthal(j % w) || !pink(j * 4)) continue;
      cover[j] = 1; queue[n++] = j;
    }
  }
  const span = Array.from({ length: w }, (_, x) => {   // first and last covered pixel of the column
    let top = -1, bottom = -1;
    for (let y = 0; y < h; y++) if (cover[y * w + x]) { if (top < 0) top = y; bottom = y; }
    return [top, bottom];
  });
  // Widen each span over R columns either side, then average over the same R: the margins vary smoothly from column to
  // column (a jump would show as a seam in the stretched lid), and every column still covers its own span.
  const R = 12;
  const wide = span.map((_, x) => {
    let top = h, bottom = -1;
    for (const [t, b] of span.slice(Math.max(0, x - R), x + R + 1)) if (t >= 0) { top = Math.min(top, t - 1); bottom = Math.max(bottom, b + 1); }
    return [top, bottom];
  });
  // the fold: linear between the traced points, held level past its ends
  const fold = fissure.lid_fold;
  const foldAt = (sx: number) => {
    const i = fold.findIndex(p => p[0] >= sx);
    if (i <= 0) return (i < 0 ? fold[fold.length - 1] : fold[0])[1];
    const [a, b] = [fold[i - 1], fold[i]];
    return a[1] + (b[1] - a[1]) * (sx - a[0]) / (b[0] - a[0]);
  };
  const rows = new Float32Array(w * 4);
  for (let x = 0; x < w; x++) {
    if (wide[x][1] < 0) continue;
    let top = 0, bottom = 0, n = 0;
    for (const [t, b] of wide.slice(Math.max(0, x - R), x + R + 1)) if (b >= 0) { top += t; bottom += b; n++; }
    rows[x * 4] = mm(0, cy + Math.max(0, top / n) * ch / h)[1];            // the upper margin: the top edge of the opening
    rows[x * 4 + 1] = mm(0, cy + Math.min(h, bottom / n + 1) * ch / h)[1];   // the lower margin: its bottom edge
    rows[x * 4 + 2] = mm(0, foldAt(cx + x * cw / w))[1];
    rows[x * 4 + 3] = 1;
  }
  // past the last covered column at either end, the canthal tissue runs on to the crop's edge: hold that column's
  // margins there, so the closed lid reaches the edge of the view
  const covered = [...Array(w).keys()].filter(x => rows[x * 4 + 3]);
  if (covered.length) {
    for (let x = 0; x < w; x++) {
      if (rows[x * 4 + 3]) continue;
      const from = x < covered[0] ? covered[0] : covered[covered.length - 1];
      if (x > covered[0] && x < covered[covered.length - 1]) continue;   // a gap inside the eye stays open
      rows[x * 4] = rows[from * 4]; rows[x * 4 + 1] = rows[from * 4 + 1];
      rows[x * 4 + 2] = mm(0, foldAt(cx + x * cw / w))[1];
      rows[x * 4 + 3] = 1;
    }
  }
  const t = new THREE.DataTexture(rows, w, 1, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

let pending: Promise<Record<string, UniformValue>> | undefined;

/** Uniforms of the external view; the first call loads the exterior textures. */
export function exteriorUniforms(): Promise<Record<string, UniformValue>> {
  return pending ??= (async () => {
    const [layer, dist, skin] = await Promise.all([texture(layerUrl), texture(distUrl), texture(skinUrl)]);
    const [lx, ly] = mm(sl.lamp_centre[0], sl.lamp_centre[1]);
    const [x0, y0] = mm(cx, cy);
    const lp = EXTERIOR.lamp, d = Math.PI / 180;
    return {
      // lamp seen in reflection: direction (+x temporal, +y up, +z toward the camera) and angular half-size;
      // a disc of that size with radiance 1/sin^2 gives the unit irradiance of the diffuse model
      uLampDir: [Math.sin(lp.azimuth * d) * Math.cos(lp.elevation * d), Math.sin(lp.elevation * d), Math.cos(lp.azimuth * d) * Math.cos(lp.elevation * d)],
      uReflex: lp.reflexSize,
      uReflexGain: 1 / Math.sin(lp.reflexSize) ** 2,
      uExterior: 1, uBloom: 0, uGrain: 0, uEye: 0,
      uFov: cw / k,                                     // mm across the frame: the crop's px_per_mm at the crop's width
      uExtTex: layer, uExtDist: dist, uSkinTex: skin, uLidRows: lidRows(skin.image as ImageBitmap),
      uExtRect: [x0, y0, cw / k, ch / k],               // top-left corner (mm) and size of the crop
      uDistRange: OPENING_DIST_RANGE_MM,
      uLampSpot: [lx, ly, sl.lamp_radius_mm, sl.lamp_soft_mm],
      uLampGrade: [sl.room, sl.exposure, sl.contrast, sl.side_light],
      uWarmth: sl.warmth as [number, number, number],
      uPenumbraTan: Math.tan(EXTERIOR.diffuserHalfAngle * Math.PI / 180),
      uShadowMargin: EXTERIOR.shadowAtMargin,
      uAlbedoNv: EXTERIOR.albedoSampleNv
    };
  })();
}

/** The photo layer for the slit-lamp views: skin albedo, opening and lid-margin distances, relit there by the
 *  room and the slit beam (the lamp grade and framing of the external view are left out). */
export async function slitSkinUniforms(): Promise<Record<string, UniformValue>> {
  const u = await exteriorUniforms();
  return { uSkinTex: u.uSkinTex, uExtTex: u.uExtTex, uExtDist: u.uExtDist, uExtRect: u.uExtRect, uDistRange: u.uDistRange, uLidRows: u.uLidRows };
}
