import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';
import { applyUpdate, evaluateCondition } from './fake-expressions.ts';

// Runs the real Alerts handler with fake DynamoDB and SES clients. See
// services/analyst/src/handler.test.ts for how the bundle works. The brief
// row is stored, and UpdateCommand conditions are evaluated against it, so
// the claim logic runs the way DynamoDB would run it.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'alerts-handler.mjs');

const LEASE_SECONDS = 60;

type Item = Record<string, unknown>;
let user: Item | null;
let brief: Item | undefined;
const sent: string[] = [];
const recorded: Item[] = [];
// Failure switches for the steps after the claim.
let sesFails: boolean;
let markFails: boolean;
let recordFails: boolean;
// Lets a test hold SES open, to run a second delivery mid-send.
let sesGate: Promise<void> | null;

type Handler = (event: unknown) => Promise<{ dispatched: boolean; reason?: string }>;
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
    BRIEFS_TABLE: 'briefs',
    ALERTS_TABLE: 'alerts',
    RCIC_USERS_TABLE: 'users',
    SES_FROM_EMAIL: 'alerts@example.ca',
    DEMO_RCIC_EMAIL: '',
    ALERT_CLAIM_LEASE_SECONDS: String(LEASE_SECONDS),
    AWS_REGION: 'us-east-1',
  });
  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input as { TableName: string; Item?: Item; UpdateExpression?: string; ConditionExpression?: string; ExpressionAttributeValues?: Item };
    if (cmd instanceof GetCommand && input.TableName === 'users') return { Item: user ?? undefined };
    if (cmd instanceof GetCommand && input.TableName === 'briefs') return { Item: brief ? { ...brief } : undefined };
    if (cmd instanceof UpdateCommand && input.TableName === 'briefs') {
      if (markFails && /alertSentAt = /.test(input.UpdateExpression ?? '')) throw Object.assign(new Error('mark failed'), { name: 'InternalServerError' });
      const values = input.ExpressionAttributeValues ?? {};
      if (input.ConditionExpression && !evaluateCondition(input.ConditionExpression, brief, values)) {
        throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
      }
      if (!brief) throw new Error('update on a missing brief without a condition');
      applyUpdate(input.UpdateExpression ?? '', brief, values);
      return {};
    }
    if (cmd instanceof PutCommand && input.TableName === 'alerts') {
      if (recordFails) throw Object.assign(new Error('record failed'), { name: 'InternalServerError' });
      recorded.push(input.Item as Item);
      return {};
    }
    throw new Error(`unexpected command ${cmd.constructor.name} on ${input.TableName}`);
  };
  (SESv2Client.prototype as { send: unknown }).send = async (cmd: { input: { Destination: { ToAddresses: string[] } } }) => {
    if (sesGate) await sesGate;
    if (sesFails) throw Object.assign(new Error('SES throttled'), { name: 'TooManyRequestsException' });
    sent.push(cmd.input.Destination.ToAddresses[0]);
    return { MessageId: `m-${sent.length}` };
  };
  const origLog = console.log;
  console.log = () => {};
  try {
    handler = (await import(outfile)).handler as Handler;
  } finally {
    console.log = origLog;
  }
});

async function fire() {
  const origLog = console.log;
  console.log = () => {};
  try {
    return await handler({
      detail: { briefId: 'b1', rcicId: 'R1', clientId: 'C1', assessmentKey: 'e1#C1', impactType: 'eligibility-flip', numericDelta: null, confidence: 'high', subject: 'S', createdAt: '2026-09-28T00:00:00Z' },
    });
  } finally {
    console.log = origLog;
  }
}

beforeEach(() => {
  sent.length = 0;
  recorded.length = 0;
  sesFails = false;
  markFails = false;
  recordFails = false;
  sesGate = null;
  user = { rcicId: 'R1', email: 'consultant@example.ca', active: true };
  brief = { rcicId: 'R1', briefId: 'b1', subject: 'S', bodyMarkdown: 'B' };
});

