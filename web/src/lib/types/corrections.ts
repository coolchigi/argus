// Response contracts for GET /corrections and GET /impacts/{id}/corrections.
// Source of truth: services/impacts-service/src/handler.ts (postCorrection
// writes the row, both routes return it unchanged). Keep both in sync.

import type { Confidence, Impact, ImpactType } from "../argus-types";

export type Correction = {
  rcicId: string;
  /** `${assessmentKey}#${correctedAt}` */
  correctionKey: string;
  assessmentKey: string;
  clientId: string;
  policyEventId: string;
  ruleHash: string;
  topic: string;
  policyDomain: string;
  originalImpactType: string;
  originalNumericDelta: number | null;
  originalNarrative: string;
  originalRecommendedAction: string;
  originalConfidence: string;
  correctedImpactType: ImpactType;
  correctedNumericDelta: number | null;
  correctedNarrative: string | null;
  correctedRecommendedAction: string | null;
  correctedConfidence: Confidence | null;
  /** ADR-0004. Absent on corrections filed before it. */
  originalIsAffected?: boolean;
  /** null when the consultant kept the verdict. */
  correctedIsAffected?: boolean | null;
  /** The signed consultant review this correction produced, when it changed the verdict. */
  reviewAssessmentKey?: string | null;
  correctorReasoning: string;
  correctedAt: string;
};

/** POST /impacts/{id}/correction. review is null when the verdict didn't change. */
export type CorrectionResponse = { correction: Correction; review: Impact | null };

/** Newest first. */
export type CorrectionsResponse = { corrections: Correction[] };
