import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { extractMainText } from './extract';
import { describeGuardrailBlock, guarded } from './guardrail';

const s3 = new S3Client({});
const eb = new EventBridgeClient({});
const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET = requiredEnv('POLICY_CORPUS_BUCKET');
const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const RULE_INDEX_TABLE = requiredEnv('RULE_INDEX_TABLE');
const CLASSIFIER_MODEL = requiredEnv('BEDROCK_CLASSIFIER_MODEL');
const GUARDRAIL_ID = process.env.BEDROCK_GUARDRAIL_ID;
const GUARDRAIL_VERSION = process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT';
const SEED_URLS = JSON.parse(process.env.IRCC_SEED_URLS ?? '[]') as string[];
const FETCH_TIMEOUT_MS = 15_000;
const CLASSIFIER_MAX_INPUT_CHARS = 12_000;

function guardrailConfig() {
  if (!GUARDRAIL_ID) return undefined;
  return {
    guardrailIdentifier: GUARDRAIL_ID,
    guardrailVersion: GUARDRAIL_VERSION,
    trace: 'enabled' as const,
  };
}

type Category = 'ministerial-instruction' | 'news-release' | 'rounds-of-invitations' | 'policy-page-change';
type Severity = 'low' | 'medium' | 'high';
type RuleKind = 'scoring' | 'interpretation' | 'procedural';

type Classification = {
  category: Category;
  policyDomain: string;
  severity: Severity;
  summary: string;
  topic: string;
  ruleKind: RuleKind;
};

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
  | { url: string; changed: true; delta: PolicyDelta }
  | { url: string; error: string };

// Manual invocations may pass `{ urls?, targetRcicIds? }`. The hourly
// EventBridge schedule sends a Scheduled Event with neither, so it scans
// IRCC_SEED_URLS.
type ScanRequest = { urls: string[]; targetRcicIds?: string[]; mode: 'seed' | 'requested' };

export const handler = async (event?: unknown): Promise<{ scanned: number; changed: number; errored: number }> => {
  const runId = randomUUID();
  const request = parseRequest(event);
  log('info', 'scan-start', {
    runId,
    mode: request.mode,
    urlCount: request.urls.length,
    targetRcicCount: request.targetRcicIds?.length ?? null,
  });

  const results = await Promise.all(request.urls.map((url) => scanOne(url, runId, request.targetRcicIds)));
  const changed = results.filter((r): r is Extract<ScanResult, { changed: true }> => 'changed' in r && r.changed === true).length;
  const errored = results.filter((r): r is Extract<ScanResult, { error: string }> => 'error' in r).length;

  log('info', 'scan-complete', { runId, scanned: results.length, changed, errored });
  return { scanned: results.length, changed, errored };
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
    const previousText = previous === null ? null : extractMainText(previous);
    const previousHash = previousText === null ? null : sha256(previousText);

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
      contentLengthDelta: text.length - (previousText?.length ?? 0),
      ...(targetRcicIds ? { targetRcicIds } : {}),
    };
    await emitDelta(delta);

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

export function buildClassifierRequest(url: string, pageText: string): ConverseCommandInput {
  const snippet = pageText.slice(0, CLASSIFIER_MAX_INPUT_CHARS);
  const intro = [
    'Classify this IRCC page change. Return valid JSON only, no prose.',
    '',
    `URL: ${url}`,
    'Content (may be truncated):',
  ].join('\n');
  const instructions = [
    'Return this exact JSON shape:',
    '{',
    '  "category": "ministerial-instruction" | "news-release" | "rounds-of-invitations" | "policy-page-change",',
    '  "policyDomain": "express-entry" | "pgwp" | "sowp" | "pgp" | "pnp" | "study-permit" | "general" | "other",',
    '  "severity": "low" | "medium" | "high",',
    '  "summary": "one sentence describing what changed or what this page is",',
    '  "topic": "short kebab-case topic id, e.g. crs-scorecard or ee-category-list",',
    '  "ruleKind": "scoring" | "interpretation" | "procedural"',
    '}',
    '',
    'policyDomain definitions. Pick the program whose applicants the page\'s rules are about. A program the page only mentions in passing does not decide the domain.',
    '- express-entry: Express Entry profiles, the Comprehensive Ranking System (CRS), rounds of invitations, and the federal skilled worker, federal skilled trades and Canadian experience classes.',
    '- pgwp: post-graduation work permits for international students who graduated from a Canadian school.',
    '- sowp: open work permits for the spouse, common-law partner or dependent children of a worker, student or permanent residence applicant.',
    '- pgp: sponsoring parents and grandparents for permanent residence, including interest to sponsor forms and invitations to apply.',
    '- pnp: the Provincial Nominee Program and provincial nominations.',
    '- study-permit: study permits, including acceptance letters and provincial or territorial attestation letters.',
    '- general: a change that applies across several of the programs above.',
    '- other: none of the above.',
    '',
    'Severity rules:',
    '- high: eligibility flip, program open or close, CRS scoring change affecting more than 30 points.',
    '- medium: category-based-draw change, procedural rule change.',
    '- low: news release, statistics, minor form-version bump.',
  ].join('\n');

  // The IRCC page text is the only outside content, so it's the only
  // guarded block. See guardrail.ts for the tagging rule.
  return {
    modelId: CLASSIFIER_MODEL,
    system: [
      {
        text: 'You classify Canadian IRCC (Immigration, Refugees and Citizenship Canada) policy pages. Return valid JSON only. No preamble, no explanation.',
      },
    ],
    messages: [{ role: 'user', content: [{ text: intro + '\n' }, guarded(snippet + '\n\n'), { text: instructions }] }],
    inferenceConfig: { maxTokens: 512, temperature: 0.1 },
    guardrailConfig: guardrailConfig(),
  };
}

async function classifyWithBedrock(url: string, pageText: string, runId: string): Promise<Classification> {
  const res = await bedrock.send(new ConverseCommand(buildClassifierRequest(url, pageText)));

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
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`classifier returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(match[0]) as Partial<Classification>;
  return {
    category: (parsed.category ?? 'policy-page-change') as Category,
    policyDomain: parsed.policyDomain ?? 'other',
    severity: (parsed.severity ?? 'low') as Severity,
    summary: parsed.summary ?? '(no summary)',
    topic: parsed.topic ?? 'unknown',
    ruleKind: (parsed.ruleKind ?? 'procedural') as RuleKind,
  };
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
