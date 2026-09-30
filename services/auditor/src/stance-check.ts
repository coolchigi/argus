// A deterministic check that the Auditor's stance and its reason reach the
// same answer. On 2026-09-30 the Auditor returned "agree" with the Analyst's
// isAffected=false, and a reason that opened "Client 2026-031 is affected by
// the rule". The model decides the stance. This only catches a reason that
// plainly says the opposite of it.
//
// It reads plain statements about the client ("is affected", "is not
// affected", "remains unaffected"). Conditionals ("is affected if ...") and
// mentions of the field ("isAffected=false", "the not affected answer") don't
// count, since they don't say what the Auditor concluded.

import type { AffectedStance } from './handler';

const COPULA = String.raw`(?:is|are|remains|stays|was)`;
const CONDITIONAL = String.raw`(?!\s+(?:only\s+)?(?:if|when|unless)\b)`;

const SAYS_AFFECTED = new RegExp(String.raw`\b${COPULA}\s+(?:still\s+|directly\s+|indeed\s+|also\s+)?affected\b${CONDITIONAL}`, 'i');
const SAYS_NOT_AFFECTED = new RegExp(
  String.raw`\b(?:${COPULA}\s+(?:not|no\s+longer|still\s+not)\s+affected|(?:isn't|aren't|wasn't)\s+affected|${COPULA}\s+(?:still\s+)?unaffected)\b${CONDITIONAL}`,
  'i',
);

/**
 * True when the reason states the answer the stance rejects. "agree" means
 * the Auditor's answer is the Analyst's isAffected, "disagree" the opposite.
 * "uncertain" takes no side, so it never contradicts.
 */
export function stanceContradictsReason(stance: AffectedStance, analystIsAffected: boolean, reason: string): boolean {
  if (stance === 'uncertain') return false;
  const stanceSaysAffected = stance === 'agree' ? analystIsAffected : !analystIsAffected;
  return stanceSaysAffected ? SAYS_NOT_AFFECTED.test(reason) : SAYS_AFFECTED.test(reason);
}
