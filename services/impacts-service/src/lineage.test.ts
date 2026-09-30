import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';
import { parseAssessmentKey, summarize, type StepRow } from './lineage.ts';

// The lineage routes run through the real impacts handler against an
// in-memory AuditTrail table that applies the key conditions the way DynamoDB
// does. Rows are in the shape the agents' telemetry.ts writes.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'impacts-lineage-handler.mjs');

type Item = Record<string, unknown>;
const trail: Item[] = [];
const queries: Item[] = [];
// ImpactAssessments rows, for resolving a consultant review to its original.
const assessments: Item[] = [];
const gets: Item[] = [];

type Handler = (event: unknown) => Promise<{ statusCode: number; body: string }>;
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
    IMPACT_ASSESSMENTS_TABLE: 'assessments',
    TRAINING_CORRECTIONS_TABLE: 'argus-training-corrections',
    POLICY_RULES_TABLE: 'rules',
    SIGNING_KEY_ID: 'key',
    BEDROCK_GUARDRAIL_ID: 'gr-test',
    BEDROCK_GUARDRAIL_VERSION: '7',
    AUDIT_TRAIL_TABLE: 'audit-trail',
    BRIEFS_TABLE: 'briefs',
    RCIC_USERS_TABLE: 'users',
    PUBLIC_COUNTERS_TABLE: 'counters',
    AWS_REGION: 'us-east-1',
  });

  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input;
    if (cmd instanceof GetCommand && input.TableName === 'assessments') {
      gets.push(input);
      const k = input.Key as Item;
      return { Item: assessments.find((a) => a.rcicId === k.rcicId && a.assessmentKey === k.assessmentKey) };
    }
    if (!(cmd instanceof QueryCommand) || input.TableName !== 'audit-trail') {
      throw new Error(`unexpected command ${cmd.constructor.name} on ${String(input.TableName)}`);
    }
    queries.push(input);
    const values = input.ExpressionAttributeValues as Item;
    if (input.IndexName === 'byTenantRun') {
      assert.equal(input.KeyConditionExpression, 'tenantRunKey = :k');
      return { Items: trail.filter((r) => r.tenantRunKey === values[':k']) };
    }
    assert.equal(input.IndexName, undefined);
    assert.equal(input.KeyConditionExpression, 'assessmentId = :a');
    return { Items: trail.filter((r) => r.assessmentId === values[':a']) };
  };

  handler = (await import(outfile)).handler as Handler;
});

beforeEach(() => {
  trail.length = 0;
  queries.length = 0;
  assessments.length = 0;
  gets.length = 0;
});

function step(
  scope: { rcicId: string; clientId: string } | 'event',
  runId: string,
  at: string,
  agent: string,
  extra: Item = {},
): Item {
  const base = { stepTimestamp: `${at}#${agent}`, recordedAt: at, policyEventId: runId, agent, modelId: `us.${agent}-model`, durationMs: 1000, outcome: 'ok', ...extra };
  if (scope === 'event') return { assessmentId: `event#${runId}`, ...base };
  return {
    assessmentId: `${scope.rcicId}#${runId}#${scope.clientId}`,
    tenantRunKey: `${scope.rcicId}#${runId}`,
    rcicId: scope.rcicId,
    clientId: scope.clientId,
    ...base,
  };
}

async function get(routeKey: string, id: string, rcicId = 'R1') {
  const origLog = console.log;
  console.log = () => {};
  try {
    const res = await handler({
      routeKey,
      rawPath: routeKey.replace('{id}', encodeURIComponent(id)).replace('GET ', ''),
      pathParameters: { id: encodeURIComponent(id) },
      requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims: { 'custom:rcic_id': rcicId } } } },
    });
    return { status: res.statusCode, body: JSON.parse(res.body) as Item };
  } finally {
    console.log = origLog;
  }
}

const R1 = { rcicId: 'R1', clientId: 'c1' };

