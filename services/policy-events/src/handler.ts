import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  type BatchGetCommandInput,
  type BatchGetCommandOutput,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  buildActivity,
  buildEventImpacts,
  buildEvents,
  eventIdOf,
  listView,
  parseLimit,
  resolveEventId,
  str,
  strOrNull,
  toAssessment,
  type ActivityItem,
  type Assessment,
  type BriefRow,
  type CorrectionRow,
  type EventImpact,
  type PolicyEvent,
  type Row,
  type Rule,
} from './derive.ts';

// Policy events service (Phase C1).
//
// Nothing writes argus-policy-events yet, so every event here is derived at
// read time: one event per rule (ruleHash), built from ImpactAssessments and
// joined to PolicyRules (summary, severity, citation), Briefs,
// TrainingCorrections and Alerts. The grouping rules live in derive.ts.
// Response shapes live in web/src/lib/types/policy-events.ts.
//
// Data rules this file holds to:
// - PolicyRules reads never project rule_content.
// - ClientProfiles reads project a whitelist only. notes and age never leave
//   the table.
// - Severity is whatever Sentinel stored on the rule. No thresholds here.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const IMPACT_ASSESSMENTS_TABLE = requiredEnv('IMPACT_ASSESSMENTS_TABLE');
const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const BRIEFS_TABLE = requiredEnv('BRIEFS_TABLE');
const TRAINING_CORRECTIONS_TABLE = requiredEnv('TRAINING_CORRECTIONS_TABLE');
const CLIENT_PROFILES_TABLE = requiredEnv('CLIENT_PROFILES_TABLE');
const ALERTS_TABLE = requiredEnv('ALERTS_TABLE');
const POLICY_CORPUS_BUCKET = requiredEnv('POLICY_CORPUS_BUCKET');
const ARCHIVE_LINK_TTL_SECONDS = Number(process.env.ARCHIVE_LINK_TTL_SECONDS ?? String(7 * 24 * 60 * 60));
const HEAD_CHECK_TIMEOUT_MS = 3_000;

const ASSESSMENT_LIST_FIELDS = [
  'assessmentKey',
  'policyEventId',
  'ruleHash',
  'clientId',
  'topic',
  'isAffected',
  'impactType',
  'numericDelta',
  'timestamp',
  'canonicalHash',
  'signatureAlgorithm',
  'recommendedAction',
  'confidence',
];

const ASSESSMENT_IMPACT_FIELDS = [
  'assessmentKey',
  'policyEventId',
  'ruleHash',
  'clientId',
  'topic',
  'isAffected',
  'impactType',
  'numericDelta',
  'confidence',
  'recommendedAction',
  'narrative',
  'canonicalHash',
  'signatureAlgorithm',
  'timestamp',
];

// rule_content is deliberately absent.
const RULE_FIELDS = [
  'rule_hash',
  'summary',
  'severity',
  'category',
  'policy_domain',
  'topic',
  'source_url',
  'source_s3_key',
  'source_s3_version_id',
  'captured_at',
];

