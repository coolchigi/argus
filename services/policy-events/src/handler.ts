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
import { createHash } from 'node:crypto';

// Policy events service (Phase C1).
//
// Nothing writes argus-policy-events yet, so every event here is derived at
// read time: ImpactAssessments grouped by policyEventId, joined to
// PolicyRules (summary, severity, citation), Briefs, TrainingCorrections and
// Alerts. Response shapes live in web/src/lib/types/policy-events.ts.
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

const EVENTS_DEFAULT_LIMIT = 50;
const EVENTS_MAX_LIMIT = 200;
const ACTIVITY_DEFAULT_LIMIT = 20;
const ACTIVITY_MAX_LIMIT = 100;

type Severity = 'high' | 'medium' | 'low';
type EventStatus = 'action-required' | 'done' | 'no-impact';
type Row = Record<string, unknown>;

type Assessment = {
  assessmentKey: string;
  policyEventId: string;
  ruleHash: string;
  clientId: string;
  topic: string;
  isAffected: boolean;
  timestamp: string;
  canonicalHash: string | null;
  signatureAlgorithm: string | null;
};

type Rule = {
  ruleHash: string;
  summary: string | null;
  severity: Severity | null;
  category: string | null;
  policyDomain: string | null;
  topic: string | null;
  sourceUrl: string | null;
  sourceS3Key: string | null;
  sourceS3VersionId: string | null;
  capturedAt: string | null;
};

type BriefRow = {
  briefId: string;
  assessmentKey: string;
  clientId: string;
  topic: string;
  status: string;
  sentAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type CorrectionRow = {
  correctionKey: string;
  assessmentKey: string;
  clientId: string;
  topic: string;
  correctedAt: string;
};

type PolicyEvent = {
  eventId: string;
  ref: string;
  origin: 'sentinel' | 'recall';
  ruleHash: string;
  topic: string;
  title: string;
  policyDomain: string | null;
  category: string | null;
  severity: Severity | null;
  summary: string | null;
  sourceUrl: string | null;
  detectedAt: string;
  assessedCount: number;
  affectedCount: number;
  signedCount: number;
  briefsSent: number;
  briefsUnsent: number;
  correctionsFiled: number;
  status: EventStatus;
  lastActivityAt: string;
};

type ActivityItem = {
  id: string;
  at: string;
  kind: 'assessment-signed' | 'brief-sent' | 'correction-filed' | 'alert-emailed';
  title: string;
  ref: { kind: 'event' | 'assessment' | 'brief'; id: string };
  clientId: string | null;
  fingerprint: string | null;
};

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

// Display-only casing for kebab-case topic words. Not policy data.
const ACRONYMS = new Set(['crs', 'ee', 'pnp', 'lmia', 'noc', 'teer', 'clb', 'nclc', 'ircc', 'fsw', 'fst', 'cec', 'pgp', 'pgwp', 'pr', 'eca', 'cip', 'gcms']);

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
  const limit = parseLimit(qs.limit, EVENTS_DEFAULT_LIMIT, EVENTS_MAX_LIMIT);
  const statusFilter = qs.status;
  if (statusFilter !== undefined && !['action-required', 'done', 'no-impact'].includes(statusFilter)) {
    throw httpError(400, 'invalid-status-must-be-one-of-action-required|done|no-impact');
  }
  const domainFilter = qs.domain;

  const [assessments, briefs, corrections] = await Promise.all([
    loadAssessments(rcicId),
    loadBriefs(rcicId),
    loadCorrections(rcicId),
  ]);
  const rules = await loadRules(unique(assessments.map((a) => a.ruleHash)));
  const all = buildEvents(assessments, rules, briefs, corrections);

  const now = new Date();
  const monthPrefix = now.toISOString().slice(0, 7);
  const totals = {
    actionRequired: all.filter((e) => e.status === 'action-required').length,
    detectedThisMonth: all.filter((e) => e.detectedAt.startsWith(monthPrefix)).length,
  };

  const events = all
    .filter((e) => (statusFilter ? e.status === statusFilter : true))
    .filter((e) => (domainFilter ? e.policyDomain === domainFilter : true))
    .slice(0, limit);

  log('info', 'policy-events-listed', { rcicId, total: all.length, returned: events.length });
  return { events, totals, generatedAt: now.toISOString() };
}

