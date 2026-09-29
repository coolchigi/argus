import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PGP_042_ACTIONS, PGP_042_ASSESSMENT, PGP_042_BODY, PGP_RULE_CONTENT } from './fixtures.pgp-042.ts';
import { checkBriefGrounding, normalize } from './grounding.ts';
import { checkBriefVoice } from './voice.ts';

const liveSources = [
  PGP_RULE_CONTENT,
  PGP_042_ASSESSMENT.narrative,
  PGP_042_ASSESSMENT.recommendedAction,
  PGP_042_ASSESSMENT.citationSourceUrl,
];

// The same notice with its super visa paragraph cut, and an assessment that
// never mentions the super visa. This is the case the check exists for: a
// brief that brings in a program and its durations from model memory.
const superVisaParagraph = PGP_RULE_CONTENT.split('\n\n').find((p) => p.includes('super visa'));
assert.ok(superVisaParagraph, 'the live rule text mentions the super visa');
const sourcesWithoutSuperVisa = [
  PGP_RULE_CONTENT.replace(superVisaParagraph, ''),
  'the client cannot submit a new PGP interest to sponsor form under the current intake pause.',
  'Advise the client to await IRCC notice of intake resumption.',
  PGP_042_ASSESSMENT.citationSourceUrl,
];

describe('checkBriefGrounding', () => {
  it('flags the 2026-042 super visa claims when no source mentions the super visa', () => {
    const findings = checkBriefGrounding(PGP_042_BODY, sourcesWithoutSuperVisa);
    assert.deepEqual(findings, [
      { kind: 'duration', value: '5 years' },
      { kind: 'duration', value: '10 years' },
      { kind: 'program', value: 'super visa' },
    ]);
  });

  it('finds nothing ungrounded in the live 2026-042 brief against its real rule and assessment', () => {
    // The live notice says the super visa lets parents visit "for 5 years at
    // a time" with multiple entries "for up to 10 years", and the signed
    // recommendedAction repeats both. The brief's paraphrase keeps them.
    assert.deepEqual(checkBriefGrounding([PGP_042_BODY, ...PGP_042_ACTIONS].join('\n'), liveSources), []);
  });

  it('passes a grounded brief', () => {
    const body =
      "IRCC has paused new applications under the Parents and Grandparents Program. It won't accept new interest to sponsor forms until further notice.\n\n" +
      'IRCC still plans to approve up to 15,000 people through the PGP Program in 2026. Your parents and grandparents can still visit through the super visa, for 5 years at a time.\n\n' +
      'Let me know whether you meant to sponsor under the PGP. Read [IRCC\'s notice](https://www.canada.ca/en/immigration-refugees-citizenship/news/notices/responsibly-manage-parent-grandparent-program.html).';
    assert.deepEqual(checkBriefGrounding(body, liveSources), []);
  });

  it('flags a dollar amount, a date and a bare number the sources never give', () => {
    const body = 'The fee is $1,080. Intake reopens on January 5, 2027, with 20,000 spaces.';
    assert.deepEqual(checkBriefGrounding(body, liveSources), [
      { kind: 'money', value: '$1080' },
      { kind: 'date', value: 'january 5, 2027' },
      { kind: 'number', value: '20000' },
    ]);
  });

  it('grounds a date, a number with a comma and a spelled-out duration against the source', () => {
    const body = 'IRCC announced this on July 15, 2026. It plans 15000 approvals. A super visa visit can last 5 years.';
    const sources = ['Ottawa, July 15, 2026. Up to 15,000 people. Visit for five years at a time with the super visa.'];
    assert.deepEqual(checkBriefGrounding(body, sources), []);
  });

  it('flags a program acronym and a qualified permit the sources never name', () => {
    const body = 'You could apply through the PNP instead, or get an open work permit.';
    assert.deepEqual(checkBriefGrounding(body, liveSources), [
      { kind: 'program', value: 'open work permit' },
      { kind: 'program', value: 'PNP' },
    ]);
  });

  it('matches a number only as a whole number', () => {
    // 5 appears in the source only inside 15 and 2.5.
    assert.deepEqual(checkBriefGrounding('Wait 5 weeks.', ['Section 15 says 2.5 weeks.']), [{ kind: 'duration', value: '5 weeks' }]);
  });

  it('ignores digits inside links and list markers', () => {
    const body = '1. Read [the notice](https://www.canada.ca/2024/notice-99.html).\n2. Wait for intake.';
    assert.deepEqual(checkBriefGrounding(body, ['A notice about intake.']), []);
  });
});

describe('normalize', () => {
  it('folds IRCC typography so the notice text matches plain brief text', () => {
    assert.equal(normalize('well‑managed, 15,000 people for five years'), 'well-managed, 15000 people for 5 years');
  });
});

describe('checkBriefVoice on the live 2026-042 brief', () => {
  it('flags "not confirmed by the rule" as an internal term', () => {
    assert.deepEqual(checkBriefVoice(PGP_042_BODY, '2026-042'), ['internal-term']);
  });

  it('passes ordinary uses of "rules"', () => {
    assert.deepEqual(checkBriefVoice('The rules for sponsoring your parents have changed.', '2026-042'), []);
  });
});
