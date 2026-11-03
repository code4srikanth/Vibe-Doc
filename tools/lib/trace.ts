// Converts the palpebral-fissure trace in assets/exterior/fissure.json (source-photo pixels, y down)
// into the mm values the metadata stores (origin at the iris centre, +x lateral, +y up), so the
// validator can check that the metadata still matches the photo.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./library.ts";

type Pt = [number, number];
export interface FissureTrace {
  iris_centre_px: Pt; pupil_centre_px: Pt;
  medial_canthus: Pt; lateral_canthus: Pt; caruncle_edge?: Pt[]; upper: Pt[]; lower: Pt[];
  slit_lamp: { px_per_mm: number };
}

export const readTrace = (): FissureTrace =>
  JSON.parse(readFileSync(join(ROOT, "assets", "exterior", "fissure.json"), "utf8"));

/** Metadata `id:facet.property` -> value in mm measured on the trace. */
export function traceMm(t: FissureTrace): Record<string, number> {
  const s = t.slit_lamp.px_per_mm, [cx, cy] = t.iris_centre_px, [px, py] = t.pupil_centre_px;
  const X = (x: number) => (x - cx) / s, Y = (y: number) => -(y - cy) / s;
  const [m, l] = [t.medial_canthus, t.lateral_canthus];
  // margin y (px) on a polyline at column x
  const at = (line: Pt[], x: number) => {
    const p = [...line].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < p.length; i++) if (x <= p[i][0]) return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
    throw new Error(`x ${x} px is outside the traced margin`);
  };
  // apex = extreme traced vertex; height measured vertically from the line joining the canthi
  const canthal = (x: number) => m[1] + (l[1] - m[1]) * (x - m[0]) / (l[0] - m[0]);
  const upApex = t.upper.reduce((a, b) => (b[1] < a[1] ? b : a));
  const loApex = t.lower.reduce((a, b) => (b[1] > a[1] ? b : a));
  const ring = [...(t.caruncle_edge ?? [m]), ...t.upper, l, ...t.lower];
  const F = "eye.adnexa.palpebral_fissure:anatomy.", U = "eye.adnexa.upper_lid:anatomy.", L = "eye.adnexa.lower_lid:anatomy.";
  return {
    [F + "medial_canthus_x"]: X(m[0]), [F + "medial_canthus_y"]: Y(m[1]),
    [F + "lateral_canthus_x"]: X(l[0]), [F + "lateral_canthus_y"]: Y(l[1]),
    [F + "opening_max_radius"]: Math.max(...ring.map(([x, y]) => Math.hypot(x - cx, y - cy))) / s,
    [U + "margin_height"]: (py - at(t.upper, px)) / s,   // MRD1, from the pupil centre
    [L + "margin_height"]: (at(t.lower, px) - py) / s,   // MRD2
    [U + "apex_offset"]: X(upApex[0]), [U + "apex_height"]: (canthal(upApex[0]) - upApex[1]) / s,
    [L + "apex_offset"]: X(loApex[0]), [L + "apex_height"]: (loApex[1] - canthal(loApex[0])) / s
  };
}
