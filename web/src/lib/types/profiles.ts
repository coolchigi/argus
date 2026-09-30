// Response contracts for the profiles service (Phase F).
// Source of truth: services/profiles/src/{app,derive,validate}.ts. Keep both in sync.
//
// A client is an opaque clientId the consultant supplies. No names, emails or
// anything else that identifies a person. `notes` and `age` are never returned.
// Counts use the rule-level read model: one current assessment per (rule,
// client), the latest run, so a replay never double counts.

import type { PolicyDomain } from "@/lib/humanize";
import type { ActionReason, AuditorStance, RecordKind } from "@/lib/argus-types";

export type ClientStatus = "active" | "submitted" | "closed";

export const CLIENT_STATUSES: ClientStatus[] = ["active", "submitted", "closed"];

/** Sentinel's policyDomain set. A client's program is matched against a rule's policyDomain. */
export type ClientProgram = PolicyDomain;

export type LatestAffected = {
  assessmentKey: string;
  policyEventId: string;
  topic: string;
};

export type ClientSummary = {
  clientId: string;
  program?: ClientProgram;
  status?: ClientStatus;
  currentCrsScore?: number;
  nocCode?: string;
  teerLevel?: number;
  /** Missing on rows seeded before the profiles service existed. */
  createdAt?: string;
  updatedAt?: string;
  /** Rules assessed for this client. Each rule counts once, on its current assessment. */
  assessedCount: number;
  /** Rules whose current assessment is affected. */
  affectedCount: number;
  /** Rules whose current assessment is affected with no sent brief on any run. Drives "Needs action". */
  unsentBriefs: number;
  /** Rules whose current verdict is the agent's and the Auditor disagrees with it. Optional until #37 is deployed. */
  auditorDisagrees?: number;
  /**
   * Rules that need the consultant: the Auditor disagrees or a brief is
   * needed, each rule once. The list sorts on it and needsAction=true filters
   * on it. Optional until #37 is deployed.
   */
  actionRequired?: number;
  /** ISO. Newest current assessment. null when never assessed. */
  lastAssessedAt: string | null;
  latestAffected: LatestAffected | null;
};

/** GET /profiles?status=active|submitted|closed|all&program=&needsAction=true */
export type ProfilesListResponse = {
  /** Clients with something to send first, then by clientId. */
  clients: ClientSummary[];
  /** Every client in the tenant, ignoring filters. */
  total: number;
};

/** Whitelisted profile attributes. Everything the Analyst reads except notes and age. */
export type ClientProfile = {
  clientId: string;
  program?: ClientProgram;
  status?: ClientStatus;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  educationLevel?: string;
  clbEnglishWorst?: number;
  clbFrenchWorst?: number;
  canadianWorkYears?: number;
  foreignWorkYears?: number;
  nocCode?: string;
  teerLevel?: number;
  hasJobOffer?: boolean;
  jobOfferTeer?: number;
  currentCrsScore?: number;
  principalPermitTeer?: number;
  principalPermitRemainingMonths?: number;
  cipCode?: string;
  graduationDate?: string;
  pgpSponsor2020Form?: boolean;
  pgpLicoYearsMet?: number;
  pnpProvince?: string;
  intendedStudyLevel?: string;
  palOnFile?: boolean;
  pgpSponsorStatus?: PgpSponsorStatus;
  dliType?: DliType;
  /** yyyy-mm-dd. When the study program starts. */
  studyStartDate?: string;
  /** yyyy-mm-dd. When the study permit application went in. */
  studyPermitAppliedDate?: string;
  principalPrPathway?: PrPathway;
  principalPrApplied?: boolean;
};

// Closed value sets, same lists as services/profiles/src/validate.ts.
export const PGP_SPONSOR_STATUSES = ["no-interest-form", "interest-form-submitted", "invited-to-apply", "application-submitted"] as const;
export type PgpSponsorStatus = (typeof PGP_SPONSOR_STATUSES)[number];
export const DLI_TYPES = ["public", "private"] as const;
export type DliType = (typeof DLI_TYPES)[number];
export const PR_PATHWAYS = ["none", "express-entry", "pnp", "quebec", "atlantic", "other-economic", "family", "other"] as const;
export type PrPathway = (typeof PR_PATHWAYS)[number];

export type ClientAssessment = {
  /** Rule-level policy event id. */
  eventId: string;
  /** The current (latest) assessment of this rule for this client. */
  assessmentKey: string;
  policyEventId: string;
  ruleHash: string;
  topic: string;
  /** 'consultant-review' when the consultant's signed verdict is current. */
  recordKind?: RecordKind;
  /** On a consultant review, the assessment it replaced. */
  supersedes?: string | null;
  auditorStance?: AuditorStance | null;
  actionReason?: ActionReason | null;
  isAffected: boolean;
  impactType: string;
  numericDelta: number | null;
  confidence: string;
  recommendedAction: string;
  canonicalHash: string | null;
  signed: boolean;
  signedAt: string;
  /** Assessments of this rule for this client, current included. More than 1 means reassessed. */
  runs: number;
  priorAssessments: Array<{ assessmentKey: string; recordKind?: RecordKind; signedAt: string; isAffected: boolean; canonicalHash: string | null }>;
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
  /** False when a later run replaced the assessment this brief was written for. */
  onCurrentAssessment: boolean;
};

/** GET /profiles/{id}. 404 body is { error: "client-not-found" }. */
export type ProfileDetailResponse = {
  client: ClientProfile;
  /** One per rule, newest first. */
  assessments: ClientAssessment[];
  /** Every brief for the client, newest first. */
  briefs: ClientBrief[];
};

/** One CSV row as parsed in the browser. Keys are the CSV headers as written. */
export type BulkRow = Record<string, string>;

/**
 * POST /profiles/bulk { rows, dryRun, update? }. Max 500 rows.
 * dryRun defaults to true: only an explicit false writes.
 * update: true lets rows for existing clients update them. Without it they're rejected as client-exists.
 */
export type BulkRequest = { rows: BulkRow[]; dryRun: boolean; update?: boolean };

export type BulkRejectedRow = {
  /** 1-based data row. Header is line 1, so data row n is line n + 1 of the file. */
  row: number;
  /** null when the id itself was rejected, so a rejected id that might be PII is never echoed. */
  clientId: string | null;
  errors: string[];
};

export type BulkResponse = {
  dryRun: boolean;
  created: number;
  updated: number;
  accepted: Array<{ row: number; clientId: string; action: "create" | "update" }>;
  rejected: BulkRejectedRow[];
};

/** 400 for the whole file. error is forbidden-column, unknown-column, missing-column, too-many-rows or no-rows. */
export type BulkFileError = { error: string; columns?: string[]; max?: number; received?: number };

/** POST /profiles. 201 { client }, 409 { error: "client-exists" }. */
export type CreateProfileRequest = {
  clientId: string;
  program: ClientProgram;
  status: ClientStatus;
  consentConfirmed: true;
} & Partial<Omit<ClientProfile, "clientId" | "program" | "status" | "createdAt" | "updatedAt" | "closedAt">>;

/** PATCH /profiles/{id}. null clears an optional attribute. */
export type PatchProfileRequest = Partial<Record<keyof Omit<ClientProfile, "clientId" | "createdAt" | "updatedAt" | "closedAt">, unknown>>;
