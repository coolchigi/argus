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

// Phone number formats. These replace Bedrock's PHONE entity, which reads
// context the same way the SIN and SSN entities did. It flagged client IDs
// like 2026-042 next to words like "call", "contact" or "client", and runs of
// IDs like "2026-042 2026-061". Each pattern below needs the full digit shape
// of a phone number.

// North American area code, minus the toll-free codes 800, 833, 844, 855,
// 866, 877 and 888. A toll-free line belongs to an organization, so it can't
// identify a client, and IRCC prints 1-888-242-2100 on the contact pages
// Sentinel reads.
const NA_AREA = String.raw`(?:[2-79][0-9]{2}|8(?:[129][0-9]|0[1-9]|3[0-24-9]|4[0-35-9]|5[0-46-9]|6[0-57-9]|7[0-68-9]|8[0-79]))`;

// North American number: optional +1 or 1, area code bare or in brackets,
// then exchange and line, split by a space, dot, dash or nothing.
// e.g. 613-555-0142, (416) 555-0199, +1 604 555 0123, 6135550142.
export const NA_PHONE_PATTERN =
  String.raw`(?:\+?\b1[ .-]?(?:\(${NA_AREA}\) ?|${NA_AREA}[ .-]?)|\(${NA_AREA}\) ?|\b${NA_AREA}[ .-]?)[2-9][0-9]{2}[ .-]?[0-9]{4}\b`;

// International number with a + or 00 prefix and a country code that doesn't
// start with 1 (+1 goes through NA_PHONE_PATTERN so the toll-free carve-out
// holds), then 7 to 15 digits with up to 2 separators between any 2 of them.
// e.g. +44 20 7946 0958, +44 (0)20 7946 0958, 0044 20 7946 0958.
export const INTL_PHONE_PATTERN = String.raw`(?:\+|\b00)[2-9](?:[ .()-]{0,2}[0-9]){6,14}\b`;

// Domestic number with a leading trunk 0, the way the UK, France, Germany and
// much of Europe and Asia write them: 3 to 5 groups split by single spaces.
// e.g. 020 7946 0958, 01 42 68 53 00. Spaces only, because dots would match
// dates like 01.09.2026 and dashes would match runs of client IDs.
export const TRUNK_PHONE_PATTERN = String.raw`\b0[1-9][0-9]{0,4}(?: [0-9]{2,4}){2,4}\b`;
