import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { buildClassifierRequest, parseClassification, type Category, type Classification, type RuleKind, type Severity } from './classify';
import { extractMainText } from './extract';
import { describeGuardrailBlock } from './guardrail';
import { mapWithConcurrency } from './pool';
import { elapsedMs, recordStep } from './telemetry';

// The watch list from infra/lib/ircc-watch-list.ts. CDK substitutes it at
// bundle time (esbuild `define`) because it outgrows Lambda's 4 KB
// environment limit.
declare const IRCC_WATCH_LIST: readonly string[] | undefined;

const s3 = new S3Client({});
const eb = new EventBridgeClient({});
const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET = requiredEnv('POLICY_CORPUS_BUCKET');
const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const RULE_INDEX_TABLE = requiredEnv('RULE_INDEX_TABLE');
const CLASSIFIER_MODEL = requiredEnv('BEDROCK_CLASSIFIER_MODEL');
// Optional on purpose: a missing telemetry table must never stop a scan.
const AUDIT_TRAIL_TABLE = process.env.AUDIT_TRAIL_TABLE;
const GUARDRAIL_ID = process.env.BEDROCK_GUARDRAIL_ID;
const GUARDRAIL_VERSION = process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT';
const SEED_URLS: readonly string[] = typeof IRCC_WATCH_LIST === 'undefined' ? [] : IRCC_WATCH_LIST;
const FETCH_TIMEOUT_MS = 15_000;
// Caps the whole classifier call, retries included, so a stuck Bedrock call
// can't hold a pool slot until the Lambda times out.
const CLASSIFY_TIMEOUT_MS = 30_000;
// Pages fetched at once. Keeps canada.ca and Nova Micro from seeing a burst
// of the whole list. The Lambda timeout in infra/lib/argus-api-stack.ts is
// sized from this, FETCH_TIMEOUT_MS and CLASSIFY_TIMEOUT_MS.
const SCAN_CONCURRENCY = 5;

function guardrailConfig() {
  if (!GUARDRAIL_ID) return undefined;
  return {
    guardrailIdentifier: GUARDRAIL_ID,
    guardrailVersion: GUARDRAIL_VERSION,
    trace: 'enabled' as const,
  };
}

type PolicyDelta = {
  eventId: string;
  timestamp: string;
  policyDomain: string;
  sourceUrl: string;
  category: Category;
  severity: Severity;
  summary: string;
  topic: string;
  ruleKind: RuleKind;
  ruleHash: string;
  previousHash: string | null;
  newHash: string;
  s3Key: string;
  contentLengthDelta: number;
  targetRcicIds?: string[];
};

type ScanResult =
  | { url: string; changed: false; hash: string }
  | { url: string; changed: false; baseline: true; hash: string }
  | { url: string; changed: true; delta: PolicyDelta }
  | { url: string; error: string };

// Manual invocations may pass `{ urls?, targetRcicIds? }`. The hourly
// EventBridge schedule sends a Scheduled Event with neither, so it scans
// the watch list.
type ScanRequest = { urls: readonly string[]; targetRcicIds?: string[]; mode: 'seed' | 'requested' };

type ScanSummary = { scanned: number; changed: number; baselined: number; errored: number };

