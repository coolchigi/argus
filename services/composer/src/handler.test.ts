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
import { PGP_042_ACTIONS, PGP_042_ASSESSMENT, PGP_042_BODY, PGP_RULE_CONTENT } from './fixtures.pgp-042.ts';

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
let ruleContent = 'rule text';
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
    if (cmd instanceof GetCommand) return { Item: { rule_hash: 'h1', rule_content: ruleContent, severity: 'high' } };
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
  ruleContent = 'rule text';
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
    assert.match(guardedTexts[0], /rule text/);
    assert.match(guardedTexts[1], /cannot submit a new interest/);
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

  for (const [label, reply] of [
    ['no subject', { bodyMarkdown: 'You can wait.', suggestedActions: ['Wait'] }],
    ['a blank subject', { subject: '  ', bodyMarkdown: 'You can wait.', suggestedActions: ['Wait'] }],
    ['a null subject', { subject: null, bodyMarkdown: 'You can wait.', suggestedActions: ['Wait'] }],
  ] as const) {
    it(`falls back to a neutral subject with no client id when the model returns ${label}`, async () => {
      modelReply = JSON.stringify(reply);
      await compose([insert(pgp)]);
      assert.equal(briefs.length, 1);
      const subject = String(briefs[0].subject);
      assert.equal(subject, 'An immigration policy update that affects your file');
      assert.doesNotMatch(subject, /2026-042/);
    });
  }

  for (const [label, reply] of [
    ['no body', { subject: 'PGP intake paused' }],
    ['a blank body', { subject: 'PGP intake paused', bodyMarkdown: ' \n ' }],
    ['a null body', { subject: 'PGP intake paused', bodyMarkdown: null, suggestedActions: null }],
  ] as const) {
    it(`falls back to the Analyst text without the client id when the model returns ${label}`, async () => {
      modelReply = JSON.stringify(reply);
      await compose([insert(pgp)]);
      assert.equal(briefs.length, 1);
      const body = String(briefs[0].bodyMarkdown);
      assert.equal(body, 'the client cannot submit a new interest to sponsor form while PGP intake is paused.');
      assert.doesNotMatch(body, /2026-042/);
      const actions = briefs[0].suggestedActions as string[];
      if (!('suggestedActions' in reply) || reply.suggestedActions === null) {
        assert.deepEqual(actions, ['Tell the client to wait for the next intake.']);
      }
      assert.doesNotMatch(actions.join(' '), /2026-042/);
      assert.equal(logLines.some((l) => l.msg === 'composer-voice-check'), false);
    });
  }

  it('logs no voice warning for a draft written to the client', async () => {
    const body = "You can't submit a new interest to sponsor form right now. I recommend we wait for the next intake.";
    modelReply = JSON.stringify({ subject: 'PGP intake paused', bodyMarkdown: body, suggestedActions: ['Wait'] });
    await compose([insert(pgp)]);
    assert.equal(briefs.length, 1);
    assert.equal(logLines.some((l) => l.msg === 'composer-voice-check'), false);
  });
});

