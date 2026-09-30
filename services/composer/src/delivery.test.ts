import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { briefIdFor, classifyFailure, PermanentError } from './delivery.ts';

// Shaped like the errors the AWS SDK v3 throws: a name and $metadata.
function sdkError(name: string, httpStatusCode?: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode }, ...extra });
}

describe('classifyFailure', () => {
  for (const [name, status] of [
    ['ThrottlingException', 429],
    ['ProvisionedThroughputExceededException', 400],
    ['RequestLimitExceeded', 400],
    ['ModelTimeoutException', 408],
    ['ServiceUnavailableException', 503],
    ['InternalServerException', 500],
    ['InternalFailure', undefined],
  ] as const) {
    it(`retries ${name}`, () => {
      assert.equal(classifyFailure(sdkError(name, status)).retryable, true);
    });
  }

  it('retries any 5xx, whatever its name', () => {
    assert.deepEqual(classifyFailure(sdkError('SomethingNew', 502)), { retryable: true, reason: 'server-error' });
  });

  it('retries an error the SDK marks retryable', () => {
    assert.equal(classifyFailure(sdkError('SomethingNew', 400, { $retryable: {} })).retryable, true);
  });

  it('retries what it cannot name, so the record reaches the failure queue instead of being dropped', () => {
    assert.deepEqual(classifyFailure(new Error('socket hang up')), { retryable: true, reason: 'unclassified' });
    assert.deepEqual(classifyFailure(sdkError('AccessDeniedException', 403)), { retryable: true, reason: 'unclassified' });
  });

  it('drops a request the service rejected as malformed', () => {
    assert.deepEqual(classifyFailure(sdkError('ValidationException', 400)), { retryable: false, reason: 'request-rejected' });
  });

  it('drops a permanent error with its reason', () => {
    for (const reason of ['bad-input', 'guardrail-blocked', 'rule-not-found', 'model-output-unusable'] as const) {
      assert.deepEqual(classifyFailure(new PermanentError(reason, 'x')), { retryable: false, reason });
    }
  });

  it('drops a model reply that is not valid JSON', () => {
    let err: unknown;
    try {
      JSON.parse('{"subject": ');
    } catch (e) {
      err = e;
    }
    assert.deepEqual(classifyFailure(err), { retryable: false, reason: 'model-output-unusable' });
  });
});

describe('briefIdFor', () => {
  it('gives the same id for the same assessment every time', () => {
    assert.equal(briefIdFor('R1', 'pe1#c1'), briefIdFor('R1', 'pe1#c1'));
  });

  it('gives a different id for another assessment or another tenant', () => {
    const id = briefIdFor('R1', 'pe1#c1');
    assert.notEqual(briefIdFor('R1', 'pe1#c2'), id);
    assert.notEqual(briefIdFor('R2', 'pe1#c1'), id);
    // The separator keeps the two parts apart.
    assert.notEqual(briefIdFor('R1p', 'e1#c1'), briefIdFor('R1', 'pe1#c1'));
  });

  it('keeps the UUID shape the random ids had', () => {
    assert.match(briefIdFor('R1', 'pe1#c1'), /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
