import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createApp, type Store } from './app.ts';
import type { Row } from './derive.ts';

// An in-memory store shaped like argus-client-profiles, argus-impact-assessments
// and argus-briefs. It returns whole rows, `notes` and `age` included, so the
// tests prove the app strips them rather than trusting the projection.

const TENANT = 'R000001';
const OTHER = 'R000002';

class MemoryStore implements Store {
  profiles = new Map<string, Row>();
  assessments: Row[] = [];
  briefs: Row[] = [];
  writes: Array<{ op: string; clientId: string }> = [];

  key(rcicId: string, clientId: string) {
    return `${rcicId}|${clientId}`;
  }
  seed(rcicId: string, row: Row) {
    this.profiles.set(this.key(rcicId, String(row.clientId)), { rcicId, ...row });
  }
  async listProfiles(rcicId: string) {
    return [...this.profiles.values()].filter((p) => p.rcicId === rcicId).map((p) => ({ ...p }));
  }
  async getProfile(rcicId: string, clientId: string) {
    const p = this.profiles.get(this.key(rcicId, clientId));
    return p ? { ...p } : null;
  }
  async createProfile(rcicId: string, item: Row) {
    const k = this.key(rcicId, String(item.clientId));
    if (this.profiles.has(k)) return false;
    this.writes.push({ op: 'put', clientId: String(item.clientId) });
    this.profiles.set(k, { ...item, rcicId });
    return true;
  }
  async updateProfile(rcicId: string, clientId: string, set: Row, remove: string[]) {
    const k = this.key(rcicId, clientId);
    const p = this.profiles.get(k);
    if (!p) return null;
    this.writes.push({ op: 'update', clientId });
    const next = { ...p, ...set };
    for (const r of remove) delete next[r];
    this.profiles.set(k, next);
    return { ...next };
  }
  async listAssessments(rcicId: string) {
    return this.assessments.filter((a) => a.rcicId === rcicId);
  }
  async listBriefs(rcicId: string) {
    return this.briefs.filter((b) => b.rcicId === rcicId);
  }
}

function event(routeKey: string, opts: { body?: unknown; id?: string; qs?: Record<string, string>; rcicId?: string | null } = {}): APIGatewayProxyEventV2 {
  const [method, path] = routeKey.split(' ');
  const rcicId = opts.rcicId === undefined ? TENANT : opts.rcicId;
  return {
    version: '2.0',
    routeKey,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    queryStringParameters: opts.qs,
    pathParameters: opts.id !== undefined ? { id: opts.id } : undefined,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      ...(rcicId ? { authorizer: { jwt: { claims: { 'custom:rcic_id': rcicId }, scopes: [] } } } : {}),
    },
  } as unknown as APIGatewayProxyEventV2;
}

type Res = { status: number; body: any; raw: string };

let store: MemoryStore;
let logs: string[];
let call: (e: APIGatewayProxyEventV2) => Promise<Res>;

beforeEach(() => {
  store = new MemoryStore();
  logs = [];
  const app = createApp(store, {
    now: () => new Date('2026-09-28T12:00:00.000Z'),
    log: (_l, msg, fields) => logs.push(JSON.stringify({ msg, ...fields })),
  });
  call = async (e) => {
    const r = await app(e);
    const raw = String(r.body ?? '');
    return { status: r.statusCode ?? 0, body: raw ? JSON.parse(raw) : null, raw };
  };
});

const row = (id: string, extra: Row = {}) => ({ client_id: id, program: 'express-entry', status: 'active', consent_confirmed: 'true', ...extra });

function assessment(clientId: string, ruleHash: string, runId: string, timestamp: string, isAffected: boolean, rcicId = TENANT): Row {
  return {
    rcicId,
    assessmentKey: `${runId}#${clientId}`,
    policyEventId: runId,
    ruleHash,
    clientId,
    topic: 'crs-scorecard',
    isAffected,
    impactType: isAffected ? 'crs-delta' : 'none',
    numericDelta: isAffected ? -12 : null,
    confidence: 'high',
    recommendedAction: 'Review',
    timestamp,
    canonicalHash: `h-${runId}-${clientId}`,
    signatureAlgorithm: 'ECDSA_SHA_256',
  };
}

function brief(clientId: string, ruleHash: string, runId: string, status: string, rcicId = TENANT): Row {
  return {
    rcicId,
    briefId: `b-${runId}-${clientId}-${status}`,
    assessmentKey: `${runId}#${clientId}`,
    clientId,
    ruleHash,
    topic: 'crs-scorecard',
    status,
    createdAt: '2026-09-21T00:00:00.000Z',
    sentAt: status === 'sent' ? '2026-09-22T00:00:00.000Z' : null,
    bodyMarkdown: 'Hello [CLIENT NAME]',
  };
}

