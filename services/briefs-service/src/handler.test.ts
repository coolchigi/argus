import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { type SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';

// Runs the real briefs handler against in-memory tables, a fake SES and a
// fake KMS backed by a real P-256 key. The handler is bundled with esbuild
// (the same tool CDK uses) with the AWS SDK left external, so the SDK
// clients here are the ones the handler uses. Nothing reaches AWS.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'briefs-handler.mjs');

type Item = Record<string, unknown>;
type Handler = (event: unknown) => Promise<{ statusCode: number; body: string }>;

const briefs = new Map<string, Item>();
const alerts: Item[] = [];
const emails: SendEmailCommand['input'][] = [];
const rules = new Map<string, Item>([
  ['rule-high', { rule_hash: 'rule-high', severity: 'high' }],
  ['rule-odd', { rule_hash: 'rule-odd', severity: 'critical' }],
]);
const users = new Map<string, Item>([
  ['R1', { rcicId: 'R1', verifiedSenderEmail: 'consultant@example.ca', displayName: 'Pat "The" Consultant' }],
]);

// KMS Sign with MessageType DIGEST signs the 32 bytes it's given, without
// hashing them again. Node's sign(null, ...) with an EC key does the same.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const spkiDer = publicKey.export({ type: 'spki', format: 'der' });

const key = (rcicId: unknown, briefId: unknown) => `${String(rcicId)}|${String(briefId)}`;

function applyUpdate(item: Item, input: UpdateCommand['input']): void {
  const names = input.ExpressionAttributeNames ?? {};
  const values = input.ExpressionAttributeValues ?? {};
  const expr = String(input.UpdateExpression).replace(/^SET\s+/, '');
  for (const part of expr.split(/,\s*/)) {
    const [lhs, rhs] = part.split(/\s*=\s*/);
    item[names[lhs] ?? lhs] = values[rhs];
  }
}

function brief(over: Item): Item {
  return {
    rcicId: 'R1',
    briefId: 'b1',
    assessmentKey: 'pe1#c1',
    clientId: 'c1',
    policyEventId: 'pe1',
    ruleHash: 'rule-high',
    topic: 'ee-category-draws',
    subject: 'A change to your file',
    bodyMarkdown: 'Hello [CLIENT NAME], IRCC changed a rule.',
    suggestedActions: ['Book a call'],
    status: 'draft',
    createdAt: '2026-09-20T00:00:00.000Z',
    ...over,
  };
}

function put(item: Item) {
  briefs.set(key(item.rcicId, item.briefId), item);
}

async function loadHandler(env: Record<string, string>, tag: string): Promise<Handler> {
  Object.assign(process.env, env);
  // A query string gives a fresh module instance, so module-level config is re-read.
  return (await import(`${pathToFileURL(outfile).href}?${tag}`)).handler as Handler;
}

let handler: Handler;
let relayHandler: Handler;

const baseEnv = {
  BRIEFS_TABLE: 'briefs',
  ALERTS_TABLE: 'alerts',
  RCIC_USERS_TABLE: 'users',
  POLICY_RULES_TABLE: 'rules',
  POLICY_CORPUS_BUCKET: 'corpus',
  SIGNING_KEY_ID: 'key-1',
  DEFAULT_FROM_EMAIL: 'default@example.ca',
  ARGUS_PUBLIC_BASE_URL: 'https://app.example.ca/',
  BRIEFS_RELAY_ENABLED: 'false',
  BRIEFS_RELAY_FROM_EMAIL: 'briefs@relay.example.ca',
  AWS_REGION: 'us-east-1',
};

before(async () => {
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [path.join(here, 'handler.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    outfile,
    logLevel: 'silent',
  });

  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input as Item & { TableName?: string; Key?: Item };
    if (cmd instanceof GetCommand) {
      const k = input.Key ?? {};
      if (input.TableName === 'briefs') return { Item: briefs.get(key(k.rcicId, k.briefId)) };
      if (input.TableName === 'users') return { Item: users.get(String(k.rcicId)) };
      if (input.TableName === 'rules') return { Item: rules.get(String(k.rule_hash)) };
    }
    if (cmd instanceof QueryCommand && input.TableName === 'briefs') {
      const r = (input.ExpressionAttributeValues as Item)[':r'];
      return { Items: [...briefs.values()].filter((b) => b.rcicId === r) };
    }
    if (cmd instanceof BatchGetCommand) {
      const req = (input.RequestItems as Record<string, { Keys: Item[] }>).rules;
      return { Responses: { rules: req.Keys.map((k) => rules.get(String(k.rule_hash))).filter(Boolean) } };
    }
    if (cmd instanceof UpdateCommand && input.TableName === 'briefs') {
      const u = cmd.input;
      const k = u.Key ?? {};
      const item = briefs.get(key(k.rcicId, k.briefId));
      if (!item) throw new Error('update on missing item');
      if (u.ConditionExpression === '#status <> :sent' && item.status === u.ExpressionAttributeValues?.[':sent']) {
        throw Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
      }
      applyUpdate(item, u);
      return { Attributes: { ...item } };
    }
    if (cmd instanceof PutCommand && input.TableName === 'alerts') {
      alerts.push(cmd.input.Item ?? {});
      return {};
    }
    throw new Error(`unexpected command ${cmd.constructor.name} on ${String(input.TableName)}`);
  };

  (KMSClient.prototype as { send: unknown }).send = async (cmd: unknown) => {
    if (cmd instanceof SignCommand) {
      assert.equal(cmd.input.MessageType, 'DIGEST');
      return { Signature: nodeSign(null, Buffer.from(cmd.input.Message as Uint8Array), { key: privateKey, dsaEncoding: 'der' }) };
    }
    if (cmd instanceof GetPublicKeyCommand) return { PublicKey: new Uint8Array(spkiDer) };
    throw new Error('unexpected kms command');
  };

  (SESv2Client.prototype as { send: unknown }).send = async (cmd: SendEmailCommand) => {
    emails.push(cmd.input);
    return { MessageId: `msg-${emails.length}` };
  };

  handler = await loadHandler(baseEnv, 'default');
  relayHandler = await loadHandler({ ...baseEnv, BRIEFS_RELAY_ENABLED: 'true' }, 'relay');
  Object.assign(process.env, baseEnv);
});

