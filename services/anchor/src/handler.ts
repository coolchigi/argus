import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import { elapsedMs, recordStep } from './telemetry';
import { bumpPublicCounter } from './public-counter';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});

const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const IMPACT_ASSESSMENTS_TABLE = requiredEnv('IMPACT_ASSESSMENTS_TABLE');
const SIGNING_KEY_ID = requiredEnv('SIGNING_KEY_ID');
// Optional on purpose: a missing telemetry table must never stop signing.
const AUDIT_TRAIL_TABLE = process.env.AUDIT_TRAIL_TABLE;
const PUBLIC_COUNTERS_TABLE = process.env.PUBLIC_COUNTERS_TABLE;

type ImpactType = 'crs-delta' | 'eligibility-flip' | 'deadline-shift' | 'lmia-implication' | 'french-bonus' | 'procedural' | 'none';
type Confidence = 'low' | 'medium' | 'high';

type AuditVerdict = {
  verdictId: string;
  timestamp: string;
  hypothesisId: string;
  rcicId: string;
  clientId: string;
  policyEventId: string;
  ruleHash: string;
  passed: boolean;
  issues: Array<{ type: string; detail: string }>;
  correctedNumericDelta: number | null;
  correctedImpactType: ImpactType;
  correctedNarrative: string;
  correctedRecommendedAction: string;
  correctedConfidence: Confidence;
  auditorReasoning: string;
  // Absent on verdicts from an Auditor older than ADR-0004.
  affectedStance?: unknown;
  affectedStanceReason?: unknown;
  // Set by the Auditor only when its stance-check read a self-contradicting
  // stance as "uncertain".
  affectedStanceContradicted?: unknown;
  originalHypothesis: {
    isAffected: boolean;
    impactType: ImpactType;
    numericDelta: number | null;
    narrative: string;
    topic: string;
  };
};

type AuditorStance = { stance: 'agree' | 'disagree' | 'uncertain'; reason: string; contradicted?: true };

// The Auditor's view of the Analyst's isAffected, signed next to it (ADR-0004).
// A verdict without a usable stance signs exactly the fields it signed before
// ADR-0004, so the payload only gains the key when there's something to sign.
// The same goes for contradicted: it's signed only on an "uncertain" the
// Auditor's stance-check produced, so every other stance keeps its bytes.
export function auditorStanceOf(
  verdict: Pick<AuditVerdict, 'affectedStance' | 'affectedStanceReason' | 'affectedStanceContradicted'>,
): AuditorStance | null {
  const s = verdict.affectedStance;
  if (s !== 'agree' && s !== 'disagree' && s !== 'uncertain') return null;
  const reason = typeof verdict.affectedStanceReason === 'string' ? verdict.affectedStanceReason : '';
  if (s === 'uncertain' && verdict.affectedStanceContradicted === true) return { stance: s, reason, contradicted: true };
  return { stance: s, reason };
}

type EventBridgeInput = { source?: string; 'detail-type'?: string; detail?: AuditVerdict };

type AnchorOutcome = 'signed' | 'already-signed' | 'dropped' | 'missing-citation' | 'failed';

export const handler = async (event: EventBridgeInput | AuditVerdict): Promise<{ anchored: boolean }> => {
  const verdict: AuditVerdict = 'detail' in event && event.detail ? event.detail : (event as AuditVerdict);
  const startedAt = performance.now();
  let outcome: AnchorOutcome = 'failed';
  try {
    const res = await anchor(verdict);
    outcome = res.outcome;
    return { anchored: res.anchored };
  } finally {
    // Runs after the assessment is signed and stored, from values already
    // computed. It never reads or changes the signed payload.
    await recordStep(
      ddb,
      AUDIT_TRAIL_TABLE,
      { kind: 'assessment', rcicId: verdict.rcicId, policyEventId: verdict.policyEventId, clientId: verdict.clientId },
      { agent: 'anchor', modelId: null, durationMs: elapsedMs(startedAt), outcome },
      log,
    );
  }
};

