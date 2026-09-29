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
  tal: "TAL",
  dli: "DLI",
  sin: "SIN",
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

// Acronym pairs IRCC names as alternatives, written with a slash: the
// provincial or territorial attestation letter, and the English or French
// language benchmark.
const SLASH_PAIRS = new Set(["pal/tal", "clb/nclc"]);

// Words that close a compound modifier and keep the hyphen before them:
// "category-based", "program-specific".
const COMPOUND_TAILS = new Set(["based", "specific", "related"]);

/**
 * "crs-scorecard" becomes "CRS scorecard". "express-entry-draws" becomes
 * "Express Entry draws". "pal-tal-requirements" becomes "PAL/TAL requirements".
 * "ee-category-based-selection" becomes "EE category-based selection".
 */
export function humanizeTopic(topic: string | null | undefined): string {
  if (!topic) return "Untitled change";
  const raw = topic.split(/[-_\s]+/).filter(Boolean).map((w) => w.toLowerCase());
  const words = raw.map((lower, i) => {
    if (ACRONYMS[lower]) return ACRONYMS[lower];
    if (PROPER[lower]) return PROPER[lower];
    if (/^p\d+$/.test(lower)) return lower.toUpperCase();
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return words.reduce((out, word, i) => {
    if (i === 0) return word;
    const sep = SLASH_PAIRS.has(`${raw[i - 1]}/${raw[i]}`) ? "/" : COMPOUND_TAILS.has(raw[i]) ? "-" : " ";
    return out + sep + word;
  }, "");
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

const SIGNATURE_ALGORITHM_LABELS: Record<string, string> = {
  ECDSA_SHA_256: "ECDSA P-256 (SHA-256)",
};

/** KMS signing enum to a readable name. "ECDSA_SHA_256" becomes "ECDSA P-256 (SHA-256)". */
export function humanizeSignatureAlgorithm(a: string | null | undefined): string {
  if (!a) return "Not set";
  return SIGNATURE_ALGORITHM_LABELS[a] ?? a;
}