async function getEvent(
  rcicId: string,
  eventId: string,
): Promise<{ event: PolicyEvent; citation: { sourceUrl: string | null; sourceIsLive: boolean; archiveUrl: string | null; capturedAt: string | null } }> {
  const [assessments, briefs, corrections] = await Promise.all([
    loadAssessmentsForEvent(rcicId, eventId, ASSESSMENT_LIST_FIELDS),
    loadBriefs(rcicId),
    loadCorrections(rcicId),
  ]);
  if (assessments.length === 0) throw httpError(404, 'event-not-found');
  const parsed = assessments.map(toAssessment);
  const rules = await loadRules(unique(parsed.map((a) => a.ruleHash)));
  const [event] = buildEvents(parsed, rules, briefs, corrections);
  if (!event) throw httpError(404, 'event-not-found');

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

async function getEventImpacts(rcicId: string, eventId: string): Promise<{ clients: Row[] }> {
  const [rows, briefs, corrections] = await Promise.all([
    loadAssessmentsForEvent(rcicId, eventId, ASSESSMENT_IMPACT_FIELDS),
    loadBriefs(rcicId),
    loadCorrections(rcicId),
  ]);
  if (rows.length === 0) throw httpError(404, 'event-not-found');

  const profiles = await loadClientProfiles(rcicId, unique(rows.map((r) => str(r.clientId)).filter(Boolean)));
  const briefByAssessment = pickBriefPerAssessment(briefs);
  const correctionCounts = countBy(corrections, (c) => c.assessmentKey);

  const clients = rows.map((r) => {
    const assessmentKey = str(r.assessmentKey);
    const clientId = str(r.clientId);
    const profile = profiles.get(clientId);
    const brief = briefByAssessment.get(assessmentKey);
    return {
      clientId,
      assessmentKey,
      program: profile ? strOrNull(profile.program) : null,
      clientStatus: profile ? strOrNull(profile.status) : null,
      currentCrsScore: profile ? numOrNull(profile.currentCrsScore) : null,
      isAffected: r.isAffected === true,
      impactType: str(r.impactType),
      numericDelta: numOrNull(r.numericDelta),
      confidence: str(r.confidence),
      recommendedAction: str(r.recommendedAction),
      narrative: str(r.narrative),
      canonicalHash: strOrNull(r.canonicalHash),
      signedAt: str(r.timestamp),
      brief: brief ? { briefId: brief.briefId, status: brief.status, sentAt: brief.sentAt } : null,
      correctionsFiled: correctionCounts.get(assessmentKey) ?? 0,
    };
  });

  clients.sort((a, b) => Number(b.isAffected) - Number(a.isAffected) || a.clientId.localeCompare(b.clientId));
  return { clients };
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
    loadAssessments(rcicId),
    loadBriefs(rcicId),
    loadCorrections(rcicId),
    loadAlerts(rcicId),
  ]);

  const items: ActivityItem[] = [];

  for (const a of assessments) {
    if (!a.canonicalHash || !a.timestamp) continue;
    items.push({
      id: `assessment-signed:${a.assessmentKey}`,
      at: a.timestamp,
      kind: 'assessment-signed',
      title: `Assessment signed for ${humanizeTopic(a.topic)}`,
      ref: { kind: 'assessment', id: a.assessmentKey },
      clientId: a.clientId || null,
      fingerprint: a.canonicalHash,
    });
  }

  const briefTopic = new Map<string, string>();
  for (const b of briefs) {
    briefTopic.set(b.briefId, b.topic);
    if (b.status !== 'sent' || !b.sentAt) continue;
    items.push({
      id: `brief-sent:${b.briefId}`,
      at: b.sentAt,
      kind: 'brief-sent',
      title: `Brief sent for ${humanizeTopic(b.topic)}`,
      ref: { kind: 'brief', id: b.briefId },
      clientId: b.clientId || null,
      // The sent-body hash can't be verified on the public receipt page yet
      // (PHASE8_PLAN B4), so it isn't offered as a fingerprint.
      fingerprint: null,
    });
  }

  for (const c of corrections) {
    if (!c.correctedAt) continue;
    items.push({
      id: `correction-filed:${c.correctionKey}`,
      at: c.correctedAt,
      kind: 'correction-filed',
      title: `Correction filed on ${humanizeTopic(c.topic)}`,
      ref: { kind: 'assessment', id: c.assessmentKey },
      clientId: c.clientId || null,
      fingerprint: null,
    });
  }

  // consultant-manual rows mirror a brief send, which is already listed above.
  for (const al of alerts) {
    const at = str(al.timestamp);
    const briefId = str(al.briefId);
    if (!at || str(al.channel) === 'consultant-manual') continue;
    const topic = briefTopic.get(briefId) ?? '';
    items.push({
      id: `alert-emailed:${at}`,
      at,
      kind: 'alert-emailed',
      title: topic ? `Alert emailed for ${humanizeTopic(topic)}` : 'Alert emailed',
      ref: { kind: 'brief', id: briefId },
      clientId: strOrNull(al.clientId),
      fingerprint: null,
    });
  }

  const sorted = items
    .filter((i) => (before ? i.at < before : true))
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const page = sorted.slice(0, limit);
  const nextBefore = sorted.length > limit && page.length > 0 ? page[page.length - 1].at : null;
  return { items: page, nextBefore };
}

