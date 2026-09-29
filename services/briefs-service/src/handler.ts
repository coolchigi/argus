import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createHash, randomUUID } from 'node:crypto';
import { bumpPublicCounter } from './public-counter';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});
const ses = new SESv2Client({});
const s3 = new S3Client({});

const BRIEFS_TABLE = requiredEnv('BRIEFS_TABLE');
const ALERTS_TABLE = requiredEnv('ALERTS_TABLE');
const RCIC_USERS_TABLE = requiredEnv('RCIC_USERS_TABLE');
const POLICY_RULES_TABLE = requiredEnv('POLICY_RULES_TABLE');
const POLICY_CORPUS_BUCKET = requiredEnv('POLICY_CORPUS_BUCKET');
const SIGNING_KEY_ID = requiredEnv('SIGNING_KEY_ID');
const PUBLIC_COUNTERS_TABLE = process.env.PUBLIC_COUNTERS_TABLE;
const DEFAULT_FROM_EMAIL = requiredEnv('DEFAULT_FROM_EMAIL');
const BATCH_SEND_MAX = Number(process.env.BATCH_SEND_MAX ?? '25');
const ARCHIVE_LINK_TTL_SECONDS = Number(process.env.ARCHIVE_LINK_TTL_SECONDS ?? String(7 * 24 * 60 * 60));
const HEAD_CHECK_TIMEOUT_MS = 3_000;
// Where the "Verify this message" link in the email footer points. The web
// app serves /verify/{hash} for assessment and brief receipts alike.
const PUBLIC_BASE_URL = (process.env.ARGUS_PUBLIC_BASE_URL || 'https://main.d270cjhakw6y7j.amplifyapp.com').replace(/\/+$/, '');
// Relay sending: From "Name via Argus <relay>", Reply-To the consultant. Off
// until the relay domain is verified in SES. While it's off, From is the
// consultant's verified sender, as before.
const RELAY_ENABLED = process.env.BRIEFS_RELAY_ENABLED === 'true';
const RELAY_FROM_EMAIL = process.env.BRIEFS_RELAY_FROM_EMAIL ?? '';
// Brief sends sign the same way Anchor does: KMS Sign, MessageType DIGEST,
// over the SHA-256 of the canonical payload.
const SIGNATURE_SCHEME = 'kms-digest-v1';
const SIGNATURE_ALGORITHM = 'ECDSA_SHA_256';

let cachedPublicKeyPem: string | null = null;

type Citation = {
  sourceUrl: string;
  s3Key: string;
  s3VersionId: string | null;
};

type CitationForEmail = {
  sourceUrl: string;
  sourceIsLive: boolean;
  archiveUrl: string | null;
};

type SendResult = { briefId: string; ok: boolean; sesMessageId?: string; sentBodyHash?: string; error?: string };

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext.http.method;
  const routeKey = event.routeKey ?? `${method} ${event.rawPath}`;
  const rcicId = resolveRcicId(event);

  log('info', 'briefs-request', { routeKey, rcicId, path: event.rawPath });

  try {
    if (!rcicId) throw httpError(403, 'missing-tenant-claim');
    if (routeKey === 'GET /briefs') return json(200, await listBriefs(rcicId));
    if (routeKey === 'GET /briefs/{id}') return json(200, await getBrief(rcicId, requireParam(event, 'id')));
    if (routeKey === 'GET /briefs/{id}/archive-link') return json(200, await getArchiveLink(rcicId, requireParam(event, 'id')));
    if (routeKey === 'GET /briefs/{id}/send-signature') return json(200, await getSendSignature(rcicId, requireParam(event, 'id')));
    if (routeKey === 'POST /briefs/{id}/copied') return json(200, await markCopied(rcicId, requireParam(event, 'id')));
    if (routeKey === 'PATCH /briefs/{id}') return json(200, await patchBrief(rcicId, requireParam(event, 'id'), parseBody(event)));
    if (routeKey === 'POST /briefs/{id}/send') return json(200, await sendOne(rcicId, requireParam(event, 'id'), parseBody(event)));
    if (routeKey === 'POST /briefs/batch-send') return json(200, await sendBatch(rcicId, parseBody(event)));
    return json(404, { error: 'route-not-found', routeKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const httpStatus = (err as { httpStatus?: number }).httpStatus ?? 500;
    log(httpStatus >= 500 ? 'error' : 'info', 'briefs-request-failed', { routeKey, rcicId, error: message, httpStatus });
    return json(httpStatus, { error: message });
  }
};

async function listBriefs(rcicId: string): Promise<{ briefs: Record<string, unknown>[] }> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: BRIEFS_TABLE,
      KeyConditionExpression: 'rcicId = :r',
      ExpressionAttributeValues: { ':r': rcicId },
    }),
  );
  const rows = res.Items ?? [];
  const severities = await loadSeverities(rows.map((r) => (typeof r.ruleHash === 'string' ? r.ruleHash : '')));
  const items = rows
    .map((row): Record<string, unknown> => ({
      ...stripInternal(row),
      policyEventId: policyEventIdOf(row),
      // Sentinel's classification of the rule, read from PolicyRules. Never
      // derived here, so no threshold lives in this service.
      severity: severities.get(String(row.ruleHash ?? '')) ?? null,
    }))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  return { briefs: items };
}

