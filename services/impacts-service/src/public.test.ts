import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { KMSClient } from '@aws-sdk/client-kms';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { build } from 'esbuild';
import { jwkFromSpki, publicConsultant, sumStats, windowDays } from './public.ts';

// The public routes: GET /public/jwks, GET /public/stats and the consultant
// line on GET /public/verify/{hash}. Runs the real handler, bundled the way
// CDK bundles it, against in-memory tables and a fake KMS. Nothing reaches AWS.

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'node_modules', '.cache', 'argus-test');
const outfile = path.join(outDir, 'impacts-public-handler.mjs');

// The production signing key, KMS key 8b3b43ef-6d27-4193-9da8-f80c95b2dc65,
// exactly as `aws kms get-public-key` returns it (DER SPKI, base64). Its
// SHA-256 is the fingerprint web/src/lib/signature-verify.ts pins.
const KMS_KEY_ID = '8b3b43ef-6d27-4193-9da8-f80c95b2dc65';
const SPKI_B64 = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAETLXkvBXjXKQOEsJEji8ACgbBKlCnrHXHg3aAn8TIysVuGHiq2WvoWtaSA16ueCh3RuxVzkqRRu/AoIt+/eQpyg==';
const PINNED_SPKI_SHA256 = '9eeaa3055e1915ee2c31e6c904c37bdde22eb43e82a08ccf9fba9dfccebe94be';
const SPKI = Buffer.from(SPKI_B64, 'base64');

type Item = Record<string, unknown>;
type Handler = (event: unknown) => Promise<{ statusCode: number; body: string; headers?: Record<string, string> }>;
let handler: Handler;

const HASH = 'a'.repeat(64);
let usersTable: Map<string, Item>;
let usersTableFails = false;
let counterRows: Item[] = [];
const batchGetKeys: Item[][] = [];

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
  Object.assign(process.env, {
    IMPACT_ASSESSMENTS_TABLE: 'assessments',
    TRAINING_CORRECTIONS_TABLE: 'corrections',
    POLICY_RULES_TABLE: 'rules',
    RCIC_USERS_TABLE: 'users',
    PUBLIC_COUNTERS_TABLE: 'counters',
    SIGNING_KEY_ID: KMS_KEY_ID,
    BEDROCK_GUARDRAIL_ID: 'gr-test',
    BEDROCK_GUARDRAIL_VERSION: '7',
    AWS_REGION: 'us-east-1',
  });

  (KMSClient.prototype as { send: unknown }).send = async () => ({ PublicKey: new Uint8Array(SPKI), KeySpec: 'ECC_NIST_P256' });

  (DynamoDBDocumentClient.prototype as { send: unknown }).send = async (cmd: { input: Item }) => {
    const input = cmd.input as { TableName?: string; Key?: Item; RequestItems?: Record<string, { Keys: Item[] }> };
    if (cmd instanceof QueryCommand && input.TableName === 'assessments') {
      return { Items: [{ rcicId: 'R1234567', assessmentKey: 'pe1#c1', canonicalHash: HASH }] };
    }
    if (cmd instanceof GetCommand && input.TableName === 'assessments') {
      return {
        Item: {
          rcicId: 'R1234567',
          assessmentKey: 'pe1#c1',
          clientId: 'c1',
          topic: 'crs-scorecard',
          timestamp: '2026-09-28T17:59:41.766Z',
          canonicalHash: HASH,
          signatureBase64: 'c2ln',
          signingKeyId: KMS_KEY_ID,
          signatureAlgorithm: 'ECDSA_SHA_256',
        },
      };
    }
    if (cmd instanceof GetCommand && input.TableName === 'users') {
      if (usersTableFails) throw new Error('AccessDeniedException');
      return { Item: usersTable.get(String(input.Key?.rcicId)) };
    }
    if (cmd instanceof BatchGetCommand) {
      const keys = input.RequestItems?.counters?.Keys ?? [];
      batchGetKeys.push(keys);
      const wanted = new Set(keys.map((k) => k.counterKey));
      return { Responses: { counters: counterRows.filter((r) => wanted.has(r.counterKey)) } };
    }
    throw new Error(`unexpected command ${cmd.constructor.name} on ${input.TableName}`);
  };

  handler = (await import(outfile)).handler as Handler;
});

