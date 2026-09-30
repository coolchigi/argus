import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerImpactSentence, dashboardStats } from "./derive.ts";
import { countActionRequired } from "../../lib/assessments.ts";
import type { Brief, Impact } from "../../lib/argus-types.ts";
import type { PolicyEvent } from "../../lib/types/policy-events.ts";

const ev = (over: Partial<PolicyEvent>): PolicyEvent =>
  ({ affectedCount: 2, briefsUnsent: 0, awaitingBrief: 0, auditorDisagrees: 0, correctionsFiled: 0, ...over }) as PolicyEvent;

const imp = (over: Partial<Impact>): Impact =>
  ({ assessmentKey: "e1#C1", policyEventId: "e1", ruleHash: "r1", clientId: "C1", isAffected: true, timestamp: "2026-09-28T10:00:00Z", ...over }) as Impact;

test("the banner names Auditor disagreement after the brief sentence", () => {
  assert.equal(
    bannerImpactSentence(ev({ auditorDisagrees: 1, awaitingBrief: 2 })),
    "2 of your clients are affected and still need a brief. The Auditor disagrees with 1 verdict.",
  );
  assert.equal(bannerImpactSentence(ev({ affectedCount: 0, auditorDisagrees: 2 })), "0 of your clients are affected. The Auditor disagrees with 2 verdicts.");
  assert.equal(bannerImpactSentence(ev({})), "2 of your clients are affected.");
});

test("the Action required tile is the same number as the Assessments badge", () => {
  const impacts = [
    imp({ isAffected: false, auditorStance: { stance: "disagree", reason: "x" } }),
    imp({ clientId: "C2", assessmentKey: "e1#C2" }),
    imp({ clientId: "C3", assessmentKey: "e1#C3", isAffected: false }),
  ];
  const briefs: Brief[] = [];
  const stats = dashboardStats({ events: [], detectedThisMonth: 0, impacts, briefs });
  assert.equal(stats.actionRequired, countActionRequired(impacts, briefs));
  assert.equal(stats.actionRequired, 2);
  assert.equal(stats.auditorDisagrees, 1);
  assert.equal(stats.briefsToSend, 1);
});
