import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});

const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const AUDITOR_MODEL = requiredEnv('BEDROCK_AUDITOR_MODEL');
const RULE_CONTENT_MAX_CHARS = 4000;

type ImpactType = 'crs-delta' | 'eligibility-flip' | 'deadline-shift' | 'lmia-implication' | 'french-bonus' | 'procedural' | 'none';
type Confidence = 'low' | 'medium' | 'high';

type ImpactHypothesis = {
  hypothesisId: string;
  timestamp: string;
  rcicId: string;
  clientId: string;
  policyEventId: string;
  ruleHash: string;
  topic: string;
  policyDomain: string;
  isAffected: boolean;
  impactType: ImpactType;
  numericDelta: number | null;
  narrative: string;
  recommendedAction: string;
  confidence: Confidence;
  reasoning: string;
  clientProfile: Record<string, unknown>;
};

type EventBridgeInput = { source?: string; 'detail-type'?: string; detail?: ImpactHypothesis };

type AuditIssue = {
  type: 'schema' | 'citation' | 'edge-case' | 'magnitude-error' | 'other';
  detail: string;
};

type AuditVerdict = {
  verdictId: string;
  timestamp: string;
  hypothesisId: string;
  rcicId: string;
  clientId: string;
  policyEventId: string;
  ruleHash: string;
  passed: boolean;
  issues: AuditIssue[];
  correctedNumericDelta: number | null;
  correctedImpactType: ImpactType;
  correctedNarrative: string;
  correctedRecommendedAction: string;
  correctedConfidence: Confidence;
  auditorReasoning: string;
  originalHypothesis: ImpactHypothesis;
};

export const handler = async (event: EventBridgeInput | ImpactHypothesis): Promise<{ passed: boolean }> => {
  const runId = randomUUID();
  const hyp: ImpactHypothesis = 'detail' in event && event.detail ? event.detail : (event as ImpactHypothesis);

  log('info', 'audit-start', {
    runId,
    hypothesisId: hyp.hypothesisId,
    clientId: hyp.clientId,
    policyEventId: hyp.policyEventId,
    originalIsAffected: hyp.isAffected,
    originalImpactType: hyp.impactType,
    originalNumericDelta: hyp.numericDelta,
  });

  const ruleContent = await loadRuleContent(hyp.ruleHash);

  const verdict = await audit(hyp, ruleContent, runId);
  await emitVerdict(verdict);

  log('info', 'audit-complete', {
    runId,
    hypothesisId: hyp.hypothesisId,
    clientId: hyp.clientId,
    passed: verdict.passed,
    issueCount: verdict.issues.length,
    correctionApplied: verdict.correctedNumericDelta !== hyp.numericDelta,
    correctedNumericDelta: verdict.correctedNumericDelta,
  });

  return { passed: verdict.passed };
};

async function loadRuleContent(ruleHash: string): Promise<string> {
  const res = await ddb.send(new GetCommand({ TableName: POLICY_RULES_TABLE, Key: { rule_hash: ruleHash } }));
  const content = res.Item?.rule_content;
  return typeof content === 'string' ? content : '';
}

