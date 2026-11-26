import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groundingTextFor, isPartialView, isRemovalOnly, ruleTextFor } from './rule-input.ts';
import { RULE_WINDOW_CHARS, ruleWindow } from './rule-window.ts';

function changeText(added: string, removed = '(none)'): string {
  return ['CHANGES TO THIS IRCC PAGE', 'Page: https://www.canada.ca/x', 'Detected: 2026-11-03', '', 'LINES ADDED TO THE PAGE', added, '', 'LINES REMOVED FROM THE PAGE', removed].join('\n');
}

const NOC_PAGE = ['# Eligible occupations', '## Occupations', 'NOC | Title', '41220 | Teachers', '99999 | Newly added occupation'].join('\n');
const ONE_ROW_ADDED = changeText('Section: Eligible occupations > Occupations\n(unchanged table header) NOC | Title\n99999 | Newly added occupation');
const client = { rcicId: 'R1', clientId: 'C-1', nocCode: '41220' };
const filler = (word: string, n: number) => Array.from({ length: n }, (_, i) => `${word} line ${i} with padding text to fill out the page`).join('\n');

describe('ruleTextFor', () => {
  it('gives the whole page when the row has no changed lines', () => {
    assert.equal(ruleTextFor({ rule_content: NOC_PAGE }, client), NOC_PAGE);
  });

  it('gives the whole page when the stored changes are not in the form Sentinel writes', () => {
    assert.equal(ruleTextFor({ rule_content: NOC_PAGE, rule_changes: { text: 'something else' } }, client), NOC_PAGE);
  });

  it('shows the client code on the unchanged part of a list, labelled, with its table header', () => {
    const text = ruleTextFor({ rule_content: NOC_PAGE, rule_changes: { text: ONE_ROW_ADDED } }, client);
    assert.match(text, /OTHER PAGE TEXT THAT MENTIONS THIS CLIENT\nThe wording of these lines did not change[^\n]*\nSection: Eligible occupations > Occupations\n\(unchanged table header\) NOC \| Title\n41220 \| Teachers/);
    assert.doesNotMatch(text, /None of it contains/);
  });

  it('adds nothing when the client code is already in the changed lines', () => {
    const text = ruleTextFor({ rule_content: NOC_PAGE, rule_changes: { text: ONE_ROW_ADDED } }, { ...client, nocCode: '99999' });
    assert.doesNotMatch(text, /OTHER PAGE TEXT/);
  });

  it('still shows a line that stands elsewhere when the same wording was removed from one place', () => {
    const row = '41220 | Teachers';
    const text = ruleTextFor({ rule_content: NOC_PAGE, rule_changes: { text: changeText('(none)', `Section: Old table\n${row}`) } }, client);
    assert.match(text, /OTHER PAGE TEXT THAT MENTIONS THIS CLIENT[\s\S]*41220 \| Teachers/);
  });

  it('gives a list item its lead-in, and drops that lead-in at the next heading', () => {
    const page = ['## A', 'Who qualifies:', '- code 41220 holders', '## B', '- code 41220 again'].join('\n');
    const text = ruleTextFor({ rule_content: page, rule_changes: { text: ONE_ROW_ADDED } }, client);
    assert.match(text, /Section: A\n\(unchanged lead-in\) Who qualifies:\n- code 41220 holders/);
    assert.match(text, /Section: B\n- code 41220 again/);
  });

  it('caps the block, so many mentions cannot crowd out the change', () => {
    const page = Array.from({ length: 500 }, (_, i) => `41220 | row ${i} with text to make the line a good length`).join('\n');
    const text = ruleTextFor({ rule_content: page, rule_changes: { text: ONE_ROW_ADDED } }, client);
    assert.ok(text.length < ONE_ROW_ADDED.length + 3_100, `block stayed small: ${text.length}`);
  });

  it('says a code is absent only after searching the whole page', () => {
    const text = ruleTextFor({ rule_content: `${NOC_PAGE}\n10001 | Another occupation`, rule_changes: { text: ONE_ROW_ADDED } }, { ...client, nocCode: '12345' });
    assert.match(text, /\[The whole page was searched\. None of it contains: 12345\.\]/);
  });

  it('says nothing about a code on a page that lists no codes of that kind', () => {
    const page = '## Job offers\nYou do not need an LMIA. Enter 00000 as the LMIA number.';
    const text = ruleTextFor({ rule_content: page, rule_changes: { text: ONE_ROW_ADDED } }, client);
    assert.doesNotMatch(text, /None of it contains|OTHER PAGE TEXT/);
  });

  it('leaves the block out when there is no profile, as for Composer', () => {
    assert.equal(ruleTextFor({ rule_content: NOC_PAGE, rule_changes: { text: ONE_ROW_ADDED } }), ONE_ROW_ADDED);
  });
});