export const handler = async (event?: unknown): Promise<ScanSummary> => {
  const runId = randomUUID();
  const request = parseRequest(event);
  log('info', 'scan-start', {
    runId,
    mode: request.mode,
    urlCount: request.urls.length,
    targetRcicCount: request.targetRcicIds?.length ?? null,
  });

  if (request.urls.length === 0) {
    throw new Error('watch list is empty: IRCC_WATCH_LIST was not bundled into Sentinel');
  }

  // scanOne catches its own errors. The pool isolates anything that slips
  // past it, so one bad URL never ends the run.
  const settled = await mapWithConcurrency(request.urls, SCAN_CONCURRENCY, (url) => scanOne(url, runId, request.targetRcicIds));
  const results: ScanResult[] = settled.map((s, i) =>
    s.status === 'fulfilled' ? s.value : { url: request.urls[i], error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
  );
  const changed = results.filter((r) => 'changed' in r && r.changed).length;
  const baselined = results.filter((r) => 'baseline' in r).length;
  const errored = results.filter((r) => 'error' in r).length;

  log('info', 'scan-complete', { runId, scanned: results.length, changed, baselined, errored });
  return { scanned: results.length, changed, baselined, errored };
};

function parseRequest(event: unknown): ScanRequest {
  const payload = (typeof event === 'object' && event !== null ? event : {}) as Record<string, unknown>;

  let targetRcicIds: string[] | undefined;
  if (payload.targetRcicIds !== undefined) {
    if (!Array.isArray(payload.targetRcicIds) || !payload.targetRcicIds.every((id) => typeof id === 'string' && id.length > 0)) {
      throw new Error('targetRcicIds must be an array of non-empty strings');
    }
    targetRcicIds = payload.targetRcicIds as string[];
  }

  if (payload.urls === undefined) {
    return { urls: SEED_URLS, targetRcicIds, mode: 'seed' };
  }
  if (!Array.isArray(payload.urls) || payload.urls.length === 0) {
    throw new Error('urls must be a non-empty array of https://www.canada.ca/ URLs');
  }
  const rejected = payload.urls.filter((u) => !isCanadaCaUrl(u));
  if (rejected.length > 0) {
    throw new Error(`urls must be https://www.canada.ca/ URLs, rejected: ${JSON.stringify(rejected)}`);
  }
  return { urls: [...new Set(payload.urls as string[])], targetRcicIds, mode: 'requested' };
}

function isCanadaCaUrl(u: unknown): boolean {
  if (typeof u !== 'string') return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && parsed.hostname === 'www.canada.ca' && parsed.port === '' && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}

async function scanOne(url: string, runId: string, targetRcicIds?: string[]): Promise<ScanResult> {
  const startedAt = performance.now();
  try {
    const html = await fetchWithTimeout(url);
    // Change detection, the rule hash and rule_content all use the extracted
    // main text. The previous snapshot in S3 is raw HTML, so we run the same
    // extractor over it to compare like with like.
    const text = extractMainText(html);
    if (text.length === 0) {
      throw new Error('extracted main text is empty');
    }
    const newHash = sha256(text);
    const s3Key = keyForUrl(url);
    const previous = await readLatest(s3Key);

    // First sight of a URL: there is nothing to compare against, so a
    // difference can't be known. Store the page as the baseline and emit
    // nothing. Without this, every URL added to the watch list would fire a
    // PolicyDelta on its first run and fan out to every tenant's caseload.
    if (previous === null) {
      await writeSnapshot(s3Key, html);
      log('info', 'baseline-stored', { runId, url, hash: newHash, s3Key });
      return { url, changed: false, baseline: true, hash: newHash };
    }

    const previousText = extractMainText(previous);
    const previousHash = sha256(previousText);

    if (previousHash === newHash) {
      log('debug', 'unchanged', { runId, url, hash: newHash });
      return { url, changed: false, hash: newHash };
    }

    const classification = await classifyWithBedrock(url, text, runId);
    const ruleHash = newHash;

    // Snapshot only after classification succeeds. If Bedrock fails or the
    // guardrail blocks, S3 still holds the old snapshot and the next run
    // sees the change again.
    const versionId = await writeSnapshot(s3Key, html);

    await writePolicyRule(ruleHash, classification, url, s3Key, versionId, text);
    await writeRuleIndex(classification.topic, ruleHash);

    const delta: PolicyDelta = {
      eventId: `${Date.now()}-${newHash.slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      policyDomain: classification.policyDomain,
      sourceUrl: url,
      category: classification.category,
      severity: classification.severity,
      summary: classification.summary,
      topic: classification.topic,
      ruleKind: classification.ruleKind,
      ruleHash,
      previousHash,
      newHash,
      s3Key,
      contentLengthDelta: text.length - previousText.length,
      ...(targetRcicIds ? { targetRcicIds } : {}),
    };
    await emitDelta(delta);
    // One step per detected change, keyed by the event alone. It carries no
    // tenant or client data. Never throws.
    await recordStep(
      ddb,
      AUDIT_TRAIL_TABLE,
      { kind: 'event', policyEventId: delta.eventId },
      { agent: 'sentinel', modelId: CLASSIFIER_MODEL, durationMs: elapsedMs(startedAt), outcome: 'detected' },
      log,
    );

    log('info', 'delta-emitted', {
      runId,
      url,
      category: delta.category,
      policyDomain: delta.policyDomain,
      topic: delta.topic,
      severity: delta.severity,
      ruleKind: delta.ruleKind,
      ruleHash,
      previousHash,
      newHash,
      contentLengthDelta: delta.contentLengthDelta,
      targetRcicCount: targetRcicIds?.length ?? null,
    });
    return { url, changed: true, delta };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'scan-failed', { runId, url, error: message });
    return { url, error: message };
  }
}

async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Argus/0.1 (sentinel; +https://github.com/coolchigi/argus)' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function classifyWithBedrock(url: string, pageText: string, runId: string): Promise<Classification> {
  const res = await bedrock.send(
    new ConverseCommand(buildClassifierRequest({ modelId: CLASSIFIER_MODEL, url, pageText, guardrailConfig: guardrailConfig() })),
    { abortSignal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS) },
  );

  if (res.stopReason === 'guardrail_intervened') {
    const block = describeGuardrailBlock(res);
    log('error', 'guardrail-blocked', {
      runId,
      agent: 'sentinel',
      url,
      stage: block.stage,
      policies: block.policies,
      guardedInputs: ['ircc-page-text'],
    });
    throw new Error(`guardrail-blocked at ${block.stage}: ${block.policies.join(', ') || 'unknown policy'}`);
  }
  const raw = res.output?.message?.content?.[0]?.text ?? '';
  const { classification, coerced } = parseClassification(raw);
  if (coerced.length > 0) {
    // A value outside the taxonomy is a classifier miss worth seeing. Log
    // the model's label, capped, or just its type when it isn't a string.
    log('error', 'classifier-value-coerced', {
      runId,
      url,
      coerced: coerced.map((c) => ({
        field: c.field,
        received: typeof c.received === 'string' ? c.received.slice(0, 80) : c.received === undefined ? null : typeof c.received,
        used: c.used,
      })),
    });
  }
  return classification;
}

async function writePolicyRule(
  ruleHash: string,
  cls: Classification,
  sourceUrl: string,
  sourceS3Key: string,
  sourceS3VersionId: string | null,
  ruleContent: string,
): Promise<void> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: POLICY_RULES_TABLE,
        Item: {
          rule_hash: ruleHash,
          rule_kind: cls.ruleKind,
          policy_domain: cls.policyDomain,
          topic: cls.topic,
          category: cls.category,
          severity: cls.severity,
          summary: cls.summary,
          rule_content: ruleContent,
          source_url: sourceUrl,
          source_s3_key: sourceS3Key,
          source_s3_version_id: sourceS3VersionId,
          captured_at: new Date().toISOString(),
        },
        ConditionExpression: 'attribute_not_exists(rule_hash)',
      }),
    );
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return;
    }
    throw err;
  }
}

async function writeRuleIndex(topic: string, ruleHash: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: RULE_INDEX_TABLE,
      Item: {
        topic,
        effective_from: new Date().toISOString(),
        rule_hash: ruleHash,
      },
    }),
  );
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function keyForUrl(url: string): string {
  const u = new URL(url);
  const slug = u.pathname.replace(/^\/|\/$/g, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'root';
  return `ircc-pages/${u.hostname}/${slug}.html`;
}

async function readLatest(key: string): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return (await res.Body?.transformToString()) ?? null;
  } catch (err) {
    if (isNoSuchKey(err)) return null;
    throw err;
  }
}

function isNoSuchKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'NoSuchKey'
  );
}

async function writeSnapshot(key: string, body: string): Promise<string | null> {
  const res = await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'text/html; charset=utf-8',
    }),
  );
  return res.VersionId ?? null;
}

async function emitDelta(delta: PolicyDelta): Promise<void> {
  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'argus.sentinel',
          DetailType: 'PolicyDelta',
          Detail: JSON.stringify(delta),
        },
      ],
    }),
  );
}

function log(level: 'debug' | 'info' | 'error', msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
