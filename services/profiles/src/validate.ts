// Pure validation for client profiles. No AWS calls, so validate.test.ts runs
// it directly.
//
// Zero client PII (CLAUDE.md, design doc 6a). A client is an opaque clientId
// the consultant supplies. Everything else is a scoring attribute the Analyst
// reads (services/analyst/src/handler.ts ClientProfile). Nothing here accepts
// free text: every string field is pinned to a pattern, so a name or an email
// can't ride in through an attribute. `notes` isn't accepted in v1
// (PHASE8_PLAN section 1b and Q5).

import { matchesGuardrailIdPattern } from './guardrail-patterns.ts';

export type Row = Record<string, unknown>;

/**
 * Sentinel's policyDomain set, from the classify prompt in
 * services/sentinel/src/handler.ts. Services don't share code today, so a
 * change there has to land here too. A profile's program is matched against
 * a rule's policyDomain by the Analyst.
 */
export const PROGRAMS = ['express-entry', 'pgwp', 'sowp', 'pgp', 'pnp', 'study-permit', 'general', 'other'] as const;
export type Program = (typeof PROGRAMS)[number];

/** user-workflows.md section 5. */
export const STATUSES = ['active', 'submitted', 'closed'] as const;
export type ClientStatus = (typeof STATUSES)[number];

export const MAX_BULK_ROWS = 500;

/**
 * Columns that identify a person. A file carrying any of them is rejected
 * whole, before a single row is read, so the consultant fixes the export
 * rather than half the file landing.
 */
export const FORBIDDEN_COLUMNS = [
  'name',
  'first_name',
  'last_name',
  'full_name',
  'email',
  'phone',
  'address',
  'dob',
  'date_of_birth',
  'passport',
  'sin',
  'uci',
  'notes',
] as const;

export const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

type FieldKind =
  | { kind: 'int'; min: number; max?: number }
  | { kind: 'number'; min: number; max?: number }
  | { kind: 'bool' }
  | { kind: 'pattern'; re: RegExp; hint: string }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'date' };

// Closed value sets for the enum attributes. Each value is a fact the
// consultant records about the file, in words the Analyst and Auditor can read
// as they are. None of them encodes what IRCC does with the fact. The web form
// mirrors these lists (web/src/components/caseload/profile-fields.ts).

/** Where the sponsor is in the parents and grandparents intake. */
export const PGP_SPONSOR_STATUSES = ['no-interest-form', 'interest-form-submitted', 'invited-to-apply', 'application-submitted'] as const;
/** Public or private designated learning institution. */
export const DLI_TYPES = ['public', 'private'] as const;
/** The principal applicant's permanent residence route, for a family member's permit. */
export const PR_PATHWAYS = ['none', 'express-entry', 'pnp', 'quebec', 'atlantic', 'other-economic', 'family', 'other'] as const;

/**
 * Optional attributes, keyed by CSV column. Bounds are data-shape checks
 * (no negative years, a TEER is one digit). None of them is an IRCC scoring
 * threshold, and nothing here decides eligibility.
 */
