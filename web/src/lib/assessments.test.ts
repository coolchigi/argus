import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Brief, Impact } from "./argus-types.ts";
import { ACTION_REASON_LABEL, ACTION_REASON_TONE, actionReasonOf, briefForAssessment, countActionRequired, deriveAssessmentRows, isAuditorFlag, parseAssessmentTab } from "./assessments.ts";

const imp = (over: Partial<Impact>): Impact =>
  ({ assessmentKey: "run2#C1", policyEventId: "run2", ruleHash: "r1", clientId: "C1", isAffected: true, timestamp: "2026-09-28T10:00:00Z", ...over }) as Impact;
const brief = (over: Partial<Brief>): Brief =>
  ({ briefId: "b1", assessmentKey: "run2#C1", policyEventId: "run2", ruleHash: "r1", clientId: "C1", status: "draft", createdAt: "2026-09-28T10:01:00Z", ...over }) as Brief;

describe("deriveAssessmentRows", () => {
  it("marks an affected client with no delivered brief as action required", () => {
    const [row] = deriveAssessmentRows([imp({})], [brief({ status: "edited" })], []);
    assert.equal(row.actionRequired, true);
    assert.equal(row.rail, "action");
  });

  it("clears the action once a brief is sent or copied out, on any run of the rule", () => {
    for (const status of ["sent", "sent-externally"] as const) {
      const [row] = deriveAssessmentRows([imp({})], [brief({ assessmentKey: "run1#C1", policyEventId: "run1", status })], []);
      assert.equal(row.actionRequired, false, status);
      assert.equal(row.rail, "done", status);
    }
  });

  it("keeps a corrected client in action required until a brief goes out", () => {
    const correction = { ruleHash: "r1", policyEventId: "run1", clientId: "C1" };
    const [open] = deriveAssessmentRows([imp({})], [], [correction]);
    assert.equal(open.actionRequired, true);
    assert.equal(open.corrected, true);
    assert.equal(open.rail, "action");
    const [closed] = deriveAssessmentRows([imp({})], [brief({ status: "sent" })], [correction]);
    assert.equal(closed.rail, "corrected");
  });

  it("does not let a correction on another client or rule mark this one", () => {
    const [row] = deriveAssessmentRows([imp({ isAffected: false })], [], [{ ruleHash: "r2", clientId: "C1" }, { ruleHash: "r1", clientId: "C2" }]);
    assert.equal(row.corrected, false);
    assert.equal(row.rail, "no-impact");
  });
});

describe("countActionRequired", () => {
  it("matches the number of action-required rows, so the badge and the tab agree", () => {
    const impacts = [imp({}), imp({ clientId: "C2", assessmentKey: "run2#C2" }), imp({ clientId: "C3", assessmentKey: "run2#C3", isAffected: false })];
    const briefs = [brief({ clientId: "C2", assessmentKey: "run2#C2", status: "sent-externally" })];
    const rows = deriveAssessmentRows(impacts, briefs, [{ ruleHash: "r1", clientId: "C1" }]);
    assert.equal(countActionRequired(impacts, briefs), rows.filter((r) => r.actionRequired).length);
    assert.equal(countActionRequired(impacts, briefs), 1);
  });
});

describe("action reasons (ADR-0004)", () => {
  const disagree = { stance: "disagree" as const, reason: "The profile shows a PNP nomination." };

  it("flags an agent verdict the Auditor disagrees with, even after a brief went out", () => {
    const [row] = deriveAssessmentRows([imp({ auditorStance: disagree })], [brief({ status: "sent" })], []);
    assert.equal(row.actionReason, "auditor-disagrees");
    assert.equal(row.actionRequired, true);
    assert.equal(row.rail, "action");
  });

  it("flags an unaffected verdict the Auditor disagrees with", () => {
    assert.equal(actionReasonOf(imp({ isAffected: false, auditorStance: disagree }), false), "auditor-disagrees");
  });

  it("puts disagreement ahead of a missing brief", () => {
    assert.equal(actionReasonOf(imp({ auditorStance: disagree }), false), "auditor-disagrees");
  });

  it("doesn't flag agree or uncertain", () => {
    assert.equal(actionReasonOf(imp({ isAffected: false, auditorStance: { stance: "uncertain", reason: "x" } }), false), null);
    assert.equal(actionReasonOf(imp({ isAffected: false, auditorStance: { stance: "agree", reason: "x" } }), false), null);
  });

  it("clears the flag once the consultant's review is the current verdict", () => {
    const review = imp({ assessmentKey: "review-1-run2#C1", recordKind: "consultant-review", isAffected: false, auditorStance: disagree });
    const [row] = deriveAssessmentRows([review], [], []);
    assert.equal(row.actionReason, null);
    assert.equal(row.reviewed, true);
  });

  it("still needs a brief when the review says affected and nothing went out", () => {
    const review = imp({ assessmentKey: "review-1-run2#C1", recordKind: "consultant-review", isAffected: true });
    assert.equal(deriveAssessmentRows([review], [], [])[0].actionReason, "brief-needed");
  });

  it("counts disagreements in the badge the same way the tab does", () => {
    const impacts = [
      imp({ isAffected: false, auditorStance: disagree }),
      imp({ clientId: "C2", assessmentKey: "run2#C2" }),
      imp({ clientId: "C3", assessmentKey: "run2#C3", isAffected: false }),
    ];
    const rows = deriveAssessmentRows(impacts, [], []);
    assert.equal(countActionRequired(impacts, []), 2);
    assert.equal(countActionRequired(impacts, []), rows.filter((r) => r.actionRequired).length);
  });
});

