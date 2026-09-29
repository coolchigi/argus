// Pure read model for the caseload. No AWS calls, so derive.test.ts runs it
// against fixture rows.
//
// Same model as services/policy-events/src/derive.ts. A rule (ruleHash) is
// the policy change. Every pipeline run on a rule (Sentinel detection, Recall
// replay, test run) writes a fresh ImpactAssessment per client, and records
// are never deleted (ADR-0002). So per (rule, client):
// - the latest assessment by timestamp is current
// - earlier ones are history
// Counts read the current assessment only, so a replay never double counts.
// A brief sent on any run of the rule covers the client for that rule.

export type Row = Record<string, unknown>;

export type AssessmentRow = {
  assessmentKey: string;
  policyEventId: string;
  ruleHash: string;
  clientId: string;
  topic: string;
  isAffected: boolean;
  impactType: string;
  numericDelta: number | null;
  confidence: string;
  recommendedAction: string;
  timestamp: string;
  canonicalHash: string | null;
  signatureAlgorithm: string | null;
};

export type BriefRow = {
  briefId: string;
  assessmentKey: string;
  clientId: string;
  ruleHash: string;
  topic: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  sentAt: string | null;
};

/** Sent by Argus, or copied out by the consultant (`sent-externally`). Either clears the action. */
export function isDelivered(status: string): boolean {
  return status === 'sent' || status === 'sent-externally';
}

export type LatestAffected = { assessmentKey: string; policyEventId: string; topic: string };

export type ClientCounts = {
  /** Rules assessed for this client. Each rule counts once, on its current assessment. */
  assessedCount: number;
  /** Rules whose current assessment is affected. */
  affectedCount: number;
  /** Rules whose current assessment is affected and that have no sent brief on any run. */
  unsentBriefs: number;
  /** ISO. Newest current assessment. null when never assessed. */
  lastAssessedAt: string | null;
  /** Newest affected current assessment. null when nothing is affected. */
  latestAffected: LatestAffected | null;
};

export type ClientAssessment = {
  /** Rule-level policy event id (ruleHash, or policyEventId for rows without one). */
  eventId: string;
  assessmentKey: string;
  policyEventId: string;
  ruleHash: string;
  topic: string;
  isAffected: boolean;
  impactType: string;
  numericDelta: number | null;
  confidence: string;
  recommendedAction: string;
  canonicalHash: string | null;
  signed: boolean;
  signedAt: string;
  /** Assessments of this rule for this client, current included. */
  runs: number;
  /** Newest first. */
  priorAssessments: Array<{ assessmentKey: string; signedAt: string; isAffected: boolean; canonicalHash: string | null }>;
  /** A sent brief from any run, else a brief on the current assessment, else null. */
  brief: { briefId: string; status: string; sentAt: string | null } | null;
  /** Affected and no sent brief on any run. */
  needsBrief: boolean;
};

export type ClientBrief = {
  briefId: string;
  assessmentKey: string;
  eventId: string;
  topic: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  sentAt: string | null;
  /** False when the brief was written against an assessment a later run replaced. */
  onCurrentAssessment: boolean;
};

export const EMPTY_COUNTS: ClientCounts = {
  assessedCount: 0,
  affectedCount: 0,
  unsentBriefs: 0,
  lastAssessedAt: null,
  latestAffected: null,
};

export function ruleIdOf(a: { ruleHash: string; policyEventId: string }): string {
  return a.ruleHash || a.policyEventId;
}

function newestFirst(a: AssessmentRow, b: AssessmentRow): number {
  return b.timestamp.localeCompare(a.timestamp) || b.assessmentKey.localeCompare(a.assessmentKey);
}

type RuleRuns = { ruleId: string; current: AssessmentRow; prior: AssessmentRow[] };

/** Per client, per rule: current plus history. Ties on timestamp break on assessmentKey. */
export function groupRuns(assessments: AssessmentRow[]): Map<string, RuleRuns[]> {
  const byClientRule = new Map<string, Map<string, AssessmentRow[]>>();
  for (const a of assessments) {
    if (!a.clientId) continue;
    const ruleId = ruleIdOf(a);
    if (!ruleId) continue;
    const rules = byClientRule.get(a.clientId) ?? new Map<string, AssessmentRow[]>();
    const list = rules.get(ruleId) ?? [];
    list.push(a);
    rules.set(ruleId, list);
    byClientRule.set(a.clientId, rules);
  }
  const out = new Map<string, RuleRuns[]>();
  for (const [clientId, rules] of byClientRule) {
    const runs: RuleRuns[] = [];
    for (const [ruleId, list] of rules) {
      list.sort(newestFirst);
      runs.push({ ruleId, current: list[0], prior: list.slice(1) });
    }
    out.set(clientId, runs);
  }
  return out;
}

/** `${ruleId}#${clientId}` for every rule a sent brief covers. */
function sentKeys(briefs: BriefRow[], ruleByAssessment: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const b of briefs) {
    if (!isDelivered(b.status)) continue;
    const ruleId = ruleByAssessment.get(b.assessmentKey) ?? b.ruleHash;
    if (ruleId && b.clientId) out.add(`${ruleId}#${b.clientId}`);
  }
  return out;
}

function ruleIndex(assessments: AssessmentRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of assessments) m.set(a.assessmentKey, ruleIdOf(a));
  return m;
}

