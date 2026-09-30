// Response contract for the lineage routes in impacts-service.
// Source of truth: services/impacts-service/src/lineage.ts. Keep both in sync.
//
// GET /impacts/{id}/lineage         one assessment ({id} is the assessmentKey)
// GET /policy-events/{id}/lineage   one pipeline run ({id} is a policyEventId)
//
// Built from the step rows each agent appends to AuditTrailTable. An
// assessment signed before step telemetry existed returns agents: [].

export type LineageAgentName = "recall" | "sentinel" | "analyst" | "auditor" | "anchor" | "composer";

export type LineageAgent = {
  agent: LineageAgentName;
  /** The Bedrock model id from the Lambda's env. null for Anchor, which signs with KMS. */
  modelId: string | null;
  /** The step's duration. For a run, the median of each client's latest step. */
  durationMs: number | null;
  /** Clients this agent has a step for. 1 for an event step or a single assessment. */
  count: number;
  /** Clients per outcome, e.g. { signed: 3, dropped: 1 }. */
  outcomes: Record<string, number>;
  firstAt: string;
  lastAt: string;
};

export type Lineage = {
  scope: "assessment" | "run";
  policyEventId: string;
  assessmentKey: string | null;
  /**
   * Set when assessmentKey is a consultant review: the agent assessment it
   * replaced. The steps and policyEventId are that assessment's run, since a
   * review has no run of its own. null otherwise, absent before #37.
   */
  reviewOf?: string | null;
  /** Earliest step seen. null when nothing was recorded. */
  startedAt: string | null;
  lastStepAt: string | null;
  /** Pipeline order. Only agents with at least one step. */
  agents: LineageAgent[];
  /** TrainingCorrections keys the Auditor used as few-shot examples. */
  fewShotCorrectionKeys: string[];
};
