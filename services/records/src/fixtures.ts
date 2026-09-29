import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { generateKeyPairSync } from 'node:crypto';
import { p256 } from '@noble/curves/nist.js';
import type { Blobs, PublicKey, Store } from './app.ts';
import { canonicalize, sha256Hex, type Range, type Row } from './model.ts';

// Test fixtures: a local P-256 key that signs the way KMS does (a 32-byte
// digest, no second hash), rows shaped like Anchor and briefs-service write
// them, and in-memory stand-ins for DynamoDB and S3.

export const TENANT = 'R000001';
export const OTHER_TENANT = 'R000002';

export type LocalKey = { keyId: string; spki: Uint8Array; spkiSha256: string; secret: Uint8Array };

export function localKey(keyId = 'local-test-key'): LocalKey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }));
  const d = privateKey.export({ format: 'jwk' }).d;
  if (!d) throw new Error('no private scalar');
  return { keyId, spki, spkiSha256: sha256Hex(spki), secret: new Uint8Array(Buffer.from(d, 'base64url')) };
}

/**
 * KMS Sign with MessageType DIGEST. KMS doesn't normalize S, so `highS`
 * flips a signature to the high half, which is still a valid signature.
 */
export function signDigest(key: LocalKey, hashHex: string, opts: { highS?: boolean } = {}): string {
  const digest = new Uint8Array(Buffer.from(hashHex, 'hex'));
  const compact = p256.sign(digest, key.secret, { prehash: false });
  let sig = p256.Signature.fromBytes(compact, 'compact');
  if (opts.highS && !sig.hasHighS()) sig = new p256.Signature(sig.r, p256.Point.Fn.ORDER - sig.s);
  if (!opts.highS && sig.hasHighS()) throw new Error('expected low-S from noble');
  return Buffer.from(sig.toBytes('der')).toString('base64');
}

/** A row as Anchor writes it: the signed payload plus the signature columns. */
export function assessmentRow(key: LocalKey, over: Partial<Row> & { rcicId: string; clientId: string; timestamp: string }, opts: { highS?: boolean } = {}): Row {
  const policyEventId = String(over.policyEventId ?? 'evt-2026-09-12-ee-draw');
  const assessmentId = `${policyEventId}#${over.clientId}`;
  const payload: Row = {
    assessmentId,
    rcicId: over.rcicId,
    clientId: over.clientId,
    policyEventId,
    ruleHash: 'a'.repeat(64),
    topic: 'express-entry-draw',
    isAffected: true,
    impactType: 'crs-delta',
    numericDelta: -12,
    narrative: 'The new cutoff sits above this profile, so the next draw likely skips it.',
    recommendedAction: 'Review French test results before the next draw.',
    confidence: 'medium',
    rulesUsed: ['a'.repeat(64)],
    citationSourceUrl: 'https://www.canada.ca/en/immigration-refugees-citizenship/news.html',
    citationSourceS3Key: 'corpus/2026-09-12/news.html',
    auditorReasoning: 'Delta matches the published cutoff.',
    auditIssues: [],
    timestamp: over.timestamp,
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'extra')),
  };
  const canonicalHash = sha256Hex(canonicalize(payload));
  return {
    ...payload,
    ...(over.extra as Row | undefined),
    // A consultant review passes its own assessmentId (ADR-0004).
    assessmentKey: payload.assessmentId,
    canonicalHash,
    signatureBase64: signDigest(key, canonicalHash, opts),
    signingKeyId: key.keyId,
    signatureAlgorithm: 'ECDSA_SHA_256',
  };
}

/**
 * A consultant review as impacts-service writes it (ADR-0004): the fields of
 * services/impacts-service/src/review.ts buildReviewPayload, signed, plus the
 * signature columns. It has no auditorReasoning or auditIssues.
 */
export function reviewRow(key: LocalKey, supersedes: Row, over: { reviewedAt: string; isAffected: boolean }): Row {
  const policyEventId = String(supersedes.policyEventId);
  const clientId = String(supersedes.clientId);
  const payload: Row = {
    assessmentId: `review-${Date.parse(over.reviewedAt)}-${policyEventId}#${clientId}`,
    recordKind: 'consultant-review',
    supersedes: supersedes.assessmentKey,
    supersedesCanonicalHash: supersedes.canonicalHash,
    rcicId: supersedes.rcicId,
    clientId,
    policyEventId,
    ruleHash: supersedes.ruleHash,
    topic: supersedes.topic,
    isAffected: over.isAffected,
    impactType: over.isAffected ? 'eligibility-flip' : 'none',
    numericDelta: null,
    narrative: 'The consultant reviewed the rule against the file.',
    recommendedAction: 'No action needed.',
    confidence: 'high',
    rulesUsed: supersedes.rulesUsed,
    citationSourceUrl: supersedes.citationSourceUrl,
    citationSourceS3Key: supersedes.citationSourceS3Key,
    reviewedBy: supersedes.rcicId,
    reviewedAt: over.reviewedAt,
    reviewReasoning: 'The profile has no attestation letter on file.',
    timestamp: over.reviewedAt,
  };
  const canonicalHash = sha256Hex(canonicalize(payload));
  return {
    ...payload,
    assessmentKey: payload.assessmentId,
    canonicalHash,
    signatureBase64: signDigest(key, canonicalHash),
    signingKeyId: key.keyId,
    signatureAlgorithm: 'ECDSA_SHA_256',
  };
}