describe('POST /profiles/bulk whole-file rejection', () => {
  it('rejects the file on a forbidden column and writes nothing, even with dryRun false', async () => {
    const rows = [row('C-1'), row('C-2'), row('C-3'), row('C-4', { email: 'someone@example.com' })];
    const res = await call(event('POST /profiles/bulk', { body: { rows, dryRun: false } }));
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'forbidden-column', columns: ['email'] });
    assert.equal(store.writes.length, 0);
    assert.ok(!res.raw.includes('someone@example.com'));
  });

  it('then accepts the same file once the column is gone', async () => {
    const rows = [row('C-1'), row('C-2'), row('C-3')];
    const res = await call(event('POST /profiles/bulk', { body: { rows, dryRun: false } }));
    assert.equal(res.status, 200);
    assert.equal(res.body.created, 3);
    assert.equal(store.writes.length, 3);
  });

  it('rejects 501 rows and accepts 500', async () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => row(`C-${i}`));
    const over = await call(event('POST /profiles/bulk', { body: { rows: make(501), dryRun: true } }));
    assert.equal(over.status, 400);
    assert.equal(over.body.error, 'too-many-rows');
    const at = await call(event('POST /profiles/bulk', { body: { rows: make(500), dryRun: true } }));
    assert.equal(at.status, 200);
    assert.equal(at.body.created, 500);
  });
});

