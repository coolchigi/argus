import type { ClientSummary } from "../../lib/types/profiles.ts";

/**
 * Rules that need the consultant for this client: the Auditor disagrees, or a
 * brief is needed, each rule once. The profiles API works it out (the same
 * rule as policy-events) and sorts and filters on it. A response from before
 * that field existed only knows about briefs.
 */
export function clientActionCount(c: Pick<ClientSummary, "actionRequired" | "unsentBriefs">): number {
  return c.actionRequired ?? c.unsentBriefs;
}

/** Drives the dot on the client chip, the Needs action filter and the header count. */
export function clientNeedsAction(c: Pick<ClientSummary, "actionRequired" | "unsentBriefs">): boolean {
  return clientActionCount(c) > 0;
}
