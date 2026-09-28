import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';

// Runs the real Alerts handler with fake DynamoDB and SES clients. See
// services/analyst/src/handler.test.ts for how the bundle works.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'alerts-handler.mjs');

type Item = Record<string, unknown>;
let user: Item | null;
const sent: string[] = [];
const recorded: Item[] = [];

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
    AWS_REGION: 'us-east-1',
  });
  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    if (cmd instanceof GetCommand && cmd.input.TableName === 'users') return { Item: user ?? undefined };
    if (cmd instanceof GetCommand && cmd.input.TableName === 'briefs') return { Item: { subject: 'S', bodyMarkdown: 'B' } };
    if (cmd instanceof PutCommand) {
      recorded.push(cmd.input.Item as Item);
      return {};
    }
    throw new Error(`unexpected command ${cmd.constructor.name}`);
  };
  (SESv2Client.prototype as { send: unknown }).send = async (cmd: { input: { Destination: { ToAddresses: string[] } } }) => {
    sent.push(cmd.input.Destination.ToAddresses[0]);
    return { MessageId: 'm-1' };
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
  user = { rcicId: 'R1', email: 'consultant@example.ca', active: true };
});

describe('Alerts honours the real-time email preference', () => {
  it('sends when the consultant has no preferences stored', async () => {
    assert.deepEqual(await fire(), { dispatched: true });
    assert.deepEqual(sent, ['consultant@example.ca']);
    assert.equal(recorded.length, 1);
  });

  it('sends nothing and records nothing when real-time email is off', async () => {
    user!.preferences = { realtimeAlerts: false, policyDomains: { pgp: false } };
    assert.deepEqual(await fire(), { dispatched: false, reason: 'realtime-alerts-off' });
    assert.deepEqual(sent, []);
    assert.equal(recorded.length, 0);
  });

  it('only an explicit false turns it off', async () => {
    for (const realtimeAlerts of [true, 'false', 0, null]) {
      sent.length = 0;
      user!.preferences = { realtimeAlerts };
      assert.equal((await fire()).dispatched, true, JSON.stringify(realtimeAlerts));
    }
  });
});
