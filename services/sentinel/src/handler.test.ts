import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
let trailFails = false;
let previousSnapshot: string | null = null;

type Handler = (event: unknown) => Promise<{ scanned: number; changed: number; errored: number }>;
let handler: Handler;

const PAGE = '<html><body><main><h1>Rounds of invitations</h1><p>Draw 400 invited 3,000 candidates.</p></main></body></html>';

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
  });
  Object.assign(process.env, {
    POLICY_CORPUS_BUCKET: 'corpus',
    POLICY_RULES_TABLE: 'rules',
    RULE_INDEX_TABLE: 'rule-index',
    BEDROCK_CLASSIFIER_MODEL: 'us.test-classifier',
    AUDIT_TRAIL_TABLE: 'audit-trail',
    AWS_REGION: 'us-east-1',
  });

  globalThis.fetch = (async () => new Response(PAGE, { status: 200 })) as typeof fetch;
  (S3Client.prototype as { send: unknown }).send = async (cmd: unknown) => {
    if (cmd instanceof GetObjectCommand) {
      if (previousSnapshot === null) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      const body = previousSnapshot;
      return { Body: { transformToString: async () => body } };
    }
    return { VersionId: 'v1' };
  };
  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input as { TableName: string; Item: Item };
    if (cmd instanceof PutCommand && input.TableName === 'audit-trail') {
      if (trailFails) throw new Error('ProvisionedThroughputExceededException');
      trailRows.push(input.Item);
    }
    return {};
  };
  (BedrockRuntimeClient.prototype as { send: unknown }).send = async () => ({
    stopReason: 'end_turn',
    output: {
      message: {
        role: 'assistant',
        content: [{ text: '{"category":"rounds-of-invitations","policyDomain":"express-entry","severity":"medium","summary":"s","topic":"ee-draws","ruleKind":"procedural"}' }],
      },
    },
  });
  (EventBridgeClient.prototype as { send: unknown }).send = async (cmd: { input: { Entries: Array<{ Detail: string }> } }) => {
    deltas.push(JSON.parse(cmd.input.Entries[0].Detail) as Item);
    return {};
  };

  handler = (await import(outfile)).handler as Handler;
});

beforeEach(() => {
  trailRows.length = 0;
  deltas.length = 0;
  trailFails = false;
  previousSnapshot = null;
});

async function scan() {
  const origLog = console.log;
  console.log = () => {};
  try {
    return await handler({ urls: ['https://www.canada.ca/en/x.html'], targetRcicIds: ['R1'] });
  } finally {
    console.log = origLog;
  }
}

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