describe('ruleTextFor on a change too long for the window', () => {
  const longAdded = `Section: Page\n${filler('new', 800)}`;

  it('fits the window, so the page-excerpt logic never rewrites it', () => {
    const text = ruleTextFor({ rule_content: NOC_PAGE, rule_changes: { text: changeText(longAdded, `Section: Page\n${filler('old', 800)}`) } }, client);
    assert.ok(text.length <= RULE_WINDOW_CHARS);
    assert.equal(ruleWindow(text, client), text);
  });

  it('never says a code is off the page when it is on an unchanged line', () => {
    const text = ruleTextFor({ rule_content: NOC_PAGE, rule_changes: { text: changeText(longAdded, `Section: Page\n${filler('old', 800)}`) } }, client);
    assert.doesNotMatch(text, /None of it contains/);
    assert.match(text, /41220 \| Teachers/);
  });

  it('keeps later added lines that carry the client code, up to their share of the room', () => {
    const coded = Array.from({ length: 40 }, (_, i) => `41220 later line ${i} ${'x'.repeat(400)}`).join('\n');
    const text = ruleTextFor({ rule_content: NOC_PAGE, rule_changes: { text: changeText(`${longAdded}\n${coded}`) } }, client);
    assert.match(text, /41220 later line 0 /);
    assert.ok(text.length <= RULE_WINDOW_CHARS);
  });

  it('keeps a removed row with the client code under the removed header', () => {
    const removed = `Section: Page\n${filler('old', 800)}\n41220 | Teachers | eligible`;
    const text = ruleTextFor({ rule_content: filler('new', 800), rule_changes: { text: changeText(longAdded, removed) } }, client);
    const header = text.indexOf('LINES REMOVED FROM THE PAGE');
    assert.ok(header !== -1, 'the removed header survives the cut');
    assert.ok(text.indexOf('41220 | Teachers | eligible') > header, 'the removed row stays under it');
    assert.doesNotMatch(groundingTextFor(text), /41220 \| Teachers \| eligible/);
  });

  it('marks the view as partial, and only then', () => {
    const long = ruleTextFor({ rule_content: NOC_PAGE, rule_changes: { text: changeText(longAdded) } });
    assert.equal(isPartialView(long), true);
    assert.equal(isPartialView(ONE_ROW_ADDED), false);
    assert.equal(isPartialView('[Part of this change is not shown'), false, 'whole-page text is never a partial change');
  });

  it('shows removed lines even when the added lines alone would fill the window', () => {
    const text = ruleTextFor({ rule_content: NOC_PAGE, rule_changes: { text: changeText(longAdded, 'Section: Page\nThe fee waiver is gone.') } });
    assert.match(text, /LINES REMOVED FROM THE PAGE\nSection: Page\nThe fee waiver is gone\./);
  });
});

