import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { describeGuardrailBlock, describeGuardrailDetections } from './guardrail.ts';

// Trace shapes as Converse returns them with trace enabled: inputAssessment is
// keyed by guardrail id, outputAssessments by guardrail id with a list each.
function res(input: unknown[], output: unknown[], stopReason = 'end_turn'): ConverseCommandOutput {
  return {
    stopReason,
    trace: { guardrail: { inputAssessment: Object.fromEntries(input.map((a, i) => [`g${i}`, a])), outputAssessments: { g: output } } },
  } as unknown as ConverseCommandOutput;
}
const filter = (type: string, confidence: string, action: string, detected: boolean) => ({ contentPolicy: { filters: [{ type, confidence, action, detected }] } });

describe('describeGuardrailDetections', () => {
  it('reports a filter in detect mode that fired, with its side and confidence', () => {
    const r = res([filter('MISCONDUCT', 'MEDIUM', 'NONE', true)], [filter('MISCONDUCT', 'HIGH', 'NONE', true)]);
    assert.deepEqual(describeGuardrailDetections(r), ['input:content:MISCONDUCT:MEDIUM', 'output:content:MISCONDUCT:HIGH']);
  });

  it('leaves out filters that did not fire and filters that blocked', () => {
    const r = res([filter('MISCONDUCT', 'NONE', 'NONE', false), filter('HATE', 'MEDIUM', 'BLOCKED', true)], [], 'guardrail_intervened');
    assert.deepEqual(describeGuardrailDetections(r), []);
    // The block still shows up where it belongs.
    assert.deepEqual(describeGuardrailBlock(r), { stage: 'input', policies: ['content:HATE'] });
  });

  it('returns nothing when the call had no guardrail trace', () => {
    assert.deepEqual(describeGuardrailDetections({ stopReason: 'end_turn' } as unknown as ConverseCommandOutput), []);
  });
});
