// Response contracts for GET and PATCH /me (Phases D and E).
// Source of truth: services/me/src/model.ts. Keep both in sync.
//
// Consultant data only. Clients show up as a count and nothing else.

/** The program areas a consultant can turn off. Sentinel's `general` and `other` have no switch. */
export const MONITORED_DOMAINS = ["express-entry", "pgwp", "sowp", "pgp", "pnp", "study-permit"] as const;
export type MonitoredDomain = (typeof MONITORED_DOMAINS)[number];

/** ISO 3166-2:CA codes, the only values PATCH /me accepts. */
export const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"] as const;
export type Province = (typeof PROVINCES)[number];

/** Same limit the service enforces. */
export const FIRM_MAX_LENGTH = 120;

export type MePreferences = {
  policyDomains: Record<MonitoredDomain, boolean>;
  realtimeAlerts: boolean;
  showIdentityOnPublicReceipts: boolean;
};

export type MeSigning = {
  keyId: string;
  /** KMS enum, "ECDSA_SHA_256". */
  algorithm: string;
  curve: string;
  /** Hex SHA-256 of the DER public key. Matches the key the browser verifier pins. */
  spkiSha256: string;
  createdAt: string | null;
};

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
  preferences: MePreferences;
  onboarding: { step: number; completedAt: string | null; skippedAt: string | null };
  /** null when the service couldn't read KMS. */
  signing: MeSigning | null;
  setup: {
    provisioned: boolean;
    profileComplete: boolean;
    /** Program areas were saved at least once. The defaults don't count. */
    domainsChosen: boolean;
    clientCount: number;
    hasAssessments: boolean;
  };
};

export type PatchMeRequest = {
  firm?: string | null;
  province?: Province | null;
  preferences?: {
    policyDomains?: Partial<Record<MonitoredDomain, boolean>>;
    realtimeAlerts?: boolean;
    showIdentityOnPublicReceipts?: boolean;
  };
  onboarding?: { step?: number; complete?: true; skip?: true };
};

export type PatchMeError =
  | "unknown-field"
  | "empty-patch"
  | "invalid-firm"
  | "firm-too-long"
  | "invalid-province"
  | "invalid-preferences"
  | "unknown-preference"
  | "unknown-policy-domain"
  | "invalid-preference-value"
  | "invalid-onboarding"
  | "consultant-not-provisioned"
  | "concurrent-update";
