import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CA_SIN_PATTERN,
  INTL_PHONE_PATTERN,
  NA_PHONE_PATTERN,
  TRUNK_PHONE_PATTERN,
  US_SSN_PATTERN,
} from './guardrail-patterns';
import { phoneMustBlock, phoneMustPass } from './guardrail-phone-matrix';

// Runs the guardrail patterns with JS RegExp. The patterns stick to syntax
// that reads the same in any common regex engine (character classes, {n},
// \b, non-capturing alternation), which is what the deployed postal-code and
// street-address regexes already use.
const patterns = { 'ca-sin': new RegExp(CA_SIN_PATTERN), 'us-ssn': new RegExp(US_SSN_PATTERN) };
const fired = (text: string) => Object.entries(patterns).filter(([, re]) => re.test(text)).map(([name]) => name);

// Every one of these was blocked by the CA_SOCIAL_INSURANCE_NUMBER or
// US_SOCIAL_SECURITY_NUMBER entity on the live guardrail, or sits next to
// one that was. None of them is a government ID.
const mustPass = [
  'Client 2026-042 is sponsoring parents under PGP and has met LICO for 2 of the 3 required years.',
  'SIN required for client 2026-042.',
  'SIN required for client 2026-061.',
  'No SSN for client 2026-042.',
  'A US social security number is not needed for 2026-061.',
  "The sponsor's social insurance number is required. Client 93888 has not provided it.",
  'SIN required for client 41220.',
  'SIN required for client 64100.',
  'Applicants in NOC 93888 must include their social insurance number on the form.',
  'Eligible occupations: NOC 41220, 41200, 64100, 21231 and 93888.',
  'Client 2026-061 (NOC 93888) and client 2026-042 (NOC 41220) both need review.',
  'SIN required for client 489.',
  'The cutoff rose to 491, so a CRS of 489 no longer clears it.',
  'Issue (citation): the rule text asks for the sponsor SIN. The hypothesis for 52.0201 does not mention it.',
  'CIP code 52.0201 is no longer on the PGWP eligible list.',
  'File F-2026-042 is affected by the new PGP intake rule.',
  "The sponsor's social insurance number is required. Client 26/042 has not provided it.",
  'Client C-101 is not affected by this change.',
  'SIN required for client 12345.',
  'Client 2026-0042 moves from eligible to ineligible.',
  'Graduation date 2026-04-30 falls before the 2026-06-25 cutoff.',
  '{"clientId":"2026-014","nocCode":"64100","teerLevel":4,"currentCrsScore":402,"delta":-12}',
  '2026-042 2026-061 2026-011',
  'Call 613-555-0199 for the IRCC help line.',
  'fb:pages 378967748836213, 10860597051, 209857686718',
];

const mustBlock: [string, string][] = [
  ['My SIN is 046 454 286.', 'ca-sin'],
  ['Client SIN: 046-454-286.', 'ca-sin'],
  ['SIN 046454286 on file.', 'ca-sin'],
  ['Please update the record with 046 454 286 before Friday.', 'ca-sin'],
  ['Social insurance number 130 692 544.', 'ca-sin'],
  ['Reference 130692544 for the applicant.', 'ca-sin'],
  // Fails Luhn. A mistyped SIN is still a SIN.
  ['SIN 123 456 789 was entered on the form.', 'ca-sin'],
  ['US SSN 123-45-6789 is on the sponsor form.', 'us-ssn'],
  ['Her social security number is 219-09-9999.', 'us-ssn'],
  ['Enter 219-09-9999 in box 4.', 'us-ssn'],
  ['SSN 219 09 9999 on file.', 'us-ssn'],
  // A bare 9-digit SSN has the SIN shape, so ca-sin blocks it.
  ['SSN 219099999 on file.', 'ca-sin'],
];

describe('guardrail ID patterns', () => {
  for (const text of mustPass) {
    it(`lets through: ${text}`, () => {
      assert.deepEqual(fired(text), []);
    });
  }
  for (const [text, name] of mustBlock) {
    it(`blocks with ${name}: ${text}`, () => {
      assert.ok(fired(text).includes(name), `expected ${name}, got ${JSON.stringify(fired(text))}`);
    });
  }
  it('does not match a SIN glued to other digits', () => {
    assert.deepEqual(fired('Account 1046454286 is closed.'), []);
    assert.deepEqual(fired('Phone 613 555 0199.'), []);
  });
});

describe('guardrail phone patterns', () => {
  const phone = {
    'na-phone': new RegExp(NA_PHONE_PATTERN),
    'intl-phone': new RegExp(INTL_PHONE_PATTERN),
    'trunk-phone': new RegExp(TRUNK_PHONE_PATTERN),
  };
  const phoneFired = (text: string) =>
    Object.entries(phone).filter(([, re]) => re.test(text)).map(([name]) => name);

  const expected: [string, string][] = [
    ['613-555-0142', 'na-phone'],
    ['(416) 555-0199', 'na-phone'],
    ['(604)555-0123', 'na-phone'],
    ['+1 604 555 0123', 'na-phone'],
    ['+1-613-555-0142', 'na-phone'],
    ['1-613-555-0142', 'na-phone'],
    ['613.555.0142', 'na-phone'],
    ['6135550142', 'na-phone'],
    ['+16135550142', 'na-phone'],
    ['+1 (613) 555-0142', 'na-phone'],
    ['+44 20 7946 0958', 'intl-phone'],
    ['+44 (0)20 7946 0958', 'intl-phone'],
    ['0044 20 7946 0958', 'intl-phone'],
    ['+33 1 42 68 53 00', 'intl-phone'],
    ['+91 98765 43210', 'intl-phone'],
    ['+7 912 345 67 89', 'intl-phone'],
    ['020 7946 0958', 'trunk-phone'],
    ['01 42 68 53 00', 'trunk-phone'],
  ];
  for (const [num, name] of expected) {
    it(`${name} matches ${num} inside a sentence`, () => {
      assert.ok(phoneFired(`Reach the client on ${num} today.`).includes(name));
    });
  }

  for (const text of phoneMustBlock) {
    it(`blocks: ${text}`, () => {
      assert.notDeepEqual(phoneFired(text), []);
    });
  }
  for (const text of phoneMustPass) {
    it(`lets through: ${text}`, () => {
      assert.deepEqual(phoneFired(text), []);
    });
  }

  it('leaves out every toll-free area code, with or without +1', () => {
    for (const code of ['800', '833', '844', '855', '866', '877', '888']) {
      assert.deepEqual(phoneFired(`IRCC: 1-${code}-242-2100.`), [], code);
      assert.deepEqual(phoneFired(`IRCC: +1 ${code} 242 2100.`), [], code);
      assert.deepEqual(phoneFired(`IRCC: (${code}) 242-2100.`), [], code);
    }
  });
  it('still matches the 8XX area codes that are not toll-free', () => {
    for (const code of ['801', '819', '825', '873', '879']) {
      assert.deepEqual(phoneFired(`Client line ${code}-555-0142.`), ['na-phone'], code);
    }
  });
  it('does not match inside longer digit runs', () => {
    assert.deepEqual(phoneFired('fb:pages 378967748836213, 10860597051, 209857686718'), []);
    assert.deepEqual(phoneFired('Account 1046454286 is closed.'), []);
    assert.deepEqual(phoneFired('Case E0016135550142.'), []);
  });
});
