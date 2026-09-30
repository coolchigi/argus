import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PGP_042_ACTIONS, PGP_042_ASSESSMENT, PGP_042_BODY, PGP_RULE_CONTENT } from './fixtures.pgp-042.ts';
import { checkBriefGrounding, checkDateRoles, checkModality, normalize } from './grounding.ts';
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

// Brief 9aa15dff (2026-09-30, client 2026-031, drafted from a consultant
// review). The PAL/TAL rule's exemption date is January 1, 2026. January 11,
// 2027 is the client's program start date, which the review gave as
// 2027-01-11.
const PAL_BRIEF =
  "IRCC has updated its policy to exempt certain master's programs from the PAL/TAL requirement. This change applies to master's programs at public Designated Learning Institutions (DLIs) starting January 11, 2027.";
const PAL_POLICY = [
  "You don't need a PAL or TAL if you're applying to study at a degree-granting graduate program at the master's or doctoral level at a public DLI starting January 1, 2026. The PAL/TAL is valid until December 31, 2026.",
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents/provincial-attestation-letter.html',
];
const PAL_CLIENT = [
  "the client qualifies for the master's exemption from the PAL/TAL requirement (public DLI, master's program starting 2027-01-11), but must include proof of the exemption with the study permit application.",
];
const POLICY_DATE_FROM_CLIENT = [{ kind: 'policy-date-from-client', value: 'january 11, 2027' }];

describe('checkDateRoles', () => {
  it("flags the live 9aa15dff brief, which gives the client's start date as the policy's", () => {
    assert.deepEqual(checkDateRoles(PAL_BRIEF, PAL_POLICY, PAL_CLIENT), POLICY_DATE_FROM_CLIENT);
  });

  it("passes the client's start date stated as theirs", () => {
    const body = "Your program starts January 11, 2027, so you don't need a PAL/TAL. Include proof of the exemption with your application.";
    assert.deepEqual(checkDateRoles(body, PAL_POLICY, PAL_CLIENT), []);
    assert.deepEqual(checkBriefGrounding(body, [...PAL_POLICY, ...PAL_CLIENT]), []);
  });

  it('flags a cut-off made from the client date, even in a sentence about the reader', () => {
    for (const body of [
      "If you're applying for a master's program starting on or after January 11, 2027, you don't need a PAL/TAL.",
      "Check that your master's program starts on or after January 11, 2027.",
      'Your exemption applies as of January 11, 2027.',
    ]) {
      assert.deepEqual(checkDateRoles(body, PAL_POLICY, PAL_CLIENT), POLICY_DATE_FROM_CLIENT, body);
    }
  });

  it("passes the policy's own dates however the sentence frames them", () => {
    // The client text repeats the rule's date too, so only the rule decides.
    const client = [...PAL_CLIENT, 'The exemption covers programs starting 2026-01-01. The PAL/TAL is valid until December 31, 2026.'];
    const body = 'This applies to programs starting January 1, 2026. Your PAL/TAL is valid until December 31, 2026.';
    assert.deepEqual(checkDateRoles(body, PAL_POLICY, client), []);
  });

  it('leaves a date no source gives to checkBriefGrounding', () => {
    const body = 'This applies to programs starting March 3, 2027.';
    assert.deepEqual(checkDateRoles(body, PAL_POLICY, PAL_CLIENT), []);
    assert.deepEqual(checkBriefGrounding(body, [...PAL_POLICY, ...PAL_CLIENT]), [{ kind: 'date', value: 'march 3, 2027' }]);
  });

  it('reads each line on its own, so a suggested action gets its own sentence', () => {
    const body = 'Your program starts January 11, 2027\nConfirm the exemption applies from January 11, 2027 onward';
    assert.deepEqual(checkDateRoles(body, PAL_POLICY, PAL_CLIENT), POLICY_DATE_FROM_CLIENT);
  });
});

// Brief 6fc569f6 (2026-09-30, client 2026-032, PAL/TAL rule bbf49430) and
// the rule's own wording, copied from the live rule_content. IRCC's
// typographic apostrophes are kept on purpose.
const PAL_032_SENTENCE =
  'If your PAL/TAL has expired or is no longer valid, you must get a new one before you can reapply for a study permit.';
const PAL_HEDGED = 'In some cases, you may need to get a new, valid PAL/TAL before you can reapply for a study permit.';
const PAL_RULE_EXCERPT = [
  '### How long your PAL/TAL is valid for',
  'Your PAL/TAL is linked to the school you’re applying to. In most cases, it must be used during the year it was issued.',
  'What should I do if my PAL/TAL is expired?',
  'You can’t apply for a study permit with a PAL/TAL that has expired or is no longer valid. You must get a new PAL/TAL before you reapply.',
  '### When to get a new PAL/TAL',
  `${PAL_HEDGED} The scenarios below will help you find out what to do based on your situation.`,
  'My PAL/TAL has expired or is no longer valid.',
  'You must get a new PAL/TAL before submitting your study permit application.',
  'I’m changing my level of study.',
  'In most cases, you must get a new PAL/TAL when changing your level of study.',
].join('\n\n');

