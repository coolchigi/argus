// Which tenants and clients a policy change reaches. Pure, so eligibility.test.ts
// runs it directly. The same file lives in services/recall/src. Services don't
// share code today, so a change here has to land there too.
//
// Both inputs are data the consultant controls: the preferences map on their
// argus-rcic-users row (written by PATCH /me) and each client's program and
// status on argus-client-profiles. Nothing here reads IRCC rules.

export type Tenant = {
  rcicId: string;
  /** Program areas the consultant turned off. Only an explicit false counts. */
  disabledDomains: Set<string>;
};

/**
 * Sentinel domains that aren't a client program. A change classed this way
 * reaches every open client whose own program is still on.
 */
const CROSS_PROGRAM_DOMAINS = new Set(['general', 'other']);

/** Client status that ends monitoring. The row stays for retention (ADR-0002). */
const CLOSED_STATUS = 'closed';

/** The attributes to project from argus-rcic-users. */
export const TENANT_ATTRIBUTES = ['rcicId', 'active', 'preferences'] as const;

/**
 * Reads one argus-rcic-users item. null when it has no rcicId or is marked
 * inactive. A missing or malformed preferences map means every area is on.
 */
export function tenantFromItem(item: Record<string, unknown>): Tenant | null {
  if (typeof item.rcicId !== 'string' || item.rcicId.length === 0) return null;
  if (item.active === false) return null;
  const disabledDomains = new Set<string>();
  const prefs = item.preferences;
  if (isObject(prefs) && isObject(prefs.policyDomains)) {
    for (const [domain, on] of Object.entries(prefs.policyDomains)) {
      if (on === false) disabledDomains.add(domain);
    }
  }
  return { rcicId: item.rcicId, disabledDomains };
}

/**
 * The clients a change in `policyDomain` should be assessed for.
 * - Closed clients never are.
 * - A program-specific change reaches clients in that program, unless the
 *   consultant turned that program off, in which case it reaches nobody.
 * - A cross-program change reaches open clients whose program isn't off.
 */
export function eligibleClients<T extends { program?: string; status?: string }>(
  clients: T[],
  policyDomain: string,
  tenant: Pick<Tenant, 'disabledDomains'>,
): T[] {
  const open = clients.filter((c) => c.status !== CLOSED_STATUS);
  if (CROSS_PROGRAM_DOMAINS.has(policyDomain)) {
    return open.filter((c) => typeof c.program !== 'string' || !tenant.disabledDomains.has(c.program));
  }
  if (tenant.disabledDomains.has(policyDomain)) return [];
  return open.filter((c) => c.program === policyDomain);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
