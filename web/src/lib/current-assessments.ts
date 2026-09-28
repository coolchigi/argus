import type { Brief, Impact } from "./argus-types";

/**
 * A rule is the policy change, so a pipeline replay of the same rule is a
 * reassessment, not a new change. Every screen counts one current assessment
 * per (rule, client): the latest by timestamp. Earlier runs stay on record
 * (ADR-0002 retention) and are only counted as history. Mirrors the
 * policy-events service read model.
 */
export function ruleClientKey(x: { ruleHash?: string | null; policyEventId?: string | null; clientId: string }): string {
  return `${x.ruleHash || x.policyEventId || ""}#${x.clientId}`;
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
    if (!seen || i.timestamp > seen.timestamp) latest.set(key, i);
  }
  const priorRuns = new Map<string, number>();
  for (const [key, n] of runs) if (n > 1) priorRuns.set(key, n - 1);
  const current = [...latest.values()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return { current, priorRuns };
}

/** A brief sent on any run of a rule covers that client for the rule. */
export function sentRuleClientKeys(briefs: readonly Brief[]): Set<string> {
  return new Set(briefs.filter((b) => b.status === "sent").map((b) => ruleClientKey(b)));
}
