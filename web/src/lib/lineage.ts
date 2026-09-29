import type { Lineage, LineageAgent, LineageAgentName } from "./types/lineage.ts";

/**
 * The agent chain behind an assessment or a pipeline run, built from the
 * lineage API. Pure, so it can be tested without React.
 */

/** A run counts as live for this long after its first step. Section 3b of PERFORMATIVE.md. */
export const LIVE_WINDOW_MS = 10 * 60 * 1000;
export const LIVE_POLL_MS = 4000;

type AgentInfo = { name: string; role: string };

export const AGENT_INFO: Record<LineageAgentName, AgentInfo> = {
  sentinel: { name: "Sentinel", role: "Watches IRCC pages hourly" },
  recall: { name: "Recall", role: "Replays recent IRCC changes against your caseload" },
  analyst: { name: "Analyst", role: "Reasons per client" },
  auditor: { name: "Auditor", role: "Adversarial review" },
  anchor: { name: "Anchor", role: "Signs and archives" },
  composer: { name: "Composer", role: "Drafts the client email" },
};

/** What sent the change into the pipeline. */
export type RunOrigin = "sentinel" | "recall" | "demo";

/** Heads a demo run. It isn't a pipeline agent and records no step. */
export const DEMO_TRIGGER: AgentInfo = { name: "Demo trigger", role: "Replayed a stored IRCC rule for this demo" };

export type ChainLink = {
  /** A pipeline agent, or "demo-trigger" at the head of a demo run. */
  agent: LineageAgentName | "demo-trigger";
  name: string;
  role: string;
  /** null when this agent has no recorded step (yet, or ever for older records). */
  step: LineageAgent | null;
  /** true when this run records a step for this link, so it counts toward "done". */
  expected: boolean;
};

/** Recall replays carry a `recall-` event id. See services/recall. */
export function isRecallRun(policyEventId: string): boolean {
  return policyEventId.startsWith("recall-");
}

/** Demo triggers carry a `demo-${ms}-${hash8}` event id. See services/demo. */
export function isDemoRun(policyEventId: string): boolean {
  return policyEventId.startsWith("demo-");
}

/**
 * Read from the run id, which the lineage API already returns as
 * policyEventId. A recorded Recall step also marks a replay, whatever the id.
 */
export function runOrigin(policyEventId: string, lineage: Lineage | undefined): RunOrigin {
  if (isRecallRun(policyEventId) || (lineage?.agents ?? []).some((a) => a.agent === "recall")) return "recall";
  if (isDemoRun(policyEventId)) return "demo";
  return "sentinel";
}

const PER_CLIENT: LineageAgentName[] = ["analyst", "auditor", "anchor", "composer"];

/**
 * The chain that ran for this event. Sentinel heads a live change and Recall
 * heads a replay, since each is what sent the change into the pipeline. A demo
 * run starts from the demo trigger, which writes no step, so only the 4
 * per-client agents are expected.
 */
export function buildChain(policyEventId: string, lineage: Lineage | undefined): ChainLink[] {
  const byAgent = new Map((lineage?.agents ?? []).map((a) => [a.agent, a]));
  const origin = runOrigin(policyEventId, lineage);
  const head: ChainLink =
    origin === "demo"
      ? { agent: "demo-trigger", ...DEMO_TRIGGER, step: null, expected: false }
      : { agent: origin, ...AGENT_INFO[origin], step: byAgent.get(origin) ?? null, expected: true };
  const rest = PER_CLIENT.map((agent) => ({ agent, ...AGENT_INFO[agent], step: byAgent.get(agent) ?? null, expected: true }));
  return [head, ...rest];
}

/** Steps done out of steps expected. Complete means every expected step landed. */
export function chainProgress(chain: ChainLink[]): { done: number; total: number; complete: boolean } {
  const expected = chain.filter((c) => c.expected);
  const done = expected.filter((c) => c.step !== null).length;
  return { done, total: expected.length, complete: done === expected.length };
}

