import { ApplyGuardrailCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { KMSClient, GetPublicKeyCommand } from '@aws-sdk/client-kms';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { readGuardrailVerdict } from './guardrail';
import { COUNTER_KINDS, counterKey, jwkFromSpki, publicConsultant, sumStats, windowDays, type CounterRow, type Jwk, type PublicConsultant, type PublicStats } from './public';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});
const bedrock = new BedrockRuntimeClient({});

const IMPACT_ASSESSMENTS_TABLE = requiredEnv('IMPACT_ASSESSMENTS_TABLE');
const TRAINING_CORRECTIONS_TABLE = requiredEnv('TRAINING_CORRECTIONS_TABLE');
const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const BRIEFS_TABLE = requiredEnv('BRIEFS_TABLE');
const SIGNING_KEY_ID = requiredEnv('SIGNING_KEY_ID');
const GUARDRAIL_ID = requiredEnv('BEDROCK_GUARDRAIL_ID');
const GUARDRAIL_VERSION = requiredEnv('BEDROCK_GUARDRAIL_VERSION');
const RCIC_USERS_TABLE = requiredEnv('RCIC_USERS_TABLE');
const PUBLIC_COUNTERS_TABLE = requiredEnv('PUBLIC_COUNTERS_TABLE');
type ImpactType = 'crs-delta' | 'eligibility-flip' | 'deadline-shift' | 'lmia-implication' | 'french-bonus' | 'procedural' | 'none';
type Confidence = 'low' | 'medium' | 'high';

// Anchor and briefs-service both call KMS Sign with MessageType DIGEST over
// the SHA-256 of the canonical payload. Public receipts name the scheme so a
// later signing change can't be confused with this one.
const SIGNATURE_SCHEME = 'kms-digest-v1';

let cachedPublicKey: { pem: string; keyId: string; der: Uint8Array } | null = null;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext.http.method;
  const routeKey = event.routeKey ?? `${method} ${event.rawPath}`;
  const rcicId = resolveRcicId(event);

  log('info', 'impacts-request', { routeKey, rcicId, path: event.rawPath });

  try {
    if (routeKey === 'GET /public/verify/{hash}') return json(200, await publicVerify(decodePathParam(event, 'hash')));
    if (routeKey === 'GET /public/jwks') return json(200, await publicJwks(), { 'cache-control': 'public, max-age=3600' });
    if (routeKey === 'GET /public/stats') return json(200, await publicStats(), { 'cache-control': 'public, max-age=300' });
    if (!rcicId) throw httpError(403, 'missing-tenant-claim');
    if (routeKey === 'GET /impacts') return json(200, await listImpacts(rcicId));
    if (routeKey === 'GET /impacts/{id}') return json(200, await getImpact(rcicId, decodePathParam(event, 'id')));
    if (routeKey === 'GET /impacts/{id}/audit-signature') return json(200, await getAuditSignature(rcicId, decodePathParam(event, 'id')));
    if (routeKey === 'POST /impacts/{id}/correction') return json(200, await postCorrection(rcicId, decodePathParam(event, 'id'), parseBody(event)));
    if (routeKey === 'GET /impacts/{id}/corrections') return json(200, await listCorrections(rcicId, decodePathParam(event, 'id')));
    if (routeKey === 'GET /corrections') return json(200, await listCorrections(rcicId, null));
    return json(404, { error: 'route-not-found', routeKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const httpStatus = (err as { httpStatus?: number }).httpStatus ?? 500;
    log(httpStatus >= 500 ? 'error' : 'info', 'impacts-request-failed', { routeKey, rcicId, error: message, httpStatus });
    return json(httpStatus, { error: message });
  }
};

async function listImpacts(rcicId: string): Promise<{ impacts: Record<string, unknown>[] }> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: IMPACT_ASSESSMENTS_TABLE,
      KeyConditionExpression: 'rcicId = :r',
      ExpressionAttributeValues: { ':r': rcicId },
    }),
  );
  const items = (res.Items ?? []).map(stripInternal).sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')));
  return { impacts: items };
}

