// Pure model for GET and PATCH /me. No AWS calls, so model.test.ts runs it
// directly. Response shapes live in web/src/lib/types/me.ts.
//
// PII: this service holds consultant data only (their own name, email,
// R-license, firm, province). Nothing about a client passes through it apart
// from a count of profiles.
//
// Firm, province, preferences and onboarding live on the argus-rcic-users row,
// never in Cognito custom attributes (PHASE8_PLAN section 4, Q6).

export type Row = Record<string, unknown>;

/**
 * Sentinel's policyDomain set, from the classify prompt in
 * services/sentinel/src/handler.ts. Services don't share code, so a change
 * there has to land here, in services/profiles/src/validate.ts, and in the
 * Analyst and Recall preference filters.
 */
export const POLICY_DOMAINS = ['express-entry', 'pgwp', 'sowp', 'pgp', 'pnp', 'study-permit', 'general', 'other'] as const;

/**
 * The areas a consultant can turn off. `general` and `other` are
 * cross-program changes with no client program of their own, so they have no
 * switch. The Analyst and Recall narrow them to clients whose program is on.
 */
export const MONITORED_DOMAINS = ['express-entry', 'pgwp', 'sowp', 'pgp', 'pnp', 'study-permit'] as const;
export type MonitoredDomain = (typeof MONITORED_DOMAINS)[number];

/** Canadian provinces and territories, ISO 3166-2:CA subdivision codes. */
export const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;
export type Province = (typeof PROVINCES)[number];

export const FIRM_MAX_LENGTH = 120;
export const ONBOARDING_STEPS = 4;

const PATCH_FIELDS = ['firm', 'province', 'preferences', 'onboarding'] as const;
const PREFERENCE_FIELDS = ['policyDomains', 'realtimeAlerts', 'showIdentityOnPublicReceipts'] as const;
const ONBOARDING_FIELDS = ['step', 'complete', 'skip'] as const;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type PatchError =
  | 'unknown-field'
  | 'empty-patch'
  | 'invalid-firm'
  | 'firm-too-long'
  | 'invalid-province'
  | 'invalid-preferences'
  | 'unknown-preference'
  | 'unknown-policy-domain'
  | 'invalid-preference-value'
  | 'invalid-onboarding';

/** A validated PATCH. A key that's absent means "leave it alone". null clears. */
export type PatchPlan = {
  firm?: string | null;
  province?: Province | null;
  policyDomains?: Partial<Record<MonitoredDomain, boolean>>;
  realtimeAlerts?: boolean;
  showIdentityOnPublicReceipts?: boolean;
  onboarding?: { step?: number; complete?: true; skip?: true };
};

export type Validation = { ok: true; plan: PatchPlan } | { ok: false; error: PatchError; fields?: string[] };

