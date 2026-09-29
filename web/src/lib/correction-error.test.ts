import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCorrectionError } from "./correction-error.ts";

test("a correction refused for personal details tells the consultant to use the file number", () => {
  const copy = describeCorrectionError("correction-contains-personal-information");
  assert.match(copy, /personal details/);
  assert.match(copy, /file number/);
});

test("guardrail copy has no em dashes or semicolons", () => {
  for (const code of ["correction-contains-personal-information", "correction-blocked-by-guardrail"]) {
    assert.doesNotMatch(describeCorrectionError(code), /[—;]/);
  }
});

test("a non-personal guardrail block gets its own copy, other codes pass through", () => {
  const blocked = describeCorrectionError("correction-blocked-by-guardrail");
  assert.notEqual(blocked, "correction-blocked-by-guardrail");
  assert.notEqual(blocked, describeCorrectionError("correction-contains-personal-information"));
  assert.equal(describeCorrectionError("assessment-not-found"), "assessment-not-found");
});