describe('GET /impacts/{id}/lineage', () => {
  it('returns every agent that ran, in pipeline order, with the recorded model and duration', async () => {
    trail.push(
      step(R1, 'pe1', '2026-09-29T12:00:05.000Z', 'composer', { durationMs: 1900, outcome: 'drafted' }),
      step(R1, 'pe1', '2026-09-29T12:00:02.000Z', 'analyst', { durationMs: 3100, outcome: 'affected' }),
      step(R1, 'pe1', '2026-09-29T12:00:04.000Z', 'anchor', { modelId: null, durationMs: 200, outcome: 'signed' }),
      step(R1, 'pe1', '2026-09-29T12:00:03.000Z', 'auditor', { durationMs: 2700, outcome: 'passed', fewShotCorrectionKeys: ['pe0#c1#2026-09-01T00:00:00.000Z'] }),
      step('event', 'pe1', '2026-09-29T12:00:00.000Z', 'sentinel', { durationMs: 400, outcome: 'detected' }),
    );
    const { status, body } = await get('GET /impacts/{id}/lineage', 'pe1#c1');
    assert.equal(status, 200);
    const agents = body.agents as Item[];
    assert.deepEqual(agents.map((a) => a.agent), ['sentinel', 'analyst', 'auditor', 'anchor', 'composer']);
    assert.deepEqual(agents.map((a) => a.durationMs), [400, 3100, 2700, 200, 1900]);
    assert.equal(agents[1].modelId, 'us.analyst-model');
    assert.equal(agents[3].modelId, null);
    assert.equal(body.startedAt, '2026-09-29T12:00:00.000Z');
    assert.deepEqual(body.fewShotCorrectionKeys, ['pe0#c1#2026-09-01T00:00:00.000Z']);
  });

  it('never returns another consultant\'s steps for the same client id', async () => {
    trail.push(
      step({ rcicId: 'R2', clientId: 'c1' }, 'pe1', '2026-09-29T12:00:02.000Z', 'analyst'),
      step({ rcicId: 'R2', clientId: 'c1' }, 'pe1', '2026-09-29T12:00:03.000Z', 'auditor', { fewShotCorrectionKeys: ['R2-secret'] }),
      step('event', 'pe1', '2026-09-29T12:00:00.000Z', 'sentinel'),
    );
    const { status, body } = await get('GET /impacts/{id}/lineage', 'pe1#c1', 'R1');
    assert.equal(status, 200);
    assert.deepEqual(body.agents, []);
    assert.deepEqual(body.fewShotCorrectionKeys, []);
    assert.equal(body.startedAt, null);
    // The partition it read starts with the caller's own rcicId.
    assert.equal((queries[0].ExpressionAttributeValues as Item)[':a'], 'R1#pe1#c1');
  });

  it('reads as empty for an assessment signed before telemetry', async () => {
    const { status, body } = await get('GET /impacts/{id}/lineage', 'pe-old#c1');
    assert.equal(status, 200);
    assert.deepEqual(body.agents, []);
  });

  it('rejects a key that is not eventId#clientId', async () => {
    const { status } = await get('GET /impacts/{id}/lineage', 'no-hash');
    assert.equal(status, 400);
  });

  it('refuses a token with no tenant claim', async () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      const res = await handler({
        routeKey: 'GET /impacts/{id}/lineage',
        rawPath: '/impacts/pe1%23c1/lineage',
        pathParameters: { id: 'pe1%23c1' },
        requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims: {} } } },
      });
      assert.equal(res.statusCode, 403);
    } finally {
      console.log = origLog;
    }
    assert.equal(queries.length, 0);
  });
});

describe('GET /impacts/{id}/lineage for a consultant review (ADR-0004)', () => {
  const REVIEW = 'review-1727600000000-pe1#c1';
  const REVIEW2 = 'review-1727700000000-pe1#c1';
  const fullRun = () =>
    trail.push(
      step('event', 'pe1', '2026-09-29T12:00:00.000Z', 'sentinel'),
      step(R1, 'pe1', '2026-09-29T12:00:02.000Z', 'analyst'),
      step(R1, 'pe1', '2026-09-29T12:00:04.000Z', 'anchor', { modelId: null }),
    );

  it('returns the lineage of the agent assessment the review replaced, and says so', async () => {
    assessments.push({ rcicId: 'R1', assessmentKey: REVIEW, recordKind: 'consultant-review', supersedes: 'pe1#c1' });
    fullRun();
    const { status, body } = await get('GET /impacts/{id}/lineage', REVIEW);
    assert.equal(status, 200);
    assert.equal(body.assessmentKey, REVIEW);
    assert.equal(body.reviewOf, 'pe1#c1');
    assert.equal(body.policyEventId, 'pe1');
    assert.deepEqual((body.agents as Item[]).map((a) => a.agent), ['sentinel', 'analyst', 'anchor']);
    assert.deepEqual(gets.map((g) => g.Key), [{ rcicId: 'R1', assessmentKey: REVIEW }]);
    assert.ok(queries.some((q) => (q.ExpressionAttributeValues as Item)[':a'] === 'R1#pe1#c1'));
  });

  it('follows a review of a review back to the agent assessment', async () => {
    assessments.push(
      { rcicId: 'R1', assessmentKey: REVIEW, recordKind: 'consultant-review', supersedes: 'pe1#c1' },
      { rcicId: 'R1', assessmentKey: REVIEW2, recordKind: 'consultant-review', supersedes: REVIEW },
    );
    fullRun();
    const { body } = await get('GET /impacts/{id}/lineage', REVIEW2);
    assert.equal(body.reviewOf, 'pe1#c1');
    assert.equal((body.agents as Item[]).length, 3);
  });

  it("is a 404 for another consultant's review, read only in the caller's partition", async () => {
    assessments.push({ rcicId: 'R2', assessmentKey: REVIEW, recordKind: 'consultant-review', supersedes: 'pe1#c1' });
    fullRun();
    const { status } = await get('GET /impacts/{id}/lineage', REVIEW, 'R1');
    assert.equal(status, 404);
    assert.deepEqual(gets.map((g) => (g.Key as Item).rcicId), ['R1']);
    assert.equal(queries.length, 0);
  });

  it('sets reviewOf to null for an agent assessment and reads no assessment row', async () => {
    fullRun();
    const { body } = await get('GET /impacts/{id}/lineage', 'pe1#c1');
    assert.equal(body.reviewOf, null);
    assert.equal(gets.length, 0);
  });
});