async function audit(hyp: ImpactHypothesis, ruleContent: string, runId: string): Promise<AuditVerdict> {
  const snippet = ruleContent.slice(0, RULE_CONTENT_MAX_CHARS);
  const hypothesisJson = JSON.stringify(
    {
      isAffected: hyp.isAffected,
      impactType: hyp.impactType,
      numericDelta: hyp.numericDelta,
      narrative: hyp.narrative,
      recommendedAction: hyp.recommendedAction,
      confidence: hyp.confidence,
      reasoning: hyp.reasoning,
    },
    null,
    2,
  );
  const clientJson = JSON.stringify(hyp.clientProfile, null, 2);

  const system = [
    'You are the Auditor agent in Argus, an IRCC policy-impact platform.',
    'You review ONE hypothesis produced by a separate Analyst agent and adversarially validate it against the source rule and the client profile.',
    'You come from a different model family than the Analyst on purpose. You are skeptical.',
    'You look for: schema issues, missing citations, magnitude errors, edge-case failures.',
    'When you catch an error, provide the CORRECTED values, not just a rejection.',
    'You know Canadian IRCC edge cases: TEER 0 jobs (Senior Management NOC 00) award 200 CRS points, all other job offers award 50 CRS points; the March 25 2025 change zeroed both.',
    'You know: LMIA-exempt vs LMIA-supported distinctions, French bonus stacks with English CLB 7 gate, PGWP field-of-study rules apply to non-degree only, PNP intent-to-reside is now a provincial call not federal.',
    'Return valid JSON only. No preamble.',
  ].join('\n');

  const user = [
    'RULE CONTENT (source of truth, may be truncated):',
    snippet,
    '',
    'CLIENT PROFILE (opaque client_id only):',
    clientJson,
    '',
    'ANALYST HYPOTHESIS (under review):',
    hypothesisJson,
    '',
    'Audit the hypothesis. Return this exact JSON shape:',
    '{',
    '  "passed": boolean,',
    '  "issues": [{"type": "schema" | "citation" | "edge-case" | "magnitude-error" | "other", "detail": "..."}],',
    '  "correctedNumericDelta": number | null,',
    '  "correctedImpactType": "crs-delta" | "eligibility-flip" | "deadline-shift" | "lmia-implication" | "french-bonus" | "procedural" | "none",',
    '  "correctedNarrative": "one sentence, use client_id only",',
    '  "correctedRecommendedAction": "one concrete step",',
    '  "correctedConfidence": "low" | "medium" | "high",',
    '  "auditorReasoning": "2 to 3 sentences explaining the audit outcome"',
    '}',
    '',
    'Rules:',
    '- passed=true means the hypothesis is acceptable as-is or with your corrections applied.',
    '- passed=false means the hypothesis is fundamentally wrong (e.g. wrong client universe, wrong policy interpretation) and should be dropped.',
    '- If you correct any field, put the corrected value in the corresponding "corrected*" field. If no correction needed, echo the original value.',
    '- issues array is empty only when passed=true AND no corrections were needed.',
  ].join('\n');

  const res = await bedrock.send(
    new ConverseCommand({
      modelId: AUDITOR_MODEL,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: { maxTokens: 800, temperature: 0.1 },
    }),
  );

  const raw = res.output?.message?.content?.[0]?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    log('error', 'auditor-non-json', { runId, hypothesisId: hyp.hypothesisId, raw: raw.slice(0, 200) });
    throw new Error(`auditor returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(match[0]) as Partial<AuditVerdict>;

  return {
    verdictId: randomUUID(),
    timestamp: new Date().toISOString(),
    hypothesisId: hyp.hypothesisId,
    rcicId: hyp.rcicId,
    clientId: hyp.clientId,
    policyEventId: hyp.policyEventId,
    ruleHash: hyp.ruleHash,
    passed: parsed.passed ?? false,
    issues: (parsed.issues ?? []) as AuditIssue[],
    correctedNumericDelta: parsed.correctedNumericDelta ?? hyp.numericDelta,
    correctedImpactType: (parsed.correctedImpactType ?? hyp.impactType) as ImpactType,
    correctedNarrative: parsed.correctedNarrative ?? hyp.narrative,
    correctedRecommendedAction: parsed.correctedRecommendedAction ?? hyp.recommendedAction,
    correctedConfidence: (parsed.correctedConfidence ?? hyp.confidence) as Confidence,
    auditorReasoning: parsed.auditorReasoning ?? '(no reasoning)',
    originalHypothesis: hyp,
  };
}

async function emitVerdict(verdict: AuditVerdict): Promise<void> {
  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'argus.auditor',
          DetailType: 'AuditVerdict',
          Detail: JSON.stringify(verdict),
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
