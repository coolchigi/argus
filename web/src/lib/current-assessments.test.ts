import { test } from "node:test";
import assert from "node:assert/strict";
import { currentAssessments, currentFor, ruleClientKey, sentRuleClientKeys } from "./current-assessments.ts";
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

// ADR-0004: a consultant review is the current verdict, whatever ran after it.
const review = (over: Partial<Impact>): Impact =>
  imp({
    assessmentKey: "review-1727600000000-e1#C1",
    recordKind: "consultant-review",
    supersedes: "e1#C1",
    isAffected: false,
    timestamp: "2026-09-28T11:00:00Z",
    ...over,
  });

test("a consultant review beats an agent replay that's newer than it", () => {
  const replay = imp({ assessmentKey: "e2#C1", policyEventId: "e2", timestamp: "2026-09-29T09:00:00Z", isAffected: true });
  for (const order of [
    [imp({}), review({}), replay],
    [replay, review({}), imp({})],
  ]) {
    const { current, priorRuns } = currentAssessments(order);
    assert.equal(current.length, 1);
    assert.equal(current[0].assessmentKey, "review-1727600000000-e1#C1");
    assert.equal(current[0].isAffected, false);
    assert.equal(priorRuns.get("r1#C1"), 2);
  }
});

test("the newest review wins among reviews", () => {
  const older = review({});
  const newer = review({ assessmentKey: "review-1727700000000-e1#C1", timestamp: "2026-09-29T11:00:00Z", isAffected: true });
  assert.equal(currentAssessments([newer, older]).current[0].assessmentKey, newer.assessmentKey);
  assert.equal(currentAssessments([older, newer]).current[0].assessmentKey, newer.assessmentKey);
});

test("a timestamp tie breaks on the higher assessmentKey, in any order", () => {
  const a = imp({ assessmentKey: "e1#C1" });
  const b = imp({ assessmentKey: "e9#C1", policyEventId: "e9" });
  assert.equal(currentAssessments([a, b]).current[0].assessmentKey, "e9#C1");
  assert.equal(currentAssessments([b, a]).current[0].assessmentKey, "e9#C1");
});

test("currentFor finds the review that replaced an agent row", () => {
  const all = [imp({}), review({}), imp({ assessmentKey: "e2#C1", policyEventId: "e2", timestamp: "2026-09-29T09:00:00Z" })];
  assert.equal(currentFor(imp({}), all)?.assessmentKey, "review-1727600000000-e1#C1");
  assert.equal(currentFor(imp({ clientId: "C9" }), all), null);
});