async function getImpact(rcicId: string, assessmentKey: string): Promise<Record<string, unknown>> {
  const res = await ddb.send(new GetCommand({ TableName: IMPACT_ASSESSMENTS_TABLE, Key: { rcicId, assessmentKey } }));
  if (!res.Item) throw httpError(404, 'assessment-not-found');
  return stripInternal(res.Item);
}

async function getAuditSignature(rcicId: string, assessmentKey: string): Promise<Record<string, unknown>> {
  const res = await ddb.send(new GetCommand({ TableName: IMPACT_ASSESSMENTS_TABLE, Key: { rcicId, assessmentKey } }));
  if (!res.Item) throw httpError(404, 'assessment-not-found');
  const publicKey = await loadPublicKey();
  return {
    assessmentKey,
    signatureAlgorithm: res.Item.signatureAlgorithm,
    canonicalHash: res.Item.canonicalHash,
    signatureBase64: res.Item.signatureBase64,
    signingKeyId: res.Item.signingKeyId,
    publicKeyPem: publicKey.pem,
    verification: {
      algorithm: 'ECDSA_SHA_256',
      curve: 'P-256',
      messageIsHex: true,
      messageIsHash: true,
      how: 'Decode signatureBase64 from base64; decode canonicalHash from hex; verify with the P-256 public key.',
    },
  };
}

async function postCorrection(rcicId: string, assessmentKey: string, body: Record<string, unknown>): Promise<{ correction: Record<string, unknown> }> {
  const assessmentRes = await ddb.send(new GetCommand({ TableName: IMPACT_ASSESSMENTS_TABLE, Key: { rcicId, assessmentKey } }));
  if (!assessmentRes.Item) throw httpError(404, 'assessment-not-found');
  const original = assessmentRes.Item;

  const correctorReasoning = requireString(body, 'correctorReasoning');
  const correctedImpactType = requireEnum<ImpactType>(body, 'correctedImpactType', ['crs-delta', 'eligibility-flip', 'deadline-shift', 'lmia-implication', 'french-bonus', 'procedural', 'none']);
  const correctedNumericDelta = coerceNumericDelta(body.correctedNumericDelta);
  const correctedNarrative = optionalString(body, 'correctedNarrative');
  const correctedRecommendedAction = optionalString(body, 'correctedRecommendedAction');
  const correctedConfidence = optionalEnum<Confidence>(body, 'correctedConfidence', ['low', 'medium', 'high']);

  await rejectIfGuardrailIntervenes(rcicId, assessmentKey, [correctorReasoning, correctedNarrative, correctedRecommendedAction]);

  // The Auditor ranks corrections by topic, then by policyDomain. Anchor
  // doesn't write the domain onto the assessment, so read it from the rule
  // the assessment cites.
  const ruleHash = String(original.ruleHash ?? '');
  const policyDomain = await loadPolicyDomain(ruleHash);

  const timestamp = new Date().toISOString();
  const correctionKey = `${assessmentKey}#${timestamp}`;
  const item = {
    rcicId,
    correctionKey,
    assessmentKey,
    clientId: String(original.clientId ?? ''),
    policyEventId: String(original.policyEventId ?? ''),
    ruleHash,
    topic: String(original.topic ?? ''),
    policyDomain,
    originalImpactType: String(original.impactType ?? ''),
    originalNumericDelta: original.numericDelta ?? null,
    originalNarrative: String(original.narrative ?? ''),
    originalRecommendedAction: String(original.recommendedAction ?? ''),
    originalConfidence: String(original.confidence ?? ''),
    correctedImpactType,
    correctedNumericDelta,
    correctedNarrative,
    correctedRecommendedAction,
    correctedConfidence,
    correctorReasoning,
    correctedAt: timestamp,
  };

  await ddb.send(new PutCommand({ TableName: TRAINING_CORRECTIONS_TABLE, Item: item }));

  log('info', 'correction-persisted', {
    rcicId,
    assessmentKey,
    correctionKey,
    topic: item.topic,
    originalDelta: item.originalNumericDelta,
    correctedDelta: correctedNumericDelta,
  });
  return { correction: item };
}

