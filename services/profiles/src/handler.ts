import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { createApp, type Store } from './app.ts';
import type { Row } from './derive.ts';
import { pick } from './validate.ts';

// DynamoDB wiring for the profiles service. Routes and rules live in app.ts.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const CLIENT_PROFILES_TABLE = requiredEnv('CLIENT_PROFILES_TABLE');
const IMPACT_ASSESSMENTS_TABLE = requiredEnv('IMPACT_ASSESSMENTS_TABLE');
const BRIEFS_TABLE = requiredEnv('BRIEFS_TABLE');

const ASSESSMENT_FIELDS = [
  'assessmentKey',
  'policyEventId',
  'ruleHash',
  'clientId',
  'topic',
  'isAffected',
  'impactType',
  'numericDelta',
  'confidence',
  'recommendedAction',
  'timestamp',
  'canonicalHash',
  'signatureAlgorithm',
  // ADR-0004: which record is current, and whether the Auditor disagrees.
  'recordKind',
  'supersedes',
  'auditorStance',
];

// Bodies, subjects and recipient hashes stay in the table.
const BRIEF_FIELDS = ['briefId', 'assessmentKey', 'clientId', 'ruleHash', 'topic', 'status', 'createdAt', 'updatedAt', 'sentAt'];

const store: Store = {
  listProfiles: (rcicId, fields) =>
    queryAll({
      TableName: CLIENT_PROFILES_TABLE,
      KeyConditionExpression: '#pk = :r',
      ...projection(fields, { '#pk': 'rcicId' }),
      ExpressionAttributeValues: { ':r': rcicId },
    }),

  async getProfile(rcicId, clientId, fields) {
    const res = await ddb.send(
      new GetCommand({ TableName: CLIENT_PROFILES_TABLE, Key: { rcicId, clientId }, ...projection(fields), ConsistentRead: true }),
    );
    return res.Item ? pick(res.Item as Row, fields) : null;
  },

  async createProfile(rcicId, item) {
    try {
      await ddb.send(
        new PutCommand({
          TableName: CLIENT_PROFILES_TABLE,
          Item: { ...item, rcicId },
          ConditionExpression: 'attribute_not_exists(clientId)',
        }),
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  },

  async updateProfile(rcicId, clientId, set, remove, fields) {
    const names: Record<string, string> = { '#id': 'clientId' };
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
    const expr = [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : ''].filter(Boolean).join(' ');
    try {
      const res = await ddb.send(
        new UpdateCommand({
          TableName: CLIENT_PROFILES_TABLE,
          Key: { rcicId, clientId },
          UpdateExpression: expr,
          ConditionExpression: 'attribute_exists(#id)',
          ExpressionAttributeNames: names,
          ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
          ReturnValues: 'ALL_NEW',
        }),
      );
      return pick((res.Attributes ?? {}) as Row, fields);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return null;
      throw err;
    }
  },

  listAssessments: (rcicId) =>
    queryAll({
      TableName: IMPACT_ASSESSMENTS_TABLE,
      KeyConditionExpression: '#pk = :r',
      ...projection(ASSESSMENT_FIELDS, { '#pk': 'rcicId' }),
      ExpressionAttributeValues: { ':r': rcicId },
    }),

  listBriefs: (rcicId) =>
    queryAll({
      TableName: BRIEFS_TABLE,
      KeyConditionExpression: '#pk = :r',
      ...projection(BRIEF_FIELDS, { '#pk': 'rcicId' }),
      ExpressionAttributeValues: { ':r': rcicId },
    }),
};

export const handler = createApp(store);

async function queryAll(input: QueryCommandInput): Promise<Row[]> {
  const items: Row[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...((res.Items ?? []) as Row[]));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

// Alias every attribute so reserved words (status, timestamp) never break a projection.
function projection(
  fields: readonly string[],
  extraNames: Record<string, string> = {},
): { ProjectionExpression: string; ExpressionAttributeNames: Record<string, string> } {
  const names: Record<string, string> = { ...extraNames };
  const parts = fields.map((f, i) => {
    names[`#f${i}`] = f;
    return `#f${i}`;
  });
  return { ProjectionExpression: parts.join(', '), ExpressionAttributeNames: names };
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
