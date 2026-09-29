import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createApp, readConfig, type Rule } from './app.ts';

// DynamoDB and EventBridge wiring for the demo lever. Rules live in app.ts.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});

const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');

// Never rule_content: the delta only needs the rule's metadata, and the
// Analyst reads the full rule by hash itself.
const RULE_PROJECTION = 'rule_hash, rule_kind, policy_domain, topic, category, severity, summary, source_url, source_s3_key, captured_at';

export const handler = createApp(
  {
    async getRule(ruleHash) {
      const res = await ddb.send(new GetCommand({ TableName: POLICY_RULES_TABLE, Key: { rule_hash: ruleHash }, ProjectionExpression: RULE_PROJECTION }));
      return (res.Item as Rule | undefined) ?? null;
    },

    // PolicyRules has no index on domain, and it holds one row per captured
    // IRCC page version, so a filtered scan stays small.
    async rulesInDomain(policyDomain) {
      const out: Rule[] = [];
      let startKey: Record<string, unknown> | undefined;
      do {
        const res = await ddb.send(
          new ScanCommand({
            TableName: POLICY_RULES_TABLE,
            FilterExpression: 'policy_domain = :d',
            ExpressionAttributeValues: { ':d': policyDomain },
            ProjectionExpression: RULE_PROJECTION,
            ExclusiveStartKey: startKey,
          }),
        );
        out.push(...((res.Items ?? []) as Rule[]));
        startKey = res.LastEvaluatedKey;
      } while (startKey);
      return out;
    },

    // Same source and detail type as Sentinel, so the existing
    // argus-policy-delta-to-analyst rule routes it.
    async emit(delta) {
      const res = await eb.send(
        new PutEventsCommand({ Entries: [{ Source: 'argus.sentinel', DetailType: 'PolicyDelta', Detail: JSON.stringify(delta) }] }),
      );
      if ((res.FailedEntryCount ?? 0) > 0) throw new Error(`put-events-failed: ${res.Entries?.[0]?.ErrorCode ?? 'unknown'}`);
    },
  },
  readConfig(process.env),
);

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
