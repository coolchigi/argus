import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type ApplyGuardrailCommand, type ApplyGuardrailCommandOutput, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { GetPublicKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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
const guardrailCalls: ApplyGuardrailCommand['input'][] = [];
const logs: string[] = [];

// What the fake guardrail answers. A passing check by default.
const passed: Partial<ApplyGuardrailCommandOutput> = { action: 'NONE', assessments: [{}] };
let guardrailResponse: Partial<ApplyGuardrailCommandOutput> = passed;

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
    BRIEFS_TABLE: 'briefs',
    SIGNING_KEY_ID: 'key',
    BEDROCK_GUARDRAIL_ID: 'gr-test',
    BEDROCK_GUARDRAIL_VERSION: '7',
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
    if (cmd instanceof QueryCommand) return fakeQuery(cmd.input);
    if (cmd instanceof GetCommand && input.TableName === 'briefs') {
      const k = input.Key ?? {};
      return { Item: sentBriefs.find((b) => b.rcicId === k.rcicId && b.briefId === k.briefId) };
    }
    if (cmd instanceof PutCommand) {
      puts.push({ TableName: input.TableName, Item: input.Item ?? {} });
      return {};
    }
    throw new Error(`unexpected command ${cmd.constructor.name} on ${input.TableName}`);
  };

  (BedrockRuntimeClient.prototype as { send: unknown }).send = async (cmd: ApplyGuardrailCommand) => {
    guardrailCalls.push(cmd.input);
    return guardrailResponse;
  };

  (KMSClient.prototype as { send: unknown }).send = async (cmd: unknown) => {
    if (cmd instanceof GetPublicKeyCommand) return { PublicKey: new Uint8Array([48, 1, 2, 3]) };
    throw new Error('unexpected kms command');
  };

  handler = (await import(outfile)).handler as Handler;
});

// TrainingCorrections rows across two tenants and two assessments. The
// assessment `pe1#c1` is a prefix of `pe1#c10`'s key, which is the trap a
// begins_with on the bare key would fall into.
const corrections: Item[] = [
  { rcicId: 'R1', correctionKey: 'pe1#c1#2026-09-21T00:00:00.000Z', assessmentKey: 'pe1#c1', correctedAt: '2026-09-21T00:00:00.000Z' },
  { rcicId: 'R1', correctionKey: 'pe1#c1#2026-09-23T00:00:00.000Z', assessmentKey: 'pe1#c1', correctedAt: '2026-09-23T00:00:00.000Z' },
  { rcicId: 'R1', correctionKey: 'pe1#c10#2026-09-22T00:00:00.000Z', assessmentKey: 'pe1#c10', correctedAt: '2026-09-22T00:00:00.000Z' },
  { rcicId: 'R1', correctionKey: 'pe2#c3#2026-09-24T00:00:00.000Z', assessmentKey: 'pe2#c3', correctedAt: '2026-09-24T00:00:00.000Z' },
  { rcicId: 'R2', correctionKey: 'pe1#c1#2026-09-25T00:00:00.000Z', assessmentKey: 'pe1#c1', correctedAt: '2026-09-25T00:00:00.000Z' },
];

const ASSESSMENT_HASH = 'a'.repeat(64);
const BRIEF_HASH = 'b'.repeat(64);
const sentBriefs: Item[] = [
  {
    rcicId: 'R1',
    briefId: 'brief-1',
    clientId: 'c1',
    topic: 'ee-category-draws',
    status: 'sent',
    sentAt: '2026-09-26T00:00:00.000Z',
    sentBodyHash: BRIEF_HASH,
    sentSignature: 'c2lnbmF0dXJl',
    sentSignatureAlgorithm: 'ECDSA_SHA_256',
    sentSigningKeyId: 'key',
    sentBodyMarkdown: 'Hello Priya',
    sentRecipientHash: 'f'.repeat(64),
    sentRecipientDomain: 'example.org',
    sender: 'consultant@example.ca',
  },
];
const queries: Item[] = [];

