import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});

const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const CLIENT_PROFILES_TABLE = requiredEnv('CLIENT_PROFILES_TABLE');
const IMPACT_ASSESSMENTS_TABLE = requiredEnv('IMPACT_ASSESSMENTS_TABLE');
const RCIC_USERS_TABLE = requiredEnv('RCIC_USERS_TABLE');
const TRIAGE_MODEL = requiredEnv('BEDROCK_TRIAGE_MODEL');
const GUARDRAIL_ID = process.env.BEDROCK_GUARDRAIL_ID;
const GUARDRAIL_VERSION = process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT';
const LOOKBACK_DAYS = Number(process.env.RECALL_LOOKBACK_DAYS ?? '30');
const MAX_PAIRS_PER_RUN = Number(process.env.RECALL_MAX_PAIRS ?? '200');

function guardrailConfig() {
  if (!GUARDRAIL_ID) return undefined;
  return {
    guardrailIdentifier: GUARDRAIL_ID,
    guardrailVersion: GUARDRAIL_VERSION,
    trace: 'enabled' as const,
  };
}

type PolicyRule = {
  rule_hash: string;
  rule_kind: string;
  policy_domain: string;
  topic: string;
  category: string;
  severity: string;
  summary: string;
  rule_content?: string;
  source_url: string;
  source_s3_key: string;
  captured_at: string;
};

type ClientSummary = {
  rcicId: string;
  clientId: string;
  program?: string;
  status?: string;
  currentCrsScore?: number;
  nocCode?: string;
  teerLevel?: number;
  hasJobOffer?: boolean;
  clbEnglishWorst?: number;
  clbFrenchWorst?: number;
  intendedStudyLevel?: string;
  pnpProvince?: string;
};

type TriageDecision = { deserves_analysis: boolean; rationale: string };

export const handler = async (): Promise<{
  rulesConsidered: number;
  pairsTriaged: number;
  pairsSkippedAlreadyAssessed: number;
  deltasEmitted: number;
}> => {
  const runId = randomUUID();
  const rcicIds = await loadActiveRcicIds();
  log('info', 'recall-start', { runId, rcicCount: rcicIds.length, lookbackDays: LOOKBACK_DAYS });

  if (rcicIds.length === 0) {
    log('info', 'recall-no-active-rcics', { runId });
    return { rulesConsidered: 0, pairsTriaged: 0, pairsSkippedAlreadyAssessed: 0, deltasEmitted: 0 };
  }

  const rules = await loadRecentRules();
  if (rules.length === 0) {
    log('info', 'recall-no-recent-rules', { runId });
    return { rulesConsidered: 0, pairsTriaged: 0, pairsSkippedAlreadyAssessed: 0, deltasEmitted: 0 };
  }

  let pairsTriaged = 0;
  let pairsSkippedAlreadyAssessed = 0;
  let deltasEmitted = 0;

  for (const rcicId of rcicIds) {
    const clients = await loadClients(rcicId);
    const assessed = await loadAssessedPairs(rcicId);

    for (const rule of rules) {
      const candidates = filterByProgram(clients, rule.policy_domain);
      for (const client of candidates) {
        if (pairsTriaged >= MAX_PAIRS_PER_RUN) {
          log('info', 'recall-cap-reached', { runId, pairsTriaged, cap: MAX_PAIRS_PER_RUN });
          break;
        }
        const recallEventId = recallEventIdFor(rule.rule_hash);
        // Skip when this tenant already has an assessment for the same rule
        // hash and client, whether it came from live Sentinel or an earlier
        // Recall run. The assessmentKey check covers older rows written
        // before ruleHash was on every item.
        if (
          assessed.ruleClientPairs.has(`${rule.rule_hash}#${client.clientId}`) ||
          assessed.assessmentKeys.has(`${recallEventId}#${client.clientId}`)
        ) {
          pairsSkippedAlreadyAssessed += 1;
          continue;
        }

        const decision = await triage(rule, client, runId);
        pairsTriaged += 1;
        log('info', 'triage-decision', {
          runId,
          rcicId,
          clientId: client.clientId,
          ruleHash: rule.rule_hash,
          topic: rule.topic,
          decision: decision.deserves_analysis,
          rationale: decision.rationale,
        });
        if (!decision.deserves_analysis) continue;

        await emitRecallDelta(rule, recallEventId);
        deltasEmitted += 1;
        break; // one PolicyDelta per rule is enough; Analyst fans out to all clients for the rcicId.
      }
      if (pairsTriaged >= MAX_PAIRS_PER_RUN) break;
    }
    if (pairsTriaged >= MAX_PAIRS_PER_RUN) break;
  }

  log('info', 'recall-complete', {
    runId,
    rulesConsidered: rules.length,
    pairsTriaged,
    pairsSkippedAlreadyAssessed,
    deltasEmitted,
  });
  return {
    rulesConsidered: rules.length,
    pairsTriaged,
    pairsSkippedAlreadyAssessed,
    deltasEmitted,
  };
};

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

