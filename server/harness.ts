// The Case agent's only access to the eye: Search, Read, Set, Remove, Validate, Explain.
// Each tool works on one session's list of edits over the healthy base eye; nothing touches disk.
import type { Case, EyeComponent } from "../src/model/generated.ts";
import type { Library } from "../src/model/library.ts";
import { resolveCase } from "../src/model/resolve.ts";
import { checkEdit, coerceValue, listProperties, lockedReason, validateEye, type Edit, type PropertyInfo } from "../src/model/edits.ts";
import { moduleFor } from "../src/render/modules/index.ts";
import type { ToolSpec } from "./gateway.ts";

/** The healthy eye the app shows; every generated case starts from it. */
export const BASE_CASE_ID = "reference_black_brown";

/** Not drawn by a render module, but read by the resolver (exam dilation in src/model/resolve.ts), so they still change the eye. */
const RESOLVER_READS = new Set(["eye.pupil:physiology.light_reflex", "eye.pupil:anatomy.dilated_diameter"]);

export interface Subject { age: number; sex: "female" | "male"; eye?: string }

export function baseCase(lib: Library, subject: Subject): Case {
  const ref = lib.cases.find(c => c.id === BASE_CASE_ID);
  if (!ref) throw new Error(`Base case ${BASE_CASE_ID} is missing from eye-model/cases.`);
  const { answer: _, ...kase } = structuredClone(ref);
  const eye = subject.eye === "OD" || subject.eye === "OS" ? subject.eye : kase.subject.eye;
  return { ...kase, id: "session", title: "Generated case", subject: { ...kase.subject, age: subject.age, sex: subject.sex, eye } };
}

export class Harness {
  readonly edits: Edit[] = [];
  readonly props: PropertyInfo[];
  private readonly components: Map<string, EyeComponent>;

  constructor(readonly lib: Library, readonly base: Case) {
    this.props = listProperties(lib, base);
    this.components = new Map(lib.components.map(c => [c.id, c]));
  }

  /** Whether changing the property changes what the trainee sees. */
  drawn(p: { component: string; property: string }) {
    const type = this.components.get(p.component)?.type;
    return RESOLVER_READS.has(`${p.component}:${p.property}`) || !!(type && moduleFor(type)?.consumes.includes(p.property));
  }

  /** Properties whose component, name or description match the query, best first. */
  search(query: string, limit = 12) {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
    const scored = this.props.filter(p => !lockedReason(p.component, p.property)).map(p => {
      const c = this.components.get(p.component)!;
      const text = `${p.component} ${p.property.replaceAll("_", " ")} ${c.summary ?? ""} ${p.note ?? ""}`.toLowerCase();
      return { p, score: words.reduce((s, w) => s + (text.includes(w) ? (p.property.includes(w) || p.component.includes(w) ? 2 : 1) : 0), 0) };
    }).filter(x => x.score > 0 && this.drawn(x.p)).sort((a, b) => b.score - a.score);
    return { matches: scored.slice(0, limit).map(x => describe(x.p)), total: scored.length };
  }

  /** One component: what it is, where it is seen, and every property with its unit and ranges. */
  read(component: string) {
    const c = this.components.get(component);
    if (!c) return { error: `There is no component ${component}. Use search_properties to find one.` };
    return {
      component, type: c.type, summary: c.summary,
      visible_in: c.clinical?.visible_in, confidence: c.provenance?.confidence,
      properties: this.props.filter(p => p.component === component).map(p => ({ ...describe(p), drawn: this.drawn(p), locked: lockedReason(p.component, p.property) }))
    };
  }

  /** Set one property, replacing an earlier edit of it. Rejects unknown properties and values outside the hard range. */
  set(edit: Edit) {
    const e = { ...edit, value: coerceValue(this.props.find(x => x.component === edit.component && x.property === edit.property), edit.value) as Edit["value"] };
    const error = checkEdit(this.props, e);
    if (error) return { ok: false, error };
    const i = this.edits.findIndex(x => x.component === e.component && x.property === e.property);
    if (i >= 0) this.edits.splice(i, 1);
    this.edits.push({ component: e.component, property: e.property, value: e.value, reason: e.reason });
    const p = this.props.find(x => x.component === e.component && x.property === e.property)!;
    const outside = typeof e.value === "number" && p.normal && (e.value < p.normal[0] || e.value > p.normal[1]);
    return {
      ok: true, was: p.current, now: e.value, unit: p.unit,
      ...(outside && { note: `Outside the normal range ${p.normal![0]}-${p.normal![1]}, as a sign should be.` }),
      ...(!this.drawn(p) && { warning: "The renderer does not draw this property yet, so the trainee will not see it. Look for a drawn property that carries the sign." })
    };
  }

