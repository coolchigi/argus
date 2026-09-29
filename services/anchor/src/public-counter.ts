import { type DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Bumps the landing-page counter in argus-public-counters: one row per kind
// per UTC day, summed over 7 days by GET /public/stats in impacts-service.
// Counts and a timestamp only, never a tenant or client. briefs-service has
// the same helper, since services don't share code.
//
// A failed bump is logged and swallowed. The signed record is already
// written, and a retry of the whole event would skip it as a duplicate, so
// throwing here would lose the count anyway and cost a retry.
export async function bumpPublicCounter(
  ddb: DynamoDBDocumentClient,
  tableName: string | undefined,
  kind: 'assessments' | 'briefs',
  at: string,
): Promise<void> {
  if (!tableName) return;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { counterKey: `${kind}#${at.slice(0, 10)}` },
        UpdateExpression: 'ADD #count :one SET #lastAt = :at',
        ExpressionAttributeNames: { '#count': 'count', '#lastAt': 'lastAt' },
        ExpressionAttributeValues: { ':one': 1, ':at': at },
      }),
    );
  } catch (err) {
    console.log(JSON.stringify({ level: 'error', msg: 'public-counter-failed', kind, error: err instanceof Error ? err.message : String(err) }));
  }
}
