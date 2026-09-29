import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Pipeline step telemetry. Each agent appends one row to AuditTrailTable per
// step it runs, so the web app can show which model ran, how long it took and
// what came out. The same file is copied into every agent service, like
// guardrail.ts. Keep the copies identical.
//
// Two rules hold everywhere this is called:
// - A telemetry write never fails the pipeline. Errors are logged, not thrown.
// - Nothing here touches a signed payload. The row is written after the
//   agent's real work, from values the agent already computed.
//
// Keys (AuditTrailTable is PK assessmentId, SK stepTimestamp):
// - Per-client steps: assessmentId `${rcicId}#${policyEventId}#${clientId}`.
//   The rcicId prefix keeps two consultants who reuse the same opaque
//   clientId in separate partitions. tenantRunKey `${rcicId}#${policyEventId}`
//   feeds the byTenantRun index, which the run-level lineage reads.
// - Event steps (Sentinel, Recall) carry no tenant or client data:
//   assessmentId `event#${policyEventId}`.
// - stepTimestamp `${ISO}#${agent}`.

export type StepAgent = 'sentinel' | 'recall' | 'analyst' | 'auditor' | 'anchor' | 'composer';

export type StepScope =
  | { kind: 'assessment'; rcicId: string; policyEventId: string; clientId: string }
  | { kind: 'event'; policyEventId: string };

export type Step = {
  agent: StepAgent;
  // Read from the Lambda's env by the caller. null for Anchor, which signs
  // with KMS and runs no model.
  modelId: string | null;
  durationMs: number;
  outcome: string;
  // Auditor only: the TrainingCorrections keys it used as few-shot examples.
  fewShotCorrectionKeys?: string[];
};

type Log = (level: 'debug' | 'info' | 'error', msg: string, fields: Record<string, unknown>) => void;

export function stepItem(scope: StepScope, step: Step, now: Date = new Date()): Record<string, unknown> {
  const at = now.toISOString();
  const base: Record<string, unknown> = {
    stepTimestamp: `${at}#${step.agent}`,
    recordedAt: at,
    policyEventId: scope.policyEventId,
    agent: step.agent,
    modelId: step.modelId,
    durationMs: Math.max(0, Math.round(step.durationMs)),
    outcome: step.outcome,
  };
  if (step.fewShotCorrectionKeys !== undefined) base.fewShotCorrectionKeys = step.fewShotCorrectionKeys;
  if (scope.kind === 'event') return { assessmentId: `event#${scope.policyEventId}`, ...base };
  return {
    assessmentId: `${scope.rcicId}#${scope.policyEventId}#${scope.clientId}`,
    tenantRunKey: `${scope.rcicId}#${scope.policyEventId}`,
    rcicId: scope.rcicId,
    clientId: scope.clientId,
    ...base,
  };
}

export async function recordStep(
  ddb: DynamoDBDocumentClient,
  table: string | undefined,
  scope: StepScope,
  step: Step,
  log: Log,
): Promise<void> {
  if (!table) {
    log('error', 'telemetry-skipped', { agent: step.agent, reason: 'AUDIT_TRAIL_TABLE is not set' });
    return;
  }
  try {
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: stepItem(scope, step),
        // Append only. A step row is never overwritten.
        ConditionExpression: 'attribute_not_exists(assessmentId)',
      }),
    );
  } catch (err) {
    log('error', 'telemetry-write-failed', {
      agent: step.agent,
      policyEventId: scope.policyEventId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
