// In-memory sessions (hackathon scale): the base case, the agent's edits, the patient and the hidden answer.
// A session lives while the server runs; nothing is written to disk.
import { randomUUID } from "node:crypto";
import type { Case } from "../src/model/generated.ts";
import type { Library } from "../src/model/library.ts";
import { baseCase, type Subject } from "./harness.ts";
import type { CaseResult } from "./case-agent.ts";
import type { CaseBrief, PatientState } from "./patient.ts";

/** Where a session's eye came from, which the exam screen states: a stored case, one a typed prompt matched, the agent's own build, or a stored case standing in because the build failed. */
export type CaseOrigin = "stored" | "matched" | "generated" | "fallback";

export interface Session {
  id: string;
  created: number;
  origin: CaseOrigin;
  /** The typed description, or the stored case it was opened from. */
  source: { prompt: string } | { caseId: string };
  base: Case;
  /** The agent's edits over the base; empty for a stored case. */
  result: Pick<CaseResult, "edits" | "diagnosis" | "signs" | "valid">;
  patient?: PatientState;
}

const sessions = new Map<string, Session>();
/** Sessions expire after a while and the oldest go first when too many are open, so memory stays bounded. */
const TTL_MS = Number(process.env.SESSION_TTL_MINUTES ?? 120) * 60_000;
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS ?? 500);

const add = (s: Omit<Session, "id" | "created">): Session => {
  const now = Date.now();
  for (const [id, old] of sessions) if (now - old.created > TTL_MS) sessions.delete(id);
  while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);   // Map iterates oldest first
  const session = { id: randomUUID(), created: now, ...s };
  sessions.set(session.id, session);
  return session;
};

export const createSession = (lib: Library, prompt: string, result: CaseResult) =>
  add({ origin: "generated", source: { prompt }, base: baseCase(lib, result.intent), result });

/** A stored case from eye-model/cases: chosen directly, matched from a typed prompt, or the fallback when the agent fails.
 *  A matched or fallback case takes the patient the trainee described; a match keeps the prompt as its source. */
export function caseSession(lib: Library, caseId: string, opts: { origin?: CaseOrigin; prompt?: string; subject?: Partial<Pick<Subject, "age" | "sex" | "eye">> } = {}): Session | undefined {
  const found = lib.cases.find(c => c.id === caseId);
  if (!found) return;
  const eye = opts.subject?.eye === "OD" || opts.subject?.eye === "OS" ? opts.subject.eye : found.subject.eye;
  const kase = opts.subject ? { ...found, subject: { ...found.subject, ...opts.subject, eye } } : found;
  const signs = (kase.diseases ?? []).map(d => {
    const disease = lib.diseases.find(x => x.id === d.id);
    return `${disease?.name ?? d.id}, grade ${d.grade}: ${disease?.summary ?? ""}`;
  });
  const { answer, ...base } = structuredClone(kase);
  return add({ origin: opts.origin ?? "stored", source: opts.origin === "matched" && opts.prompt ? { prompt: opts.prompt } : { caseId }, base, result: { edits: [], diagnosis: answer?.diagnosis ?? kase.title, signs, valid: true } });
}

export function getSession(id: string): Session | undefined {
  const s = sessions.get(id);
  if (s && Date.now() - s.created > TTL_MS) { sessions.delete(id); return; }
  return s;
}

/** What the patient's fact writer is told. Stays on the server. */
export function briefFor(s: Session, intentEye?: string): CaseBrief {
  const sub = s.base.subject ?? {};
  const eye = intentEye === "OD" || intentEye === "OS" ? intentEye : sub.eye === "OS" ? "OS" : "OD";
  return {
    age: sub.age ?? 60, sex: sub.sex === "male" ? "male" : "female", eye,
    diagnosis: s.result.diagnosis, signs: s.result.signs,
    ...("prompt" in s.source && { prompt: s.source.prompt })
  };
}

/** What the browser needs to draw the eye. Reasons and the diagnosis stay on the server. */
export function publicEye(s: Session) {
  return {
    id: s.id,
    origin: s.origin,
    subject: s.base.subject,
    base: s.base,
    edits: s.result.edits.map(({ component, property, value }) => ({ component, property, value, reason: "case" }))
  };
}
