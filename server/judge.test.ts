// The render judge and the evaluation table, with a scripted model (no API calls).
import { test } from "node:test";
import assert from "node:assert/strict";
import { imageEditBody, requestBody, type ChatRequest, type Model } from "./gateway.ts";
import { compareToIntent, judge } from "./judge.ts";
import { blindCodes, buildBlindSheet, buildTable, weakBuild, type EvalRow } from "../tools/lib/eval-table.ts";

const images = [{ view: "exterior", label: "External", mime: "image/png", base64: "QUJD" }];
const answer = { diagnosis: "Nuclear cataract", severity: "moderate", findings: [{ view: "exterior", finding: "Yellow pupil" }], realism: 3, note: "Lens edge too sharp." };
const scripted = (reply: object): Model & { calls: ChatRequest[] } => {
  const calls: ChatRequest[] = [];
  return Object.assign<Model, { calls: ChatRequest[] }>(async req => {
    calls.push(req);
    return { message: { role: "assistant", content: JSON.stringify(reply) } };
  }, { calls });
};

const row = (over: Partial<EvalRow> = {}): EvalRow => ({
  id: "CAT-001", description: "SECRET-DESCRIPTION", prompt: "SECRET-PROMPT",
  intended: { diagnosis: "Age-related cataract", terms: ["cataract"], severity: "moderate" },
  edits: [{ component: "eye.lens.nucleus", property: "optics.density", value: 0.6, reason: "Nuclear opacity" }, { component: "eye.lens.cortex", property: "optics.spoke_density", value: 0.5, reason: "Spokes" }],
  diagnosis: "cataract", signs: ["Nuclear opacity"], valid: true, steps: 8, flags: [],
  images: { exterior: "images/CAT-001-exterior.png", optic_section_lens: "images/CAT-001-optic_section_lens.png", retroillumination: "images/CAT-001-retroillumination.png" },
  ...over
});

test("images join the last user message in the shape the API takes, and other requests are unchanged", () => {
  const messages = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "look" }];
  const body = requestBody({ purpose: "judge", model: "m", messages, images: [{ mime: "image/png", base64: "QUJD" }] }, false);
  assert.deepEqual(body.messages[0], messages[0]);
  assert.deepEqual(body.messages[1], { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] });
  assert.deepEqual(requestBody({ purpose: "x", model: "m", messages }, false).messages, messages);
});

test("the judge sees the images and view names, and nothing about the intended case", async () => {
  const model = scripted(answer);
  const j = await judge(images, model);
  const req = model.calls[0];
  assert.equal(req.images?.[0].base64, "QUJD");
  const text = req.messages.map(m => m.content).join(" ");
  assert.match(text, /External/);
  assert.doesNotMatch(text, /cataract|blurred|glare|density/i);
  assert.equal(j.diagnosis, "Nuclear cataract");
});

test("a realism score outside 1-5 is brought back into range", async () => {
  assert.equal((await judge(images, scripted({ ...answer, realism: 9 }))).realism, 5);
});

test("the answer is scored against the intent", () => {
  const intended = { diagnosis: "Cataract", terms: ["cataract"], severity: "moderate" as const };
  assert.deepEqual(compareToIntent({ diagnosis: "Nuclear CATARACT", severity: "severe" }, intended), { diagnosis: true, severity: false });
  assert.deepEqual(compareToIntent({ diagnosis: "healthy eye", severity: "none" }, { diagnosis: "Cataract", terms: ["cataract"] }), { diagnosis: false, severity: null });
});

test("a valid build can still be flagged as weak", () => {
  assert.deepEqual(weakBuild({ valid: true, signs: ["x"], edits: row().edits, steps: 8 }), []);
  assert.deepEqual(weakBuild({ valid: true, signs: [], edits: row().edits.slice(0, 1), steps: 30 }), ["hit the step limit", "no signs returned", "only 1 edit"]);
});

test("the table shows Pending until a clinician's review exists, and says so", () => {
  const table = buildTable("Cataract", [row()], {});
  assert.match(table, /No clinical review has happened yet/);
  assert.match(table, /\| Pending \|/);
  assert.match(table, /width="160"/);
});

test("regenerating the table keeps Judge 2 and new AI answers do not touch it", () => {
  const clinical = { "CAT-001": { diagnosis: "Nuclear cataract", realism: 4, usable: "with changes" as const, role: "ophthalmologist" } };
  const first = buildTable("Cataract", [row()], clinical);
  const again = buildTable("Cataract", [row({ judge: { ...answer, severity: "moderate", model: "m", date: "2026-11-03" } })], clinical);
  for (const t of [first, again]) {
    assert.match(t, /Usable for teaching: with changes/);
    assert.doesNotMatch(t, /\| Pending \|/);
    assert.match(t, /Clinical review covers 1 of 1/);
  }
});

test("the blind sheet leaks no descriptions, prompts, IDs or AI answers", () => {
  const r = row({ judge: { ...answer, severity: "moderate", model: "m", date: "2026-11-03" } });
  const { markdown, copies } = buildBlindSheet([r], blindCodes([r]));
  assert.doesNotMatch(markdown, /SECRET|CAT-001|Nuclear cataract|moderate/);
  assert.equal(copies.length, 3);
  for (const c of copies) assert.doesNotMatch(c.to, /CAT/);
});

test("the table shows the prompt and labels the normal-eye Muse Image as an illustration", () => {
  const table = buildTable("Cataract", [row({ edited: { image: "images/CAT-001-muse-image-normal-eye.png", prompt: "p" } })], {});
  assert.match(table, /SECRET-PROMPT/);
  assert.match(table, /Muse Image from normal eye \(AI illustration\)/);
  assert.doesNotMatch(table, /\| Muse Image \(AI illustration\)/);
  assert.match(table, /not a clinical reference/);
  assert.match(table, /images\/CAT-001-muse-image-normal-eye\.png/);
  assert.match(buildTable("Cataract", [row({ edited: { prompt: "p", error: "blocked" } })], {}), /Not generated/);
});

test("the image edit sends the normal eye as a data URL, with web and image search off", () => {
  const body = imageEditBody("change it", Buffer.from("ABC"));
  assert.deepEqual(body.images, [{ image_url: "data:image/png;base64,QUJD" }]);
  assert.equal(body.output_format, "png");
  assert.equal(body.tool_enablement.enable_image_search, false);
  assert.equal(body.tool_enablement.enable_web_search, false);
});

test("the blind sheet leaves out the Muse Image picture", () => {
  const r = row({ edited: { image: "images/CAT-001-muse-image-normal-eye.png", prompt: "p" } });
  const { markdown, copies } = buildBlindSheet([r], blindCodes([r]));
  assert.doesNotMatch(markdown, /muse-image/i);
  assert.ok(copies.every(c => !c.from.includes("muse-image")));
});

test("blind codes are unique and stay the same once given", () => {
  const a = row(), b = row({ id: "CAT-002" });
  const codes = blindCodes([a]);
  const more = blindCodes([a, b], codes);
  assert.equal(more["CAT-001"], codes["CAT-001"]);
  assert.notEqual(more["CAT-001"], more["CAT-002"]);
});