describe('POST /profiles/bulk per-row errors', () => {
  it('rejects PII-looking ids and invalid programs per row, and never echoes the PII', async () => {
    const rows = [row('C-1'), row('jane@example.com'), row('613-555-0199'), row('046-454-286'), row('C-5', { program: 'express entry' })];
    const res = await call(event('POST /profiles/bulk', { body: { rows, dryRun: true } }));
    assert.equal(res.status, 200);
    assert.equal(res.body.created, 1);
    assert.deepEqual(
      res.body.rejected.map((r: any) => [r.row, r.clientId, r.errors]),
      [
        [2, null, ['client-id-looks-like-email']],
        [3, null, ['client-id-looks-like-phone']],
        [4, null, ['client-id-looks-like-sin']],
        [5, 'C-5', ['program-invalid']],
      ],
    );
    for (const pii of ['jane@example.com', '613-555-0199', '046-454-286']) {
      assert.ok(!res.raw.includes(pii), `response leaked ${pii}`);
      assert.ok(!logs.join('\n').includes(pii), `log leaked ${pii}`);
    }
  });

  it('rejects ids the guardrail would block and commits the rest', async () => {
    const ids = ['123456789', '123 456 789', '123-456-789', '123-45-6789', 'F-123456789', '2026-042', 'F123456789', 'C-101'];
    const res = await call(event('POST /profiles/bulk', { body: { rows: ids.map((id) => row(id)), dryRun: false } }));
    assert.equal(res.status, 200);
    assert.equal(res.body.created, 3);
    assert.deepEqual(
      res.body.rejected.map((r: any) => [r.row, r.clientId, r.errors]),
      [1, 2, 3, 4, 5].map((n) => [n, null, ['client-id-looks-like-sin']]),
    );
    assert.deepEqual(store.writes.map((w) => w.clientId).sort(), ['2026-042', 'C-101', 'F123456789']);
  });

  it('rejects every copy of a client id that appears twice in the file', async () => {
    const res = await call(event('POST /profiles/bulk', { body: { rows: [row('C-1'), row('C-2'), row('C-1', { program: 'pgwp' })], dryRun: false } }));
    assert.equal(res.body.created, 1);
    assert.deepEqual(
      res.body.rejected.map((r: any) => [r.row, r.errors[0]]),
      [
        [1, 'duplicate-client-id-in-file'],
        [3, 'duplicate-client-id-in-file'],
      ],
    );
    assert.deepEqual(store.writes, [{ op: 'put', clientId: 'C-2' }]);
  });

  it('dryRun writes nothing and reports what a commit would do', async () => {
    store.seed(TENANT, { clientId: 'C-1', program: 'pgp', status: 'active' });
    const rows = [row('C-1'), row('C-2')];
    const res = await call(event('POST /profiles/bulk', { body: { rows, dryRun: true } }));
    assert.equal(res.status, 200);
    assert.equal(res.body.dryRun, true);
    assert.equal(res.body.created, 1);
    assert.deepEqual(res.body.rejected, [{ row: 1, clientId: 'C-1', errors: ['client-exists'] }]);
    assert.equal(store.writes.length, 0);
    assert.equal(store.profiles.size, 1);
  });

  it('imports the permit, sponsor and PR pathway columns and returns them on the detail view', async () => {
    const rows = [
      { client_id: 'C-PGP', program: 'pgp', status: 'active', consent_confirmed: 'yes', pgp_sponsor_status: 'no-interest-form' },
      { client_id: 'C-SP', program: 'study-permit', status: 'active', consent_confirmed: 'yes', dli_type: 'public', study_start_date: '2027-01-11' },
      { client_id: 'C-PGWP', program: 'pgwp', status: 'active', consent_confirmed: 'yes', study_permit_applied_date: '2024-11-20' },
      { client_id: 'C-OWP', program: 'sowp', status: 'active', consent_confirmed: 'yes', principal_pr_pathway: 'none', principal_pr_applied: 'false' },
      { client_id: 'C-BAD', program: 'study-permit', status: 'active', consent_confirmed: 'yes', dli_type: 'college' },
    ];
    const res = await call(event('POST /profiles/bulk', { body: { rows, dryRun: false } }));
    assert.equal(res.status, 200);
    assert.equal(res.body.created, 4);
    assert.deepEqual(res.body.rejected, [{ row: 5, clientId: 'C-BAD', errors: ['dli_type-must-be-a-listed-value'] }]);

    const detail = async (id: string) => (await call(event('GET /profiles/{id}', { id }))).body.client;
    assert.equal((await detail('C-PGP')).pgpSponsorStatus, 'no-interest-form');
    const sp = await detail('C-SP');
    assert.deepEqual([sp.dliType, sp.studyStartDate], ['public', '2027-01-11']);
    assert.equal((await detail('C-PGWP')).studyPermitAppliedDate, '2024-11-20');
    const owp = await detail('C-OWP');
    assert.deepEqual([owp.principalPrPathway, owp.principalPrApplied], ['none', false]);
  });

  it('treats a missing dryRun as a dry run', async () => {
    const res = await call(event('POST /profiles/bulk', { body: { rows: [row('C-9')] } }));
    assert.equal(res.body.dryRun, true);
    assert.equal(store.writes.length, 0);
  });

  it('never overwrites an existing client unless the import is an explicit update', async () => {
    store.seed(TENANT, { clientId: 'C-1', program: 'pgp', status: 'active', currentCrsScore: 400 });
    const plain = await call(event('POST /profiles/bulk', { body: { rows: [row('C-1', { current_crs_score: '999' })], dryRun: false } }));
    assert.equal(plain.body.created, 0);
    assert.equal(store.profiles.get(`${TENANT}|C-1`)?.currentCrsScore, 400);

    const upd = await call(event('POST /profiles/bulk', { body: { rows: [row('C-1', { current_crs_score: '999' })], dryRun: false, update: true } }));
    assert.equal(upd.body.updated, 1);
    assert.equal(store.profiles.get(`${TENANT}|C-1`)?.currentCrsScore, 999);
  });

  it('only sees the caller tenant when checking for existing clients', async () => {
    store.seed(OTHER, { clientId: 'C-1', program: 'pgp', status: 'active' });
    const res = await call(event('POST /profiles/bulk', { body: { rows: [row('C-1')], dryRun: false } }));
    assert.equal(res.body.created, 1);
    assert.equal(store.profiles.get(`${OTHER}|C-1`)?.program, 'pgp');
  });
});

