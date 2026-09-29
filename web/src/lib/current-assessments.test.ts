import { test } from "node:test";
import assert from "node:assert/strict";
import { currentAssessments, ruleClientKey, sentRuleClientKeys } from "./current-assessments.ts";
import type { Brief, Impact } from "./argus-types.ts";

const imp = (over: Partial<Impact>): Impact =>
  ({ assessmentKey: "e1#C1", policyEventId: "e1", ruleHash: "r1", clientId: "C1", isAffected: true, timestamp: "2026-09-28T10:00:00Z", ...over }) as Impact;
const brief = (over: Partial<Brief>): Brief =>
  ({ briefId: "b1", assessmentKey: "e1#C1", ruleHash: "r1", clientId: "C1", status: "sent", ...over }) as Brief;

test("a replay of the same rule keeps one current assessment per client, the latest", () => {
  const { current, priorRuns } = currentAssessments([
    imp({ assessmentKey: "e1#C1", policyEventId: "e1", timestamp: "2026-09-28T10:00:00Z", isAffected: false }),
    imp({ assessmentKey: "e2#C1", policyEventId: "e2", timestamp: "2026-09-28T12:00:00Z", isAffected: true }),
  ]);
  assert.equal(current.length, 1);
  assert.equal(current[0].assessmentKey, "e2#C1");
  assert.equal(current[0].isAffected, true);
  assert.equal(priorRuns.get("r1#C1"), 1);
});

test("different rules and different clients stay separate", () => {
  const { current, priorRuns } = currentAssessments([
    imp({ assessmentKey: "e1#C1" }),
    imp({ assessmentKey: "e1#C2", clientId: "C2" }),
    imp({ assessmentKey: "e3#C1", policyEventId: "e3", ruleHash: "r2" }),
  ]);
  assert.equal(current.length, 3);
  assert.equal(priorRuns.size, 0);
});

test("the latest wins regardless of input order", () => {
  const { current } = currentAssessments([
    imp({ assessmentKey: "e2#C1", policyEventId: "e2", timestamp: "2026-09-28T12:00:00Z" }),
    imp({ assessmentKey: "e1#C1", timestamp: "2026-09-28T10:00:00Z" }),
  ]);
  assert.equal(current[0].assessmentKey, "e2#C1");
});

test("rows without a ruleHash fall back to their policyEventId", () => {
  const { current } = currentAssessments([
    imp({ assessmentKey: "e1#C1", ruleHash: "" }),
    imp({ assessmentKey: "e2#C1", policyEventId: "e2", ruleHash: "" }),
  ]);
  assert.equal(current.length, 2);
});

test("a brief sent on an earlier run covers the client, a draft does not", () => {
  const sent = sentRuleClientKeys([
    brief({ assessmentKey: "e1#C1", status: "sent" }),
    brief({ briefId: "b2", assessmentKey: "e1#C2", clientId: "C2", status: "draft" }),
  ]);
  assert.ok(sent.has(ruleClientKey(imp({ assessmentKey: "e2#C1", policyEventId: "e2" }))));
  assert.ok(!sent.has(ruleClientKey(imp({ clientId: "C2" }))));
});

test("a brief the consultant copied out covers the client", () => {
  const sent = sentRuleClientKeys([brief({ assessmentKey: "e1#C1", status: "sent-externally" })]);
  assert.ok(sent.has(ruleClientKey(imp({}))));
});
