import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { describeGuardrailBlock, guarded } from './guardrail';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});

const CLIENT_PROFILES_TABLE = requiredEnv('CLIENT_PROFILES_TABLE');
const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const RCIC_USERS_TABLE = requiredEnv('RCIC_USERS_TABLE');
const REASONER_MODEL = requiredEnv('BEDROCK_REASONER_MODEL');
const GUARDRAIL_ID = process.env.BEDROCK_GUARDRAIL_ID;
const GUARDRAIL_VERSION = process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT';
const RULE_CONTENT_MAX_CHARS = 4000;
const GROUNDING_QUERY_MAX_CHARS = 1000;

function guardrailConfig() {
  if (!GUARDRAIL_ID) return undefined;
  return {
    guardrailIdentifier: GUARDRAIL_ID,
    guardrailVersion: GUARDRAIL_VERSION,
    trace: 'enabled' as const,
  };
}

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
  targetRcicIds?: string[];
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

  const targeted = Array.isArray(delta.targetRcicIds) && delta.targetRcicIds.length > 0;
  const rcicIds = targeted
    ? await loadActiveTargetRcicIds(delta.targetRcicIds as string[])
    : await loadActiveRcicIds();
  log('info', 'rcics-loaded', {
    runId,
    mode: targeted ? 'targeted' : 'all-active',
    requestedRcicCount: targeted ? delta.targetRcicIds!.length : null,
    activeRcicCount: rcicIds.length,
  });
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
        const hyp = await reason(delta, rule, client, runId);
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

// Reads only the named tenants from RcicUsers and keeps the ones that
// exist and are not marked inactive.
async function loadActiveTargetRcicIds(requested: string[]): Promise<string[]> {
  const ids = [...new Set(requested.filter((id) => typeof id === 'string' && id.length > 0))];
  const active = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    let keys: Record<string, unknown>[] | undefined = ids.slice(i, i + 100).map((rcicId) => ({ rcicId }));
    for (let attempt = 0; keys && keys.length > 0; attempt++) {
      if (attempt >= 5) throw new Error('BatchGet on RcicUsers left unprocessed keys after 5 attempts');
      if (attempt > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      const res: BatchGetCommandOutput = await ddb.send(
        new BatchGetCommand({
          RequestItems: {
            [RCIC_USERS_TABLE]: { Keys: keys, ProjectionExpression: 'rcicId, active' },
          },
        }),
      );
      for (const item of res.Responses?.[RCIC_USERS_TABLE] ?? []) {
        if (typeof item.rcicId !== 'string') continue;
        if (item.active === false) continue;
        active.add(item.rcicId);
      }
      keys = res.UnprocessedKeys?.[RCIC_USERS_TABLE]?.Keys;
    }
  }
  return ids.filter((id) => active.has(id));
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

export function buildReasonRequest(delta: PolicyDelta, rule: PolicyRule, client: ClientProfile): ConverseCommandInput {
  const ruleSnippet = (rule.rule_content ?? '').slice(0, RULE_CONTENT_MAX_CHARS);
  const clientJson = JSON.stringify(stripUndefined(client), null, 2);

  const system = [
    'You are the Analyst agent in Argus, an IRCC policy-impact platform.',
    'You reason over one Canadian IRCC policy change and one client profile.',
    'You produce ONE structured impact hypothesis. Return valid JSON only. No preamble, no explanation.',
    'You never see or reference the client by name. Client is identified only by client_id.',
    'You are conservative: prefer isAffected=false when the policy change does not clearly apply.',
    'A pause, cap or closure of intake affects clients who have not yet submitted an application, including clients waiting for an invitation or selection to apply. A client who can no longer take their next step is affected.',
    'Numeric deltas are only for CRS point changes; leave null for non-CRS changes.',
    'Base every statement on the rule content and the client profile only. Reuse the rule content\'s own wording. Do not add facts, programs or options the rule content does not mention.',
  ].join('\n');

  const policyChange = [
    `- Domain: ${delta.policyDomain}`,
    `- Topic: ${delta.topic}`,
    `- Category: ${delta.category}`,
    `- Severity: ${delta.severity}`,
    `- Rule kind: ${delta.ruleKind}`,
    `- Summary (from ingest classifier): ${delta.summary}`,
    `- Source: ${delta.sourceUrl}`,
  ].join('\n');

  const instructions = [
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

  // Contextual grounding scores the Analyst's answer against every
  // grounding_source block combined, so the rule text and the client
  // profile are both sources. The query keeps its old shape, profile
  // included, because scores dropped in testing when the profile left the
  // query or moved after the ask. Bedrock rejects the whole call when the
  // query is over 1,000 characters, so a long profile is cut to fit. The
  // full profile is in the grounding source anyway.
  const queryHead = [
    `POLICY CHANGE`,
    `- Domain: ${delta.policyDomain}`,
    `- Topic: ${delta.topic}`,
    `- Summary: ${delta.summary}`,
    ``,
    `CLIENT PROFILE`,
    ``,
  ].join('\n');
  const queryTail = `\n\nProduce ONE impact hypothesis for this client against the rule content in the grounding source. Return the JSON shape described in the system prompt.`;
  const profileBudget = Math.max(0, GROUNDING_QUERY_MAX_CHARS - queryHead.length - queryTail.length);
  const groundedQuery = (queryHead + clientJson.slice(0, profileBudget) + queryTail).slice(0, GROUNDING_QUERY_MAX_CHARS);

  // Qualified blocks feed only the contextual-grounding check, so the rule
  // text, policy change and client profile are also tagged without a
  // qualifier. That's what makes the guardrail's PII and prompt-attack
  // filters evaluate them. See guardrail.ts for the tagging rule.
  return {
    modelId: REASONER_MODEL,
    system: [{ text: system }],
    messages: [{
      role: 'user',
      content: [
        {
          guardContent: {
            text: {
              text: `RULE CONTENT (source of truth):\n${ruleSnippet}`,
              qualifiers: ['grounding_source'],
            },
          },
        },
        {
          guardContent: {
            text: {
              text: `CLIENT PROFILE (source of truth):\n${clientJson}`,
              qualifiers: ['grounding_source'],
            },
          },
        },
        {
          guardContent: {
            text: {
              text: groundedQuery,
              qualifiers: ['query'],
            },
          },
        },
        { text: 'POLICY CHANGE\n' },
        guarded(policyChange + '\n\n'),
        { text: 'RULE CONTENT SNIPPET (may be truncated):\n' },
        guarded(ruleSnippet + '\n\n'),
        { text: 'CLIENT PROFILE:\n' },
        guarded(clientJson + '\n\n'),
        { text: instructions },
      ],
    }],
    inferenceConfig: { maxTokens: 800, temperature: 0.1 },
    guardrailConfig: guardrailConfig(),
  };
}

async function reason(delta: PolicyDelta, rule: PolicyRule, client: ClientProfile, runId: string): Promise<ImpactHypothesis> {
  const res = await bedrock.send(new ConverseCommand(buildReasonRequest(delta, rule, client)));

  if (res.stopReason === 'guardrail_intervened') {
    const block = describeGuardrailBlock(res);
    log('error', 'guardrail-blocked', {
      runId,
      agent: 'analyst',
      rcicId: client.rcicId,
      clientId: client.clientId,
      ruleHash: delta.ruleHash,
      stage: block.stage,
      policies: block.policies,
      guardedInputs: ['policy-change', 'rule-text', 'client-profile'],
    });
    throw new Error(`guardrail-blocked at ${block.stage}: ${block.policies.join(', ') || 'unknown policy'}`);
  }

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
