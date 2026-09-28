import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import { eligibleClients, tenantFromItem, TENANT_ATTRIBUTES, type Tenant } from './eligibility';
import { describeGuardrailBlock, guarded } from './guardrail';

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
  const tenants = await loadActiveTenants();
  log('info', 'recall-start', { runId, rcicCount: tenants.length, lookbackDays: LOOKBACK_DAYS });

  if (tenants.length === 0) {
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

  for (const tenant of tenants) {
    const { rcicId } = tenant;
    const clients = await loadClients(rcicId);
    const assessed = await loadAssessedPairs(rcicId);

    for (const rule of rules) {
      // Closed clients and program areas the consultant turned off are
      // never triaged, so they never cost a model call.
      const candidates = eligibleClients(clients, rule.policy_domain, tenant);
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

async function loadActiveTenants(): Promise<Tenant[]> {
  const out: Tenant[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined = undefined;
  do {
    const res: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(
      new ScanCommand({
        TableName: RCIC_USERS_TABLE,
        // Aliased so a reserved word in the list never breaks the projection.
        ProjectionExpression: TENANT_ATTRIBUTES.map((_, i) => `#t${i}`).join(', '),
        ExpressionAttributeNames: Object.fromEntries(TENANT_ATTRIBUTES.map((a, i) => [`#t${i}`, a])),
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const tenant = tenantFromItem(item);
      if (tenant) out.push(tenant);
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

export function buildTriageRequest(rule: PolicyRule, client: ClientSummary): ConverseCommandInput {
  const system = [
    'You are the Recall triage agent in Argus.',
    'You decide whether a specific (rule, client) pair deserves deep multi-agent analysis, which is expensive.',
    'You never see the client by name. Client is opaque client_id only.',
    'You are conservative: default to false unless the rule likely affects the client based on program, status, and scoring inputs.',
    'Return valid JSON only. No preamble.',
  ].join('\n');

  const ruleJson = JSON.stringify(
    {
      topic: rule.topic,
      policyDomain: rule.policy_domain,
      ruleKind: rule.rule_kind,
      severity: rule.severity,
      summary: rule.summary,
    },
    null,
    2,
  );
  const clientJson = JSON.stringify(stripUndefined(client as unknown as Record<string, unknown>), null, 2);

  const instructions = [
    'Return this exact JSON shape:',
    '{',
    '  "deserves_analysis": boolean,',
    '  "rationale": "one sentence, at most 25 words"',
    '}',
  ].join('\n');

  // The rule summary and the client profile are outside content. See
  // guardrail.ts for the tagging rule.
  return {
    modelId: TRIAGE_MODEL,
    system: [{ text: system }],
    messages: [{
      role: 'user',
      content: [
        { text: 'RULE (recent IRCC change):\n' },
        guarded(ruleJson + '\n\n'),
        { text: 'CLIENT (opaque id only):\n' },
        guarded(clientJson + '\n\n'),
        { text: instructions },
      ],
    }],
    inferenceConfig: { maxTokens: 200, temperature: 0 },
    guardrailConfig: guardrailConfig(),
  };
}

async function triage(rule: PolicyRule, client: ClientSummary, runId: string): Promise<TriageDecision> {
  const res = await bedrock.send(new ConverseCommand(buildTriageRequest(rule, client)));

  // A blocked pair is skipped, the same outcome a non-JSON reply had
  // before, so one bad pair doesn't stop the rest of the run.
  if (res.stopReason === 'guardrail_intervened') {
    const block = describeGuardrailBlock(res);
    log('error', 'guardrail-blocked', {
      runId,
      agent: 'recall',
      rcicId: client.rcicId,
      clientId: client.clientId,
      ruleHash: rule.rule_hash,
      stage: block.stage,
      policies: block.policies,
      guardedInputs: ['rule-summary', 'client-profile'],
    });
    return { deserves_analysis: false, rationale: 'guardrail-blocked' };
  }

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
