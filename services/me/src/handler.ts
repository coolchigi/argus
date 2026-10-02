import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DescribeKeyCommand, GetPublicKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import { createApp, type Store } from './app.ts';
import type { Row, Signing } from './model.ts';

// DynamoDB and KMS wiring for /me. Routes and rules live in app.ts.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const kms = new KMSClient({});

const RCIC_USERS_TABLE = requiredEnv('RCIC_USERS_TABLE');
const CLIENT_PROFILES_TABLE = requiredEnv('CLIENT_PROFILES_TABLE');
const IMPACT_ASSESSMENTS_TABLE = requiredEnv('IMPACT_ASSESSMENTS_TABLE');
const SIGNING_KEY_ID = requiredEnv('SIGNING_KEY_ID');

const CURVES: Record<string, string> = { ECC_NIST_P256: 'P-256' };

const store: Store = {
  async getUser(rcicId) {
    const res = await ddb.send(new GetCommand({ TableName: RCIC_USERS_TABLE, Key: { rcicId }, ConsistentRead: true }));
    return (res.Item as Row | undefined) ?? null;
  },

  async updateUser(rcicId, set, remove, expectedUpdatedAt) {
    const names: Record<string, string> = { '#pk': 'rcicId', '#u': 'updatedAt' };
    const values: Record<string, unknown> = {};
    const sets = Object.entries(set).map(([k, v], i) => {
      names[`#s${i}`] = k;
      values[`:s${i}`] = v;
      return `#s${i} = :s${i}`;
    });
    const removes = remove.map((k, i) => {
      names[`#r${i}`] = k;
      return `#r${i}`;
    });
    let condition = 'attribute_exists(#pk) AND attribute_not_exists(#u)';
    if (expectedUpdatedAt !== null) {
      condition = 'attribute_exists(#pk) AND #u = :expected';
      values[':expected'] = expectedUpdatedAt;
    }
    try {
      const res = await ddb.send(
        new UpdateCommand({
          TableName: RCIC_USERS_TABLE,
          Key: { rcicId },
          UpdateExpression: [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : ''].filter(Boolean).join(' '),
          ConditionExpression: condition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return (res.Attributes as Row | undefined) ?? null;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return null;
      throw err;
    }
  },

  async countClients(rcicId) {
    let count = 0;
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await ddb.send(
        new QueryCommand({
          TableName: CLIENT_PROFILES_TABLE,
          KeyConditionExpression: '#pk = :r',
          ExpressionAttributeNames: { '#pk': 'rcicId' },
          ExpressionAttributeValues: { ':r': rcicId },
          Select: 'COUNT',
          ExclusiveStartKey: startKey,
        }),
      );
      count += res.Count ?? 0;
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return count;
  },

  async hasAssessments(rcicId) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: IMPACT_ASSESSMENTS_TABLE,
        KeyConditionExpression: '#pk = :r',
        ExpressionAttributeNames: { '#pk': 'rcicId' },
        ExpressionAttributeValues: { ':r': rcicId },
        Select: 'COUNT',
        Limit: 1,
      }),
    );
    return (res.Count ?? 0) > 0;
  },
};

// The key never changes for the life of a container, so it's read once. A
// failed read isn't cached: the next request tries again.
let signingPromise: Promise<Signing> | null = null;

async function readSigning(): Promise<Signing> {
  const [pub, desc] = await Promise.all([
    kms.send(new GetPublicKeyCommand({ KeyId: SIGNING_KEY_ID })),
    kms.send(new DescribeKeyCommand({ KeyId: SIGNING_KEY_ID })),
  ]);
  if (!pub.PublicKey) throw new Error('kms-returned-no-public-key');
  const spec = pub.KeySpec ?? desc.KeyMetadata?.KeySpec ?? '';
  return {
    keyId: desc.KeyMetadata?.KeyId ?? SIGNING_KEY_ID,
    algorithm: pub.SigningAlgorithms?.[0] ?? 'unknown',
    curve: CURVES[spec] ?? spec,
    spkiSha256: createHash('sha256').update(pub.PublicKey).digest('hex'),
    createdAt: desc.KeyMetadata?.CreationDate ? desc.KeyMetadata.CreationDate.toISOString() : null,
  };
}

async function signing(): Promise<Signing | null> {
  signingPromise ??= readSigning();
  try {
    return await signingPromise;
  } catch (err) {
    signingPromise = null;
    console.log(JSON.stringify({ level: 'error', msg: 'me-signing-key-unavailable', error: err instanceof Error ? err.message : String(err) }));
    return null;
  }
}

export const handler = createApp(store, signing, { guestRcicId: process.env.GUEST_RCIC_ID });

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
