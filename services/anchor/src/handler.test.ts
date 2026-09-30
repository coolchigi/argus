import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { KMSClient, type SignCommand } from '@aws-sdk/client-kms';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';

// Runs the real Anchor handler with the AWS SDK clients swapped for fakes.
// The handler is bundled with esbuild (the same tool CDK uses) with the SDK
// left external, so the clients here are the ones the handler uses. Nothing
// reaches AWS.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'anchor-handler.mjs');

type Item = Record<string, unknown>;
const puts: Array<{ TableName: string; Item: Item; ConditionExpression?: string }> = [];
const signed: Buffer[] = [];
let auditTrailFails = false;

type Handler = (event: unknown) => Promise<{ anchored: boolean }>;
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
    IMPACT_ASSESSMENTS_TABLE: 'assessments',
    AUDIT_TRAIL_TABLE: 'audit-trail',
    SIGNING_KEY_ID: 'key-1',
    AWS_REGION: 'us-east-1',
  });

  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    if (cmd instanceof GetCommand) {
      return { Item: { rule_hash: 'h1', source_url: 'https://www.canada.ca/x', source_s3_key: 'snapshots/x.html' } };
    }
    if (cmd instanceof PutCommand) {
      const input = cmd.input as { TableName: string; Item: Item; ConditionExpression?: string };
      if (input.TableName === 'audit-trail' && auditTrailFails) throw new Error('ProvisionedThroughputExceededException');
      puts.push(input);
      return {};
    }
    throw new Error(`unexpected command ${cmd.constructor.name}`);
  };
  (KMSClient.prototype as { send: unknown }).send = async (cmd: SignCommand) => {
    signed.push(Buffer.from(cmd.input.Message as Uint8Array));
    return { Signature: new Uint8Array([1, 2, 3]) };
  };

  handler = (await import(outfile)).handler as Handler;
});

beforeEach(() => {
  puts.length = 0;
  signed.length = 0;
  auditTrailFails = false;
});

const verdict = {
  verdictId: 'v1',
  timestamp: '2026-09-29T11:59:58.000Z',
  hypothesisId: 'hyp1',
  rcicId: 'R1',
  clientId: 'c1',
  policyEventId: 'pe1',
  ruleHash: 'h1',
  passed: true,
  issues: [{ type: 'magnitude-error', detail: 'delta was -10' }],
  correctedNumericDelta: -6,
  correctedImpactType: 'crs-delta',
  correctedNarrative: 'c1 loses 6 points',
  correctedRecommendedAction: 'Retake the language test',
  correctedConfidence: 'medium',
  auditorReasoning: 'The rule gives 6 points, not 10.',
  originalHypothesis: {
    isAffected: true,
    impactType: 'crs-delta',
    numericDelta: -10,
    narrative: 'c1 loses 10 points',
    topic: 'ee-crs-grid',
  },
};

// The exact bytes Anchor canonicalized and signed for the verdict above, at
// 2026-09-29T12:00:00.000Z, captured from the handler before step telemetry
// was added. If telemetry ever leaks into the signed payload, or the payload
// changes shape, this string stops matching.
const SIGNED_CANONICAL =
  '{"assessmentId":"pe1#c1","auditIssues":[{"detail":"delta was -10","type":"magnitude-error"}],"auditorReasoning":"The rule gives 6 points, not 10.","citationSourceS3Key":"snapshots/x.html","citationSourceUrl":"https://www.canada.ca/x","clientId":"c1","confidence":"medium","impactType":"crs-delta","isAffected":true,"narrative":"c1 loses 6 points","numericDelta":-6,"policyEventId":"pe1","rcicId":"R1","recommendedAction":"Retake the language test","ruleHash":"h1","rulesUsed":["h1"],"timestamp":"2026-09-29T12:00:00.000Z","topic":"ee-crs-grid"}';
const SIGNED_HASH = createHash('sha256').update(SIGNED_CANONICAL).digest('hex');

async function anchor(event: unknown): Promise<{ anchored: boolean; logs: string[] }> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (line: string) => logs.push(line);
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-29T12:00:00.000Z') });
  try {
    const res = await handler(event);
    return { ...res, logs };
  } finally {
    mock.timers.reset();
    console.log = origLog;
  }
}

const assessmentPut = () => puts.find((p) => p.TableName === 'assessments');
const trailPut = () => puts.find((p) => p.TableName === 'audit-trail');