/** Derived counts for every client that has at least one assessment. */
export function countsByClient(assessments: AssessmentRow[], briefs: BriefRow[]): Map<string, ClientCounts> {
  const sent = sentKeys(briefs, ruleIndex(assessments));
  const out = new Map<string, ClientCounts>();
  for (const [clientId, runs] of groupRuns(assessments)) {
    const current = runs.map((r) => r.current).sort(newestFirst);
    const affected = current.filter((a) => a.isAffected);
    const latest = affected[0] ?? null;
    out.set(clientId, {
      assessedCount: current.length,
      affectedCount: affected.length,
      unsentBriefs: affected.filter((a) => !sent.has(`${ruleIdOf(a)}#${clientId}`)).length,
      lastAssessedAt: current[0]?.timestamp ?? null,
      latestAffected: latest ? { assessmentKey: latest.assessmentKey, policyEventId: latest.policyEventId, topic: latest.topic } : null,
    });
  }
  return out;
}

function pickBrief(briefs: BriefRow[]): BriefRow | null {
  let best: BriefRow | null = null;
  for (const b of briefs) {
    if (!best) best = b;
    else if (isDelivered(b.status) && !isDelivered(best.status)) best = b;
    else if (isDelivered(b.status) === isDelivered(best.status) && (b.createdAt ?? '') > (best.createdAt ?? '')) best = b;
  }
  return best;
}

/** One entry per rule for one client, newest first. `assessments` and `briefs` must already be that client's. */
export function clientAssessments(assessments: AssessmentRow[], briefs: BriefRow[]): ClientAssessment[] {
  const byAssessment = new Map<string, BriefRow[]>();
  for (const b of briefs) {
    const l = byAssessment.get(b.assessmentKey) ?? [];
    l.push(b);
    byAssessment.set(b.assessmentKey, l);
  }
  const out: ClientAssessment[] = [];
  for (const runs of groupRuns(assessments).values()) {
    for (const { ruleId, current, prior } of runs) {
      const all = [current, ...prior];
      const sentBrief = pickBrief(all.flatMap((a) => (byAssessment.get(a.assessmentKey) ?? []).filter((b) => isDelivered(b.status))));
      const brief = sentBrief ?? pickBrief(byAssessment.get(current.assessmentKey) ?? []);
      out.push({
        eventId: ruleId,
        assessmentKey: current.assessmentKey,
        policyEventId: current.policyEventId,
        ruleHash: current.ruleHash,
        topic: current.topic,
        isAffected: current.isAffected,
        impactType: current.impactType,
        numericDelta: current.numericDelta,
        confidence: current.confidence,
        recommendedAction: current.recommendedAction,
        canonicalHash: current.canonicalHash,
        signed: current.canonicalHash !== null && current.signatureAlgorithm !== null,
        signedAt: current.timestamp,
        runs: all.length,
        priorAssessments: prior.map((p) => ({ assessmentKey: p.assessmentKey, signedAt: p.timestamp, isAffected: p.isAffected, canonicalHash: p.canonicalHash })),
        brief: brief ? { briefId: brief.briefId, status: brief.status, sentAt: brief.sentAt } : null,
        needsBrief: current.isAffected && !sentBrief,
      });
    }
  }
  out.sort((a, b) => b.signedAt.localeCompare(a.signedAt) || a.assessmentKey.localeCompare(b.assessmentKey));
  return out;
}

/** Every brief for one client, newest first. History included, nothing dropped. */
export function clientBriefs(assessments: AssessmentRow[], briefs: BriefRow[]): ClientBrief[] {
  const rules = ruleIndex(assessments);
  const currentKeys = new Set<string>();
  for (const runs of groupRuns(assessments).values()) for (const r of runs) currentKeys.add(r.current.assessmentKey);
  return briefs
    .map((b) => ({
      briefId: b.briefId,
      assessmentKey: b.assessmentKey,
      eventId: rules.get(b.assessmentKey) ?? b.ruleHash,
      topic: b.topic,
      status: b.status,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      sentAt: b.sentAt,
      onCurrentAssessment: currentKeys.has(b.assessmentKey),
    }))
    .sort((a, b) => (b.sentAt ?? b.createdAt ?? '').localeCompare(a.sentAt ?? a.createdAt ?? '') || a.briefId.localeCompare(b.briefId));
}

// ---------------------------------------------------------------------------
// Row coercion
// ---------------------------------------------------------------------------

export function toAssessment(r: Row): AssessmentRow {
  return {
    assessmentKey: str(r.assessmentKey),
    policyEventId: str(r.policyEventId),
    ruleHash: str(r.ruleHash),
    clientId: str(r.clientId),
    topic: str(r.topic),
    isAffected: r.isAffected === true,
    impactType: str(r.impactType),
    numericDelta: numOrNull(r.numericDelta),
    confidence: str(r.confidence),
    recommendedAction: str(r.recommendedAction),
    timestamp: str(r.timestamp),
    canonicalHash: strOrNull(r.canonicalHash),
    signatureAlgorithm: strOrNull(r.signatureAlgorithm),
  };
}

export function toBrief(r: Row): BriefRow {
  return {
    briefId: str(r.briefId),
    assessmentKey: str(r.assessmentKey),
    clientId: str(r.clientId),
    ruleHash: str(r.ruleHash),
    topic: str(r.topic),
    status: str(r.status),
    createdAt: strOrNull(r.createdAt),
    updatedAt: strOrNull(r.updatedAt),
    sentAt: strOrNull(r.sentAt),
  };
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0 && Number.isFinite(Number(v))) return Number(v);
  return null;
}
