import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetPublicKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createApp, type PublicKey, type Store } from './app.ts';
import { ASSESSMENT_PROJECTION, BRIEF_PROJECTION, type Range, type Row } from './model.ts';

// DynamoDB, KMS and S3 wiring for /records and /exports. Routes and rules
// live in app.ts. Read-only on both tables. Writes only under exports/ in the
// generated-artifacts bucket, which expires objects after 30 days.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});
const s3 = new S3Client({});

const IMPACT_ASSESSMENTS_TABLE = requiredEnv('IMPACT_ASSESSMENTS_TABLE');
const BRIEFS_TABLE = requiredEnv('BRIEFS_TABLE');
const GENERATED_ARTIFACTS_BUCKET = requiredEnv('GENERATED_ARTIFACTS_BUCKET');
const SIGNING_KEY_ID = requiredEnv('SIGNING_KEY_ID');
const SIGNING_KEY_SPKI_SHA256 = requiredEnv('SIGNING_KEY_SPKI_SHA256');
const EXPORT_URL_TTL_SECONDS = Number(process.env.EXPORT_URL_TTL_SECONDS ?? '3600');

async function queryAll(input: {
  table: string;
  rcicId: string;
  projection: readonly string[];
  filter: string;
  values: Record<string, unknown>;
  extraNames?: Record<string, string>;
}): Promise<Row[]> {
  const names: Record<string, string> = { ...input.extraNames };
  const projection = input.projection.map((field, i) => {
    names[`#p${i}`] = field;
    return `#p${i}`;
  });
  names['#pk'] = 'rcicId';
  const items: Row[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: input.table,
        KeyConditionExpression: '#pk = :r',
        FilterExpression: input.filter,
        ProjectionExpression: projection.join(', '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ':r': input.rcicId, ...input.values },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((res.Items as Row[] | undefined) ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

const store: Store = {
  assessments(rcicId: string, range: Range) {
    return queryAll({
      table: IMPACT_ASSESSMENTS_TABLE,
      rcicId,
      projection: ASSESSMENT_PROJECTION,
      filter: '#ts >= :from AND #ts < :to',
      extraNames: { '#ts': 'timestamp' },
      values: { ':from': range.fromIso, ':to': range.toIsoExclusive },
    });
  },
  sentBriefs(rcicId: string, range: Range) {
    return queryAll({
      table: BRIEFS_TABLE,
      rcicId,
      projection: BRIEF_PROJECTION,
      filter: '#st = :sent AND #sa >= :from AND #sa < :to',
      extraNames: { '#st': 'status', '#sa': 'sentAt' },
      values: { ':sent': 'sent', ':from': range.fromIso, ':to': range.toIsoExclusive },
    });
  },
};

let cachedKey: PublicKey | null = null;

async function publicKey(): Promise<PublicKey> {
  if (cachedKey) return cachedKey;
  const res = await kms.send(new GetPublicKeyCommand({ KeyId: SIGNING_KEY_ID }));
  if (!res.PublicKey) throw new Error('kms-returned-no-public-key');
  cachedKey = { keyId: res.KeyId?.split('/').pop() ?? SIGNING_KEY_ID, spki: res.PublicKey };
  return cachedKey;
}

export const handler = createApp(
  store,
  {
    async put(key, body, opts) {
      await s3.send(
        new PutObjectCommand({
          Bucket: GENERATED_ARTIFACTS_BUCKET,
          Key: key,
          Body: body,
          ContentType: opts.contentType,
          ContentDisposition: `attachment; filename="${opts.fileName}"`,
        }),
      );
    },
    presign(key, ttlSeconds) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: GENERATED_ARTIFACTS_BUCKET, Key: key }), { expiresIn: ttlSeconds });
    },
  },
  publicKey,
  { signingKeyId: SIGNING_KEY_ID, pinnedSpkiSha256: SIGNING_KEY_SPKI_SHA256, urlTtlSeconds: EXPORT_URL_TTL_SECONDS },
);

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
