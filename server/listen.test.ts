import assert from "node:assert/strict";
import test from "node:test";
import { readLiveEvent } from "./gateway.ts";

test("live transcription: partial words, turn start and the finished turn reach the browser", () => {
  assert.deepEqual(readLiveEvent({ type: "speechStart" }), { type: "start" });
  assert.deepEqual(readLiveEvent({ type: "transcript", transcript: "how long", final: false }), { type: "partial", text: "how long" });
  assert.deepEqual(readLiveEvent({ type: "speechComplete", transcript: " How long has it been red? " }), { type: "final", text: "How long has it been red?" });
});

test("live transcription: other service messages stay on the server", () => {
  for (const type of ["speechEnd", "audioProgress", "speaker", "error", "somethingNew"]) assert.equal(readLiveEvent({ type }), null);
  assert.equal(readLiveEvent({ type: "transcript", transcript: "done", final: true }), null);
});
