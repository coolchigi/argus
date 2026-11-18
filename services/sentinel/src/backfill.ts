// Fills in rule_changes on rule rows captured before Sentinel stored them. Without
// it the demo and Recall, which replay stored rows, keep reading the whole page.
//
// Dry run by default. Writes only with --apply, and only rows with no rule_changes.
// Adds one field, deletes nothing. Run from services/sentinel:
//   POLICY_CORPUS_BUCKET=<name> node --experimental-strip-types src/backfill.ts [--apply]
//
// An assessment signed before this ran has one entry in rulesUsed, which says its
// agents read rule_content, so a replay of it should read that (ADR-0001). No replay
// code exists yet to do that.

import type { ListObjectVersionsCommandOutput } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { ruleChanges, hasChanges, type RuleChanges } from './changes.ts';
import { extractMainText } from './extract.ts';

export type RuleRow = {
  rule_hash: string;
  source_url?: string;
  source_s3_key?: string;
  source_s3_version_id?: string | null;
  captured_at?: string;
  rule_changes?: unknown;
};

export type Plan = { status: 'ready'; changes: RuleChanges } | { status: 'skip'; reason: string };

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** `versionIds` runs newest first, as S3 lists them. */
export async function planRow(row: RuleRow, versionIds: string[], readVersion: (versionId: string) => Promise<string>): Promise<Plan> {
  if (row.rule_changes) return { status: 'skip', reason: 'already has rule_changes' };
  if (!row.source_s3_version_id || !row.source_url || !row.captured_at) return { status: 'skip', reason: 'no source version on the row' };

  const at = versionIds.indexOf(row.source_s3_version_id);
  if (at === -1) return { status: 'skip', reason: 'source version not found in S3' };

  const html = await readVersion(row.source_s3_version_id);
  // A row captured with an older extractor doesn't hash to its own snapshot now.
  // Its diff would not describe the text stored under its hash, so it stays as is.
  if (sha256(extractMainText(html)) !== row.rule_hash) return { status: 'skip', reason: 'row hash does not match its snapshot with this extractor' };

  // The nearest earlier version with different text. Some early snapshots repeat it.
  for (const versionId of versionIds.slice(at + 1)) {
    const previous = await readVersion(versionId);
    const previousHash = sha256(extractMainText(previous));
    if (previousHash === row.rule_hash) continue;
    const changes = ruleChanges({
      previousText: extractMainText(previous, { keepListDepth: true }),
      text: extractMainText(html, { keepListDepth: true }),
      previousHash,
      sourceUrl: row.source_url,
      detectedAt: row.captured_at,
    });
    return hasChanges(changes) ? { status: 'ready', changes } : { status: 'skip', reason: 'no real change from the earlier version' };
  }
  return { status: 'skip', reason: 'no earlier version in S3' };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
  const { GetObjectCommand, ListObjectVersionsCommand, S3Client } = await import('@aws-sdk/client-s3');

  const region = process.env.AWS_REGION ?? 'us-east-1';
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  const s3 = new S3Client({ region });
  const table = process.env.POLICY_RULES_TABLE ?? 'argus-policy-rules';
  const bucket = process.env.POLICY_CORPUS_BUCKET;
  if (!bucket) throw new Error('Set POLICY_CORPUS_BUCKET. The name is in the PolicyCorpusBucketName stack output.');

  const rows: RuleRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    // rule_content stays out: the check above hashes the snapshot instead.
    const res: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(new ScanCommand({
      TableName: table,
      ProjectionExpression: 'rule_hash, source_url, source_s3_key, source_s3_version_id, captured_at, rule_changes',
      ExclusiveStartKey,
    }));
    rows.push(...((res.Items ?? []) as unknown as RuleRow[]));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const counts = { ready: 0, skipped: 0, written: 0 };
  for (const row of rows) {
    const key = row.source_s3_key;
    const versionIds: string[] = [];
    if (key) {
      let KeyMarker: string | undefined;
      let VersionIdMarker: string | undefined;
      do {
        const res: ListObjectVersionsCommandOutput = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key, KeyMarker, VersionIdMarker }));
        for (const v of res.Versions ?? []) if (v.Key === key && v.VersionId) versionIds.push(v.VersionId);
        KeyMarker = res.NextKeyMarker;
        VersionIdMarker = res.NextVersionIdMarker;
      } while (KeyMarker);
    }
    const read = async (VersionId: string) => (await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, VersionId }))).Body?.transformToString()) ?? '';
    const plan = await planRow(row, versionIds, read);

    const label = `${row.rule_hash.slice(0, 8)} ${row.captured_at?.slice(0, 10) ?? '?'} ${row.source_url?.split('/').slice(-2).join('/') ?? '?'}`;
    if (plan.status === 'skip') {
      counts.skipped += 1;
      console.log(`skip   ${label}: ${plan.reason}`);
      continue;
    }
    counts.ready += 1;
    const c = plan.changes;
    console.log(`ready  ${label}: +${c.added_lines} -${c.removed_lines} moved ${c.moved_lines}, ${c.text.length} chars`);
    if (apply) {
      await ddb.send(new UpdateCommand({
        TableName: table,
        Key: { rule_hash: row.rule_hash },
        UpdateExpression: 'SET rule_changes = :changes',
        ConditionExpression: 'attribute_exists(rule_hash) AND attribute_not_exists(rule_changes)',
        ExpressionAttributeValues: { ':changes': { ...c, backfilled_at: new Date().toISOString() } },
      }));
      counts.written += 1;
    }
  }
  console.log(`${apply ? 'APPLIED' : 'DRY RUN, nothing written'}: ${JSON.stringify(counts)}`);
}

if (process.argv[1]?.endsWith('backfill.ts')) await main();
