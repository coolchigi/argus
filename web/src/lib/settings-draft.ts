/**
 * Pure logic behind the Settings form: the editable draft, validation, and the
 * diff that becomes a PATCH /me body. No React, so settings-draft.test.ts runs
 * it directly.
 */

import {
  FIRM_MAX_LENGTH,
  MONITORED_DOMAINS,
  PROVINCES,
  type MeResponse,
  type MonitoredDomain,
  type PatchMeRequest,
  type Province,
} from "./types/me.ts";

export type SettingsDraft = {
  firm: string;
  /** "" means not set. */
  province: Province | "";
  policyDomains: Record<MonitoredDomain, boolean>;
  realtimeAlerts: boolean;
  /** Name and R-license on public receipts. Off unless the consultant turns it on. */
  showIdentityOnPublicReceipts: boolean;
};

export const PROVINCE_LABELS: Record<Province, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

/** What each switch covers, in the consultant's words. Labels only. */
export const DOMAIN_DESCRIPTIONS: Record<MonitoredDomain, string> = {
  "express-entry": "Draws, CRS and program instructions",
  pgwp: "Post-graduation work permits",
  sowp: "Spousal open work permits",
  pgp: "Parents and Grandparents Program",
  pnp: "Provincial Nominee Program",
  "study-permit": "Study permits",
};

export function draftFromMe(me: MeResponse): SettingsDraft {
  return {
    firm: me.consultant.firm ?? "",
    province: me.consultant.province ?? "",
    policyDomains: { ...me.preferences.policyDomains },
    realtimeAlerts: me.preferences.realtimeAlerts,
    showIdentityOnPublicReceipts: me.preferences.showIdentityOnPublicReceipts === true,
  };
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type DraftErrors = { firm?: string; province?: string };

/** Same rules the service applies, so the form catches them before a round trip. */
export function validateDraft(draft: SettingsDraft): DraftErrors {
  const errors: DraftErrors = {};
  const firm = draft.firm.trim();
  if (firm.length > FIRM_MAX_LENGTH) errors.firm = `Keep it to ${FIRM_MAX_LENGTH} characters. It's ${firm.length} now.`;
  else if (CONTROL_CHARS.test(firm)) errors.firm = "Use a single line with no special characters.";
  if (draft.province !== "" && !(PROVINCES as readonly string[]).includes(draft.province)) errors.province = "Pick a province or territory from the list.";
  return errors;
}

/**
 * The PATCH body that turns `saved` into `draft`, or null when nothing
 * changed. Only changed fields go out, and only the areas that flipped, so a
 * save never overwrites a field the consultant didn't touch.
 */
export function diffDraft(saved: SettingsDraft, draft: SettingsDraft): PatchMeRequest | null {
  const body: PatchMeRequest = {};
  const firm = draft.firm.trim();
  if (firm !== saved.firm.trim()) body.firm = firm === "" ? null : firm;
  if (draft.province !== saved.province) body.province = draft.province === "" ? null : draft.province;

  const domains: Partial<Record<MonitoredDomain, boolean>> = {};
  for (const d of MONITORED_DOMAINS) {
    if (draft.policyDomains[d] !== saved.policyDomains[d]) domains[d] = draft.policyDomains[d];
  }
  const prefs: NonNullable<PatchMeRequest["preferences"]> = {};
  if (Object.keys(domains).length > 0) prefs.policyDomains = domains;
  if (draft.realtimeAlerts !== saved.realtimeAlerts) prefs.realtimeAlerts = draft.realtimeAlerts;
  if (draft.showIdentityOnPublicReceipts !== saved.showIdentityOnPublicReceipts) {
    prefs.showIdentityOnPublicReceipts = draft.showIdentityOnPublicReceipts;
  }
  if (Object.keys(prefs).length > 0) body.preferences = prefs;

  return Object.keys(body).length > 0 ? body : null;
}

/** How many separate things changed, for the save bar. */
export function changeCount(saved: SettingsDraft, draft: SettingsDraft): number {
  const body = diffDraft(saved, draft);
  if (!body) return 0;
  return (
    ("firm" in body ? 1 : 0) +
    ("province" in body ? 1 : 0) +
    Object.keys(body.preferences?.policyDomains ?? {}).length +
    (body.preferences && "realtimeAlerts" in body.preferences ? 1 : 0) +
    (body.preferences && "showIdentityOnPublicReceipts" in body.preferences ? 1 : 0)
  );
}

const ERROR_COPY: Record<string, string> = {
  "invalid-province": "That province isn't one Argus recognizes. Pick one from the list.",
  "firm-too-long": `Firm name can be up to ${FIRM_MAX_LENGTH} characters.`,
  "invalid-firm": "Firm name has characters Argus can't store. Use a single line.",
  "unknown-policy-domain": "One of the program areas isn't one Argus monitors. Reload and try again.",
  "consultant-not-provisioned": "Your account isn't fully set up yet. Sign out and back in, then try again.",
  "concurrent-update": "These settings changed in another tab. Reload to see the latest, then save again.",
};

export function describeMeError(code: string | null | undefined): string {
  if (code && ERROR_COPY[code]) return ERROR_COPY[code];
  return "Couldn't save your settings. Try again.";
}
