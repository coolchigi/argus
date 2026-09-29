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
type Request = {
  system: { text: string }[];
  messages: { content: ({ text: string } | { guardContent: { text: { text: string } } })[] }[];
  inferenceConfig: { maxTokens?: number };
  modelId: string;
};
let handler: Handler;
let buildComposeRequest: (assessment: unknown, ruleContent: string) => Request;
let logLines: Record<string, unknown>[] = [];

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

  const mod = await import(outfile);
  handler = mod.handler as Handler;
  buildComposeRequest = mod.buildComposeRequest;
});

beforeEach(() => {
  briefs.length = 0;
  trailRows.length = 0;
  trailFails = false;
  logLines = [];
  modelReply = '{"subject":"Your CRS score changed","bodyMarkdown":"body","suggestedActions":["Retake the test"]}';
});

function assessmentFor(overrides: Item = {}) {
  return {
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
}

function insert(overrides: Item = {}) {
  const assessment = assessmentFor(overrides);
  return { eventID: '1', eventName: 'INSERT', dynamodb: { NewImage: marshall(assessment, { removeUndefinedValues: true }) } };
}

async function compose(records: unknown[]) {
  const origLog = console.log;
  console.log = (line: string) => logLines.push(JSON.parse(line));
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

// Everything the model reads, joined back into one string.
function promptText(req: Request): string {
  const user = req.messages[0].content.map((b) => ('text' in b ? b.text : b.guardContent.text.text)).join('');
  return req.system.map((b) => b.text).join('\n') + '\n' + user;
}

describe('Composer brief voice', () => {
  const pgp = {
    clientId: '2026-042',
    assessmentKey: 'pe1#2026-042',
    topic: 'pgp-intake',
    impactType: 'eligibility-flip',
    numericDelta: null,
    narrative: 'Client 2026-042 cannot submit a new interest to sponsor form while PGP intake is paused.',
    recommendedAction: 'Tell 2026-042 to wait for the next intake.',
  };

  it('tells the model to write to the client in second person and never say "your client"', () => {
    const system = buildComposeRequest(assessmentFor(pgp), 'rule text').system.map((b) => b.text).join('\n');
    assert.match(system, /second person/);
    assert.match(system, /Never write "your client"/);
    assert.match(system, /consultant's voice/);
  });

  it('keeps the client id out of everything the model reads', () => {
    const text = promptText(buildComposeRequest(assessmentFor(pgp), 'rule text'));
    assert.doesNotMatch(text, /2026-042/);
    assert.doesNotMatch(text, /client_id as placeholder/);
    assert.match(text, /the client cannot submit a new interest to sponsor form/);
  });

  it('keeps the guardrail tagging, the us. profile and an explicit maxTokens', () => {
    const req = buildComposeRequest(assessmentFor(pgp), 'rule text');
    const guardedTexts = req.messages[0].content.flatMap((b) => ('guardContent' in b ? [b.guardContent.text.text] : []));
    assert.equal(guardedTexts.length, 2);
    assert.match(guardedTexts[0], /cannot submit a new interest/);
    assert.match(guardedTexts[1], /rule text/);
    assert.match(req.modelId, /^us\./);
    assert.equal(typeof req.inferenceConfig.maxTokens, 'number');
  });

  it('logs a composer-voice-check warning for the live bad draft and still writes the brief', async () => {
    const body =
      'This means that your client, identified as [CLIENT NAME], cannot submit new sponsor applications. ' +
      'As your consultant, I recommend that your client refrains from submitting.';
    modelReply = JSON.stringify({ subject: 'PGP intake paused', bodyMarkdown: body, suggestedActions: ['Wait'] });
    const res = await compose([insert(pgp)]);
    assert.equal(res.composed, 1);
    assert.equal(briefs.length, 1);
    assert.equal(briefs[0].bodyMarkdown, body);
    const warn = logLines.find((l) => l.msg === 'composer-voice-check');
    assert.ok(warn, 'expected a composer-voice-check log line');
    assert.equal(warn.level, 'warn');
    assert.deepEqual(warn.findings, ['your-client']);
    assert.equal(warn.clientId, '2026-042');
  });

  it('logs no voice warning for a draft written to the client', async () => {
    const body = "You can't submit a new interest to sponsor form right now. I recommend we wait for the next intake.";
    modelReply = JSON.stringify({ subject: 'PGP intake paused', bodyMarkdown: body, suggestedActions: ['Wait'] });
    await compose([insert(pgp)]);
    assert.equal(briefs.length, 1);
    assert.equal(logLines.some((l) => l.msg === 'composer-voice-check'), false);
  });
});
