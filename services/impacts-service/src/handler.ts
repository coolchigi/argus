import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { KMSClient, GetPublicKeyCommand } from '@aws-sdk/client-kms';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});

const IMPACT_ASSESSMENTS_TABLE = requiredEnv('IMPACT_ASSESSMENTS_TABLE');
const TRAINING_CORRECTIONS_TABLE = requiredEnv('TRAINING_CORRECTIONS_TABLE');
const SIGNING_KEY_ID = requiredEnv('SIGNING_KEY_ID');
const DEFAULT_RCIC_ID = process.env.DEFAULT_RCIC_ID ?? 'demo-rcic-001';

type ImpactType = 'crs-delta' | 'eligibility-flip' | 'deadline-shift' | 'lmia-implication' | 'french-bonus' | 'procedural' | 'none';
type Confidence = 'low' | 'medium' | 'high';

let cachedPublicKey: { pem: string; keyId: string } | null = null;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext.http.method;
  const routeKey = event.routeKey ?? `${method} ${event.rawPath}`;
  const rcicId = resolveRcicId(event);

  log('info', 'impacts-request', { routeKey, rcicId, path: event.rawPath });

  try {
    if (routeKey === 'GET /impacts') return json(200, await listImpacts(rcicId));
    if (routeKey === 'GET /impacts/{id}') return json(200, await getImpact(rcicId, decodePathParam(event, 'id')));
    if (routeKey === 'GET /impacts/{id}/audit-signature') return json(200, await getAuditSignature(rcicId, decodePathParam(event, 'id')));
    if (routeKey === 'POST /impacts/{id}/correction') return json(200, await postCorrection(rcicId, decodePathParam(event, 'id'), parseBody(event)));
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

  const timestamp = new Date().toISOString();
  const correctionKey = `${assessmentKey}#${timestamp}`;
  const item = {
    rcicId,
    correctionKey,
    assessmentKey,
    clientId: String(original.clientId ?? ''),
    policyEventId: String(original.policyEventId ?? ''),
    ruleHash: String(original.ruleHash ?? ''),
    topic: String(original.topic ?? ''),
    policyDomain: String((original as { policyDomain?: unknown }).policyDomain ?? ''),
    originalImpactType: String(original.impactType ?? ''),
    originalNumericDelta: original.numericDelta ?? null,
    originalNarrative: String(original.narrative ?? ''),
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

async function loadPublicKey(): Promise<{ pem: string; keyId: string }> {
  if (cachedPublicKey) return cachedPublicKey;
  const res = await kms.send(new GetPublicKeyCommand({ KeyId: SIGNING_KEY_ID }));
  const raw = res.PublicKey;
  if (!raw) throw new Error('kms returned no public key');
  const b64 = Buffer.from(raw).toString('base64');
  const pem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? b64}\n-----END PUBLIC KEY-----\n`;
  cachedPublicKey = { pem, keyId: SIGNING_KEY_ID };
  return cachedPublicKey;
}

function resolveRcicId(event: APIGatewayProxyEventV2): string {
  const claims = (event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, string> } } }).authorizer?.jwt?.claims;
  const licenseClaim = claims?.['custom:rcic_license'];
  if (typeof licenseClaim === 'string' && licenseClaim.length > 0) return licenseClaim;
  return DEFAULT_RCIC_ID;
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

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
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