describe('GET /profiles derived counts', () => {
  const RULE_A = 'a'.repeat(64);
  const RULE_B = 'b'.repeat(64);

  beforeEach(() => {
    store.seed(TENANT, { clientId: 'C-1', program: 'express-entry', status: 'active', currentCrsScore: 489, age: 29, notes: 'software developer, call Priya' });
    store.seed(TENANT, { clientId: 'C-2', program: 'pgwp', status: 'closed', age: 23 });
    store.seed(TENANT, { clientId: 'C-3', program: 'pgp', status: 'active' });
  });

  it('counts two runs of one rule once, on the latest run', async () => {
    // C-1: rule A run twice. First run affected, replay not affected. Rule B affected once.
    store.assessments.push(
      assessment('C-1', RULE_A, 'run-a1', '2026-09-20T10:00:00.000Z', true),
      assessment('C-1', RULE_A, 'run-a2', '2026-09-25T10:00:00.000Z', false),
      assessment('C-1', RULE_B, 'run-b1', '2026-09-24T10:00:00.000Z', true),
    );
    const res = await call(event('GET /profiles'));
    const c1 = res.body.clients.find((c: any) => c.clientId === 'C-1');
    assert.equal(c1.assessedCount, 2);
    assert.equal(c1.affectedCount, 1);
    assert.equal(c1.unsentBriefs, 1);
    assert.equal(c1.lastAssessedAt, '2026-09-25T10:00:00.000Z');
    assert.deepEqual(c1.latestAffected, { assessmentKey: 'run-b1#C-1', policyEventId: 'run-b1', topic: 'crs-scorecard' });
  });

  it('counts a brief sent on an earlier run as covering the replay', async () => {
    store.assessments.push(
      assessment('C-1', RULE_A, 'run-a1', '2026-09-20T10:00:00.000Z', true),
      assessment('C-1', RULE_A, 'run-a2', '2026-09-25T10:00:00.000Z', true),
    );
    store.briefs.push(brief('C-1', RULE_A, 'run-a1', 'sent'), brief('C-1', RULE_A, 'run-a2', 'draft'));
    const res = await call(event('GET /profiles'));
    const c1 = res.body.clients.find((c: any) => c.clientId === 'C-1');
    assert.equal(c1.affectedCount, 1);
    assert.equal(c1.unsentBriefs, 0);
  });

  it('counts a brief the consultant copied out as delivered', async () => {
    store.assessments.push(assessment('C-1', RULE_A, 'run-a1', '2026-09-20T10:00:00.000Z', true));
    store.briefs.push(brief('C-1', RULE_A, 'run-a1', 'sent-externally'));
    const res = await call(event('GET /profiles'));
    const c1 = res.body.clients.find((c: any) => c.clientId === 'C-1');
    assert.equal(c1.unsentBriefs, 0);
  });

  it('gives never-assessed clients zero counts and filters on needsAction, status and program', async () => {
    store.assessments.push(assessment('C-1', RULE_A, 'run-a1', '2026-09-20T10:00:00.000Z', true));
    const all = await call(event('GET /profiles'));
    assert.equal(all.body.total, 3);
    const c3 = all.body.clients.find((c: any) => c.clientId === 'C-3');
    assert.deepEqual([c3.assessedCount, c3.affectedCount, c3.unsentBriefs, c3.lastAssessedAt, c3.latestAffected], [0, 0, 0, null, null]);

    const needs = await call(event('GET /profiles', { qs: { needsAction: 'true' } }));
    assert.deepEqual(needs.body.clients.map((c: any) => c.clientId), ['C-1']);
    const closed = await call(event('GET /profiles', { qs: { status: 'closed' } }));
    assert.deepEqual(closed.body.clients.map((c: any) => c.clientId), ['C-2']);
    const pgp = await call(event('GET /profiles', { qs: { program: 'pgp' } }));
    assert.deepEqual(pgp.body.clients.map((c: any) => c.clientId), ['C-3']);
    assert.equal(needs.body.total, 3);
  });

  it('ignores another tenant assessments', async () => {
    store.assessments.push(assessment('C-1', RULE_A, 'run-x', '2026-09-20T10:00:00.000Z', true, OTHER));
    const res = await call(event('GET /profiles'));
    assert.equal(res.body.clients.find((c: any) => c.clientId === 'C-1').assessedCount, 0);
  });

  it('never returns notes or age, on the list or the detail view', async () => {
    store.assessments.push(assessment('C-1', RULE_A, 'run-a1', '2026-09-20T10:00:00.000Z', true));
    store.briefs.push(brief('C-1', RULE_A, 'run-a1', 'draft'));
    const list = await call(event('GET /profiles'));
    const detail = await call(event('GET /profiles/{id}', { id: 'C-1' }));
    for (const res of [list, detail]) {
      assert.equal(res.status, 200);
      assert.ok(!/"notes"|"age"/.test(res.raw), res.raw);
      assert.ok(!res.raw.includes('Priya'));
      assert.ok(!res.raw.includes('[CLIENT NAME]'), 'brief body leaked');
    }
  });

  it('rejects a request with no tenant claim', async () => {
    const res = await call(event('GET /profiles', { rcicId: null }));
    assert.equal(res.status, 403);
  });
});