describe('checkModality', () => {
  it('flags the live 2026-032 sentence against the rule sentence that says "in some cases, you may need"', () => {
    assert.deepEqual(checkModality(PAL_032_SENTENCE, [PAL_HEDGED]), [{ kind: 'modality-strengthened', value: 'must / in some cases' }]);
  });

  it('passes the same sentence against the full rule, which says must for an expired PAL/TAL', () => {
    // "You must get a new PAL/TAL before you reapply", under "You can't
    // apply ... with a PAL/TAL that has expired". The brief kept both the
    // must and its condition.
    assert.deepEqual(checkModality(PAL_032_SENTENCE, [PAL_RULE_EXCERPT]), []);
  });

  it('flags a must that drops the rule\'s "in most cases"', () => {
    for (const body of [
      'You must get a new PAL/TAL when changing your level of study.',
      'Your PAL/TAL must be used during the year it was issued.',
    ]) {
      assert.deepEqual(checkModality(body, [PAL_RULE_EXCERPT]), [{ kind: 'modality-strengthened', value: 'must / in most cases' }], body);
    }
  });

  it('flags the other strong forms', () => {
    assert.deepEqual(checkModality('You will need a new, valid PAL/TAL before you can reapply for a study permit.', [PAL_HEDGED]), [
      { kind: 'modality-strengthened', value: 'will need / in some cases' },
    ]);
    assert.deepEqual(checkModality('You have to get a new, valid PAL/TAL to reapply for a study permit.', [PAL_HEDGED]), [
      { kind: 'modality-strengthened', value: 'have to / in some cases' },
    ]);
  });

  it('passes a must the rule also says must', () => {
    assert.deepEqual(checkModality('You must get a new PAL/TAL before submitting your study permit application.', [PAL_RULE_EXCERPT]), []);
    assert.deepEqual(checkModality('You must get a new PAL/TAL before you reapply for a study permit.', [PAL_RULE_EXCERPT]), []);
  });

  it('passes a brief that keeps the hedge', () => {
    for (const body of [
      PAL_HEDGED,
      'You may need a new, valid PAL/TAL before you can reapply for a study permit.',
      'In most cases, you must get a new PAL/TAL when changing your level of study.',
      'You might have to get a new, valid PAL/TAL before you can reapply for a study permit.',
    ]) {
      assert.deepEqual(checkModality(body, [PAL_RULE_EXCERPT]), [], body);
    }
  });

  it('passes a must about something no hedged rule sentence covers', () => {
    assert.deepEqual(checkModality('You must include proof of the exemption with your study permit application.', [PAL_RULE_EXCERPT]), []);
  });

  it('reads "can" beside a must as part of the must', () => {
    const rule = 'You must get a new PAL/TAL before you can reapply for a study permit.';
    assert.deepEqual(checkModality(rule, [rule]), []);
  });

  it('reads "May" before a day as the month', () => {
    const rule = 'Your PAL/TAL must be used for a study permit application by May 1, 2026.';
    assert.deepEqual(checkModality('You must use your PAL/TAL for your study permit application in 2026.', [rule]), []);
  });

  it("reads a list item with the line that leads into the list", () => {
    const rule = 'The PAL/TAL is\n\n- a letter from the province or territory where you plan to study\n- usually required to apply for a study permit';
    assert.deepEqual(checkModality('A PAL/TAL is required to apply for a study permit.', [rule]), [
      { kind: 'modality-strengthened', value: 'required to / usually' },
    ]);
  });

  it("doesn't pin a hedge on content that came from the sentence before it", () => {
    const rule = 'You should contact your school (DLI) to find out how to apply for a PAL/TAL. Once you have one, you can apply for a study permit.';
    assert.deepEqual(checkModality('You must contact your school (DLI) to find out how to apply for a PAL/TAL.', [rule]), []);
  });
});

describe('date grounding', () => {
  it('grounds a written-out date against the same date in ISO form, and the other way round', () => {
    assert.deepEqual(checkBriefGrounding('Your program starts January 11, 2027.', ['starting 2027-01-11']), []);
    assert.deepEqual(checkBriefGrounding('Your program starts 2027-01-11.', ['starting January 11, 2027']), []);
  });

  it('matches the day as a whole number', () => {
    // "january 1" is a prefix of "january 11" in the source.
    assert.deepEqual(checkBriefGrounding('It starts January 1, 2026.', ['starting January 11, 2026']), [{ kind: 'date', value: 'january 1, 2026' }]);
    assert.deepEqual(checkBriefGrounding('It starts January 11, 2026.', ['starting January 1, 2026']), [{ kind: 'date', value: 'january 11, 2026' }]);
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
