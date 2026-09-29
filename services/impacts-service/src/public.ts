import { createPublicKey } from 'node:crypto';

// Pure helpers behind the public, unauthenticated routes: the JWK set, the
// landing-page stats and the consultant line on a receipt. No AWS calls here,
// so handler.test.ts can check them against fixed inputs.

export type Jwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string; kid: string; alg: 'ES256'; use: 'sig' };

/**
 * A JWK for the KMS public key. KMS GetPublicKey returns DER
 * SubjectPublicKeyInfo, and Node exports the curve point as base64url x and y.
 * `kid` is the KMS key id, the same value every receipt carries as
 * signingKeyId, so a verifier can match the two.
 */
export function jwkFromSpki(spkiDer: Uint8Array, kid: string): Jwk {
  const exported = createPublicKey({ key: Buffer.from(spkiDer), format: 'der', type: 'spki' }).export({ format: 'jwk' });
  if (exported.kty !== 'EC' || exported.crv !== 'P-256' || typeof exported.x !== 'string' || typeof exported.y !== 'string') {
    throw new Error('signing-key-is-not-p256');
  }
  return { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
}

export const COUNTER_KINDS = ['assessments', 'briefs'] as const;
export type CounterKind = (typeof COUNTER_KINDS)[number];
export const STATS_WINDOW_DAYS = 7;

/** UTC dates for today and the 6 days before it, newest first. */
export function windowDays(now: Date, days = STATS_WINDOW_DAYS): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) {
    out.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export function counterKey(kind: CounterKind, day: string): string {
  return `${kind}#${day}`;
}

export type CounterRow = { counterKey?: unknown; count?: unknown; lastAt?: unknown };
export type PublicStats = { assessmentsSigned7d: number; briefsSent7d: number; lastSignedAt: string | null };

/**
 * Sums the day rows inside the window. Rows outside it, or with a count that
 * isn't a non-negative number, are ignored rather than trusted.
 */
export function sumStats(rows: CounterRow[], now: Date): PublicStats {
  const inWindow = new Set(windowDays(now));
  let assessments = 0;
  let briefs = 0;
  let lastSignedAt: string | null = null;
  for (const row of rows) {
    if (typeof row.counterKey !== 'string') continue;
    const [kind, day] = row.counterKey.split('#');
    if (!day || !inWindow.has(day)) continue;
    const n = typeof row.count === 'number' && Number.isFinite(row.count) && row.count > 0 ? Math.floor(row.count) : 0;
    if (kind === 'assessments') {
      assessments += n;
      if (typeof row.lastAt === 'string' && (lastSignedAt === null || row.lastAt > lastSignedAt)) lastSignedAt = row.lastAt;
    } else if (kind === 'briefs') {
      briefs += n;
    }
  }
  return { assessmentsSigned7d: assessments, briefsSent7d: briefs, lastSignedAt };
}

export type PublicConsultant = { displayName: string; rcicLicense: string };

/**
 * The consultant line on a public receipt. Consultant identity is the one
 * kind of PII Argus holds, and it only shows when the consultant turned
 * `showIdentityOnPublicReceipts` on. Anything other than an explicit true
 * keeps it off.
 */
export function publicConsultant(row: Record<string, unknown> | null | undefined): PublicConsultant | null {
  if (!row) return null;
  const prefs = row.preferences;
  const optedIn = prefs !== null && typeof prefs === 'object' && (prefs as Record<string, unknown>).showIdentityOnPublicReceipts === true;
  if (!optedIn) return null;
  const displayName = typeof row.displayName === 'string' ? row.displayName.trim() : '';
  const rcicLicense = typeof row.rcicLicense === 'string' ? row.rcicLicense.trim() : '';
  if (!displayName || !rcicLicense) return null;
  return { displayName, rcicLicense };
}