beforeEach(() => {
  usersTable = new Map();
  usersTableFails = false;
});

async function get(routeKey: string, pathParameters?: Record<string, string>) {
  const origLog = console.log;
  console.log = () => {};
  try {
    const res = await handler({ routeKey, rawPath: routeKey.split(' ')[1], pathParameters, requestContext: { http: { method: 'GET' } } });
    return { status: res.statusCode, headers: res.headers ?? {}, body: JSON.parse(res.body) };
  } finally {
    console.log = origLog;
  }
}

describe('GET /public/jwks', () => {
  it('fixture is the pinned production key', () => {
    assert.equal(createHash('sha256').update(SPKI).digest('hex'), PINNED_SPKI_SHA256);
  });

  it('returns the KMS key as an ES256 JWK whose x and y are the point inside the PEM', async () => {
    const res = await get('GET /public/jwks');
    assert.equal(res.status, 200);
    assert.equal(res.body.keys.length, 1);
    const jwk = res.body.keys[0];
    assert.deepEqual(
      { kty: jwk.kty, crv: jwk.crv, kid: jwk.kid, alg: jwk.alg, use: jwk.use },
      { kty: 'EC', crv: 'P-256', kid: KMS_KEY_ID, alg: 'ES256', use: 'sig' },
    );
    // The SPKI ends in the uncompressed point 0x04 || x || y, 32 bytes each.
    const point = SPKI.subarray(SPKI.length - 65);
    assert.equal(point[0], 0x04);
    assert.equal(jwk.x, point.subarray(1, 33).toString('base64url'));
    assert.equal(jwk.y, point.subarray(33).toString('base64url'));
  });

  it('round-trips: the JWK imports back to the same SPKI fingerprint', async () => {
    const { body } = await get('GET /public/jwks');
    const der = createPublicKey({ key: body.keys[0], format: 'jwk' }).export({ format: 'der', type: 'spki' });
    assert.equal(createHash('sha256').update(der).digest('hex'), PINNED_SPKI_SHA256);
  });

  it('kid matches the signingKeyId a receipt carries', async () => {
    const jwks = await get('GET /public/jwks');
    const receipt = await get('GET /public/verify/{hash}', { hash: HASH });
    assert.equal(jwks.body.keys[0].kid, receipt.body.signingKeyId);
  });

  it('is cacheable', async () => {
    const res = await get('GET /public/jwks');
    assert.match(res.headers['cache-control'] ?? '', /public, max-age=\d+/);
  });

  it('refuses a key that is not P-256', () => {
    const p384 = generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey.export({ format: 'der', type: 'spki' });
    assert.throws(() => jwkFromSpki(p384, 'k'), /signing-key-is-not-p256/);
  });
});