async function loadRecentRules(): Promise<PolicyRule[]> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const out: PolicyRule[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined = undefined;
  do {
    const res: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(
      new ScanCommand({
        TableName: POLICY_RULES_TABLE,
        FilterExpression: 'captured_at >= :c',
        ExpressionAttributeValues: { ':c': cutoff },
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      // A superseded rule keeps its row for replay but should not be
      // re-emitted for fresh analysis.
      if (item.deprecated_at !== undefined && item.deprecated_at !== null && item.deprecated_at !== '') continue;
      out.push(item as unknown as PolicyRule);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function loadClients(rcicId: string): Promise<ClientSummary[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: CLIENT_PROFILES_TABLE,
      KeyConditionExpression: 'rcicId = :r',
      ExpressionAttributeValues: { ':r': rcicId },
    }),
  );
  return (res.Items ?? []) as ClientSummary[];
}

// One paginated Query per tenant (ImpactAssessments is keyed by rcicId),
// projected down to the three attributes the dedup needs. The per-pair
// checks then run against in-memory sets.
async function loadAssessedPairs(
  rcicId: string,
): Promise<{ assessmentKeys: Set<string>; ruleClientPairs: Set<string> }> {
  const assessmentKeys = new Set<string>();
  const ruleClientPairs = new Set<string>();
  let ExclusiveStartKey: Record<string, unknown> | undefined = undefined;
  do {
    const res: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(
      new QueryCommand({
        TableName: IMPACT_ASSESSMENTS_TABLE,
        KeyConditionExpression: 'rcicId = :r',
        ExpressionAttributeValues: { ':r': rcicId },
        ProjectionExpression: '#ak, #rh, #cid',
        ExpressionAttributeNames: { '#ak': 'assessmentKey', '#rh': 'ruleHash', '#cid': 'clientId' },
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      if (typeof item.assessmentKey === 'string') assessmentKeys.add(item.assessmentKey);
      if (typeof item.ruleHash === 'string' && typeof item.clientId === 'string') {
        ruleClientPairs.add(`${item.ruleHash}#${item.clientId}`);
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return { assessmentKeys, ruleClientPairs };
}

function filterByProgram(clients: ClientSummary[], policyDomain: string): ClientSummary[] {
  if (policyDomain === 'general' || policyDomain === 'other') return clients;
  return clients.filter((c) => c.program === policyDomain);
}

async function triage(rule: PolicyRule, client: ClientSummary, runId: string): Promise<TriageDecision> {
  const system = [
    'You are the Recall triage agent in Argus.',
    'You decide whether a specific (rule, client) pair deserves deep multi-agent analysis, which is expensive.',
    'You never see the client by name. Client is opaque client_id only.',
    'You are conservative: default to false unless the rule likely affects the client based on program, status, and scoring inputs.',
    'Return valid JSON only. No preamble.',
  ].join('\n');

  const user = [
    'RULE (recent IRCC change):',
    JSON.stringify(
      {
        topic: rule.topic,
        policyDomain: rule.policy_domain,
        ruleKind: rule.rule_kind,
        severity: rule.severity,
        summary: rule.summary,
      },
      null,
      2,
    ),
    '',
    'CLIENT (opaque id only):',
    JSON.stringify(stripUndefined(client as unknown as Record<string, unknown>), null, 2),
    '',
    'Return this exact JSON shape:',
    '{',
    '  "deserves_analysis": boolean,',
    '  "rationale": "one sentence, at most 25 words"',
    '}',
  ].join('\n');

  const res = await bedrock.send(
    new ConverseCommand({
      modelId: TRIAGE_MODEL,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: { maxTokens: 200, temperature: 0 },
      guardrailConfig: guardrailConfig(),
    }),
  );

  const raw = res.output?.message?.content?.[0]?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    log('error', 'triage-non-json', { runId, ruleHash: rule.rule_hash, clientId: client.clientId, raw: raw.slice(0, 200) });
    return { deserves_analysis: false, rationale: 'triage-parse-failed' };
  }
  const parsed = JSON.parse(match[0]) as Partial<TriageDecision>;
  return {
    deserves_analysis: parsed.deserves_analysis === true,
    rationale: parsed.rationale ?? '(no rationale)',
  };
}

function recallEventIdFor(ruleHash: string): string {
  return `recall-${ruleHash.slice(0, 12)}`;
}

async function emitRecallDelta(rule: PolicyRule, recallEventId: string): Promise<void> {
  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'argus.sentinel',
          DetailType: 'PolicyDelta',
          Detail: JSON.stringify({
            eventId: recallEventId,
            timestamp: new Date().toISOString(),
            policyDomain: rule.policy_domain,
            sourceUrl: rule.source_url,
            category: rule.category,
            severity: rule.severity,
            summary: rule.summary,
            topic: rule.topic,
            ruleKind: rule.rule_kind,
            ruleHash: rule.rule_hash,
            previousHash: null,
            newHash: rule.rule_hash,
            s3Key: rule.source_s3_key,
            contentLengthDelta: 0,
            recallOrigin: true,
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
