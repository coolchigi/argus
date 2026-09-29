import { test } from "node:test";
import assert from "node:assert/strict";
import { auditorStanceOf, parseAssessmentKey, recordKindOf } from "./assessment-key.ts";

test("an agent key splits at the first #", () => {
  assert.deepEqual(parseAssessmentKey("1727600000000-ab12cd34#C-101"), {
    recordKind: "agent",
    policyEventId: "1727600000000-ab12cd34",
    clientId: "C-101",
    reviewedAtMs: null,
  });
});

test("a review key gives the original run id, not the review prefix", () => {
  // The run id itself holds dashes and digits, like a demo run's.
  assert.deepEqual(parseAssessmentKey("review-1727700000000-demo-1727600000000-ab12cd34#C-101"), {
    recordKind: "consultant-review",
    policyEventId: "demo-1727600000000-ab12cd34",
    clientId: "C-101",
    reviewedAtMs: 1727700000000,
  });
});

test("a client id with its own # stays whole", () => {
  assert.equal(parseAssessmentKey("review-1-e1#C#2")?.clientId, "C#2");
  assert.equal(parseAssessmentKey("e1#C#2")?.clientId, "C#2");
});

test("malformed keys parse to null, including a review key with no time", () => {
  for (const k of ["", "e1", "#C1", "e1#", "review-e1#C1", "review-123-#C1"]) {
    assert.equal(parseAssessmentKey(k), null, k);
  }
});

test("rows without recordKind are agent rows", () => {
  assert.equal(recordKindOf({}), "agent");
  assert.equal(recordKindOf({ recordKind: "something-else" }), "agent");
  assert.equal(recordKindOf({ recordKind: "consultant-review" }), "consultant-review");
});

test("the stance is read from agent rows only, and an unknown one reads as none", () => {
  assert.deepEqual(auditorStanceOf({ auditorStance: { stance: "disagree", reason: "PNP nomination on file." } }), {
    stance: "disagree",
    reason: "PNP nomination on file.",
  });
  assert.deepEqual(auditorStanceOf({ auditorStance: { stance: "uncertain" } }), { stance: "uncertain", reason: "" });
  assert.equal(auditorStanceOf({ auditorStance: { stance: "maybe", reason: "x" } }), null);
  assert.equal(auditorStanceOf({ auditorStance: null }), null);
  assert.equal(auditorStanceOf({ recordKind: "consultant-review", auditorStance: { stance: "disagree", reason: "x" } }), null);
});