async function anchor(verdict: AuditVerdict): Promise<{ anchored: boolean; outcome: AnchorOutcome }> {
  log('info', 'anchor-start', {
    verdictId: verdict.verdictId,
    hypothesisId: verdict.hypothesisId,
    rcicId: verdict.rcicId,
    clientId: verdict.clientId,
    passed: verdict.passed,
  });

  if (!verdict.passed) {
    log('info', 'anchor-dropped-failed-verdict', { verdictId: verdict.verdictId });
    return { anchored: false, outcome: 'dropped' };
  }

  const citation = await loadCitation(verdict.ruleHash);
  if (!citation) {
    log('error', 'anchor-missing-citation', { verdictId: verdict.verdictId, ruleHash: verdict.ruleHash });
    return { anchored: false, outcome: 'missing-citation' };
  }

  const assessmentId = `${verdict.policyEventId}#${verdict.clientId}`;
  const auditorStance = auditorStanceOf(verdict);
  const payload = {
    assessmentId,
    rcicId: verdict.rcicId,
    clientId: verdict.clientId,
    policyEventId: verdict.policyEventId,
    ruleHash: verdict.ruleHash,
    topic: verdict.originalHypothesis.topic,
    isAffected: verdict.originalHypothesis.isAffected,
    impactType: verdict.correctedImpactType,
    numericDelta: verdict.correctedNumericDelta,
    narrative: verdict.correctedNarrative,
    recommendedAction: verdict.correctedRecommendedAction,
    confidence: verdict.correctedConfidence,
    // The page version, then the stored changed lines the agents' text is built from,
    // when the row has them. A row's rule_hash covers rule_content only, so without the
    // second entry nothing would tie this signature to what the models read. No second
    // entry means they read the whole page (ADR-0001).
    rulesUsed: [verdict.ruleHash, ...(citation.changesHash ? [citation.changesHash] : [])],
    citationSourceUrl: citation.source_url,
    citationSourceS3Key: citation.source_s3_key,
    auditorReasoning: verdict.auditorReasoning,
    auditIssues: verdict.issues,
    ...(auditorStance ? { auditorStance } : {}),
    timestamp: new Date().toISOString(),
  };

  const canonicalHash = sha256Canonical(payload);
  const signature = await signHash(canonicalHash);

  let alreadySigned = false;
  await ddb.send(
    new PutCommand({
      TableName: IMPACT_ASSESSMENTS_TABLE,
      Item: {
        ...payload,
        assessmentKey: assessmentId,
        canonicalHash,
        signatureBase64: signature,
        signingKeyId: SIGNING_KEY_ID,
        signatureAlgorithm: 'ECDSA_SHA_256',
      },
      ConditionExpression: 'attribute_not_exists(rcicId) OR attribute_not_exists(assessmentKey)',
    }),
  ).catch((err: unknown) => {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      log('info', 'anchor-already-exists', { assessmentId });
      alreadySigned = true;
      return;
    }
    throw err;
  });

  // Only a new signature counts. A replayed verdict hits the condition above.
  if (!alreadySigned) await bumpPublicCounter(ddb, PUBLIC_COUNTERS_TABLE, 'assessments', payload.timestamp);

  log('info', 'anchor-signed-and-written', {
    verdictId: verdict.verdictId,
    assessmentId,
    canonicalHash,
    signatureLength: signature.length,
    auditorStance: auditorStance?.stance ?? null,
    auditorStanceContradicted: auditorStance?.contradicted ?? false,
  });

  return { anchored: true, outcome: alreadySigned ? 'already-signed' : 'signed' };
}

// Same check as ruleTextFor in the agents: only text that starts with this header
// is what they read. A test fails if it stops matching what Sentinel writes.
const CHANGES_HEADER = 'CHANGES TO THIS IRCC PAGE';

async function loadCitation(ruleHash: string): Promise<{ source_url: string; source_s3_key: string; changesHash: string | null } | null> {
  const res = await ddb.send(new GetCommand({ TableName: POLICY_RULES_TABLE, Key: { rule_hash: ruleHash } }));
  const item = res.Item;
  if (!item || typeof item.source_url !== 'string' || typeof item.source_s3_key !== 'string') {
    return null;
  }
  const changes = item.rule_changes?.text;
  const changesHash = typeof changes === 'string' && changes.startsWith(CHANGES_HEADER) ? createHash('sha256').update(changes).digest('hex') : null;
  return { source_url: item.source_url, source_s3_key: item.source_s3_key, changesHash };
}

function sha256Canonical(payload: Record<string, unknown>): string {
  const canonical = canonicalize(payload);
  return createHash('sha256').update(canonical).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function signHash(hexHash: string): Promise<string> {
  const messageBytes = Buffer.from(hexHash, 'hex');
  const res = await kms.send(
    new SignCommand({
      KeyId: SIGNING_KEY_ID,
      Message: messageBytes,
      MessageType: 'DIGEST',
      SigningAlgorithm: 'ECDSA_SHA_256',
    }),
  );
  if (!res.Signature) {
    throw new Error('KMS returned no signature');
  }
  return Buffer.from(res.Signature).toString('base64');
}

function log(level: 'debug' | 'info' | 'error', msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
