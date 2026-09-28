import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkColumns, clientIdErrors, validatePatch, validateRow } from './validate.ts';

const good = { client_id: '2026-011', program: 'express-entry', status: 'active', consent_confirmed: 'true' };

describe('client id checks', () => {
  it('rejects ids that look like an email, a phone number or a SIN', () => {
    assert.deepEqual(clientIdErrors('jane.doe@example.com'), ['client-id-looks-like-email']);
    assert.deepEqual(clientIdErrors('613-555-0199'), ['client-id-looks-like-phone']);
    assert.deepEqual(clientIdErrors('(613) 555-0199'), ['client-id-looks-like-phone']);
    assert.deepEqual(clientIdErrors('+1 613 555 0199'), ['client-id-looks-like-phone']);
    assert.deepEqual(clientIdErrors('6135550199'), ['client-id-looks-like-phone']);
    // 046 454 286 is SIN-shaped and passes Luhn.
    assert.deepEqual(clientIdErrors('046-454-286'), ['client-id-looks-like-sin']);
    assert.deepEqual(clientIdErrors('046454286'), ['client-id-looks-like-sin']);
  });

  it('accepts ordinary case numbers, including a 9-digit one that fails Luhn', () => {
    for (const id of ['2026-011', 'C-109', 'file_42', 'A.B-7', '123456789']) assert.deepEqual(clientIdErrors(id), [], id);
  });

  it('rejects ids outside the pattern', () => {
    assert.deepEqual(clientIdErrors('Jane Doe'), ['client-id-invalid-pattern']);
    assert.deepEqual(clientIdErrors('x'.repeat(41)), ['client-id-invalid-pattern']);
    assert.deepEqual(clientIdErrors(''), ['client-id-required']);
    assert.deepEqual(clientIdErrors(42), ['client-id-required']);
  });
});

describe('columns', () => {
  it('rejects the whole file when any row carries a forbidden column, however it is spelled', () => {
    const res = checkColumns([good, { ...good, 'First Name': 'x' }, { ...good, EMAIL: 'x' }]);
    assert.deepEqual(res, { ok: false, error: 'forbidden-column', columns: ['email', 'first_name'] });
  });

  it('treats notes as forbidden', () => {
    assert.deepEqual(checkColumns([{ ...good, notes: 'software developer' }]), { ok: false, error: 'forbidden-column', columns: ['notes'] });
  });

  it('rejects unknown columns so a renamed PII column cannot slip through', () => {
    assert.deepEqual(checkColumns([{ ...good, client_name: 'x' }]), { ok: false, error: 'unknown-column', columns: ['client_name'] });
  });

  it('reports missing required columns', () => {
    const { consent_confirmed: _c, ...rest } = good;
    assert.deepEqual(checkColumns([rest]), { ok: false, error: 'missing-column', columns: ['consent_confirmed'] });
  });
});

describe('rows', () => {
  it('rejects a program outside Sentinel policyDomain set', () => {
    const res = validateRow({ ...good, program: 'express entry' });
    assert.equal(res.ok, false);
    assert.ok(!res.ok && res.errors.includes('program-invalid'));
  });

  it('requires consent on the row', () => {
    const res = validateRow({ ...good, consent_confirmed: 'no' });
    assert.ok(!res.ok && res.errors.includes('consent-not-confirmed'));
  });

  it('pins string attributes to patterns so free text cannot ride in', () => {
    const res = validateRow({ ...good, education_level: 'Masters from U of T, ask Priya', pnp_province: 'Ontario' });
    assert.ok(!res.ok);
    assert.deepEqual(res.errors.sort(), ['education_level-must-be-lowercase-slug', 'pnp_province-must-be-2-letter-province']);
  });

  it('never echoes back a client id that failed the PII checks', () => {
    const res = validateRow({ ...good, client_id: 'jane@example.com' });
    assert.ok(!res.ok);
    assert.equal(res.clientId, null);
  });

  it('parses typed attributes', () => {
    const res = validateRow({ ...good, age: '29', current_crs_score: '489', has_job_offer: 'no', teer_level: '1', canadian_work_years: '0.5' });
    assert.ok(res.ok);
    assert.deepEqual(res.profile.attributes, { age: 29, currentCrsScore: 489, hasJobOffer: false, teerLevel: 1, canadianWorkYears: 0.5 });
  });
});

describe('patch', () => {
  it('rejects forbidden, unknown and immutable keys', () => {
    assert.deepEqual(validatePatch({ email: 'a@b.c' }), { ok: false, status: 400, error: 'forbidden-column', columns: ['email'] });
    assert.deepEqual(validatePatch({ notes: 'x' }), { ok: false, status: 400, error: 'forbidden-column', columns: ['notes'] });
    assert.deepEqual(validatePatch({ nickname: 'x' }), { ok: false, status: 400, error: 'unknown-column', columns: ['nickname'] });
    assert.equal((validatePatch({ clientId: 'C-2' }) as { error: string }).error, 'client-id-is-immutable');
  });

  it('sets and clears attributes', () => {
    assert.deepEqual(validatePatch({ currentCrsScore: 470, nocCode: null }), { ok: true, set: { currentCrsScore: 470 }, remove: ['nocCode'] });
  });
});
