// Agent edits: a list of {component, property, value, reason} applied on top of a base case.
// The Case agent builds an eye this way, without a stored disease or a case file.
// Shared by the server (harness) and the browser (renders a session's eye).
import type { Case, EyeComponent, Quantity } from "./generated.ts";
import { FACETS, type Library } from "./library.ts";
import { checkRules, resolveCase, type Issue, type Value } from "./resolve.ts";

export interface Edit {
  component: string;
  /** "facet.property", e.g. "optics.density". */
  property: string;
  value: Value;
  reason: string;
}

/** What an edit may set, read from the healthy eye. */
export interface PropertyInfo {
  component: string;
  property: string;
  kind: "number" | "rgb" | "string" | "boolean";
  unit?: string;
  normal?: [number, number];
  hard?: [number, number];
  note?: string;
  /** For a string: the healthy value plus every value a disease in the library sets or offers. */
  options?: string[];
  /** The healthy value at the base case's age. */
  current: Value;
  /** For a derived quantity: the expression it is computed from. It cannot be set, only its inputs. */
  derived?: string;
  /** What the library's diseases set it to ("disease, grade g: value"), the scale to size new values against. */
  library?: string[];
}

/** Properties the agent may not set, and why. Geometry traced from the lid photo must keep matching it. */
export function lockedReason(component: string, property: string): string | undefined {
  if (component === "eye.adnexa.palpebral_fissure") return "fixed by the traced lid photograph";
  if (/^eye\.adnexa\.(upper|lower)_lid$/.test(component) && property !== "anatomy.swelling") return "fixed by the traced lid photograph (only anatomy.swelling may change)";
  if (component === "eye.globe" && property.startsWith("physiology.gaze_")) return "gaze belongs to the patient, not the case";
  if ((component === "eye.lens" && property === "optics.diffuse_scatter_gain") || (component === "eye.lens.nucleus" && property === "optics.milky_scatter") || (component === "eye.iris" && property === "microstructure.collarette_dilated_scale")) return "a render calibration, not a property of this patient's eye";
}

const isQuantity = (x: unknown): x is Quantity => !!x && typeof x === "object" && "unit" in (x as object);
const facetOf = (c: EyeComponent, facet: string) => (c as unknown as Record<string, Record<string, unknown> | undefined>)[facet];

/** String values the library uses for each "component:property", from disease grades and params. */
function stringOptions(lib: Library): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (key: string, v: unknown) => { if (typeof v === "string") out.set(key, (out.get(key) ?? new Set()).add(v)); };
  for (const d of lib.diseases) {
    for (const patch of Object.values(d.grades)) {
      for (const [id, props] of Object.entries(patch)) for (const [path, v] of Object.entries(props)) add(`${id}:${path}`, v);
    }
    for (const p of Object.values(d.params ?? {})) for (const o of p.options) add(`${p.target}:${p.path}`, o);
  }
  return out;
}

/** Numbers the library's diseases set for each "component:property", as "disease name, grade: value": the
 *  calibrated scale an agent sizes its own values against. */
function libraryValues(lib: Library): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const d of lib.diseases) {
    for (const [grade, patch] of Object.entries(d.grades)) {
      for (const [id, props] of Object.entries(patch)) {
        for (const [path, v] of Object.entries(props)) {
          if (typeof v === "number") out.set(`${id}:${path}`, [...(out.get(`${id}:${path}`) ?? []), `${d.name}, grade ${grade}: ${v}`]);
        }
      }
    }
  }
  return out;
}