describe('Anchor signing', () => {
  it('signs exactly the canonical bytes it signed before step telemetry', async () => {
    const res = await anchor({ detail: verdict });
    assert.equal(res.anchored, true);
    assert.equal(signed.length, 1);
    assert.equal(signed[0].toString('hex'), SIGNED_HASH);
    assert.equal(assessmentPut()?.Item.canonicalHash, SIGNED_HASH);
  });

  it('writes no telemetry field onto the signed assessment row', async () => {
    await anchor({ detail: verdict });
    const item = assessmentPut()?.Item ?? {};
    const signedKeys = Object.keys(JSON.parse(SIGNED_CANONICAL) as Item);
    const storageKeys = ['assessmentKey', 'canonicalHash', 'signatureBase64', 'signingKeyId', 'signatureAlgorithm'];
    assert.deepEqual(Object.keys(item).sort(), [...signedKeys, ...storageKeys].sort());
  });

  it('still signs and stores the assessment when the telemetry write fails', async () => {
    auditTrailFails = true;
    const res = await anchor({ detail: verdict });
    assert.equal(res.anchored, true);
    assert.equal(signed[0].toString('hex'), SIGNED_HASH);
    assert.equal(assessmentPut()?.Item.canonicalHash, SIGNED_HASH);
    assert.ok(res.logs.some((l) => l.includes('telemetry-write-failed')), 'the failure is logged');
  });
});

// ADR-0004: the same verdict from an Auditor that returns a stance. The
// signed bytes are the old ones plus one auditorStance key, in sorted place.
const verdictWithStance = {
  ...verdict,
  affectedStance: 'disagree',
  affectedStanceReason: 'The profile meets the condition the rule sets.',
};
const SIGNED_CANONICAL_WITH_STANCE =
  '{"assessmentId":"pe1#c1","auditIssues":[{"detail":"delta was -10","type":"magnitude-error"}],"auditorReasoning":"The rule gives 6 points, not 10.","auditorStance":{"reason":"The profile meets the condition the rule sets.","stance":"disagree"},"citationSourceS3Key":"snapshots/x.html","citationSourceUrl":"https://www.canada.ca/x","clientId":"c1","confidence":"medium","impactType":"crs-delta","isAffected":true,"narrative":"c1 loses 6 points","numericDelta":-6,"policyEventId":"pe1","rcicId":"R1","recommendedAction":"Retake the language test","ruleHash":"h1","rulesUsed":["h1"],"timestamp":"2026-09-29T12:00:00.000Z","topic":"ee-crs-grid"}';
const SIGNED_HASH_WITH_STANCE = createHash('sha256').update(SIGNED_CANONICAL_WITH_STANCE).digest('hex');

describe('Anchor signs the Auditor stance (ADR-0004)', () => {
  it('signs the stance and reason next to the Analyst isAffected', async () => {
    const res = await anchor({ detail: verdictWithStance });
    assert.equal(res.anchored, true);
    assert.equal(signed[0].toString('hex'), SIGNED_HASH_WITH_STANCE);
    const item = assessmentPut()?.Item ?? {};
    assert.equal(item.canonicalHash, SIGNED_HASH_WITH_STANCE);
    assert.deepEqual(item.auditorStance, { stance: 'disagree', reason: 'The profile meets the condition the rule sets.' });
    // The stance never overrides the verdict.
    assert.equal(item.isAffected, true);
  });

  it('stores exactly the signed fields plus the signature columns', async () => {
    await anchor({ detail: verdictWithStance });
    const item = assessmentPut()?.Item ?? {};
    const signedKeys = Object.keys(JSON.parse(SIGNED_CANONICAL_WITH_STANCE) as Item);
    const storageKeys = ['assessmentKey', 'canonicalHash', 'signatureBase64', 'signingKeyId', 'signatureAlgorithm'];
    assert.deepEqual(Object.keys(item).sort(), [...signedKeys, ...storageKeys].sort());
  });

  it('signs the pre-ADR-0004 bytes when the stance is missing or unusable', async () => {
    for (const bad of [{}, { affectedStance: 'maybe', affectedStanceReason: 'x' }, { affectedStance: null }]) {
      signed.length = 0;
      puts.length = 0;
      await anchor({ detail: { ...verdict, ...bad } });
      assert.equal(signed[0].toString('hex'), SIGNED_HASH, JSON.stringify(bad));
      assert.equal('auditorStance' in (assessmentPut()?.Item ?? {}), false);
    }
  });
});

