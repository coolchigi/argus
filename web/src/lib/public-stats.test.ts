import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statsLine } from "./public-stats.ts";
import { receiptKind } from "./types/public.ts";

describe("statsLine", () => {
  it("hides the counter when no assessment was signed in 7 days, even if briefs went out", () => {
    assert.equal(statsLine(null), null);
    assert.equal(statsLine(undefined), null);
    assert.equal(statsLine({ assessmentsSigned7d: 0, briefsSent7d: 0, lastSignedAt: null }), null);
    assert.equal(statsLine({ assessmentsSigned7d: 0, briefsSent7d: 4, lastSignedAt: null }), null);
  });

  it("ignores values that aren't positive numbers", () => {
    assert.equal(statsLine({ assessmentsSigned7d: -3, briefsSent7d: 2, lastSignedAt: null }), null);
    assert.equal(statsLine({ assessmentsSigned7d: Number.NaN, briefsSent7d: 2, lastSignedAt: null }), null);
    assert.equal(statsLine({ assessmentsSigned7d: 2, briefsSent7d: -1, lastSignedAt: null }), "2 assessments signed in the last 7 days");
  });

  it("uses singular and plural correctly", () => {
    assert.equal(statsLine({ assessmentsSigned7d: 1, briefsSent7d: 0, lastSignedAt: null }), "1 assessment signed in the last 7 days");
    assert.equal(statsLine({ assessmentsSigned7d: 1, briefsSent7d: 1, lastSignedAt: null }), "1 assessment signed and 1 brief sent in the last 7 days");
    assert.equal(
      statsLine({ assessmentsSigned7d: 1204, briefsSent7d: 37, lastSignedAt: "2026-09-29T12:00:00.000Z" }),
      "1,204 assessments signed and 37 briefs sent in the last 7 days",
    );
  });
});

describe("receiptKind", () => {
  it("defaults to assessment when the API sends no kind or an unknown one", () => {
    assert.equal(receiptKind({}), "assessment");
    assert.equal(receiptKind({ kind: "assessment" }), "assessment");
    assert.equal(receiptKind({ kind: "letter" as never }), "assessment");
    assert.equal(receiptKind({ kind: "brief" }), "brief");
  });
});
