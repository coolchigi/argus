import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapWithConcurrency } from './pool.ts';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  it('never runs more than the limit at once, and does reach it', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 5, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick(5);
      inFlight--;
    });
    assert.equal(peak, 5);
  });

  it('keeps going past a failing item and returns results in input order', async () => {
    const res = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      await tick(n === 1 ? 10 : 1);
      if (n === 2) throw new Error('boom');
      return n * 10;
    });
    assert.deepEqual(
      res.map((r) => (r.status === 'fulfilled' ? r.value : (r.reason as Error).message)),
      [10, 'boom', 30, 40],
    );
  });

  it('handles an empty list', async () => {
    assert.deepEqual(await mapWithConcurrency([], 5, async () => 1), []);
  });
});
