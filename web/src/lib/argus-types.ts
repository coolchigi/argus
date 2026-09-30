export type ImpactType =
  | "crs-delta"
  | "eligibility-flip"
  | "deadline-shift"
  | "lmia-implication"
  | "french-bonus"
  | "procedural"
  | "none";

export type Confidence = "low" | "medium" | "high";

/**
 * "agent" for a row Anchor signed at the end of a pipeline run.
 * "consultant-review" for a verdict the consultant signed by correcting one
 * (ADR-0004). Rows without recordKind are agent rows.
 */
export type RecordKind = "agent" | "consultant-review";

export type Stance = "agree" | "disagree" | "uncertain";

/** The Auditor's view of the Analyst's isAffected, signed with the agent row. */
export type AuditorStance = { stance: Stance; reason: string };

/** Why a client needs the consultant. Disagreement first: settle the verdict before briefing on it. */
export type ActionReason = "auditor-disagrees" | "brief-needed";

export type Impact = {
  rcicId: string;
  assessmentKey: string;
  clientId: string;
  policyEventId: string;
  ruleHash: string;
  topic: string;
  policyDomain?: string;
  isAffected: boolean;
  impactType: ImpactType;
  numericDelta: number | null;
  narrative: string;
  recommendedAction: string;
  confidence: Confidence;
  citationSourceUrl?: string;
  timestamp: string;
  canonicalHash?: string;
  signingKeyId?: string;
  signatureAlgorithm?: string;
  /** Absent on agent rows. */
  recordKind?: RecordKind;
  /** Agent rows signed after ADR-0004. */
  auditorStance?: AuditorStance | null;
  // Consultant reviews only.
  /** The assessmentKey of the row this review replaces. That row stays on record. */
  supersedes?: string;
  supersedesCanonicalHash?: string | null;
  /** The consultant's rcicId. */
  reviewedBy?: string;
  reviewedAt?: string;
  /** The consultant's reasoning, guardrail-checked and signed. */
  reviewReasoning?: string;
};

export type Brief = {
  rcicId: string;
  briefId: string;
  assessmentKey: string;
  clientId: string;
  policyEventId?: string;
  ruleHash: string;
  topic?: string;
  impactType: ImpactType;
  numericDelta: number | null;
  confidence: Confidence;
  subject: string;
  bodyMarkdown: string;
  editedBodyMarkdown?: string;
  suggestedActions?: string[];
  citationSourceUrl?: string;
  /** sent-externally: the consultant copied it into their own mail client. */
  status: BriefStatus;
  createdAt: string;
  updatedAt?: string;
  sentAt?: string;
  sentBodyMarkdown?: string;
  sentRecipientDomain?: string;
  /** The public receipt fingerprint of a brief Argus sent. */
  sentBodyHash?: string;
  copiedAt?: string;
  /** Sentinel's severity for the rule. Only on GET /briefs. */
  severity?: "high" | "medium" | "low" | null;
};

export type BriefStatus = "draft" | "edited" | "sent" | "sent-externally";

export type AuditSignature = {
  assessmentKey: string;
  signatureAlgorithm: string;
  canonicalHash: string;
  signatureBase64: string;
  signingKeyId: string;
  publicKeyPem: string;
  verification: {
    algorithm: string;
    curve: string;
    messageIsHex: boolean;
    messageIsHash: boolean;
    how: string;
  };
};
