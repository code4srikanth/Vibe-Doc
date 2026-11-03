// Registry of render modules by component type. Adding a component type to the
// schema means adding a module here; the validator reports any type without one.
import type { ResolvedEye } from "../../model/resolve.ts";
import type { RenderModule, UniformValue } from "./module.ts";
import { cornea, corneaLayer } from "./cornea.ts";
import { anteriorChamber, iris, pupil } from "./anterior.ts";
import { lens, lensLayer } from "./lens.ts";
import { caruncle, conjunctiva, eyelid, fissure, globe, lashes, sclera, skin } from "./outer.ts";
import { tearFilm } from "./tear.ts";
import { macula, opticDisc, retina, retinalVessels } from "./fundus.ts";

export const MODULES: RenderModule[] = [cornea, corneaLayer, tearFilm, anteriorChamber, iris, pupil, lens, lensLayer, conjunctiva, sclera, eyelid, lashes, skin, globe, fissure, caruncle,
  retina, opticDisc, macula, retinalVessels];
export const moduleFor = (type: string) => MODULES.find(m => m.type === type);

export function eyeUniforms(eye: ResolvedEye): Record<string, UniformValue> {
  const out: Record<string, UniformValue> = {};
  for (const c of eye.components.values()) {
    const m = moduleFor(c.type);
    if (!m) throw new Error(`No render module for component type ${c.type} (${c.id})`);
    Object.assign(out, m.uniforms(eye, c.id));
  }
  return out;
}
