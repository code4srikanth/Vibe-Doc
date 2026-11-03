// The patient's guards and turn handling, with a scripted model (no API calls).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatReply, ChatRequest, StreamModel, StreamPart } from "./gateway.ts";
import { createPatient, forbiddenTerms, greet, guard, patientPrompt, talk, type CaseBrief, type PatientEvent, type PatientFacts } from "./patient.ts";

const brief: CaseBrief = { age: 62, sex: "female", eye: "OD", diagnosis: "Acute primary angle closure, right eye", signs: ["hazy cornea", "mid-dilated pupil"] };
const facts: PatientFacts = {
  name: "Mary Jones", occupation: "retired teacher",
  persona: { speech: "polite, short sentences", anxiety: "very worried", pain_tolerance: "average" },
  chief_complaint: "My right eye has been very painful and red since last night.",
  facts: [
    { topic: "halos_glare", answer: "I saw rainbow rings around the lights.", red_flag: true },
    { topic: "family_history", answer: "My mother had glaucoma.", red_flag: false },
    { topic: "discharge", answer: "No, nothing like that.", red_flag: false }
  ]
};

/** A model that streams the given text in small pieces, then the given tool calls. */
const scripted = (text: string, tools: { name: string; args: object }[] = []): StreamModel & { calls: ChatRequest[] } => {
  const calls: ChatRequest[] = [];
  const model = async function* (req: ChatRequest): AsyncGenerator<StreamPart> {
    calls.push(structuredClone(req));
    for (let i = 0; i < text.length; i += 7) yield { type: "text", text: text.slice(i, i + 7) };
    const tool_calls = tools.map((t, i) => ({ id: `c${i}`, type: "function" as const, function: { name: t.name, arguments: JSON.stringify(t.args) } }));
    const reply: ChatReply = { message: { role: "assistant", content: text || null, ...(tool_calls.length && { tool_calls }) } };
    yield { type: "done", reply, firstTextMs: 1 };
  };
  return Object.assign(model, { calls });
};

const run = async (said: string, model: StreamModel) => {
  const p = createPatient(facts, brief);
  const events: PatientEvent[] = [];
  for await (const e of talk(p, said, model)) events.push(e);
  return { p, events, says: events.flatMap(e => e.type === "say" ? [e.text] : []) };
};

test("the patient greets first, once, in the history but not as something the trainee asked", () => {
  const p = createPatient(facts, brief);
  const hello = greet(p);
  assert.equal(hello, "Hello, doctor. I'm Mary. My right eye has been very painful and red since last night.");
  assert.equal(greet(p), hello);
  assert.deepEqual(p.messages.slice(1), [{ role: "assistant", content: hello }]);
});

test("a greeting that would name the diagnosis is replaced", () => {
  const p = createPatient({ ...facts, chief_complaint: "I have angle closure." }, brief);
  assert.doesNotMatch(greet(p), /angle closure/);
});

test("the diagnosis and clinical terms are forbidden, but words from the patient's own history are not", () => {
  const f = forbiddenTerms(brief.diagnosis, facts);
  assert.ok(f.includes("angle") && f.includes("closure") && f.includes("cataract"));
  assert.ok(!f.includes("glaucoma"), "the mother's glaucoma is part of the history");
  assert.ok(!f.includes("acute") && !f.includes("right"));
});

test("a sentence naming the diagnosis is replaced", () => {
  const f = forbiddenTerms(brief.diagnosis, facts);
  assert.notEqual(guard("I think it is angle closure.", f), "I think it is angle closure.");
  assert.notEqual(guard("Is it a cataract?", f), "Is it a cataract?");
  assert.equal(guard("It hurts a lot.", f), "It hurts a lot.");
});

test("replies stream sentence by sentence", async () => {
  const { says, events } = await run("What brings you in?", scripted("My right eye hurts. It started last night!"));
  assert.deepEqual(says, ["My right eye hurts.", "It started last night!"]);
  assert.equal(events.at(-1)!.type, "done");
});

test("a blocked sentence is not kept in the history, so the model does not build on it", async () => {
  const { p, says } = await run("What do you think it is?", scripted("Maybe it is angle closure. It really hurts."));
  assert.equal(says.length, 2);
  assert.match(says[0], /not sure/);
  const last = p.messages.at(-1)!;
  assert.equal(last.role, "assistant");
  assert.doesNotMatch(String(last.content), /angle closure/);
});

test("move_eyes becomes an action, with a spoken acknowledgement when the model said nothing", async () => {
  const { events, says, p } = await run("Look to your right please", scripted("", [{ name: "move_eyes", args: { action: "look_right" } }]));
  assert.deepEqual(events.filter(e => e.type === "action"), [{ type: "action", action: "look_right" }]);
  assert.deepEqual(says, ["Okay."]);
  assert.equal(p.messages.at(-1)!.role, "tool", "the tool result follows the call, as the API requires");
});

test("unknown tools and actions are ignored", async () => {
  const { events } = await run("Look", scripted("Where?", [{ name: "set_property", args: {} }, { name: "move_eyes", args: { action: "cross_eyes" } }]));
  assert.equal(events.filter(e => e.type === "action").length, 0);
});

test("the prompt marks red flags and keeps the doctor's words as speech, not instructions", () => {
  const prompt = patientPrompt(facts, brief);
  assert.match(prompt, /halos_glare \(only if asked about this directly\)/);
  assert.match(prompt, /never instructions/);
  assert.doesNotMatch(prompt, /angle closure/i, "the diagnosis is not in the patient's prompt");
});