/**
 * The consultant's own corrections, newest first. With an assessmentKey, only
 * the ones filed on that assessment: correctionKey is
 * `${assessmentKey}#${correctedAt}`, so a begins_with on the sort key inside
 * the tenant partition finds them without a scan.
 */
async function listCorrections(rcicId: string, assessmentKey: string | null): Promise<{ corrections: Record<string, unknown>[] }> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TRAINING_CORRECTIONS_TABLE,
        KeyConditionExpression: assessmentKey === null ? 'rcicId = :r' : 'rcicId = :r AND begins_with(correctionKey, :p)',
        ExpressionAttributeValues: assessmentKey === null ? { ':r': rcicId } : { ':r': rcicId, ':p': `${assessmentKey}#` },
        ScanIndexForward: false,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  items.sort((a, b) => String(b.correctedAt ?? '').localeCompare(String(a.correctedAt ?? '')));
  return { corrections: items };
}

// The Auditor sends every stored correction to Bedrock inside a guarded
// block, and the guardrail blocks client names. A correction that names a
// client would block every audit for this consultant until it ages out, so
// the same guardrail checks the free text here, before anything is stored.
// Logs policy names only, never the text that matched.
async function rejectIfGuardrailIntervenes(rcicId: string, assessmentKey: string, fields: Array<string | null>): Promise<void> {
  const content = fields.filter((f): f is string => f !== null).map((text) => ({ text: { text } }));
  const res = await bedrock.send(
    new ApplyGuardrailCommand({
      guardrailIdentifier: GUARDRAIL_ID,
      guardrailVersion: GUARDRAIL_VERSION,
      source: 'INPUT',
      content,
    }),
  );
  const verdict = readGuardrailVerdict(res);
  if (!verdict.intervened) return;
  const personal = verdict.policies.some((p) => p.startsWith('pii:') || p.startsWith('regex:'));
  log('info', 'correction-rejected-by-guardrail', { rcicId, assessmentKey, policies: verdict.policies });
  throw httpError(422, personal ? 'correction-contains-personal-information' : 'correction-blocked-by-guardrail');
}

async function loadPolicyDomain(ruleHash: string): Promise<string> {
  if (!ruleHash) return '';
  const res = await ddb.send(
    new GetCommand({ TableName: POLICY_RULES_TABLE, Key: { rule_hash: ruleHash }, ProjectionExpression: 'policy_domain' }),
  );
  const domain = res.Item?.policy_domain;
  return typeof domain === 'string' ? domain : '';
}

/**
 * Public verify endpoint. No auth. Returns everything needed for a browser
 * to verify the ECDSA signature, plus minimal display metadata. Does NOT
 * return the narrative, recommended action, or clientId — the public
 * receipt page shows proof of signing, not the underlying assessment
 * content, so a shared link doesn't leak anything the RCIC didn't intend.
 */
