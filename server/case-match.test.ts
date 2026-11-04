// Matching a prompt to a stored case, from metadata and scripted sign scores (no API calls).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLibrary } from "../tools/lib/library.ts";
import { buildFailed } from "./case-agent.ts";
import { CaseIndex, MATCHABLE_CASES } from "./case-match.ts";
import { SIGNS, caseVector } from "./signs.ts";
import { caseSession, publicEye } from "./session.ts";

const lib = loadLibrary();
const index = new CaseIndex(lib);
const kase = (id: string) => lib.cases.find(c => c.id === id)!;
const healthy = kase("reference_black_brown");
const sign = (id: string, name: string) => caseVector(lib, kase(id), healthy)[SIGNS.findIndex(s => s.sign === name)];

test("a case's vector comes from its metadata, scaled against the library", () => {
  assert.equal(sign("reference_black_brown", "nuclear_opacity"), 0);
  assert.equal(sign("ns4", "nuclear_opacity"), 1);
  assert.ok(sign("ns2", "nuclear_opacity") > 0.2 && sign("ns2", "nuclear_opacity") < 0.7);
  assert.equal(sign("aacg", "shallow_chamber"), 1);
  assert.equal(sign("conjunctivitis", "shallow_chamber"), 0);
});

test("the signs choose the closest case within the named disease", () => {
  assert.equal(index.find({ condition: "age-related nuclear cataract", signs: { nuclear_opacity: 0.45 } })?.caseId, "ns2");
  assert.equal(index.find({ condition: "dense nuclear cataract", signs: { nuclear_opacity: 1, cortical_spokes: 0.2 } })?.caseId, "ns4");
  assert.equal(index.find({ condition: "bacterial conjunctivitis", signs: { conjunctival_redness: 0.7, discharge: 0.6 } })?.caseId, "conjunctivitis");
  assert.equal(index.find({ condition: "acute angle closure glaucoma", signs: { ciliary_flush: 1, corneal_haze: 1, shallow_chamber: 1, conjunctival_redness: 0.3 } })?.caseId, "aacg");
});

test("every matchable case has its own place in sign space, so none shadows another", () => {
  const vectors = MATCHABLE_CASES.map(id => [id, caseVector(lib, kase(id), healthy)] as const);
  assert.equal(new Set(MATCHABLE_CASES).size, MATCHABLE_CASES.length);
  for (const [i, [a, va]] of vectors.entries()) for (const [b, vb] of vectors.slice(i + 1)) {
    const d = Math.hypot(...va.map((x, k) => x - vb[k]));
    assert.ok(d > 0.2, `${a} and ${b} are only ${d.toFixed(2)} apart`);
  }
});

test("each nuclear and cortical grade finds its own case", () => {
  const find = (condition: string, signs: object) => index.find({ condition, signs })?.caseId;
  assert.equal(find("age-related nuclear cataract", { nuclear_opacity: 0.2 }), "ns1");
  assert.equal(find("age-related nuclear cataract", { nuclear_opacity: 0.44 }), "ns2");
  assert.equal(find("age-related nuclear cataract", { nuclear_opacity: 0.7 }), "ns3");
  assert.equal(find("age-related nuclear cataract", { nuclear_opacity: 1, cortical_spokes: 0.25 }), "ns4");
  assert.equal(find("cortical cataract", { cortical_spokes: 0.5 }), "cc2");
  assert.equal(find("cortical cataract", { cortical_spokes: 1 }), "cc4");
});

test("a similar-looking disease that is not named is no match", () => {
  assert.equal(index.find({ condition: "anterior uveitis", signs: { ciliary_flush: 1, corneal_haze: 1, shallow_chamber: 1 } }), null);
});

test("a different type of the same disease is no match, even with close signs", () => {
  assert.equal(index.find({ condition: "posterior subcapsular cataract", signs: { nuclear_opacity: 0.4 } }), null);
  assert.equal(index.find({ condition: "cortical cataract", signs: { nuclear_opacity: 0.4 } }), null);
  assert.equal(index.find({ condition: "viral conjunctivitis", signs: { conjunctival_redness: 0.7, discharge: 0.6 } }), null);
  assert.equal(index.find({ condition: "acute angle-closure glaucoma", signs: { ciliary_flush: 1, corneal_haze: 1, shallow_chamber: 1, conjunctival_redness: 0.3 } })?.caseId, "aacg");
});

test("the right disease with signs too far away is no match", () => {
  assert.equal(index.find({ condition: "nuclear cataract", signs: { nuclear_opacity: 1, cortical_spokes: 1, posterior_subcapsular_opacity: 1 } }), null);
});

test("the fallback returns the nearest case whatever its disease", () => {
  assert.equal(index.nearest({ ciliary_flush: 1, corneal_haze: 1, shallow_chamber: 1 }).caseId, "aacg");
  assert.ok(index.nearest().caseId);
});

test("a failed build is caught whatever its range checks say, and a single edit is allowed", () => {
  const edit = { component: "eye.lens.nucleus", property: "optics.density", value: 0.2, reason: "x" };
  assert.equal(buildFailed({ valid: true, signs: ["x"], edits: [edit] }), false);
  assert.equal(buildFailed({ valid: true, signs: [], edits: [edit] }), true);
  assert.equal(buildFailed({ valid: true, signs: ["x"], edits: [] }), true);
  assert.equal(buildFailed({ valid: false, signs: ["x"], edits: [edit] }), true);
});

test("a matched session takes the described patient and keeps the answer on the server", () => {
  const s = caseSession(lib, "ns2", { origin: "matched", prompt: "a typed case", subject: { age: 66, sex: "male", eye: "OS" } })!;
  assert.deepEqual([s.base.subject.age, s.base.subject.sex, s.base.subject.eye], [66, "male", "OS"]);
  assert.equal(s.origin, "matched");
  assert.ok("prompt" in s.source);
  assert.equal(publicEye(s).origin, "matched");
  assert.doesNotMatch(JSON.stringify(publicEye(s)), /"answer"/);
});

test("the answer key names the eye the session has, not the stored case's", () => {
  const diagnosis = (id: string, eye?: "OD" | "OS") => caseSession(lib, id, { subject: { eye } })!.result.diagnosis;
  assert.equal(diagnosis("ns2", "OS"), "Age-related nuclear cataract, grade 2, left eye");
  assert.equal(diagnosis("ns3", "OD"), "Age-related nuclear cataract, grade 3, right eye");
  assert.equal(diagnosis("poag", "OS"), "Primary open-angle glaucoma, left eye (moderate)");
  assert.equal(diagnosis("ns2"), "Age-related nuclear cataract, grade 2, right eye", "no eye described: the case's own");
  assert.equal(caseSession(lib, "ns3")!.result.diagnosis, "Age-related nuclear cataract, grade 3, left eye");
});
