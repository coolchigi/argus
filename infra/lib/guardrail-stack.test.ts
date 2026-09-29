import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as patternModule from './guardrail-patterns';
import { phoneMustBlock, phoneMustPass } from './guardrail-phone-matrix';

// Reads the guardrail config out of the stack source, so the regexes tested
// here are the ones CDK deploys. If someone inlines a different pattern in
// the stack, points a regex at another constant or brings back the PHONE
// entity, these tests fail.
const source = readFileSync(join(__dirname, 'argus-stateful-stack.ts'), 'utf8');

const piiBlock = source.match(/piiEntitiesConfig:\s*\[([\s\S]*?)\n\s*\],\n\s*regexesConfig/);
const regexBlock = source.match(/regexesConfig:\s*\[([\s\S]*?)\n\s*\],\n\s*\},\n\s*contextualGroundingPolicyConfig/);
assert.ok(piiBlock && regexBlock, 'could not find piiEntitiesConfig and regexesConfig in argus-stateful-stack.ts');

// Active entity types, with comment lines stripped first.
const entityTypes = [...piiBlock[1].replace(/^\s*\/\/.*$/gm, '').matchAll(/type:\s*'([A-Z_]+)'/g)].map((m) => m[1]);

// Each regex entry's pattern is either an imported constant or an inline
// String.raw literal.
const exported = patternModule as unknown as Record<string, string>;
const regexes = [...regexBlock[1].matchAll(/name:\s*'([a-z-]+)'[\s\S]*?pattern:\s*(String\.raw`([^`]*)`|([A-Z_]+))/g)].map(
  (m) => {
    const [, name, , literal, constant] = m;
    const pattern = literal ?? exported[constant];
    assert.ok(typeof pattern === 'string', `${name} points at ${constant}, which guardrail-patterns.ts doesn't export`);
    return { name, pattern, re: new RegExp(pattern) };
  },
);
const fired = (text: string) => regexes.filter(({ re }) => re.test(text)).map(({ name }) => name);
const phoneRegexes = ['na-phone', 'intl-phone', 'trunk-phone'];

describe('argus-safety guardrail config in the stack source', () => {
  it('has no built-in PHONE entity', () => {
    assert.ok(entityTypes.length > 0);
    assert.ok(!entityTypes.includes('PHONE'), `entities: ${entityTypes.join(', ')}`);
  });

  it('wires each phone regex to its tested constant', () => {
    const byName = Object.fromEntries(regexes.map(({ name, pattern }) => [name, pattern]));
    assert.equal(byName['na-phone'], patternModule.NA_PHONE_PATTERN);
    assert.equal(byName['intl-phone'], patternModule.INTL_PHONE_PATTERN);
    assert.equal(byName['trunk-phone'], patternModule.TRUNK_PHONE_PATTERN);
  });

  // Bedrock caps a guardrail at 10 regexes and a pattern at 500 characters
  // (aws bedrock create-guardrail help, regexesConfig constraints).
  it('fits the Bedrock regex limits', () => {
    assert.ok(regexes.length <= 10, `${regexes.length} regexes`);
    for (const { name, pattern } of regexes) assert.ok(pattern.length <= 500, `${name} is ${pattern.length} chars`);
  });

  // Runs every deployed regex, so the postal-code, street-address, SIN and
  // SSN patterns can't block the pass probes either.
  for (const text of phoneMustPass) {
    it(`lets through: ${text}`, () => {
      assert.deepEqual(fired(text), []);
    });
  }
  for (const text of phoneMustBlock) {
    it(`blocks with a phone regex: ${text}`, () => {
      const hits = fired(text);
      assert.ok(hits.some((n) => phoneRegexes.includes(n)), `got ${JSON.stringify(hits)}`);
    });
  }
});
