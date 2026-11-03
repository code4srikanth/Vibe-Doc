// The clinical signs a case is matched on (server/case-match.ts). A case's vector is read from its resolved eye, scaled so
// 0 is the healthy value and 1 the strongest value any disease in the library sets, so no value is stored twice.
import type { Case } from "../src/model/generated.ts";
import type { Library } from "../src/model/library.ts";
import { resolveCase } from "../src/model/resolve.ts";

export const SIGNS = [
  { sign: "nuclear_opacity", component: "eye.lens.nucleus", property: "optics.density" },
  { sign: "cortical_spokes", component: "eye.lens.cortex", property: "optics.spoke_density" },
  { sign: "posterior_subcapsular_opacity", component: "eye.lens.capsule", property: "optics.posterior_subcapsular_opacity" },
  { sign: "conjunctival_redness", component: "eye.conjunctiva", property: "appearance.injection" },
  { sign: "ciliary_flush", component: "eye.conjunctiva", property: "appearance.ciliary_flush" },
  { sign: "discharge", component: "eye.tear_film", property: "optics.discharge" },
  { sign: "corneal_haze", component: "eye.cornea.stroma", property: "optics.haze" },
  { sign: "shallow_chamber", component: "eye.anterior_chamber", property: "anatomy.depth" }
] as const;
export type SignScores = Partial<Record<typeof SIGNS[number]["sign"], number>>;

const clamp = (x: number) => Math.max(0, Math.min(1, Number(x) || 0));

/** The vector for what a prompt implies: the model's score for each sign, in SIGNS order. */
export const scoresToVector = (scores: SignScores = {}) => Float32Array.from(SIGNS.map(s => clamp(scores[s.sign] ?? 0)));

/** The value furthest from healthy that any disease grade in the library sets for a property. */
function extreme(lib: Library, component: string, property: string, healthy: number): number {
  let far = healthy;
  for (const d of lib.diseases) for (const patch of Object.values(d.grades)) {
    const v = (patch as Record<string, Record<string, unknown>>)[component]?.[property];
    if (typeof v === "number" && Math.abs(v - healthy) > Math.abs(far - healthy)) far = v;
  }
  return far;
}

/** A stored case's vector, from its metadata, against the healthy eye. */
export function caseVector(lib: Library, kase: Case, healthy: Case): Float32Array {
  const eye = resolveCase(lib, kase), normal = resolveCase(lib, healthy);
  return Float32Array.from(SIGNS.map(({ component, property }) => {
    const h = normal.num(component, property);
    const far = extreme(lib, component, property, h);
    return far === h ? 0 : clamp((eye.num(component, property) - h)/(far - h));
  }));
}
