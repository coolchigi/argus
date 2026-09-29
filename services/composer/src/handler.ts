import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { describeGuardrailBlock, guarded } from './guardrail';
import { ruleWindow } from './rule-window';
import { elapsedMs, recordStep } from './telemetry';
import { checkBriefVoice, withoutClientId } from './voice';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});

const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const BRIEFS_TABLE = requiredEnv('BRIEFS_TABLE');
const COMPOSER_MODEL = requiredEnv('BEDROCK_COMPOSER_MODEL');
const GUARDRAIL_ID = process.env.BEDROCK_GUARDRAIL_ID;
const GUARDRAIL_VERSION = process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT';
// Optional on purpose: a missing telemetry table must never stop a draft.
const AUDIT_TRAIL_TABLE = process.env.AUDIT_TRAIL_TABLE;

function guardrailConfig() {
  if (!GUARDRAIL_ID) return undefined;
  return {
    guardrailIdentifier: GUARDRAIL_ID,
    guardrailVersion: GUARDRAIL_VERSION,
    trace: 'enabled' as const,
  };
}

type ImpactType = 'crs-delta' | 'eligibility-flip' | 'deadline-shift' | 'lmia-implication' | 'french-bonus' | 'procedural' | 'none';
type Confidence = 'low' | 'medium' | 'high';

type Assessment = {
  rcicId: string;
  assessmentKey: string;
  clientId: string;
  policyEventId: string;
  ruleHash: string;
  topic: string;
  isAffected: boolean;
  impactType: ImpactType;
  numericDelta: number | null;
  narrative: string;
  recommendedAction: string;
  confidence: Confidence;
  citationSourceUrl: string;
  auditorReasoning?: string;
  timestamp: string;
};

type BriefDraft = {
  subject: string;
  bodyMarkdown: string;
  suggestedActions: string[];
};

