import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { build } from 'esbuild';

// Runs the real Composer handler with the AWS SDK clients swapped for fakes.
// Bundled with esbuild (the same tool CDK uses) with the SDK left external,
// so the clients here are the ones the handler uses. Nothing reaches AWS.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'composer-handler.mjs');

type Item = Record<string, unknown>;
const briefs: Item[] = [];
const trailRows: Item[] = [];
let trailFails = false;
let modelReply = '{"subject":"Your CRS score changed","bodyMarkdown":"body","suggestedActions":["Retake the test"]}';

type Handler = (event: unknown) => Promise<{ composed: number; skipped: number }>;
let handler: Handler;

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
    POLICY_RULES_TABLE: 'rules',
    BRIEFS_TABLE: 'briefs',
    BEDROCK_COMPOSER_MODEL: 'us.test-composer',
    AUDIT_TRAIL_TABLE: 'audit-trail',
    AWS_REGION: 'us-east-1',
  });

  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input as { TableName: string; Item: Item };
    if (cmd instanceof GetCommand) return { Item: { rule_hash: 'h1', rule_content: 'rule text', severity: 'high' } };
    if (cmd instanceof PutCommand && input.TableName === 'briefs') {
      briefs.push(input.Item);
      return {};
    }
    if (cmd instanceof PutCommand && input.TableName === 'audit-trail') {
      if (trailFails) throw new Error('ProvisionedThroughputExceededException');
      trailRows.push(input.Item);
      return {};
    }
    throw new Error(`unexpected command ${cmd.constructor.name}`);
  };
  (BedrockRuntimeClient.prototype as { send: unknown }).send = async () => ({
    stopReason: 'end_turn',
    output: { message: { role: 'assistant', content: [{ text: modelReply }] } },
  });
  (EventBridgeClient.prototype as { send: unknown }).send = async () => ({});

  handler = (await import(outfile)).handler as Handler;
});

beforeEach(() => {
  briefs.length = 0;
  trailRows.length = 0;
  trailFails = false;
  modelReply = '{"subject":"Your CRS score changed","bodyMarkdown":"body","suggestedActions":["Retake the test"]}';
});

function insert(overrides: Item = {}) {
  const assessment = {
    rcicId: 'R1',
    assessmentKey: 'pe1#c1',
    clientId: 'c1',
    policyEventId: 'pe1',
    ruleHash: 'h1',
    topic: 'ee-crs-grid',
    isAffected: true,
    impactType: 'crs-delta',
    numericDelta: -6,
    narrative: 'c1 loses 6 points',
    recommendedAction: 'Retake the test',
    confidence: 'medium',
    citationSourceUrl: 'https://www.canada.ca/x',
    timestamp: '2026-09-29T12:00:00.000Z',
    ...overrides,
  };
  return { eventID: '1', eventName: 'INSERT', dynamodb: { NewImage: marshall(assessment, { removeUndefinedValues: true }) } };
}

async function compose(records: unknown[]) {
  const origLog = console.log;
  console.log = () => {};
  try {
    return await handler({ Records: records });
  } finally {
    console.log = origLog;
  }
}

describe('Composer step telemetry', () => {
  it('records a drafted brief with the model from its env', async () => {
    const res = await compose([insert()]);
    assert.equal(res.composed, 1);
    assert.equal(trailRows.length, 1);
    const row = trailRows[0];
    assert.equal(row.assessmentId, 'R1#pe1#c1');
    assert.equal(row.agent, 'composer');
    assert.equal(row.modelId, 'us.test-composer');
    assert.equal(row.outcome, 'drafted');
    assert.equal(typeof row.durationMs, 'number');
  });

  it('records an unaffected client as needing no brief', async () => {
    await compose([insert({ isAffected: false, impactType: 'none', clientId: 'c2', assessmentKey: 'pe1#c2' })]);
    assert.equal(briefs.length, 0);
    assert.equal(trailRows[0].outcome, 'no-brief-needed');
  });

  it('still writes the brief when the telemetry write fails', async () => {
    trailFails = true;
    const res = await compose([insert()]);
    assert.equal(res.composed, 1);
    assert.equal(briefs.length, 1);
  });

  it('records a failed draft', async () => {
    modelReply = 'junk';
    const res = await compose([insert()]);
    assert.equal(res.composed, 0);
    assert.equal(briefs.length, 0);
    assert.equal(trailRows[0].outcome, 'failed');
  });
});
