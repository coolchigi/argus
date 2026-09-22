import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});

const CLIENT_PROFILES_TABLE = requiredEnv('CLIENT_PROFILES_TABLE');
const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const RCIC_USERS_TABLE = requiredEnv('RCIC_USERS_TABLE');
const REASONER_MODEL = requiredEnv('BEDROCK_REASONER_MODEL');
const RULE_CONTENT_MAX_CHARS = 4000;

type PolicyDelta = {
  eventId: string;
  timestamp: string;
  policyDomain: string;
  sourceUrl: string;
  category: string;
  severity: string;
  summary: string;
  topic: string;
  ruleKind: string;
  ruleHash: string;
  previousHash: string | null;
  newHash: string;
  s3Key: string;
  contentLengthDelta: number;
};

type EventBridgeInput = { source?: string; 'detail-type'?: string; detail?: PolicyDelta };

type ClientProfile = {
  rcicId: string;
  clientId: string;
  program?: string;
  status?: string;
  age?: number;
  educationLevel?: string;
  clbEnglishWorst?: number;
  clbFrenchWorst?: number;
  canadianWorkYears?: number;
  foreignWorkYears?: number;
  nocCode?: string;
  teerLevel?: number;
  hasJobOffer?: boolean;
  jobOfferTeer?: number;
  currentCrsScore?: number;
  principalPermitTeer?: number;
  principalPermitRemainingMonths?: number;
  cipCode?: string;
  graduationDate?: string;
  pgpSponsor2020Form?: boolean;
  pgpLicoYearsMet?: number;
  pnpProvince?: string;
  intendedStudyLevel?: string;
  palOnFile?: boolean;
  notes?: string;
};

type PolicyRule = {
  rule_hash: string;
  rule_kind: string;
  policy_domain: string;
  topic: string;
  summary: string;
  rule_content: string;
};

type ImpactHypothesis = {
  hypothesisId: string;
  timestamp: string;
  rcicId: string;
  clientId: string;
  policyEventId: string;
  ruleHash: string;
  topic: string;
  isAffected: boolean;
  impactType: 'crs-delta' | 'eligibility-flip' | 'deadline-shift' | 'lmia-implication' | 'french-bonus' | 'procedural' | 'none';
  numericDelta: number | null;
  narrative: string;
  recommendedAction: string;
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
};

