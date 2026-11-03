// Finds the stored case closest to a typed prompt: SQLite with the sqlite-vec extension, in memory and rebuilt from
// eye-model/ when the server starts. It holds case IDs and sign vectors only; the numbers stay in the metadata.
// The condition the prompt names chooses the disease, then the signs choose the case, and anything further away than
// MAX_DISTANCE is no match, so a prompt is never forced onto the nearest case. A distance alone cannot tell similar
// diseases apart: a correct match and a wrong one measured the same on real prompts, so the name has to fit first.
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import type { Library } from "../src/model/library.ts";
import { BASE_CASE_ID } from "./harness.ts";
import { SIGNS, caseVector, scoresToVector, type SignScores } from "./signs.ts";

/** The stored cases with signs at the front of the eye: the hackathon's scenarios and the nuclear and cortical grades. */
export const MATCHABLE_CASES = ["aacg", "conjunctivitis", "ns1", "ns2", "ns3", "ns4", "cc2", "cc4"];
/** Euclidean distance in sign space. Render-calibrated on a small prompt set; not clinically validated. */
export const MAX_DISTANCE = 0.6;

export interface CaseMatch { caseId: string; distance: number }
export interface MatchQuery { condition: string; signs?: SignScores }

const GENERIC = new Set(["acute", "chronic", "primary", "right", "left", "both", "eye", "eyes", "with", "disease", "related", "unknown", "severe", "moderate", "mild", "early", "advanced", "grade"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3 && !GENERIC.has(w));
const bytes = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

export class CaseIndex {
  private readonly db = new DatabaseSync(":memory:", { allowExtension: true });
  /** Words naming each case's main disease: a secondary finding, like aacg's mild cataract, does not make it a match. */
  private readonly names = new Map<string, Set<string>>();

  constructor(lib: Library, ids = MATCHABLE_CASES) {
    sqliteVec.load(this.db);
    this.db.enableLoadExtension(false);
    this.db.exec(`CREATE VIRTUAL TABLE case_signs USING vec0(case_id TEXT PRIMARY KEY, signs FLOAT[${SIGNS.length}])`);
    const healthy = lib.cases.find(c => c.id === BASE_CASE_ID)!;
    const insert = this.db.prepare("INSERT INTO case_signs (case_id, signs) VALUES (?, ?)");
    for (const id of ids) {
      const kase = lib.cases.find(c => c.id === id);
      if (!kase) throw new Error(`Matchable case ${id} is missing from eye-model/cases.`);
      insert.run(id, bytes(caseVector(lib, kase, healthy)));
      const disease = lib.diseases.find(d => d.id === kase.diseases[0]?.id);
      this.names.set(id, new Set(words(`${kase.title} ${disease?.name ?? ""} ${disease?.id ?? ""}`)));
    }
  }

  /** Every case, nearest first. */
  private ranked(signs?: SignScores): CaseMatch[] {
    return (this.db.prepare("SELECT case_id, distance FROM case_signs WHERE signs MATCH ? AND k = ? ORDER BY distance")
      .all(bytes(scoresToVector(signs)), this.names.size) as { case_id: string; distance: number }[])
      .map(r => ({ caseId: r.case_id, distance: r.distance }));
  }

  /** The closest case for this condition, or null when none is close enough. */
  find({ condition, signs }: MatchQuery): CaseMatch | null {
    const named = words(condition);
    // every word must fit: "cortical cataract" is not the nuclear case, and "viral conjunctivitis" is not the bacterial one
    const best = this.ranked(signs).find(m => named.every(w => this.names.get(m.caseId)!.has(w)));
    return best && best.distance <= MAX_DISTANCE ? best : null;
  }

  /** The nearest case whatever its disease: the fallback when the agent fails, which the trainee is told about. */
  nearest(signs?: SignScores): CaseMatch { return this.ranked(signs)[0]; }
}