describe('GET /public/verify/{hash} consultant line', () => {
  it('shows the consultant who opted in', async () => {
    usersTable.set('R1234567', { rcicId: 'R1234567', displayName: 'Priya Sandhu', rcicLicense: 'R512847', preferences: { showIdentityOnPublicReceipts: true } });
    const res = await get('GET /public/verify/{hash}', { hash: HASH });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.consultant, { displayName: 'Priya Sandhu', rcicLicense: 'R512847' });
  });

  it('is null by default, when the preference was never set', async () => {
    usersTable.set('R1234567', { rcicId: 'R1234567', displayName: 'Priya Sandhu', rcicLicense: 'R512847' });
    const res = await get('GET /public/verify/{hash}', { hash: HASH });
    assert.equal(res.body.consultant, null);
  });

  it('is null when the consultant turned it off', async () => {
    usersTable.set('R1234567', { displayName: 'Priya Sandhu', rcicLicense: 'R512847', preferences: { showIdentityOnPublicReceipts: false } });
    assert.equal((await get('GET /public/verify/{hash}', { hash: HASH })).body.consultant, null);
  });

  it('still verifies, with no name, when the consultant row cannot be read', async () => {
    usersTableFails = true;
    const res = await get('GET /public/verify/{hash}', { hash: HASH });
    assert.equal(res.status, 200);
    assert.equal(res.body.canonicalHash, HASH);
    assert.equal(res.body.consultant, null);
  });

  it('never leaks the client or tenant', async () => {
    usersTable.set('R1234567', { displayName: 'Priya Sandhu', rcicLicense: 'R512847', preferences: { showIdentityOnPublicReceipts: true } });
    const res = await get('GET /public/verify/{hash}', { hash: HASH });
    for (const k of ['clientId', 'rcicId', 'assessmentKey', 'narrative']) assert.ok(!(k in res.body), `no ${k}`);
  });

  it('only an explicit true opts in', () => {
    const base = { displayName: 'Priya Sandhu', rcicLicense: 'R512847' };
    for (const v of ['true', 1, {}, null, undefined]) {
      assert.equal(publicConsultant({ ...base, preferences: { showIdentityOnPublicReceipts: v } }), null, String(v));
    }
    assert.equal(publicConsultant({ displayName: ' ', rcicLicense: 'R512847', preferences: { showIdentityOnPublicReceipts: true } }), null);
    assert.equal(publicConsultant(null), null);
  });
});

describe('GET /public/stats', () => {
  it('sums the last 7 UTC days of both counters and reads 14 day rows', async () => {
    const days = windowDays(new Date());
    const old = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10);
    counterRows = [
      { counterKey: `assessments#${days[0]}`, count: 4, lastAt: `${days[0]}T10:00:00.000Z` },
      { counterKey: `assessments#${days[6]}`, count: 3, lastAt: `${days[6]}T09:00:00.000Z` },
      { counterKey: `assessments#${old}`, count: 100, lastAt: `${old}T09:00:00.000Z` },
      { counterKey: `briefs#${days[2]}`, count: 2 },
    ];
    const res = await get('GET /public/stats');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { assessmentsSigned7d: 7, briefsSent7d: 2, lastSignedAt: `${days[0]}T10:00:00.000Z` });
    const keys = batchGetKeys.at(-1)!.map((k) => k.counterKey).sort();
    assert.equal(keys.length, 14);
    assert.ok(keys.includes(`briefs#${days[6]}`));
    assert.ok(!keys.includes(`assessments#${old}`));
  });
});

describe('sumStats', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');

  it('window is today and the 6 days before, in UTC', () => {
    assert.deepEqual(windowDays(now), ['2026-09-29', '2026-09-28', '2026-09-27', '2026-09-26', '2026-09-25', '2026-09-24', '2026-09-23']);
  });

  it('reports zeros and no timestamp when nothing was signed', () => {
    assert.deepEqual(sumStats([], now), { assessmentsSigned7d: 0, briefsSent7d: 0, lastSignedAt: null });
  });

  it('ignores rows outside the window, unknown kinds and bad counts', () => {
    const stats = sumStats(
      [
        { counterKey: 'assessments#2026-09-22', count: 50, lastAt: '2026-09-22T00:00:00.000Z' },
        { counterKey: 'assessments#2026-09-29', count: -5 },
        { counterKey: 'assessments#2026-09-28', count: '9' },
        { counterKey: 'visitors#2026-09-29', count: 9 },
        { counterKey: 'briefs#2026-09-23', count: 1 },
      ],
      now,
    );
    assert.deepEqual(stats, { assessmentsSigned7d: 0, briefsSent7d: 1, lastSignedAt: null });
  });
});
