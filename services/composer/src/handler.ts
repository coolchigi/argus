import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { randomUUID } from 'node:crypto';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});

const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const BRIEFS_TABLE = requiredEnv('BRIEFS_TABLE');
const COMPOSER_MODEL = requiredEnv('BEDROCK_COMPOSER_MODEL');
const RULE_CONTENT_MAX_CHARS = 3000;

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

  if (!assessment.isAffected || assessment.impactType === 'none') {
    log('info', 'skip-non-impact', {
      runId,
      assessmentKey: assessment.assessmentKey,
      isAffected: assessment.isAffected,
      impactType: assessment.impactType,
    });
    return 'skipped';
  }

  const ruleContent = await loadRuleContent(assessment.ruleHash);
  const draft = await compose(assessment, ruleContent, runId);

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

async function loadRuleContent(ruleHash: string): Promise<string> {
  const res = await ddb.send(new GetCommand({ TableName: POLICY_RULES_TABLE, Key: { rule_hash: ruleHash } }));
  const content = res.Item?.rule_content;
  return typeof content === 'string' ? content : '';
}

async function compose(assessment: Assessment, ruleContent: string, runId: string): Promise<BriefDraft> {
  const snippet = ruleContent.slice(0, RULE_CONTENT_MAX_CHARS);

  const system = [
    'You are the Composer agent in Argus, an IRCC policy-impact platform for Regulated Canadian Immigration Consultants (RCICs).',
    'You draft a short client-update email that the RCIC will personalize and send.',
    'You never refer to the client by name. Client is referenced as "your client" or by their opaque id.',
    'You never invent facts. Every claim must come from the assessment or the rule content.',
    'You match the professional tone RCICs use with their clients: plain language, honest about uncertainty, one clear next step.',
    'Return valid JSON only. No preamble.',
  ].join('\n');

  const user = [
    'ASSESSMENT (signed and audit-verified):',
    JSON.stringify(
      {
        clientId: assessment.clientId,
        topic: assessment.topic,
        impactType: assessment.impactType,
        numericDelta: assessment.numericDelta,
        narrative: assessment.narrative,
        recommendedAction: assessment.recommendedAction,
        confidence: assessment.confidence,
        citation: assessment.citationSourceUrl,
      },
      null,
      2,
    ),
    '',
    'RULE CONTENT (source of truth, may be truncated):',
    snippet,
    '',
    'Return this exact JSON shape:',
    '{',
    '  "subject": "one line, under 80 chars, no exclamation marks",',
    '  "bodyMarkdown": "3 short paragraphs. Paragraph 1: what changed. Paragraph 2: what it means for the client (use client_id as placeholder for their name). Paragraph 3: what you recommend as their consultant. Include the citation URL inline as a markdown link once.",',
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

  const res = await bedrock.send(
    new ConverseCommand({
      modelId: COMPOSER_MODEL,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: { maxTokens: 900, temperature: 0.2 },
    }),
  );

  const raw = res.output?.message?.content?.[0]?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    log('error', 'composer-non-json', { runId, assessmentKey: assessment.assessmentKey, raw: raw.slice(0, 200) });
    throw new Error(`composer returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(match[0]) as Partial<BriefDraft>;
  return {
    subject: parsed.subject ?? `Policy update relevant to ${assessment.clientId}`,
    bodyMarkdown: parsed.bodyMarkdown ?? assessment.narrative,
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.slice(0, 3) : [assessment.recommendedAction],
  };
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

function log(level: 'debug' | 'info' | 'error', msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
