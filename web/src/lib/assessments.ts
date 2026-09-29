// Derived assessment states for the Assessments screen and the sidebar
// badge. Nothing here is stored. See PHASE8_PLAN section 1b.

import type { Brief, Impact } from "./argus-types";
import { isDelivered } from "./briefs.ts";
import { ruleClientKey, sentRuleClientKeys } from "./current-assessments.ts";

/**
 * The card rail. Action required wins, because it's the only one that asks
 * the consultant to do something. Seal-green is never a rail colour.
 */
export type AssessmentRail = "action" | "corrected" | "done" | "no-impact";

export type AssessmentRow = Impact & {
  /** Affected, and no brief sent or copied out on any run of this rule for this client. */
  actionRequired: boolean;
  /** A correction exists on any run of this rule for this client. */
  corrected: boolean;
  rail: AssessmentRail;
};

type RuleClient = { ruleHash?: string | null; policyEventId?: string | null; clientId: string };

/** `impacts` must be the current assessments, one per (rule, client). */
export function deriveAssessmentRows(impacts: readonly Impact[], briefs: readonly Brief[], corrections: readonly RuleClient[]): AssessmentRow[] {
  const delivered = sentRuleClientKeys(briefs);
  const corrected = new Set(corrections.map(ruleClientKey));
  return impacts.map((i) => {
    const key = ruleClientKey(i);
    const actionRequired = i.isAffected && !delivered.has(key);
    const isCorrected = corrected.has(key);
    const rail: AssessmentRail = actionRequired ? "action" : isCorrected ? "corrected" : i.isAffected ? "done" : "no-impact";
    return { ...i, actionRequired, corrected: isCorrected, rail };
  });
}

/**
 * The Action required count. The sidebar badge and the tab both call this,
 * so the two numbers can't drift apart.
 */
export function countActionRequired(impacts: readonly Impact[], briefs: readonly Brief[]): number {
  return deriveAssessmentRows(impacts, briefs, []).filter((r) => r.actionRequired).length;
}

/**
 * The brief to open from an assessment: one sent or copied out on any run of
 * the rule, else the newest brief on this exact assessment, else null.
 */
export function briefForAssessment(impact: RuleClient & { assessmentKey: string }, briefs: readonly Brief[]): Brief | null {
  const key = ruleClientKey(impact);
  const newest = (list: Brief[]) => list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  const delivered = briefs.filter((b) => isDelivered(b.status) && ruleClientKey(b) === key);
  if (delivered.length > 0) return newest(delivered);
  return newest(briefs.filter((b) => b.assessmentKey === impact.assessmentKey));
}

export type AssessmentTab = "action" | "all" | "corrections";

export function parseAssessmentTab(v: string | null | undefined): AssessmentTab {
  return v === "all" || v === "corrections" ? v : "action";
}
