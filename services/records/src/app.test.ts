import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from './app.ts';
import { assessmentRow, event, localKey, MemoryBlobs, MemoryStore, OTHER_TENANT, publicKeyOf, sentBriefRow, TENANT } from './fixtures.ts';

const key = localKey();
const NOW = new Date('2026-10-01T12:00:00.000Z');

function setup(opts: { leaky?: boolean; pinned?: string } = {}) {
  const store = new MemoryStore({ leaky: opts.leaky });
  const blobs = new MemoryBlobs();
  const app = createApp(
    store,
    blobs,
    publicKeyOf(key),
    { signingKeyId: key.keyId, pinnedSpkiSha256: opts.pinned ?? key.spkiSha256, urlTtlSeconds: 3600 },
    { now: () => NOW, newId: () => 'export-1', log: () => {} },
  );
  store.assessmentRows.push(
    assessmentRow(key, { rcicId: TENANT, clientId: 'C-101', timestamp: '2026-09-03T10:00:00.000Z' }),
    assessmentRow(key, { rcicId: TENANT, clientId: 'C-102', timestamp: '2026-09-30T23:59:59.999Z' }),
    assessmentRow(key, { rcicId: TENANT, clientId: 'C-103', timestamp: '2026-10-01T00:00:00.000Z' }),
    assessmentRow(key, { rcicId: OTHER_TENANT, clientId: 'C-900', timestamp: '2026-09-10T10:00:00.000Z' }),
  );
  store.briefRows.push(
    sentBriefRow(key, { rcicId: TENANT, briefId: 'b-1', clientId: 'C-101', sentAt: '2026-09-04T09:00:00.000Z' }),
    sentBriefRow(key, { rcicId: TENANT, briefId: 'b-draft', clientId: 'C-102', sentAt: '2026-09-05T09:00:00.000Z', status: 'draft' }),
    sentBriefRow(key, { rcicId: OTHER_TENANT, briefId: 'b-900', clientId: 'C-900', sentAt: '2026-09-06T09:00:00.000Z' }),
  );
  return { app, store, blobs };
}

const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };

describe('tenant scoping', () => {
  it('refuses both routes without an rcic claim and never touches storage', async () => {
    const { app, store, blobs } = setup();
    for (const e of [event('GET /records', { query: SEPTEMBER, claims: null }), event('POST /exports', { body: SEPTEMBER, claims: {} })]) {
      const res = await app(e);
      assert.equal(res.statusCode, 403);
      assert.equal(JSON.parse(String(res.body)).error, 'missing-tenant-claim');
    }
    assert.deepEqual(store.calls, []);
    assert.equal(blobs.objects.size, 0);
  });

  it('reads only the claim tenant, even when the body names another', async () => {
    const { app, store } = setup();
    const res = await app(event('POST /exports', { body: { ...SEPTEMBER, rcicId: OTHER_TENANT } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(store.calls.sort(), [`assessments:${TENANT}`, `briefs:${TENANT}`]);
  });

  it('falls back to the license claim, same as impacts-service', async () => {
    const { app, store } = setup();
    await app(event('GET /records', { query: SEPTEMBER, claims: { 'custom:rcic_license': TENANT } }));
    assert.ok(store.calls.every((c) => c.endsWith(`:${TENANT}`)));
  });

  it("drops another tenant's rows even if the store returns them", async () => {
    const { app } = setup({ leaky: true });
    const res = await app(event('GET /records', { query: SEPTEMBER }));
    const ids = JSON.parse(String(res.body)).records.map((r: { id: string }) => r.id);
    assert.ok(!ids.some((id: string) => id.includes('C-900') || id === 'b-900'), `leaked: ${ids}`);
    assert.ok(!ids.includes('b-draft'), 'draft brief leaked into the ledger');
    assert.ok(!ids.some((id: string) => id.includes('C-103')), 'out-of-range row leaked');
  });
});

describe('GET /records', () => {
  it('lists signed assessments and sent briefs in range, newest first, with fingerprints only', async () => {
    const { app } = setup();
    const res = await app(event('GET /records', { query: SEPTEMBER }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(String(res.body));
    assert.deepEqual(
      body.records.map((r: { kind: string; id: string }) => `${r.kind}:${r.id}`),
      ['assessment:evt-2026-09-12-ee-draw#C-102', 'brief:b-1', 'assessment:evt-2026-09-12-ee-draw#C-101'],
    );
    for (const r of body.records) {
      assert.match(r.canonicalHash, /^[0-9a-f]{64}$/);
      assert.equal(r.signed, true);
      assert.equal(r.signatureBase64, undefined);
      assert.equal(r.signedPayload, undefined);
    }
  });

  it('filters by kind', async () => {
    const { app } = setup();
    const res = await app(event('GET /records', { query: { ...SEPTEMBER, kinds: 'briefs' } }));
    assert.deepEqual(JSON.parse(String(res.body)).records.map((r: { id: string }) => r.id), ['b-1']);
  });
});

describe('POST /exports', () => {
  it('writes one zip under exports/<tenant>/ and returns a 1-hour link', async () => {
    const { app, blobs } = setup();
    const res = await app(event('POST /exports', { body: { ...SEPTEMBER, kinds: ['assessments', 'briefs'] } }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(String(res.body));
    assert.deepEqual([...blobs.objects.keys()], [`exports/${TENANT}/export-1.zip`]);
    assert.deepEqual(blobs.presigned, [{ key: `exports/${TENANT}/export-1.zip`, ttlSeconds: 3600 }]);
    assert.equal(body.expiresAt, '2026-10-01T13:00:00.000Z');
    assert.deepEqual(body.counts, { assessments: 2, consultantReviews: 0, briefs: 1 });
    assert.equal(body.fileName, 'argus-records-2026-09-01-to-2026-09-30.zip');
    assert.equal(blobs.objects.get(`exports/${TENANT}/export-1.zip`)?.contentType, 'application/zip');
  });

  it('refuses to export when KMS hands back a key other than the pinned one', async () => {
    const { app, blobs } = setup({ pinned: '0'.repeat(64) });
    const res = await app(event('POST /exports', { body: SEPTEMBER }));
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(String(res.body)).error, 'signing-key-fingerprint-mismatch');
    assert.equal(blobs.objects.size, 0);
  });

  const bad: Array<[string, unknown, string]> = [
    ['missing from', { to: '2026-09-30' }, 'from-must-be-yyyy-mm-dd'],
    ['impossible date', { from: '2026-02-30', to: '2026-03-01' }, 'from-must-be-yyyy-mm-dd'],
    ['timestamp instead of date', { from: '2026-09-01T00:00:00Z', to: '2026-09-30' }, 'from-must-be-yyyy-mm-dd'],
    ['reversed range', { from: '2026-09-30', to: '2026-09-01' }, 'from-after-to'],
    ['unknown kind', { ...SEPTEMBER, kinds: ['assessments', 'corrections'] }, 'kinds-must-be-assessments-or-briefs'],
    ['empty kinds', { ...SEPTEMBER, kinds: [] }, 'kinds-must-be-a-non-empty-array'],
  ];
  for (const [name, body, error] of bad) {
    it(`rejects ${name}`, async () => {
      const { app, blobs } = setup();
      const res = await app(event('POST /exports', { body }));
      assert.equal(res.statusCode, 400);
      assert.equal(JSON.parse(String(res.body)).error, error);
      assert.equal(blobs.objects.size, 0);
    });
  }

  it('rejects a body that is not JSON', async () => {
    const { app } = setup();
    const e = event('POST /exports');
    e.body = '{not json';
    const res = await app(e);
    assert.equal(res.statusCode, 400);
  });
});
