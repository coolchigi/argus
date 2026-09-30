// Response contracts for GET /records and POST /exports.
// Source of truth: services/records/src/model.ts and app.ts. Keep both in sync.
//
// Clients appear as opaque client IDs only. Brief text and recipient details
// never leave the service.

import type { RecordKind as AssessmentRecordKind } from "../argus-types";

/** Export kinds. Not the same thing as an assessment's recordKind. */
export type RecordKind = "assessments" | "briefs";

export type LedgerEntry = {
  kind: "assessment" | "brief";
  /** Assessments only: "agent" or "consultant-review". null on briefs, absent before ADR-0004. */
  recordKind?: AssessmentRecordKind | null;
  /** assessmentKey for assessments, briefId for briefs. */
  id: string;
  clientId: string;
  policyEventId: string;
  topic: string;
  /** Assessment timestamp or brief sentAt, ISO. */
  signedAt: string;
  /** Hex SHA-256 that was signed. */
  canonicalHash: string;
  /** True when the row carries a signature over a well-formed hash. */
  signed: boolean;
};

export type RecordsResponse = {
  from: string;
  to: string;
  records: LedgerEntry[];
};

export type ExportRequest = {
  /** Inclusive UTC date, YYYY-MM-DD. */
  from: string;
  /** Inclusive UTC date, YYYY-MM-DD. */
  to: string;
  kinds?: RecordKind[];
};

export type ExportResponse = {
  /** Presigned S3 link to the zip. */
  url: string;
  expiresAt: string;
  fileName: string;
  from: string;
  to: string;
  /** assessments includes consultantReviews. */
  counts: { assessments: number; consultantReviews?: number; briefs: number };
};
