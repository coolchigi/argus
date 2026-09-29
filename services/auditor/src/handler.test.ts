import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient, type ConverseCommand, type ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { EventBridgeClient, type PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';

// Runs the real Auditor handler against an in-memory TrainingCorrections
// table. The handler is bundled with esbuild (the same tool CDK uses) with
// the AWS SDK left external, so the SDK clients here are the ones the
// handler uses and their send() can be swapped for fakes. Nothing reaches AWS.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'auditor-handler.mjs');

type Item = Record<string, unknown>;
const corrections: Item[] = [];
const queries: Item[] = [];
let lastRequest: ConverseCommandInput | undefined;
const trailRows: Item[] = [];
const verdicts: Item[] = [];
let trailFails = false;
let modelReply = '{"passed":true,"issues":[]}';

type Handler = (event: unknown) => Promise<{ passed: boolean }>;
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
    TRAINING_CORRECTIONS_TABLE: 'argus-training-corrections',
    BEDROCK_AUDITOR_MODEL: 'us.test-model',
    AUDIT_TRAIL_TABLE: 'audit-trail',
    AWS_REGION: 'us-east-1',
  });

  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input;
    if (cmd instanceof GetCommand) return { Item: { rule_hash: 'h1', rule_content: 'rule text' } };
    if (cmd instanceof PutCommand && input.TableName === 'audit-trail') {
      if (trailFails) throw new Error('ProvisionedThroughputExceededException');
      trailRows.push(input.Item as Item);
      return {};
    }
    if (cmd instanceof QueryCommand) {
      queries.push(input);
      // Applies the key condition and filter the way DynamoDB would, for the
      // one query shape the Auditor sends. A changed shape fails the asserts below.
      const values = input.ExpressionAttributeValues as Item;
      return { Items: corrections.filter((c) => c.rcicId === values[':r'] && String(c.correctedAt) >= String(values[':cutoff'])) };
    }
    throw new Error(`unexpected command ${cmd.constructor.name}`);
  };
  (BedrockRuntimeClient.prototype as { send: unknown }).send = async (cmd: ConverseCommand) => {
    lastRequest = cmd.input;
    return {
      stopReason: 'end_turn',
      output: { message: { role: 'assistant', content: [{ text: modelReply }] } },
    };
  };
  (EventBridgeClient.prototype as { send: unknown }).send = async (cmd: PutEventsCommand) => {
    for (const e of cmd.input.Entries ?? []) verdicts.push(JSON.parse(e.Detail ?? '{}') as Item);
    return {};
  };

  handler = (await import(outfile)).handler as Handler;
});

beforeEach(() => {
  corrections.length = 0;
  queries.length = 0;
  lastRequest = undefined;
  trailRows.length = 0;
  verdicts.length = 0;
  trailFails = false;
  modelReply = '{"passed":true,"issues":[]}';
});

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/** A row in the shape impacts-service POST /impacts/{id}/correction writes. */
function row(key: string, topic: string, policyDomain: string, correctedAt: string, extra: Item = {}): Item {
  return {
    rcicId: 'R1',
    correctionKey: `pe#c#${key}`,
    assessmentKey: 'pe#c',
    clientId: 'c',
    policyEventId: 'pe',
    ruleHash: 'h0',
    topic,
    policyDomain,
    originalImpactType: 'procedural',
    originalNumericDelta: null,
    originalNarrative: `narrative ${key}`,
    originalRecommendedAction: `action ${key}`,
    originalConfidence: 'high',
    correctedImpactType: 'eligibility-flip',
    correctedNumericDelta: null,
    correctedNarrative: null,
    correctedRecommendedAction: null,
    correctedConfidence: null,
    correctorReasoning: `reason ${key}`,
    correctedAt,
    ...extra,
  };
}

