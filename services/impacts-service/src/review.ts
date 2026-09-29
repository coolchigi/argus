import { createHash } from 'node:crypto';

// Consultant-reviewed verdicts (ADR-0004). When a consultant's correction
// changes isAffected, Argus writes a new signed ImpactAssessments row next to
// the agent's row. The agent's row is never edited or deleted (ADR-0002).
//
// Pure functions only, so review.test.ts checks the exact bytes that get
// signed. handler.ts does the KMS and DynamoDB calls.

export type Row = Record<string, unknown>;

export const RECORD_KIND_REVIEW = 'consultant-review';

/**
 * `review-${epochMs}-${policyEventId}#${clientId}`. It never collides with an
 * agent key (`${policyEventId}#${clientId}`, and a policyEventId never starts
 * with `review-`), and it keeps the client after the first `#`, where every
 * key parser in Argus looks for it. A correction filed on the agent row
 * (correctionKey `${assessmentKey}#${ts}`) can't match this key's prefix.
 */
export function reviewKey(policyEventId: string, clientId: string, reviewedAt: string): string {
  return `review-${Date.parse(reviewedAt)}-${policyEventId}#${clientId}`;
}

export type ReviewInput = {
  rcicId: string;
  /** The ImpactAssessments row the consultant corrected, agent or review. */
  original: Row;
  isAffected: boolean;
  impactType: string;
  numericDelta: number | null;
  narrative: string;
  recommendedAction: string;
  confidence: string;
  /** The consultant's reasoning. It passed the guardrail PII check. */
  reviewReasoning: string;
  reviewedAt: string;
};

/**
 * The object that gets canonicalized, hashed and signed. Every value is
 * consultant input that passed the guardrail, an opaque id, or copied from
 * the signed row it supersedes. No client PII.
 */
export function buildReviewPayload(i: ReviewInput): Row {
  const o = i.original;
  const policyEventId = str(o.policyEventId);
  const clientId = str(o.clientId);
  const ruleHash = str(o.ruleHash);
  return {
    assessmentId: reviewKey(policyEventId, clientId, i.reviewedAt),
    recordKind: RECORD_KIND_REVIEW,
    supersedes: str(o.assessmentKey),
    // Binds the review to the exact bytes of the row it replaces.
    supersedesCanonicalHash: typeof o.canonicalHash === 'string' ? o.canonicalHash : null,
    rcicId: i.rcicId,
    clientId,
    policyEventId,
    ruleHash,
    topic: str(o.topic),
    isAffected: i.isAffected,
    impactType: i.impactType,
    numericDelta: i.numericDelta,
    narrative: i.narrative,
    recommendedAction: i.recommendedAction,
    confidence: i.confidence,
    rulesUsed: Array.isArray(o.rulesUsed) ? o.rulesUsed : ruleHash ? [ruleHash] : [],
    citationSourceUrl: str(o.citationSourceUrl),
    citationSourceS3Key: str(o.citationSourceS3Key),
    reviewedBy: i.rcicId,
    reviewedAt: i.reviewedAt,
    reviewReasoning: i.reviewReasoning,
    timestamp: i.reviewedAt,
  };
}

/** Same canonical form as Anchor: sorted keys at every level, JSON.stringify for leaves. */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Row;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalHash(payload: Row): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