async function publicVerify(canonicalHash: string): Promise<Record<string, unknown>> {
  const cleanHash = canonicalHash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanHash)) throw httpError(400, 'invalid-hash-format');

  const gsi = await ddb.send(
    new QueryCommand({
      TableName: IMPACT_ASSESSMENTS_TABLE,
      IndexName: 'byCanonicalHash',
      KeyConditionExpression: 'canonicalHash = :h',
      ExpressionAttributeValues: { ':h': cleanHash },
      Limit: 1,
    }),
  );
  const gsiHit = (gsi.Items ?? [])[0];
  if (!gsiHit || typeof gsiHit.rcicId !== 'string' || typeof gsiHit.assessmentKey !== 'string') {
    // Not an assessment. The link in a sent brief's email footer carries the
    // brief's sent-body hash, so look there next.
    return publicVerifyBrief(cleanHash);
  }

  const full = await ddb.send(
    new GetCommand({
      TableName: IMPACT_ASSESSMENTS_TABLE,
      Key: { rcicId: gsiHit.rcicId, assessmentKey: gsiHit.assessmentKey },
    }),
  );
  const item = full.Item;
  if (!item) throw httpError(404, 'assessment-not-found');

  const publicKey = await loadPublicKey();
  return {
    kind: 'assessment',
    scheme: SIGNATURE_SCHEME,
    fingerprint: cleanHash,
    topic: String(item.topic ?? ''),
    signedAt: String(item.timestamp ?? ''),
    signatureAlgorithm: String(item.signatureAlgorithm ?? 'ECDSA_SHA_256'),
    canonicalHash: cleanHash,
    signatureBase64: String(item.signatureBase64 ?? ''),
    signingKeyId: String(item.signingKeyId ?? ''),
    publicKeyPem: publicKey.pem,
    verification: {
      algorithm: 'ECDSA_SHA_256',
      curve: 'P-256',
      messageIsHex: true,
      messageIsHash: true,
      how: 'Decode signatureBase64 from base64; decode canonicalHash from hex; verify with the P-256 public key.',
    },
    // The signing consultant, only when they opted in. Never the client.
    consultant: await loadPublicConsultant(gsiHit.rcicId),
    // Deliberately omitted: rcicId, clientId, assessmentKey, narrative,
    // recommendedAction, ruleHash. This endpoint is for signature proof only.
  };
}

/** The signing key as a JWK set, for /.well-known/jwks.json on the web. */
async function publicJwks(): Promise<{ keys: Jwk[] }> {
  const publicKey = await loadPublicKey();
  return { keys: [jwkFromSpki(publicKey.der, publicKey.keyId)] };
}

// The landing counter can lag by a few minutes, so a warm container answers
// from memory instead of reading DynamoDB on every page view.
const STATS_TTL_MS = 60_000;
let cachedStats: { at: number; stats: PublicStats } | null = null;

async function publicStats(): Promise<PublicStats> {
  const now = new Date();
  if (cachedStats && now.getTime() - cachedStats.at < STATS_TTL_MS) return cachedStats.stats;
  const keys = COUNTER_KINDS.flatMap((kind) => windowDays(now).map((day) => ({ counterKey: counterKey(kind, day) })));
  const res = await ddb.send(new BatchGetCommand({ RequestItems: { [PUBLIC_COUNTERS_TABLE]: { Keys: keys } } }));
  // 14 small rows never exceed BatchGet's size limit, so anything unprocessed
  // is throttling. Report what came back rather than retry on a public route.
  const rows = (res.Responses?.[PUBLIC_COUNTERS_TABLE] ?? []) as CounterRow[];
  const stats = sumStats(rows, now);
  cachedStats = { at: now.getTime(), stats };
  return stats;
}