/** A brief row after briefs-service sends it, PII-adjacent columns and all. */
export function sentBriefRow(key: LocalKey, over: { rcicId: string; briefId: string; clientId: string; sentAt: string; status?: string }): Row {
  const sentBodyHash = sha256Hex(`brief-body-${over.briefId}`);
  return {
    rcicId: over.rcicId,
    briefId: over.briefId,
    assessmentKey: `evt-2026-09-12-ee-draw#${over.clientId}`,
    clientId: over.clientId,
    policyEventId: 'evt-2026-09-12-ee-draw',
    topic: 'express-entry-draw',
    impactType: 'crs-delta',
    subject: 'SUBJECT-Update for Maria Gonzalez',
    bodyMarkdown: 'BODY-Hi Maria, the draw moved.',
    editedBodyMarkdown: 'EDITED-Hi Maria Gonzalez, call me at 416-555-0199.',
    sentBodyMarkdown: 'SENTBODY-Hi Maria Gonzalez, call me at 416-555-0199.',
    suggestedActions: ['ACTION-Email maria.gonzalez@example.com'],
    status: over.status ?? 'sent',
    createdAt: over.sentAt,
    sentAt: over.sentAt,
    sentBodyHash,
    sentSignature: signDigest(key, sentBodyHash),
    sentSignatureAlgorithm: 'ECDSA_SHA_256',
    sentRecipientHash: sha256Hex('maria.gonzalez@example.com'),
    sentRecipientDomain: 'maria-gonzalez-family.ca',
    sesMessageId: 'ses-0100018f',
    sender: 'consultant@example.ca',
  };
}

/**
 * Behaves like the DynamoDB store: one partition, the range filter, and the
 * brief projection (so columns outside BRIEF_PROJECTION never come back).
 * `leaky` skips the partition and range checks to prove the app checks too.
 */
export class MemoryStore implements Store {
  assessmentRows: Row[] = [];
  briefRows: Row[] = [];
  calls: string[] = [];
  private readonly opts: { leaky?: boolean };
  constructor(opts: { leaky?: boolean } = {}) {
    this.opts = opts;
  }

  async assessments(rcicId: string, range: Range) {
    this.calls.push(`assessments:${rcicId}`);
    return this.assessmentRows.filter((r) => this.opts.leaky || (r.rcicId === rcicId && String(r.timestamp) >= range.fromIso && String(r.timestamp) < range.toIsoExclusive)).map((r) => structuredClone(r));
  }
  async sentBriefs(rcicId: string, range: Range) {
    this.calls.push(`briefs:${rcicId}`);
    return this.briefRows
      .filter((r) => this.opts.leaky || (r.rcicId === rcicId && r.status === 'sent' && String(r.sentAt) >= range.fromIso && String(r.sentAt) < range.toIsoExclusive))
      .map((r) => structuredClone(r));
  }
}

export class MemoryBlobs implements Blobs {
  objects = new Map<string, { body: Buffer; contentType: string; fileName: string }>();
  presigned: Array<{ key: string; ttlSeconds: number }> = [];
  async put(key: string, body: Uint8Array, opts: { contentType: string; fileName: string }) {
    this.objects.set(key, { body: Buffer.from(body), ...opts });
  }
  async presign(key: string, ttlSeconds: number) {
    this.presigned.push({ key, ttlSeconds });
    return `https://example-bucket.s3.amazonaws.com/${key}?X-Amz-Expires=${ttlSeconds}`;
  }
}

export function publicKeyOf(key: LocalKey): () => Promise<PublicKey> {
  return async () => ({ keyId: key.keyId, spki: key.spki });
}

export function event(routeKey: string, opts: { body?: unknown; query?: Record<string, string>; claims?: Record<string, string> | null } = {}): APIGatewayProxyEventV2 {
  const [method, path] = routeKey.split(' ');
  const claims = opts.claims === undefined ? { 'custom:rcic_id': TENANT, 'custom:rcic_license': TENANT } : opts.claims;
  return {
    version: '2.0',
    routeKey,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    queryStringParameters: opts.query,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      accountId: '000000000000',
      apiId: 'api',
      domainName: 'example.com',
      domainPrefix: 'example',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req',
      routeKey,
      stage: '$default',
      time: '',
      timeEpoch: 0,
      ...(claims ? { authorizer: { jwt: { claims, scopes: [] } } } : {}),
    },
  } as unknown as APIGatewayProxyEventV2;
}
