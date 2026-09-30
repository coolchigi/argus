import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBBatchItemFailure, DynamoDBBatchResponse, DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { briefIdFor, classifyFailure, PermanentError } from './delivery';
import { describeGuardrailBlock, guarded } from './guardrail';
import { ruleWindow } from './rule-window';
import { checkBriefGrounding, checkDateRoles } from './grounding';
import { elapsedMs, recordStep } from './telemetry';
import { checkDraftVoice, withoutClientId } from './voice';

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
  // Set on a consultant review (ADR-0004, services/impacts-service/src/review.ts).
  // Its narrative and recommendedAction are the consultant's own wording.
  recordKind?: string;
  reviewReasoning?: string;
  timestamp: string;
};

// Used when the model returns no subject. Fixed text on purpose: it goes to
// the client, so it carries no client id, and a topic slug like
// "ee-crs-grid" doesn't read well humanized.
export const FALLBACK_SUBJECT = 'An immigration policy update that affects your file';

type BriefDraft = {
  subject: string;
  bodyMarkdown: string;
  suggestedActions: string[];
};

type Outcome = 'composed' | 'skipped' | 'already-drafted';

// Returns the records Lambda should redeliver (reportBatchItemFailures is on
// for this event source). A retryable failure goes back by its sequence
// number. A permanent one is logged and dropped. Lambda redelivers from the
// lowest failed sequence number, so records after it can arrive again too:
// the brief key and the briefReadyAt mark make that safe.
export const handler = async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
  const runId = randomUUID();
  const counts = { composed: 0, skipped: 0, alreadyDrafted: 0, retrying: 0, dropped: 0 };
  const batchItemFailures: DynamoDBBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const outcome = await processOne(record, runId);
      if (outcome === 'composed') counts.composed += 1;
      else if (outcome === 'already-drafted') counts.alreadyDrafted += 1;
      else counts.skipped += 1;
    } catch (err) {
      const failure = classifyFailure(err);
      const fields = {
        runId,
        eventId: record.eventID,
        sequenceNumber: record.dynamodb?.SequenceNumber,
        reason: failure.reason,
        errorName: err instanceof Error ? err.name : typeof err,
        error: err instanceof Error ? err.message : String(err),
      };
      if (failure.retryable) {
        counts.retrying += 1;
        log('warn', 'compose-failed-will-retry', fields);
        batchItemFailures.push({ itemIdentifier: record.dynamodb?.SequenceNumber ?? '' });
      } else {
        counts.dropped += 1;
        log('error', 'compose-failed-permanent', fields);
      }
    }
  }

  log('info', 'compose-batch-complete', { runId, ...counts, batchSize: event.Records.length });
  return { batchItemFailures };
};

