// Shared copy and class names for the caseload screens.

import { ApiError } from "@/lib/api";

export const PII_WARNING = "Use your own case numbers. Don't include names, emails or anything that identifies a person.";

/** Wording from docs/user-workflows.md step 3. */
export const CONSENT_LABEL = "I confirm I have obtained client consent to process this data via Argus's third-party service.";

export const buttonPrimary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-brand-ink bg-brand px-4 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover disabled:pointer-events-none disabled:opacity-50";

export const buttonSecondary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-control bg-surface px-4 text-[13px] text-ink-1 transition-colors hover:bg-sunk disabled:pointer-events-none disabled:opacity-50";

export const fieldClass =
  "h-9 w-full rounded-sm border border-control bg-sunk px-3 text-[13px] text-ink-1 placeholder:text-ink-3";

const ROW_ERRORS: Record<string, string> = {
  "client-id-required": "Case number is missing",
  "client-id-looks-like-email": "Case number looks like an email address",
  "client-id-looks-like-phone": "Case number looks like a phone number",
  "client-id-looks-like-sin": "Case number looks like a SIN",
  "client-id-invalid-pattern": "Case number can use letters, digits, dots, dashes and underscores, up to 40 characters",
  "program-invalid": "Program isn't one Argus tracks",
  "status-invalid": "Status must be active, submitted or closed",
  "consent-not-confirmed": "Consent isn't confirmed for this row",
  "duplicate-client-id-in-file": "Case number appears more than once in the file",
  "client-exists": "Client is already in your caseload",
  "client-not-found": "Client isn't in your caseload",
};

/** "current_crs_score-must-be-a-number" becomes "Current CRS score must be a number". */
export function describeRowError(code: string): string {
  if (ROW_ERRORS[code]) return ROW_ERRORS[code];
  const m = /^([a-z0-9_]+)-(.+)$/.exec(code);
  if (!m) return code;
  const field = m[1].replace(/_/g, " ").replace(/\bcrs\b/, "CRS").replace(/\bclb\b/, "CLB").replace(/\bnoc\b/, "NOC").replace(/\bteer\b/, "TEER").replace(/\bcip\b/, "CIP").replace(/\bpgp\b/, "PGP").replace(/\bpnp\b/, "PNP").replace(/\bpal\b/, "PAL").replace(/\blico\b/, "LICO");
  const rule = m[2].replace(/-/g, " ");
  return `${field.charAt(0).toUpperCase()}${field.slice(1)} ${rule}`;
}

/** Whole-file errors, from the browser check or the server's 400. */
export function describeFileError(err: { error: string; columns?: string[]; count?: number; received?: number; max?: number }): string {
  const cols = (err.columns ?? []).join(", ");
  switch (err.error) {
    case "forbidden-column":
      return `We didn't import this file. It has a column that identifies a person: ${cols}. Remove it and try again.`;
    case "unknown-column":
      return `We didn't import this file. Argus doesn't know these columns: ${cols}. Remove or rename them and try again.`;
    case "missing-column":
      return `We didn't import this file. It's missing required columns: ${cols}.`;
    case "too-many-rows":
      return `We didn't import this file. It has ${err.count ?? err.received} rows and the limit is ${err.max ?? 500}. Split it and import each part.`;
    case "empty":
    case "no-rows":
      return "This file has no client rows under the header.";
    default:
      return "We couldn't read this file.";
  }
}

/** The server's structured 400 body, when there is one. */
export function fileErrorFrom(err: unknown): { error: string; columns?: string[]; received?: number; max?: number } | null {
  if (err instanceof ApiError && err.status === 400 && err.body && typeof err.body === "object" && "error" in err.body) {
    return err.body as { error: string; columns?: string[] };
  }
  return null;
}
