import type { AuditorStance, RecordKind } from "./argus-types";

// ImpactAssessments keys (ADR-0004):
// - agent row:          `${policyEventId}#${clientId}`
// - consultant review:  `review-${epochMs}-${policyEventId}#${clientId}`
// A policyEventId never contains `#` and never starts with `review-`.
// Read policyEventId from the row when you have it. Parse the key only when
// the row isn't loaded, for example a ledger entry or an event client row.

export type ParsedAssessmentKey = {
  recordKind: RecordKind;
  /** The pipeline run. On a review, the run of the row it replaced. */
  policyEventId: string;
  clientId: string;
  /** Reviews only: when the consultant signed it, epoch ms. */
  reviewedAtMs: number | null;
};

const REVIEW_KEY = /^review-(\d+)-([^#]+)#(.+)$/;

export function parseAssessmentKey(key: string): ParsedAssessmentKey | null {
  const review = REVIEW_KEY.exec(key);
  if (review) {
    return { recordKind: "consultant-review", policyEventId: review[2], clientId: review[3], reviewedAtMs: Number(review[1]) };
  }
  if (key.startsWith("review-")) return null;
  const i = key.indexOf("#");
  if (i <= 0 || i === key.length - 1) return null;
  return { recordKind: "agent", policyEventId: key.slice(0, i), clientId: key.slice(i + 1), reviewedAtMs: null };
}

/** Rows without recordKind were all written by Anchor. */
export function recordKindOf(row: { recordKind?: string | null }): RecordKind {
  return row.recordKind === "consultant-review" ? "consultant-review" : "agent";
}

export function isReview(row: { recordKind?: string | null }): boolean {
  return recordKindOf(row) === "consultant-review";
}

/**
 * The signed stance on an agent row, or null. A review carries no stance, and
 * an unknown value reads as no stance so a malformed row can't raise a flag.
 */
export function auditorStanceOf(row: { recordKind?: string | null; auditorStance?: unknown }): AuditorStance | null {
  if (isReview(row)) return null;
  const v = row.auditorStance;
  if (!v || typeof v !== "object") return null;
  const { stance, reason } = v as { stance?: unknown; reason?: unknown };
  if (stance !== "agree" && stance !== "disagree" && stance !== "uncertain") return null;
  return { stance, reason: typeof reason === "string" ? reason : "" };
}
