// The argus-safety guardrail's ca-sin and us-ssn regexes, copied from
// infra/lib/guardrail-patterns.ts. Services don't share code, so this is a
// copy, and guardrail-patterns.test.ts reads the infra file and fails if the
// two drift apart.
//
// The Analyst sends the whole client profile, clientId included, through the
// guardrail. A clientId either regex matches gets every assessment for that
// client blocked, so the profiles API refuses it up front.

export const CA_SIN_PATTERN = String.raw`\b(?:[0-9]{3} [0-9]{3} [0-9]{3}|[0-9]{3}-[0-9]{3}-[0-9]{3}|[0-9]{9})\b`;

export const US_SSN_PATTERN = String.raw`\b(?:[0-9]{3}-[0-9]{2}-[0-9]{4}|[0-9]{3} [0-9]{2} [0-9]{4})\b`;

const GUARDRAIL_ID_RES = [new RegExp(CA_SIN_PATTERN), new RegExp(US_SSN_PATTERN)];

/**
 * True when the guardrail would block this text. Unanchored, same as the
 * guardrail: `\b` sits between a dash and a digit, so F-123456789 is blocked
 * while F123456789 isn't.
 */
export function matchesGuardrailIdPattern(text: string): boolean {
  return GUARDRAIL_ID_RES.some((re) => re.test(text));
}
