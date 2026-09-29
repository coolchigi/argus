import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkBriefVoice, withoutClientId } from './voice.ts';

// The live draft Composer wrote for client 2026-042 on the PGP pause.
const LIVE_BAD =
  'This means that your client, identified as [CLIENT NAME], cannot submit new sponsor applications until the program reopens. ' +
  'As your consultant, I recommend that your client refrains from submitting any new forms.';

const GOOD =
  "You can't submit a new interest to sponsor form right now. IRCC has paused new intake for the Parents and Grandparents Program. " +
  'I recommend we hold your file as it is and I will tell you as soon as intake reopens.';

describe('checkBriefVoice', () => {
  it('flags the live 2026-042 draft for addressing the consultant', () => {
    assert.deepEqual(checkBriefVoice(LIVE_BAD, '2026-042'), ['your-client']);
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