  remove(component: string, property: string) {
    const i = this.edits.findIndex(x => x.component === component && x.property === property);
    if (i < 0) return { ok: false, error: `${component}:${property} has not been set.` };
    this.edits.splice(i, 1);
    return { ok: true };
  }

  /** Range checks and anatomy rules on the edited eye. Info-level notes are kept only for edited properties. */
  validate() {
    const edited = new Set(this.edits.map(e => `${e.component}:${e.property}`));
    const issues = validateEye(this.lib, this.base, this.edits).filter(i => i.level !== "info" || edited.has(i.where));
    const errors = issues.filter(i => i.level === "error");
    return { valid: errors.length === 0, errors, warnings: issues.filter(i => i.level === "warning"), notes: issues.filter(i => i.level === "info") };
  }

  /** What changed and why, with the healthy value and the confidence of each component's calibration. */
  explain() {
    const eye = resolveCase(this.lib, this.base, this.edits);
    return this.edits.map(e => {
      const p = this.props.find(x => x.component === e.component && x.property === e.property);
      return { ...e, was: p?.current, unit: p?.unit, confidence: eye.components.get(e.component)?.provenance?.confidence };
    });
  }

  /** Run one tool by name with the model's arguments. Errors come back as data, so the agent can correct itself. */
  call(name: string, args: Record<string, unknown>): unknown {
    switch (name) {
      case "search_properties": return this.search(String(args.query ?? ""));
      case "read_component": return this.read(String(args.component ?? ""));
      case "set_property": return this.set(args as unknown as Edit);
      case "remove_edit": return this.remove(String(args.component ?? ""), String(args.property ?? ""));
      case "validate": return this.validate();
      case "explain": return this.explain();
      default: return { error: `Unknown tool ${name}.` };
    }
  }
}

function describe(p: PropertyInfo) {
  return { component: p.component, property: p.property, kind: p.kind, unit: p.unit, healthy: p.current, normal: p.normal, hard: p.hard, options: p.options, note: p.note, derived: p.derived, library: p.library };
}

const obj = (properties: object, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const fn = (name: string, description: string, parameters: object): ToolSpec => ({ type: "function", function: { name, description, parameters } });

export const HARNESS_TOOLS: ToolSpec[] = [
  fn("search_properties", "Find drawn eye properties by anatomy, sign or optical effect, e.g. 'conjunctiva injection', 'lens nucleus opacity', 'stroma haze'. Returns component, property, unit, healthy value, normal and hard ranges, and a description.",
    obj({ query: { type: "string" } }, ["query"])),
  fn("read_component", "Open one component (e.g. 'eye.lens.nucleus') with all its properties, units, ranges and where it is seen at the slit lamp.",
    obj({ component: { type: "string" } }, ["component"])),
  fn("set_property", "Set one property of the patient's eye. Rejected if the property does not exist, is locked, is a painted colour, or the value is outside the hard range. Setting it again replaces the earlier value.",
    obj({
      component: { type: "string", description: "Component id, e.g. 'eye.conjunctiva'." },
      property: { type: "string", description: "'facet.property', e.g. 'appearance.injection'." },
      value: {
        description: "A JSON number in the property's unit (not a string), [r, g, b] numbers for a per-channel property, or one of the listed options for a string property.",
        anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 }, { type: "string" }, { type: "boolean" }]
      },
      reason: { type: "string", description: "The clinical sign this produces, in one sentence. The instructor reads it." }
    }, ["component", "property", "value", "reason"])),
  fn("remove_edit", "Undo an earlier set_property, returning the property to healthy.",
    obj({ component: { type: "string" }, property: { type: "string" } }, ["component", "property"])),
  fn("validate", "Check the edited eye: possible ranges and anatomy rules. Fix every error before finishing.", obj({})),
  fn("explain", "List every change so far with its reason and the healthy value.", obj({}))
];
