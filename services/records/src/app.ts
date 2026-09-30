import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import {
  inRange,
  parseExportRequest,
  parseKinds,
  parseRange,
  RECORD_KIND_REVIEW,
  sha256Hex,
  sortRecords,
  spkiToPem,
  toAssessmentRecord,
  toBriefRecord,
  toJsonl,
  toLedgerEntry,
  type ExportRecord,
  type Kind,
  type Range,
  type Row,
} from './model.ts';
import { buildVerifyDoc, KEY_FILE, RECORDS_FILE, VERIFY_FILE } from './verify-doc.ts';
import { buildZip } from './zip.ts';

// GET /records (the ledger) and POST /exports (the signed download). Routes
// and rules, with storage behind interfaces so tests run against memory.
// handler.ts wires DynamoDB, KMS and S3.

export interface Store {
  /** ImpactAssessments in the rcicId partition with timestamp in [fromIso, toIsoExclusive). */
  assessments(rcicId: string, range: Range): Promise<Row[]>;
  /** Sent Briefs in the rcicId partition with sentAt in [fromIso, toIsoExclusive). */
  sentBriefs(rcicId: string, range: Range): Promise<Row[]>;
}

export interface Blobs {
  put(key: string, body: Uint8Array, opts: { contentType: string; fileName: string }): Promise<void>;
  presign(key: string, ttlSeconds: number): Promise<string>;
}

export type PublicKey = { keyId: string; spki: Uint8Array };

export type Config = {
  signingKeyId: string;
  /** SHA-256 of the signing key's SPKI. Exports refuse to run if KMS returns a different key. */
  pinnedSpkiSha256: string;
  urlTtlSeconds: number;
};

type Json = APIGatewayProxyStructuredResultV2;
type Log = (level: 'info' | 'error', msg: string, fields: Record<string, unknown>) => void;

export function createApp(
  store: Store,
  blobs: Blobs,
  publicKey: () => Promise<PublicKey>,
  config: Config,
  opts: { now?: () => Date; newId?: () => string; log?: Log } = {},
) {
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? randomUUID;
  const log: Log = opts.log ?? ((level, msg, fields) => console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields })));

  async function collect(rcicId: string, range: Range, kinds: Kind[]): Promise<ExportRecord[]> {
    const [assessments, briefs] = await Promise.all([
      kinds.includes('assessments') ? store.assessments(rcicId, range) : Promise.resolve([]),
      kinds.includes('briefs') ? store.sentBriefs(rcicId, range) : Promise.resolve([]),
    ]);
    // The store already queries one partition. Check again here, so a store
    // bug can't put another consultant's rows in a file.
    const records: ExportRecord[] = [
      ...assessments.filter((r) => r.rcicId === rcicId && inRange(r.timestamp, range)).map(toAssessmentRecord),
      ...briefs
        .filter((r) => r.rcicId === rcicId && r.status === 'sent' && inRange(r.sentAt, range))
        .map((r) => toBriefRecord(r, config.signingKeyId)),
    ];
    return sortRecords(records);
  }

  async function ledger(rcicId: string, query: Record<string, string | undefined>): Promise<Json> {
    const range = parseRange(query.from, query.to);
    if (!range.ok) return json(400, { error: range.error });
    const kinds = parseKinds(query.kinds === undefined ? undefined : query.kinds.split(','));
    if (!kinds.ok) return json(400, { error: kinds.error });
    const records = await collect(rcicId, range.value, kinds.value);
    return json(200, { from: range.value.from, to: range.value.to, records: records.map(toLedgerEntry) });
  }

  async function exportRecords(rcicId: string, body: Row): Promise<Json> {
    const req = parseExportRequest(body);
    if (!req.ok) return json(400, { error: req.error });
    const { from, to, kinds } = req.value;

    const key = await publicKey();
    const spkiSha256 = sha256Hex(key.spki);
    if (spkiSha256 !== config.pinnedSpkiSha256) {
      log('error', 'records-export-key-mismatch', { rcicId, keyId: key.keyId, spkiSha256 });
      return json(500, { error: 'signing-key-fingerprint-mismatch' });
    }

    const records = await collect(rcicId, req.value, kinds);
    const generated = now();
    const assessmentCount = records.filter((r) => r.kind === 'assessment').length;
    const reviewCount = records.filter((r) => r.kind === 'assessment' && r.recordKind === RECORD_KIND_REVIEW).length;
    const briefCount = records.length - assessmentCount;
    const verify = buildVerifyDoc({
      from,
      to,
      generatedAt: generated.toISOString(),
      keyId: key.keyId,
      spkiSha256,
      assessmentCount,
      reviewCount,
      briefCount,
    });
    const zip = buildZip(
      [
        { name: RECORDS_FILE, data: Buffer.from(toJsonl(records), 'utf8') },
        { name: VERIFY_FILE, data: Buffer.from(verify, 'utf8') },
        { name: KEY_FILE, data: Buffer.from(spkiToPem(key.spki), 'utf8') },
      ],
      generated,
    );

    const exportId = newId();
    const objectKey = `exports/${encodeURIComponent(rcicId)}/${exportId}.zip`;
    const fileName = `argus-records-${from}-to-${to}.zip`;
    await blobs.put(objectKey, zip, { contentType: 'application/zip', fileName });
    const url = await blobs.presign(objectKey, config.urlTtlSeconds);
    const expiresAt = new Date(generated.getTime() + config.urlTtlSeconds * 1000).toISOString();

    log('info', 'records-exported', { rcicId, exportId, from, to, kinds, assessmentCount, reviewCount, briefCount, bytes: zip.length });
    return json(200, { url, expiresAt, fileName, from, to, counts: { assessments: assessmentCount, consultantReviews: reviewCount, briefs: briefCount } });
  }

  return async function handle(event: APIGatewayProxyEventV2): Promise<Json> {
    const routeKey = event.routeKey ?? `${event.requestContext.http.method} ${event.rawPath}`;
    const rcicId = resolveRcicId(event);
    log('info', 'records-request', { routeKey, rcicId });
    try {
      if (!rcicId) return json(403, { error: 'missing-tenant-claim' });
      if (routeKey === 'GET /records') return await ledger(rcicId, event.queryStringParameters ?? {});
      if (routeKey === 'POST /exports') return await exportRecords(rcicId, parseBody(event));
      return json(404, { error: 'route-not-found', routeKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const httpStatus = (err as { httpStatus?: number }).httpStatus ?? 500;
      log(httpStatus >= 500 ? 'error' : 'info', 'records-request-failed', { routeKey, rcicId, error: message, httpStatus });
      return json(httpStatus, { error: httpStatus >= 500 ? 'internal-error' : message });
    }
  };
}

// No fallback tenant: a token without an rcic claim must never read another
// tenant's data. Same rule as services/impacts-service. The request body
// never names the tenant.
export function resolveRcicId(event: APIGatewayProxyEventV2): string | null {
  const claims = (event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } }).authorizer?.jwt?.claims;
  const idClaim = claims?.['custom:rcic_id'];
  if (typeof idClaim === 'string' && idClaim.length > 0) return idClaim;
  const licenseClaim = claims?.['custom:rcic_license'];
  if (typeof licenseClaim === 'string' && licenseClaim.length > 0) return licenseClaim;
  return null;
}

function parseBody(event: APIGatewayProxyEventV2): Row {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('invalid-json-body'), { httpStatus: 400 });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('body-must-be-an-object'), { httpStatus: 400 });
  return parsed as Row;
}

function json(statusCode: number, body: unknown): Json {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