describe('Alerts honours the real-time email preference', () => {
  it('sends when the consultant has no preferences stored', async () => {
    assert.deepEqual(await fire(), { dispatched: true });
    assert.deepEqual(sent, ['consultant@example.ca']);
    assert.equal(recorded.length, 1);
  });

  it('sends nothing, records nothing and claims nothing when real-time email is off', async () => {
    user!.preferences = { realtimeAlerts: false, policyDomains: { pgp: false } };
    assert.deepEqual(await fire(), { dispatched: false, reason: 'realtime-alerts-off' });
    assert.deepEqual(sent, []);
    assert.equal(recorded.length, 0);
    assert.equal(brief!.alertClaimedAt, undefined);
  });

  it('only an explicit false turns it off', async () => {
    for (const realtimeAlerts of [true, 'false', 0, null]) {
      sent.length = 0;
      brief = { rcicId: 'R1', briefId: 'b1', subject: 'S', bodyMarkdown: 'B' };
      user!.preferences = { realtimeAlerts };
      assert.equal((await fire()).dispatched, true, JSON.stringify(realtimeAlerts));
    }
  });
});

describe('Alerts sends one email per brief', () => {
  it('a second BriefReady for a brief already emailed sends nothing', async () => {
    assert.deepEqual(await fire(), { dispatched: true });
    assert.deepEqual(await fire(), { dispatched: false, reason: 'already-sent' });
    assert.equal(sent.length, 1);
    assert.equal(recorded.length, 1);
    assert.equal(brief!.alertSesMessageId, 'm-1');
  });

  it('a brief emailed long ago stays sent after its claim lease runs out', async () => {
    brief!.alertClaimId = 'old-run';
    brief!.alertClaimedAt = Date.now() - LEASE_SECONDS * 1000 * 100;
    brief!.alertSentAt = '2026-09-01T00:00:00.000Z';
    assert.deepEqual(await fire(), { dispatched: false, reason: 'already-sent' });
    assert.equal(sent.length, 0);
  });

  it('two deliveries at once send one email, and the loser retries into already-sent', async () => {
    let open!: () => void;
    sesGate = new Promise((r) => (open = r));
    const first = fire();
    // Let the first delivery claim and park inside SES.
    await new Promise((r) => setImmediate(r));
    await assert.rejects(fire(), /in flight/);
    open();
    assert.deepEqual(await first, { dispatched: true });
    // Lambda's retry of the loser.
    assert.deepEqual(await fire(), { dispatched: false, reason: 'already-sent' });
    assert.equal(sent.length, 1);
  });

  it('a failed send frees the claim so the retry sends', async () => {
    sesFails = true;
    await assert.rejects(fire(), /SES throttled/);
    assert.equal(sent.length, 0);
    assert.equal(brief!.alertClaimId, undefined);
    assert.equal(recorded.length, 0);

    sesFails = false;
    assert.deepEqual(await fire(), { dispatched: true });
    assert.equal(sent.length, 1);
  });

  it('takes over a claim left by a crashed delivery once the lease runs out', async () => {
    brief!.alertClaimId = 'dead-run';
    brief!.alertClaimedAt = Date.now() - LEASE_SECONDS * 1000 - 1000;
    assert.deepEqual(await fire(), { dispatched: true });
    assert.equal(sent.length, 1);
  });

  it('leaves a live claim alone and asks Lambda to retry', async () => {
    brief!.alertClaimId = 'other-run';
    brief!.alertClaimedAt = Date.now() - 1000;
    await assert.rejects(fire(), /in flight/);
    assert.equal(sent.length, 0);
    assert.equal(brief!.alertClaimId, 'other-run');
  });

  it('once the email is out, a failed mark or record never throws into a retry', async () => {
    markFails = true;
    recordFails = true;
    assert.deepEqual(await fire(), { dispatched: true });
    assert.equal(sent.length, 1);
    // The claim still holds, so a redelivery inside the lease sends nothing.
    markFails = false;
    await assert.rejects(fire(), /in flight/);
    assert.equal(sent.length, 1);
  });

  it('marks the brief sent even when the history row fails', async () => {
    recordFails = true;
    assert.deepEqual(await fire(), { dispatched: true });
    assert.equal(typeof brief!.alertSentAt, 'string');
    assert.deepEqual(await fire(), { dispatched: false, reason: 'already-sent' });
    assert.equal(sent.length, 1);
  });
});
