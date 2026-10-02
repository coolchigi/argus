import { test } from "node:test";
import assert from "node:assert/strict";
import { GUEST_READ_ONLY, guestRoute } from "./guest.ts";

test("a guest read goes to the /guest mirror of the same route", () => {
  assert.deepEqual(guestRoute("/impacts/a%23b", "GET"), { path: "/guest/impacts/a%23b" });
  assert.deepEqual(guestRoute("policy-events", "GET"), { path: "/guest/policy-events" });
});

test("every guest write stops before the network", () => {
  for (const method of ["POST", "PATCH", "DELETE"]) {
    assert.deepEqual(guestRoute("/impacts/x/correction", method), { blocked: GUEST_READ_ONLY });
  }
});