export function validatePatch(body: Row): Validation {
  const unknown = Object.keys(body).filter((k) => !(PATCH_FIELDS as readonly string[]).includes(k));
  if (unknown.length > 0) return { ok: false, error: 'unknown-field', fields: unknown.sort() };

  const plan: PatchPlan = {};

  if ('firm' in body) {
    const firm = body.firm;
    if (firm === null) plan.firm = null;
    else if (typeof firm !== 'string') return { ok: false, error: 'invalid-firm' };
    else {
      const trimmed = firm.trim();
      if (CONTROL_CHARS.test(trimmed)) return { ok: false, error: 'invalid-firm' };
      if (trimmed.length > FIRM_MAX_LENGTH) return { ok: false, error: 'firm-too-long' };
      plan.firm = trimmed.length === 0 ? null : trimmed;
    }
  }

  if ('province' in body) {
    const p = body.province;
    if (p === null) plan.province = null;
    else if (typeof p === 'string' && (PROVINCES as readonly string[]).includes(p)) plan.province = p as Province;
    else return { ok: false, error: 'invalid-province' };
  }

  if ('preferences' in body) {
    const prefs = body.preferences;
    if (!isObject(prefs)) return { ok: false, error: 'invalid-preferences' };
    const unknownPrefs = Object.keys(prefs).filter((k) => !(PREFERENCE_FIELDS as readonly string[]).includes(k));
    if (unknownPrefs.length > 0) return { ok: false, error: 'unknown-preference', fields: unknownPrefs.sort() };

    if ('policyDomains' in prefs) {
      const domains = prefs.policyDomains;
      if (!isObject(domains)) return { ok: false, error: 'invalid-preferences' };
      const unknownDomains = Object.keys(domains).filter((d) => !(MONITORED_DOMAINS as readonly string[]).includes(d));
      if (unknownDomains.length > 0) return { ok: false, error: 'unknown-policy-domain', fields: unknownDomains.sort() };
      const out: Partial<Record<MonitoredDomain, boolean>> = {};
      for (const [d, v] of Object.entries(domains)) {
        if (typeof v !== 'boolean') return { ok: false, error: 'invalid-preference-value', fields: [d] };
        out[d as MonitoredDomain] = v;
      }
      if (Object.keys(out).length > 0) plan.policyDomains = out;
    }
    for (const key of ['realtimeAlerts', 'showIdentityOnPublicReceipts'] as const) {
      if (!(key in prefs)) continue;
      const v = prefs[key];
      if (typeof v !== 'boolean') return { ok: false, error: 'invalid-preference-value', fields: [key] };
      plan[key] = v;
    }
  }

  if ('onboarding' in body) {
    const ob = body.onboarding;
    if (!isObject(ob)) return { ok: false, error: 'invalid-onboarding' };
    if (Object.keys(ob).some((k) => !(ONBOARDING_FIELDS as readonly string[]).includes(k))) return { ok: false, error: 'invalid-onboarding' };
    const next: NonNullable<PatchPlan['onboarding']> = {};
    if ('step' in ob) {
      const s = ob.step;
      if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > ONBOARDING_STEPS) return { ok: false, error: 'invalid-onboarding' };
      next.step = s;
    }
    if ('complete' in ob) {
      if (ob.complete !== true) return { ok: false, error: 'invalid-onboarding' };
      next.complete = true;
    }
    if ('skip' in ob) {
      if (ob.skip !== true) return { ok: false, error: 'invalid-onboarding' };
      next.skip = true;
    }
    if (next.complete && next.skip) return { ok: false, error: 'invalid-onboarding' };
    if (Object.keys(next).length > 0) plan.onboarding = next;
  }

  if (Object.keys(plan).length === 0) return { ok: false, error: 'empty-patch' };
  return { ok: true, plan };
}

/**
 * Turns a plan into top-level attribute writes against the stored row.
 * Nested maps (preferences, onboarding) are merged here and written whole, so
 * a PATCH that only touches one domain keeps every other domain and every
 * other preference as stored. Top-level attributes the plan doesn't name
 * (email, active, rcicLicense) are never in `set` or `remove`.
 */
export function planWrites(row: Row, plan: PatchPlan, now: string): { set: Row; remove: string[] } {
  const set: Row = {};
  const remove: string[] = [];

  if ('firm' in plan) {
    if (plan.firm === null) remove.push('firm');
    else set.firm = plan.firm;
  }
  if ('province' in plan) {
    if (plan.province === null) remove.push('province');
    else set.province = plan.province;
  }

  const prefsTouched = plan.policyDomains !== undefined || plan.realtimeAlerts !== undefined || plan.showIdentityOnPublicReceipts !== undefined;
  if (prefsTouched) {
    const prev = isObject(row.preferences) ? row.preferences : {};
    const next: Row = { ...prev };
    if (plan.policyDomains) {
      const prevDomains = isObject(prev.policyDomains) ? prev.policyDomains : {};
      next.policyDomains = { ...prevDomains, ...plan.policyDomains };
    }
    if (plan.realtimeAlerts !== undefined) next.realtimeAlerts = plan.realtimeAlerts;
    if (plan.showIdentityOnPublicReceipts !== undefined) next.showIdentityOnPublicReceipts = plan.showIdentityOnPublicReceipts;
    set.preferences = next;
  }

  if (plan.onboarding) {
    const prev = isObject(row.onboarding) ? row.onboarding : {};
    const next: Row = { ...prev };
    if (plan.onboarding.step !== undefined) next.step = plan.onboarding.step;
    if (plan.onboarding.complete) {
      next.completedAt = now;
      next.step = ONBOARDING_STEPS;
    }
    if (plan.onboarding.skip) next.skippedAt = now;
    set.onboarding = next;
  }

  set.updatedAt = now;
  return { set, remove };
}

