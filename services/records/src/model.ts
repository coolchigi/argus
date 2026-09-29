import { createHash } from 'node:crypto';

// Records ledger and signed export (ADR-0002, export on demand).
//
// Everything that decides what leaves Argus lives here, as allowlists. A new
// column on an assessment or brief row stays out of the export until someone
// adds it below on purpose.

export type Row = Record<string, unknown>;
export type Kind = 'assessments' | 'briefs';
export const KINDS: readonly Kind[] = ['assessments', 'briefs'];

export type Range = {
  /** Inclusive UTC date, YYYY-MM-DD. */
  from: string;
  /** Inclusive UTC date, YYYY-MM-DD. */
  to: string;
  /** Inclusive lower bound as an ISO instant. */
  fromIso: string;
  /** Exclusive upper bound as an ISO instant (midnight after `to`). */
  toIsoExclusive: string;
};

export type ExportRequest = Range & { kinds: Kind[] };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseRange(from: unknown, to: unknown): Parsed<Range> {
  if (typeof from !== 'string' || !isDate(from)) return { ok: false, error: 'from-must-be-yyyy-mm-dd' };
  if (typeof to !== 'string' || !isDate(to)) return { ok: false, error: 'to-must-be-yyyy-mm-dd' };
  if (from > to) return { ok: false, error: 'from-after-to' };
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { ok: true, value: { from, to, fromIso: `${from}T00:00:00.000Z`, toIsoExclusive: end.toISOString() } };
}

export function parseKinds(v: unknown): Parsed<Kind[]> {
  if (v === undefined || v === null) return { ok: true, value: [...KINDS] };
  if (!Array.isArray(v) || v.length === 0) return { ok: false, error: 'kinds-must-be-a-non-empty-array' };
  const out: Kind[] = [];
  for (const k of v) {
    if (typeof k !== 'string' || !KINDS.includes(k as Kind)) return { ok: false, error: `kinds-must-be-${KINDS.join('-or-')}` };
    if (!out.includes(k as Kind)) out.push(k as Kind);
  }
  return { ok: true, value: out };
}

export function parseExportRequest(body: Row): Parsed<ExportRequest> {
  const range = parseRange(body.from, body.to);
  if (!range.ok) return range;
  const kinds = parseKinds(body.kinds);
  if (!kinds.ok) return kinds;
  return { ok: true, value: { ...range.value, kinds: kinds.value } };
}

function isDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function inRange(iso: unknown, range: Pick<Range, 'fromIso' | 'toIsoExclusive'>): boolean {
  return typeof iso === 'string' && iso >= range.fromIso && iso < range.toIsoExclusive;
}

/**
 * Every field a signed ImpactAssessments row can carry under its signature:
 * Anchor's payload (services/anchor/src/handler.ts) and the consultant review
 * payload (services/impacts-service/src/review.ts, ADR-0004). Keep this in
 * step with both, or recomputed hashes stop matching.
 *
 * A field goes into signedPayload only when the row has it. So a row signed
 * before ADR-0004 rehashes over exactly the 18 fields it was signed with, an
 * agent row signed after it adds auditorStance, and a consultant review adds
 * its own fields and has no auditorReasoning or auditIssues.
 *
 * Every one is consultant data, an opaque client ID, or model or consultant
 * text that the shared guardrail screens for personal details before it's stored.
 */
export const ASSESSMENT_SIGNED_FIELDS = [
  'assessmentId',
  'rcicId',
  'clientId',
  'policyEventId',
  'ruleHash',
  'topic',
  'isAffected',
  'impactType',
  'numericDelta',
  'narrative',
  'recommendedAction',
  'confidence',
  'rulesUsed',
  'citationSourceUrl',
  'citationSourceS3Key',
  'auditorReasoning',
  'auditIssues',
  'timestamp',
  // ADR-0004, agent rows: the Auditor's stance on the Analyst's isAffected.
  'auditorStance',
  // ADR-0004, consultant reviews.
  'recordKind',
  'supersedes',
  'supersedesCanonicalHash',
  'reviewedBy',
  'reviewedAt',
  'reviewReasoning',
] as const;

export const RECORD_KIND_REVIEW = 'consultant-review';
export type RecordKind = 'agent' | typeof RECORD_KIND_REVIEW;

/** Rows without recordKind were all written by Anchor. */
export function recordKindOf(row: Row): RecordKind {
  return row.recordKind === RECORD_KIND_REVIEW ? RECORD_KIND_REVIEW : 'agent';
}

const ASSESSMENT_SIGNATURE_FIELDS = ['assessmentKey', 'canonicalHash', 'signatureBase64', 'signatureAlgorithm', 'signingKeyId'] as const;

/** Columns the store reads from ImpactAssessments. Nothing else is fetched. */
export const ASSESSMENT_PROJECTION: readonly string[] = [...ASSESSMENT_SIGNED_FIELDS, ...ASSESSMENT_SIGNATURE_FIELDS];

