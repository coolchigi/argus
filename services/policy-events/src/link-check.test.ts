import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sourceIsGone } from './link-check.ts';

const URL_ = 'https://www.canada.ca/en/immigration-refugees-citizenship/x.html';
const answer = (status: number) => async () => new Response(status === 204 ? null : 'x', { status });
// Never answers until aborted, like canada.ca from Lambda on a slow day.
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

describe('sourceIsGone', () => {
  it('says gone on 404 and 410', async () => {
    assert.equal(await sourceIsGone(URL_, answer(404)), true);
    assert.equal(await sourceIsGone(URL_, answer(410)), true);
  });

  it('says not gone when the page answers, including a ranged 206', async () => {
    assert.equal(await sourceIsGone(URL_, answer(200)), false);
    assert.equal(await sourceIsGone(URL_, answer(206)), false);
  });

  it('makes no claim on a timeout', async () => {
    const started = Date.now();
    assert.equal(await sourceIsGone(URL_, hang, 50), false);
    assert.ok(Date.now() - started < 1_000, 'gives up at the timeout');
  });

  it('makes no claim on a network error, bot protection or a server error', async () => {
    assert.equal(await sourceIsGone(URL_, async () => { throw new TypeError('fetch failed'); }), false);
    assert.equal(await sourceIsGone(URL_, answer(403)), false);
    assert.equal(await sourceIsGone(URL_, answer(429)), false);
    assert.equal(await sourceIsGone(URL_, answer(503)), false);
  });

  it('makes no claim without a URL and never fetches', async () => {
    let called = false;
    assert.equal(await sourceIsGone('', async () => { called = true; return new Response('x'); }), false);
    assert.equal(called, false);
  });
});
