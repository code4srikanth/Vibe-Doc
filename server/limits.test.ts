import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage } from "node:http";
import { allow, clientIp } from "./limits.ts";

const req = (xff: string | undefined, remote = "10.0.0.9") =>
  ({ headers: xff ? { "x-forwarded-for": xff } : {}, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;

test("a visitor is stopped after the limit, and others are not", () => {
  assert.ok(allow("a", "t1", 2, 60_000));
  assert.ok(allow("a", "t1", 2, 60_000));
  assert.equal(allow("a", "t1", 2, 60_000), false);
  assert.ok(allow("b", "t1", 2, 60_000));
});

test("limits are per bucket and the window slides", async () => {
  assert.ok(allow("c", "t2", 1, 20));
  assert.equal(allow("c", "t2", 1, 20), false);
  assert.ok(allow("c", "t3", 1, 20));
  await new Promise(r => setTimeout(r, 30));
  assert.ok(allow("c", "t2", 1, 20));
});

test("the address is the entry the trusted proxy appended, not one the visitor wrote", () => {
  assert.equal(clientIp(req("6.6.6.6, 203.0.113.5")), "203.0.113.5");
  assert.equal(clientIp(req(undefined)), "10.0.0.9");
});