export type Signing = {
  keyId: string;
  algorithm: string;
  curve: string;
  /** Hex SHA-256 of the DER SubjectPublicKeyInfo, the same value the browser verifier pins. */
  spkiSha256: string;
  createdAt: string | null;
};

export type Claims = Record<string, unknown>;

export type MeResponse = {
  consultant: {
    rcicId: string;
    rcicLicense: string | null;
    givenName: string | null;
    familyName: string | null;
    displayName: string | null;
    email: string | null;
    firm: string | null;
    province: Province | null;
  };
  preferences: {
    policyDomains: Record<MonitoredDomain, boolean>;
    realtimeAlerts: boolean;
    showIdentityOnPublicReceipts: boolean;
  };
  onboarding: { step: number; completedAt: string | null; skippedAt: string | null };
  /** null when KMS couldn't be read. The rest of the response still stands. */
  signing: Signing | null;
  setup: {
    /** An RcicUsers row exists. PATCH needs one. */
    provisioned: boolean;
    profileComplete: boolean;
    /** The consultant has saved program areas at least once. The defaults (all on) don't count. */
    domainsChosen: boolean;
    clientCount: number;
    hasAssessments: boolean;
  };
};

/**
 * Builds the /me body. Identity comes from the Cognito claims first, because
 * that's what the consultant signed up with, then falls back to the row.
 * Preferences resolve to defaults for any value that isn't stored as a
 * boolean. Areas and alerts default on, so only an explicit false turns them
 * off. showIdentityOnPublicReceipts defaults off, so only an explicit true
 * turns it on.
 */
export function toMeResponse(input: {
  rcicId: string;
  claims: Claims;
  row: Row | null;
  signing: Signing | null;
  clientCount: number;
  hasAssessments: boolean;
}): MeResponse {
  const { rcicId, claims, signing, clientCount, hasAssessments } = input;
  const row = input.row ?? {};
  const givenName = text(claims.given_name);
  const familyName = text(claims.family_name);
  const joined = [givenName, familyName].filter(Boolean).join(' ');
  const firm = text(row.firm);
  const provinceRaw = text(row.province);
  const province = provinceRaw && (PROVINCES as readonly string[]).includes(provinceRaw) ? (provinceRaw as Province) : null;

  const prefs = isObject(row.preferences) ? row.preferences : {};
  const storedDomains = isObject(prefs.policyDomains) ? prefs.policyDomains : null;
  const policyDomains = Object.fromEntries(MONITORED_DOMAINS.map((d) => [d, storedDomains?.[d] !== false])) as Record<MonitoredDomain, boolean>;

  const ob = isObject(row.onboarding) ? row.onboarding : {};
  const step = typeof ob.step === 'number' && Number.isInteger(ob.step) && ob.step >= 1 && ob.step <= ONBOARDING_STEPS ? ob.step : 1;

  return {
    consultant: {
      rcicId,
      rcicLicense: text(claims['custom:rcic_license']) ?? text(row.rcicLicense),
      givenName,
      familyName,
      displayName: text(row.displayName) ?? (joined || null),
      email: text(claims.email) ?? text(row.email),
      firm,
      province,
    },
    preferences: {
      policyDomains,
      realtimeAlerts: prefs.realtimeAlerts !== false,
      // Consultant identity on public receipts is opt-in: only an explicit
      // true turns it on (GET /public/verify reads the same rule).
      showIdentityOnPublicReceipts: prefs.showIdentityOnPublicReceipts === true,
    },
    onboarding: { step, completedAt: text(ob.completedAt), skippedAt: text(ob.skippedAt) },
    signing,
    setup: {
      provisioned: input.row !== null,
      profileComplete: firm !== null && province !== null,
      domainsChosen: storedDomains !== null,
      clientCount,
      hasAssessments,
    },
  };
}

export function isObject(v: unknown): v is Row {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}