export function hasTelemetry(lineage: Lineage | undefined): boolean {
  return (lineage?.agents.length ?? 0) > 0;
}

/**
 * Sentinel event ids start with the detection time in ms: `${Date.now()}-${hash8}`.
 * Demo ids carry the trigger time after their prefix: `demo-${ms}-${hash8}`.
 */
export function detectedAtFromEventId(policyEventId: string): number | null {
  const m = /^(?:demo-)?(\d{13})-/.exec(policyEventId);
  return m ? Number(m[1]) : null;
}

/** The earliest sign of this run: its first recorded step, or the detection time in its id. */
export function runStartedAt(policyEventId: string, lineage: Lineage | undefined): number | null {
  const times = [detectedAtFromEventId(policyEventId), lineage?.startedAt ? Date.parse(lineage.startedAt) : null].filter(
    (t): t is number => t !== null && Number.isFinite(t),
  );
  return times.length > 0 ? Math.min(...times) : null;
}

/** Live means the run started in the last 10 minutes. Only then does the page poll and animate. */
export function isLive(policyEventId: string, lineage: Lineage | undefined, now: number): boolean {
  const started = runStartedAt(policyEventId, lineage);
  if (started === null) return false;
  const age = now - started;
  return age >= 0 && age < LIVE_WINDOW_MS;
}

/** `us.amazon.nova-pro-v1:0` gives `amazon`. The region prefix of an inference profile is skipped. */
export function modelFamily(modelId: string | null): string | null {
  if (!modelId) return null;
  const parts = modelId.split(".");
  const skip = ["us", "eu", "apac", "global"].includes(parts[0]) ? 1 : 0;
  return parts[skip] || null;
}

/** true or false only when both the Analyst's and the Auditor's models were recorded. */
export function isCrossFamily(chain: ChainLink[]): boolean | null {
  const analyst = modelFamily(chain.find((c) => c.agent === "analyst")?.step?.modelId ?? null);
  const auditor = modelFamily(chain.find((c) => c.agent === "auditor")?.step?.modelId ?? null);
  if (!analyst || !auditor) return null;
  return analyst !== auditor;
}

/** 400 gives "0.4s", 12345 gives "12.3s", 65000 gives "1m 05s". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
}

/** "2 affected, 1 not affected". Outcome names come from the agents' telemetry. */
export function describeOutcomes(outcomes: Record<string, number>): string {
  return Object.entries(outcomes)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([outcome, n]) => `${n} ${outcome.replace(/-/g, " ")}`)
    .join(", ");
}

/**
 * A TrainingCorrections key is `${assessmentKey}#${correctedAt}`, and an
 * assessmentKey is `${policyEventId}#${clientId}`. The timestamp never holds
 * a `#` and neither does the event id, so split at the last and the first.
 */
export function parseCorrectionKey(
  key: string,
): { assessmentKey: string; clientId: string; correctedAt: string } | null {
  const last = key.lastIndexOf("#");
  if (last <= 0) return null;
  const assessmentKey = key.slice(0, last);
  const correctedAt = key.slice(last + 1);
  const first = assessmentKey.indexOf("#");
  if (first <= 0 || first === assessmentKey.length - 1 || !Number.isFinite(Date.parse(correctedAt))) return null;
  return { assessmentKey, clientId: assessmentKey.slice(first + 1), correctedAt };
}

/** The pipeline run behind the newest signed assessment on an event page. */
export function latestRunId(clients: Array<{ assessmentKey: string; signedAt: string }>): string | null {
  let best: { key: string; at: string } | null = null;
  for (const c of clients) {
    if (!best || c.signedAt > best.at) best = { key: c.assessmentKey, at: c.signedAt };
  }
  if (!best) return null;
  const i = best.key.indexOf("#");
  return i > 0 ? best.key.slice(0, i) : null;
}
