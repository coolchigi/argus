// Government ID number formats for the argus-safety guardrail regexes.
//
// These replace Bedrock's CA_SOCIAL_INSURANCE_NUMBER and
// US_SOCIAL_SECURITY_NUMBER entities. Those entities read context, so any
// number near the words SIN, SSN, "social insurance" or "social security"
// got flagged: client file numbers like 2026-042, NOC codes like 41220, even
// a CRS score of 489. A format match only fires on the digit shape itself.
//
// Kept to plain character classes, \b and non-capturing groups, the same
// syntax the postal-code and street-address regexes already run with.

// Canadian SIN: 9 digits as 3-3-3, with spaces, dashes or no separator.
// Matches any 9 digits in that shape, Luhn-valid or not, so a mistyped SIN
// is still blocked.
export const CA_SIN_PATTERN = String.raw`\b(?:[0-9]{3} [0-9]{3} [0-9]{3}|[0-9]{3}-[0-9]{3}-[0-9]{3}|[0-9]{9})\b`;

// US SSN: 9 digits as 3-2-4 with spaces or dashes. A bare 9-digit SSN is
// already caught by CA_SIN_PATTERN.
export const US_SSN_PATTERN = String.raw`\b(?:[0-9]{3}-[0-9]{2}-[0-9]{4}|[0-9]{3} [0-9]{2} [0-9]{4})\b`;