beforeEach(() => {
  briefs.clear();
  alerts.length = 0;
  emails.length = 0;
});

async function call(h: Handler, routeKey: string, opts: { id?: string; body?: Item; tenant?: string } = {}) {
  const origLog = console.log;
  console.log = () => {};
  try {
    const res = await h({
      routeKey,
      rawPath: '/briefs',
      pathParameters: opts.id ? { id: opts.id } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      requestContext: {
        http: { method: routeKey.split(' ')[0] },
        authorizer: { jwt: { claims: { 'custom:rcic_id': opts.tenant ?? 'R1' } } },
      },
    });
    return { status: res.statusCode, body: JSON.parse(res.body) as Item };
  } finally {
    console.log = origLog;
  }
}

describe('GET /briefs', () => {
  it('returns the sent-body fingerprint and never the signature or the sent body', async () => {
    put(brief({ status: 'sent', sentBodyHash: 'a'.repeat(64), sentSignature: 'sig', sentBodyMarkdown: 'Hello Priya' }));
    const { status, body } = await call(handler, 'GET /briefs');
    assert.equal(status, 200);
    const [b] = body.briefs as Item[];
    assert.equal(b.sentBodyHash, 'a'.repeat(64));
    assert.ok(!('sentSignature' in b));
    assert.ok(!('sentBodyMarkdown' in b));
  });

  it("joins Sentinel's severity by rule hash and ignores values outside low, medium, high", async () => {
    put(brief({ briefId: 'b-high', ruleHash: 'rule-high' }));
    put(brief({ briefId: 'b-odd', ruleHash: 'rule-odd' }));
    put(brief({ briefId: 'b-none', ruleHash: 'rule-missing' }));
    const { body } = await call(handler, 'GET /briefs');
    const byId = new Map((body.briefs as Item[]).map((b) => [b.briefId, b]));
    assert.equal(byId.get('b-high')?.severity, 'high');
    assert.equal(byId.get('b-odd')?.severity, null);
    assert.equal(byId.get('b-none')?.severity, null);
  });

  it('falls back to the event id inside assessmentKey when the row has no policyEventId', async () => {
    put(brief({ policyEventId: undefined, assessmentKey: 'rule-abc#run-2#c1' }));
    const { body } = await call(handler, 'GET /briefs');
    assert.equal((body.briefs as Item[])[0].policyEventId, 'rule-abc#run-2');
  });
});

