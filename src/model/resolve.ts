// Resolves a case into a concrete eye: normal components, then the subject's variants,
// then each disease grade, overrides, exam conditions and agent edits; finally age functions and
// derived values are evaluated and every quantity is range-checked.
import type { Case, EyeComponent, Patch, Quantity } from "./generated.ts";
import { FACETS, type Library } from "./library.ts";
import { evaluate } from "./expr.ts";
import type { Edit } from "./edits.ts";

export type Value = number | number[] | string | boolean;
export interface Issue { level: "error" | "warning" | "info"; where: string; message: string }

export interface ResolvedEye {
  case: Case;
  age: number;
  components: Map<string, EyeComponent>;
  /** "component.id:facet.property" keys changed by variants, diseases, exam conditions or overrides. */
  changed: Map<string, string>;
  issues: Issue[];
  value(id: string, path: string): Value;
  num(id: string, path: string): number;
  vec(id: string, path: string): [number, number, number];
  str(id: string, path: string): string;
}

const isQuantity = (x: unknown): x is Quantity =>
  !!x && typeof x === "object" && "unit" in (x as object) && ("value" in (x as object) || "age" in (x as object) || "derived" in (x as object));

function facetOf(c: EyeComponent, facet: string): Record<string, unknown> | undefined {
  return (c as unknown as Record<string, Record<string, unknown> | undefined>)[facet];
}

