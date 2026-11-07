import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
const ruleUpdates: Item[] = [];
let ruleRowExists = false;
const bedrockOptions: unknown[] = [];
const classifierPrompts: string[] = [];
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
    if (cmd instanceof PutCommand && input.TableName === 'rules') {
      if (ruleRowExists) throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
      ruleRows.push(input.Item);
    }
    if (cmd instanceof UpdateCommand && input.TableName === 'rules') ruleUpdates.push(cmd.input as Item);
    return {};
  };
  (BedrockRuntimeClient.prototype as { send: unknown }).send = async (cmd: { input: unknown }, options?: unknown) => {
    bedrockOptions.push(options);
    classifierPrompts.push(JSON.stringify(cmd.input));
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
  ruleUpdates.length = 0;
  classifierPrompts.length = 0;
  ruleRowExists = false;
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

describe('Sentinel stores what changed on the page', () => {
  // Real wording from IRCC's job offer page before and after Oct 16 2026. The
  // academic bullet did not change, so it must not read as part of the change.
  const before16 = '<main><h2>Job offer basics</h2><p>We no longer give points for job offers</p><p>If having a valid job offer is part of your eligibility criteria, this won’t change.</p><h2>Who needs an LMIA</h2><ul><li>academics (researchers, lecturers, and professors) under a recognized federal program</li></ul></main>';
  const after16 = "<main><h2>Job offer basics</h2><p>As of November 3, 2026, we're changing how we assess job offers under Express Entry:</p><ul><li>you don't need a Labour Market Impact Assessment (LMIA) for a job offer to qualify</li></ul><p>If having a valid job offer is part of your eligibility criteria, this won't change.</p><h2>Who needs an LMIA</h2><ul><li>academics (researchers, lecturers, and professors) under a recognized federal program</li></ul></main>";

  async function scan(): Promise<void> {
    previousSnapshot = before16;
    fetchImpl = async () => new Response(after16, { status: 200 });
    const origLog = console.log;
    console.log = () => {};
    try {
      await handler({ urls: ['https://www.canada.ca/en/job-offer.html'] });
    } finally {
      console.log = origLog;
    }
  }

  it('puts the changed lines on the rule row and leaves out text IRCC did not touch', async () => {
    await scan();
    const changes = ruleRows[0].rule_changes as { text: string; previous_hash: string };
    assert.ok(changes, 'the rule row carries rule_changes');
    assert.match(changes.text, /you don't need a Labour Market Impact Assessment/);
    assert.match(changes.text, /We no longer give points for job offers/);
    assert.doesNotMatch(changes.text, /recognized federal program/);
    assert.doesNotMatch(changes.text, /this won.t change/, 'a curly apostrophe swapped for a straight one is not a change');
    assert.equal(changes.previous_hash, deltas[0].previousHash);
  });

  it('gives the classifier the changed lines, so older text cannot reach the summary the Analyst reads', async () => {
    await scan();
    assert.equal(classifierPrompts.length, 1);
    assert.match(classifierPrompts[0], /you don't need a Labour Market Impact Assessment/);
    assert.doesNotMatch(classifierPrompts[0], /recognized federal program/);
    assert.match(classifierPrompts[0], /We no longer give points/, 'a change of a number only reads as one with both sides');
  });

  it('keeps rule_content and rule_hash flat, so the stored version chain still holds', async () => {
    previousSnapshot = '<main><ul><li>Proof of funds<ul><li>bank letter</li></ul></li></ul></main>';
    fetchImpl = async () => new Response('<main><ul><li>Proof of funds<ul><li>bank letter</li><li>under 6 months old</li></ul></li></ul></main>', { status: 200 });
    const origLog = console.log;
    console.log = () => {};
    try {
      await handler({ urls: ['https://www.canada.ca/en/docs.html'] });
    } finally {
      console.log = origLog;
    }
    const row = ruleRows[0] as { rule_hash: string; rule_content: string; rule_changes: { text: string } };
    assert.match(row.rule_content, /^- under 6 months old$/m);
    assert.equal(row.rule_hash, createHash('sha256').update(row.rule_content).digest('hex'));
    assert.match(row.rule_changes.text, /\(unchanged parent\) - Proof of funds\n {2}- under 6 months old/);
  });

  it('runs no agent when only quote style or spacing changed, and still archives the page', async () => {
    previousSnapshot = '<main><p>This won’t change</p></main>';
    fetchImpl = async () => new Response("<main><p>This won't  change</p></main>", { status: 200 });
    const origLog = console.log;
    console.log = () => {};
    let summary;
    try {
      summary = await handler({ urls: ['https://www.canada.ca/en/quotes.html'] });
    } finally {
      console.log = origLog;
    }
    assert.equal(summary.changed, 0);
    assert.equal(deltas.length, 0);
    assert.equal(ruleRows.length, 0);
    assert.equal(classifierPrompts.length, 0);
    assert.equal(snapshotPuts.length, 1);
  });

  it('records the latest change on the existing row when a page returns to an earlier version', async () => {
    ruleRowExists = true;
    await scan();
    assert.equal(ruleRows.length, 0);
    assert.equal(ruleUpdates.length, 1);
    const values = ruleUpdates[0].ExpressionAttributeValues as Record<string, { text: string }>;
    assert.match(values[':changes'].text, /you don't need a Labour Market Impact Assessment/);
  });
});
