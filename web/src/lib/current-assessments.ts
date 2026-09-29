import type { Brief, Impact } from "./argus-types";
import { isReview } from "./assessment-key.ts";
import { isDelivered } from "./briefs.ts";

/**
 * A rule is the policy change, so a pipeline replay of the same rule is a
 * reassessment, not a new change. Every screen counts one current assessment
 * per (rule, client). Earlier runs stay on record (ADR-0002 retention) and are
 * only counted as history.
 *
 * The current one follows ADR-0004: a consultant review beats every agent row,
 * so a replay never undoes the consultant's verdict. Among reviews, or among
 * agent rows when there's no review, the newest timestamp wins, then the
 * higher assessmentKey. Mirrors currentFirst in services/policy-events and
 * services/profiles.
 */
export function ruleClientKey(x: { ruleHash?: string | null; policyEventId?: string | null; clientId: string }): string {
  return `${x.ruleHash || x.policyEventId || ""}#${x.clientId}`;
}

type Ranked = { assessmentKey: string; timestamp: string; recordKind?: string | null };

/** Sort comparator: the current verdict first. */
export function currentFirst(a: Ranked, b: Ranked): number {
  const review = (x: Ranked) => (isReview(x) ? 1 : 0);
  return review(b) - review(a) || b.timestamp.localeCompare(a.timestamp) || b.assessmentKey.localeCompare(a.assessmentKey);
}

export function currentAssessments(all: readonly Impact[]): {
  current: Impact[];
  priorRuns: Map<string, number>;
} {
  const latest = new Map<string, Impact>();
  const runs = new Map<string, number>();
  for (const i of all) {
    const key = ruleClientKey(i);
    runs.set(key, (runs.get(key) ?? 0) + 1);
    const seen = latest.get(key);
    if (!seen || currentFirst(i, seen) < 0) latest.set(key, i);
  }
  const priorRuns = new Map<string, number>();
  for (const [key, n] of runs) if (n > 1) priorRuns.set(key, n - 1);
  const current = [...latest.values()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return { current, priorRuns };
}

/** The current record for this row's (rule, client), from every row loaded. */
export function currentFor(row: { ruleHash?: string | null; policyEventId?: string | null; clientId: string }, all: readonly Impact[]): Impact | null {
  const key = ruleClientKey(row);
  let best: Impact | null = null;
  for (const i of all) if (ruleClientKey(i) === key && (!best || currentFirst(i, best) < 0)) best = i;
  return best;
}

/**
 * A brief sent or copied out on any run of a rule covers that client for the
 * rule. That includes a brief on an agent row a review later replaced.
 */
export function sentRuleClientKeys(briefs: readonly Brief[]): Set<string> {
  return new Set(briefs.filter((b) => isDelivered(b.status)).map((b) => ruleClientKey(b)));
}
