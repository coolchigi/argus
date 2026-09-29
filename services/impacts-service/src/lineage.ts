// Pipeline lineage, read from the step rows each agent appends to
// AuditTrailTable. The writers live in each agent's telemetry.ts. The keys:
// - Per-client steps: assessmentId `${rcicId}#${policyEventId}#${clientId}`,
//   plus tenantRunKey `${rcicId}#${policyEventId}` on the byTenantRun index.
// - Event steps (Sentinel, Recall): assessmentId `event#${policyEventId}`.
//   They carry no tenant or client data.
// - stepTimestamp `${ISO}#${agent}`.

export const PIPELINE_ORDER = ['recall', 'sentinel', 'analyst', 'auditor', 'anchor', 'composer'] as const;
export type AgentName = (typeof PIPELINE_ORDER)[number];

export type StepRow = {
  assessmentId?: unknown;
  stepTimestamp?: unknown;
  agent?: unknown;
  modelId?: unknown;
  durationMs?: unknown;
  outcome?: unknown;
  clientId?: unknown;
  fewShotCorrectionKeys?: unknown;
};

export type LineageAgent = {
  agent: AgentName;
  /** null for Anchor, which signs with KMS and runs no model. */
  modelId: string | null;
  /** The step's duration. Across a run, the median of each client's latest step. */
  durationMs: number | null;
  /** Clients this agent has a step for. 1 for an event step or a single assessment. */
  count: number;
  /** How many clients ended in each outcome, e.g. { signed: 3, dropped: 1 }. */
  outcomes: Record<string, number>;
  firstAt: string;
  lastAt: string;
};

export type Lineage = {
  scope: 'assessment' | 'run';
  policyEventId: string;
  assessmentKey: string | null;
  /** Earliest step seen. null when no step was recorded (assessments signed before telemetry). */
  startedAt: string | null;
  lastStepAt: string | null;
  /** In pipeline order. Only agents with at least one step. */
  agents: LineageAgent[];
  /** Correction keys the Auditor used as few-shot examples, from each client's latest audit. */
  fewShotCorrectionKeys: string[];
};

/** `${policyEventId}#${clientId}`. A policyEventId never contains `#`. */
export function parseAssessmentKey(key: string): { policyEventId: string; clientId: string } | null {
  const i = key.indexOf('#');
  if (i <= 0 || i === key.length - 1) return null;
  return { policyEventId: key.slice(0, i), clientId: key.slice(i + 1) };
}

type CleanStep = {
  agent: AgentName;
  at: string;
  stepTimestamp: string;
  modelId: string | null;
  durationMs: number | null;
  outcome: string;
  clientId: string;
  fewShotCorrectionKeys: string[];
};

function clean(row: StepRow): CleanStep | null {
  const agent = row.agent;
  if (typeof agent !== 'string' || !(PIPELINE_ORDER as readonly string[]).includes(agent)) return null;
  const stepTimestamp = typeof row.stepTimestamp === 'string' ? row.stepTimestamp : '';
  const at = stepTimestamp.split('#')[0];
  if (!at) return null;
  return {
    agent: agent as AgentName,
    at,
    stepTimestamp,
    modelId: typeof row.modelId === 'string' && row.modelId ? row.modelId : null,
    durationMs: typeof row.durationMs === 'number' && Number.isFinite(row.durationMs) ? row.durationMs : null,
    outcome: typeof row.outcome === 'string' ? row.outcome : 'unknown',
    clientId: typeof row.clientId === 'string' ? row.clientId : '',
    fewShotCorrectionKeys: Array.isArray(row.fewShotCorrectionKeys)
      ? row.fewShotCorrectionKeys.filter((k): k is string => typeof k === 'string' && k.length > 0)
      : [],
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Folds raw step rows into one entry per agent. A retried step (EventBridge
 * redelivers on failure) leaves more than one row for the same client, so
 * only each client's latest row counts.
 */
export function summarize(
  rows: StepRow[],
  scope: { scope: 'assessment' | 'run'; policyEventId: string; assessmentKey: string | null },
): Lineage {
  const latest = new Map<string, CleanStep>();
  let startedAt: string | null = null;
  let lastStepAt: string | null = null;
  for (const raw of rows) {
    const step = clean(raw);
    if (!step) continue;
    if (startedAt === null || step.at < startedAt) startedAt = step.at;
    if (lastStepAt === null || step.at > lastStepAt) lastStepAt = step.at;
    const key = `${step.agent}|${step.clientId}`;
    const prev = latest.get(key);
    if (!prev || step.stepTimestamp > prev.stepTimestamp) latest.set(key, step);
  }

  const agents: LineageAgent[] = [];
  const fewShot = new Set<string>();
  for (const agent of PIPELINE_ORDER) {
    const steps = [...latest.values()].filter((s) => s.agent === agent).sort((a, b) => a.stepTimestamp.localeCompare(b.stepTimestamp));
    if (steps.length === 0) continue;
    const outcomes: Record<string, number> = {};
    for (const s of steps) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
    if (agent === 'auditor') for (const s of steps) for (const k of s.fewShotCorrectionKeys) fewShot.add(k);
    agents.push({
      agent,
      modelId: steps[steps.length - 1].modelId,
      durationMs: median(steps.flatMap((s) => (s.durationMs === null ? [] : [s.durationMs]))),
      count: steps.length,
      outcomes,
      firstAt: steps[0].at,
      lastAt: steps[steps.length - 1].at,
    });
  }

  return { ...scope, startedAt, lastStepAt, agents, fewShotCorrectionKeys: [...fewShot] };
}
