import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';

// Runs the real Recall handler against in-memory tables. See the Analyst's
// handler.test.ts for how the bundle and the fake SDK clients work. Every
// triage returns false here, so each eligible (rule, client) pair is triaged
// and the list of triaged pairs is exactly what Recall considered.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'recall-handler.mjs');

type Item = Record<string, unknown>;
const users: Item[] = [];
const profiles: Item[] = [];
const rules: Item[] = [
  { rule_hash: 'h-ee', policy_domain: 'express-entry', topic: 'ee-draws', rule_kind: 'page', captured_at: '2026-09-27T00:00:00Z' },
  { rule_hash: 'h-pgp', policy_domain: 'pgp', topic: 'pgp-intake', rule_kind: 'page', captured_at: '2026-09-27T00:00:00Z' },
  { rule_hash: 'h-gen', policy_domain: 'general', topic: 'fees', rule_kind: 'page', captured_at: '2026-09-27T00:00:00Z' },
];
const triaged: string[] = [];

type Handler = () => Promise<{ pairsTriaged: number }>;
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
    CLIENT_PROFILES_TABLE: 'profiles',
    IMPACT_ASSESSMENTS_TABLE: 'assessments',
    RCIC_USERS_TABLE: 'users',
    BEDROCK_TRIAGE_MODEL: 'us.test-model',
    AWS_REGION: 'us-east-1',
  });

  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input;
    if (cmd instanceof ScanCommand && input.TableName === 'users') return { Items: users.map((u) => project(u, input)) };
    if (cmd instanceof ScanCommand && input.TableName === 'rules') return { Items: rules };
    if (cmd instanceof QueryCommand && input.TableName === 'profiles') {
      const rcicId = (input.ExpressionAttributeValues as Item)[':r'];
      return { Items: profiles.filter((p) => p.rcicId === rcicId) };
    }
    if (cmd instanceof QueryCommand && input.TableName === 'assessments') return { Items: [] };
    throw new Error(`unexpected command ${cmd.constructor.name} on ${String(input.TableName)}`);
  };
  (BedrockRuntimeClient.prototype as { send: unknown }).send = async (cmd: ConverseCommand) => {
    const texts = (cmd.input.messages ?? [])
      .flatMap((m) => m.content ?? [])
      .flatMap((b) => (b.guardContent && 'text' in b.guardContent && b.guardContent.text?.text ? [b.guardContent.text.text] : []));
    const joined = texts.join('\n');
    const topic = /"topic": "([^"]+)"/.exec(joined)?.[1];
    const clientId = /"clientId": "([^"]+)"/.exec(joined)?.[1];
    triaged.push(`${topic}:${clientId}`);
    return {
      stopReason: 'end_turn',
      output: { message: { role: 'assistant', content: [{ text: '{"deserves_analysis":false,"rationale":"test"}' }] } },
    };
  };
  (EventBridgeClient.prototype as { send: unknown }).send = async () => {
    throw new Error('Recall should not emit when every triage says no');
  };

  const origLog = console.log;
  console.log = () => {};
  try {
    handler = (await import(outfile)).handler as Handler;
  } finally {
    console.log = origLog;
  }
});

/** Applies the ProjectionExpression the way DynamoDB would, so a projection that forgets `preferences` loses it. */
function project(item: Item, input: Item): Item {
  const expr = input.ProjectionExpression;
  if (typeof expr !== 'string') return { ...item };
  const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
  const out: Item = {};
  for (const part of expr.split(',').map((p) => p.trim())) {
    const attr = names[part] ?? part;
    if (attr in item) out[attr] = item[attr];
  }
  return out;
}

async function run() {
  triaged.length = 0;
  const origLog = console.log;
  console.log = () => {};
  try {
    await handler();
  } finally {
    console.log = origLog;
  }
  return triaged.slice().sort();
}

beforeEach(() => {
  users.length = 0;
  profiles.length = 0;
  users.push(
    { rcicId: 'R1', active: true, preferences: { policyDomains: { 'express-entry': false } } },
    { rcicId: 'R2', active: true },
    { rcicId: 'R3', active: false },
  );
  profiles.push(
    { rcicId: 'R1', clientId: 'R1-EE', program: 'express-entry', status: 'active' },
    { rcicId: 'R1', clientId: 'R1-PGP', program: 'pgp', status: 'active' },
    { rcicId: 'R2', clientId: 'R2-EE', program: 'express-entry', status: 'active' },
    { rcicId: 'R2', clientId: 'R2-EE-CLOSED', program: 'express-entry', status: 'closed' },
    { rcicId: 'R2', clientId: 'R2-PGP-CLOSED', program: 'pgp', status: 'closed' },
    { rcicId: 'R3', clientId: 'R3-EE', program: 'express-entry', status: 'active' },
  );
});

describe('Recall honours preferences and client status', () => {
  it('never triages closed clients or areas a consultant turned off', async () => {
    assert.deepEqual(await run(), ['ee-draws:R2-EE', 'fees:R1-PGP', 'fees:R2-EE', 'pgp-intake:R1-PGP']);
  });

  it('triages the area again once it is back on', async () => {
    users[0].preferences = { policyDomains: { 'express-entry': true } };
    assert.deepEqual(await run(), ['ee-draws:R1-EE', 'ee-draws:R2-EE', 'fees:R1-EE', 'fees:R1-PGP', 'fees:R2-EE', 'pgp-intake:R1-PGP']);
  });

  it('a reopened client is triaged again', async () => {
    profiles.find((p) => p.clientId === 'R2-EE-CLOSED')!.status = 'active';
    assert.ok((await run()).includes('ee-draws:R2-EE-CLOSED'));
  });
});