export const handler = async (event: EventBridgeInput | PolicyDelta): Promise<{ hypothesesEmitted: number }> => {
  const runId = randomUUID();
  const delta: PolicyDelta = 'detail' in event && event.detail ? event.detail : (event as PolicyDelta);

  log('info', 'analyst-start', {
    runId,
    policyEventId: delta.eventId,
    topic: delta.topic,
    policyDomain: delta.policyDomain,
    severity: delta.severity,
  });

  const rule = await loadRule(delta.ruleHash);
  if (!rule) {
    log('error', 'rule-not-found', { runId, ruleHash: delta.ruleHash });
    return { hypothesesEmitted: 0 };
  }

  const rcicIds = await loadActiveRcicIds();
  log('info', 'rcics-loaded', { runId, activeRcicCount: rcicIds.length });
  if (rcicIds.length === 0) {
    log('info', 'no-active-rcics', { runId });
    return { hypothesesEmitted: 0 };
  }

  let total = 0;
  for (const rcicId of rcicIds) {
    const clients = await queryCaseload(rcicId);
    const candidates = filterByPolicyDomain(clients, delta.policyDomain);
    log('info', 'caseload-loaded', {
      runId,
      rcicId,
      caseloadSize: clients.length,
      candidateCount: candidates.length,
    });

    for (const client of candidates) {
      try {
        const hyp = await reason(delta, rule, client);
        await emitHypothesis(hyp, delta, client);
        log('info', 'hypothesis-emitted', {
          runId,
          rcicId,
          clientId: client.clientId,
          policyEventId: delta.eventId,
          isAffected: hyp.isAffected,
          impactType: hyp.impactType,
          numericDelta: hyp.numericDelta,
          confidence: hyp.confidence,
          narrative: hyp.narrative,
        });
        total += 1;
      } catch (err) {
        log('error', 'reason-failed', {
          runId,
          rcicId,
          clientId: client.clientId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  log('info', 'analyst-complete', { runId, hypothesesEmitted: total });
  return { hypothesesEmitted: total };
};

async function loadRule(ruleHash: string): Promise<PolicyRule | null> {
  const res = await ddb.send(new GetCommand({ TableName: POLICY_RULES_TABLE, Key: { rule_hash: ruleHash } }));
  return (res.Item as PolicyRule | undefined) ?? null;
}

async function loadActiveRcicIds(): Promise<string[]> {
  const out: string[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined = undefined;
  do {
    const res: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(
      new ScanCommand({
        TableName: RCIC_USERS_TABLE,
        ProjectionExpression: 'rcicId, active',
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      if (typeof item.rcicId !== 'string') continue;
      if (item.active === false) continue;
      out.push(item.rcicId);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function queryCaseload(rcicId: string): Promise<ClientProfile[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: CLIENT_PROFILES_TABLE,
      KeyConditionExpression: 'rcicId = :r',
      ExpressionAttributeValues: { ':r': rcicId },
    }),
  );
  return (res.Items ?? []) as ClientProfile[];
}

function filterByPolicyDomain(clients: ClientProfile[], policyDomain: string): ClientProfile[] {
  if (policyDomain === 'general' || policyDomain === 'other') return clients;
  return clients.filter((c) => c.program === policyDomain);
}

async function reason(delta: PolicyDelta, rule: PolicyRule, client: ClientProfile): Promise<ImpactHypothesis> {
  const ruleSnippet = (rule.rule_content ?? '').slice(0, RULE_CONTENT_MAX_CHARS);
  const clientJson = JSON.stringify(stripUndefined(client), null, 2);

  const system = [
    'You are the Analyst agent in Argus, an IRCC policy-impact platform.',
    'You reason over one Canadian IRCC policy change and one client profile.',
    'You produce ONE structured impact hypothesis. Return valid JSON only. No preamble, no explanation.',
    'You never see or reference the client by name. Client is identified only by client_id.',
    'You are conservative: prefer isAffected=false when the policy change does not clearly apply.',
    'Numeric deltas are only for CRS point changes; leave null for non-CRS changes.',
  ].join('\n');

  const user = [
    'POLICY CHANGE',
    `- Domain: ${delta.policyDomain}`,
    `- Topic: ${delta.topic}`,
    `- Category: ${delta.category}`,
    `- Severity: ${delta.severity}`,
    `- Rule kind: ${delta.ruleKind}`,
    `- Summary (from ingest classifier): ${delta.summary}`,
    `- Source: ${delta.sourceUrl}`,
    '',
    'RULE CONTENT SNIPPET (may be truncated):',
    ruleSnippet,
    '',
    'CLIENT PROFILE:',
    clientJson,
    '',
    'Return this exact JSON shape:',
    '{',
    '  "isAffected": boolean,',
    '  "impactType": "crs-delta" | "eligibility-flip" | "deadline-shift" | "lmia-implication" | "french-bonus" | "procedural" | "none",',
    '  "numericDelta": number | null,',
    '  "narrative": "one sentence, present tense, referring to the client by client_id only",',
    '  "recommendedAction": "one concrete step the consultant should take",',
    '  "confidence": "low" | "medium" | "high",',
    '  "reasoning": "2 to 3 sentences of chain-of-thought that led to the conclusion"',
    '}',
  ].join('\n');

  const res = await bedrock.send(
    new ConverseCommand({
      modelId: REASONER_MODEL,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: { maxTokens: 800, temperature: 0.1 },
    }),
  );

  const raw = res.output?.message?.content?.[0]?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`analyst returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(match[0]) as Partial<ImpactHypothesis>;

  return {
    hypothesisId: randomUUID(),
    timestamp: new Date().toISOString(),
    rcicId: client.rcicId,
    clientId: client.clientId,
    policyEventId: delta.eventId,
    ruleHash: delta.ruleHash,
    topic: delta.topic,
    isAffected: parsed.isAffected ?? false,
    impactType: (parsed.impactType ?? 'none') as ImpactHypothesis['impactType'],
    numericDelta: parsed.numericDelta ?? null,
    narrative: parsed.narrative ?? '(no narrative)',
    recommendedAction: parsed.recommendedAction ?? '(no action)',
    confidence: (parsed.confidence ?? 'low') as ImpactHypothesis['confidence'],
    reasoning: parsed.reasoning ?? '(no reasoning)',
  };
}

async function emitHypothesis(hyp: ImpactHypothesis, delta: PolicyDelta, client: ClientProfile): Promise<void> {
  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'argus.analyst',
          DetailType: 'ImpactHypothesis',
          Detail: JSON.stringify({
            ...hyp,
            policyDomain: delta.policyDomain,
            ruleContent: undefined,
            clientProfile: stripUndefined(client as unknown as Record<string, unknown>),
          }),
        },
      ],
    }),
  );
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

function log(level: 'debug' | 'info' | 'error', msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
