import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';

// Runs the real Analyst handler against in-memory tables. The handler is
// bundled with esbuild (the same tool CDK uses) with the AWS SDK left
// external, so the SDK clients here are the ones the handler uses and their
// send() can be swapped for fakes. Nothing reaches AWS.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'analyst-handler.mjs');

type Item = Record<string, unknown>;
const users: Item[] = [];
const profiles: Item[] = [];
const reasoned: string[] = [];
const emitted: string[] = [];
const trailRows: Item[] = [];
let trailFails = false;
let failClient: string | null = null;
const guardedTexts: string[] = [];
const emittedDetails: Item[] = [];
const systemPrompts: string[] = [];
let ruleRowExtra: Item = {};

type Handler = (event: unknown) => Promise<{ hypothesesEmitted: number }>;
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
    CLIENT_PROFILES_TABLE: 'profiles',
    POLICY_RULES_TABLE: 'rules',
    RCIC_USERS_TABLE: 'users',
    BEDROCK_REASONER_MODEL: 'us.test-model',
    AUDIT_TRAIL_TABLE: 'audit-trail',
    AWS_REGION: 'us-east-1',
  });

  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input as Item;
    if (cmd instanceof GetCommand) return { Item: { rule_hash: 'h1', rule_kind: 'page', policy_domain: 'x', topic: 't', summary: 's', rule_content: 'rule text', ...ruleRowExtra } };
    if (cmd instanceof ScanCommand) return { Items: users.map((u) => project(u, input)) };
    if (cmd instanceof BatchGetCommand) {
      const req = (input.RequestItems as Record<string, { Keys: Item[] } & Item>).users;
      const wanted = new Set(req.Keys.map((k) => k.rcicId));
      return { Responses: { users: users.filter((u) => wanted.has(u.rcicId)).map((u) => project(u, req)) } };
    }
    if (cmd instanceof QueryCommand) {
      const rcicId = (input.ExpressionAttributeValues as Item)[':r'];
      return { Items: profiles.filter((p) => p.rcicId === rcicId) };
    }
    if (cmd instanceof PutCommand && input.TableName === 'audit-trail') {
      if (trailFails) throw new Error('ProvisionedThroughputExceededException');
      trailRows.push(input.Item as Item);
      return {};
    }
    throw new Error(`unexpected command ${cmd.constructor.name}`);
  };
  (BedrockRuntimeClient.prototype as { send: unknown }).send = async (cmd: ConverseCommand) => {
    // The client profile rides in a guarded JSON block. Pull its clientId back out.
    systemPrompts.push((cmd.input.system ?? []).flatMap((b) => (typeof b.text === 'string' ? [b.text] : [])).join('\n'));
    const blocks = (cmd.input.messages ?? []).flatMap((m) => m.content ?? []);
    for (const b of blocks) {
      const t = b.guardContent && 'text' in b.guardContent ? b.guardContent.text?.text : undefined;
      if (t) guardedTexts.push(t);
    }
    const ids = blocks.flatMap((b) => {
      const t = b.guardContent && 'text' in b.guardContent ? b.guardContent.text?.text : undefined;
      const m = t ? /"clientId": "([^"]+)"/.exec(t) : null;
      return m ? [m[1]] : [];
    });
    // The profile appears in more than one guarded block. One call is one client.
    reasoned.push(...new Set(ids));
    if (failClient && ids.includes(failClient)) return { stopReason: 'end_turn', output: { message: { role: 'assistant', content: [{ text: 'junk' }] } } };
    return {
      stopReason: 'end_turn',
      output: { message: { role: 'assistant', content: [{ text: '{"isAffected":false,"impactType":"none","confidence":"low"}' }] } },
    };
  };
  (EventBridgeClient.prototype as { send: unknown }).send = async (cmd: { input: { Entries: Array<{ Detail: string }> } }) => {
    const d = JSON.parse(cmd.input.Entries[0].Detail);
    emitted.push(`${d.rcicId}/${d.clientId}`);
    emittedDetails.push(d);
    return {};
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

async function run(policyDomain: string, targetRcicIds?: string[]) {
  reasoned.length = 0;
  emitted.length = 0;
  trailRows.length = 0;
  guardedTexts.length = 0;
  emittedDetails.length = 0;
  const origLog = console.log;
  console.log = () => {};
  try {
    await handler({
      detail: { eventId: 'e1', timestamp: '2026-09-28T00:00:00Z', policyDomain, ruleHash: 'h1', topic: 't', severity: 'high', ...(targetRcicIds ? { targetRcicIds } : {}) },
    });
  } finally {
    console.log = origLog;
  }
  return emitted.slice().sort();
}

beforeEach(() => {
  ruleRowExtra = {};
  trailFails = false;
  failClient = null;
  users.length = 0;
  profiles.length = 0;
  users.push(
    { rcicId: 'R1', active: true, email: 'r1@example.ca', preferences: { policyDomains: { 'express-entry': false }, realtimeAlerts: true } },
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

describe('Analyst honours preferences and client status', () => {
  it('skips a tenant that turned the area off, and closed clients everywhere', async () => {
    assert.deepEqual(await run('express-entry'), ['R2/R2-EE']);
    assert.deepEqual(reasoned.sort(), ['R2-EE']);
  });

  it('keeps the tenant for areas still on', async () => {
    assert.deepEqual(await run('pgp'), ['R1/R1-PGP']);
  });

  it('narrows a cross-program change to open clients in areas that are on', async () => {
    assert.deepEqual(await run('general'), ['R1/R1-PGP', 'R2/R2-EE']);
  });

  it('applies the same rules on a targeted run', async () => {
    assert.deepEqual(await run('express-entry', ['R1', 'R2', 'R3']), ['R2/R2-EE']);
  });

  it('turning the area back on brings the tenant back', async () => {
    (users[0].preferences as Item).policyDomains = { 'express-entry': true };
    assert.deepEqual(await run('express-entry'), ['R1/R1-EE', 'R2/R2-EE']);
  });
});

describe('Analyst step telemetry', () => {
  it('appends one step per client, keyed by tenant, run and client', async () => {
    await run('general');
    const rows = trailRows.map((r) => `${r.assessmentId}|${r.tenantRunKey}|${r.agent}|${r.modelId}|${r.outcome}`).sort();
    assert.deepEqual(rows, [
      'R1#e1#R1-PGP|R1#e1|analyst|us.test-model|not-affected',
      'R2#e1#R2-EE|R2#e1|analyst|us.test-model|not-affected',
    ]);
    assert.ok(trailRows.every((r) => typeof r.durationMs === 'number' && /#analyst$/.test(String(r.stepTimestamp))));
  });

  it('records a dropped client as failed and keeps going', async () => {
    failClient = 'R1-PGP';
    assert.deepEqual(await run('general'), ['R2/R2-EE']);
    const outcomes = Object.fromEntries(trailRows.map((r) => [r.clientId, r.outcome]));
    assert.deepEqual(outcomes, { 'R1-PGP': 'failed', 'R2-EE': 'not-affected' });
  });

  it('still emits every hypothesis when the telemetry write fails', async () => {
    trailFails = true;
    assert.deepEqual(await run('general'), ['R1/R1-PGP', 'R2/R2-EE']);
  });
});

describe('Analyst passes the whole profile on', () => {
  // The permit, sponsor and PR pathway fields were added so the Auditor
  // stops rejecting these cases for thin profiles. A projection or whitelist
  // that drops them would bring the rejections back without failing anything else.
  const extra = {
    pgpSponsorStatus: 'no-interest-form',
    dliType: 'public',
    studyStartDate: '2027-01-11',
    studyPermitAppliedDate: '2024-11-20',
    principalPrPathway: 'none',
    principalPrApplied: false,
  };

  it('shows the new fields to the model and forwards them to the Auditor', async () => {
    profiles.push({ rcicId: 'R2', clientId: 'R2-PGP', program: 'pgp', status: 'active', ...extra });
    assert.deepEqual(await run('pgp', ['R2']), ['R2/R2-PGP']);

    const profileBlock = guardedTexts.find((t) => t.includes('"clientId": "R2-PGP"'));
    assert.ok(profileBlock, 'the client profile went to the model');
    for (const [k, v] of Object.entries(extra)) assert.ok(profileBlock.includes(`"${k}": ${JSON.stringify(v)}`), `model prompt is missing ${k}`);

    const forwarded = emittedDetails[0].clientProfile as Item;
    for (const [k, v] of Object.entries(extra)) assert.deepEqual(forwarded[k], v, `hypothesis event is missing ${k}`);
  });
});

describe('Analyst decides isAffected by the shared definition', () => {
  it('puts the definition in the system prompt, identical to the Auditor copy', async () => {
    const { AFFECTED_DEFINITION } = await import('./affected.ts');
    profiles.push({ rcicId: 'R2', clientId: 'R2-A', program: 'pgp', status: 'active' });
    systemPrompts.length = 0;
    assert.deepEqual(await run('pgp', ['R2']), ['R2/R2-A']);
    assert.equal(systemPrompts.length, 1);
    assert.ok(systemPrompts[0].includes(AFFECTED_DEFINITION), 'the definition is in the system prompt');
    assert.match(AFFECTED_DEFINITION, /new procedural step/);
    const auditorCopy = readFileSync(path.join(here, '..', '..', 'auditor', 'src', 'affected.ts'), 'utf8');
    assert.equal(readFileSync(path.join(here, 'affected.ts'), 'utf8'), auditorCopy, 'the Analyst and Auditor copies have drifted');
  });
});

// Real wording from IRCC's job offer page as captured Oct 16 2026 (rule
// d3fd0668). The academic bullet is older text the change left in place, and it
// reached a client email as advice to confirm an exemption (brief 88d1df46).
const PAGE_WITH_OLDER_TEXT = [
  '## Job offer basics',
  '### Changes to how we assess jobs offers',
  "As of November 3, 2026, we're changing how we assess job offers under Express Entry:",
  "- you don't need a Labour Market Impact Assessment (LMIA) for a job offer to qualify",
  "- During this time we'll pause invitation rounds and will start again when it's complete.",
  '## Who needs an LMIA',
  '- academics (researchers, lecturers, and professors) under a recognized federal program',
].join('\n');
const CHANGED_LINES = [
  'CHANGES TO THIS IRCC PAGE',
  'Page: https://www.canada.ca/x',
  'Detected: 2026-10-16',
  '',
  'LINES ADDED TO THE PAGE',
  'Section: Job offer basics > Changes to how we assess jobs offers',
  "As of November 3, 2026, we're changing how we assess job offers under Express Entry:",
  "- you don't need a Labour Market Impact Assessment (LMIA) for a job offer to qualify",
  "- During this time we'll pause invitation rounds and will start again when it's complete.",
  '',
  'LINES REMOVED FROM THE PAGE',
  'Section: Job offer basics',
  'We no longer give points for job offers',
].join('\n');

describe('Analyst reads what changed on the page', () => {
  const delta = {
    eventId: 'e1', timestamp: '2026-10-16T15:40:23.000Z', policyDomain: 'express-entry', sourceUrl: 'https://www.canada.ca/x',
    category: 'policy-page-change', severity: 'high', summary: 's', topic: 't', ruleKind: 'procedural',
    ruleHash: 'h1', previousHash: 'h0', newHash: 'h1', s3Key: 'k', contentLengthDelta: 1,
  };
  const rule = { rule_hash: 'h1', rule_kind: 'procedural', policy_domain: 'express-entry', topic: 't', summary: 's', rule_content: PAGE_WITH_OLDER_TEXT };
  const client = { rcicId: 'R1', clientId: 'C-103', notes: 'researcher, university appointment' };

  it('sends the changed lines only, so older text left on the page cannot become advice', async () => {
    const { buildReasonRequest } = await import(outfile);
    const req = buildReasonRequest(delta, { ...rule, rule_changes: { text: CHANGED_LINES } }, client);
    const sent = JSON.stringify(req);
    assert.doesNotMatch(sent, /recognized federal program/);
    assert.match(sent, /you don't need a Labour Market Impact Assessment/);
    assert.match(sent, /Added, moved and removed lines are all part of the change/);
  });

  it('keeps removed lines out of the guardrail grounding source, so old text cannot score as grounded', async () => {
    const { buildReasonRequest } = await import(outfile);
    const req = buildReasonRequest(delta, { ...rule, rule_changes: { text: CHANGED_LINES } }, client);
    const blocks = req.messages[0].content.flatMap((b: { guardContent?: { text?: { text: string; qualifiers?: string[] } } }) => (b.guardContent?.text ? [b.guardContent.text] : []));
    const grounding = blocks.filter((t: { qualifiers?: string[] }) => t.qualifiers?.includes('grounding_source')).map((t: { text: string }) => t.text).join('\n');
    assert.match(grounding, /you don't need a Labour Market Impact Assessment/);
    assert.doesNotMatch(grounding, /We no longer give points/);
  });

  it('falls back to the whole page, with no reading rule, on a row captured before changes were stored', async () => {
    const { buildReasonRequest } = await import(outfile);
    const sent = JSON.stringify(buildReasonRequest(delta, rule, client));
    assert.match(sent, /recognized federal program/);
    assert.doesNotMatch(sent, /Added, moved and removed lines are all part of the change/);
  });

  it('says it read the whole page search, so being off a list is not inferred from one added row', async () => {
    const { buildReasonRequest } = await import(outfile);
    const row = { ...rule, rule_content: 'NOC | Title\n41220 | Teachers\n99999 | New', rule_changes: { text: CHANGED_LINES } };
    const sent = JSON.stringify(buildReasonRequest(delta, row, { ...client, nocCode: '41220' }));
    assert.match(sent, /OTHER PAGE TEXT THAT MENTIONS THIS CLIENT/);
    assert.match(sent, /41220 \| Teachers/);
    assert.match(sent, /missing from these lines is not a finding/);
  });

  it('flags the client for a manual check when the model only saw part of a very long change', async () => {
    const long = Array.from({ length: 800 }, (_, i) => `new line ${i} with padding text to fill out the page`).join('\n');
    ruleRowExtra = { rule_changes: { text: `${CHANGED_LINES.split('\nLINES REMOVED')[0]}\n${long}\n\nLINES REMOVED FROM THE PAGE\n(none)` } };
    await run('express-entry');
    const hyp = emittedDetails.find((d) => d.clientId === 'R2-EE') as { isAffected: boolean; confidence: string; narrative: string };
    assert.equal(hyp.isAffected, true, 'the fake model said not affected');
    assert.equal(hyp.confidence, 'low');
    assert.match(hyp.narrative, /needs a manual check/);
  });

  it('keeps the model answer when it saw the whole change', async () => {
    ruleRowExtra = { rule_changes: { text: CHANGED_LINES } };
    await run('express-entry');
    assert.equal((emittedDetails.find((d) => d.clientId === 'R2-EE') as { isAffected: boolean }).isAffected, false);
  });

  it('keeps one copy of rule-input.ts across the three agents, using the header Sentinel writes', async () => {
    const mine = readFileSync(path.join(here, 'rule-input.ts'), 'utf8');
    for (const svc of ['auditor', 'composer']) {
      assert.equal(mine, readFileSync(path.join(here, '..', '..', svc, 'src', 'rule-input.ts'), 'utf8'), `the Analyst and ${svc} copies have drifted`);
    }
    const sentinel = readFileSync(path.join(here, '..', '..', 'sentinel', 'src', 'changes.ts'), 'utf8');
    for (const name of ['CHANGES_HEADER', 'ADDED_HEADER', 'REMOVED_HEADER', 'PARTIAL_MARK']) {
      const value = new RegExp(`export const ${name} = '([^']+)'`).exec(mine)?.[1];
      assert.ok(value, `${name} is exported from rule-input.ts`);
      assert.ok(sentinel.includes(`export const ${name} = '${value}'`), `Sentinel writes the same ${name}`);
    }
  });
});
