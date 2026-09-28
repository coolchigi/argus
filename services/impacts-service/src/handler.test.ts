import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';

// Runs the real impacts handler against in-memory tables. The handler is
// bundled with esbuild (the same tool CDK uses) with the AWS SDK left
// external, so the SDK client here is the one the handler uses and its
// send() can be swapped for a fake. Nothing reaches AWS.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'impacts-handler.mjs');

type Item = Record<string, unknown>;
const puts: Array<{ TableName: string; Item: Item }> = [];

type Handler = (event: unknown) => Promise<{ statusCode: number; body: string }>;
let handler: Handler;

// An ImpactAssessment row as Anchor writes it. Anchor records the topic and
// the rule hash, and no policyDomain.
const assessment: Item = {
  rcicId: 'R1',
  assessmentKey: 'pe1#c1',
  clientId: 'c1',
  policyEventId: 'pe1',
  ruleHash: 'h1',
  topic: 'ee-category-draws',
  isAffected: true,
  impactType: 'procedural',
  numericDelta: null,
  narrative: 'c1 should watch the next draw',
  recommendedAction: 'Monitor the next draw',
  confidence: 'high',
};

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
    IMPACT_ASSESSMENTS_TABLE: 'assessments',
    TRAINING_CORRECTIONS_TABLE: 'argus-training-corrections',
    POLICY_RULES_TABLE: 'rules',
    SIGNING_KEY_ID: 'key',
    AWS_REGION: 'us-east-1',
  });

  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input as { TableName: string; Key?: Item; Item?: Item };
    if (cmd instanceof GetCommand && input.TableName === 'assessments') {
      const k = input.Key ?? {};
      return { Item: k.rcicId === assessment.rcicId && k.assessmentKey === assessment.assessmentKey ? assessment : undefined };
    }
    if (cmd instanceof GetCommand && input.TableName === 'rules') {
      return { Item: input.Key?.rule_hash === 'h1' ? { policy_domain: 'express-entry' } : undefined };
    }
    if (cmd instanceof PutCommand) {
      puts.push({ TableName: input.TableName, Item: input.Item ?? {} });
      return {};
    }
    throw new Error(`unexpected command ${cmd.constructor.name} on ${input.TableName}`);
  };

  handler = (await import(outfile)).handler as Handler;
});

beforeEach(() => {
  puts.length = 0;
});

async function postCorrection(body: Item) {
  const origLog = console.log;
  console.log = () => {};
  try {
    return await handler({
      routeKey: 'POST /impacts/{id}/correction',
      rawPath: '/impacts/pe1%23c1/correction',
      pathParameters: { id: 'pe1%23c1' },
      body: JSON.stringify(body),
      requestContext: { http: { method: 'POST' }, authorizer: { jwt: { claims: { 'custom:rcic_id': 'R1' } } } },
    });
  } finally {
    console.log = origLog;
  }
}

describe('POST /impacts/{id}/correction', () => {
  it('writes a row the Auditor can rank by domain and learn every corrected field from', async () => {
    const res = await postCorrection({
      correctorReasoning: 'The category round changes whether c1 can be invited at all',
      correctedImpactType: 'eligibility-flip',
      correctedNumericDelta: null,
      correctedNarrative: 'c1 is now outside the category',
      correctedRecommendedAction: 'Book a language retest',
      correctedConfidence: 'medium',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(puts.length, 1);
    const { TableName, Item } = puts[0];
    assert.equal(TableName, 'argus-training-corrections');
    // Key schema of the table (rcicId, correctionKey) and the Auditor's partition key.
    assert.equal(Item.rcicId, 'R1');
    assert.match(String(Item.correctionKey), /^pe1#c1#\d{4}-/);
    // The Auditor's second ranking tier. Anchor doesn't store it, the rule does.
    assert.equal(Item.policyDomain, 'express-entry');
    assert.equal(Item.topic, 'ee-category-draws');
    assert.equal(Item.originalRecommendedAction, 'Monitor the next draw');
    assert.equal(Item.originalConfidence, 'high');
    assert.equal(Item.correctedRecommendedAction, 'Book a language retest');
    assert.equal(Item.correctedConfidence, 'medium');
    // Every field the Auditor's Correction type reads (services/auditor/src/handler.ts).
    for (const f of [
      'correctedAt', 'policyDomain', 'topic', 'originalImpactType', 'originalNumericDelta', 'originalNarrative',
      'originalRecommendedAction', 'originalConfidence', 'correctedImpactType', 'correctedNumericDelta',
      'correctedNarrative', 'correctedRecommendedAction', 'correctedConfidence', 'correctorReasoning',
    ]) {
      assert.ok(f in Item, `row has ${f}`);
    }
  });
});