export function resolveCase(lib: Library, kase: Case, edits: Edit[] = []): ResolvedEye {
  const issues: Issue[] = [];
  const changed = new Map<string, string>();
  const components = new Map(lib.components.map(c => [c.id, structuredClone(c)]));

  const setProp = (id: string, path: string, v: Value, why: string) => {
    const c = components.get(id);
    const [facet, prop, param] = path.split(".");
    const f = c && facetOf(c, facet);
    const gap = () => issues.push({ level: "error", where: `${id}:${path}`, message: `${why} sets a property the schema does not have (capability gap).` });
    if (!c || !f || !(prop in f)) return gap();
    if (param) {   // one parameter of a procedural generator
      const params = (f[prop] as { params?: Record<string, number> }).params;
      if (!params || !(param in params) || typeof v !== "number") return gap();
      params[param] = v;
      changed.set(`${id}:${path}`, why);
      return;
    }
    const cur = f[prop];
    if (isQuantity(cur)) {
      const { unit, normal, hard, note } = cur;
      f[prop] = { value: v as number | number[], unit, ...(normal && { normal }), ...(hard && { hard }), ...(note && { note }) };
    } else {
      f[prop] = v;
    }
    changed.set(`${id}:${path}`, why);
  };
  const applyPatch = (patch: Patch | undefined, why: string) => {
    for (const [id, props] of Object.entries(patch ?? {})) {
      for (const [path, v] of Object.entries(props as Record<string, Value>)) setProp(id, path, v, why);
    }
  };

  // 1. Variants (record-type-like healthy variation).
  for (const [kind, key] of [["iris", kase.subject.iris_colour], ["skin", kase.subject.skin_tone]] as const) {
    if (!key) continue;
    const variant = lib.variants.find(v => v.id === `variant.${kind}.${key}`);
    if (variant) applyPatch(variant.patch, variant.id);
    else issues.push({ level: "error", where: kase.id, message: `No variant variant.${kind}.${key}` });
  }

  // 2. Diseases, in case order, each at its grade, plus case-level params.
  for (const d of kase.diseases) {
    const def = lib.diseases.find(x => x.id === d.id);
    if (!def) { issues.push({ level: "error", where: kase.id, message: `Unknown disease ${d.id}` }); continue; }
    const grade = def.grades[d.grade];
    if (!grade) { issues.push({ level: "error", where: kase.id, message: `${d.id} has no grade "${d.grade}"` }); continue; }
    applyPatch(grade, `${d.id}@${d.grade}`);
    for (const [name, value] of Object.entries((d.params ?? {}) as Record<string, string>)) {
      const p = def.params?.[name];
      if (!p) { issues.push({ level: "error", where: kase.id, message: `${d.id} has no param "${name}"` }); continue; }
      if (!p.options.includes(value)) { issues.push({ level: "error", where: kase.id, message: `${d.id} param ${name} must be one of ${p.options.join(", ")}` }); continue; }
      setProp(p.target, p.path, value, `${d.id}.params.${name}`);
    }
  }

  // 3. Case-specific overrides.
  applyPatch(kase.overrides as Patch | undefined, `${kase.id}.overrides`);

  // 4. Exam conditions: dilating drops, unless a disease has fixed the pupil. After the overrides, because a case's
  // pupil size is the undilated one: the drop must still open it.
  if (kase.exam_conditions?.dilated) {
    const pupil = components.get("eye.pupil");
    if (pupil?.physiology?.light_reflex === "fixed") {
      issues.push({ level: "info", where: "eye.pupil", message: "Pupil is fixed; dilation has no effect." });
    } else if (pupil?.anatomy) {
      const q = pupil.anatomy.diameter as Quantity;
      pupil.anatomy.diameter = { derived: "{eye.pupil:anatomy.dilated_diameter}", unit: q.unit, normal: q.normal, hard: q.hard };
      changed.set("eye.pupil:anatomy.diameter", "exam_conditions.dilated");
    }
  }

  // 4b. Agent edits (src/model/edits.ts), each with its own reason.
  for (const e of edits) setProp(e.component, e.property, e.value, e.reason);

  // 5. Evaluate quantities lazily with cycle detection.
  const age = kase.subject.age;
  const cache = new Map<string, Value>();
  const stack = new Set<string>();
  const value = (id: string, path: string): Value => {
    const key = `${id}:${path}`;
    if (cache.has(key)) return cache.get(key)!;
    const c = components.get(id);
    const [facet, prop] = path.split(".");
    const raw = c && facetOf(c, facet)?.[prop];
    if (raw === undefined) throw new Error(`Unknown property ${key}`);
    if (stack.has(key)) throw new Error(`Circular derived value at ${key}`);
    stack.add(key);
    let v: Value;
    if (isQuantity(raw)) {
      if (raw.value !== undefined) v = raw.value;
      else if (raw.age) v = interpolate(raw.age as number[][], age);
      else v = evaluate(raw.derived!, (i, p) => value(i, p) as number) as number;
    } else if (typeof raw === "string" || typeof raw === "boolean") {
      v = raw;
    } else {
      throw new Error(`${key} is a generator, not a value`);
    }
    stack.delete(key);
    cache.set(key, v);
    return v;
  };

  const eye: ResolvedEye = {
    case: kase, age, components, changed, issues, value,
    num: (id, path) => { const v = value(id, path); if (typeof v !== "number") throw new Error(`${id}:${path} is not a scalar`); return v; },
    vec: (id, path) => { const v = value(id, path); if (!Array.isArray(v)) throw new Error(`${id}:${path} is not RGB`); return v as [number, number, number]; },
    str: (id, path) => { const v = value(id, path); if (typeof v !== "string") throw new Error(`${id}:${path} is not a string`); return v; }
  };

  // 6. Range checks on every scalar quantity.
  for (const c of components.values()) {
    for (const facet of FACETS) {
      for (const [prop, raw] of Object.entries(facetOf(c, facet) ?? {})) {
        if (!isQuantity(raw)) continue;
        const where = `${c.id}:${facet}.${prop}`;
        let v: Value;
        try { v = value(c.id, `${facet}.${prop}`); } catch (e) { issues.push({ level: "error", where, message: (e as Error).message }); continue; }
        if (typeof v !== "number") continue;
        if (raw.hard && (v < raw.hard[0] || v > raw.hard[1])) issues.push({ level: "error", where, message: `${round(v)} ${raw.unit} is outside the possible range ${raw.hard[0]}-${raw.hard[1]}.` });
        else if (raw.normal && (v < raw.normal[0] || v > raw.normal[1])) issues.push({ level: "info", where, message: `${round(v)} ${raw.unit} is outside the normal range ${raw.normal[0]}-${raw.normal[1]}${changed.has(where) ? ` (set by ${changed.get(where)})` : ""}.` });
      }
    }
  }
  return eye;
}

export function checkRules(eye: ResolvedEye, rules: Library["rules"]): Issue[] {
  return rules.flatMap(r => {
    try {
      return evaluate(r.assert, (id, p) => eye.num(id, p)) ? [] : [{ level: r.severity, where: `rule ${r.id}`, message: r.message } as Issue];
    } catch (e) {
      return [{ level: "error", where: `rule ${r.id}`, message: (e as Error).message } as Issue];
    }
  });
}

function interpolate(points: number[][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

const round = (v: number) => Math.round(v * 1000) / 1000;