// ---------------------------------------------------------------------------
// Event derivation
// ---------------------------------------------------------------------------

function buildEvents(assessments: Assessment[], rules: Map<string, Rule>, briefs: BriefRow[], corrections: CorrectionRow[]): PolicyEvent[] {
  const byEvent = new Map<string, Assessment[]>();
  for (const a of assessments) {
    if (!a.policyEventId) continue;
    const list = byEvent.get(a.policyEventId) ?? [];
    list.push(a);
    byEvent.set(a.policyEventId, list);
  }

  const briefsByAssessment = new Map<string, BriefRow[]>();
  for (const b of briefs) {
    const list = briefsByAssessment.get(b.assessmentKey) ?? [];
    list.push(b);
    briefsByAssessment.set(b.assessmentKey, list);
  }
  const correctionsByAssessment = new Map<string, CorrectionRow[]>();
  for (const c of corrections) {
    const list = correctionsByAssessment.get(c.assessmentKey) ?? [];
    list.push(c);
    correctionsByAssessment.set(c.assessmentKey, list);
  }

  const events: PolicyEvent[] = [];
  for (const [eventId, list] of byEvent) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const first = list[0];
    const rule = rules.get(first.ruleHash) ?? null;
    const topic = rule?.topic ?? first.topic;
    const detectedAt = detectedAtFor(eventId, first.timestamp);

    let briefsSent = 0;
    let briefsUnsent = 0;
    let correctionsFiled = 0;
    let uncoveredAffected = 0;
    const activity: string[] = [];

    for (const a of list) {
      activity.push(a.timestamp);
      const eventBriefs = briefsByAssessment.get(a.assessmentKey) ?? [];
      let hasSent = false;
      for (const b of eventBriefs) {
        if (b.status === 'sent') {
          briefsSent += 1;
          hasSent = true;
        } else {
          briefsUnsent += 1;
        }
        for (const t of [b.createdAt, b.updatedAt, b.sentAt]) if (t) activity.push(t);
      }
      if (a.isAffected && !hasSent) uncoveredAffected += 1;
      for (const c of correctionsByAssessment.get(a.assessmentKey) ?? []) {
        correctionsFiled += 1;
        if (c.correctedAt) activity.push(c.correctedAt);
      }
    }

    const affectedCount = list.filter((a) => a.isAffected).length;
    const status: EventStatus = affectedCount === 0 ? 'no-impact' : uncoveredAffected > 0 ? 'action-required' : 'done';

    events.push({
      eventId,
      ref: refFor(eventId, rule?.policyDomain ?? null, detectedAt),
      origin: eventId.startsWith('recall-') ? 'recall' : 'sentinel',
      ruleHash: first.ruleHash,
      topic,
      title: humanizeTopic(topic),
      policyDomain: rule?.policyDomain ?? null,
      category: rule?.category ?? null,
      severity: rule?.severity ?? null,
      summary: rule?.summary ?? null,
      sourceUrl: rule?.sourceUrl ?? null,
      detectedAt,
      assessedCount: list.length,
      affectedCount,
      signedCount: list.filter((a) => a.canonicalHash !== null && a.signatureAlgorithm !== null).length,
      briefsSent,
      briefsUnsent,
      correctionsFiled,
      status,
      lastActivityAt: activity.reduce((max, t) => (t > max ? t : max), detectedAt),
    });
  }

  events.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.eventId.localeCompare(b.eventId));
  return events;
}