describe('GET /profiles/{id}', () => {
  it('lists one current assessment per rule with its history, and every brief', async () => {
    const RULE = 'c'.repeat(64);
    store.seed(TENANT, { clientId: 'C-1', program: 'express-entry', status: 'active' });
    store.assessments.push(
      assessment('C-1', RULE, 'run-1', '2026-09-20T10:00:00.000Z', true),
      assessment('C-1', RULE, 'run-2', '2026-09-25T10:00:00.000Z', true),
      assessment('C-2', RULE, 'run-2', '2026-09-25T10:00:00.000Z', true),
    );
    store.briefs.push(brief('C-1', RULE, 'run-1', 'draft'));
    const res = await call(event('GET /profiles/{id}', { id: 'C-1' }));
    assert.equal(res.body.assessments.length, 1);
    const a = res.body.assessments[0];
    assert.equal(a.assessmentKey, 'run-2#C-1');
    assert.equal(a.runs, 2);
    assert.deepEqual(a.priorAssessments.map((p: any) => p.assessmentKey), ['run-1#C-1']);
    // The draft sits on the superseded run, so the current assessment has no brief and still needs one.
    assert.equal(a.brief, null);
    assert.equal(a.needsBrief, true);
    assert.equal(res.body.briefs.length, 1);
    assert.equal(res.body.briefs[0].onCurrentAssessment, false);
  });

  it('returns 404 for a missing client and for a PII-shaped id without querying it', async () => {
    assert.equal((await call(event('GET /profiles/{id}', { id: 'C-404' }))).status, 404);
    const pii = await call(event('GET /profiles/{id}', { id: encodeURIComponent('jane@example.com') }));
    assert.equal(pii.status, 404);
    assert.ok(!logs.join('\n').includes('jane@example.com'));
  });
});

describe('PATCH and DELETE /profiles/{id}', () => {
  beforeEach(() => store.seed(TENANT, { clientId: 'C-1', program: 'express-entry', status: 'active', nocCode: '21231', notes: 'legacy' }));

  it('updates whitelisted fields and clears with null', async () => {
    const res = await call(event('PATCH /profiles/{id}', { id: 'C-1', body: { currentCrsScore: 470, nocCode: null } }));
    assert.equal(res.status, 200);
    assert.equal(res.body.client.currentCrsScore, 470);
    assert.equal('nocCode' in res.body.client, false);
    assert.equal('notes' in res.body.client, false);
  });

  it('rejects forbidden keys in a patch without writing', async () => {
    const res = await call(event('PATCH /profiles/{id}', { id: 'C-1', body: { first_name: 'Jane' } }));
    assert.equal(res.status, 400);
    assert.equal(store.writes.length, 0);
  });

  it('closes on DELETE and keeps the row', async () => {
    const res = await call(event('DELETE /profiles/{id}', { id: 'C-1' }));
    assert.equal(res.status, 200);
    assert.equal(res.body.client.status, 'closed');
    assert.equal(res.body.client.closedAt, '2026-09-28T12:00:00.000Z');
    assert.ok(store.profiles.has(`${TENANT}|C-1`));
  });

  it('reopening clears closedAt', async () => {
    await call(event('DELETE /profiles/{id}', { id: 'C-1' }));
    const res = await call(event('PATCH /profiles/{id}', { id: 'C-1', body: { status: 'active' } }));
    assert.equal(res.body.client.status, 'active');
    assert.equal('closedAt' in res.body.client, false);
  });

  it('returns 404 when patching a client that does not exist', async () => {
    const res = await call(event('PATCH /profiles/{id}', { id: 'C-9', body: { status: 'closed' } }));
    assert.equal(res.status, 404);
  });
});

describe('POST /profiles', () => {
  it('creates once and returns 409 on a second create', async () => {
    const body = { clientId: 'C-7', program: 'pnp', status: 'active', consentConfirmed: true, pnpProvince: 'ON' };
    const first = await call(event('POST /profiles', { body }));
    assert.equal(first.status, 201);
    assert.equal(first.body.client.pnpProvince, 'ON');
    const second = await call(event('POST /profiles', { body: { ...body, pnpProvince: 'BC' } }));
    assert.equal(second.status, 409);
    assert.equal(store.profiles.get(`${TENANT}|C-7`)?.pnpProvince, 'ON');
  });

  it('rejects a SIN-shaped client id without writing or echoing it', async () => {
    for (const clientId of ['123456789', '123-456-789', '123-45-6789']) {
      const res = await call(event('POST /profiles', { body: { clientId, program: 'pnp', status: 'active', consentConfirmed: true } }));
      assert.equal(res.status, 400, clientId);
      assert.deepEqual(res.body.errors, ['client-id-looks-like-sin'], clientId);
      assert.ok(!res.raw.includes(clientId), `response leaked ${clientId}`);
    }
    assert.equal(store.writes.length, 0);
  });

  it('rejects a body with a forbidden key', async () => {
    const res = await call(event('POST /profiles', { body: { clientId: 'C-7', program: 'pnp', status: 'active', consentConfirmed: true, phone: '6135550199' } }));
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'forbidden-column', columns: ['phone'] });
  });
});
