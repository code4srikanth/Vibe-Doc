// npm run test:server
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLibrary } from "../tools/lib/library.ts";
import { resolveCase } from "../src/model/resolve.ts";
import { Harness, baseCase } from "./harness.ts";
import { runCaseAgent } from "./case-agent.ts";
import type { ChatReply, Model } from "./gateway.ts";

const lib = loadLibrary();
const harness = () => new Harness(lib, baseCase(lib, { age: 65, sex: "male" }));
const set = (h: Harness, component: string, property: string, value: unknown, reason = "test sign") =>
  h.set({ component, property, value: value as number, reason });

test("search finds a property by its description", () => {
  const top = harness().search("nucleus opacity").matches.slice(0, 3).map(m => `${m.component}:${m.property}`);
  assert.ok(top.includes("eye.lens.nucleus:optics.density"), top.join(", "));
});

test("read returns a component's properties with ranges", () => {
  const r = harness().read("eye.conjunctiva") as { properties: { property: string; hard?: number[] }[] };
  assert.deepEqual(r.properties.find(p => p.property === "appearance.injection")?.hard, [0, 1]);
  assert.ok("error" in harness().read("eye.nope"));
});

test("a property lists the values the library's diseases set, as a calibrated scale", () => {
  const r = harness().read("eye.cornea.stroma") as { properties: { property: string; library?: string[] }[] };
  assert.deepEqual(r.properties.find(p => p.property === "optics.haze")?.library, ["Acute primary angle closure, grade attack: 0.35"]);
});

test("set rejects what the schema does not allow", () => {
  const h = harness();
  assert.match(set(h, "eye.nope", "optics.density", 0.5).error!, /no component/);
  assert.match(set(h, "eye.lens.nucleus", "optics.glow", 0.5).error!, /no settable property/);
  assert.match(set(h, "eye.lens.nucleus", "optics.density", 5).error!, /outside the possible range/);
  assert.match(set(h, "eye.lens.nucleus", "optics.density", "dense").error!, /takes a number/);
  assert.match(set(h, "eye.lens.nucleus", "optics.scatter_colour", [1, 0.5, 0.2]).error!, /painted colour/);
  assert.match(set(h, "eye.adnexa.upper_lid", "anatomy.margin_height", 3).error!, /lid photograph/);
  assert.match(set(h, "eye.lens", "optics.diffuse_scatter_gain", 0.8).error!, /render calibration/);
  assert.match(set(h, "eye.lens.nucleus", "optics.milky_scatter", 1).error!, /render calibration/);
  assert.match(set(h, "eye.cornea", "anatomy.central_thickness", 0.7).error!, /derived from .*stroma:anatomy.thickness/);
  assert.match(set(h, "eye.lens.nucleus", "optics.density", 0.5, " ").error!, /reason/);
  assert.equal(h.edits.length, 0);
});

test("search shows only drawn properties, and set warns about an undrawn one", () => {
  const h = harness();
  assert.ok(!h.search("tear film thickness").matches.some(m => m.property === "anatomy.thickness" && m.component === "eye.tear_film"));
  assert.ok(h.drawn({ component: "eye.pupil", property: "physiology.light_reflex" }));
  assert.match(String((set(h, "eye.tear_film", "anatomy.thickness", 0.004) as { warning?: string }).warning), /does not draw/);
  assert.match(set(h, "eye.globe", "physiology.gaze_horizontal", 10).error!, /gaze belongs to the patient/);
});

test("set converts numbers sent as text, and string properties take only known options", () => {
  const h = harness();
  assert.equal(set(h, "eye.lens.nucleus", "optics.density", "0.65").ok, true);
  assert.equal(h.edits[0].value, 0.65);
  assert.match(set(h, "eye.pupil", "physiology.light_reflex", "sluggish").error!, /one of: brisk, fixed/);
  assert.equal(set(h, "eye.pupil", "physiology.light_reflex", "fixed").ok, true);
  assert.match(set(h, "eye.iris", "appearance.colour", "blue").error!, /one of: black_brown./);
});

test("set replaces an earlier edit, remove undoes it", () => {
  const h = harness();
  assert.equal(set(h, "eye.conjunctiva", "appearance.injection", 0.4).ok, true);
  assert.equal(set(h, "eye.conjunctiva", "appearance.injection", 0.7).ok, true);
  assert.deepEqual(h.edits.map(e => e.value), [0.7]);
  assert.equal(h.remove("eye.conjunctiva", "appearance.injection").ok, true);
  assert.equal(h.edits.length, 0);
});

test("edits resolve with their reasons, and validate passes on a plausible eye", () => {
  const h = harness();
  set(h, "eye.lens.nucleus", "optics.density", 0.6, "Brown nuclear opacity");
  set(h, "eye.conjunctiva", "appearance.injection", 0.5, "Red eye");
  const eye = resolveCase(lib, h.base, h.edits);
  assert.equal(eye.num("eye.lens.nucleus", "optics.density"), 0.6);
  assert.equal(eye.changed.get("eye.lens.nucleus:optics.density"), "Brown nuclear opacity");
  const v = h.validate();
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  assert.equal(h.explain().length, 2);
});

test("agent loop: a rejected value comes back as an error, the agent corrects it and finishes valid", async () => {
  const replies: ChatReply["message"][] = [
    { role: "assistant", content: JSON.stringify({ age: 70, sex: "female", eye: "OD", symptoms: ["blur"], duration: "2 years", severity: "moderate", condition: "nuclear cataract" }) },
    { role: "assistant", content: null, tool_calls: [call("1", "set_property", { component: "eye.lens.nucleus", property: "optics.density", value: 3, reason: "Nuclear opacity" })] },
    { role: "assistant", content: null, tool_calls: [call("2", "set_property", { component: "eye.lens.nucleus", property: "optics.density", value: 0.6, reason: "Nuclear opacity" })] },
    { role: "assistant", content: null, tool_calls: [call("3", "finish", { diagnosis: "Nuclear cataract", signs: ["Brown nucleus in the optic section"] })] }
  ];
  const seen: string[] = [];
  const model: Model = async req => {
    const last = req.messages.at(-1)!;
    if (last.role === "tool") seen.push(last.content);
    return { message: replies.shift()! };
  };
  const r = await runCaseAgent(lib, "70-year-old woman, slowly blurring vision", { model });
  assert.match(seen[0], /outside the possible range/);
  assert.equal(r.valid, true);
  assert.equal(r.diagnosis, "Nuclear cataract");
  assert.equal(r.intent.age, 70);
  assert.deepEqual(r.edits.map(e => [e.property, e.value]), [["optics.density", 0.6]]);
});

function call(id: string, name: string, args: object) {
  return { id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } };
}
