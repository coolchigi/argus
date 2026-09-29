import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { p256 } from '@noble/curves/nist.js';
import { createApp } from './app.ts';
import { assessmentRow, event, localKey, MemoryBlobs, MemoryStore, OTHER_TENANT, publicKeyOf, sentBriefRow, signDigest, TENANT } from './fixtures.ts';
import { KEY_FILE, OPENSSL_COMMANDS, RECORDS_FILE, VERIFY_FILE } from './verify-doc.ts';

// End to end: export September, unzip with the system unzip, pull the Node
// script out of VERIFY.md exactly as a consultant would copy it, and run it.
// The fixture signs digests with a local P-256 key the way KMS does, one of
// them high-S, so the script only passes with prehash off and low-S off.

// The scratch directory sits inside the service so the script resolves
// @noble/curves from this package's node_modules, like `npm install` would.
const SERVICE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const key = localKey('8b3b43ef-local');
let dir = '';
let records: Array<Record<string, any>> = [];
let verifyDoc = '';

function has(bin: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
}

function runScript(): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, ['verify.mjs', RECORDS_FILE, KEY_FILE], { cwd: dir, encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

function writeRecords(rs: Array<Record<string, unknown>>): void {
  writeFileSync(join(dir, RECORDS_FILE), rs.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

before(async () => {
  const store = new MemoryStore();
  const blobs = new MemoryBlobs();
  store.assessmentRows.push(
    assessmentRow(key, { rcicId: TENANT, clientId: 'C-101', timestamp: '2026-09-03T10:00:00.000Z', extra: { clientName: 'PII-SHOULD-NOT-LEAVE' } }),
    assessmentRow(key, { rcicId: TENANT, clientId: 'C-102', timestamp: '2026-09-18T15:30:00.000Z', numericDelta: null, auditIssues: ['cutoff date unclear'] }, { highS: true }),
    assessmentRow(key, { rcicId: TENANT, clientId: 'C-103', timestamp: '2026-08-31T23:59:59.999Z' }),
    assessmentRow(key, { rcicId: OTHER_TENANT, clientId: 'C-900', timestamp: '2026-09-10T10:00:00.000Z' }),
  );
  store.briefRows.push(sentBriefRow(key, { rcicId: TENANT, briefId: 'b-1', clientId: 'C-101', sentAt: '2026-09-04T09:00:00.000Z' }));
  const app = createApp(
    store,
    blobs,
    publicKeyOf(key),
    { signingKeyId: key.keyId, pinnedSpkiSha256: key.spkiSha256, urlTtlSeconds: 3600 },
    { now: () => new Date('2026-10-01T12:00:00.000Z'), newId: () => 'export-1', log: () => {} },
  );
  const res = await app(event('POST /exports', { body: { from: '2026-09-01', to: '2026-09-30' } }));
  assert.equal(res.statusCode, 200, String(res.body));

  dir = mkdtempSync(join(SERVICE_DIR, '.verify-'));
  const zipPath = join(dir, 'export.zip');
  writeFileSync(zipPath, blobs.objects.get(`exports/${TENANT}/export-1.zip`)!.body);
  execFileSync('unzip', ['-q', zipPath, '-d', dir]);
  verifyDoc = readFileSync(join(dir, VERIFY_FILE), 'utf8');
  records = readFileSync(join(dir, RECORDS_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  const script = verifyDoc.match(/```js\n([\s\S]*?)\n```/)?.[1];
  assert.ok(script, 'VERIFY.md has no js block');
  writeFileSync(join(dir, 'verify.mjs'), script);
});

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('signed export', () => {
  it('holds only this tenant, in range, and a high-S signature', () => {
    assert.deepEqual(
      records.map((r) => `${r.kind}:${r.id}`),
      ['assessment:evt-2026-09-12-ee-draw#C-102', 'brief:b-1', 'assessment:evt-2026-09-12-ee-draw#C-101'],
    );
    const highS = records.find((r) => r.id.endsWith('C-102'))!;
    assert.ok(p256.Signature.fromBytes(Buffer.from(highS.signatureBase64, 'base64'), 'der').hasHighS(), 'fixture should carry a high-S signature');
    for (const r of records.filter((r) => r.kind === 'assessment')) {
      assert.match(r.signatureBase64, /^[A-Za-z0-9+/]+=*$/);
      assert.equal(r.signingKeyId, key.keyId);
    }
  });

  it('leaves out every client detail except the opaque client ID', () => {
    const raw = readFileSync(join(dir, RECORDS_FILE), 'utf8');
    for (const marker of ['PII-SHOULD-NOT-LEAVE', 'Maria', 'SUBJECT-', 'BODY-', 'EDITED-', 'SENTBODY-', 'ACTION-', '416-555', 'maria-gonzalez-family.ca', 'ses-0100018f', 'Recipient', 'recipient']) {
      assert.ok(!raw.includes(marker), `export contains ${marker}`);
    }
    const brief = records.find((r) => r.kind === 'brief')!;
    assert.deepEqual(Object.keys(brief).sort(), [
      'assessmentKey', 'canonicalHash', 'clientId', 'id', 'kind', 'policyEventId', 'signatureAlgorithm', 'signatureBase64', 'signedAt', 'signedPayload', 'signingKeyId', 'topic',
    ]);
  });

  it('ships the key that signed, and VERIFY.md pins its fingerprint', () => {
    assert.ok(verifyDoc.includes(key.spkiSha256));
    const pem = readFileSync(join(dir, KEY_FILE), 'utf8');
    assert.match(pem, /^-----BEGIN PUBLIC KEY-----\n/);
  });

  it('re-verifies every record with the script from VERIFY.md', () => {
    const { status, out } = runScript();
    assert.equal(status, 0, out);
    const lines = out.trim().split('\n');
    assert.equal(lines.length, 3, out);
    assert.ok(lines.every((l) => l.startsWith('OK ')), out);
    assert.ok(out.includes('signature valid, payload matches'), out);
  });

  it('fails a record whose narrative was changed after signing', () => {
    const edited = structuredClone(records);
    edited[0].signedPayload.narrative += ' Edited.';
    writeRecords(edited);
    try {
      const { status, out } = runScript();
      assert.equal(status, 1, out);
      assert.match(out, /FAIL assessment evt-2026-09-12-ee-draw#C-102 signature valid, payload CHANGED/);
    } finally {
      writeRecords(records);
    }
  });

  it('fails a signature made by a different key', () => {
    const forged = structuredClone(records);
    forged[2].signatureBase64 = signDigest(localKey(), forged[2].canonicalHash);
    writeRecords(forged);
    try {
      const { status, out } = runScript();
      assert.equal(status, 1, out);
      assert.match(out, /FAIL assessment evt-2026-09-12-ee-draw#C-101 signature INVALID/);
    } finally {
      writeRecords(records);
    }
  });

  it('refuses a swapped public key', () => {
    const original = readFileSync(join(dir, KEY_FILE), 'utf8');
    const other = localKey();
    writeFileSync(join(dir, KEY_FILE), `-----BEGIN PUBLIC KEY-----\n${Buffer.from(other.spki).toString('base64')}\n-----END PUBLIC KEY-----\n`);
    try {
      const { status, out } = runScript();
      assert.equal(status, 1, out);
      assert.match(out, /FAIL key fingerprint/);
    } finally {
      writeFileSync(join(dir, KEY_FILE), original);
    }
  });

  const openssl = has('openssl') && has('xxd');
  it('re-verifies a record with the OpenSSL commands from VERIFY.md', { skip: !openssl && 'openssl or xxd not installed' }, () => {
    assert.ok(verifyDoc.includes(OPENSSL_COMMANDS));
    for (const r of records) {
      const ok = spawnSync('sh', ['-c', OPENSSL_COMMANDS], { cwd: dir, encoding: 'utf8', env: { ...process.env, HASH: r.canonicalHash, SIG: r.signatureBase64 } });
      assert.equal(ok.status, 0, `${r.id}: ${ok.stdout}${ok.stderr}`);
      assert.match(ok.stdout, /Signature Verified Successfully/);
    }
    const wrongHash = records[0].canonicalHash.replace(/^./, (c: string) => (c === '0' ? '1' : '0'));
    const bad = spawnSync('sh', ['-c', OPENSSL_COMMANDS], { cwd: dir, encoding: 'utf8', env: { ...process.env, HASH: wrongHash, SIG: records[0].signatureBase64 } });
    assert.notEqual(bad.status, 0, 'openssl accepted a signature over a different hash');
  });
});