async function processOne(record: DynamoDBRecord, runId: string): Promise<Outcome> {
  if (record.eventName !== 'INSERT') return 'skipped';
  const image = record.dynamodb?.NewImage;
  if (!image) return 'skipped';

  const assessment = unmarshall(image as Parameters<typeof unmarshall>[0]) as Assessment;
  requireKeys(assessment);
  const startedAt = performance.now();
  let outcome = 'failed';
  try {
    const result = await composeOne(assessment, runId);
    outcome = result === 'composed' ? 'drafted' : result === 'already-drafted' ? 'already-drafted' : 'no-brief-needed';
    return result;
  } catch (err) {
    if (classifyFailure(err).retryable) outcome = 'failed-will-retry';
    throw err;
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

// The keys every step needs, the telemetry row included. Without them the
// record can't be tied to a tenant or a client, and no retry changes that.
function requireKeys(a: Assessment): void {
  for (const field of ['rcicId', 'assessmentKey', 'clientId', 'policyEventId'] as const) {
    if (typeof a[field] !== 'string' || !a[field]) throw new PermanentError('bad-input', `assessment has no ${field}`);
  }
}

// What a brief is drafted from. Checked after the skip, since an unaffected
// assessment needs none of it.
function requireDraftInputs(a: Assessment): void {
  for (const field of ['ruleHash', 'narrative', 'recommendedAction'] as const) {
    if (typeof a[field] !== 'string' || !a[field].trim()) throw new PermanentError('bad-input', `assessment has no ${field}`);
  }
}

async function composeOne(assessment: Assessment, runId: string): Promise<Outcome> {
  if (!assessment.isAffected || assessment.impactType === 'none') {
    log('info', 'skip-non-impact', {
      runId,
      assessmentKey: assessment.assessmentKey,
      isAffected: assessment.isAffected,
      impactType: assessment.impactType,
    });
    return 'skipped';
  }
  requireDraftInputs(assessment);
  const ids = { runId, rcicId: assessment.rcicId, policyEventId: assessment.policyEventId };

  // A redelivered record finds the brief it already wrote. If BriefReady went
  // out too, there's nothing left to do. If it didn't (the emit or the mark
  // failed last time), send it now from the stored brief, with no new draft.
  const briefId = briefIdFor(assessment.rcicId, assessment.assessmentKey);
  const existing = await loadBrief(assessment.rcicId, briefId);
  if (existing) {
    if (existing.briefReadyAt) {
      log('info', 'brief-already-composed', { ...ids, briefId });
      return 'already-drafted';
    }
    const rule = await loadRule(assessment.ruleHash);
    await announce(assessment, briefId, rule.severity, String(existing.subject ?? ''), String(existing.createdAt ?? ''));
    log('info', 'brief-ready-resent', { ...ids, briefId });
    return 'already-drafted';
  }

  const rule = await loadRule(assessment.ruleHash);
  const draft = await compose(assessment, rule.content, runId);

  const now = new Date().toISOString();
  try {
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
        // Create-only. A brief already under this key is this assessment's.
        ConditionExpression: 'attribute_not_exists(briefId)',
      }),
    );
  } catch (err) {
    // Another delivery of the same record wrote it between the read and this
    // put. That delivery sends BriefReady.
    if ((err as { name?: unknown }).name === 'ConditionalCheckFailedException') {
      log('info', 'brief-already-composed', { ...ids, briefId });
      return 'already-drafted';
    }
    throw err;
  }

  // A warning, never a failure, same as the voice check. Covers the body and
  // the suggested actions, since the client reads both. The text loses the
  // client id first, so no finding can carry part of it. The log line holds
  // the findings and ids that don't name the client, never the brief text.
  // No assessmentKey: it ends in the client id.
  const briefText = withoutClientId([draft.bodyMarkdown, ...draft.suggestedActions].join('\n'), assessment.clientId);
  const sources = groundingSources(assessment, rule.content);
  const grounding = [
    ...checkBriefGrounding(briefText, [...sources.policy, ...sources.client]),
    ...checkDateRoles(briefText, sources.policy, sources.client),
  ];
  if (grounding.length > 0) {
    log('warn', 'composer-grounding-check', {
      runId,
      briefId,
      rcicId: assessment.rcicId,
      policyEventId: assessment.policyEventId,
      ruleHash: assessment.ruleHash,
      modelId: COMPOSER_MODEL,
      findings: grounding,
    });
  }

  await announce(assessment, briefId, rule.severity, draft.subject, now);

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
// A brief with no rule text would state IRCC facts from model memory, so a
// missing rule stops the draft. Rules are never deleted (ADR-0002), so a
// retry would find the same nothing.
async function loadRule(ruleHash: string): Promise<{ content: string; severity: string | null }> {
  const res = await ddb.send(new GetCommand({ TableName: POLICY_RULES_TABLE, Key: { rule_hash: ruleHash } }));
  const content = res.Item?.rule_content;
  const severity = res.Item?.severity;
  if (typeof content !== 'string' || !content.trim()) throw new PermanentError('rule-not-found', `no rule_content for rule ${ruleHash}`);
  return { content, severity: typeof severity === 'string' ? severity : null };
}

// Strongly consistent, so a record redelivered right after a write sees it.
async function loadBrief(rcicId: string, briefId: string): Promise<Record<string, unknown> | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: BRIEFS_TABLE, Key: { rcicId, briefId }, ConsistentRead: true }));
  return res.Item;
}

