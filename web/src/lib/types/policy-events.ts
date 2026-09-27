// Response contracts for the policy-events service (Phase C1).
// Source of truth: services/policy-events/src/handler.ts. Keep both in sync.
//
// Events are derived at read time from ImpactAssessments grouped by
// policyEventId, joined to PolicyRules, Briefs and TrainingCorrections.
// Nothing here is read from the (still empty) argus-policy-events table.

import type { Confidence, ImpactType } from "../argus-types";

export type PolicyEventSeverity = "high" | "medium" | "low";

export type PolicyEventStatus = "action-required" | "done" | "no-impact";

export type PolicyEventOrigin = "sentinel" | "recall";

export type PolicyEvent = {
  /** The policyEventId shared by every assessment in the event. Use it in /policy-events/{id}. */
  eventId: string;
  /** Display reference, e.g. "EE-20260922-1CBB". Derived, never stored. */
  ref: string;
  origin: PolicyEventOrigin;
  ruleHash: string;
  topic: string;
  /** Humanized topic, e.g. "CRS scorecard". */
  title: string;
  /** From PolicyRules.policy_domain. null when the rule row is missing. */
  policyDomain: string | null;
  category: string | null;
  /** Sentinel's classification stored on the rule. null when missing or unrecognized. */
  severity: PolicyEventSeverity | null;
  summary: string | null;
  sourceUrl: string | null;
  /** ISO. Sentinel detection time when the eventId carries it, else the first assessment's timestamp. */
  detectedAt: string;
  assessedCount: number;
  affectedCount: number;
  /** Assessments carrying a canonicalHash and signatureAlgorithm. */
  signedCount: number;
  briefsSent: number;
  /** Briefs for this event whose status is anything other than "sent". */
  briefsUnsent: number;
  correctionsFiled: number;
  /**
   * no-impact: no client affected.
   * action-required: at least one affected client has no sent brief.
   * done: every affected client has a sent brief.
   */
  status: PolicyEventStatus;
  /** ISO. Latest of assessment, brief (created, updated, sent) and correction timestamps. */
  lastActivityAt: string;
};

/** GET /policy-events?limit=50&status=...&domain=... */
export type PolicyEventsListResponse = {
  /** Sorted by detectedAt, newest first. Filtered by status and domain when given. */
  events: PolicyEvent[];
  /** Computed over every event for the tenant, ignoring filters and limit. */
  totals: {
    actionRequired: number;
    /** Events whose detectedAt falls in the current UTC calendar month. */
    detectedThisMonth: number;
  };
  generatedAt: string;
};

export type PolicyEventCitation = {
  sourceUrl: string | null;
  sourceIsLive: boolean;
  /** Presigned link to the archived snapshot. Expires after 7 days. */
  archiveUrl: string | null;
  capturedAt: string | null;
};

/** GET /policy-events/{id}. 404 body is { error: "event-not-found" }. */
export type PolicyEventDetailResponse = {
  event: PolicyEvent;
  citation: PolicyEventCitation;
};

export type PolicyEventImpactBrief = {
  briefId: string;
  status: string;
  sentAt: string | null;
};

export type PolicyEventImpact = {
  clientId: string;
  assessmentKey: string;
  /** From ClientProfiles. null when the profile is missing. */
  program: string | null;
  clientStatus: string | null;
  currentCrsScore: number | null;
  isAffected: boolean;
  impactType: ImpactType;
  numericDelta: number | null;
  confidence: Confidence;
  recommendedAction: string;
  narrative: string;
  canonicalHash: string | null;
  /** ISO timestamp of the signed assessment. */
  signedAt: string;
  brief: PolicyEventImpactBrief | null;
  correctionsFiled: number;
};

/** GET /policy-events/{id}/impacts. Affected clients first, then by clientId. */
export type PolicyEventImpactsResponse = {
  clients: PolicyEventImpact[];
};

export type ActivityKind = "assessment-signed" | "brief-sent" | "correction-filed" | "alert-emailed";

export type ActivityRef = {
  kind: "event" | "assessment" | "brief";
  id: string;
};

export type ActivityItem = {
  id: string;
  /** ISO */
  at: string;
  kind: ActivityKind;
  title: string;
  ref: ActivityRef;
  clientId: string | null;
  /** Assessment canonicalHash. Set only on assessment-signed items. */
  fingerprint: string | null;
};

/** GET /activity?limit=20&before=ISO. Newest first. Pass nextBefore as before for the next page. */
export type ActivityResponse = {
  items: ActivityItem[];
  nextBefore: string | null;
};
