import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createApp, type Store } from './app.ts';
import { FIRM_MAX_LENGTH, type Row, type Signing } from './model.ts';

// An in-memory argus-rcic-users with the same conditional-write rule the
// DynamoDB store uses: the write lands only if updatedAt still matches what
// the caller read.

const TENANT = 'R000001';

class MemoryStore implements Store {
  users = new Map<string, Row>();
  clients = new Map<string, number>();
  assessed = new Set<string>();
  writes = 0;
  /** Runs once before the next conditional check, to simulate a racing writer. */
  beforeNextWrite: (() => void) | null = null;

  async getUser(rcicId: string) {
    const u = this.users.get(rcicId);
    return u ? structuredClone(u) : null;
  }
  async updateUser(rcicId: string, set: Row, remove: string[], expectedUpdatedAt: string | null) {
    const hook = this.beforeNextWrite;
    this.beforeNextWrite = null;
    hook?.();
    const u = this.users.get(rcicId);
    if (!u) return null;
    const current = typeof u.updatedAt === 'string' ? u.updatedAt : null;
    if (current !== expectedUpdatedAt) return null;
    this.writes += 1;
    const next = { ...u, ...structuredClone(set) };
    for (const r of remove) delete next[r];
    this.users.set(rcicId, next);
    return structuredClone(next);
  }
  async countClients(rcicId: string) {
    return this.clients.get(rcicId) ?? 0;
  }
  async hasAssessments(rcicId: string) {
    return this.assessed.has(rcicId);
  }
}

const SIGNING: Signing = {
  keyId: 'key-1',
  algorithm: 'ECDSA_SHA_256',
  curve: 'P-256',
  spkiSha256: 'ab'.repeat(32),
  createdAt: '2026-09-21T16:38:08.569Z',
};

function event(routeKey: string, opts: { body?: unknown; claims?: Record<string, string> | null } = {}): APIGatewayProxyEventV2 {
  const [method, path] = routeKey.split(' ');
  const claims =
    opts.claims === undefined
      ? { 'custom:rcic_id': TENANT, 'custom:rcic_license': TENANT, given_name: 'Priya', family_name: 'Sandhu', email: 'priya@example.ca' }
      : opts.claims;
  return {
    version: '2.0',
    routeKey,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      ...(claims ? { authorizer: { jwt: { claims, scopes: [] } } } : {}),
    },
  } as unknown as APIGatewayProxyEventV2;
}

type Res = { status: number; body: any; raw: string };

let store: MemoryStore;
let signing: Signing | null;
let clock: number;

async function call(routeKey: string, opts: Parameters<typeof event>[1] = {}): Promise<Res> {
  const app = createApp(store, async () => signing, {
    now: () => new Date(Date.UTC(2026, 8, 28, 12, 0, clock++)),
    log: () => {},
  });
  const res = await app(event(routeKey, opts));
  const raw = String(res.body);
  return { status: Number(res.statusCode), body: JSON.parse(raw), raw };
}

const patch = (body: unknown) => call('PATCH /me', { body });

beforeEach(() => {
  store = new MemoryStore();
  signing = SIGNING;
  clock = 0;
  store.users.set(TENANT, {
    rcicId: TENANT,
    cognitoSub: 'sub-123',
    rcicLicense: TENANT,
    email: 'priya@example.ca',
    verifiedSenderEmail: 'priya@example.ca',
    displayName: 'Priya Sandhu',
    active: true,
    createdAt: '2026-09-01T00:00:00.000Z',
  });
});