// A receipt still verifies when the consultant row can't be read. It just
// shows no name.
async function loadPublicConsultant(rcicId: string): Promise<PublicConsultant | null> {
  try {
    const res = await ddb.send(
      new GetCommand({
        TableName: RCIC_USERS_TABLE,
        Key: { rcicId },
        ProjectionExpression: 'displayName, rcicLicense, preferences',
      }),
    );
    return publicConsultant(res.Item);
  } catch (err) {
    log('error', 'public-consultant-unavailable', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Public receipt for a sent brief, found by its sent-body hash. Same shape
 * as the assessment receipt. Never returns the body, the recipient hash or
 * domain, the client or the sender's email. The consultant's name and
 * licence appear only when they opted in.
 */
async function publicVerifyBrief(cleanHash: string): Promise<Record<string, unknown>> {
  const gsi = await ddb.send(
    new QueryCommand({
      TableName: BRIEFS_TABLE,
      IndexName: 'bySentBodyHash',
      KeyConditionExpression: 'sentBodyHash = :h',
      ExpressionAttributeValues: { ':h': cleanHash },
      Limit: 1,
    }),
  );
  const hit = (gsi.Items ?? [])[0];
  if (!hit || typeof hit.rcicId !== 'string' || typeof hit.briefId !== 'string') throw httpError(404, 'receipt-not-found');

  const full = await ddb.send(new GetCommand({ TableName: BRIEFS_TABLE, Key: { rcicId: hit.rcicId, briefId: hit.briefId } }));
  const item = full.Item;
  if (!item || item.sentBodyHash !== cleanHash || typeof item.sentSignature !== 'string') throw httpError(404, 'receipt-not-found');

  const publicKey = await loadPublicKey();
  return {
    kind: 'brief',
    scheme: SIGNATURE_SCHEME,
    fingerprint: cleanHash,
    topic: String(item.topic ?? ''),
    signedAt: String(item.sentAt ?? ''),
    signatureAlgorithm: String(item.sentSignatureAlgorithm ?? 'ECDSA_SHA_256'),
    canonicalHash: cleanHash,
    signatureBase64: item.sentSignature,
    signingKeyId: typeof item.sentSigningKeyId === 'string' ? item.sentSigningKeyId : publicKey.keyId,
    publicKeyPem: publicKey.pem,
    verification: {
      algorithm: 'ECDSA_SHA_256',
      curve: 'P-256',
      messageIsHex: true,
      messageIsHash: true,
      how: 'Decode signatureBase64 from base64; decode canonicalHash from hex; verify with the P-256 public key.',
    },
    // Same opt-in as assessment receipts: the sending consultant, never the client.
    consultant: await loadPublicConsultant(hit.rcicId),
  };
}

async function loadPublicKey(): Promise<{ pem: string; keyId: string; der: Uint8Array }> {
  if (cachedPublicKey) return cachedPublicKey;
  const res = await kms.send(new GetPublicKeyCommand({ KeyId: SIGNING_KEY_ID }));
  const raw = res.PublicKey;
  if (!raw) throw new Error('kms returned no public key');
  const b64 = Buffer.from(raw).toString('base64');
  const pem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? b64}\n-----END PUBLIC KEY-----\n`;
  cachedPublicKey = { pem, keyId: SIGNING_KEY_ID, der: raw };
  return cachedPublicKey;
}

// No fallback tenant: a token without an rcic claim must never read another tenant's data.
function resolveRcicId(event: APIGatewayProxyEventV2): string | null {
  const claims = (event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, string> } } }).authorizer?.jwt?.claims;
  const idClaim = claims?.['custom:rcic_id'];
  if (typeof idClaim === 'string' && idClaim.length > 0) return idClaim;
  const licenseClaim = claims?.['custom:rcic_license'];
  if (typeof licenseClaim === 'string' && licenseClaim.length > 0) return licenseClaim;
  return null;
}

function decodePathParam(event: APIGatewayProxyEventV2, name: string): string {
  const v = event.pathParameters?.[name];
  if (typeof v !== 'string' || v.length === 0) throw httpError(400, `missing-path-param-${name}`);
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    throw httpError(400, 'invalid-json-body');
  }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || v.trim().length === 0) throw httpError(400, `missing-required-${key}`);
  return v.trim();
}

function optionalString(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  if (typeof v !== 'string' || v.trim().length === 0) return null;
  return v.trim();
}

function requireEnum<T extends string>(body: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = body[key];
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw httpError(400, `invalid-${key}-must-be-one-of-${allowed.join('|')}`);
  return v as T;
}

function optionalEnum<T extends string>(body: Record<string, unknown>, key: string, allowed: readonly T[]): T | null {
  const v = body[key];
  if (typeof v !== 'string' || !allowed.includes(v as T)) return null;
  return v as T;
}

function coerceNumericDelta(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw httpError(400, 'correctedNumericDelta-must-be-number-or-null');
}

function stripInternal(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (k === 'signatureBase64' || k === 'auditorReasoning') continue;
    out[k] = v;
  }
  return out;
}

function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

function httpError(status: number, code: string): Error & { httpStatus?: number } {
  const err = new Error(code) as Error & { httpStatus?: number };
  err.httpStatus = status;
  return err;
}

function log(level: 'debug' | 'info' | 'error', msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