// Sentinel eventIds are `${Date.now()}-${ruleHash.slice(0, 8)}`. Anything else
// (Recall, test runs) falls back to the first assessment's timestamp.
const SENTINEL_EVENT_ID = /^(\d{13})-([0-9a-f]{8})$/;

function detectedAtFor(eventId: string, firstAssessmentAt: string): string {
  const m = SENTINEL_EVENT_ID.exec(eventId);
  if (m) {
    const d = new Date(Number(m[1]));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return firstAssessmentAt;
}

// `${domainCode}-${YYYYMMDD}-${4 hash chars}`. Sentinel events use the rule
// hash prefix embedded in the eventId. Other events hash the eventId itself,
// because Recall and test runs can share a rule on the same day.
function refFor(eventId: string, policyDomain: string | null, detectedAt: string): string {
  const code = domainCode(policyDomain);
  const date = detectedAt.slice(0, 10).replace(/-/g, '');
  const m = SENTINEL_EVENT_ID.exec(eventId);
  const hash4 = (m ? m[2] : createHash('sha256').update(eventId).digest('hex')).slice(0, 4).toUpperCase();
  return `${code}-${date}-${hash4}`;
}

function domainCode(policyDomain: string | null): string {
  if (!policyDomain) return 'GEN';
  const initials = policyDomain
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return initials || 'GEN';
}

function humanizeTopic(topic: string): string {
  if (!topic) return 'Untitled policy change';
  const words = topic.split(/[-_\s]+/).filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

function pickBriefPerAssessment(briefs: BriefRow[]): Map<string, BriefRow> {
  const out = new Map<string, BriefRow>();
  for (const b of briefs) {
    const current = out.get(b.assessmentKey);
    if (!current) {
      out.set(b.assessmentKey, b);
      continue;
    }
    const currentSent = current.status === 'sent';
    const nextSent = b.status === 'sent';
    if (nextSent && !currentSent) out.set(b.assessmentKey, b);
    else if (nextSent === currentSent && (b.createdAt ?? '') > (current.createdAt ?? '')) out.set(b.assessmentKey, b);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

async function loadAssessments(rcicId: string): Promise<Assessment[]> {
  const rows = await queryAll({
    TableName: IMPACT_ASSESSMENTS_TABLE,
    KeyConditionExpression: '#pk = :r',
    ...projection(ASSESSMENT_LIST_FIELDS, { '#pk': 'rcicId' }),
    ExpressionAttributeValues: { ':r': rcicId },
  });
  return rows.map(toAssessment);
}

async function loadAssessmentsForEvent(rcicId: string, eventId: string, fields: string[]): Promise<Row[]> {
  const rows = await queryAll({
    TableName: IMPACT_ASSESSMENTS_TABLE,
    KeyConditionExpression: '#pk = :r AND begins_with(#sk, :prefix)',
    ...projection(fields, { '#pk': 'rcicId', '#sk': 'assessmentKey' }),
    ExpressionAttributeValues: { ':r': rcicId, ':prefix': `${eventId}#` },
  });
  // assessmentKey is `${policyEventId}#${clientId}`. The equality check guards
  // against an eventId that is itself a prefix of another containing '#'.
  return rows.filter((r) => str(r.policyEventId) === eventId);
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

function toAssessment(r: Row): Assessment {
  return {
    assessmentKey: str(r.assessmentKey),
    policyEventId: str(r.policyEventId),
    ruleHash: str(r.ruleHash),
    clientId: str(r.clientId),
    topic: str(r.topic),
    isAffected: r.isAffected === true,
    timestamp: str(r.timestamp),
    canonicalHash: strOrNull(r.canonicalHash),
    signatureAlgorithm: strOrNull(r.signatureAlgorithm),
  };
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

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0 && Number.isFinite(Number(v))) return Number(v);
  return null;
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