describe('GET /me', () => {
  it('fills defaults for a fresh row: every area on, alerts on, identity off on public receipts, onboarding at step 1', async () => {
    const res = await call('GET /me');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.preferences, {
      policyDomains: { 'express-entry': true, pgwp: true, sowp: true, pgp: true, pnp: true, 'study-permit': true },
      realtimeAlerts: true,
      showIdentityOnPublicReceipts: false,
    });
    assert.deepEqual(res.body.onboarding, { step: 1, completedAt: null, skippedAt: null });
    assert.deepEqual(res.body.setup, { provisioned: true, profileComplete: false, domainsChosen: false, clientCount: 0, hasAssessments: false });
    assert.equal(res.body.consultant.givenName, 'Priya');
    assert.equal(res.body.consultant.rcicLicense, TENANT);
    assert.deepEqual(res.body.signing, SIGNING);
  });

  it('never returns the Cognito sub, the sender address or the active flag', async () => {
    const res = await call('GET /me');
    assert.doesNotMatch(res.raw, /sub-123|verifiedSenderEmail|cognitoSub|"active"/);
  });

  it('reports stored preferences, and only an explicit false turns an area off', async () => {
    store.users.get(TENANT)!.preferences = { policyDomains: { pgp: false, pnp: 'no', sowp: 0 }, realtimeAlerts: false };
    const res = await call('GET /me');
    assert.equal(res.body.preferences.policyDomains.pgp, false);
    assert.equal(res.body.preferences.policyDomains.pnp, true);
    assert.equal(res.body.preferences.policyDomains.sowp, true);
    assert.equal(res.body.preferences.realtimeAlerts, false);
    assert.equal(res.body.setup.domainsChosen, true);
  });

  it('counts clients and assessments for the caller only', async () => {
    store.clients.set(TENANT, 12);
    store.clients.set('R999999', 40);
    store.assessed.add('R999999');
    const res = await call('GET /me');
    assert.equal(res.body.setup.clientCount, 12);
    assert.equal(res.body.setup.hasAssessments, false);
  });

  it('ignores a stored province that is not a real code', async () => {
    Object.assign(store.users.get(TENANT)!, { firm: 'Northern Pathways', province: 'Ontario' });
    const res = await call('GET /me');
    assert.equal(res.body.consultant.province, null);
    assert.equal(res.body.setup.profileComplete, false);
  });

  it('still answers when KMS is unavailable', async () => {
    signing = null;
    const res = await call('GET /me');
    assert.equal(res.status, 200);
    assert.equal(res.body.signing, null);
  });

  it('answers from the claims when the consultant has no row yet', async () => {
    store.users.clear();
    const res = await call('GET /me');
    assert.equal(res.status, 200);
    assert.equal(res.body.setup.provisioned, false);
    assert.equal(res.body.consultant.email, 'priya@example.ca');
  });

  it('refuses a token with no tenant claim', async () => {
    const res = await call('GET /me', { claims: { email: 'x@example.ca' } });
    assert.equal(res.status, 403);
  });
});