/** Composer stores policyEventId. A row without it still has assessmentKey = `${policyEventId}#${clientId}`. */
function policyEventIdOf(row: Record<string, unknown>): string | null {
  if (typeof row.policyEventId === 'string' && row.policyEventId.length > 0) return row.policyEventId;
  const key = typeof row.assessmentKey === 'string' ? row.assessmentKey : '';
  const cut = key.lastIndexOf('#');
  return cut > 0 ? key.slice(0, cut) : null;
}

type Severity = 'low' | 'medium' | 'high';

async function loadSeverities(ruleHashes: string[]): Promise<Map<string, Severity>> {
  const unique = Array.from(new Set(ruleHashes.filter((h) => h.length > 0)));
  const out = new Map<string, Severity>();
  // BatchGetItem takes at most 100 keys per call.
  for (let i = 0; i < unique.length; i += 100) {
    let keys: Record<string, unknown>[] | undefined = unique.slice(i, i + 100).map((h) => ({ rule_hash: h }));
    for (let attempt = 0; keys && keys.length > 0 && attempt < 3; attempt += 1) {
      const res = await ddb.send(
        new BatchGetCommand({
          RequestItems: {
            [POLICY_RULES_TABLE]: { Keys: keys, ProjectionExpression: 'rule_hash, severity' },
          },
        }),
      );
      for (const r of res.Responses?.[POLICY_RULES_TABLE] ?? []) {
        const sev = r.severity;
        if (typeof r.rule_hash === 'string' && (sev === 'low' || sev === 'medium' || sev === 'high')) out.set(r.rule_hash, sev);
      }
      keys = res.UnprocessedKeys?.[POLICY_RULES_TABLE]?.Keys as Record<string, unknown>[] | undefined;
    }
  }
  return out;
}

async function getBrief(rcicId: string, briefId: string): Promise<Record<string, unknown>> {
  const res = await ddb.send(new GetCommand({ TableName: BRIEFS_TABLE, Key: { rcicId, briefId } }));
  if (!res.Item) throw httpError(404, 'brief-not-found');
  return stripInternal(res.Item);
}

