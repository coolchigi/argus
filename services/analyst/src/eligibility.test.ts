import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eligibleClients, tenantFromItem } from './eligibility.ts';

// Items shaped like real argus-rcic-users and argus-client-profiles rows.

const caseload = [
  { clientId: 'EE-1', program: 'express-entry', status: 'active' },
  { clientId: 'EE-2', program: 'express-entry', status: 'submitted' },
  { clientId: 'EE-3', program: 'express-entry', status: 'closed' },
  { clientId: 'PGP-1', program: 'pgp', status: 'active' },
  { clientId: 'PGP-2', program: 'pgp', status: 'closed' },
  { clientId: 'GEN-1', program: 'general', status: 'active' },
  { clientId: 'LEGACY-1' }, // seeded before program and status existed
];

const ids = (rows: Array<{ clientId: string }>) => rows.map((r) => r.clientId).sort();

describe('tenantFromItem', () => {
  it('reads explicit false as off and everything else as on', () => {
    const t = tenantFromItem({
      rcicId: 'R1',
      active: true,
      preferences: { policyDomains: { pgp: false, sowp: 'false', pnp: 0, pgwp: null, 'express-entry': true } },
    });
    assert.deepEqual([...t!.disabledDomains], ['pgp']);
  });

  it('treats a missing or malformed preferences map as every area on', () => {
    for (const preferences of [undefined, null, 'x', [], { policyDomains: ['pgp'] }, { policyDomains: null }]) {
      const t = tenantFromItem({ rcicId: 'R1', preferences });
      assert.equal(t!.disabledDomains.size, 0, JSON.stringify(preferences));
    }
  });

  it('drops inactive tenants and items without an id', () => {
    assert.equal(tenantFromItem({ rcicId: 'R1', active: false }), null);
    assert.equal(tenantFromItem({ active: true }), null);
    assert.equal(tenantFromItem({ rcicId: '' }), null);
    assert.notEqual(tenantFromItem({ rcicId: 'R1' }), null);
  });
});

describe('eligibleClients', () => {
  const allOn = { disabledDomains: new Set<string>() };

  it('skips closed clients on a program change', () => {
    assert.deepEqual(ids(eligibleClients(caseload, 'express-entry', allOn)), ['EE-1', 'EE-2']);
  });

  it('skips closed clients on a cross-program change', () => {
    assert.deepEqual(ids(eligibleClients(caseload, 'general', allOn)), ['EE-1', 'EE-2', 'GEN-1', 'LEGACY-1', 'PGP-1']);
  });

  it('reaches nobody when the change is in an area the consultant turned off', () => {
    const t = tenantFromItem({ rcicId: 'R1', preferences: { policyDomains: { 'express-entry': false } } })!;
    assert.deepEqual(eligibleClients(caseload, 'express-entry', t), []);
    // Other areas are untouched.
    assert.deepEqual(ids(eligibleClients(caseload, 'pgp', t)), ['PGP-1']);
  });

  it('narrows a cross-program change to clients whose area is still on', () => {
    const t = tenantFromItem({ rcicId: 'R1', preferences: { policyDomains: { 'express-entry': false } } })!;
    assert.deepEqual(ids(eligibleClients(caseload, 'other', t)), ['GEN-1', 'LEGACY-1', 'PGP-1']);
  });

  it('turning an area back on restores it', () => {
    const t = tenantFromItem({ rcicId: 'R1', preferences: { policyDomains: { 'express-entry': true } } })!;
    assert.deepEqual(ids(eligibleClients(caseload, 'express-entry', t)), ['EE-1', 'EE-2']);
  });

  it('a tenant with another tenant\'s preferences is not affected by them', () => {
    const off = tenantFromItem({ rcicId: 'R1', preferences: { policyDomains: { pgp: false } } })!;
    const on = tenantFromItem({ rcicId: 'R2' })!;
    assert.deepEqual(eligibleClients(caseload, 'pgp', off), []);
    assert.deepEqual(ids(eligibleClients(caseload, 'pgp', on)), ['PGP-1']);
  });
});
