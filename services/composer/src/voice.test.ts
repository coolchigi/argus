import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkBriefVoice, checkDraftVoice, withoutClientId } from './voice.ts';

// The live draft Composer wrote for client 2026-042 on the PGP pause.
const LIVE_BAD =
  'This means that your client, identified as [CLIENT NAME], cannot submit new sponsor applications until the program reopens. ' +
  'As your consultant, I recommend that your client refrains from submitting any new forms.';

const GOOD =
  "You can't submit a new interest to sponsor form right now. IRCC has paused new intake for the Parents and Grandparents Program. " +
  'I recommend we hold your file as it is and I will tell you as soon as intake reopens.';

describe('checkBriefVoice', () => {
  it('flags the live 2026-042 draft for addressing the consultant and for its [CLIENT NAME] slot', () => {
    assert.deepEqual(checkBriefVoice(LIVE_BAD, '2026-042'), ['your-client', 'placeholder']);
  });

  it('passes a draft written to the client', () => {
    assert.deepEqual(checkBriefVoice(GOOD, '2026-042'), []);
  });

  it('flags the raw client id in the body', () => {
    assert.deepEqual(checkBriefVoice('Client 2026-042 is affected by the pause.', '2026-042'), ['client-id']);
  });

  it('reports both slips together', () => {
    assert.deepEqual(checkBriefVoice('Your client 2026-042 should wait.', '2026-042'), ['your-client', 'client-id']);
  });

  it("catches the plural and possessive forms", () => {
    assert.deepEqual(checkBriefVoice("Your client's file is on hold.", 'c1'), ['your-client']);
    assert.deepEqual(checkBriefVoice('Tell your clients to wait.', 'c1'), ['your-client']);
  });

  it('matches the id as a whole token only', () => {
    assert.deepEqual(checkBriefVoice('Your file F-2026-042 is on hold.', '2026-042'), []);
    assert.deepEqual(checkBriefVoice('See section c12 of the guide.', 'c1'), []);
  });

  it('skips the id check when there is no id', () => {
    assert.deepEqual(checkBriefVoice(GOOD, '  '), []);
  });
});

// Brief 58366b94 for client 2026-032 (PAL/TAL rule, 2026-09-30), as stored.
const LIVE_032_BODY =
  'IRCC has updated the requirements for a provincial attestation letter (PAL) or territorial attestation letter (TAL) for study permit applications. ' +
  'You need a PAL/TAL to apply for a study permit unless you qualify for an exemption. ' +
  'Your program starts on [start date], and you attend a private college, which means you do not qualify for any exemption. ' +
  'I recommend you contact your designated learning institution to apply for and obtain a PAL/TAL before submitting your study permit application. ' +
  '[Learn more about PAL/TAL requirements](https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents/provincial-attestation-letter.html).';

describe('placeholder finding', () => {
  it('flags the live 2026-032 brief for its [start date] slot and nothing else', () => {
    assert.deepEqual(checkBriefVoice(LIVE_032_BODY, '2026-032'), ['placeholder']);
  });

  it('passes the same brief written around the missing date, markdown link and all', () => {
    const fixed = LIVE_032_BODY.replace('Your program starts on [start date], and you attend', 'You attend');
    assert.deepEqual(checkBriefVoice(fixed, '2026-032'), []);
  });

  it('flags [CLIENT NAME] on its own', () => {
    assert.deepEqual(checkBriefVoice('Hi [CLIENT NAME], IRCC has paused intake.', 'c1'), ['placeholder']);
  });

  for (const slot of ['{date}', '{{client_name}}', '<name>', '<start date>', 'XX points', 'XX/XX/XXXX', 'on ____', 'TBD', 'tbc', '[insert date]', '[Program Name]']) {
    it(`flags ${slot}`, () => {
      assert.deepEqual(checkBriefVoice(`Your program starts ${slot}.`, 'c1'), ['placeholder']);
    });
  }

  for (const text of [
    'Read [IRCC\'s notice](https://www.canada.ca/x) before you apply.',
    'Read IRCC\'s notice at <https://www.canada.ca/x>.',
    'Bring 2 copies [1] of your letter.',
    'Your offer letter is in XXL print.<br>',
    'Send the forms by March 1, 2027.',
  ]) {
    it(`passes ${JSON.stringify(text)}`, () => {
      assert.deepEqual(checkBriefVoice(text, 'c1'), []);
    });
  }
});

describe('checkDraftVoice', () => {
  const clean = { subject: 'A PAL/TAL is now required', bodyMarkdown: 'You need a PAL/TAL.', suggestedActions: ['Ask your school for a PAL/TAL.'] };

  it('passes a clean draft', () => {
    assert.deepEqual(checkDraftVoice(clean, 'c1'), []);
  });

  it('flags a placeholder in the subject', () => {
    assert.deepEqual(checkDraftVoice({ ...clean, subject: 'Your PAL/TAL before [start date]' }, 'c1'), ['placeholder']);
  });

  it('flags a placeholder in a suggested action', () => {
    assert.deepEqual(checkDraftVoice({ ...clean, suggestedActions: ['Apply', 'Submit it by {deadline}.'] }, 'c1'), ['placeholder']);
  });

  it('reports a placeholder once when the body and an action both have one', () => {
    assert.deepEqual(checkDraftVoice({ ...clean, bodyMarkdown: 'Starts [date].', suggestedActions: ['Submit by TBD.'] }, 'c1'), ['placeholder']);
  });

  it('keeps the other checks on the body', () => {
    assert.deepEqual(checkDraftVoice({ ...clean, bodyMarkdown: 'Your client must wait until [date].' }, 'c1'), ['your-client', 'placeholder']);
  });
});

describe('withoutClientId', () => {
  it("takes the id and a leading 'client' out of the Analyst narrative", () => {
    assert.equal(
      withoutClientId('Client 2026-042 cannot sponsor under PGP while intake is paused. 2026-042 should wait.', '2026-042'),
      'the client cannot sponsor under PGP while intake is paused. the client should wait.',
    );
  });

  it('leaves a longer id that only contains the client id', () => {
    assert.equal(withoutClientId('File F-2026-042 is unrelated.', '2026-042'), 'File F-2026-042 is unrelated.');
  });

  it('returns the text unchanged for a blank id', () => {
    assert.equal(withoutClientId('c1 loses 6 points', ''), 'c1 loses 6 points');
  });
});