/** Every settable scalar, colour, string or boolean property of the healthy eye. */
export function listProperties(lib: Library, base: Case): PropertyInfo[] {
  const eye = resolveCase(lib, base);
  const strings = stringOptions(lib), examples = libraryValues(lib);
  const out: PropertyInfo[] = [];
  for (const c of eye.components.values()) {
    for (const facet of FACETS) {
      for (const [prop, raw] of Object.entries(facetOf(c, facet) ?? {})) {
        const property = `${facet}.${prop}`;
        if (typeof raw === "string") {
          out.push({ component: c.id, property, kind: "string", current: raw, options: [...new Set([raw, ...(strings.get(`${c.id}:${property}`) ?? [])])] });
        } else if (typeof raw === "boolean") {
          out.push({ component: c.id, property, kind: "boolean", current: raw });
        } else if (isQuantity(raw)) {
          let current: Value;
          try { current = eye.value(c.id, property); } catch { continue; }
          out.push({
            component: c.id, property, kind: Array.isArray(current) ? "rgb" : "number", current,
            unit: raw.unit, normal: raw.normal as [number, number] | undefined, hard: raw.hard as [number, number] | undefined, note: raw.note,
            ...(typeof raw.derived === "string" && { derived: raw.derived }),
            ...(examples.has(`${c.id}:${property}`) && { library: examples.get(`${c.id}:${property}`) })
          });
        }   // procedural generators are not exposed
      }
    }
  }
  return out;
}

/** Models often send numbers as text ("0.65", "[1, 2, 3]"); convert them when the property takes numbers. */
export function coerceValue(p: PropertyInfo | undefined, v: unknown): unknown {
  if (typeof v !== "string" || !p) return v;
  const t = v.trim();
  if (p.kind === "number" && t !== "" && Number.isFinite(Number(t))) return Number(t);
  if (p.kind === "rgb" && t.startsWith("[")) { try { return JSON.parse(t); } catch { return v; } }
  if (p.kind === "boolean" && (t === "true" || t === "false")) return t === "true";
  return v;
}

/** Checks one edit before it is applied. Returns a message the agent can act on, or undefined. */
export function checkEdit(props: PropertyInfo[], e: Edit): string | undefined {
  const p = props.find(x => x.component === e.component && x.property === e.property);
  if (!p) {
    const known = props.some(x => x.component === e.component);
    return known ? `${e.component} has no settable property ${e.property}.` : `There is no component ${e.component}.`;
  }
  const locked = lockedReason(e.component, e.property);
  if (locked) return `${e.component}:${e.property} cannot be changed: ${locked}.`;
  if (p.derived) return `${e.component}:${e.property} is derived from ${p.derived}; set those instead.`;
  if (!e.reason?.trim()) return "Every edit needs a reason.";
  if (p.unit === "rgb") return `${e.component}:${e.property} is a painted colour; change scatter, absorption, thickness or position instead.`;
  switch (p.kind) {
    case "number":
      if (typeof e.value !== "number" || !Number.isFinite(e.value)) return `${e.property} takes a number in ${p.unit}.`;
      if (p.hard && (e.value < p.hard[0] || e.value > p.hard[1])) return `${e.value} ${p.unit} is outside the possible range ${p.hard[0]}-${p.hard[1]}.`;
      return;
    case "rgb":
      if (!Array.isArray(e.value) || e.value.length !== 3 || !e.value.every(v => typeof v === "number" && Number.isFinite(v) && v >= 0)) return `${e.property} takes three non-negative numbers [r, g, b] in ${p.unit}.`;
      return;
    case "string":
      if (!p.options!.includes(e.value as string)) return `${e.property} takes one of: ${p.options!.join(", ")}.`;
      return;
    default:
      if (typeof e.value !== p.kind) return `${e.property} takes a ${p.kind}.`;
  }
}

/** Range checks plus anatomy rules on the edited eye: one list of issues the agent can read. */
export function validateEye(lib: Library, base: Case, edits: Edit[]): Issue[] {
  const props = listProperties(lib, base);
  const issues: Issue[] = edits.flatMap(e => {
    const m = checkEdit(props, e);
    return m ? [{ level: "error" as const, where: `${e.component}:${e.property}`, message: m }] : [];
  });
  const eye = resolveCase(lib, base, edits);
  return [...issues, ...eye.issues, ...checkRules(eye, lib.rules)];
}