// Answers the key conditions the handler uses, one page of 2 rows at a time
// so the handler has to follow LastEvaluatedKey.
function fakeQuery(input: Item) {
  queries.push(input);
  const values = (input.ExpressionAttributeValues ?? {}) as Item;
  if (input.TableName === 'argus-training-corrections') {
    const cond = String(input.KeyConditionExpression);
    let rows = corrections.filter((c) => c.rcicId === values[':r']);
    if (cond.includes('begins_with(correctionKey, :p)')) rows = rows.filter((c) => String(c.correctionKey).startsWith(String(values[':p'])));
    const start = Number((input.ExclusiveStartKey as Item | undefined)?.offset ?? 0);
    const page = rows.slice(start, start + 2);
    return { Items: page, LastEvaluatedKey: start + 2 < rows.length ? { offset: start + 2 } : undefined };
  }
  if (input.TableName === 'assessments' && input.IndexName === 'byCanonicalHash') {
    return { Items: values[':h'] === ASSESSMENT_HASH ? [{ rcicId: 'R1', assessmentKey: 'pe1#c1', canonicalHash: ASSESSMENT_HASH }] : [] };
  }
  if (input.TableName === 'briefs' && input.IndexName === 'bySentBodyHash') {
    return { Items: sentBriefs.filter((b) => b.sentBodyHash === values[':h']).map((b) => ({ rcicId: b.rcicId, briefId: b.briefId, sentBodyHash: b.sentBodyHash })) };
  }
  throw new Error(`unexpected query on ${String(input.TableName)}`);
}

beforeEach(() => {
  puts.length = 0;
  guardrailCalls.length = 0;
  logs.length = 0;
  guardrailResponse = passed;
});

async function postCorrection(body: Item) {
  const origLog = console.log;
  console.log = (line: string) => logs.push(line);
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

describe('POST /impacts/{id}/correction guardrail check', () => {
  const body = {
    correctorReasoning: 'Priya Sandhu is outside the French category',
    correctedImpactType: 'eligibility-flip',
    correctedNarrative: 'c1 is now outside the category',
    correctedRecommendedAction: 'Book a language retest',
  };
  // The shape ApplyGuardrail returns when the NAME entity blocks, with the
  // matched text in `match` the way Bedrock reports it.
  const blockedName: Partial<ApplyGuardrailCommandOutput> = {
    action: 'GUARDRAIL_INTERVENED',
    outputs: [{ text: 'Sorry, Argus cannot process this request.' }],
    assessments: [{ sensitiveInformationPolicy: { piiEntities: [{ type: 'NAME', match: 'Priya Sandhu', action: 'BLOCKED', detected: true }], regexes: [] } }],
  };

  it('checks every free-text field with the configured guardrail as input', async () => {
    await postCorrection(body);
    assert.equal(guardrailCalls.length, 1);
    const call = guardrailCalls[0];
    assert.equal(call.guardrailIdentifier, 'gr-test');
    assert.equal(call.guardrailVersion, '7');
    assert.equal(call.source, 'INPUT');
    const texts = (call.content ?? []).map((c) => c.text?.text);
    assert.deepEqual(texts, [body.correctorReasoning, body.correctedNarrative, body.correctedRecommendedAction]);
  });

  it('returns 422 and stores nothing when the guardrail blocks a client name', async () => {
    guardrailResponse = blockedName;
    const res = await postCorrection(body);
    assert.equal(res.statusCode, 422);
    assert.deepEqual(JSON.parse(res.body), { error: 'correction-contains-personal-information' });
    assert.equal(puts.length, 0, 'nothing written to TrainingCorrections');
  });

  it('logs the policy names and never the matched text', async () => {
    guardrailResponse = blockedName;
    await postCorrection(body);
    const all = logs.join('\n');
    assert.match(all, /pii:NAME/);
    assert.doesNotMatch(all, /Priya|Sandhu/);
  });

  it('returns 422 with a separate code when a non-personal policy blocks', async () => {
    guardrailResponse = {
      action: 'GUARDRAIL_INTERVENED',
      assessments: [{ contentPolicy: { filters: [{ type: 'PROMPT_ATTACK', confidence: 'HIGH', action: 'BLOCKED' }] } }],
    };
    const res = await postCorrection(body);
    assert.equal(res.statusCode, 422);
    assert.deepEqual(JSON.parse(res.body), { error: 'correction-blocked-by-guardrail' });
    assert.equal(puts.length, 0);
  });

  it('stores the correction when the guardrail passes it', async () => {
    const res = await postCorrection({ ...body, correctorReasoning: 'c1 is outside the French category' });
    assert.equal(res.statusCode, 200);
    assert.equal(puts.length, 1);
    assert.equal(puts[0].Item.correctorReasoning, 'c1 is outside the French category');
  });

  it('skips empty optional fields rather than sending blank text', async () => {
    await postCorrection({ correctorReasoning: 'c1 is outside the category', correctedImpactType: 'none' });
    assert.deepEqual((guardrailCalls[0].content ?? []).map((c) => c.text?.text), ['c1 is outside the category']);
  });
});

async function get(routeKey: string, pathParameters: Record<string, string> | undefined, tenant: string | null = 'R1') {
  const origLog = console.log;
  console.log = () => {};
  try {
    const claims = tenant ? { 'custom:rcic_id': tenant } : {};
    const res = await handler({
      routeKey,
      rawPath: '/',
      pathParameters,
      requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims } } },
    });
    return { status: res.statusCode, body: JSON.parse(res.body) as Item };
  } finally {
    console.log = origLog;
  }
}

