// Case agent: a prompt becomes a structured intent, then a tool loop over the harness sets the
// properties that carry the disease. It ends with `finish`, which is accepted only on a valid eye.
import type { Library } from "../src/model/library.ts";
import type { Edit } from "../src/model/edits.ts";
import { HARNESS_TOOLS, Harness, baseCase } from "./harness.ts";
import { MODELS, type Message, type Model, type ToolSpec } from "./gateway.ts";
import { SIGNS, type SignScores } from "./signs.ts";

export interface Intent {
  age: number;
  sex: "female" | "male";
  eye: "OD" | "OS" | "unknown";
  symptoms: string[];
  duration: string;
  severity: "mild" | "moderate" | "severe" | "unknown";
  /** The condition the prompt names or implies, in the author's words. */
  condition: string;
  /** How strongly the slit lamp would show each sign, 0 to 1 (server/signs.ts). */
  signs?: SignScores;
}

export interface CaseResult {
  intent: Intent;
  edits: Edit[];
  diagnosis: string;
  signs: string[];
  valid: boolean;
  steps: number;
  transcript: Message[];
}

/** `subject` is the age and sex the trainee chose on the form; it overrides whatever the prompt implied. */
export interface AgentOptions { model: Model; subject?: Pick<Intent, "age" | "sex">; maxSteps?: number; maxFinishRetries?: number; onStep?: (s: string) => void; intent?: Intent }

/** A build that must not reach a trainee, whatever its range checks say. A single edit can be right for an early grade. */
export const buildFailed = (r: Pick<CaseResult, "valid" | "signs" | "edits">) => !r.valid || !r.signs.length || !r.edits.length;

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    age: { type: "integer", minimum: 18, maximum: 100 },
    sex: { enum: ["female", "male"] },
    eye: { enum: ["OD", "OS", "unknown"] },
    symptoms: { type: "array", items: { type: "string" } },
    duration: { type: "string" },
    severity: { enum: ["mild", "moderate", "severe", "unknown"] },
    condition: { type: "string" },
    signs: {
      type: "object",
      properties: Object.fromEntries(SIGNS.map(s => [s.sign, { type: "number", minimum: 0, maximum: 1 }])),
      required: SIGNS.map(s => s.sign),
      additionalProperties: false
    }
  },
  required: ["age", "sex", "eye", "symptoms", "duration", "severity", "condition", "signs"],
  additionalProperties: false
};

const MAX_VISION = 40;

/** The case description with the vision the author entered, so every agent reading the description sees it. */
export function withVision(prompt: string, vision: unknown): string {
  const raw = (vision ?? {}) as { right?: unknown; left?: unknown };
  const read = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_VISION) : "");
  const right = read(raw.right), left = read(raw.left);
  if (!right && !left) return prompt;
  return `${prompt}\nMeasured vision: right eye ${right || "not recorded"}; left eye ${left || "not recorded"}.`;
}

export async function readIntent(prompt: string, model: Model): Promise<Intent> {
  const { message } = await model({
    purpose: "case.intent", model: MODELS.case, temperature: 0, reasoning: "low",
    json: { name: "intent", schema: INTENT_SCHEMA },
    messages: [
      { role: "system", content: "Extract a patient description for an eye-clinic training case as JSON. If age or sex is not given, choose a plausible adult for the condition. 'condition' is the eye condition the description names or most likely implies, in plain clinical words. Use 'unknown' when the eye or severity is not stated. 'signs' scores how strongly a slit lamp would show each sign in this eye: 0 absent, 0.3 mild, 0.6 moderate, 1 the most severe form; use 0 for a sign this condition does not cause. When the description gives measured vision, judge what that vision means for this condition and let it decide 'severity' and the sign scores, even where the description's words suggest otherwise. If the description names no affected eye, the clearly worse-seeing eye is the affected one." },
      { role: "user", content: prompt }
    ]
  });
  return parseJson<Intent>(message.content ?? "");
}

const FINISH: ToolSpec = {
  type: "function",
  function: {
    name: "finish",
    description: "Call once the eye shows the condition and validate reports no errors.",
    parameters: {
      type: "object",
      properties: {
        diagnosis: { type: "string", description: "The diagnosis this eye shows." },
        signs: { type: "array", items: { type: "string" }, description: "Each sign placed, and the slit-lamp view that shows it." }
      },
      required: ["diagnosis", "signs"],
      additionalProperties: false
    }
  }
};

function systemPrompt(lib: Library): string {
  const components = lib.components.map(c => `- ${c.id}: ${c.summary ?? ""}`).join("\n");
  return `You build a virtual patient's eye for a slit-lamp training simulator.
The eye starts healthy. You change it only through the tools, by setting physical properties: scatter, absorption, opacity, thickness, depth, position, vessel engorgement. Never paint colours. Every finding must come from a property, so it looks right in every slit-lamp view.

Work like this:
1. Decide which signs the condition shows at the slit lamp at the given severity. When the description gives measured vision, the severity already reflects it, and the signs you place must plausibly explain that vision.
2. For each sign, search_properties or read_component to find the property that carries it. Use only properties that exist; if a sign has no property, leave it out and do not fake it with another.
3. set_property with a value inside the hard range, sized to the severity, and a one-sentence reason naming the sign. Where a property lists library values, those are calibrated disease grades: size yours against them, not against the hard range, which is only what is physically possible.
4. validate, fix every error, then finish.
Keep the eye otherwise healthy: change only what the condition needs.

Components of the eye:
${components}`;
}

export async function runCaseAgent(lib: Library, prompt: string, opts: AgentOptions): Promise<CaseResult> {
  const { model, maxSteps = 30, maxFinishRetries = 3, onStep = () => {} } = opts;
  onStep("Reading the prompt");
  const intent = opts.intent ?? { ...await readIntent(prompt, model), ...opts.subject };
  const harness = new Harness(lib, baseCase(lib, intent));

  const messages: Message[] = [
    { role: "system", content: systemPrompt(lib) },
    { role: "user", content: `Patient: ${JSON.stringify(intent)}\nOriginal description: ${prompt}` }
  ];
  onStep("Building the eye");
  let finishTries = 0;
  for (let step = 1; step <= maxSteps; step++) {
    const { message } = await model({ purpose: "case.agent", model: MODELS.case, messages, tools: [...HARNESS_TOOLS, FINISH] });
    messages.push({ role: "assistant", content: message.content ?? null, ...(message.tool_calls?.length && { tool_calls: message.tool_calls }) });
    const calls = message.tool_calls ?? [];
    if (!calls.length) {
      messages.push({ role: "user", content: "Continue with the tools, and call finish when the eye is valid." });
      continue;
    }
    for (const call of calls) {
      let args: Record<string, unknown>;
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; }
      catch { messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Arguments were not valid JSON." }) }); continue; }

      if (call.function.name === "finish") {
        onStep("Checking it");
        const check = harness.validate();
        if (check.valid || ++finishTries > maxFinishRetries) {
          return { intent, edits: harness.edits, diagnosis: String(args.diagnosis ?? intent.condition), signs: (args.signs as string[]) ?? [], valid: check.valid, steps: step, transcript: messages };
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ accepted: false, ...check }) });
        continue;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(harness.call(call.function.name, args)) });
    }
  }
  const check = harness.validate();
  return { intent, edits: harness.edits, diagnosis: intent.condition, signs: [], valid: check.valid, steps: maxSteps, transcript: messages };
}

/** JSON from a model reply, tolerating a code fence or text around the object. */
export function parseJson<T>(text: string): T {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Expected JSON, got: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}