describe('Composer grounding', () => {
  const live = {
    clientId: PGP_042_ASSESSMENT.clientId,
    assessmentKey: `pe1#${PGP_042_ASSESSMENT.clientId}`,
    topic: 'pgp-program-pause',
    impactType: 'procedural',
    numericDelta: null,
    narrative: PGP_042_ASSESSMENT.narrative,
    recommendedAction: PGP_042_ASSESSMENT.recommendedAction,
    citationSourceUrl: PGP_042_ASSESSMENT.citationSourceUrl,
  };
  const liveReply = JSON.stringify({ subject: 'PGP intake paused', bodyMarkdown: PGP_042_BODY, suggestedActions: PGP_042_ACTIONS });

  it('tells the model to state IRCC facts only from the rule content or the assessment', () => {
    const system = buildComposeRequest(assessmentFor(live), PGP_RULE_CONTENT).system.map((b) => b.text).join('\n');
    assert.match(system, /must come from the rule content or the assessment/);
    assert.match(system, /Name another program, visa or permit only if the rule content or the assessment names it/);
    assert.match(system, /Never write "the rule", "the assessment"/);
  });

  it('logs no grounding warning for the live 2026-042 brief against its real rule, and flags "the rule" as a voice slip', async () => {
    ruleContent = PGP_RULE_CONTENT;
    modelReply = liveReply;
    await compose([insert(live)]);
    assert.equal(briefs.length, 1);
    assert.equal(logLines.some((l) => l.msg === 'composer-grounding-check'), false);
    const voice = logLines.find((l) => l.msg === 'composer-voice-check');
    assert.deepEqual(voice?.findings, ['internal-term']);
  });

  it('warns on specifics no source gives, keeps the brief, and logs neither the client id nor the brief text', async () => {
    ruleContent = PGP_RULE_CONTENT.split('\n\n').filter((p) => !p.includes('super visa')).join('\n\n');
    modelReply = liveReply;
    await compose([
      insert({
        ...live,
        narrative: 'Client 2026-042 cannot submit a new PGP interest to sponsor form under the current intake pause.',
        recommendedAction: 'Advise 2026-042 to await IRCC notice of intake resumption.',
      }),
    ]);
    assert.equal(briefs.length, 1);
    assert.equal(briefs[0].bodyMarkdown, PGP_042_BODY);
    const warn = logLines.find((l) => l.msg === 'composer-grounding-check');
    assert.ok(warn, 'expected a composer-grounding-check log line');
    assert.equal(warn.level, 'warn');
    assert.deepEqual(warn.findings, [
      { kind: 'duration', value: '5 years' },
      { kind: 'duration', value: '10 years' },
      { kind: 'program', value: 'super visa' },
    ]);
    assert.equal(warn.briefId, briefs[0].briefId);
    assert.equal(warn.ruleHash, 'h1');
    const line = JSON.stringify(warn);
    assert.doesNotMatch(line, /2026-042/);
    assert.doesNotMatch(line, /intake|sponsor|Grandparents/);
  });

  // Brief 9aa15dff (2026-09-30): a consultant review for client 2026-031
  // reached Composer as an INSERT, and the brief gave the client's program
  // start date as the date of IRCC's change. The rule's date is January 1, 2026.
  const review = {
    clientId: '2026-031',
    assessmentKey: 'review-1790751985760-pe1#2026-031',
    recordKind: 'consultant-review',
    topic: 'pal-tal-requirements',
    impactType: 'procedural',
    numericDelta: null,
    narrative: "Client 2026-031 qualifies for the master's exemption from the PAL/TAL requirement, but must include proof of the exemption with the study permit application.",
    recommendedAction: 'Ask the client to include proof of the exemption with the study permit application.',
    reviewReasoning: "The profile shows 2026-031 has a public DLI and a master's program starting 2027-01-11, so the client qualifies for the exemption.",
    citationSourceUrl: 'https://www.canada.ca/pal',
  };
  const palRule = "You don't need a PAL or TAL for a master's program at a public DLI starting January 1, 2026.";
  const palBrief =
    "IRCC has updated its policy to exempt certain master's programs from the PAL/TAL requirement. This change applies to master's programs at public Designated Learning Institutions (DLIs) starting January 11, 2027.";

  it('gives the model the rule and the reader as separate, labelled, guarded inputs, rule first', () => {
    const req = buildComposeRequest(assessmentFor(review), palRule);
    const blocks = req.messages[0].content;
    const labels = blocks.flatMap((b) => ('text' in b ? [b.text] : []));
    const guardedTexts = blocks.flatMap((b) => ('guardContent' in b ? [b.guardContent.text.text] : []));
    assert.match(labels[0], /^RULE CONTENT .*only source for the policy's dates/);
    assert.match(labels[1], /^ABOUT THE READER .*describe the reader, never the policy/);
    assert.equal(guardedTexts[0].trim(), palRule);
    assert.match(guardedTexts[1], /"narrative": "the client qualifies/);
    const system = req.system.map((b) => b.text).join('\n');
    assert.match(system, /Dates and numbers that describe the policy .* come only from the rule content/);
    assert.match(system, /belong to the reader\. Say them as the reader's own/);
  });

  it("carries a consultant review's reasoning as reader context, without the client id", () => {
    const req = buildComposeRequest(assessmentFor(review), palRule);
    const reader = req.messages[0].content.flatMap((b) => ('guardContent' in b ? [b.guardContent.text.text] : []))[1];
    const json = JSON.parse(reader);
    assert.equal(json.consultantReasoning, "The profile shows the client has a public DLI and a master's program starting 2027-01-11, so the client qualifies for the exemption.");
    assert.match(json.recommendedAction, /include proof of the exemption/);
    assert.doesNotMatch(promptText(req), /2026-031/);
  });

  it('leaves reviewReasoning out of an agent row, where no consultant wrote it', () => {
    const req = buildComposeRequest(assessmentFor({ ...review, recordKind: undefined }), palRule);
    const reader = req.messages[0].content.flatMap((b) => ('guardContent' in b ? [b.guardContent.text.text] : []))[1];
    assert.equal('consultantReasoning' in JSON.parse(reader), false);
    assert.doesNotMatch(promptText(req), /The profile shows/);
  });

  it('warns policy-date-from-client on the live 9aa15dff brief and still writes it', async () => {
    ruleContent = palRule;
    modelReply = JSON.stringify({ subject: 'PAL/TAL exemption', bodyMarkdown: palBrief, suggestedActions: ['Include proof of the exemption.'] });
    const res = await compose([insert(review)]);
    assert.equal(res.composed, 1);
    assert.equal(briefs[0].bodyMarkdown, palBrief);
    const warn = logLines.find((l) => l.msg === 'composer-grounding-check');
    assert.equal(warn?.level, 'warn');
    assert.deepEqual(warn?.findings, [
      { kind: 'program', value: "exempt certain master's program" },
      { kind: 'policy-date-from-client', value: 'january 11, 2027' },
    ]);
    assert.doesNotMatch(JSON.stringify(warn), /2026-031/);
  });

  it("logs no grounding warning when the brief gives the reviewed start date as the reader's", async () => {
    ruleContent = palRule;
    const body =
      "You don't need a PAL or TAL for a master's program at a public DLI starting January 1, 2026. Your program starts January 11, 2027, so this covers you.";
    modelReply = JSON.stringify({ subject: 'PAL/TAL exemption', bodyMarkdown: body, suggestedActions: ['Include proof of the exemption.'] });
    await compose([insert(review)]);
    assert.equal(briefs.length, 1);
    assert.equal(logLines.some((l) => l.msg === 'composer-grounding-check'), false);
  });

  it('never puts part of a client id in a finding when the body leaks the id', async () => {
    modelReply = JSON.stringify({ subject: 'PGP intake paused', bodyMarkdown: 'File 2026-042 is on hold for 9 months.', suggestedActions: ['Wait'] });
    await compose([insert(live)]);
    const warn = logLines.find((l) => l.msg === 'composer-grounding-check');
    assert.deepEqual(warn?.findings, [{ kind: 'duration', value: '9 months' }]);
    assert.doesNotMatch(JSON.stringify(warn?.findings), /2026|042/);
  });
});
