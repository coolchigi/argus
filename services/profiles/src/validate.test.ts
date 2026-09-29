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

  it('accepts ordinary case numbers', () => {
    for (const id of ['2026-011', 'C-109', 'file_42', 'A.B-7']) assert.deepEqual(clientIdErrors(id), [], id);
  });

  // The guardrail blocks these shapes anywhere in the profile it's sent, Luhn
  // or not, so an id like this would fail every assessment for the client.
  it('rejects every id the guardrail would block as a SIN or SSN', () => {
    for (const id of ['123456789', '123 456 789', '123-456-789', '123-45-6789', '123 45 6789', 'F-123456789', 'F.123-45-6789']) {
      assert.deepEqual(clientIdErrors(id), ['client-id-looks-like-sin'], id);
    }
  });

  it('accepts ids the guardrail lets through, including 9 digits glued to a letter', () => {
    for (const id of ['2026-042', 'F123456789', 'F_123456789', 'C-101', '12345', 'F-2026-042', 'C1234567890']) {
      assert.deepEqual(clientIdErrors(id), [], id);
    }
    // 10 digits is past the SIN shape. The phone rule catches it instead.
    assert.deepEqual(clientIdErrors('1234567890'), ['client-id-looks-like-phone']);
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

  it('knows the new CSV columns', () => {
    const cols = { dli_type: 'public', study_start_date: '2027-01-11', study_permit_applied_date: '2024-11-20', pgp_sponsor_status: 'no-interest-form', principal_pr_pathway: 'none', principal_pr_applied: 'false' };
    assert.deepEqual(checkColumns([{ ...good, ...cols }]), { ok: true });
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

  it('parses the permit, sponsor and PR pathway fields', () => {
    const res = validateRow({
      ...good,
      'PGP Sponsor Status': 'Interest-Form-Submitted',
      dli_type: 'public',
      study_start_date: '2027-01-11',
      study_permit_applied_date: '2024-11-20',
      principal_pr_pathway: 'none',
      principal_pr_applied: 'no',
    });
    assert.ok(res.ok);
    assert.deepEqual(res.profile.attributes, {
      pgpSponsorStatus: 'interest-form-submitted',
      dliType: 'public',
      studyStartDate: '2027-01-11',
      studyPermitAppliedDate: '2024-11-20',
      principalPrPathway: 'none',
      principalPrApplied: false,
    });
  });

  it('refuses enum values outside the closed set, so free text cannot ride in', () => {
    const res = validateRow({ ...good, dli_type: 'University of Toronto', pgp_sponsor_status: 'waiting', principal_pr_pathway: 'Express Entry' });
    assert.ok(!res.ok);
    assert.deepEqual(res.errors.sort(), [
      'dli_type-must-be-a-listed-value',
      'pgp_sponsor_status-must-be-a-listed-value',
      'principal_pr_pathway-must-be-a-listed-value',
    ]);
  });

  it('refuses permit dates that are not yyyy-mm-dd', () => {
    const res = validateRow({ ...good, study_start_date: 'Jan 2027', study_permit_applied_date: '20/11/2024' });
    assert.ok(!res.ok);
    assert.deepEqual(res.errors.sort(), ['study_permit_applied_date-must-be-yyyy-mm-dd', 'study_start_date-must-be-yyyy-mm-dd']);
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

  it('takes the new fields by their camelCase names and clears them with null', () => {
    assert.deepEqual(validatePatch({ dliType: 'private', principalPrApplied: true, studyPermitAppliedDate: null }), {
      ok: true,
      set: { dliType: 'private', principalPrApplied: true },
      remove: ['studyPermitAppliedDate'],
    });
    assert.deepEqual(validatePatch({ pgpSponsorStatus: 'maybe' }), { ok: false, status: 400, error: 'invalid-fields', errors: ['pgp_sponsor_status-must-be-a-listed-value'] });
  });

  it('sets and clears attributes', () => {
    assert.deepEqual(validatePatch({ currentCrsScore: 470, nocCode: null }), { ok: true, set: { currentCrsScore: 470 }, remove: ['nocCode'] });
  });
});
