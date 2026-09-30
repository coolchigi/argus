// The correction form's rules, kept out of React so they can be tested.
// Source of truth for the API side: postCorrection in
// services/impacts-service/src/handler.ts (ADR-0004).

import type { Confidence, ImpactType } from "./argus-types";

/** "keep" sends no correctedIsAffected, so the verdict stays as signed. */
export type VerdictChoice = "keep" | "affected" | "not-affected";

export type CorrectionField = "verdict" | "impactType" | "delta" | "reasoning" | "narrative" | "action";

export type CorrectionDraft = {
  verdict: VerdictChoice;
  impactType: ImpactType;
  numericDelta: string;
  narrative: string;
  action: string;
  confidence: Confidence;
  reasoning: string;
};

export type CorrectionBody = {
  correctorReasoning: string;
  correctedImpactType: ImpactType;
  correctedNumericDelta: number | null;
  correctedNarrative: string;
  correctedRecommendedAction: string;
  correctedConfidence: Confidence;
  correctedIsAffected?: boolean;
};

export type CorrectionErrors = Partial<Record<CorrectionField, string>>;

type Original = { isAffected: boolean; narrative: string; recommendedAction: string };

/** The verdict the draft asks for, or null when it keeps the signed one. */
export function chosenIsAffected(verdict: VerdictChoice): boolean | null {
  return verdict === "keep" ? null : verdict === "affected";
}

/** True when saving would sign a consultant review. Picking the verdict it already has isn't a change. */
export function changesVerdict(draft: Pick<CorrectionDraft, "verdict">, original: Pick<Original, "isAffected">): boolean {
  const chosen = chosenIsAffected(draft.verdict);
  return chosen !== null && chosen !== original.isAffected;
}

const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");

export const FIELD_COPY = {
  reasoning: "Add your reasoning so the Auditor can learn from it.",
  narrativeMissing: "Write the summary for the new verdict.",
  narrativeUnchanged: "Rewrite the summary. This one argues the old verdict, and Argus drafts the brief from it.",
  actionMissing: "Write the recommended action for the new verdict.",
  actionUnchanged: "Rewrite the recommended action for the new verdict.",
  impactType: "Pick an impact type. Argus can't draft a brief for an affected client with no impact.",
  delta: "Enter a number of CRS points, or leave it blank.",
  verdict: "Pick affected, not affected or keep as is.",
} as const;

/**
 * Checks the draft the way the API will, plus one rule the API can't know:
 * on a verdict change, the summary and action must be rewritten, since the
 * prefilled text argues the old answer. Returns the body to send when valid.
 */
export function validateCorrection(draft: CorrectionDraft, original: Original): { errors: CorrectionErrors; body: CorrectionBody | null } {
  const errors: CorrectionErrors = {};
  const reasoning = draft.reasoning.trim();
  const narrative = draft.narrative.trim();
  const action = draft.action.trim();
  if (!reasoning) errors.reasoning = FIELD_COPY.reasoning;

  const deltaText = draft.numericDelta.trim();
  const delta = deltaText === "" ? null : Number(deltaText);
  if (delta !== null && !Number.isFinite(delta)) errors.delta = FIELD_COPY.delta;

  const flip = changesVerdict(draft, original);
  if (flip) {
    if (!narrative) errors.narrative = FIELD_COPY.narrativeMissing;
    else if (same(narrative, original.narrative)) errors.narrative = FIELD_COPY.narrativeUnchanged;
    if (!action) errors.action = FIELD_COPY.actionMissing;
    else if (same(action, original.recommendedAction)) errors.action = FIELD_COPY.actionUnchanged;
  }
  if (chosenIsAffected(draft.verdict) === true && flip && draft.impactType === "none") errors.impactType = FIELD_COPY.impactType;

  if (Object.keys(errors).length > 0) return { errors, body: null };
  const body: CorrectionBody = {
    correctorReasoning: reasoning,
    correctedImpactType: draft.impactType,
    correctedNumericDelta: delta,
    correctedNarrative: narrative,
    correctedRecommendedAction: action,
    correctedConfidence: draft.confidence,
  };
  const chosen = chosenIsAffected(draft.verdict);
  if (chosen !== null) body.correctedIsAffected = chosen;
  return { errors, body };
}

/**
 * The 400 codes a verdict change can get back, mapped to the field they
 * belong to. Anything else shows above the Save button.
 */
const SERVER_FIELD: Record<string, { field: CorrectionField; message: string }> = {
  "verdict-change-needs-correctedNarrative": { field: "narrative", message: FIELD_COPY.narrativeMissing },
  "verdict-change-needs-correctedRecommendedAction": { field: "action", message: FIELD_COPY.actionMissing },
  "affected-verdict-needs-an-impact-type": { field: "impactType", message: FIELD_COPY.impactType },
  "correctedIsAffected-must-be-boolean": { field: "verdict", message: FIELD_COPY.verdict },
  "missing-required-correctorReasoning": { field: "reasoning", message: FIELD_COPY.reasoning },
  "correctedNumericDelta-must-be-number-or-null": { field: "delta", message: FIELD_COPY.delta },
};

export function serverFieldError(code: string): { field: CorrectionField; message: string } | null {
  return SERVER_FIELD[code] ?? null;
}
