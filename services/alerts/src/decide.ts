// Decides whether a brief goes out as a real-time email.
//
// Severity is whatever Sentinel stored on the PolicyRules row for this
// change. Nothing here knows an IRCC number: no CRS points, no CLB levels,
// no dates. The one client-level escalation is Argus's own impact taxonomy,
// an eligibility flip, which is always worth a same-day email.

export type Severity = 'low' | 'medium' | 'high';
export type AlertSeverity = Severity | 'unknown';

const ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

// Product default: real-time email for high severity only, everything else
// waits for the digest. Follow-up: read the consultant's own choice from
// their RcicUsers preferences once that lands, and fall back to this.
export const DEFAULT_REALTIME_MIN_SEVERITY: Severity = 'high';

export function isSeverity(v: unknown): v is Severity {
  return v === 'low' || v === 'medium' || v === 'high';
}

export function alertSeverity(input: { ruleSeverity?: unknown; impactType: string }): AlertSeverity {
  if (input.impactType === 'eligibility-flip') return 'high';
  return isSeverity(input.ruleSeverity) ? input.ruleSeverity : 'unknown';
}

export function sendsRealtime(severity: AlertSeverity, minSeverity: Severity = DEFAULT_REALTIME_MIN_SEVERITY): boolean {
  if (severity === 'unknown') return false;
  return ORDER[severity] >= ORDER[minSeverity];
}
