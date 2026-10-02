import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';

// Runs the real Sentinel handler with fetch and the AWS SDK clients swapped
// for fakes. Bundled with esbuild (the same tool CDK uses) with the SDK left
// external, so the clients here are the ones the handler uses. Nothing reaches
// AWS or canada.ca.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'sentinel-handler.mjs');

type Item = Record<string, unknown>;
const trailRows: Item[] = [];
const deltas: Item[] = [];
const snapshotPuts: string[] = [];
const ruleRows: Item[] = [];
const bedrockOptions: unknown[] = [];
let trailFails = false;
let previousSnapshot: string | null = null;
let fetchImpl: (url: string) => Promise<Response>;

type Handler = (event: unknown) => Promise<{ scanned: number; changed: number; baselined: number; errored: number }>;
let handler: Handler;

const PAGE = '<html><body><main><h1>Rounds of invitations</h1><p>Draw 400 invited 3,000 candidates.</p></main></body></html>';
const OLD_PAGE = '<html><body><main><h1>Rounds of invitations</h1><p>Draw 399 invited 2,500 candidates.</p></main></body></html>';
const BUNDLED_LIST = ['https://www.canada.ca/en/a.html', 'https://www.canada.ca/en/b.html'];

before(async () => {
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [path.join(here, 'handler.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    outfile,
    logLevel: 'silent',
    // Same substitution CDK makes from infra/lib/ircc-watch-list.ts.
    define: { IRCC_WATCH_LIST: JSON.stringify(BUNDLED_LIST) },
  });
  Object.assign(process.env, {
    POLICY_CORPUS_BUCKET: 'corpus',
    POLICY_RULES_TABLE: 'rules',
    RULE_INDEX_TABLE: 'rule-index',
    BEDROCK_CLASSIFIER_MODEL: 'us.test-classifier',
    AUDIT_TRAIL_TABLE: 'audit-trail',
    AWS_REGION: 'us-east-1',
  });

  globalThis.fetch = (async (url: string) => fetchImpl(url)) as typeof fetch;
  (S3Client.prototype as { send: unknown }).send = async (cmd: unknown) => {
    if (cmd instanceof GetObjectCommand) {
      if (previousSnapshot === null) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      const body = previousSnapshot;
      return { Body: { transformToString: async () => body } };
    }
    if (cmd instanceof PutObjectCommand) snapshotPuts.push(String(cmd.input.Key));
    return { VersionId: 'v1' };
  };
  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input as { TableName: string; Item: Item };
    if (cmd instanceof PutCommand && input.TableName === 'audit-trail') {
      if (trailFails) throw new Error('ProvisionedThroughputExceededException');
      trailRows.push(input.Item);
    }
    if (cmd instanceof PutCommand && input.TableName === 'rules') ruleRows.push(input.Item);
    return {};
  };
  (BedrockRuntimeClient.prototype as { send: unknown }).send = async (_cmd: unknown, options?: unknown) => {
    bedrockOptions.push(options);
    return {
    stopReason: 'end_turn',
    output: {
      message: {
        role: 'assistant',
        content: [{ text: '{"category":"rounds-of-invitations","policyDomain":"express-entry","severity":"medium","summary":"s","topic":"ee-draws","ruleKind":"procedural"}' }],
      },
    },
    };
  };
  (EventBridgeClient.prototype as { send: unknown }).send = async (cmd: { input: { Entries: Array<{ Detail: string }> } }) => {
    deltas.push(JSON.parse(cmd.input.Entries[0].Detail) as Item);
    return {};
  };

  handler = (await import(outfile)).handler as Handler;
});

beforeEach(() => {
  trailRows.length = 0;
  deltas.length = 0;
  snapshotPuts.length = 0;
  ruleRows.length = 0;
  bedrockOptions.length = 0;
  trailFails = false;
  // Most tests start from a page Sentinel has seen before, in an older form.
  previousSnapshot = OLD_PAGE;
  fetchImpl = async () => new Response(PAGE, { status: 200 });
});

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const origLog = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = origLog;
  }
}

const scan = () => quiet(() => handler({ urls: ['https://www.canada.ca/en/x.html'], targetRcicIds: ['R1'] }));

describe('Sentinel first sight of a URL', () => {
  it('stores a baseline and emits nothing when there is no previous snapshot', async () => {
    previousSnapshot = null;
    const res = await scan();
    assert.deepEqual(res, { scanned: 1, changed: 0, baselined: 1, errored: 0 });
    assert.deepEqual(snapshotPuts, ['ircc-pages/www.canada.ca/en_x.html.html']);
    assert.equal(deltas.length, 0);
    assert.equal(bedrockOptions.length, 0);
    assert.equal(ruleRows.length, 0);
    assert.equal(trailRows.length, 0);
  });

  it('emits a delta once the page changes after the baseline', async () => {
    const res = await scan();
    assert.equal(res.changed, 1);
    assert.equal(deltas.length, 1);
    assert.equal(ruleRows.length, 1);
    // The classifier call carries a deadline so a hung call frees its slot.
    assert.ok((bedrockOptions[0] as { abortSignal?: unknown }).abortSignal instanceof AbortSignal);
  });
});

describe('Sentinel scan pool', () => {
  it('fetches at most 5 pages at once and one bad URL does not stop the rest', async () => {
    let inFlight = 0;
    let peak = 0;
    const urls = Array.from({ length: 12 }, (_, i) => `https://www.canada.ca/en/p${i}.html`);
    fetchImpl = async (url) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (url.endsWith('/p3.html')) return new Response('gone', { status: 503 });
      if (url.endsWith('/p7.html')) throw new TypeError('fetch failed');
      return new Response(PAGE, { status: 200 });
    };
    const res = await quiet(() => handler({ urls }));
    assert.equal(peak, 5);
    assert.deepEqual(res, { scanned: 12, changed: 10, baselined: 0, errored: 2 });
    assert.equal(deltas.length, 10);
  });

  it('scans the bundled watch list on the hourly schedule', async () => {
    const fetched: string[] = [];
    fetchImpl = async (url) => {
      fetched.push(url);
      return new Response(PAGE, { status: 200 });
    };
    const res = await quiet(() => handler({ 'detail-type': 'Scheduled Event', source: 'aws.events', detail: {} }));
    assert.equal(res.scanned, BUNDLED_LIST.length);
    assert.deepEqual(fetched.sort(), [...BUNDLED_LIST].sort());
  });
});

describe('Sentinel step telemetry', () => {
  it('records one event step per detected change, with no tenant data', async () => {
    const res = await scan();
    assert.equal(res.changed, 1);
    assert.equal(trailRows.length, 1);
    const row = trailRows[0];
    assert.equal(row.assessmentId, `event#${String(deltas[0].eventId)}`);
    assert.equal(row.agent, 'sentinel');
    assert.equal(row.modelId, 'us.test-classifier');
    assert.equal(row.outcome, 'detected');
    assert.equal(typeof row.durationMs, 'number');
    // targetRcicIds rode on the delta, and none of it reaches the step row.
    assert.doesNotMatch(JSON.stringify(row), /R1/);
  });

  it('records nothing when the page is unchanged', async () => {
    previousSnapshot = PAGE;
    const res = await scan();
    assert.equal(res.changed, 0);
    assert.equal(trailRows.length, 0);
  });

  it('still emits the change when the telemetry write fails', async () => {
    trailFails = true;
    const res = await scan();
    assert.equal(res.changed, 1);
    assert.equal(res.errored, 0);
    assert.equal(deltas.length, 1);
  });
});