describe('POST /briefs/{id}/send', () => {
  it('puts a verify link to the configured base and the signed hash in the footer', async () => {
    put(brief({}));
    const { status, body } = await call(handler, 'POST /briefs/{id}/send', { id: 'b1', body: { recipientEmail: 'Someone@Example.org' } });
    assert.equal(status, 200);
    const hash = String((body.result as Item).sentBodyHash);
    assert.match(hash, /^[0-9a-f]{64}$/);
    const text = String(emails[0].Content?.Simple?.Body?.Text?.Data);
    assert.ok(text.includes(`Verify this message: https://app.example.ca/verify/${hash}`), text);
    assert.doesNotMatch(text, /Assessment hash/);
    // The stored hash is the one the public verify lookup is keyed on.
    assert.equal(briefs.get('R1|b1')?.sentBodyHash, hash);
    assert.equal(briefs.get('R1|b1')?.sentSigningKeyId, 'key-1');
  });

  it('keeps hashing the recipient and sends From the consultant with relay off', async () => {
    put(brief({}));
    await call(handler, 'POST /briefs/{id}/send', { id: 'b1', body: { recipientEmail: 'someone@example.org' } });
    assert.equal(emails[0].FromEmailAddress, 'consultant@example.ca');
    assert.equal(emails[0].ReplyToAddresses, undefined);
    const row = briefs.get('R1|b1') ?? {};
    assert.equal(row.sentRecipientHash, createHash('sha256').update('someone@example.org').digest('hex'));
    assert.ok(!JSON.stringify(row).includes('someone@example.org'), 'plaintext recipient never stored');
  });

  it('sends From "Name via Argus" with Reply-To the consultant when relay is on', async () => {
    put(brief({}));
    await call(relayHandler, 'POST /briefs/{id}/send', { id: 'b1', body: { recipientEmail: 'someone@example.org' } });
    assert.equal(emails[0].FromEmailAddress, '"Pat The Consultant via Argus" <briefs@relay.example.ca>');
    assert.deepEqual(emails[0].ReplyToAddresses, ['consultant@example.ca']);
  });
});

describe('GET /briefs/{id}/send-signature', () => {
  it('returns a receipt that verifies over the hash itself with the returned key', async () => {
    put(brief({}));
    await call(handler, 'POST /briefs/{id}/send', { id: 'b1', body: { recipientEmail: 'someone@example.org' } });
    const { status, body } = await call(handler, 'GET /briefs/{id}/send-signature', { id: 'b1' });
    assert.equal(status, 200);
    assert.equal(body.briefId, 'b1');
    assert.equal(body.scheme, 'kms-digest-v1');
    assert.equal(body.signingKeyId, 'key-1');
    assert.equal(body.canonicalHash, briefs.get('R1|b1')?.sentBodyHash);
    const ok = nodeVerify(
      null,
      Buffer.from(String(body.canonicalHash), 'hex'),
      { key: String(body.publicKeyPem), dsaEncoding: 'der' },
      Buffer.from(String(body.signatureBase64), 'base64'),
    );
    assert.equal(ok, true);
  });

  it('is a 404 for a brief that was never sent', async () => {
    put(brief({}));
    const { status, body } = await call(handler, 'GET /briefs/{id}/send-signature', { id: 'b1' });
    assert.equal(status, 404);
    assert.equal(body.error, 'brief-not-signed');
  });

  it("is a 404 for another consultant's brief", async () => {
    put(brief({ rcicId: 'R2', status: 'sent', sentBodyHash: 'a'.repeat(64), sentSignature: 'c2ln' }));
    const { status } = await call(handler, 'GET /briefs/{id}/send-signature', { id: 'b1' });
    assert.equal(status, 404);
  });
});

describe('POST /briefs/{id}/copied', () => {
  it('marks the brief copied and logs a consultant-copy row without signing anything', async () => {
    put(brief({ status: 'edited' }));
    const { status, body } = await call(handler, 'POST /briefs/{id}/copied', { id: 'b1' });
    assert.equal(status, 200);
    assert.equal(body.status, 'sent-externally');
    assert.equal(typeof body.copiedAt, 'string');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].channel, 'consultant-copy');
    assert.equal(alerts[0].briefId, 'b1');
    assert.equal(alerts[0].rcicId, 'R1');
    const row = briefs.get('R1|b1') ?? {};
    assert.ok(!('sentSignature' in row) && !('sentBodyHash' in row));
    assert.equal(emails.length, 0);
  });

  it('refuses a brief Argus already sent', async () => {
    put(brief({ status: 'sent' }));
    const { status, body } = await call(handler, 'POST /briefs/{id}/copied', { id: 'b1' });
    assert.equal(status, 409);
    assert.equal(body.error, 'brief-already-sent');
    assert.equal(alerts.length, 0);
  });

  it('is a 404 for a missing brief', async () => {
    const { status } = await call(handler, 'POST /briefs/{id}/copied', { id: 'nope' });
    assert.equal(status, 404);
  });

  it('keeps a copied brief marked handled when it is edited afterwards', async () => {
    put(brief({ status: 'sent-externally' }));
    const { body } = await call(handler, 'PATCH /briefs/{id}', { id: 'b1', body: { subject: 'Fixed typo' } });
    assert.equal(body.status, 'sent-externally');
    assert.equal(body.subject, 'Fixed typo');
  });
});
