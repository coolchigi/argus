import { test } from "node:test";
import assert from "node:assert/strict";
import { changesVerdict, FIELD_COPY, serverFieldError, validateCorrection, type CorrectionDraft } from "./correction-form.ts";
import { describeCorrectionError } from "./correction-error.ts";

const original = { isAffected: false, narrative: "Not affected. No PNP nomination on file.", recommendedAction: "No action needed." };

const draft = (over: Partial<CorrectionDraft> = {}): CorrectionDraft => ({
  verdict: "keep",
  impactType: "none",
  numericDelta: "",
  narrative: original.narrative,
  action: original.recommendedAction,
  confidence: "medium",
  reasoning: "The nomination came through last week.",
  ...over,
});

test("keep as is sends no verdict, so the API writes a training row only", () => {
  const { errors, body } = validateCorrection(draft(), original);
  assert.deepEqual(errors, {});
  assert.ok(body);
  assert.equal("correctedIsAffected" in body, false);
});

test("picking the verdict it already has isn't a change and needs no rewrite", () => {
  assert.equal(changesVerdict({ verdict: "not-affected" }, original), false);
  const { errors, body } = validateCorrection(draft({ verdict: "not-affected" }), original);
  assert.deepEqual(errors, {});
  assert.equal(body?.correctedIsAffected, false);
});

test("a verdict change needs a rewritten summary and action", () => {
  const { errors, body } = validateCorrection(draft({ verdict: "affected", impactType: "eligibility-flip" }), original);
  assert.equal(body, null);
  assert.equal(errors.narrative, FIELD_COPY.narrativeUnchanged);
  assert.equal(errors.action, FIELD_COPY.actionUnchanged);
});

test("whitespace alone doesn't count as a rewrite", () => {
  const { errors } = validateCorrection(
    draft({ verdict: "affected", impactType: "eligibility-flip", narrative: `  ${original.narrative.replace(" ", "   ")} ` }),
    original,
  );
  assert.equal(errors.narrative, FIELD_COPY.narrativeUnchanged);
});

test("an empty summary or action on a verdict change gets its own message", () => {
  const { errors } = validateCorrection(draft({ verdict: "affected", impactType: "procedural", narrative: " ", action: "" }), original);
  assert.equal(errors.narrative, FIELD_COPY.narrativeMissing);
  assert.equal(errors.action, FIELD_COPY.actionMissing);
});

test("a flip to affected can't keep impact type none", () => {
  const rewritten = { narrative: "Affected. The PNP nomination adds points.", action: "Update the profile." };
  const none = validateCorrection(draft({ verdict: "affected", ...rewritten }), original);
  assert.equal(none.errors.impactType, FIELD_COPY.impactType);
  assert.equal(none.body, null);
  const ok = validateCorrection(draft({ verdict: "affected", impactType: "crs-delta", numericDelta: "600", ...rewritten }), original);
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.body?.correctedIsAffected, true);
  assert.equal(ok.body?.correctedNumericDelta, 600);
  assert.equal(ok.body?.correctedNarrative, rewritten.narrative);
});

test("a flip to not affected with impact type none is fine", () => {
  const affected = { ...original, isAffected: true };
  const { errors, body } = validateCorrection(
    draft({ verdict: "not-affected", narrative: "Not affected after all.", action: "Nothing to send." }),
    affected,
  );
  assert.deepEqual(errors, {});
  assert.equal(body?.correctedIsAffected, false);
});

test("reasoning is always required and a bad delta is caught before sending", () => {
  const { errors } = validateCorrection(draft({ reasoning: "  ", numericDelta: "abc" }), original);
  assert.equal(errors.reasoning, FIELD_COPY.reasoning);
  assert.equal(errors.delta, FIELD_COPY.delta);
});

test("each verdict-change 400 maps to its field and a plain sentence", () => {
  const cases: Array<[string, string]> = [
    ["verdict-change-needs-correctedNarrative", "narrative"],
    ["verdict-change-needs-correctedRecommendedAction", "action"],
    ["affected-verdict-needs-an-impact-type", "impactType"],
    ["correctedIsAffected-must-be-boolean", "verdict"],
  ];
  for (const [code, field] of cases) {
    const mapped = serverFieldError(code);
    assert.equal(mapped?.field, field, code);
    assert.equal(describeCorrectionError(code), mapped?.message, code);
    assert.doesNotMatch(mapped?.message ?? "", /[—;]|[a-z][A-Z]/, code);
  }
  assert.equal(serverFieldError("correction-contains-personal-information"), null);
});

test("form copy has no em dashes or semicolons", () => {
  for (const message of Object.values(FIELD_COPY)) assert.doesNotMatch(message, /[—;]/);
});
