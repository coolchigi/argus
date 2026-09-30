import { test } from "node:test";
import assert from "node:assert/strict";
import { auditorStanceOf, contradictionHeadline, contradictionNoteOf, parseAssessmentKey, recordKindOf } from "./assessment-key.ts";

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
    contradicted: false,
  });
  assert.deepEqual(auditorStanceOf({ auditorStance: { stance: "uncertain" } }), { stance: "uncertain", reason: "", contradicted: false });
  assert.equal(auditorStanceOf({ auditorStance: { stance: "maybe", reason: "x" } }), null);
  assert.equal(auditorStanceOf({ auditorStance: null }), null);
  assert.equal(auditorStanceOf({ recordKind: "consultant-review", auditorStance: { stance: "disagree", reason: "x" } }), null);
});

test("contradicted reads true only on an uncertain stance marked exactly true", () => {
  assert.equal(auditorStanceOf({ auditorStance: { stance: "uncertain", reason: "r", contradicted: true } })?.contradicted, true);
  for (const bad of [{ stance: "uncertain", contradicted: "true" }, { stance: "uncertain", contradicted: false }, { stance: "disagree", contradicted: true }, { stance: "agree", contradicted: true }]) {
    assert.equal(auditorStanceOf({ auditorStance: bad })?.contradicted, false, JSON.stringify(bad));
  }
  assert.equal(auditorStanceOf({ recordKind: "consultant-review", auditorStance: { stance: "uncertain", contradicted: true } }), null);
});

test("the Auditor's contradiction note splits off the model's reason", () => {
  assert.deepEqual(contradictionNoteOf("The Auditor answered \"agree\" with isAffected=false, but its reason argues the opposite: Client C-1 is affected by the rule."), {
    answered: "agree",
    analystIsAffected: false,
    modelReason: "Client C-1 is affected by the rule.",
  });
  assert.equal(contradictionNoteOf("Client C-1 is affected by the rule."), null);
  assert.equal(contradictionNoteOf('The Auditor answered "maybe" with isAffected=false, but its reason argues the opposite: x'), null);
});

test("the Auditor view says what the Auditor answered, from its note", () => {
  const agreed = contradictionNoteOf('The Auditor answered "agree" with isAffected=false, but its reason argues the opposite: x');
  assert.equal(contradictionHeadline(agreed, false), "The Auditor said this client is not affected, but its reason argues the opposite.");
  const disagreed = contradictionNoteOf('The Auditor answered "disagree" with isAffected=true, but its reason argues the opposite: x');
  assert.equal(contradictionHeadline(disagreed, true), "The Auditor said this client is not affected, but its reason argues the opposite.");
  assert.equal(contradictionHeadline(null, true), "The Auditor's answer and its reason disagree about whether this client is affected.");
});
