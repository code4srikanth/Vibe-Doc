// The render judge (npm run review): looks at an eye's renders and says what it sees. It gets the images and the view
// names only, never the prompt, the diagnosis or the values, so its answer can be scored against the intent afterwards.
// An AI opinion on a render, not clinical validation.
import { MODELS, type Model } from "./gateway.ts";
import { parseJson } from "./case-agent.ts";

export interface JudgeImage { view: string; label: string; mime: string; base64: string }

const SEVERITIES = ["none", "mild", "moderate", "severe", "unknown"] as const;
export type Severity = typeof SEVERITIES[number];

export interface Judgement {
  diagnosis: string;
  severity: Severity;
  findings: { view: string; finding: string }[];
  /** 1 = misleading for a trainee, 5 = indistinguishable from a real photograph. */
  realism: number;
  note: string;
  model: string;
  date: string;
}

/** What the prompt was meant to produce. Never sent to the judge. */
export interface Intended { diagnosis: string; terms: string[]; severity?: Severity }
export interface Match { diagnosis: boolean; severity: boolean | null }

const SCHEMA = {
  type: "object",
  properties: {
    diagnosis: { type: "string", description: "The most likely diagnosis from what is visible, or 'healthy eye'." },
    severity: { enum: [...SEVERITIES] },
    findings: {
      type: "array",
      items: { type: "object", properties: { view: { type: "string" }, finding: { type: "string" } }, required: ["view", "finding"], additionalProperties: false }
    },
    realism: { type: "integer", minimum: 1, maximum: 5 },
    note: { type: "string", description: "The most important thing that looks wrong or unrealistic, in one sentence." }
  },
  required: ["diagnosis", "severity", "findings", "realism", "note"],
  additionalProperties: false
};

export async function judge(images: JudgeImage[], model: Model): Promise<Judgement> {
  const { message } = await model({
    purpose: "judge", model: MODELS.judge, temperature: 0, reasoning: "medium",
    json: { name: "judgement", schema: SCHEMA },
    images: images.map(({ mime, base64 }) => ({ mime, base64 })),
    messages: [
      {
        role: "system", content: `You are a consultant ophthalmologist judging rendered images of one eye from a slit-lamp training simulator.
Rules:
- Judge only what is visible in the images. You have no history for this patient, and the eye may be healthy.
- Give one finding per view, in clinical terms. Say so when a view shows nothing abnormal, or when a sign you would expect cannot be judged.
- Give the most likely diagnosis and its severity, using "unknown" when the images do not show enough.
- Realism: 5 is indistinguishable from a real photograph at that view, 3 is recognisable but clearly rendered, 1 would mislead a trainee.`
      },
      { role: "user", content: `The images of this eye, in order:\n${images.map((im, i) => `${i + 1}. ${im.label} (view: ${im.view})`).join("\n")}` }
    ]
  });
  const raw = parseJson<Omit<Judgement, "model" | "date">>(message.content ?? "");
  return { ...raw, realism: Math.max(1, Math.min(5, Math.round(Number(raw.realism) || 1))), model: MODELS.judge, date: new Date().toISOString().slice(0, 10) };
}

/** Scores the judge's answer against the intent, outside the model. Severity is null when the prompt did not set one. */
export function compareToIntent(j: Pick<Judgement, "diagnosis" | "severity">, intended: Intended): Match {
  const said = j.diagnosis.toLowerCase();
  return {
    diagnosis: intended.terms.some(t => said.includes(t.toLowerCase())),
    severity: intended.severity ? j.severity === intended.severity : null
  };
}