// Sends BriefReady, then marks the brief so a redelivery knows it went out.
// If the mark fails the record retries and BriefReady goes out a second
// time. Alerts gets it at least once, and a lost alert is the worse outcome.
async function announce(assessment: Assessment, briefId: string, ruleSeverity: string | null, subject: string, createdAt: string): Promise<void> {
  await emitBriefReady({
    briefId,
    rcicId: assessment.rcicId,
    clientId: assessment.clientId,
    assessmentKey: assessment.assessmentKey,
    impactType: assessment.impactType,
    numericDelta: assessment.numericDelta,
    confidence: assessment.confidence,
    ruleSeverity,
    subject,
    createdAt,
  });
  await ddb.send(
    new UpdateCommand({
      TableName: BRIEFS_TABLE,
      Key: { rcicId: assessment.rcicId, briefId },
      UpdateExpression: 'SET briefReadyAt = :at',
      ConditionExpression: 'attribute_exists(briefId)',
      ExpressionAttributeValues: { ':at': new Date().toISOString() },
    }),
  );
}

// What a brief is allowed to state facts from, split by role. Policy facts
// come from the full rule text (the model may see an excerpt of a long rule,
// but a fact from anywhere in the rule is still the rule's) and the citation.
// Client facts come from the signed assessment text the prompt carries, with
// the client id taken out the same way, so the id can't ground a number.
function groundingSources(assessment: Assessment, ruleContent: string): { policy: string[]; client: string[] } {
  return {
    policy: [ruleContent, assessment.citationSourceUrl],
    client: [
      ...clientTexts(assessment),
      assessment.numericDelta === null ? '' : String(assessment.numericDelta),
    ],
  };
}

// The assessment's free text about this client. On a consultant review that
// includes the consultant's reasoning, which often carries profile facts
// (school, program, start date) that the narrative only sums up.
function clientTexts(assessment: Assessment): string[] {
  const texts = [assessment.narrative, assessment.recommendedAction, consultantReasoning(assessment)];
  return texts.map((t) => withoutClientId(t ?? '', assessment.clientId));
}

function consultantReasoning(assessment: Assessment): string | undefined {
  if (assessment.recordKind !== 'consultant-review') return undefined;
  return typeof assessment.reviewReasoning === 'string' && assessment.reviewReasoning.trim() ? assessment.reviewReasoning : undefined;
}

