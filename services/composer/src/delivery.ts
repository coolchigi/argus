import { createHash } from 'node:crypto';

// Composer runs on the ImpactAssessments stream with reportBatchItemFailures
// on. A record that fails for a reason a retry can fix goes back to Lambda,
// which redelivers it (and every later record in the shard). A record that
// fails for a reason no retry can fix is logged and dropped, so it doesn't
// cost more Bedrock calls or hold up the shard.

export type PermanentReason = 'bad-input' | 'guardrail-blocked' | 'rule-not-found' | 'model-output-unusable' | 'request-rejected';

/** A failure no retry can fix. */
export class PermanentError extends Error {
  readonly reason: PermanentReason;
  constructor(reason: PermanentReason, message: string) {
    super(message);
    this.name = 'PermanentError';
    this.reason = reason;
  }
}

export type Failure = { retryable: true; reason: 'transient' | 'server-error' | 'unclassified' } | { retryable: false; reason: PermanentReason };

// Service errors that mean "try again later" across Bedrock Runtime,
// DynamoDB and EventBridge.
const TRANSIENT = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
  'ServiceQuotaExceededException',
  'LimitExceededException',
  'TransactionConflictException',
  'ModelNotReadyException',
  'ModelTimeoutException',
  'ServiceUnavailableException',
  'InternalServerException',
  'InternalServerError',
  'InternalFailure',
  'TimeoutError',
]);

// The request itself is wrong, so sending it again gets the same answer.
const REJECTED = new Set(['ValidationException', 'SerializationException']);

/**
 * Whether a failed record should go back to Lambda. Anything this can't name
 * is retried: after the retries run out the record's position lands in the
 * on-failure queue, where it can be replayed. Skipping it would lose it.
 */
export function classifyFailure(err: unknown): Failure {
  if (err instanceof PermanentError) return { retryable: false, reason: err.reason };
  // Only JSON.parse on the model reply throws this in Composer.
  if (err instanceof SyntaxError) return { retryable: false, reason: 'model-output-unusable' };
  const e = (err ?? {}) as { name?: unknown; $metadata?: { httpStatusCode?: unknown }; $retryable?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const status = typeof e.$metadata?.httpStatusCode === 'number' ? e.$metadata.httpStatusCode : undefined;
  if (REJECTED.has(name)) return { retryable: false, reason: 'request-rejected' };
  if (TRANSIENT.has(name) || status === 429 || e.$retryable) return { retryable: true, reason: 'transient' };
  if (status !== undefined && status >= 500) return { retryable: true, reason: 'server-error' };
  return { retryable: true, reason: 'unclassified' };
}

/**
 * One brief per assessment, so the brief's key comes from the assessment. A
 * redelivered record finds the brief it already wrote instead of adding a
 * second one. UUID-shaped (version 8, RFC 9562) like the random ids before it.
 */
export function briefIdFor(rcicId: string, assessmentKey: string): string {
  const h = createHash('sha256').update(`${rcicId}\n${assessmentKey}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
