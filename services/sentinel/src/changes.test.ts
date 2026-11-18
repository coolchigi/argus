import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasChanges, MAX_CHANGES_BYTES, PARTIAL_MARK, ruleChanges } from './changes.ts';

function changes(previousText: string, text: string) {
  return ruleChanges({ previousText, text, previousHash: 'h0', sourceUrl: 'https://www.canada.ca/x', detectedAt: '2026-10-16T15:40:23.000Z' });
}

const addedSide = (text: string) => text.slice(text.indexOf('LINES ADDED TO THE PAGE'), text.indexOf('LINES REMOVED FROM THE PAGE'));
const removedSide = (text: string) => text.slice(text.indexOf('LINES REMOVED FROM THE PAGE'));

describe('ruleChanges: what counts as a change', () => {
  it('lists added lines under their section and leaves unchanged text out', () => {
    const before = '# Job offer\n\n## Who needs an LMIA\n\n- academics under a recognized federal program';
    const after = "# Job offer\n\n## Job offer basics\n\nYou don't need an LMIA.\n\n## Who needs an LMIA\n\n- academics under a recognized federal program";
    const c = changes(before, after);
    assert.match(c.text, /Section: Job offer > Job offer basics\nYou don't need an LMIA\./);
    assert.doesNotMatch(c.text, /recognized federal program/);
    assert.equal(c.added_lines, 2);
    assert.equal(c.removed_lines, 0);
  });

  it('lists removed lines with the section they came from', () => {
    const c = changes('## Scoring\n\nWe no longer give points for job offers\n\nKept line', '## Scoring\n\nKept line');
    assert.match(removedSide(c.text), /Section: Scoring\nWe no longer give points for job offers/);
    assert.equal(c.removed_lines, 1);
    assert.equal(hasChanges(c), true);
  });

  it('does not count a change of quote style, dash or spacing', () => {
    const c = changes('This won’t  change – really', "This won't change - really");
    assert.equal(hasChanges(c), false);
    assert.match(c.text, /LINES ADDED TO THE PAGE\n\(none\)\n\nLINES REMOVED FROM THE PAGE\n\(none\)/);
  });

  it('counts list items that swapped order, since numbered steps can depend on it', () => {
    const c = changes('## A\nLead:\n- one\n- two', '## A\nLead:\n- two\n- one');
    assert.equal(hasChanges(c), true);
    assert.equal(c.reordered_lines, 1);
  });

  it('counts a repeat of a line in the same place, and only the repeat', () => {
    const c = changes('## A\n- send a form', '## A\n- send a form\n- send a form');
    assert.equal(c.added_lines, 1);
    assert.equal(c.moved_lines, 0);
  });

  it('keeps a new heading with nothing under it', () => {
    const c = changes('# Page\n\nBody', '# Page\n\nBody\n\n## New section');
    assert.match(c.text, /Section: Page > New section/);
    assert.equal(hasChanges(c), true);
  });

  it('names the page, the date and the version it compared against', () => {
    const c = changes('a', 'b');
    assert.equal(c.previous_hash, 'h0');
    assert.match(c.text, /^CHANGES TO THIS IRCC PAGE\nPage: https:\/\/www\.canada\.ca\/x\nDetected: 2026-10-16\n/);
  });
});

describe('ruleChanges: a line is its wording plus where it sits', () => {
  it('shows a bullet that moved from one section to another, which reverses its meaning', () => {
    const c = changes(
      '## You need an LMIA if\n- you are an academic\n- you are a nurse\n\n## You do not need an LMIA if\n- you are a student',
      '## You need an LMIA if\n- you are a nurse\n\n## You do not need an LMIA if\n- you are a student\n- you are an academic',
    );
    assert.equal(c.moved_lines, 1);
    assert.match(addedSide(c.text), /Section: You do not need an LMIA if\n\(moved here from "You need an LMIA if", same wording\)\n- you are an academic/);
    assert.doesNotMatch(removedSide(c.text), /academic/, 'a moved line still applies, so it is not listed as removed');
    assert.equal(hasChanges(c), true);
  });

  it('shows a bullet that moved between lead-ins under one heading', () => {
    const c = changes('## LMIA\nYou need one if:\n- academic\n- nurse\nYou do not need one if:\n- student', '## LMIA\nYou need one if:\n- nurse\nYou do not need one if:\n- student\n- academic');
    assert.match(addedSide(c.text), /\(moved here from "You need one if:", same wording\)\n- academic/);
  });

  it('shows a new section that repeats a line found elsewhere on the page', () => {
    const c = changes('## Federal workers\n- Enter 00000 as the LMIA number', '## Federal workers\n- Enter 00000 as the LMIA number\n\n## Trades workers\n- Enter 00000 as the LMIA number');
    assert.match(addedSide(c.text), /Section: Trades workers\n- Enter 00000 as the LMIA number/);
    assert.doesNotMatch(addedSide(c.text), /Federal workers/);
  });

  // Real wording from the job offer page on Nov 3 2026 (rule row after d3fd0668).
  // Comparing wording alone sent the agents the sentence ending in "including", with
  // no programs after it.
  it('keeps the list under a reworded lead-in, as on the Nov 3 job offer page', () => {
    const before = "## Job offer basics\n### Changes to how we assess jobs offers\nIf having a valid job offer is part of your eligibility criteria, this won't change. This includes:\n- the Federal Skilled Trades Program\n- the Federal Skilled Worker Program\n- some streams under provincial nominee programs";
    const after = '## Job offer changes\nWhat hasn’t changed\nPrograms that required a valid job offer as part of their eligibility criteria still require one, including\n- the Federal Skilled Trades Program\n- the Federal Skilled Worker Program\n- some streams under provincial nominee programs';
    const added = addedSide(changes(before, after).text);
    assert.match(added, /still require one, including\n\(moved here from "Job offer basics > Changes to how we assess jobs offers", same wording\)\n- the Federal Skilled Trades Program\n- the Federal Skilled Worker Program\n- some streams under provincial nominee programs/);
  });

  // Real structure from the job offer page on Oct 16 2026. IRCC added a subheading
  // above older text about job offer points. That text never moved, and showing it as
  // moved would bring back the failure in brief 88d1df46.
  it('leaves out older text that only ended up under a new subheading', () => {
    const older = 'Under the policy, your job offer allows you to earn points toward your total score.';
    const before = `# Job offer\n## Job offer basics\nWe no longer give points for job offers\n${older}`;
    const after = `# Job offer\n## Job offer basics\n### How to update your profile\nIn your profile you will still be required to select that you have a positive LMIA.\n${older}`;
    const c = changes(before, after);
    assert.doesNotMatch(c.text, /earn points/);
    assert.equal(c.moved_lines, 0);
    assert.match(addedSide(c.text), /still be required to select/);
  });

  it('shows a line that moved into a subheading already on the page', () => {
    const c = changes('# T\n## Spouses\nSpouses can apply.\n### Not eligible\nOthers cannot.', '# T\n## Spouses\n### Not eligible\nSpouses can apply.\nOthers cannot.');
    assert.equal(c.moved_lines, 1);
    assert.match(addedSide(c.text), /Section: T > Spouses > Not eligible\n\(moved here from "Spouses", same wording\)\nSpouses can apply\./);
  });

  it('shows a line that moved out of a subheading that stays on the page', () => {
    const c = changes('# T\n## Spouses\n### Not eligible\nSpouses can apply.\nOthers cannot.', '# T\n## Spouses\nSpouses can apply.\n### Not eligible\nOthers cannot.');
    assert.equal(c.moved_lines, 1);
  });

  it('shows a table row that moved between tables with the same header under different lead-ins', () => {
    const c = changes('## LMIA\nYou need one:\nNOC | Title\n41220 | Teachers\nYou do not need one:\nNOC | Title\n99999 | Nurses', '## LMIA\nYou need one:\nNOC | Title\nYou do not need one:\nNOC | Title\n99999 | Nurses\n41220 | Teachers');
    assert.ok(c.moved_lines >= 1);
    assert.match(addedSide(c.text), /You do not need one:[\s\S]*\(moved here from "You need one:", same wording\)\n41220 \| Teachers/);
  });

  it('shows a bullet that moved between two headings with the same name under one parent', () => {
    const c = changes('# T\n## Rules\n### Workers\n- a\n- b\n### Workers\n- c', '# T\n## Rules\n### Workers\n- a\n### Workers\n- c\n- b');
    assert.equal(c.moved_lines, 1);
  });

  it('names the old parent when a subsection moved between sections', () => {
    const c = changes('# T\n## You need an LMIA\n### Workers\n- nurses\n## No LMIA\nText', '# T\n## You need an LMIA\nOther\n## No LMIA\nText\n### Workers\n- nurses');
    assert.match(addedSide(c.text), /\(moved here from "You need an LMIA > Workers", same wording\)/);
  });

  it('does not pair a line with a heading of the same wording', () => {
    const c = changes('## Fees\nBody', '## Other\nFees\nBody');
    assert.match(addedSide(c.text), /Section: Other\nFees\n/, 'the new line shows as added, with no moved marker before it');
  });

  it('does not count a heading that only moved as a moved line', () => {
    const c = changes('# T\n## A\n### Empty\n## B\nx', '# T\n## A\n## B\n### Empty\nx');
    assert.equal(c.moved_lines, 1, 'x moved under the subheading, the heading itself does not count');
  });

  it('shows the body under a reworded heading, whose meaning can flip', () => {
    const c = changes('## You need an LMIA if\n- you are an academic', '## You do not need an LMIA if\n- you are an academic');
    assert.match(addedSide(c.text), /Section: You do not need an LMIA if\n\(moved here from "You need an LMIA if", same wording\)\n- you are an academic/);
    assert.match(removedSide(c.text), /Section: You need an LMIA if/);
  });

  it('shows a few lines under a new heading when nothing new sits under it', () => {
    const body = Array.from({ length: 8 }, (_, i) => `- rule ${i}`).join('\n');
    const c = changes(`## Who\nThese apply:\n${body}`, `## Who\n### Exceptions\nThese apply:\n${body}`);
    const added = addedSide(c.text);
    assert.match(added, /Section: Who > Exceptions\n\(unchanged, now under this new heading\)\nThese apply:\n- rule 0/);
    assert.doesNotMatch(added, /- rule 7/);
    assert.match(added, /\(4 more unchanged lines not shown\)/);
  });

  it('caps a long table whose header was reworded, and marks the change as partial', () => {
    const rows = Array.from({ length: 100 }, (_, i) => `${10000 + i} | occupation ${i}`).join('\n');
    const c = changes(`## Eligible\nNOC | Title\n${rows}`, `## Eligible\nNOC code | Title\n${rows}`);
    assert.equal(c.moved_lines, 100);
    assert.equal(c.truncated, true);
    assert.ok(addedSide(c.text).includes(`${PARTIAL_MARK}: 60 more lines changed in the same way.]`));
    assert.doesNotMatch(addedSide(c.text), /10099 \| occupation/);
  });

  it('reports paragraphs that swapped places, with the line above them now', () => {
    const c = changes('## A\nInside Canada:\nApply online.\nOutside Canada:\nApply on paper.', '## A\nInside Canada:\nApply on paper.\nOutside Canada:\nApply online.');
    assert.ok(c.reordered_lines > 0);
    assert.equal(hasChanges(c), true);
    assert.match(addedSide(c.text), /\(same wording, order changed\)/);
    assert.match(addedSide(c.text), /\(now follows\) /);
  });

  it('marks only the paragraph that moved, so older text around it stays out', () => {
    const body = Array.from({ length: 30 }, (_, i) => `Older paragraph ${i}.`);
    const c = changes(['## A', ...body].join('\n'), ['## A', ...body.slice(1), body[0]].join('\n'));
    assert.equal(c.reordered_lines, 1);
    assert.doesNotMatch(addedSide(c.text), /Older paragraph 7\./);
  });

  it('compares order only inside one section', () => {
    const c = changes('## A\nOne.\n## B\nTwo.', '## B\nTwo.\n## A\nOne.');
    assert.equal(c.reordered_lines, 0);
    assert.equal(hasChanges(c), false);
  });

  it('does not treat a reworded page title as moving the whole page', () => {
    const c = changes('# Old title\n## A\nKept line', '# New title\n## A\nKept line');
    assert.equal(c.moved_lines, 0);
    assert.doesNotMatch(c.text, /Kept line/);
  });
});

describe('ruleChanges: context so a line makes sense alone', () => {
  it('adds the unchanged lead-in to a new list item', () => {
    const c = changes('Your job offer must:\n- be recent', 'Your job offer must:\n- be recent\n- be in writing');
    assert.match(c.text, /\(unchanged lead-in\) Your job offer must:\n- be in writing/);
    assert.doesNotMatch(c.text, /be recent/);
  });

  it('does not mark a lead-in as unchanged when it is new', () => {
    const c = changes('Old line', 'As of November 3, we are changing:\n- the first thing\n- the second thing');
    assert.doesNotMatch(c.text, /unchanged lead-in/);
  });

  it('prints the lead-in again when a bullet hangs from a different one', () => {
    const c = changes('## A\nIf you apply:\n- c1\nExempt if:\n- e1', '## A\nIf you apply:\n- c1\n- c2\nExempt if:\n- e1\n- e2\nIf you apply:\n- c3');
    const added = addedSide(c.text);
    assert.match(added, /\(unchanged lead-in\) If you apply:\n- c2\n\(unchanged lead-in\) Exempt if:\n- e2/);
  });

  it('prints the table header once for rows in a row', () => {
    const c = changes('## R\nA | B\n1 | 2', '## R\nA | B\n1 | 2\n3 | 4\n5 | 6');
    assert.equal(c.text.split('(unchanged table header)').length - 1, 1);
  });

  it('stops using a table header after a paragraph ends the table', () => {
    const c = changes('## R\nA | B\n1 | 2\nText.\nC | D\n3 | 4', '## R\nA | B\n1 | 2\nText.\nC | D\n3 | 4\n5 | 6');
    assert.match(c.text, /\(unchanged table header\) C \| D\n5 \| 6/);
    assert.doesNotMatch(c.text, /A \| B/);
  });

  it('adds the table header to a new row, and leaves out the other rows', () => {
    const c = changes('## Rounds\nDate | Score | Invitations\n2026-10-01 | 480 | 2000', '## Rounds\nDate | Score | Invitations\n2026-10-01 | 480 | 2000\n2026-11-03 | 470 | 2500');
    assert.match(c.text, /\(unchanged table header\) Date \| Score \| Invitations\n2026-11-03 \| 470 \| 2500/);
    assert.doesNotMatch(c.text, /2026-10-01/);
  });

  it('adds the table header to a removed row', () => {
    const c = changes('## Rounds\nDate | Score\n2026-10-01 | 480\n2026-11-03 | 470', '## Rounds\nDate | Score\n2026-11-03 | 470');
    assert.match(removedSide(c.text), /\(unchanged table header\) Date \| Score\n2026-10-01 \| 480/);
  });

  it('adds the parent bullet to a new nested bullet', () => {
    const c = changes('## Docs\nSend:\n- Proof of funds\n  - bank letter\n- Passport', '## Docs\nSend:\n- Proof of funds\n  - bank letter\n  - under 6 months old\n- Passport');
    assert.match(c.text, /\(unchanged parent\) - Proof of funds\n {2}- under 6 months old/);
    assert.doesNotMatch(c.text, /bank letter/);
  });
});

describe('ruleChanges: size', () => {
  const lines = (word: string, n: number) => Array.from({ length: n }, (_, i) => `${word} line number ${i} with some padding text`).join('\n');

  it('cuts a huge rewrite at a line, added lines first, and says it did', () => {
    const c = changes(lines('removed', 5000), lines('added', 5000));
    assert.equal(c.truncated, true);
    assert.ok(Buffer.byteLength(c.text) <= MAX_CHANGES_BYTES + 200);
    assert.ok(c.text.includes(PARTIAL_MARK));
    assert.match(c.text, /added line number 0/);
    assert.equal(c.added_lines, 5000);
  });

  it('leaves room on the row for the page text, counted in bytes', () => {
    // A 3-byte character on every line, on a page big enough to crowd the row.
    const page = Array.from({ length: 4000 }, (_, i) => `’ page line ${i} ${'x'.repeat(80)}`).join('\n');
    const c = changes(lines('old', 4000), page);
    assert.ok(Buffer.byteLength(page) + Buffer.byteLength(c.text) < 400_000, 'page plus changes stay under the 400 KB item limit');
    assert.equal(c.truncated, true);
  });

  it('keeps removed lines when the added lines alone would fill the stored text', () => {
    const c = changes('Short line that goes.', lines('added', 5000));
    assert.match(removedSide(c.text), /Short line that goes\./);
    assert.equal(c.truncated, true);
  });

  it('marks a change that fits as not truncated', () => {
    assert.equal(changes('a', 'b').truncated, false);
  });
});
