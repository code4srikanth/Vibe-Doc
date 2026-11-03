import type { Texture } from "three";
import type { ResolvedEye } from "../../model/resolve.ts";

export type UniformValue = number | [number, number, number] | [number, number, number, number] | Texture;
export type Uniforms = Record<string, UniformValue>;

/**
 * Turns one component type's metadata into shader uniforms.
 * `consumes` lists the facet.property paths the module reads; the validator uses it
 * to report metadata the renderer ignores (a capability gap for the Developer agent).
 */
export interface RenderModule {
  type: string;
  consumes: string[];
  uniforms(eye: ResolvedEye, id: string): Record<string, UniformValue>;
}

export const RGB = (eye: ResolvedEye, id: string, path: string) => eye.vec(id, path);

/** A numeric parameter (or the seed) of a procedural generator; missing values are a metadata error, not a silent default. */
export function genParam(eye: ResolvedEye, id: string, path: string, name: string): number {
  const [facet, prop] = path.split(".");
  const gen = (eye.components.get(id) as unknown as Record<string, Record<string, { seed?: number; params?: Record<string, number> }> | undefined>)[facet]?.[prop];
  const v = name === "seed" ? gen?.seed : gen?.params?.[name];
  if (typeof v !== "number") throw new Error(`${id}:${path} needs a numeric "${name}" in the metadata`);
  return v;
}