describe("briefForAssessment", () => {
  it("prefers a delivered brief from an earlier run over a draft on this one", () => {
    const b = briefForAssessment(imp({}), [
      brief({ briefId: "draft-now" }),
      brief({ briefId: "sent-before", assessmentKey: "run1#C1", policyEventId: "run1", status: "sent" }),
    ]);
    assert.equal(b?.briefId, "sent-before");
  });

  it("falls back to the newest brief on this exact assessment, else null", () => {
    const b = briefForAssessment(imp({}), [
      brief({ briefId: "old", createdAt: "2026-09-27T00:00:00Z" }),
      brief({ briefId: "new", createdAt: "2026-09-28T00:00:00Z" }),
      brief({ briefId: "other-run-draft", assessmentKey: "run1#C1" }),
    ]);
    assert.equal(b?.briefId, "new");
    assert.equal(briefForAssessment(imp({}), [brief({ assessmentKey: "run1#C1" })]), null);
  });
});

describe("parseAssessmentTab", () => {
  it("defaults to action required for anything unknown", () => {
    assert.equal(parseAssessmentTab("corrections"), "corrections");
    assert.equal(parseAssessmentTab("all"), "all");
    assert.equal(parseAssessmentTab("nope"), "action");
    assert.equal(parseAssessmentTab(null), "action");
  });
});

describe("a stance the Auditor contradicted", () => {
  const unsure = { stance: "uncertain" as const, reason: "The Auditor answered \"agree\" with isAffected=false, but its reason argues the opposite: x", contradicted: true };

  it("is action required as auditor-unsure, ahead of a missing brief", () => {
    assert.equal(actionReasonOf(imp({ isAffected: false, auditorStance: unsure }), false), "auditor-unsure");
    assert.equal(actionReasonOf(imp({ isAffected: true, auditorStance: unsure }), false), "auditor-unsure");
    assert.equal(actionReasonOf(imp({ isAffected: true, auditorStance: unsure }), true), "auditor-unsure", "a sent brief doesn't settle the verdict");
  });

  it("does not count a plain uncertain stance", () => {
    assert.equal(actionReasonOf(imp({ isAffected: false, auditorStance: { stance: "uncertain", reason: "x" } }), false), null);
  });

  it("is cleared by a consultant review", () => {
    assert.equal(actionReasonOf(imp({ isAffected: false, recordKind: "consultant-review", auditorStance: unsure }), false), null);
  });

  it("counts once in the shared Action required number the tab, sidebar and dashboard read", () => {
    const impacts = [imp({ isAffected: false, auditorStance: unsure }), imp({ clientId: "C2", assessmentKey: "run2#C2", isAffected: false })];
    assert.equal(countActionRequired(impacts, []), 1);
    const [row] = deriveAssessmentRows(impacts, [], []);
    assert.equal(row.rail, "action");
    assert.equal(row.actionReason, "auditor-unsure");
  });

  it("is labelled Auditor unsure, and is an Auditor flag", () => {
    assert.equal(ACTION_REASON_LABEL["auditor-unsure"], "Auditor unsure");
    assert.equal(ACTION_REASON_TONE["auditor-disagrees"], "danger");
    assert.equal(isAuditorFlag("auditor-unsure"), true);
    assert.equal(isAuditorFlag("auditor-disagrees"), true);
    assert.equal(isAuditorFlag("brief-needed"), false);
    assert.equal(isAuditorFlag(null), false);
  });
});