describe('PATCH /me validation', () => {
  for (const province of ['Ontario', 'on', 'XX', '', 7]) {
    it(`rejects province ${JSON.stringify(province)} and writes nothing`, async () => {
      const res = await patch({ province });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'invalid-province');
      assert.equal(store.writes, 0);
    });
  }

  for (const domain of ['general', 'other', 'express_entry', 'Express Entry', 'lmia']) {
    it(`rejects policy domain ${domain}`, async () => {
      const res = await patch({ preferences: { policyDomains: { [domain]: false } } });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'unknown-policy-domain');
      assert.equal(store.writes, 0);
    });
  }

  it('rejects the whole patch when one domain is unknown, even if the others are valid', async () => {
    const res = await patch({ firm: 'Valid Firm', preferences: { policyDomains: { pgp: false, bogus: false } } });
    assert.equal(res.status, 400);
    assert.equal(store.writes, 0);
    assert.equal(store.users.get(TENANT)!.firm, undefined);
  });

  it(`accepts a firm of ${FIRM_MAX_LENGTH} characters and rejects ${FIRM_MAX_LENGTH + 1}`, async () => {
    assert.equal((await patch({ firm: 'a'.repeat(FIRM_MAX_LENGTH) })).status, 200);
    const res = await patch({ firm: 'a'.repeat(FIRM_MAX_LENGTH + 1) });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'firm-too-long');
  });

  it('rejects control characters in the firm', async () => {
    const res = await patch({ firm: 'Firm\nInjected: header' });
    assert.equal(res.body.error, 'invalid-firm');
  });

  for (const field of ['active', 'email', 'rcicId', 'rcicLicense', 'verifiedSenderEmail']) {
    it(`refuses to write ${field}`, async () => {
      const res = await patch({ [field]: field === 'active' ? false : 'attacker@example.com' });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'unknown-field');
      assert.equal(store.users.get(TENANT)!.active, true);
      assert.equal(store.users.get(TENANT)!.email, 'priya@example.ca');
    });
  }

  it('rejects a preference value that is not a boolean', async () => {
    for (const body of [{ preferences: { realtimeAlerts: 'false' } }, { preferences: { policyDomains: { pgp: 0 } } }]) {
      const res = await patch(body);
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'invalid-preference-value');
    }
  });

  it('shows identity on public receipts only after an explicit opt-in', async () => {
    for (const stored of ['true', 1, null]) {
      store.users.get(TENANT)!.preferences = { showIdentityOnPublicReceipts: stored };
      assert.equal((await call('GET /me')).body.preferences.showIdentityOnPublicReceipts, false, String(stored));
    }
    const on = await patch({ preferences: { showIdentityOnPublicReceipts: true } });
    assert.equal(on.status, 200);
    assert.equal(on.body.preferences.showIdentityOnPublicReceipts, true);
    assert.equal((store.users.get(TENANT)!.preferences as Row).showIdentityOnPublicReceipts, true);
    const off = await patch({ preferences: { showIdentityOnPublicReceipts: false } });
    assert.equal(off.body.preferences.showIdentityOnPublicReceipts, false);
  });

  it('rejects a non-boolean identity preference', async () => {
    const res = await patch({ preferences: { showIdentityOnPublicReceipts: 'yes' } });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.fields, ['showIdentityOnPublicReceipts']);
  });

  it('rejects an unknown preference key', async () => {
    const res = await patch({ preferences: { digest: true } });
    assert.equal(res.body.error, 'unknown-preference');
  });

  it('rejects an empty patch and bad bodies', async () => {
    assert.equal((await patch({})).body.error, 'empty-patch');
    assert.equal((await patch({ preferences: {} })).body.error, 'empty-patch');
    assert.equal((await patch([1])).body.error, 'body-must-be-an-object');
    const bad = await createApp(store, async () => signing, { log: () => {} })({ ...event('PATCH /me'), body: '{nope' });
    assert.equal(JSON.parse(String(bad.body)).error, 'invalid-json');
  });

  it('rejects onboarding complete and skip together, and out-of-range steps', async () => {
    assert.equal((await patch({ onboarding: { complete: true, skip: true } })).body.error, 'invalid-onboarding');
    assert.equal((await patch({ onboarding: { step: 5 } })).body.error, 'invalid-onboarding');
    assert.equal((await patch({ onboarding: { step: 1.5 } })).body.error, 'invalid-onboarding');
    assert.equal((await patch({ onboarding: { complete: false } })).body.error, 'invalid-onboarding');
    assert.equal(store.writes, 0);
  });

  it('returns 404 when the consultant has no row, and creates nothing', async () => {
    store.users.clear();
    const res = await patch({ firm: 'X' });
    assert.equal(res.status, 404);
    assert.equal(store.users.size, 0);
  });
});