describe('GET /policy-events/{id}/lineage', () => {
  it('folds a run across clients: count, median duration and outcomes, own tenant only', async () => {
    const c = (clientId: string) => ({ rcicId: 'R1', clientId });
    trail.push(
      step('event', 'pe1', '2026-09-29T12:00:00.000Z', 'sentinel', { durationMs: 400 }),
      step(c('c1'), 'pe1', '2026-09-29T12:00:02.000Z', 'analyst', { durationMs: 3000, outcome: 'affected' }),
      step(c('c2'), 'pe1', '2026-09-29T12:00:05.000Z', 'analyst', { durationMs: 1000, outcome: 'not-affected' }),
      step(c('c3'), 'pe1', '2026-09-29T12:00:08.000Z', 'analyst', { durationMs: 2000, outcome: 'affected' }),
      step(c('c1'), 'pe1', '2026-09-29T12:00:04.000Z', 'auditor', { outcome: 'passed' }),
      step({ rcicId: 'R2', clientId: 'c9' }, 'pe1', '2026-09-29T12:00:03.000Z', 'analyst', { durationMs: 99000 }),
    );
    const { status, body } = await get('GET /policy-events/{id}/lineage', 'pe1');
    assert.equal(status, 200);
    const analyst = (body.agents as Item[]).find((a) => a.agent === 'analyst');
    assert.equal(analyst?.count, 3);
    assert.equal(analyst?.durationMs, 2000);
    assert.deepEqual(analyst?.outcomes, { affected: 2, 'not-affected': 1 });
    assert.equal(queries[0].IndexName, 'byTenantRun');
    assert.equal((queries[0].ExpressionAttributeValues as Item)[':k'], 'R1#pe1');
  });

  it('hides the event steps from a consultant with no step in the run', async () => {
    trail.push(step('event', 'pe1', '2026-09-29T12:00:00.000Z', 'sentinel'));
    const { body } = await get('GET /policy-events/{id}/lineage', 'pe1', 'R1');
    assert.deepEqual(body.agents, []);
  });
});

describe('summarize', () => {
  it('counts a retried step once, keeping the latest row', () => {
    const rows: StepRow[] = [
      step(R1, 'pe1', '2026-09-29T12:00:03.000Z', 'auditor', { outcome: 'failed', durationMs: 500 }),
      step(R1, 'pe1', '2026-09-29T12:00:09.000Z', 'auditor', { outcome: 'passed', durationMs: 2500, fewShotCorrectionKeys: ['k2'] }),
    ];
    const out = summarize(rows, { scope: 'assessment', policyEventId: 'pe1', assessmentKey: 'pe1#c1' });
    assert.equal(out.agents.length, 1);
    assert.deepEqual(out.agents[0].outcomes, { passed: 1 });
    assert.equal(out.agents[0].durationMs, 2500);
    assert.deepEqual(out.fewShotCorrectionKeys, ['k2']);
    assert.equal(out.startedAt, '2026-09-29T12:00:03.000Z');
  });

  it('drops rows with an unknown agent or no timestamp', () => {
    const out = summarize(
      [{ agent: 'orchestrator', stepTimestamp: '2026-09-29T12:00:00.000Z#orchestrator' }, { agent: 'analyst' }],
      { scope: 'assessment', policyEventId: 'pe1', assessmentKey: 'pe1#c1' },
    );
    assert.deepEqual(out.agents, []);
  });
});

describe('parseAssessmentKey', () => {
  it('splits at the first #, since a policyEventId never holds one', () => {
    assert.deepEqual(parseAssessmentKey('1759140000000-ab12cd34#C#7'), { policyEventId: '1759140000000-ab12cd34', clientId: 'C#7' });
    assert.equal(parseAssessmentKey('#c1'), null);
    assert.equal(parseAssessmentKey('pe1#'), null);
  });
});
