import { test } from "node:test";
import assert from "node:assert/strict";
import { actionSub, bannerImpactSentence, dashboardStats } from "./derive.ts";
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

test("the dashboard counts a stance the Auditor contradicted with the same function as the badge", () => {
  const unsure = { stance: "uncertain" as const, reason: "x", contradicted: true };
  const impacts = [
    imp({ isAffected: false, auditorStance: unsure }),
    imp({ clientId: "C2", assessmentKey: "e1#C2", isAffected: false, auditorStance: { stance: "disagree", reason: "x" } }),
    imp({ clientId: "C3", assessmentKey: "e1#C3", isAffected: false, auditorStance: { stance: "uncertain", reason: "x" } }),
  ];
  const stats = dashboardStats({ events: [], detectedThisMonth: 0, impacts, briefs: [] });
  assert.equal(stats.actionRequired, countActionRequired(impacts, []));
  assert.equal(stats.actionRequired, 2);
  assert.equal(stats.auditorUnsure, 1);
  assert.equal(stats.auditorDisagrees, 1);
  assert.equal(actionSub(stats), "0 briefs to send · Auditor disagrees on 1 · Auditor unsure on 1");
});

test("the banner and the tile name a contradicted stance", () => {
  assert.equal(bannerImpactSentence(ev({ affectedCount: 0, auditorUnsure: 1 })), "0 of your clients are affected. The Auditor contradicted itself on 1 verdict.");
  const none = { clientsAffected: 0, clientsWaiting: 0, actionRequired: 0, auditorDisagrees: 0, auditorUnsure: 0, briefsToSend: 2, briefsDrafted: 1, eventsThisMonth: 0, correctionsFiled: 0 };
  assert.equal(actionSub(none), "2 briefs to send, 1 drafted");
  assert.equal(actionSub({ ...none, auditorUnsure: 2 }), "2 briefs to send · Auditor unsure on 2");
});
