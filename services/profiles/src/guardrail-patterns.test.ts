import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CA_SIN_PATTERN, US_SSN_PATTERN } from './guardrail-patterns.ts';

// Reads the source text rather than importing it: infra is a CommonJS
// package with its own toolchain, and the string literal is what the
// guardrail deploys.
const infraSource = readFileSync(new URL('../../../infra/lib/guardrail-patterns.ts', import.meta.url), 'utf8');

function infraPattern(name: string): string {
  const m = new RegExp(`export const ${name} = String\\.raw\`([^\`]+)\`;`).exec(infraSource);
  assert.ok(m, `${name} not found in infra/lib/guardrail-patterns.ts`);
  return m[1];
}

describe('guardrail pattern copy', () => {
  it('matches the ca-sin regex the guardrail deploys', () => {
    assert.equal(CA_SIN_PATTERN, infraPattern('CA_SIN_PATTERN'));
  });
  it('matches the us-ssn regex the guardrail deploys', () => {
    assert.equal(US_SSN_PATTERN, infraPattern('US_SSN_PATTERN'));
  });
});
