import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type ApplyGuardrailCommand, type ApplyGuardrailCommandOutput, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { createHash } from 'node:crypto';
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
const puts: Array<{ TableName: string; Item: Item; ConditionExpression?: string }> = [];
const kmsSigned: Buffer[] = [];
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
  rulesUsed: ['h1'],
  citationSourceUrl: 'https://www.canada.ca/x',
  citationSourceS3Key: 'snapshots/x.html',
  auditorReasoning: 'fine',
  auditIssues: [],
  timestamp: '2026-09-20T00:00:00.000Z',
  canonicalHash: 'a'.repeat(64),
  signatureBase64: 'c2ln',
  signingKeyId: 'key',
  signatureAlgorithm: 'ECDSA_SHA_256',
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
    RCIC_USERS_TABLE: 'users',
    PUBLIC_COUNTERS_TABLE: 'counters',
    AWS_REGION: 'us-east-1',
  });

  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input as { TableName: string; Key?: Item; Item?: Item; ConditionExpression?: string };
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
      puts.push({ TableName: input.TableName, Item: input.Item ?? {}, ConditionExpression: input.ConditionExpression });
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
    if (cmd instanceof SignCommand) {
      assert.equal(cmd.input.MessageType, 'DIGEST');
      assert.equal(cmd.input.SigningAlgorithm, 'ECDSA_SHA_256');
      assert.equal(cmd.input.KeyId, 'key');
      kmsSigned.push(Buffer.from(cmd.input.Message as Uint8Array));
      return { Signature: new Uint8Array([9, 8, 7]) };
    }
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
  kmsSigned.length = 0;
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