describe('GET /impacts/{id}/corrections', () => {
  it("returns only this assessment's corrections for this consultant, newest first", async () => {
    queries.length = 0;
    const { status, body } = await get('GET /impacts/{id}/corrections', { id: 'pe1%23c1' });
    assert.equal(status, 200);
    const keys = (body.corrections as Item[]).map((c) => c.correctionKey);
    assert.deepEqual(keys, ['pe1#c1#2026-09-23T00:00:00.000Z', 'pe1#c1#2026-09-21T00:00:00.000Z']);
    // A key query inside the tenant partition, never a scan.
    assert.ok(queries.length > 0);
    assert.ok(queries.every((q) => q.TableName === 'argus-training-corrections' && (q.ExpressionAttributeValues as Item)[':r'] === 'R1'));
  });

  it('is refused without a tenant claim', async () => {
    const { status } = await get('GET /impacts/{id}/corrections', { id: 'pe1%23c1' }, null);
    assert.equal(status, 403);
  });
});

describe('GET /corrections', () => {
  it("returns every correction this consultant filed across pages, and none of another consultant's", async () => {
    const { status, body } = await get('GET /corrections', undefined);
    assert.equal(status, 200);
    const list = body.corrections as Item[];
    assert.equal(list.length, 4);
    assert.ok(list.every((c) => c.rcicId === 'R1'));
    assert.deepEqual(
      list.map((c) => c.correctedAt),
      ['2026-09-24T00:00:00.000Z', '2026-09-23T00:00:00.000Z', '2026-09-22T00:00:00.000Z', '2026-09-21T00:00:00.000Z'],
    );
  });
});

describe('GET /public/verify/{hash}', () => {
  it('labels an assessment receipt with its kind and signing scheme', async () => {
    const { status, body } = await get('GET /public/verify/{hash}', { hash: ASSESSMENT_HASH }, null);
    assert.equal(status, 200);
    assert.equal(body.kind, 'assessment');
    assert.equal(body.scheme, 'kms-digest-v1');
    assert.equal(body.canonicalHash, ASSESSMENT_HASH);
  });

  it("falls back to a sent brief's hash and returns proof only", async () => {
    const { status, body } = await get('GET /public/verify/{hash}', { hash: BRIEF_HASH }, null);
    assert.equal(status, 200);
    assert.equal(body.kind, 'brief');
    assert.equal(body.scheme, 'kms-digest-v1');
    assert.equal(body.canonicalHash, BRIEF_HASH);
    assert.equal(body.signatureBase64, 'c2lnbmF0dXJl');
    assert.equal(body.signedAt, '2026-09-26T00:00:00.000Z');
    assert.match(String(body.publicKeyPem), /BEGIN PUBLIC KEY/);
    const raw = JSON.stringify(body);
    for (const leak of ['Hello Priya', 'example.org', 'consultant@example.ca', 'brief-1', '"c1"', 'R1', 'f'.repeat(64)]) {
      assert.ok(!raw.includes(leak), `public receipt leaks ${leak}`);
    }
  });

  it('is a 404 when neither an assessment nor a brief has the hash', async () => {
    const { status } = await get('GET /public/verify/{hash}', { hash: 'c'.repeat(64) }, null);
    assert.equal(status, 404);
  });
});