const BRIEF_FIELDS = ['briefId', 'assessmentKey', 'clientId', 'topic', 'status', 'sentAt', 'createdAt', 'updatedAt'];
const CORRECTION_FIELDS = ['correctionKey', 'assessmentKey', 'clientId', 'topic', 'correctedAt'];
// recipient (the consultant's own email) is deliberately absent.
const ALERT_FIELDS = ['timestamp', 'briefId', 'clientId', 'channel'];
// Whitelist. notes, age and every other profile attribute stay in the table.
const CLIENT_PROFILE_FIELDS = ['clientId', 'program', 'status', 'currentCrsScore'];

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext.http.method;
  const routeKey = event.routeKey ?? `${method} ${event.rawPath}`;
  const rcicId = resolveRcicId(event);

  log('info', 'policy-events-request', { routeKey, rcicId, path: event.rawPath });

  try {
    if (!rcicId) throw httpError(403, 'missing-tenant-claim');
    if (routeKey === 'GET /policy-events') return json(200, await listEvents(rcicId, event.queryStringParameters ?? {}));
    if (routeKey === 'GET /policy-events/{id}') return json(200, await getEvent(rcicId, decodePathParam(event, 'id')));
    if (routeKey === 'GET /policy-events/{id}/impacts') return json(200, await getEventImpacts(rcicId, decodePathParam(event, 'id')));
    if (routeKey === 'GET /activity') return json(200, await listActivity(rcicId, event.queryStringParameters ?? {}));
    return json(404, { error: 'route-not-found', routeKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const httpStatus = (err as { httpStatus?: number }).httpStatus ?? 500;
    log(httpStatus >= 500 ? 'error' : 'info', 'policy-events-request-failed', { routeKey, rcicId, error: message, httpStatus });
    return json(httpStatus, { error: message });
  }
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function listEvents(
  rcicId: string,
  qs: Record<string, string | undefined>,
): Promise<{ events: PolicyEvent[]; totals: { actionRequired: number; detectedThisMonth: number }; generatedAt: string }> {
  if (qs.status !== undefined && !['action-required', 'done', 'no-impact'].includes(qs.status)) {
    throw httpError(400, 'invalid-status-must-be-one-of-action-required|done|no-impact');
  }

  const [assessments, briefs, corrections] = await Promise.all([
    loadAssessments(rcicId, ASSESSMENT_LIST_FIELDS),
    loadBriefs(rcicId),
    loadCorrections(rcicId),
  ]);
  const parsed = assessments.map(toAssessment);
  const rules = await loadRules(unique(parsed.map((a) => a.ruleHash)));
  const all = buildEvents(parsed, rules, briefs, corrections);

  const now = new Date();
  const { events, totals } = listView(all, qs, now);
  log('info', 'policy-events-listed', { rcicId, total: all.length, returned: events.length, assessments: parsed.length });
  return { events, totals, generatedAt: now.toISOString() };
}

async function getEvent(
  rcicId: string,
  id: string,
): Promise<{ event: PolicyEvent; citation: { sourceUrl: string | null; sourceIsLive: boolean; archiveUrl: string | null; capturedAt: string | null } }> {
  const [rows, briefs, corrections] = await Promise.all([
    loadAssessments(rcicId, ASSESSMENT_LIST_FIELDS),
    loadBriefs(rcicId),
    loadCorrections(rcicId),
  ]);
  const { eventId, list } = selectEvent(rows.map(toAssessment), id);
  const rules = await loadRules(unique(list.map((a) => a.ruleHash)));
  const [event] = buildEvents(list, rules, briefs, corrections);
  if (!event) throw httpError(404, 'event-not-found');
  if (eventId !== id) log('info', 'policy-event-id-resolved', { rcicId, requested: id, eventId });

  const rule = rules.get(event.ruleHash) ?? null;
  const [sourceIsLive, archiveUrl] = await Promise.all([
    checkUrlLive(rule?.sourceUrl ?? ''),
    presignArchive(rule?.sourceS3Key ?? '', rule?.sourceS3VersionId ?? null),
  ]);
  return {
    event,
    citation: {
      sourceUrl: rule?.sourceUrl ?? null,
      sourceIsLive,
      archiveUrl,
      capturedAt: rule?.capturedAt ?? null,
    },
  };
}

async function getEventImpacts(rcicId: string, id: string): Promise<{ eventId: string; clients: EventImpact[] }> {
  const [rows, briefs, corrections] = await Promise.all([
    loadAssessments(rcicId, ASSESSMENT_IMPACT_FIELDS),
    loadBriefs(rcicId),
    loadCorrections(rcicId),
  ]);
  const { eventId, list } = selectEvent(rows, id);
  const profiles = await loadClientProfiles(rcicId, unique(list.map((r) => str(r.clientId)).filter(Boolean)));
  return { eventId, clients: buildEventImpacts(list, briefs, corrections, profiles) };
}

/**
 * Every run of a rule lives under a different policyEventId, and there is no
 * ruleHash index, so the whole tenant partition is read and filtered here.
 */
function selectEvent<T extends Row | Assessment>(rows: T[], id: string): { eventId: string; list: T[] } {
  const keyed = rows.map((r) => ({ row: r, ruleHash: str(r.ruleHash), policyEventId: str(r.policyEventId) }));
  const eventId = resolveEventId(keyed, id);
  if (!eventId) throw httpError(404, 'event-not-found');
  const list = keyed.filter((k) => eventIdOf(k) === eventId).map((k) => k.row);
  if (list.length === 0) throw httpError(404, 'event-not-found');
  return { eventId, list };
}

async function listActivity(rcicId: string, qs: Record<string, string | undefined>): Promise<{ items: ActivityItem[]; nextBefore: string | null }> {
  const limit = parseLimit(qs.limit, ACTIVITY_DEFAULT_LIMIT, ACTIVITY_MAX_LIMIT);
  let before: string | null = null;
  if (qs.before !== undefined && qs.before !== '') {
    const ms = Date.parse(qs.before);
    if (Number.isNaN(ms)) throw httpError(400, 'invalid-before-must-be-iso-timestamp');
    before = new Date(ms).toISOString();
  }

  const [assessments, briefs, corrections, alerts] = await Promise.all([
    loadAssessments(rcicId, ASSESSMENT_LIST_FIELDS),
    loadBriefs(rcicId),
    loadCorrections(rcicId),
    loadAlerts(rcicId),
  ]);
  return buildActivity(assessments.map(toAssessment), briefs, corrections, alerts, { limit, before });
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

async function loadAssessments(rcicId: string, fields: string[]): Promise<Row[]> {
  return queryAll({
    TableName: IMPACT_ASSESSMENTS_TABLE,
    KeyConditionExpression: '#pk = :r',
    ...projection(fields, { '#pk': 'rcicId' }),
    ExpressionAttributeValues: { ':r': rcicId },
  });
}

async function loadBriefs(rcicId: string): Promise<BriefRow[]> {
  const rows = await queryAll({
    TableName: BRIEFS_TABLE,
    KeyConditionExpression: '#pk = :r',
    ...projection(BRIEF_FIELDS, { '#pk': 'rcicId' }),
    ExpressionAttributeValues: { ':r': rcicId },
  });
  return rows.map((r) => ({
    briefId: str(r.briefId),
    assessmentKey: str(r.assessmentKey),
    clientId: str(r.clientId),
    topic: str(r.topic),
    status: str(r.status),
    sentAt: strOrNull(r.sentAt),
    createdAt: strOrNull(r.createdAt),
    updatedAt: strOrNull(r.updatedAt),
  }));
}

async function loadCorrections(rcicId: string): Promise<CorrectionRow[]> {
  const rows = await queryAll({
    TableName: TRAINING_CORRECTIONS_TABLE,
    KeyConditionExpression: '#pk = :r',
    ...projection(CORRECTION_FIELDS, { '#pk': 'rcicId' }),
    ExpressionAttributeValues: { ':r': rcicId },
  });
  return rows.map((r) => ({
    correctionKey: str(r.correctionKey),
    assessmentKey: str(r.assessmentKey),
    clientId: str(r.clientId),
    topic: str(r.topic),
    correctedAt: str(r.correctedAt),
  }));
}

async function loadAlerts(rcicId: string): Promise<Row[]> {
  return queryAll({
    TableName: ALERTS_TABLE,
    KeyConditionExpression: '#pk = :r',
    ScanIndexForward: false,
    ...projection(ALERT_FIELDS, { '#pk': 'rcicId' }),
    ExpressionAttributeValues: { ':r': rcicId },
  });
}

async function loadRules(ruleHashes: string[]): Promise<Map<string, Rule>> {
  const out = new Map<string, Rule>();
  const rows = await batchGetAll(
    POLICY_RULES_TABLE,
    ruleHashes.filter(Boolean).map((h) => ({ rule_hash: h })),
    RULE_FIELDS,
  );
  for (const r of rows) {
    const hash = str(r.rule_hash);
    const sev = str(r.severity);
    out.set(hash, {
      ruleHash: hash,
      summary: strOrNull(r.summary),
      severity: sev === 'high' || sev === 'medium' || sev === 'low' ? sev : null,
      category: strOrNull(r.category),
      policyDomain: strOrNull(r.policy_domain),
      topic: strOrNull(r.topic),
      sourceUrl: strOrNull(r.source_url),
      sourceS3Key: strOrNull(r.source_s3_key),
      sourceS3VersionId: strOrNull(r.source_s3_version_id),
      capturedAt: strOrNull(r.captured_at),
    });
  }
  return out;
}

async function loadClientProfiles(rcicId: string, clientIds: string[]): Promise<Map<string, Row>> {
  const rows = await batchGetAll(
    CLIENT_PROFILES_TABLE,
    clientIds.map((clientId) => ({ rcicId, clientId })),
    CLIENT_PROFILE_FIELDS,
  );
  const out = new Map<string, Row>();
  for (const r of rows) {
    // Re-apply the whitelist in code as well as in the projection.
    const safe: Row = {};
    for (const f of CLIENT_PROFILE_FIELDS) if (f in r) safe[f] = r[f];
    out.set(str(r.clientId), safe);
  }
  return out;
}

async function queryAll(input: QueryCommandInput): Promise<Row[]> {
  const items: Row[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...((res.Items ?? []) as Row[]));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function batchGetAll(tableName: string, keys: Record<string, unknown>[], fields: string[]): Promise<Row[]> {
  const out: Row[] = [];
  const proj = projection(fields);
  for (let i = 0; i < keys.length; i += 100) {
    let request: BatchGetCommandInput['RequestItems'] = {
      [tableName]: { Keys: keys.slice(i, i + 100), ...proj },
    };
    for (let attempt = 0; request && Object.keys(request).length > 0; attempt += 1) {
      if (attempt > 0) {
        if (attempt > 5) throw new Error(`batch-get-unprocessed-keys-${tableName}`);
        await sleep(50 * 2 ** attempt);
      }
      const res: BatchGetCommandOutput = await ddb.send(new BatchGetCommand({ RequestItems: request }));
      out.push(...((res.Responses?.[tableName] ?? []) as Row[]));
      request = res.UnprocessedKeys;
    }
  }
  return out;
}

// Alias every attribute so reserved words (status, timestamp, summary) never
// break a projection.
function projection(fields: string[], extraNames: Record<string, string> = {}): {
  ProjectionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
} {
  const names: Record<string, string> = { ...extraNames };
  const parts = fields.map((f, i) => {
    const alias = `#f${i}`;
    names[alias] = f;
    return alias;
  });
  return { ProjectionExpression: parts.join(', '), ExpressionAttributeNames: names };
}

// ---------------------------------------------------------------------------
// Citation helpers, copied from services/briefs-service/src/handler.ts.
// Services don't share code today.
// ---------------------------------------------------------------------------

async function checkUrlLive(url: string): Promise<boolean> {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_CHECK_TIMEOUT_MS);
  try {
    // GET with a small Range instead of HEAD. canada.ca soft-serves HEAD with
    // a 302 and reports 2xx even when the page 404s.
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Argus/0.1 (link-check)',
        Range: 'bytes=0-127',
      },
    });
    try {
      await res.body?.cancel();
    } catch {
      // ignore cancel errors, we only care about the status
    }
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function presignArchive(s3Key: string, versionId: string | null): Promise<string | null> {
  if (!s3Key) return null;
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: POLICY_CORPUS_BUCKET,
      Key: s3Key,
      ...(versionId ? { VersionId: versionId } : {}),
    }),
    { expiresIn: ARCHIVE_LINK_TTL_SECONDS },
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