describe('groundingTextFor', () => {
  const withRemoved = changeText('Section: A\nNew rule.', 'Section: A\nOld rule.');

  it('keeps removed lines out, so old wording cannot support a claim', () => {
    assert.match(groundingTextFor(withRemoved), /New rule\./);
    assert.doesNotMatch(groundingTextFor(withRemoved), /Old rule\./);
  });

  it('keeps the unchanged block, which is what supports a claim about the client code', () => {
    const text = ruleTextFor({ rule_content: `${NOC_PAGE}\nOld rule.`, rule_changes: { text: changeText('Section: A\nNew rule.', 'Section: A\nOld rule.') } }, client);
    assert.match(groundingTextFor(text), /41220 \| Teachers/);
    assert.doesNotMatch(groundingTextFor(text), /LINES REMOVED/);
  });

  it('keeps removed lines when the removal is the whole change', () => {
    const removalOnly = changeText('(none)', 'Section: Exempt\n- academics under a federal program');
    assert.equal(groundingTextFor(removalOnly), removalOnly);
  });

  it('leaves a whole page alone', () => {
    assert.equal(groundingTextFor(NOC_PAGE), NOC_PAGE);
  });
});

describe('sections IRCC limits to some clients', () => {
  // Real heading and steps from the job offer page, Oct 16 2026. A client with an LMIA
  // was told to enter the fake one in 6 of 10 signed records (measured 2026-11-25).
  const changes = changeText(
    ['Section: Job offer', 'General line.', '', 'Section: Job offer > How to update your profile if you have a job offer without an LMIA', '(unchanged lead-in) Enter this:', 'LMIA Number | 00000', '', 'Section: Job offer > Other', 'Last line.'].join('\n'),
    'Section: Job offer > If you have a job offer without an LMIA\nOld step.',
  );
  const textFor = (p?: Record<string, unknown>) => ruleTextFor({ rule_content: 'x', rule_changes: { text: changes } }, p);

  it('leaves the section out when the profile rules it out, says so, and keeps the rest', () => {
    const text = textFor({ jobOfferHasLmia: true });
    assert.doesNotMatch(text, /00000|Enter this/);
    assert.match(text, /\(left out: this section applies only if the job offer has no LMIA/);
    assert.match(text, /General line\.[\s\S]*Last line\./);
  });

  it('marks each line of it when the answer is missing, and no other line', () => {
    for (const p of [undefined, {}]) {
      const text = textFor(p);
      assert.match(text, /^\(only if the job offer has no LMIA\) LMIA Number \| 00000$/m);
      assert.match(text, /^General line\.$/m);
      assert.match(text, /^Last line\.$/m);
    }
  });

  it('changes nothing for the client the section is for', () => {
    assert.equal(textFor({ jobOfferHasLmia: false }), changes);
  });

  it('works the other way round for a section about offers that have one', () => {
    const withOne = changeText('Section: If you have an offer with an LMIA\nEnter its number.');
    const t = (v: unknown) => ruleTextFor({ rule_content: 'x', rule_changes: { text: withOne } }, { jobOfferHasLmia: v });
    assert.doesNotMatch(t(false), /Enter its number/);
    assert.match(t(true), /^Enter its number\.$/m);
  });

  it('leaves a heading alone when it covers both cases or only names an LMIA', () => {
    for (const h of ['Job offers with or without an LMIA', 'Who needs an LMIA', 'LMIA basics']) {
      const c = changeText(`Section: ${h}\nA line.`);
      assert.equal(ruleTextFor({ rule_content: 'x', rule_changes: { text: c } }, { jobOfferHasLmia: true }), c, h);
    }
  });

  it('leaves removed lines alone', () => {
    assert.match(textFor({ jobOfferHasLmia: true }), /LINES REMOVED FROM THE PAGE[\s\S]*Old step\./);
  });

  it('is never mistaken for a removal-only change when it drops the only section', () => {
    const only = changeText('Section: If you have a job offer without an LMIA\nStep.', 'Section: A\nGone.');
    const text = ruleTextFor({ rule_content: 'x', rule_changes: { text: only } }, { jobOfferHasLmia: true });
    assert.equal(isRemovalOnly(text), false);
  });
});

