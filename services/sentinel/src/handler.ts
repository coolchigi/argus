import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';

const s3 = new S3Client({});
const eb = new EventBridgeClient({});
const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BUCKET = requiredEnv('POLICY_CORPUS_BUCKET');
const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const RULE_INDEX_TABLE = requiredEnv('RULE_INDEX_TABLE');
const CLASSIFIER_MODEL = requiredEnv('BEDROCK_CLASSIFIER_MODEL');
const SEED_URLS = JSON.parse(process.env.IRCC_SEED_URLS ?? '[]') as string[];
const FETCH_TIMEOUT_MS = 15_000;
const CLASSIFIER_MAX_INPUT_CHARS = 12_000;

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
};

type ScanResult =
  | { url: string; changed: false; hash: string }
  | { url: string; changed: true; delta: PolicyDelta }
  | { url: string; error: string };

export const handler = async (): Promise<{ scanned: number; changed: number; errored: number }> => {
  const runId = randomUUID();
  log('info', 'scan-start', { runId, urlCount: SEED_URLS.length });

  const results = await Promise.all(SEED_URLS.map((url) => scanOne(url, runId)));
  const changed = results.filter((r): r is Extract<ScanResult, { changed: true }> => 'changed' in r && r.changed === true).length;
  const errored = results.filter((r): r is Extract<ScanResult, { error: string }> => 'error' in r).length;

  log('info', 'scan-complete', { runId, scanned: results.length, changed, errored });
  return { scanned: results.length, changed, errored };
};

async function scanOne(url: string, runId: string): Promise<ScanResult> {
  try {
    const html = await fetchWithTimeout(url);
    const normalized = normalize(html);
    const newHash = sha256(normalized);
    const s3Key = keyForUrl(url);
    const previous = await readLatest(s3Key);
    const previousHash = previous ? sha256(normalize(previous)) : null;

    if (previousHash === newHash) {
      log('debug', 'unchanged', { runId, url, hash: newHash });
      return { url, changed: false, hash: newHash };
    }

    const versionId = await writeSnapshot(s3Key, html);

    const classification = await classifyWithBedrock(url, normalized, runId);
    const ruleHash = newHash;

    await writePolicyRule(ruleHash, classification, url, s3Key, versionId, normalized);
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
      contentLengthDelta: html.length - (previous?.length ?? 0),
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

async function classifyWithBedrock(url: string, normalizedHtml: string, runId: string): Promise<Classification> {
  const snippet = normalizedHtml.slice(0, CLASSIFIER_MAX_INPUT_CHARS);
  const userText = [
    'Classify this IRCC page change. Return valid JSON only, no prose.',
    '',
    `URL: ${url}`,
    'Content (may be truncated):',
    snippet,
    '',
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
    'Severity rules:',
    '- high: eligibility flip, program open or close, CRS scoring change affecting more than 30 points.',
    '- medium: category-based-draw change, procedural rule change.',
    '- low: news release, statistics, minor form-version bump.',
  ].join('\n');

  const res = await bedrock.send(
    new ConverseCommand({
      modelId: CLASSIFIER_MODEL,
      system: [
        {
          text: 'You classify Canadian IRCC (Immigration, Refugees and Citizenship Canada) policy pages. Return valid JSON only. No preamble, no explanation.',
        },
      ],
      messages: [{ role: 'user', content: [{ text: userText }] }],
      inferenceConfig: { maxTokens: 512, temperature: 0.1 },
    }),
  );

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

function normalize(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\sdata-[a-z-]+="[^"]*"/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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
