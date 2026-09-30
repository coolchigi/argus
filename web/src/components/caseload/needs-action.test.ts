import { test } from "node:test";
import assert from "node:assert/strict";
import { clientActionCount, clientNeedsAction } from "./needs-action.ts";

test("the API's actionRequired drives the caseload, disagreement included", () => {
  // No brief to send, but the Auditor disagrees on one rule.
  assert.equal(clientNeedsAction({ actionRequired: 1, unsentBriefs: 0 }), true);
  assert.equal(clientActionCount({ actionRequired: 1, unsentBriefs: 0 }), 1);
  // A review cleared everything, whatever unsentBriefs says.
  assert.equal(clientNeedsAction({ actionRequired: 0, unsentBriefs: 2 }), false);
});

test("a response from before actionRequired existed falls back to briefs", () => {
  assert.equal(clientNeedsAction({ unsentBriefs: 2 }), true);
  assert.equal(clientActionCount({ unsentBriefs: 2 }), 2);
  assert.equal(clientNeedsAction({ unsentBriefs: 0 }), false);
});