describe('PATCH /me merging', () => {
  beforeEach(() => {
    Object.assign(store.users.get(TENANT)!, {
      firm: 'Northern Pathways',
      province: 'ON',
      preferences: { policyDomains: { pgp: false, sowp: false }, realtimeAlerts: false, showIdentityOnPublicReceipts: false },
      onboarding: { step: 2 },
      updatedAt: '2026-09-27T00:00:00.000Z',
    });
  });

  it('turning one area on keeps every other stored preference', async () => {
    const res = await patch({ preferences: { policyDomains: { sowp: true } } });
    assert.equal(res.status, 200);
    const stored = store.users.get(TENANT)!;
    assert.deepEqual(stored.preferences, { policyDomains: { pgp: false, sowp: true }, realtimeAlerts: false, showIdentityOnPublicReceipts: false });
    assert.equal(stored.firm, 'Northern Pathways');
    assert.equal(stored.province, 'ON');
    assert.deepEqual(stored.onboarding, { step: 2 });
    assert.equal(stored.email, 'priya@example.ca');
    assert.equal(stored.active, true);
    assert.equal(res.body.preferences.policyDomains.pgp, false);
    assert.equal(res.body.preferences.policyDomains.sowp, true);
  });

  it('changing the province leaves preferences and firm alone', async () => {
    await patch({ province: 'BC' });
    const stored = store.users.get(TENANT)!;
    assert.equal(stored.province, 'BC');
    assert.equal(stored.firm, 'Northern Pathways');
    assert.deepEqual((stored.preferences as Row).policyDomains, { pgp: false, sowp: false });
  });

  it('turning alerts on keeps the domain choices', async () => {
    await patch({ preferences: { realtimeAlerts: true } });
    const stored = store.users.get(TENANT)!.preferences as Row;
    assert.equal(stored.realtimeAlerts, true);
    assert.deepEqual(stored.policyDomains, { pgp: false, sowp: false });
  });

  it('an empty or null firm clears it, a null province clears it', async () => {
    await patch({ firm: '   ' });
    assert.equal('firm' in store.users.get(TENANT)!, false);
    await patch({ province: null });
    assert.equal('province' in store.users.get(TENANT)!, false);
  });

  it('trims the firm', async () => {
    const res = await patch({ firm: '  Maple Law  ' });
    assert.equal(res.body.consultant.firm, 'Maple Law');
  });

  it('returns the same shape as GET', async () => {
    const res = await patch({ firm: 'Maple Law' });
    const get = await call('GET /me');
    assert.deepEqual(res.body, get.body);
  });

  it('completing onboarding stamps completedAt and keeps the step at the end', async () => {
    const res = await patch({ onboarding: { complete: true } });
    assert.equal(res.body.onboarding.step, 4);
    assert.match(res.body.onboarding.completedAt, /^2026-09-28T12:00/);
    assert.equal(res.body.onboarding.skippedAt, null);
  });

  it('a save racing another save re-reads and keeps both changes', async () => {
    // Another tab turns pgp back on between our read and our write.
    store.beforeNextWrite = () => {
      const u = store.users.get(TENANT)!;
      u.preferences = { ...(u.preferences as Row), policyDomains: { pgp: true, sowp: false } };
      u.updatedAt = '2026-09-28T11:59:59.000Z';
    };
    const res = await patch({ preferences: { policyDomains: { pnp: false } } });
    assert.equal(res.status, 200);
    assert.deepEqual((store.users.get(TENANT)!.preferences as Row).policyDomains, { pgp: true, sowp: false, pnp: false });
  });

  it('gives up with 409 when the row keeps changing underneath', async () => {
    const orig = store.updateUser.bind(store);
    let n = 0;
    store.updateUser = async (...args) => {
      n += 1;
      store.users.get(TENANT)!.updatedAt = `racer-${n}`;
      return orig(...args);
    };
    const res = await patch({ firm: 'X' });
    assert.equal(res.status, 409);
    assert.equal(store.users.get(TENANT)!.firm, 'Northern Pathways');
  });
});

describe('guest view', () => {
  async function guestCall(routeKey: string, guestRcicId: string | undefined): Promise<Res> {
    const app = createApp(store, async () => signing, { log: () => {}, guestRcicId });
    const res = await app(event(routeKey, { claims: null }));
    const raw = String(res.body);
    return { status: Number(res.statusCode), body: JSON.parse(raw), raw };
  }

  it("shows the guest tenant's setup under a stand-in name", async () => {
    store.users.set(TENANT, { ...store.users.get(TENANT), email: 'priya@example.ca', rcicLicense: TENANT, firm: 'Sandhu Immigration' });
    store.clients.set(TENANT, 13);
    const res = await guestCall('GET /guest/me', TENANT);
    assert.equal(res.status, 200);
    assert.equal(res.body.consultant.rcicId, TENANT);
    assert.equal(res.body.consultant.displayName, 'Demo Consultant');
    assert.equal(res.body.setup.clientCount, 13);
    for (const leaked of ['Priya', 'Sandhu', 'priya@example.ca']) assert.ok(!res.raw.includes(leaked), `guest /me leaked ${leaked}`);
    assert.equal(res.body.consultant.rcicLicense, null);
  });

  it('answers 403 when no guest tenant is configured', async () => {
    const res = await guestCall('GET /guest/me', undefined);
    assert.equal(res.status, 403);
  });

  it('keeps the real name for the signed-in consultant', async () => {
    const res = await call('GET /me');
    assert.equal(res.body.consultant.givenName, 'Priya');
  });
});
