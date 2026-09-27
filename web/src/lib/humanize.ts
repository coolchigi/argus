/**
 * Turns machine ids into sentence-case labels for the UI. Labels only. Never
 * use these maps to decide anything about eligibility or scoring.
 */

const ACRONYMS: Record<string, string> = {
  crs: "CRS",
  ee: "EE",
  ircc: "IRCC",
  ita: "ITA",
  lmia: "LMIA",
  noc: "NOC",
  teer: "TEER",
  pgwp: "PGWP",
  sowp: "SOWP",
  pgp: "PGP",
  pnp: "PNP",
  cec: "CEC",
  fsw: "FSW",
  fst: "FST",
  clb: "CLB",
  nclc: "NCLC",
  ielts: "IELTS",
  tef: "TEF",
  cicc: "CICC",
  rcic: "RCIC",
  gcms: "GCMS",
  eta: "eTA",
  trv: "TRV",
  sds: "SDS",
  pal: "PAL",
};

// Proper nouns keep their capitals inside a sentence-case label.
const PROPER: Record<string, string> = {
  express: "Express",
  entry: "Entry",
  french: "French",
  canada: "Canada",
  canadian: "Canadian",
  quebec: "Quebec",
  atlantic: "Atlantic",
};

/** "crs-scorecard" becomes "CRS scorecard". "express-entry-draws" becomes "Express Entry draws". */
export function humanizeTopic(topic: string | null | undefined): string {
  if (!topic) return "Untitled change";
  const words = topic
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      if (PROPER[lower]) return PROPER[lower];
      if (/^p\d+$/.test(lower)) return lower.toUpperCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    });
  return words.join(" ");
}

export type PolicyDomain =
  | "express-entry"
  | "pgwp"
  | "sowp"
  | "pgp"
  | "pnp"
  | "study-permit"
  | "general"
  | "other";

/** Sentinel's policyDomain set (services/sentinel/src/handler.ts classify prompt). */
export const POLICY_DOMAIN_LABELS: Record<PolicyDomain, string> = {
  "express-entry": "Express Entry",
  pgwp: "PGWP",
  sowp: "SOWP",
  pgp: "PGP",
  pnp: "PNP",
  "study-permit": "Study permit",
  general: "General",
  other: "Other",
};

export function humanizePolicyDomain(domain: string | null | undefined): string {
  if (!domain) return "Not set";
  return POLICY_DOMAIN_LABELS[domain as PolicyDomain] ?? humanizeTopic(domain);
}

export const IMPACT_TYPE_LABELS: Record<string, string> = {
  "crs-delta": "CRS points changed",
  "eligibility-flip": "Eligibility changed",
  "deadline-shift": "Deadline shifted",
  "lmia-implication": "LMIA implication",
  "french-bonus": "French bonus affected",
  procedural: "Procedural change",
  none: "No impact",
};

export function humanizeImpactType(t: string | null | undefined): string {
  if (!t) return "Not set";
  return IMPACT_TYPE_LABELS[t] ?? humanizeTopic(t);
}

export const POLICY_CATEGORY_LABELS: Record<string, string> = {
  "ministerial-instruction": "Ministerial instruction",
  "news-release": "News release",
  "rounds-of-invitations": "Rounds of invitations",
  "policy-page-change": "Policy page change",
};

export function humanizeCategory(c: string | null | undefined): string {
  if (!c) return "Not set";
  return POLICY_CATEGORY_LABELS[c] ?? humanizeTopic(c);
}

export function humanizeSeverity(s: string | null | undefined): string {
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  return "Not set";
}
