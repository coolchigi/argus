// Response contracts for the policy-events service (Phase C1).
// Source of truth: services/policy-events/src/derive.ts. Keep both in sync.
//
// One event per rule (ruleHash), derived at read time from ImpactAssessments
// joined to PolicyRules, Briefs and TrainingCorrections. Every pipeline run on
// a rule (Sentinel, Recall replay, test run) writes a fresh assessment per
// client. The latest one per client is current and drives every count. The
// earlier ones are history. Nothing here is read from the (still empty)
// argus-policy-events table.

import type { Confidence, ImpactType } from "../argus-types";

export type PolicyEventSeverity = "high" | "medium" | "low";

export type PolicyEventStatus = "action-required" | "done" | "no-impact";

// From the first run's id in services/policy-events: `recall-` or `demo-` prefix, else Sentinel.
export type PolicyEventOrigin = "sentinel" | "recall" | "demo";

export type PolicyEvent = {
  /**
   * The rule's ruleHash. Use it in /policy-events/{id}. That route also
   * accepts an old policyEventId (one pipeline run) and resolves it to the rule.
   */
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
  /**
   * ISO. PolicyRules.captured_at, which is written once and stays put across
   * replays. Falls back to the earliest run's detection time when the rule row is missing.
   */
  detectedAt: string;
  /** Pipeline runs (distinct policyEventIds) on this rule. 1 means never replayed. */
  runs: number;
  /** Clients assessed. Each client counts once, on their current assessment. */
  assessedCount: number;
  /** Clients whose current assessment is affected. */
  affectedCount: number;
  /** Current assessments carrying a canonicalHash and signatureAlgorithm. */
  signedCount: number;
  /** Clients with a sent brief on any run of this rule. */
  briefsSent: number;
  /** Clients with no sent brief and an unsent brief on their current assessment. */
  briefsUnsent: number;
  /** Clients whose current assessment is affected and who have no sent brief on any run. */
  awaitingBrief: number;
  /** Corrections filed on any run of this rule. */
  correctionsFiled: number;
  /**
   * no-impact: no client's current assessment is affected.
   * action-required: awaitingBrief > 0.
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
  /** The assessment the brief was written for. Can be an earlier run than the client's current one. */
  assessmentKey: string;
  status: string;
  sentAt: string | null;
};

/** An earlier run's assessment for the same client and rule. */
export type PolicyEventPriorAssessment = {
  assessmentKey: string;
  policyEventId: string;
  signedAt: string;
  isAffected: boolean;
  canonicalHash: string | null;
  correctionsFiled: number;
};

export type PolicyEventImpact = {
  clientId: string;
  /** The client's current (latest) assessment. */
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
  /** A sent brief from any run, else a brief on the current assessment, else null. */
  brief: PolicyEventImpactBrief | null;
  /** Corrections on the current assessment. Earlier runs carry their own in priorAssessments. */
  correctionsFiled: number;
  /** Assessments of this rule for this client, current included. */
  assessmentCount: number;
  /** Newest first. Empty when the rule has only been assessed once for this client. */
  priorAssessments: PolicyEventPriorAssessment[];
};

/**
 * GET /policy-events/{id}/impacts. One row per client. Affected clients first, then by clientId.
 * 404 body is { error: "event-not-found" } when the event has no assessments.
 */
export type PolicyEventImpactsResponse = {
  /** The rule-level id, even when {id} was an old policyEventId. */
  eventId: string;
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
  /** The record the item is about. Opens the assessment or brief. */
  ref: ActivityRef;
  /** The rule-level policy event this item belongs to. null when it can't be traced to an assessment. */
  eventId: string | null;
  clientId: string | null;
  /** Assessment canonicalHash. Set only on assessment-signed items. */
  fingerprint: string | null;
};

/**
 * GET /activity?limit=20&before=ISO. Newest first. Pass nextBefore as before for the next page.
 * A history feed, so every assessment appears, replays included.
 */
export type ActivityResponse = {
  items: ActivityItem[];
  nextBefore: string | null;
};