// A stance the Auditor's stance-check read as "uncertain" because its reason
// argued the opposite. The marker sits inside auditorStance, in sorted place.
const CONTRADICTED_REASON = 'The Auditor answered "agree" with isAffected=true, but its reason argues the opposite: c1 is not affected.';
const verdictContradicted = {
  ...verdict,
  affectedStance: 'uncertain',
  affectedStanceReason: CONTRADICTED_REASON,
  affectedStanceContradicted: true,
};
const SIGNED_CANONICAL_CONTRADICTED =
  '{"assessmentId":"pe1#c1","auditIssues":[{"detail":"delta was -10","type":"magnitude-error"}],"auditorReasoning":"The rule gives 6 points, not 10.","auditorStance":{"contradicted":true,"reason":"The Auditor answered \\"agree\\" with isAffected=true, but its reason argues the opposite: c1 is not affected.","stance":"uncertain"},"citationSourceS3Key":"snapshots/x.html","citationSourceUrl":"https://www.canada.ca/x","clientId":"c1","confidence":"medium","impactType":"crs-delta","isAffected":true,"narrative":"c1 loses 6 points","numericDelta":-6,"policyEventId":"pe1","rcicId":"R1","recommendedAction":"Retake the language test","ruleHash":"h1","rulesUsed":["h1"],"timestamp":"2026-09-29T12:00:00.000Z","topic":"ee-crs-grid"}';
const SIGNED_HASH_CONTRADICTED = createHash('sha256').update(SIGNED_CANONICAL_CONTRADICTED).digest('hex');
const SIGNED_CANONICAL_PLAIN_UNCERTAIN = SIGNED_CANONICAL_CONTRADICTED.replace('{"contradicted":true,', '{');
const SIGNED_HASH_PLAIN_UNCERTAIN = createHash('sha256').update(SIGNED_CANONICAL_PLAIN_UNCERTAIN).digest('hex');

describe('Anchor signs a contradicted stance', () => {
  it('signs contradicted inside auditorStance', async () => {
    await anchor({ detail: verdictContradicted });
    assert.equal(signed[0].toString('hex'), SIGNED_HASH_CONTRADICTED);
    const item = assessmentPut()?.Item ?? {};
    assert.equal(item.canonicalHash, SIGNED_HASH_CONTRADICTED);
    assert.deepEqual(item.auditorStance, { stance: 'uncertain', reason: CONTRADICTED_REASON, contradicted: true });
    assert.equal(item.isAffected, true);
  });

  it('keeps the bytes of every stance without the marker', async () => {
    await anchor({ detail: { ...verdictContradicted, affectedStanceContradicted: undefined } });
    assert.equal(signed[0].toString('hex'), SIGNED_HASH_PLAIN_UNCERTAIN);
    assert.equal('contradicted' in ((assessmentPut()?.Item.auditorStance ?? {}) as Item), false);
  });

  it('signs the marker on "uncertain" only, and only when it is exactly true', async () => {
    const cases: Array<[Item, string]> = [
      [{ affectedStance: 'disagree', affectedStanceReason: 'The profile meets the condition the rule sets.', affectedStanceContradicted: true }, SIGNED_HASH_WITH_STANCE],
      [{ affectedStanceContradicted: 'true' }, SIGNED_HASH_PLAIN_UNCERTAIN],
      [{ affectedStanceContradicted: false }, SIGNED_HASH_PLAIN_UNCERTAIN],
    ];
    for (const [over, hash] of cases) {
      signed.length = 0;
      puts.length = 0;
      await anchor({ detail: { ...verdictContradicted, ...over } });
      assert.equal(signed[0].toString('hex'), hash, JSON.stringify(over));
    }
  });
});

describe('Anchor step telemetry', () => {
  it('appends a signed step under the tenant-scoped assessment id', async () => {
    await anchor({ detail: verdict });
    const row = trailPut();
    assert.ok(row, 'a step row was written');
    assert.equal(row.Item.assessmentId, 'R1#pe1#c1');
    assert.match(String(row.Item.stepTimestamp), /^2026-09-29T12:00:00\.000Z#anchor$/);
    assert.equal(row.Item.tenantRunKey, 'R1#pe1');
    assert.equal(row.Item.agent, 'anchor');
    assert.equal(row.Item.modelId, null);
    assert.equal(row.Item.outcome, 'signed');
    assert.equal(typeof row.Item.durationMs, 'number');
    // Append only: a step row is never overwritten.
    assert.equal(row.ConditionExpression, 'attribute_not_exists(assessmentId)');
  });

  it('records a dropped verdict without signing anything', async () => {
    await anchor({ detail: { ...verdict, passed: false } });
    assert.equal(signed.length, 0);
    assert.equal(assessmentPut(), undefined);
    assert.equal(trailPut()?.Item.outcome, 'dropped');
  });
});
