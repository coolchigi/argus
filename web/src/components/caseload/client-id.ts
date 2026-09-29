// Case numbers the argus-safety guardrail would block as a SIN or SSN.
//
// The Analyst sends the whole client profile, case number included, through
// the guardrail. A case number its ca-sin or us-ssn regex matches gets every
// assessment for that client blocked, so the browser refuses it before
// upload and the server (services/profiles/src/validate.ts) refuses it again.
//
// The regexes are a copy of infra/lib/guardrail-patterns.ts. The web build
// can't import from infra, so client-id.test.ts reads that file and fails if
// the copy drifts.

export const CA_SIN_PATTERN = String.raw`\b(?:[0-9]{3} [0-9]{3} [0-9]{3}|[0-9]{3}-[0-9]{3}-[0-9]{3}|[0-9]{9})\b`;

export const US_SSN_PATTERN = String.raw`\b(?:[0-9]{3}-[0-9]{2}-[0-9]{4}|[0-9]{3} [0-9]{2} [0-9]{4})\b`;

const GUARDRAIL_ID_RES = [new RegExp(CA_SIN_PATTERN), new RegExp(US_SSN_PATTERN)];

/**
 * True when the guardrail would block this case number. Unanchored, same as
 * the guardrail: `\b` sits between a dash and a digit, so F-123456789 is
 * blocked while F123456789 isn't.
 */
export function looksLikeSinOrSsn(clientId: string): boolean {
  const id = clientId.trim();
  return GUARDRAIL_ID_RES.some((re) => re.test(id));
}

const FIX = "Put a letter in front with no dash or space (e.g. F123456789), or use a format like 2026-042.";

export const SIN_SHAPED_ID_MESSAGE = `This case number looks like a SIN or SSN, so Argus can't use it. ${FIX}`;

/** Whole-file message. Lists up to 5 row numbers. */
export function sinShapedRowsMessage(rows: number[]): string {
  const shown = rows.slice(0, 5).join(", ");
  const more = rows.length > 5 ? ` and ${rows.length - 5} more` : "";
  const where = rows.length === 1 ? `The case number on row ${shown} looks` : `The case numbers on rows ${shown}${more} look`;
  return `We didn't import this file. ${where} like a SIN or SSN, so Argus can't use ${rows.length === 1 ? "it" : "them"}. ${FIX}`;
}