/**
 * Columns the store reads from Briefs. Left out on purpose:
 * - subject, bodyMarkdown, editedBodyMarkdown, sentBodyMarkdown and
 *   suggestedActions. The consultant can edit all of these freely before
 *   sending, with no guardrail, so a client's name could be in them.
 * - sentRecipientHash. An unsalted SHA-256 of the client's email address,
 *   which anyone holding the address can match.
 * - sentRecipientDomain. The domain of the client's email address.
 * - sesMessageId and sender. Delivery plumbing, not part of the record.
 */
export const BRIEF_PROJECTION: readonly string[] = [
  'rcicId',
  'briefId',
  'assessmentKey',
  'clientId',
  'policyEventId',
  'topic',
  'status',
  'sentAt',
  'sentBodyHash',
  'sentSignature',
  'sentSignatureAlgorithm',
];

export type AssessmentRecord = {
  kind: 'assessment';
  /** 'agent' for a pipeline assessment Anchor signed, 'consultant-review' for a consultant's signed verdict. */
  recordKind: RecordKind;
  /** On a consultant review, the assessment it replaces. That row stays in the export too. */
  supersedes: string | null;
  id: string;
  clientId: string;
  policyEventId: string;
  topic: string;
  signedAt: string;
  canonicalHash: string;
  signatureBase64: string;
  signatureAlgorithm: string;
  signingKeyId: string;
  /** The exact object Anchor hashed. sha256(canonicalize(signedPayload)) === canonicalHash. */
  signedPayload: Row;
};

export type BriefRecord = {
  kind: 'brief';
  id: string;
  assessmentKey: string;
  clientId: string;
  policyEventId: string;
  topic: string;
  signedAt: string;
  canonicalHash: string;
  signatureBase64: string;
  signatureAlgorithm: string;
  signingKeyId: string;
  /** The sent body isn't exported, so there's nothing to rehash. The signature still verifies against canonicalHash. */
  signedPayload: null;
};

export type ExportRecord = AssessmentRecord | BriefRecord;

export function toAssessmentRecord(row: Row): AssessmentRecord {
  const signedPayload: Row = {};
  for (const k of ASSESSMENT_SIGNED_FIELDS) {
    if (k in row) signedPayload[k] = row[k];
  }
  const recordKind = recordKindOf(row);
  return {
    kind: 'assessment',
    recordKind,
    supersedes: recordKind === RECORD_KIND_REVIEW ? str(row.supersedes) || null : null,
    id: str(row.assessmentKey),
    clientId: str(row.clientId),
    policyEventId: str(row.policyEventId),
    topic: str(row.topic),
    signedAt: str(row.timestamp),
    canonicalHash: str(row.canonicalHash),
    signatureBase64: str(row.signatureBase64),
    signatureAlgorithm: str(row.signatureAlgorithm) || 'ECDSA_SHA_256',
    signingKeyId: str(row.signingKeyId),
    signedPayload,
  };
}

/**
 * Brief rows don't carry a key ID. briefs-service signs with the same
 * SIGNING_KEY_ID as Anchor (infra/lib/argus-api-stack.ts), so the caller
 * passes that in.
 */
export function toBriefRecord(row: Row, signingKeyId: string): BriefRecord {
  return {
    kind: 'brief',
    id: str(row.briefId),
    assessmentKey: str(row.assessmentKey),
    clientId: str(row.clientId),
    policyEventId: str(row.policyEventId),
    topic: str(row.topic),
    signedAt: str(row.sentAt),
    canonicalHash: str(row.sentBodyHash),
    signatureBase64: str(row.sentSignature),
    signatureAlgorithm: str(row.sentSignatureAlgorithm) || 'ECDSA_SHA_256',
    signingKeyId,
    signedPayload: null,
  };
}

/** What the /records ledger shows. No payloads, no signatures. */
export type LedgerEntry = {
  kind: 'assessment' | 'brief';
  /** Assessments only. null on briefs. */
  recordKind: RecordKind | null;
  id: string;
  clientId: string;
  policyEventId: string;
  topic: string;
  signedAt: string;
  canonicalHash: string;
  signed: boolean;
};

export function toLedgerEntry(r: ExportRecord): LedgerEntry {
  return {
    kind: r.kind,
    recordKind: r.kind === 'assessment' ? r.recordKind : null,
    id: r.id,
    clientId: r.clientId,
    policyEventId: r.policyEventId,
    topic: r.topic,
    signedAt: r.signedAt,
    canonicalHash: r.canonicalHash,
    signed: r.signatureBase64.length > 0 && /^[0-9a-f]{64}$/.test(r.canonicalHash),
  };
}

/** Newest first, then by kind and ID so the order is stable. */
export function sortRecords<T extends { signedAt: string; kind: string; id: string }>(records: T[]): T[] {
  return [...records].sort((a, b) => b.signedAt.localeCompare(a.signedAt) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/** Same canonical form Anchor and briefs-service hash: sorted keys, JSON.stringify for leaves. */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Row;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function spkiToPem(spki: Uint8Array): string {
  const b64 = Buffer.from(spki).toString('base64');
  return `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? b64}\n-----END PUBLIC KEY-----\n`;
}

export function toJsonl(records: ExportRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