const SLUG = { kind: 'pattern', re: /^[a-z0-9][a-z0-9-]{0,39}$/, hint: 'lowercase-slug' } as const;
export const OPTIONAL_FIELDS: Record<string, { attr: string; spec: FieldKind; writeOnly?: boolean }> = {
  // Write-only: the Analyst needs it for CRS, but it's never returned (PHASE8_PLAN Phase F).
  age: { attr: 'age', spec: { kind: 'int', min: 0, max: 130 }, writeOnly: true },
  education_level: { attr: 'educationLevel', spec: SLUG },
  clb_english_worst: { attr: 'clbEnglishWorst', spec: { kind: 'int', min: 0, max: 12 } },
  clb_french_worst: { attr: 'clbFrenchWorst', spec: { kind: 'int', min: 0, max: 12 } },
  canadian_work_years: { attr: 'canadianWorkYears', spec: { kind: 'number', min: 0, max: 80 } },
  foreign_work_years: { attr: 'foreignWorkYears', spec: { kind: 'number', min: 0, max: 80 } },
  noc_code: { attr: 'nocCode', spec: { kind: 'pattern', re: /^\d{5}$/, hint: '5-digit-noc' } },
  teer_level: { attr: 'teerLevel', spec: { kind: 'int', min: 0, max: 5 } },
  has_job_offer: { attr: 'hasJobOffer', spec: { kind: 'bool' } },
  job_offer_teer: { attr: 'jobOfferTeer', spec: { kind: 'int', min: 0, max: 5 } },
  current_crs_score: { attr: 'currentCrsScore', spec: { kind: 'int', min: 0, max: 9999 } },
  principal_permit_teer: { attr: 'principalPermitTeer', spec: { kind: 'int', min: 0, max: 5 } },
  principal_permit_remaining_months: { attr: 'principalPermitRemainingMonths', spec: { kind: 'int', min: 0, max: 600 } },
  cip_code: { attr: 'cipCode', spec: { kind: 'pattern', re: /^\d{2}\.\d{4}$/, hint: 'cip-like-52.0201' } },
  graduation_date: { attr: 'graduationDate', spec: { kind: 'date' } },
  pgp_sponsor_2020_form: { attr: 'pgpSponsor2020Form', spec: { kind: 'bool' } },
  pgp_lico_years_met: { attr: 'pgpLicoYearsMet', spec: { kind: 'int', min: 0, max: 99 } },
  pnp_province: { attr: 'pnpProvince', spec: { kind: 'pattern', re: /^[A-Z]{2}$/, hint: '2-letter-province' } },
  intended_study_level: { attr: 'intendedStudyLevel', spec: SLUG },
  pal_on_file: { attr: 'palOnFile', spec: { kind: 'bool' } },
  // Dates here are about permits and study programs. Never a date of birth.
  pgp_sponsor_status: { attr: 'pgpSponsorStatus', spec: { kind: 'enum', values: PGP_SPONSOR_STATUSES } },
  dli_type: { attr: 'dliType', spec: { kind: 'enum', values: DLI_TYPES } },
  study_start_date: { attr: 'studyStartDate', spec: { kind: 'date' } },
  study_permit_applied_date: { attr: 'studyPermitAppliedDate', spec: { kind: 'date' } },
  principal_pr_pathway: { attr: 'principalPrPathway', spec: { kind: 'enum', values: PR_PATHWAYS } },
  principal_pr_applied: { attr: 'principalPrApplied', spec: { kind: 'bool' } },
};

export const REQUIRED_COLUMNS = ['client_id', 'program', 'status', 'consent_confirmed'] as const;
const KNOWN_COLUMNS = new Set<string>([...REQUIRED_COLUMNS, ...Object.keys(OPTIONAL_FIELDS)]);

/** camelCase attribute to CSV column, for the JSON routes (POST /profiles, PATCH). */
const COLUMN_BY_ATTR: Record<string, string> = {
  clientId: 'client_id',
  program: 'program',
  status: 'status',
  consentConfirmed: 'consent_confirmed',
  ...Object.fromEntries(Object.entries(OPTIONAL_FIELDS).map(([col, f]) => [f.attr, col])),
};

/**
 * Profile attributes the API may return. Everything the Analyst reads except
 * `notes` (free text, the PII vector) and `age` (write-only, see the header
 * of app.ts). Applied both as the DynamoDB projection and again in code.
 */
export const DETAIL_FIELDS = [
  'clientId',
  'program',
  'status',
  'createdAt',
  'updatedAt',
  'closedAt',
  ...Object.values(OPTIONAL_FIELDS)
    .filter((f) => !f.writeOnly)
    .map((f) => f.attr),
];

/** The caseload table only needs these. */
export const LIST_FIELDS = ['clientId', 'program', 'status', 'currentCrsScore', 'nocCode', 'teerLevel', 'createdAt', 'updatedAt'];

