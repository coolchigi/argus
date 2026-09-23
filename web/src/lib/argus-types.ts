export type ImpactType =
  | "crs-delta"
  | "eligibility-flip"
  | "deadline-shift"
  | "lmia-implication"
  | "french-bonus"
  | "procedural"
  | "none";

export type Confidence = "low" | "medium" | "high";

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
  status: "draft" | "edited" | "sent";
  createdAt: string;
  updatedAt?: string;
  sentAt?: string;
  sentBodyMarkdown?: string;
  sentRecipientDomain?: string;
};

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