export const handler = async (event: DynamoDBStreamEvent): Promise<{ composed: number; skipped: number }> => {
  const runId = randomUUID();
  let composed = 0;
  let skipped = 0;

  for (const record of event.Records) {
    try {
      const outcome = await processOne(record, runId);
      if (outcome === 'composed') composed += 1;
      else skipped += 1;
    } catch (err) {
      log('error', 'compose-failed', {
        runId,
        eventId: record.eventID,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log('info', 'compose-batch-complete', { runId, composed, skipped, batchSize: event.Records.length });
  return { composed, skipped };
};

async function processOne(record: DynamoDBRecord, runId: string): Promise<'composed' | 'skipped'> {
  if (record.eventName !== 'INSERT') return 'skipped';
  const image = record.dynamodb?.NewImage;
  if (!image) return 'skipped';

  const assessment = unmarshall(image as Parameters<typeof unmarshall>[0]) as Assessment;
  const startedAt = performance.now();
  let outcome: 'drafted' | 'no-brief-needed' | 'failed' = 'failed';
  try {
    const result = await composeOne(assessment, runId);
    outcome = result === 'composed' ? 'drafted' : 'no-brief-needed';
    return result;
  } finally {
    await recordStep(
      ddb,
      AUDIT_TRAIL_TABLE,
      { kind: 'assessment', rcicId: assessment.rcicId, policyEventId: assessment.policyEventId, clientId: assessment.clientId },
      { agent: 'composer', modelId: COMPOSER_MODEL, durationMs: elapsedMs(startedAt), outcome },
      log,
    );
  }
}

async function composeOne(assessment: Assessment, runId: string): Promise<'composed' | 'skipped'> {
  if (!assessment.isAffected || assessment.impactType === 'none') {
    log('info', 'skip-non-impact', {
      runId,
      assessmentKey: assessment.assessmentKey,
      isAffected: assessment.isAffected,
      impactType: assessment.impactType,
    });
    return 'skipped';
  }

  const rule = await loadRule(assessment.ruleHash);
  const draft = await compose(assessment, rule.content, runId);

  const briefId = randomUUID();
  const now = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: BRIEFS_TABLE,
      Item: {
        rcicId: assessment.rcicId,
        briefId,
        assessmentKey: assessment.assessmentKey,
        clientId: assessment.clientId,
        policyEventId: assessment.policyEventId,
        ruleHash: assessment.ruleHash,
        topic: assessment.topic,
        impactType: assessment.impactType,
        numericDelta: assessment.numericDelta,
        confidence: assessment.confidence,
        subject: draft.subject,
        bodyMarkdown: draft.bodyMarkdown,
        suggestedActions: draft.suggestedActions,
        citationSourceUrl: assessment.citationSourceUrl,
        status: 'draft',
        createdAt: now,
      },
    }),
  );

  await emitBriefReady({
    briefId,
    rcicId: assessment.rcicId,
    clientId: assessment.clientId,
    assessmentKey: assessment.assessmentKey,
    impactType: assessment.impactType,
    numericDelta: assessment.numericDelta,
    confidence: assessment.confidence,
    ruleSeverity: rule.severity,
    subject: draft.subject,
    createdAt: now,
  });

  log('info', 'brief-composed', {
    runId,
    briefId,
    rcicId: assessment.rcicId,
    clientId: assessment.clientId,
    assessmentKey: assessment.assessmentKey,
    impactType: assessment.impactType,
    numericDelta: assessment.numericDelta,
  });
  return 'composed';
}

// One read gives Composer the rule text for the prompt and the severity
// Sentinel classified, which it forwards so Alerts never needs its own
// threshold.
async function loadRule(ruleHash: string): Promise<{ content: string; severity: string | null }> {
  const res = await ddb.send(new GetCommand({ TableName: POLICY_RULES_TABLE, Key: { rule_hash: ruleHash } }));
  const content = res.Item?.rule_content;
  const severity = res.Item?.severity;
  return {
    content: typeof content === 'string' ? content : '',
    severity: typeof severity === 'string' ? severity : null,
  };
}

export function buildComposeRequest(assessment: Assessment, ruleContent: string): ConverseCommandInput {
  const snippet = ruleWindow(ruleContent);

  const system = [
    'You are the Composer agent in Argus, an IRCC policy-impact platform for Regulated Canadian Immigration Consultants (RCICs).',
    'You draft a short email that the RCIC sends to their own client. The RCIC is the sender and the client is the reader.',
    'Write to the client directly, in second person: "you", "your application". Write in the consultant\'s voice, first person: "I recommend".',
    'Never write "your client" and never describe the client in the third person. The assessment below calls the reader "the client". Turn that into "you".',
    'Never write a name, a client id or a placeholder like [CLIENT NAME]. No greeting and no sign-off: the RCIC adds both when they send it.',
    'You never invent facts. Every claim must come from the assessment or the rule content.',
    'You match the professional tone RCICs use with their clients: plain language, honest about uncertainty, one clear next step.',
    'Return valid JSON only. No preamble.',
  ].join('\n');

  // The client id stays out of the prompt entirely. The model has no use for
  // it, and a body that carries it reads as a note about the client.
  const assessmentJson = JSON.stringify(
    {
      topic: assessment.topic,
      impactType: assessment.impactType,
      numericDelta: assessment.numericDelta,
      narrative: withoutClientId(assessment.narrative, assessment.clientId),
      recommendedAction: withoutClientId(assessment.recommendedAction, assessment.clientId),
      confidence: assessment.confidence,
      citation: assessment.citationSourceUrl,
    },
    null,
    2,
  );

  const instructions = [
    'Return this exact JSON shape:',
    '{',
    '  "subject": "one line, under 80 chars, no exclamation marks",',
    '  "bodyMarkdown": "3 short paragraphs. Paragraph 1: what changed. Paragraph 2: what it means for you, the reader. Paragraph 3: what I, your consultant, recommend you do next. Include the citation URL inline as a markdown link once.",',
    '  "suggestedActions": ["one action", "another action", "at most 3 actions total, each a single imperative sentence"]',
    '}',
    '',
    'Rules:',
    '- Lead with the change, not with pleasantries. RCICs edit before sending.',
    '- If numericDelta is a negative CRS number, say "your CRS score is affected by X points" using the sign.',
    '- If impactType is eligibility-flip, be explicit whether it opens or closes eligibility.',
    '- If confidence is low, add one sentence hedging the recommendation.',
    '- No em dashes. No exclamation marks. Use digits for numbers.',
  ].join('\n');

  // The assessment text and the rule text are outside content. See
  // guardrail.ts for the tagging rule.
  return {
    modelId: COMPOSER_MODEL,
    system: [{ text: system }],
    messages: [{
      role: 'user',
      content: [
        { text: 'ASSESSMENT (signed and audit-verified):\n' },
        guarded(assessmentJson + '\n\n'),
        { text: 'RULE CONTENT (source of truth, a long rule is shown as an excerpt, marked in brackets):\n' },
        guarded(snippet + '\n\n'),
        { text: instructions },
      ],
    }],
    inferenceConfig: { maxTokens: 900, temperature: 0.2 },
    guardrailConfig: guardrailConfig(),
  };
}

async function compose(assessment: Assessment, ruleContent: string, runId: string): Promise<BriefDraft> {
  const res = await bedrock.send(new ConverseCommand(buildComposeRequest(assessment, ruleContent)));

  if (res.stopReason === 'guardrail_intervened') {
    const block = describeGuardrailBlock(res);
    log('error', 'guardrail-blocked', {
      runId,
      agent: 'composer',
      assessmentKey: assessment.assessmentKey,
      clientId: assessment.clientId,
      ruleHash: assessment.ruleHash,
      stage: block.stage,
      policies: block.policies,
      guardedInputs: ['assessment', 'rule-text'],
    });
    throw new Error(`guardrail-blocked at ${block.stage}: ${block.policies.join(', ') || 'unknown policy'}`);
  }

  const raw = res.output?.message?.content?.[0]?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    log('error', 'composer-non-json', { runId, assessmentKey: assessment.assessmentKey, raw: raw.slice(0, 200) });
    throw new Error(`composer returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(match[0]) as Partial<BriefDraft>;
  const draft = {
    subject: parsed.subject ?? `Policy update relevant to ${assessment.clientId}`,
    bodyMarkdown: parsed.bodyMarkdown ?? assessment.narrative,
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.slice(0, 3) : [assessment.recommendedAction],
  };

  // A warning, never a failure: the consultant reads and edits every draft
  // before it goes out, and a draft in the wrong voice beats no draft.
  const findings = checkBriefVoice(draft.bodyMarkdown, assessment.clientId);
  if (findings.length > 0) {
    log('warn', 'composer-voice-check', {
      runId,
      assessmentKey: assessment.assessmentKey,
      clientId: assessment.clientId,
      modelId: COMPOSER_MODEL,
      findings,
    });
  }
  return draft;
}

async function emitBriefReady(detail: Record<string, unknown>): Promise<void> {
  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'argus.composer',
          DetailType: 'BriefReady',
          Detail: JSON.stringify(detail),
        },
      ],
    }),
  );
}

function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
