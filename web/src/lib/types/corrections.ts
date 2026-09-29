// Response contracts for GET /corrections and GET /impacts/{id}/corrections.
// Source of truth: services/impacts-service/src/handler.ts (postCorrection
// writes the row, both routes return it unchanged). Keep both in sync.

import type { Confidence, ImpactType } from "../argus-types";

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
  correctorReasoning: string;
  correctedAt: string;
};

/** Newest first. */
export type CorrectionsResponse = { corrections: Correction[] };
