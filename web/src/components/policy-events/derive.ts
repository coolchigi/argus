import type {
  PolicyEvent,
  PolicyEventImpact,
  PolicyEventStatus,
} from "@/lib/types/policy-events";

// Pure logic behind the policy events list and detail screens. No React, no
// fetches, so node:test can run it directly. Imports stay type-only.

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type StatusFilter = "all" | PolicyEventStatus;

/** "all", a policyDomain value, or NO_DOMAIN for events whose rule row is missing. */
export type DomainFilter = string;

export const ALL = "all";
export const NO_DOMAIN = "__none__";

export type EventFilters = {
  query: string;
  status: StatusFilter;
  domain: DomainFilter;
};

export const DEFAULT_FILTERS: EventFilters = { query: "", status: ALL, domain: ALL };

export function hasActiveFilters(f: EventFilters): boolean {
  return f.query.trim() !== "" || f.status !== ALL || f.domain !== ALL;
}

/**
 * Case-insensitive search over the reference, title, topic and summary. Every
 * word in the query has to match somewhere, so "crs draw" finds "CRS draw cut-off".
 */
export function filterEvents(events: readonly PolicyEvent[], f: EventFilters): PolicyEvent[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return events.filter((e) => {
    if (f.status !== ALL && e.status !== f.status) return false;
    if (f.domain !== ALL) {
      if (f.domain === NO_DOMAIN ? e.policyDomain !== null : e.policyDomain !== f.domain) return false;
    }
    if (words.length === 0) return true;
    const haystack = [e.ref, e.title, e.topic, e.summary ?? ""].join(" ").toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

/** Distinct domains present in the list, sorted, with NO_DOMAIN last when any event lacks one. */
export function domainsIn(events: readonly PolicyEvent[]): string[] {
  const set = new Set<string>();
  let missing = false;
  for (const e of events) {
    if (e.policyDomain) set.add(e.policyDomain);
    else missing = true;
  }
  const out = [...set].sort();
  if (missing) out.push(NO_DOMAIN);
  return out;
}

/** Times the rule was assessed again after the first run. 0 when never replayed. */
export function reassessments(runs: number): number {
  return Math.max(0, runs - 1);
}

/** The ↳ line under an event title. null when there's nothing to say. */
export function eventNote(e: Pick<PolicyEvent, "runs" | "correctionsFiled">): string | null {
  const parts: string[] = [];
  const again = reassessments(e.runs);
  if (again > 0) parts.push(`Reassessed ${again}x`);
  if (e.correctionsFiled > 0) {
    parts.push(`${e.correctionsFiled} ${e.correctionsFiled === 1 ? "correction" : "corrections"} filed`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// Detail: affected clients
// ---------------------------------------------------------------------------

/** Affected clients always. Unaffected clients only when asked for. Order is kept. */
export function visibleClients(clients: readonly PolicyEventImpact[], showUnaffected: boolean): PolicyEventImpact[] {
  return showUnaffected ? [...clients] : clients.filter((c) => c.isAffected);
}

export type ClientBriefState = "sent" | "edited" | "draft" | "missing" | "not-needed";

/**
 * Where the client's brief stands. An affected client with no brief row still
 * needs one. An unaffected client with no brief doesn't.
 */
export function clientBriefState(c: Pick<PolicyEventImpact, "isAffected" | "brief">): ClientBriefState {
  const s = c.brief?.status;
  if (s === "sent") return "sent";
  if (s === "edited") return "edited";
  if (s === "draft") return "draft";
  // Unknown status strings on a brief row still count as an unsent brief.
  if (c.brief) return "draft";
  return c.isAffected ? "missing" : "not-needed";
}

/** An affected client whose brief hasn't gone out. Mirrors the API's awaitingBrief. */
export function clientNeedsAction(c: Pick<PolicyEventImpact, "isAffected" | "brief">): boolean {
  return c.isAffected && clientBriefState(c) !== "sent";
}

// ---------------------------------------------------------------------------
// Detail: recommended actions
// ---------------------------------------------------------------------------

export type AggregatedAction = {
  /** The first wording seen, trimmed. */
  action: string;
  clientIds: string[];
};

/** Case, spacing and a trailing full stop don't make two actions different. */
export function actionKey(action: string): string {
  return action.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "").toLowerCase();
}

/**
 * Recommended actions across affected clients, de-duplicated, each with the
 * clients it applies to. Most clients first, then alphabetical.
 */
export function aggregateActions(clients: readonly PolicyEventImpact[]): AggregatedAction[] {
  const byKey = new Map<string, { action: string; clientIds: Set<string> }>();
  for (const c of clients) {
    if (!c.isAffected) continue;
    const key = actionKey(c.recommendedAction ?? "");
    if (!key) continue;
    const entry = byKey.get(key) ?? { action: c.recommendedAction.trim().replace(/\s+/g, " "), clientIds: new Set<string>() };
    entry.clientIds.add(c.clientId);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .map((e) => ({ action: e.action, clientIds: [...e.clientIds].sort() }))
    .sort((a, b) => b.clientIds.length - a.clientIds.length || a.action.localeCompare(b.action));
}

// ---------------------------------------------------------------------------
// Detail: CRS delta summary
// ---------------------------------------------------------------------------

export type DeltaSummary = { count: number; median: number; min: number; max: number };

/** Summary of numericDelta over affected clients that have one. null when none do. */
export function deltaSummary(clients: readonly PolicyEventImpact[]): DeltaSummary | null {
  const values = clients
    .filter((c) => c.isAffected && typeof c.numericDelta === "number" && Number.isFinite(c.numericDelta))
    .map((c) => c.numericDelta as number)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  return { count: values.length, median, min: values[0], max: values[values.length - 1] };
}

// ---------------------------------------------------------------------------
// Detail: verify all signed records
// ---------------------------------------------------------------------------

export type RowVerifyState = "idle" | "verifying" | "verified" | "invalid" | "error";

export type SignedRow = { assessmentKey: string; clientId: string; canonicalHash: string; signedAt: string };

/** Current assessments that carry a fingerprint, in client order. */
export function signedRows(clients: readonly PolicyEventImpact[]): SignedRow[] {
  return clients
    .filter((c): c is PolicyEventImpact & { canonicalHash: string } => typeof c.canonicalHash === "string" && c.canonicalHash !== "")
    .map((c) => ({ assessmentKey: c.assessmentKey, clientId: c.clientId, canonicalHash: c.canonicalHash, signedAt: c.signedAt }));
}

export type SignatureMaterial = { canonicalHash: string; signatureBase64: string; publicKeyPem: string };

/**
 * Fetches one row's signature and checks it. The fetched hash has to match the
 * fingerprint the page shows, or a valid signature over a different record
 * would pass. A failed fetch is "error" (try again), a failed check is "invalid".
 */
export async function verifyRow(
  row: Pick<SignedRow, "assessmentKey" | "canonicalHash">,
  fetchSignature: (assessmentKey: string) => Promise<SignatureMaterial>,
  verify: (input: { canonicalHashHex: string; signatureBase64: string; publicKeyPem: string }) => Promise<boolean>,
): Promise<Exclude<RowVerifyState, "idle" | "verifying">> {
  let sig: SignatureMaterial;
  try {
    sig = await fetchSignature(row.assessmentKey);
  } catch {
    return "error";
  }
  if (sig.canonicalHash.toLowerCase() !== row.canonicalHash.toLowerCase()) return "invalid";
  try {
    return (await verify({
      canonicalHashHex: sig.canonicalHash,
      signatureBase64: sig.signatureBase64,
      publicKeyPem: sig.publicKeyPem,
    }))
      ? "verified"
      : "invalid";
  } catch {
    return "invalid";
  }
}

export type SealState = "idle" | "verifying" | "verified" | "invalid" | "incomplete";

export type SealSummary = {
  state: SealState;
  total: number;
  verified: number;
  invalid: number;
  errored: number;
  pending: number;
};

/**
 * One seal for the whole event. Any invalid signature wins over everything
 * else, because it's the one result that must never be missed. The seal is
 * green only when every signed record verified.
 */
export function sealSummary(states: readonly RowVerifyState[]): SealSummary {
  const count = (s: RowVerifyState) => states.filter((x) => x === s).length;
  const total = states.length;
  const verified = count("verified");
  const invalid = count("invalid");
  const errored = count("error");
  const pending = count("verifying");
  const idle = count("idle");
  let state: SealState;
  if (invalid > 0) state = "invalid";
  else if (pending > 0) state = "verifying";
  else if (total > 0 && verified === total) state = "verified";
  else if (idle === total) state = "idle";
  else state = "incomplete";
  return { state, total, verified, invalid, errored, pending };
}