export function buildComposeRequest(assessment: Assessment, ruleContent: string): ConverseCommandInput {
  const snippet = ruleWindow(ruleContent);

  const system = [
    'You are the Composer agent in Argus, an IRCC policy-impact platform for Regulated Canadian Immigration Consultants (RCICs).',
    'You draft a short email that the RCIC sends to their own client. The RCIC is the sender and the client is the reader.',
    'Write to the client directly, in second person: "you", "your application". Write in the consultant\'s voice, first person: "I recommend".',
    'Never write "your client" and never describe the client in the third person. The assessment below calls the reader "the client". Turn that into "you".',
    'Never write a name, a client id or a placeholder like [CLIENT NAME]. No greeting and no sign-off: the RCIC adds both when they send it.',
    'Never write a bracketed or template placeholder of any kind: [start date], [program], {date}, {{name}}, <name>, XX, ____, TBD. The client reads the brief as written, and the RCIC may send it without filling a slot.',
    'If a fact isn\'t in the rule content or ABOUT THE READER, leave it out or write around it. With no start date given, write "before your program starts", never "on [start date]".',
    'You get two inputs. RULE CONTENT is IRCC\'s own text. ABOUT THE READER is the signed assessment of this reader\'s file: what the change means for them, and any facts about them it states (such as their school, program, start date or status). It often leaves some of those out.',
    'Every fact about IRCC programs, dates, numbers, durations, fees or eligibility must come from the rule content or the assessment below. If neither says it, leave it out, even if you believe it is true.',
    'Dates and numbers that describe the policy (effective dates, cut-offs, thresholds, validity periods, caps) come only from the rule content. If the rule content gives no date for the change, don\'t give one.',
    'Dates, schools and programs in ABOUT THE READER belong to the reader. Say them as the reader\'s own ("your program", "your school"). Never present them as when, where or to whom the policy applies.',
    'Name another program, visa or permit only if the rule content or the assessment names it.',
    'The reader has never seen the rule content or the assessment and doesn\'t know Argus exists. Never write "the rule", "the assessment" or any field name. Call the source what it is to the reader: IRCC\'s notice, the change, the update.',
    'When the assessment says something about the reader is unknown, ask the reader for it ("let me know whether..."). Never say a document doesn\'t confirm it.',
    'You match the professional tone RCICs use with their clients: plain language, honest about uncertainty, one clear next step.',
    'Return valid JSON only. No preamble.',
  ].join('\n');

  // The client id stays out of the prompt entirely. The model has no use for
  // it, and a body that carries it reads as a note about the client.
  const reasoning = consultantReasoning(assessment);
  const assessmentJson = JSON.stringify(
    {
      topic: assessment.topic,
      impactType: assessment.impactType,
      numericDelta: assessment.numericDelta,
      narrative: withoutClientId(assessment.narrative, assessment.clientId),
      recommendedAction: withoutClientId(assessment.recommendedAction, assessment.clientId),
      ...(reasoning ? { consultantReasoning: withoutClientId(reasoning, assessment.clientId) } : {}),
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
    '- Keep each number, duration, amount and date the same as the rule content or the assessment gives it, in digits.',
    '- Paragraph 1 describes the change with the rule content\'s own dates and conditions. A date from ABOUT THE READER goes in paragraph 2, as the reader\'s.',
  ].join('\n');

  // The rule text and the assessment text are outside content. See
  // guardrail.ts for the tagging rule. Rule first, so the policy's own facts
  // are set before the model reads the reader's.
  return {
    modelId: COMPOSER_MODEL,
    system: [{ text: system }],
    messages: [{
      role: 'user',
      content: [
        { text: 'RULE CONTENT (IRCC\'s text, the only source for the policy\'s dates, numbers and conditions. A long rule is shown as an excerpt, marked in brackets):\n' },
        guarded(snippet + '\n\n'),
        { text: 'ABOUT THE READER (the signed assessment of this reader\'s file. Its dates, schools and programs describe the reader, never the policy. "consultantReasoning" is the consultant\'s own reasoning, present when they reviewed the file):\n' },
        guarded(assessmentJson + '\n\n'),
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
    throw new PermanentError('guardrail-blocked', `guardrail-blocked at ${block.stage}: ${block.policies.join(', ') || 'unknown policy'}`);
  }

  const raw = res.output?.message?.content?.[0]?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    log('error', 'composer-non-json', { runId, assessmentKey: assessment.assessmentKey, raw: raw.slice(0, 200) });
    throw new PermanentError('model-output-unusable', `composer returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(match[0]) as Partial<BriefDraft>;
  const draft = {
    subject: typeof parsed.subject === 'string' && parsed.subject.trim() ? parsed.subject : FALLBACK_SUBJECT,
    // The fallbacks are Analyst text, which names the client by id. The
    // client reads these, so the id becomes "the client".
    bodyMarkdown:
      typeof parsed.bodyMarkdown === 'string' && parsed.bodyMarkdown.trim()
        ? parsed.bodyMarkdown
        : withoutClientId(assessment.narrative, assessment.clientId),
    suggestedActions: Array.isArray(parsed.suggestedActions)
      ? parsed.suggestedActions.slice(0, 3)
      : [withoutClientId(assessment.recommendedAction, assessment.clientId)],
  };

  // A warning, never a failure: the consultant reads and edits every draft
  // before it goes out, and a draft in the wrong voice beats no draft.
  const findings = checkDraftVoice(draft, assessment.clientId);
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

// PutEvents reports a refused entry in the response instead of throwing, so
// a refusal is turned into a retry here. Without this the alert is lost.
async function emitBriefReady(detail: Record<string, unknown>): Promise<void> {
  const res = await eb.send(
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
  if ((res.FailedEntryCount ?? 0) > 0) {
    // Named after the entry's error code, so classifyFailure sorts it the
    // same way it sorts a thrown service error.
    const code = res.Entries?.find((e) => e.ErrorCode)?.ErrorCode ?? 'InternalFailure';
    const err = new Error(`BriefReady not accepted: ${code}`);
    err.name = code;
    throw err;
  }
}

function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