/** Header as the consultant typed it, to the column key we compare against. "First Name" becomes first_name. */
export function normalizeColumn(raw: string): string {
  return raw
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export type ColumnCheck = { ok: true } | { ok: false; error: 'forbidden-column' | 'unknown-column' | 'missing-column'; columns: string[] };

/**
 * Whole-file check. Forbidden beats unknown beats missing, so a file with
 * `email` is always reported as a PII problem first.
 */
export function checkColumns(rows: Row[]): ColumnCheck {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(normalizeColumn(k));
  const forbidden = [...seen].filter((c) => (FORBIDDEN_COLUMNS as readonly string[]).includes(c));
  if (forbidden.length > 0) return { ok: false, error: 'forbidden-column', columns: forbidden.sort() };
  const unknown = [...seen].filter((c) => !KNOWN_COLUMNS.has(c));
  if (unknown.length > 0) return { ok: false, error: 'unknown-column', columns: unknown.sort() };
  const missing = REQUIRED_COLUMNS.filter((c) => !seen.has(c));
  if (missing.length > 0) return { ok: false, error: 'missing-column', columns: [...missing] };
  return { ok: true };
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * Errors for a client id. Empty array means it's fine. The PII checks run
 * before the pattern so the consultant sees why, not just "bad pattern".
 * - Email: anything with an @.
 * - SIN or SSN: anything the guardrail's ca-sin or us-ssn regex matches,
 *   searched the way the guardrail searches (guardrail-patterns.ts). No Luhn
 *   check: the guardrail blocks any 9 digits in that shape, so an id it
 *   blocks would fail every assessment for the client.
 * - Phone: 10 or 11 digits once separators and a leading + are stripped,
 *   made only of digits and phone punctuation.
 */
export function clientIdErrors(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return ['client-id-required'];
  const id = raw.trim();
  if (id.includes('@')) return ['client-id-looks-like-email'];
  if (matchesGuardrailIdPattern(id)) return ['client-id-looks-like-sin'];
  const phoneish = /^\+?[\d\s().-]+$/.test(id);
  const digits = digitsOnly(id);
  if (phoneish && (digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))) {
    return ['client-id-looks-like-phone'];
  }
  if (!CLIENT_ID_PATTERN.test(id)) return ['client-id-invalid-pattern'];
  return [];
}

function parseBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(s)) return true;
    if (['false', 'no', 'n', '0'].includes(s)) return false;
  }
  return null;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** Returns the parsed value, or an error code. */
function parseField(col: string, spec: FieldKind, v: unknown): { value: unknown } | { error: string } {
  switch (spec.kind) {
    case 'bool': {
      const b = parseBool(v);
      return b === null ? { error: `${col}-must-be-true-or-false` } : { value: b };
    }
    case 'int':
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : Number.NaN;
      if (!Number.isFinite(n)) return { error: `${col}-must-be-a-number` };
      if (spec.kind === 'int' && !Number.isInteger(n)) return { error: `${col}-must-be-a-whole-number` };
      if (n < spec.min || (spec.max !== undefined && n > spec.max)) return { error: `${col}-out-of-range` };
      return { value: n };
    }
    case 'pattern': {
      const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
      return spec.re.test(s) ? { value: s } : { error: `${col}-must-be-${spec.hint}` };
    }
    case 'enum': {
      const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
      return spec.values.includes(s) ? { value: s } : { error: `${col}-must-be-a-listed-value` };
    }
    case 'date': {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return { error: `${col}-must-be-yyyy-mm-dd` };
      return { value: s };
    }
  }
}

export type ValidProfile = {
  clientId: string;
  program: Program;
  status: ClientStatus;
  /** Optional attributes that were filled in, keyed by DynamoDB attribute name. */
  attributes: Record<string, unknown>;
};

export type RowResult = { ok: true; profile: ValidProfile } | { ok: false; clientId: string | null; errors: string[] };

/**
 * One row, keys already known to be allowed (run checkColumns first).
 * Collects every error on the row so the preview can show them together.
 */
