import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stanceContradictsReason } from './stance-check.ts';

// Returned live on 2026-09-30 for client 2026-031 on the PAL/TAL rule, with
// affectedStance "agree" and the Analyst's isAffected=false.
const REASON_2026_031 =
  'Client 2026-031 is affected by the rule: the exemption applies, but procedurally the client must submit proof of it. The isAffected=false is correct in the sense that no PAL/TAL document is required, but the corrected narrative and action clarify the procedural step that remains.';

describe('stance and reason contradiction check', () => {
  it('flags the 2026-031 reason: "agree" with not affected, while the reason says affected', () => {
    assert.equal(stanceContradictsReason('agree', false, REASON_2026_031), true);
  });

  it('flags the reverse: "agree" with affected, while the reason says not affected', () => {
    assert.equal(stanceContradictsReason('agree', true, 'Client c1 is not affected because the profile falls outside the rule.'), true);
  });

  it('flags "disagree" whose reason ends up where the Analyst did', () => {
    assert.equal(stanceContradictsReason('disagree', true, 'Client c1 remains affected since the rule covers the profile program.'), true);
    assert.equal(stanceContradictsReason('disagree', false, "Client c1 isn't affected, the rule names another program."), true);
  });

  it('passes a consistent reason for the same case', () => {
    const consistent = 'Client 2026-031 is not affected: the rule asks nothing of a client with the profile intendedStudyLevel.';
    assert.equal(stanceContradictsReason('agree', false, consistent), false);
  });

  it('passes the 2026-031 reason when the stance matches it', () => {
    assert.equal(stanceContradictsReason('disagree', false, REASON_2026_031), false);
    assert.equal(stanceContradictsReason('agree', true, REASON_2026_031), false);
  });

  it('never flags "uncertain"', () => {
    for (const analyst of [true, false]) {
      assert.equal(stanceContradictsReason('uncertain', analyst, REASON_2026_031), false);
      assert.equal(stanceContradictsReason('uncertain', analyst, 'Client c1 is not affected by the rule.'), false);
    }
  });

  it('ignores conditionals and mentions of the field', () => {
    const conditional = 'Client c1 is affected only if the profile shows a pending application, and it does not.';
    assert.equal(stanceContradictsReason('agree', false, conditional), false);
    const fieldMention = "The Analyst's not affected answer is wrong: the rule requires c1 to submit a new form, so c1 is affected.";
    assert.equal(stanceContradictsReason('disagree', false, fieldMention), false);
    assert.equal(stanceContradictsReason('agree', false, 'The isAffected=true reading does not hold for c1.'), false);
  });
});
