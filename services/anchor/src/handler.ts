import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});

const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const IMPACT_ASSESSMENTS_TABLE = requiredEnv('IMPACT_ASSESSMENTS_TABLE');
const SIGNING_KEY_ID = requiredEnv('SIGNING_KEY_ID');

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
  originalHypothesis: {
    isAffected: boolean;
    impactType: ImpactType;
    numericDelta: number | null;
    narrative: string;
    topic: string;
  };
};

type EventBridgeInput = { source?: string; 'detail-type'?: string; detail?: AuditVerdict };

export const handler = async (event: EventBridgeInput | AuditVerdict): Promise<{ anchored: boolean }> => {
  const verdict: AuditVerdict = 'detail' in event && event.detail ? event.detail : (event as AuditVerdict);

  log('info', 'anchor-start', {
    verdictId: verdict.verdictId,
    hypothesisId: verdict.hypothesisId,
    rcicId: verdict.rcicId,
    clientId: verdict.clientId,
    passed: verdict.passed,
  });

  if (!verdict.passed) {
    log('info', 'anchor-dropped-failed-verdict', { verdictId: verdict.verdictId });
    return { anchored: false };
  }

  const citation = await loadCitation(verdict.ruleHash);
  if (!citation) {
    log('error', 'anchor-missing-citation', { verdictId: verdict.verdictId, ruleHash: verdict.ruleHash });
    return { anchored: false };
  }

  const assessmentId = `${verdict.policyEventId}#${verdict.clientId}`;
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
    rulesUsed: [verdict.ruleHash],
    citationSourceUrl: citation.source_url,
    citationSourceS3Key: citation.source_s3_key,
    auditorReasoning: verdict.auditorReasoning,
    auditIssues: verdict.issues,
    timestamp: new Date().toISOString(),
  };

  const canonicalHash = sha256Canonical(payload);
  const signature = await signHash(canonicalHash);

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
      return;
    }
    throw err;
  });

  log('info', 'anchor-signed-and-written', {
    verdictId: verdict.verdictId,
    assessmentId,
    canonicalHash,
    signatureLength: signature.length,
  });

  return { anchored: true };
};

async function loadCitation(ruleHash: string): Promise<{ source_url: string; source_s3_key: string } | null> {
  const res = await ddb.send(new GetCommand({ TableName: POLICY_RULES_TABLE, Key: { rule_hash: ruleHash } }));
  const item = res.Item;
  if (!item || typeof item.source_url !== 'string' || typeof item.source_s3_key !== 'string') {
    return null;
  }
  return { source_url: item.source_url, source_s3_key: item.source_s3_key };
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