const hypothesis = {
  hypothesisId: 'hyp1',
  timestamp: daysAgo(0),
  rcicId: 'R1',
  clientId: 'c1',
  policyEventId: 'pe1',
  ruleHash: 'h1',
  topic: 'ee-category-draws',
  policyDomain: 'express-entry',
  isAffected: true,
  impactType: 'procedural',
  numericDelta: null,
  narrative: 'n',
  recommendedAction: 'a',
  confidence: 'high',
  reasoning: 'r',
  clientProfile: { clientId: 'c1', program: 'express-entry' },
};

async function audit(overrides: Item = {}): Promise<ConverseCommandInput> {
  const origLog = console.log;
  console.log = () => {};
  try {
    await handler({ detail: { ...hypothesis, ...overrides } });
  } finally {
    console.log = origLog;
  }
  assert.ok(lastRequest, 'the handler called Bedrock');
  return lastRequest;
}

/** The guarded correction bodies in the system prompt, in order. */
function fewShotBodies(req: ConverseCommandInput): string[] {
  return (req.system ?? []).flatMap((b) => (b.guardContent && 'text' in b.guardContent ? [b.guardContent.text?.text ?? ''] : []));
}

describe('Auditor correction loader', () => {
  it('queries the table impacts-service writes, by the consultant partition key', async () => {
    await audit();
    assert.equal(queries.length, 1);
    assert.equal(queries[0].TableName, 'argus-training-corrections');
    assert.equal(queries[0].KeyConditionExpression, 'rcicId = :r');
    assert.equal((queries[0].ExpressionAttributeValues as Item)[':r'], 'R1');
  });

  it('picks same topic, then same domain, newest first, capped at 5', async () => {
    corrections.push(
      row('domain-a', 'ee-crs-grid', 'express-entry', daysAgo(10)),
      row('domain-b', 'ee-proof-of-funds', 'express-entry', daysAgo(15)),
      row('domain-c', 'ee-tie-break', 'express-entry', daysAgo(25)),
      row('domain-d', 'ee-medical', 'express-entry', daysAgo(35)),
      row('topic-old', 'ee-category-draws', 'express-entry', daysAgo(40)),
      row('topic-new', 'ee-category-draws', 'express-entry', daysAgo(5)),
      row('expired', 'ee-category-draws', 'express-entry', daysAgo(120)),
      { ...row('other-tenant', 'ee-category-draws', 'express-entry', daysAgo(2)), rcicId: 'R2' },
    );
    const bodies = fewShotBodies(await audit());
    const keys = bodies.map((b) => /narrative (\S+?)"/.exec(b)?.[1]);
    assert.deepEqual(keys, ['topic-new', 'topic-old', 'domain-a', 'domain-b', 'domain-c']);
  });

  it('never loads a correction from another topic and another domain, however recent', async () => {
    // The case that went wrong: an Express Entry correction filed yesterday
    // rewrote a study-permit audit. With only unrelated rows, nothing loads.
    corrections.push(
      row('ee-yesterday', 'ee-category-draws', 'express-entry', daysAgo(1)),
      row('pgp-today', 'pgp-intake', 'family', daysAgo(0)),
    );
    const req = await audit({ topic: 'study-permit-cap', policyDomain: 'study-permits' });
    assert.deepEqual(fewShotBodies(req), []);
    assert.doesNotMatch(JSON.stringify(req.system), /PAST CORRECTIONS/);
  });

  it('leaves slots empty before it fills them with unrelated rows', async () => {
    corrections.push(
      row('topic', 'ee-category-draws', 'express-entry', daysAgo(3)),
      row('unrelated-new', 'study-permit-cap', 'study-permits', daysAgo(0)),
    );
    const keys = fewShotBodies(await audit()).map((b) => /narrative (\S+?)"/.exec(b)?.[1]);
    assert.deepEqual(keys, ['topic']);
  });

  it('does not treat two empty policy domains as a match', async () => {
    corrections.push(row('blank-domain', 'pgp-intake', '', daysAgo(1)));
    const req = await audit({ topic: 'study-permit-cap', policyDomain: '' });
    assert.deepEqual(fewShotBodies(req), []);
  });

  it('adds no few-shot block when the consultant has no corrections', async () => {
    const req = await audit();
    assert.deepEqual(fewShotBodies(req), []);
    assert.doesNotMatch(JSON.stringify(req.system), /PAST CORRECTIONS/);
  });
});

describe('Auditor few-shot prompt', () => {
  it('teaches a corrected recommended action and confidence', async () => {
    corrections.push(
      row('act', 'ee-category-draws', 'express-entry', daysAgo(1), {
        correctedImpactType: 'procedural',
        correctedRecommendedAction: 'Book a language retest before the next category round',
        correctedConfidence: 'medium',
      }),
    );
    const [body] = fewShotBodies(await audit());
    assert.match(body, /Book a language retest before the next category round/);
    assert.match(body, /original: "action act"/);
    assert.match(body, /Corrected confidence: medium \(original: high\)/);
  });

  it('keeps the consultant text inside guarded blocks and the headers plain', async () => {
    corrections.push(row('g', 'ee-category-draws', 'express-entry', daysAgo(1)));
    const req = await audit();
    const system = req.system ?? [];
    const plain = system.flatMap((b) => ('text' in b && typeof b.text === 'string' ? [b.text] : []));
    assert.ok(plain.some((t) => t.includes('CORRECTION 1 (topic=ee-category-draws')));
    assert.ok(plain.every((t) => !t.includes('reason g')), 'consultant reasoning never rides in a plain block');
    assert.match(fewShotBodies(req)[0], /Consultant reasoning: reason g/);
  });
});

describe('Auditor step telemetry', () => {
  it('records the correction keys it actually used, in the order it used them', async () => {
    corrections.push(
      row('domain-a', 'ee-crs-grid', 'express-entry', daysAgo(10)),
      row('topic-new', 'ee-category-draws', 'express-entry', daysAgo(5)),
      row('unrelated', 'study-permit-cap', 'study-permits', daysAgo(1)),
      row('expired', 'ee-category-draws', 'express-entry', daysAgo(120)),
    );
    await audit();
    assert.equal(trailRows.length, 1);
    const step = trailRows[0];
    assert.deepEqual(step.fewShotCorrectionKeys, ['pe#c#topic-new', 'pe#c#domain-a']);
    assert.equal(step.agent, 'auditor');
    assert.equal(step.modelId, 'us.test-model');
    assert.equal(step.outcome, 'passed');
    assert.equal(step.assessmentId, 'R1#pe1#c1');
    assert.equal(typeof step.durationMs, 'number');
  });

  it('records an empty list when no correction applied', async () => {
    await audit();
    assert.deepEqual(trailRows[0].fewShotCorrectionKeys, []);
  });

  it('keeps the correction keys out of the verdict Anchor signs from', async () => {
    corrections.push(row('topic-new', 'ee-category-draws', 'express-entry', daysAgo(5)));
    await audit();
    assert.equal(verdicts.length, 1);
    assert.doesNotMatch(JSON.stringify(verdicts[0]), /fewShotCorrectionKeys|pe#c#topic-new/);
  });

  it('still emits the verdict when the telemetry write fails', async () => {
    trailFails = true;
    await audit();
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].passed, true);
  });

  it('records a rejected verdict as rejected', async () => {
    modelReply = '{"passed":false,"issues":[{"type":"other","detail":"wrong program"}]}';
    await audit();
    assert.equal(trailRows[0].outcome, 'rejected');
  });

  it('records a failed step and still fails the audit when the model returns junk', async () => {
    modelReply = 'no json here';
    const origLog = console.log;
    console.log = () => {};
    try {
      await assert.rejects(handler({ detail: hypothesis }), /non-JSON/);
    } finally {
      console.log = origLog;
    }
    assert.equal(trailRows[0].outcome, 'failed');
    assert.equal(verdicts.length, 0);
  });
});