export function validateRow(input: Row): RowResult {
  const row: Row = {};
  for (const [k, v] of Object.entries(input)) row[normalizeColumn(k)] = v;

  const errors: string[] = [];
  const rawId = typeof row.client_id === 'string' ? row.client_id.trim() : row.client_id;
  const idErrors = clientIdErrors(rawId);
  errors.push(...idErrors);
  const clientId = typeof rawId === 'string' && idErrors.length === 0 ? rawId : null;

  const program = typeof row.program === 'string' ? row.program.trim().toLowerCase() : '';
  if (!(PROGRAMS as readonly string[]).includes(program)) errors.push('program-invalid');

  const status = typeof row.status === 'string' ? row.status.trim().toLowerCase() : '';
  if (!(STATUSES as readonly string[]).includes(status)) errors.push('status-invalid');

  if (parseBool(row.consent_confirmed) !== true) errors.push('consent-not-confirmed');

  const attributes: Record<string, unknown> = {};
  for (const [col, f] of Object.entries(OPTIONAL_FIELDS)) {
    const v = row[col];
    if (isBlank(v)) continue;
    const parsed = parseField(col, f.spec, v);
    if ('error' in parsed) errors.push(parsed.error);
    else attributes[f.attr] = parsed.value;
  }

  if (errors.length > 0) {
    // Echo the id back only when it passed the PII checks. A rejected id could be an email.
    return { ok: false, clientId, errors };
  }
  return { ok: true, profile: { clientId: clientId as string, program: program as Program, status: status as ClientStatus, attributes } };
}

/** camelCase JSON body to the CSV row shape validateRow reads. Unknown keys come back in `unknown`. */
export function jsonToRow(body: Row): { row: Row; unknown: string[] } {
  const row: Row = {};
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    const col = COLUMN_BY_ATTR[k];
    if (col) row[col] = v;
    else unknown.push(k);
  }
  return { row, unknown };
}

export type PatchResult =
  | { ok: true; set: Record<string, unknown>; remove: string[] }
  | { ok: false; status: 400; error: string; columns?: string[]; errors?: string[] };

/**
 * PATCH body. Every key is optional. null clears an optional attribute.
 * clientId can't change, program and status can't be cleared, and forbidden
 * or unknown keys reject the whole request.
 */
export function validatePatch(body: Row): PatchResult {
  const keys = Object.keys(body);
  const forbidden = keys.filter((k) => (FORBIDDEN_COLUMNS as readonly string[]).includes(normalizeColumn(k)));
  if (forbidden.length > 0) return { ok: false, status: 400, error: 'forbidden-column', columns: forbidden.map(normalizeColumn).sort() };
  if ('clientId' in body) return { ok: false, status: 400, error: 'client-id-is-immutable' };
  if ('consentConfirmed' in body) return { ok: false, status: 400, error: 'consent-is-set-on-create' };

  const { row, unknown } = jsonToRow(body);
  if (unknown.length > 0) return { ok: false, status: 400, error: 'unknown-column', columns: unknown.sort() };
  if (keys.length === 0) return { ok: false, status: 400, error: 'empty-patch' };

  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  const errors: string[] = [];

  if ('program' in row) {
    const p = typeof row.program === 'string' ? row.program.trim().toLowerCase() : '';
    if ((PROGRAMS as readonly string[]).includes(p)) set.program = p;
    else errors.push('program-invalid');
  }
  if ('status' in row) {
    const s = typeof row.status === 'string' ? row.status.trim().toLowerCase() : '';
    if ((STATUSES as readonly string[]).includes(s)) set.status = s;
    else errors.push('status-invalid');
  }
  for (const [col, f] of Object.entries(OPTIONAL_FIELDS)) {
    if (!(col in row)) continue;
    const v = row[col];
    if (v === null) {
      remove.push(f.attr);
      continue;
    }
    const parsed = parseField(col, f.spec, v);
    if ('error' in parsed) errors.push(parsed.error);
    else set[f.attr] = parsed.value;
  }
  if (errors.length > 0) return { ok: false, status: 400, error: 'invalid-fields', errors };
  return { ok: true, set, remove };
}

/** Copy only whitelisted attributes. The second line of defence after the projection. */
export function pick(row: Row, fields: readonly string[]): Row {
  const out: Row = {};
  for (const f of fields) if (f in row && row[f] !== undefined) out[f] = row[f];
  return out;
}
