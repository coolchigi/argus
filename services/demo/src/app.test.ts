import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createApp, readConfig, type Deps, type PolicyDelta, type Rule } from './app.ts';

const EE_OLD: Rule = {
  rule_hash: '1'.repeat(64),
  rule_kind: 'program-instruction',
  policy_domain: 'express-entry',
  topic: 'crs-scorecard',
  category: 'rounds-of-invitations',
  severity: 'medium',
  summary: 'Older CRS page',
  source_url: 'https://www.canada.ca/old',
  source_s3_key: 'snapshots/old.html',
  captured_at: '2026-09-20T00:00:00.000Z',
};
const EE_NEW: Rule = { ...EE_OLD, rule_hash: '2'.repeat(64), summary: 'Newer CRS page', captured_at: '2026-09-27T00:00:00.000Z' };
const PGWP: Rule = { ...EE_OLD, rule_hash: '3'.repeat(64), policy_domain: 'pgwp', topic: 'pgwp-fields', captured_at: '2026-09-28T00:00:00.000Z' };
const RULES = [EE_OLD, EE_NEW, PGWP];

let emitted: PolicyDelta[];
let scannedDomains: string[];
const deps: Deps = {
  async getRule(h) {
    return RULES.find((r) => r.rule_hash === h) ?? null;
  },
  async rulesInDomain(d) {
    scannedDomains.push(d);
    return RULES.filter((r) => r.policy_domain === d);
  },
  async emit(delta) {
    emitted.push(delta);
  },
};

const NOW = new Date('2026-09-29T15:00:00.000Z');
const config = readConfig({ DEMO_TRIGGER_ENABLED: 'true', DEMO_RCIC_ALLOWLIST: ' demo-rcic-001 , R670922,' });

function event(opts: { routeKey?: string; body?: unknown; rawBody?: string; rcicId?: string | null } = {}): APIGatewayProxyEventV2 {
  const routeKey = opts.routeKey ?? 'POST /demo/trigger-policy-change';
  const rcicId = opts.rcicId === undefined ? 'R670922' : opts.rcicId;
  return {
    routeKey,
    rawPath: routeKey.split(' ')[1],
    body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    requestContext: {
      http: { method: 'POST' },
      ...(rcicId ? { authorizer: { jwt: { claims: { 'custom:rcic_id': rcicId } } } } : {}),
    },
  } as unknown as APIGatewayProxyEventV2;
}

async function call(e: APIGatewayProxyEventV2, cfg = config) {
  const res = await createApp(deps, cfg, { now: () => NOW, log: () => {} })(e);
  return { status: Number(res.statusCode), body: JSON.parse(String(res.body)) };
}

beforeEach(() => {
  emitted = [];
  scannedDomains = [];
});

describe('readConfig', () => {
  it('is off unless explicitly "true"', () => {
    for (const v of [undefined, '', '1', 'TRUE', 'yes']) assert.equal(readConfig({ DEMO_TRIGGER_ENABLED: v }).enabled, false, String(v));
  });

  it('trims the allowlist and drops blanks', () => {
    assert.deepEqual([...config.allowlist].sort(), ['R670922', 'demo-rcic-001']);
  });
});

describe('POST /demo/trigger-policy-change gates', () => {
  it('answers 404 and emits nothing when the flag is off', async () => {
    const res = await call(event(), readConfig({ DEMO_RCIC_ALLOWLIST: 'R670922' }));
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'demo-disabled');
    assert.equal(emitted.length, 0);
  });

  it('refuses a tenant that is not on the allowlist', async () => {
    const res = await call(event({ rcicId: 'R1234567' }));
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'demo-not-allowed-for-tenant');
    assert.equal(emitted.length, 0);
  });

  it('refuses a token with no tenant claim', async () => {
    const res = await call(event({ rcicId: null }));
    assert.equal(res.status, 403);
    assert.equal(emitted.length, 0);
  });

  it('allows both demo tenants', async () => {
    for (const rcicId of ['R670922', 'demo-rcic-001']) {
      assert.equal((await call(event({ rcicId }))).status, 202, rcicId);
    }
    assert.deepEqual(emitted.map((d) => d.targetRcicIds), [['R670922'], ['demo-rcic-001']]);
  });
});

describe('POST /demo/trigger-policy-change delta', () => {
  it('replays the newest Express Entry rule by default, aimed at the caller only', async () => {
    const res = await call(event());
    assert.equal(res.status, 202);
    assert.deepEqual(scannedDomains, ['express-entry']);
    assert.equal(emitted.length, 1);
    const d = emitted[0];
    assert.equal(d.ruleHash, EE_NEW.rule_hash);
    assert.equal(d.newHash, EE_NEW.rule_hash);
    assert.deepEqual(d.targetRcicIds, ['R670922']);
    assert.equal(d.eventId, `demo-${NOW.getTime()}-22222222`);
    assert.equal(d.timestamp, NOW.toISOString());
    assert.equal(d.demoOrigin, true);
    assert.deepEqual(res.body, { eventId: d.eventId, ruleHash: EE_NEW.rule_hash, policyDomain: 'express-entry', topic: 'crs-scorecard', targetRcicId: 'R670922' });
  });

  it('carries every field the Analyst reads', async () => {
    await call(event({ body: { policyDomain: 'pgwp' } }));
    const d = emitted[0];
    assert.deepEqual(
      { policyDomain: d.policyDomain, topic: d.topic, category: d.category, severity: d.severity, summary: d.summary, ruleKind: d.ruleKind, sourceUrl: d.sourceUrl, s3Key: d.s3Key },
      {
        policyDomain: 'pgwp',
        topic: 'pgwp-fields',
        category: PGWP.category,
        severity: PGWP.severity,
        summary: PGWP.summary,
        ruleKind: PGWP.rule_kind,
        sourceUrl: PGWP.source_url,
        s3Key: PGWP.source_s3_key,
      },
    );
  });

  it('replays a named rule by hash', async () => {
    const res = await call(event({ body: { ruleHash: EE_OLD.rule_hash } }));
    assert.equal(res.status, 202);
    assert.equal(emitted[0].ruleHash, EE_OLD.rule_hash);
    assert.deepEqual(scannedDomains, []);
  });

  it('404s for an unknown hash or an empty domain, and emits nothing', async () => {
    assert.equal((await call(event({ body: { ruleHash: 'f'.repeat(64) } }))).body.error, 'rule-not-found');
    assert.equal((await call(event({ body: { policyDomain: 'pgp' } }))).body.error, 'no-rule-for-domain');
    assert.equal(emitted.length, 0);
  });

  it('400s on a bad domain, a bad hash or a bad body', async () => {
    assert.equal((await call(event({ body: { policyDomain: 'citizenship' } }))).status, 400);
    assert.equal((await call(event({ body: { ruleHash: 'ABC' } }))).status, 400);
    assert.equal((await call(event({ rawBody: '{nope' }))).status, 400);
    assert.equal((await call(event({ rawBody: '[1]' }))).status, 400);
    assert.equal(emitted.length, 0);
  });

  it('keeps /demo/seed unbuilt', async () => {
    assert.equal((await call(event({ routeKey: 'POST /demo/seed' }))).status, 501);
  });
});