// The verifier's canonical form (records VERIFY.md, web signature check),
// written out again here so a drift in review.ts fails this file.
function canonical(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Item;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

const SIGNATURE_COLUMNS = ['assessmentKey', 'canonicalHash', 'signatureBase64', 'signingKeyId', 'signatureAlgorithm'];
const REVIEW_SIGNED_FIELDS = [
  'assessmentId', 'recordKind', 'supersedes', 'supersedesCanonicalHash', 'rcicId', 'clientId', 'policyEventId', 'ruleHash',
  'topic', 'isAffected', 'impactType', 'numericDelta', 'narrative', 'recommendedAction', 'confidence', 'rulesUsed',
  'citationSourceUrl', 'citationSourceS3Key', 'reviewedBy', 'reviewedAt', 'reviewReasoning', 'timestamp',
];

describe('POST /impacts/{id}/correction with a changed verdict (ADR-0004)', () => {
  const flip = {
    correctorReasoning: 'c1 holds no attestation letter, so the new requirement does not reach the file',
    correctedIsAffected: false,
    correctedImpactType: 'none',
    correctedNarrative: 'c1 is not affected by the attestation requirement',
    correctedRecommendedAction: 'No action needed',
  };
  const reviewPut = () => puts.find((p) => p.TableName === 'assessments');
  const correctionPut = () => puts.find((p) => p.TableName === 'argus-training-corrections');

  it('signs a new consultant-review row and leaves the agent row untouched', async () => {
    const res = await postCorrection(flip);
    assert.equal(res.statusCode, 200);
    const review = reviewPut();
    assert.ok(review, 'a review row was written');
    const row = review.Item;
    assert.notEqual(row.assessmentKey, 'pe1#c1', 'the agent row is never overwritten');
    assert.match(String(row.assessmentKey), /^review-\d{13}-pe1#c1$/);
    assert.equal(review.ConditionExpression, 'attribute_not_exists(rcicId) AND attribute_not_exists(assessmentKey)');
    assert.equal(puts.filter((p) => p.TableName === 'assessments').length, 1);
    assert.equal(row.recordKind, 'consultant-review');
    assert.equal(row.supersedes, 'pe1#c1');
    assert.equal(row.supersedesCanonicalHash, 'a'.repeat(64));
    assert.equal(row.reviewedBy, 'R1');
    assert.equal(row.reviewedAt, row.timestamp);
    assert.equal(row.isAffected, false);
    assert.equal(row.impactType, 'none');
    assert.equal(row.narrative, flip.correctedNarrative);
    assert.equal(row.recommendedAction, flip.correctedRecommendedAction);
    assert.equal(row.reviewReasoning, flip.correctorReasoning);
    // Copied from the agent row, since no correction touches them.
    assert.equal(row.confidence, 'high');
    assert.equal(row.ruleHash, 'h1');
    assert.deepEqual(row.rulesUsed, ['h1']);
    assert.equal(row.citationSourceUrl, 'https://www.canada.ca/x');
  });

  it('stores exactly the signed fields plus the signature columns, and the hash re-verifies', async () => {
    await postCorrection(flip);
    const row = reviewPut()?.Item ?? {};
    assert.deepEqual(Object.keys(row).sort(), [...REVIEW_SIGNED_FIELDS, ...SIGNATURE_COLUMNS].sort());
    const signedPayload = Object.fromEntries(REVIEW_SIGNED_FIELDS.map((k) => [k, row[k]]));
    const hash = createHash('sha256').update(canonical(signedPayload)).digest('hex');
    assert.equal(row.canonicalHash, hash);
    // KMS signed that hash as a 32-byte digest.
    assert.equal(kmsSigned.length, 1);
    assert.equal(kmsSigned[0].toString('hex'), hash);
    assert.equal(row.signatureBase64, Buffer.from([9, 8, 7]).toString('base64'));
    assert.equal(row.signingKeyId, 'key');
  });

  it('still writes the training correction, pointing at the review', async () => {
    const res = await postCorrection(flip);
    const correction = correctionPut()?.Item ?? {};
    assert.equal(correction.originalIsAffected, true);
    assert.equal(correction.correctedIsAffected, false);
    assert.equal(correction.reviewAssessmentKey, reviewPut()?.Item.assessmentKey);
    const body = JSON.parse(res.body) as Item;
    assert.equal((body.review as Item).assessmentKey, reviewPut()?.Item.assessmentKey);
    assert.equal('signatureBase64' in (body.review as Item), false);
  });

  it('writes no review when the consultant keeps the same verdict', async () => {
    const res = await postCorrection({ ...flip, correctedIsAffected: true, correctedImpactType: 'procedural' });
    assert.equal(res.statusCode, 200);
    assert.equal(reviewPut(), undefined);
    assert.equal(kmsSigned.length, 0);
    assert.equal(correctionPut()?.Item.correctedIsAffected, true);
    assert.equal((JSON.parse(res.body) as Item).review, null);
  });

  it('writes no review for a narrative-only correction', async () => {
    const res = await postCorrection({ correctorReasoning: 'wording', correctedImpactType: 'procedural', correctedNarrative: 'c1 should watch' });
    assert.equal(res.statusCode, 200);
    assert.equal(reviewPut(), undefined);
    assert.equal(correctionPut()?.Item.correctedIsAffected, null);
  });

  const refusals: Array<[string, Item, string]> = [
    ['a verdict change with no narrative', { ...flip, correctedNarrative: '' }, 'verdict-change-needs-correctedNarrative'],
    ['a verdict change with no action', { ...flip, correctedRecommendedAction: undefined }, 'verdict-change-needs-correctedRecommendedAction'],
    ['a verdict that is not a boolean', { ...flip, correctedIsAffected: 'false' }, 'correctedIsAffected-must-be-boolean'],
  ];
  for (const [label, body, code] of refusals) {
    it(`refuses ${label} and writes nothing`, async () => {
      const res = await postCorrection(body);
      assert.equal(res.statusCode, 400);
      assert.equal((JSON.parse(res.body) as Item).error, code);
      assert.equal(puts.length, 0);
      assert.equal(kmsSigned.length, 0);
    });
  }

  it('refuses an affected verdict with impact type none, since Composer would draft nothing', async () => {
    assessment.isAffected = false;
    try {
      const res = await postCorrection({ ...flip, correctedIsAffected: true, correctedImpactType: 'none' });
      assert.equal(res.statusCode, 400);
      assert.equal((JSON.parse(res.body) as Item).error, 'affected-verdict-needs-an-impact-type');
      assert.equal(puts.length, 0);
    } finally {
      assessment.isAffected = true;
    }
  });

  it('signs nothing when the guardrail blocks the text', async () => {
    guardrailResponse = {
      action: 'GUARDRAIL_INTERVENED',
      assessments: [{ sensitiveInformationPolicy: { piiEntities: [{ type: 'NAME', match: 'x', action: 'BLOCKED', detected: true }], regexes: [] } }],
    };
    const res = await postCorrection(flip);
    assert.equal(res.statusCode, 422);
    assert.equal(kmsSigned.length, 0);
    assert.equal(puts.length, 0);
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
    assert.equal(body.recordKind, 'agent');
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
