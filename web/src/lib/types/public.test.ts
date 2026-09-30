import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptRecord } from "./public.ts";

test("the receipt page names a consultant review, an assessment and a brief apart", () => {
  assert.equal(receiptRecord({ kind: "assessment", recordKind: "consultant-review" }), "consultant-review");
  assert.equal(receiptRecord({ kind: "assessment", recordKind: "agent" }), "assessment");
  // Responses from before ADR-0004 carry no recordKind, and older ones no kind.
  assert.equal(receiptRecord({}), "assessment");
  assert.equal(receiptRecord({ kind: "brief", recordKind: "consultant-review" }), "brief");
});