async function patchBrief(rcicId: string, briefId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const existing = await ddb.send(new GetCommand({ TableName: BRIEFS_TABLE, Key: { rcicId, briefId } }));
  if (!existing.Item) throw httpError(404, 'brief-not-found');
  if (existing.Item.status === 'sent') throw httpError(409, 'brief-already-sent');

  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const addField = (field: string, value: unknown) => {
    const nameKey = `#${field}`;
    const valueKey = `:${field}`;
    sets.push(`${nameKey} = ${valueKey}`);
    names[nameKey] = field;
    values[valueKey] = value;
  };

  if (typeof body.subject === 'string') addField('subject', body.subject);
  if (typeof body.editedBodyMarkdown === 'string') addField('editedBodyMarkdown', body.editedBodyMarkdown);
  if (Array.isArray(body.suggestedActions)) addField('suggestedActions', body.suggestedActions.filter((a) => typeof a === 'string').slice(0, 5));
  if (sets.length === 0) throw httpError(400, 'no-editable-fields');

  // A brief the consultant already copied out stays marked as handled.
  addField('status', existing.Item.status === 'sent-externally' ? 'sent-externally' : 'edited');
  addField('updatedAt', new Date().toISOString());

  const res = await ddb.send(
    new UpdateCommand({
      TableName: BRIEFS_TABLE,
      Key: { rcicId, briefId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );
  log('info', 'brief-patched', { rcicId, briefId, fields: Object.keys(names).map((k) => k.slice(1)) });
  return stripInternal(res.Attributes ?? {});
}

async function sendOne(rcicId: string, briefId: string, body: Record<string, unknown>): Promise<{ result: SendResult }> {
  const recipient = normalizeEmail(body.recipientEmail);
  if (!recipient) throw httpError(400, 'recipient-email-required');
  const result = await sendOneInternal(rcicId, briefId, recipient);
  return { result };
}

async function sendBatch(rcicId: string, body: Record<string, unknown>): Promise<{ total: number; succeeded: number; failed: number; results: SendResult[] }> {
  const raw = Array.isArray(body.sends) ? body.sends : null;
  if (!raw) throw httpError(400, 'sends-array-required');
  if (raw.length > BATCH_SEND_MAX) throw httpError(400, `batch-exceeds-max-${BATCH_SEND_MAX}`);

  const results: SendResult[] = [];
  for (const entry of raw) {
    const briefId = typeof (entry as { briefId?: unknown }).briefId === 'string' ? (entry as { briefId: string }).briefId : '';
    const recipient = normalizeEmail((entry as { recipientEmail?: unknown }).recipientEmail);
    if (!briefId || !recipient) {
      results.push({ briefId, ok: false, error: 'missing-briefId-or-recipient' });
      continue;
    }
    try {
      results.push(await sendOneInternal(rcicId, briefId, recipient));
    } catch (err) {
      results.push({ briefId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  return { total: results.length, succeeded, failed: results.length - succeeded, results };
}

async function sendOneInternal(rcicId: string, briefId: string, recipient: string): Promise<SendResult> {
  const briefRes = await ddb.send(new GetCommand({ TableName: BRIEFS_TABLE, Key: { rcicId, briefId } }));
  const brief = briefRes.Item;
  if (!brief) return { briefId, ok: false, error: 'brief-not-found' };
  if (brief.status === 'sent') return { briefId, ok: false, error: 'brief-already-sent' };

  const finalBody = typeof brief.editedBodyMarkdown === 'string' && brief.editedBodyMarkdown.length > 0
    ? brief.editedBodyMarkdown
    : String(brief.bodyMarkdown ?? '');
  const finalSubject = String(brief.subject ?? '');
  const suggestedActions = Array.isArray(brief.suggestedActions) ? (brief.suggestedActions as string[]) : [];

  const ruleHash = typeof brief.ruleHash === 'string' ? brief.ruleHash : '';
  const emailCitation = await buildCitationForEmail(ruleHash, brief);

  const { from: sender, replyTo } = await resolveSender(rcicId);
  const recipientHash = sha256(recipient);
  const recipientDomain = recipient.split('@')[1] ?? '';

  const canonical = {
    briefId,
    rcicId,
    clientId: String(brief.clientId ?? ''),
    subject: finalSubject,
    bodyMarkdown: finalBody,
    suggestedActions,
    recipientHash,
    sender,
    sentAt: new Date().toISOString(),
  };
  const sentBodyHash = sha256Canonical(canonical);
  const sentSignature = await signHash(sentBodyHash);

  const textBody = renderEmailText(finalBody, suggestedActions, emailCitation, {
    briefId,
    verifyUrl: verifyUrlFor(sentBodyHash),
  });

  const sesRes = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: sender,
      ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
      Destination: { ToAddresses: [recipient] },
      Content: {
        Simple: {
          Subject: { Data: finalSubject, Charset: 'UTF-8' },
          Body: { Text: { Data: textBody, Charset: 'UTF-8' } },
        },
      },
    }),
  );
  const sesMessageId = sesRes.MessageId ?? '(no-message-id)';

  await ddb.send(
    new UpdateCommand({
      TableName: BRIEFS_TABLE,
      Key: { rcicId, briefId },
      UpdateExpression:
        'SET #status = :sent, sentBodyMarkdown = :sb, sentBodyHash = :sh, sentSignature = :sig, sentSignatureAlgorithm = :alg, sentSigningKeyId = :kid, sentAt = :ts, sentRecipientHash = :rh, sentRecipientDomain = :rd, sesMessageId = :m, sender = :sender',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':sent': 'sent',
        ':sb': finalBody,
        ':sh': sentBodyHash,
        ':sig': sentSignature,
        ':alg': SIGNATURE_ALGORITHM,
        ':kid': SIGNING_KEY_ID,
        ':ts': canonical.sentAt,
        ':rh': recipientHash,
        ':rd': recipientDomain,
        ':m': sesMessageId,
        ':sender': sender,
      },
    }),
  );

  await ddb.send(
    new PutCommand({
      TableName: ALERTS_TABLE,
      Item: {
        rcicId,
        timestamp: canonical.sentAt,
        briefId,
        clientId: String(brief.clientId ?? ''),
        severity: 'consultant-manual',
        recipientHash,
        recipientDomain,
        sesMessageId,
        sender,
        channel: 'consultant-manual',
        signatureAlgorithm: SIGNATURE_ALGORITHM,
        sentBodyHash,
      },
    }),
  );

  await bumpPublicCounter(ddb, PUBLIC_COUNTERS_TABLE, 'briefs', canonical.sentAt);

  log('info', 'brief-sent', {
    rcicId,
    briefId,
    sesMessageId,
    recipientDomain,
    sentBodyHash,
  });

  return { briefId, ok: true, sesMessageId, sentBodyHash };
}

async function resolveSender(rcicId: string): Promise<{ from: string; replyTo: string | null }> {
  const res = await ddb.send(new GetCommand({ TableName: RCIC_USERS_TABLE, Key: { rcicId } }));
  const email = res.Item?.verifiedSenderEmail;
  const consultantEmail = typeof email === 'string' && email.includes('@') ? email : null;
  if (RELAY_ENABLED && RELAY_FROM_EMAIL.includes('@')) {
    const name = typeof res.Item?.displayName === 'string' ? res.Item.displayName : '';
    return { from: relayFrom(name, RELAY_FROM_EMAIL), replyTo: consultantEmail };
  }
  return { from: consultantEmail ?? DEFAULT_FROM_EMAIL, replyTo: null };
}

/** `"Priya Sandhu via Argus" <briefs@example.ca>`. Quotes, brackets and line breaks in the name are dropped. */
function relayFrom(displayName: string, relayEmail: string): string {
  const clean = displayName.replace(/["<>\r\n\\]/g, '').trim();
  return clean ? `"${clean} via Argus" <${relayEmail}>` : `"Argus" <${relayEmail}>`;
}

function verifyUrlFor(hash: string): string {
  return `${PUBLIC_BASE_URL}/verify/${hash}`;
}

/**
 * Everything a browser needs to check a sent brief's signature, in the same
 * shape as GET /impacts/{id}/audit-signature.
 */
async function getSendSignature(rcicId: string, briefId: string): Promise<Record<string, unknown>> {
  const res = await ddb.send(new GetCommand({ TableName: BRIEFS_TABLE, Key: { rcicId, briefId } }));
  const brief = res.Item;
  if (!brief) throw httpError(404, 'brief-not-found');
  if (typeof brief.sentBodyHash !== 'string' || typeof brief.sentSignature !== 'string') throw httpError(404, 'brief-not-signed');
  return {
    briefId,
    canonicalHash: brief.sentBodyHash,
    signatureBase64: brief.sentSignature,
    signatureAlgorithm: typeof brief.sentSignatureAlgorithm === 'string' ? brief.sentSignatureAlgorithm : SIGNATURE_ALGORITHM,
    signingKeyId: typeof brief.sentSigningKeyId === 'string' ? brief.sentSigningKeyId : SIGNING_KEY_ID,
    publicKeyPem: await loadPublicKeyPem(),
    sentAt: String(brief.sentAt ?? ''),
    scheme: SIGNATURE_SCHEME,
    verification: {
      algorithm: SIGNATURE_ALGORITHM,
      curve: 'P-256',
      messageIsHex: true,
      messageIsHash: true,
      how: 'Decode signatureBase64 from base64; decode canonicalHash from hex; verify with the P-256 public key over the hash itself (no second hash).',
    },
  };
}

/**
 * The consultant copied the brief into their own mail client. Records that
 * in AlertsTable next to Argus sends and marks the brief handled. Nothing is
 * signed, because Argus never sees what actually went out.
 */
async function markCopied(rcicId: string, briefId: string): Promise<Record<string, unknown>> {
  const existing = await ddb.send(new GetCommand({ TableName: BRIEFS_TABLE, Key: { rcicId, briefId } }));
  const brief = existing.Item;
  if (!brief) throw httpError(404, 'brief-not-found');
  if (brief.status === 'sent') throw httpError(409, 'brief-already-sent');

  const copiedAt = new Date().toISOString();
  const res = await ddb
    .send(
      new UpdateCommand({
        TableName: BRIEFS_TABLE,
        Key: { rcicId, briefId },
        UpdateExpression: 'SET #status = :s, copiedAt = :at, updatedAt = :at',
        // A send that lands between the read above and this write wins.
        ConditionExpression: '#status <> :sent',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':s': 'sent-externally', ':at': copiedAt, ':sent': 'sent' },
        ReturnValues: 'ALL_NEW',
      }),
    )
    .catch((err: unknown) => {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') throw httpError(409, 'brief-already-sent');
      throw err;
    });
  await ddb.send(
    new PutCommand({
      TableName: ALERTS_TABLE,
      Item: {
        rcicId,
        timestamp: copiedAt,
        briefId,
        clientId: String(brief.clientId ?? ''),
        channel: 'consultant-copy',
      },
    }),
  );
  log('info', 'brief-copied', { rcicId, briefId });
  return stripInternal(res.Attributes ?? {});
}

async function loadPublicKeyPem(): Promise<string> {
  if (cachedPublicKeyPem) return cachedPublicKeyPem;
  const res = await kms.send(new GetPublicKeyCommand({ KeyId: SIGNING_KEY_ID }));
  if (!res.PublicKey) throw new Error('kms returned no public key');
  const b64 = Buffer.from(res.PublicKey).toString('base64');
  cachedPublicKeyPem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)?.join('\n') ?? b64}\n-----END PUBLIC KEY-----\n`;
  return cachedPublicKeyPem;
}

async function loadCitation(ruleHash: string, briefFallback: Record<string, unknown> | undefined): Promise<Citation | null> {
  if (ruleHash) {
    const res = await ddb.send(new GetCommand({ TableName: POLICY_RULES_TABLE, Key: { rule_hash: ruleHash } }));
    const item = res.Item;
    if (item && typeof item.source_url === 'string' && typeof item.source_s3_key === 'string') {
      return {
        sourceUrl: item.source_url,
        s3Key: item.source_s3_key,
        s3VersionId: typeof item.source_s3_version_id === 'string' ? item.source_s3_version_id : null,
      };
    }
  }
  const url = briefFallback && typeof briefFallback.citationSourceUrl === 'string' ? briefFallback.citationSourceUrl : '';
  if (!url) return null;
  return { sourceUrl: url, s3Key: '', s3VersionId: null };
}

async function checkUrlLive(url: string): Promise<boolean> {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_CHECK_TIMEOUT_MS);
  try {
    // GET with a small Range instead of HEAD. canada.ca and other JS-rendered
    // sites soft-serve HEAD with a 302 that points nowhere real, and report
    // 2xx even when the underlying page 404s. GET with an explicit redirect
    // follow forces the real terminal status, and the Range header keeps us
    // from downloading the whole page.
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Argus/0.1 (link-check)',
        Range: 'bytes=0-127',
      },
    });
    try {
      await res.body?.cancel();
    } catch {
      // ignore cancel errors, we only care about the status
    }
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function presignArchive(s3Key: string, versionId: string | null): Promise<string | null> {
  if (!s3Key) return null;
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: POLICY_CORPUS_BUCKET,
      Key: s3Key,
      ...(versionId ? { VersionId: versionId } : {}),
    }),
    { expiresIn: ARCHIVE_LINK_TTL_SECONDS },
  );
  return url;
}

async function buildCitationForEmail(ruleHash: string, brief: Record<string, unknown>): Promise<CitationForEmail> {
  const citation = await loadCitation(ruleHash, brief);
  if (!citation) return { sourceUrl: '', sourceIsLive: false, archiveUrl: null };
  const [live, archive] = await Promise.all([
    checkUrlLive(citation.sourceUrl),
    presignArchive(citation.s3Key, citation.s3VersionId),
  ]);
  return { sourceUrl: citation.sourceUrl, sourceIsLive: live, archiveUrl: archive };
}

async function getArchiveLink(rcicId: string, briefId: string): Promise<{ archiveUrl: string | null; expiresInSeconds: number; sourceUrl: string; sourceIsLive: boolean }> {
  const briefRes = await ddb.send(new GetCommand({ TableName: BRIEFS_TABLE, Key: { rcicId, briefId } }));
  if (!briefRes.Item) throw httpError(404, 'brief-not-found');
  const brief = briefRes.Item;
  const ruleHash = typeof brief.ruleHash === 'string' ? brief.ruleHash : '';
  const c = await buildCitationForEmail(ruleHash, brief);
  return {
    archiveUrl: c.archiveUrl,
    expiresInSeconds: ARCHIVE_LINK_TTL_SECONDS,
    sourceUrl: c.sourceUrl,
    sourceIsLive: c.sourceIsLive,
  };
}

function renderEmailText(body: string, actions: string[], citation: CitationForEmail, meta: { briefId: string; verifyUrl: string }): string {
  const parts = [body];
  if (actions.length > 0) {
    parts.push('', 'Suggested actions:', ...actions.map((a) => `- ${a}`));
  }
  if (citation.sourceUrl || citation.archiveUrl) {
    parts.push('');
    if (citation.sourceUrl) {
      const label = citation.sourceIsLive ? 'Source' : 'Source (page has moved)';
      parts.push(`${label}: ${citation.sourceUrl}`);
    }
    if (citation.archiveUrl) {
      parts.push(`Archived copy (verified snapshot, expires in 7 days): ${citation.archiveUrl}`);
    }
  }
  parts.push(
    '',
    '---',
    'This message was drafted by Argus and edited by your consultant. Argus signed it when it was sent.',
    `Verify this message: ${meta.verifyUrl}`,
    `Brief id: ${meta.briefId}`,
  );
  return parts.join('\n');
}

// No fallback tenant: a token without an rcic claim must never read another tenant's data.
function resolveRcicId(event: APIGatewayProxyEventV2): string | null {
  const claims = (event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, string> } } }).authorizer?.jwt?.claims;
  const idClaim = claims?.['custom:rcic_id'];
  if (typeof idClaim === 'string' && idClaim.length > 0) return idClaim;
  const licenseClaim = claims?.['custom:rcic_license'];
  if (typeof licenseClaim === 'string' && licenseClaim.length > 0) return licenseClaim;
  return null;
}

function requireParam(event: APIGatewayProxyEventV2, name: string): string {
  const v = event.pathParameters?.[name];
  if (typeof v !== 'string' || v.length === 0) throw httpError(400, `missing-path-param-${name}`);
  return v;
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    throw httpError(400, 'invalid-json-body');
  }
}

function normalizeEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim().toLowerCase();
  if (!trimmed.includes('@')) return null;
  return trimmed;
}

function stripInternal(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    // sentBodyHash is the public receipt fingerprint, so it goes out.
    if (k === 'sentBodyMarkdown' || k === 'sentSignature') continue;
    out[k] = v;
  }
  return out;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
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
  if (!res.Signature) throw new Error('KMS returned no signature');
  return Buffer.from(res.Signature).toString('base64');
}

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function httpError(status: number, code: string): Error & { httpStatus?: number } {
  const err = new Error(code) as Error & { httpStatus?: number };
  err.httpStatus = status;
  return err;
}

function log(level: 'debug' | 'info' | 'error', msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields }));
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
