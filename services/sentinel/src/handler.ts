import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';

const s3 = new S3Client({});
const eb = new EventBridgeClient({});
const BUCKET = requiredEnv('POLICY_CORPUS_BUCKET');
const SEED_URLS = JSON.parse(process.env.IRCC_SEED_URLS ?? '[]') as string[];
const FETCH_TIMEOUT_MS = 15_000;

type Category =
  | 'ministerial-instruction'
  | 'news-release'
  | 'rounds-of-invitations'
  | 'policy-page-change';

type PolicyDelta = {
  eventId: string;
  timestamp: string;
  policyDomain: string;
  sourceUrl: string;
  category: Category;
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
    const newHash = sha256(html);
    const s3Key = keyForUrl(url);
    const previous = await readLatest(s3Key);
    const previousHash = previous ? sha256(previous) : null;

    if (previousHash === newHash) {
      log('debug', 'unchanged', { runId, url, hash: newHash });
      return { url, changed: false, hash: newHash };
    }

    await writeSnapshot(s3Key, html);

    const delta: PolicyDelta = {
      eventId: `${Date.now()}-${newHash.slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      policyDomain: domainOf(url),
      sourceUrl: url,
      category: classify(url),
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

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function keyForUrl(url: string): string {
  const u = new URL(url);
  const slug = u.pathname.replace(/^\/|\/$/g, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'root';
  return `ircc-pages/${u.hostname}/${slug}.html`;
}

function domainOf(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('express-entry')) return 'express-entry';
  if (u.includes('post-graduation') || u.includes('pgwp')) return 'pgwp';
  if (u.includes('spousal') || u.includes('open-work-permit')) return 'sowp';
  if (u.includes('parents-grandparents') || u.includes('pgp')) return 'pgp';
  if (u.includes('provincial-nominee') || u.includes('pnp')) return 'pnp';
  if (u.includes('study-permit')) return 'study-permit';
  if (u.includes('news.html') || u.includes('/news/')) return 'general';
  return 'other';
}

function classify(url: string): Category {
  const u = url.toLowerCase();
  if (u.includes('ministerial-instructions')) return 'ministerial-instruction';
  if (u.includes('rounds-invitations') || u.includes('rounds-of-invitations')) return 'rounds-of-invitations';
  if (u.includes('/news/')) return 'news-release';
  return 'policy-page-change';
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

async function writeSnapshot(key: string, body: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'text/html; charset=utf-8',
    }),
  );
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
