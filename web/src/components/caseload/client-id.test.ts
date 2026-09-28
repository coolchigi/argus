import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CA_SIN_PATTERN, US_SSN_PATTERN, looksLikeSinOrSsn, sinShapedRowsMessage } from "./client-id.ts";

// Reads the source text: the string literal is what the guardrail deploys,
// and infra is a separate CommonJS package the web can't import.
const infraSource = readFileSync(new URL("../../../../infra/lib/guardrail-patterns.ts", import.meta.url), "utf8");

function infraPattern(name: string): string {
  const m = new RegExp(`export const ${name} = String\\.raw\`([^\`]+)\`;`).exec(infraSource);
  assert.ok(m, `${name} not found in infra/lib/guardrail-patterns.ts`);
  return m[1];
}

test("the regex copy matches what the guardrail deploys", () => {
  assert.equal(CA_SIN_PATTERN, infraPattern("CA_SIN_PATTERN"));
  assert.equal(US_SSN_PATTERN, infraPattern("US_SSN_PATTERN"));
});

test("flags every case number the guardrail would block as a SIN or SSN", () => {
  for (const id of ["123456789", "123 456 789", "123-456-789", "123-45-6789", "123 45 6789", "F-123456789", " 123456789 "]) {
    assert.equal(looksLikeSinOrSsn(id), true, id);
  }
});

test("lets through case numbers the guardrail passes", () => {
  for (const id of ["2026-042", "F123456789", "F_123456789", "C-101", "12345", "1234567890", "F-2026-042"]) {
    assert.equal(looksLikeSinOrSsn(id), false, id);
  }
});

test("names the rows and keeps the copy free of em dashes and semicolons", () => {
  const one = sinShapedRowsMessage([3]);
  assert.match(one, /row 3 looks like a SIN or SSN, so Argus can't use it\./);
  const many = sinShapedRowsMessage([2, 3, 4, 5, 6, 7, 8]);
  assert.match(many, /rows 2, 3, 4, 5, 6 and 2 more look/);
  for (const s of [one, many]) assert.doesNotMatch(s, /[—;]/);
});
