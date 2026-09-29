import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { bumpPublicCounter } from './public-counter.ts';

// GET /public/stats in impacts-service reads `assessments#YYYY-MM-DD` and
// `briefs#YYYY-MM-DD` rows and sums `count`. These pin the write side of
// that contract.

function fakeDdb(fail = false) {
  const sent: UpdateCommand['input'][] = [];
  const client = {
    send: async (cmd: UpdateCommand) => {
      if (fail) throw new Error('ProvisionedThroughputExceededException');
      sent.push(cmd.input);
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, sent };
}

describe('bumpPublicCounter', () => {
  it('adds 1 to the UTC day row for the kind and records the time', async () => {
    const { client, sent } = fakeDdb();
    await bumpPublicCounter(client, 'counters', 'assessments', '2026-09-29T23:59:59.000Z');
    assert.equal(sent.length, 1);
    const input = sent[0];
    assert.equal(input.TableName, 'counters');
    assert.deepEqual(input.Key, { counterKey: 'assessments#2026-09-29' });
    assert.match(String(input.UpdateExpression), /^ADD #count :one SET #lastAt = :at$/);
    assert.deepEqual(input.ExpressionAttributeNames, { '#count': 'count', '#lastAt': 'lastAt' });
    assert.deepEqual(input.ExpressionAttributeValues, { ':one': 1, ':at': '2026-09-29T23:59:59.000Z' });
  });

  it('does nothing when the table is not configured', async () => {
    const { client, sent } = fakeDdb();
    await bumpPublicCounter(client, undefined, 'assessments', '2026-09-29T00:00:00.000Z');
    assert.equal(sent.length, 0);
  });

  it('never throws, so a counter outage cannot fail a signed write', async () => {
    const { client } = fakeDdb(true);
    const origLog = console.log;
    const lines: string[] = [];
    console.log = (l: string) => lines.push(l);
    try {
      await bumpPublicCounter(client, 'counters', 'assessments', '2026-09-29T00:00:00.000Z');
    } finally {
      console.log = origLog;
    }
    assert.match(lines.join('\n'), /public-counter-failed/);
  });
});
