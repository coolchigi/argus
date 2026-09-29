import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLASSIFIER_MAX_INPUT_CHARS,
  POLICY_DOMAIN_DEFINITIONS,
  POLICY_DOMAINS,
  buildClassifierRequest,
  parseClassification,
} from './classify.ts';

const SPOUSAL_URL =
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit/temporary/open-work-permit-spouses-dependent-children/eligibility.html';

function textBlocks(pageText = 'page text') {
  const req = buildClassifierRequest({ modelId: 'us.test-model', url: SPOUSAL_URL, pageText });
  const content = req.messages?.[0]?.content ?? [];
  return { req, content };
}

function instructions(): string {
  const { content } = textBlocks();
  const last = content[content.length - 1];
  assert.ok(last && 'text' in last && typeof last.text === 'string');
  return last.text;
}

describe('classifier prompt', () => {
  it('offers exactly the known domains in the JSON shape', () => {
    const line = instructions().split('\n').find((l) => l.trim().startsWith('"policyDomain"'));
    assert.ok(line, 'policyDomain line missing from the JSON shape');
    const offered = [...line.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).filter((v) => v !== 'policyDomain');
    assert.deepEqual(offered, [...POLICY_DOMAINS]);
  });

  it('defines every domain it offers', () => {
    const text = instructions();
    for (const d of POLICY_DOMAINS) {
      const def = POLICY_DOMAIN_DEFINITIONS[d];
      assert.ok(def && def.trim().length > 0, `${d} has no definition`);
      assert.ok(text.includes(`- ${d}: ${def}`), `${d} definition missing from the prompt`);
    }
  });

  // The spousal open work permit page was filed as pgwp when the domains
  // were bare ids. These two definitions are what tell the model apart.
  it('separates a graduate\'s own work permit from a family member\'s open work permit', () => {
    assert.match(POLICY_DOMAIN_DEFINITIONS.pgwp, /graduat/);
    assert.doesNotMatch(POLICY_DOMAIN_DEFINITIONS.pgwp, /spouse|partner|dependent/);
    assert.match(POLICY_DOMAIN_DEFINITIONS.sowp, /spouse/);
    assert.match(POLICY_DOMAIN_DEFINITIONS.sowp, /common-law partner/);
    assert.match(POLICY_DOMAIN_DEFINITIONS.sowp, /dependent children/);
  });

  it('keeps numbers out of the domain definitions', () => {
    // ADR-0001: thresholds and program rules are data, never prompt text.
    for (const [d, def] of Object.entries(POLICY_DOMAIN_DEFINITIONS)) {
      assert.doesNotMatch(def, /\d/, `${d} definition carries a number`);
    }
  });

  it('puts the page text only in the guarded block and truncates it', () => {
    const page = 'x'.repeat(CLASSIFIER_MAX_INPUT_CHARS + 500);
    const { content } = textBlocks(page);
    const guardedBlocks = content.filter((b) => 'guardContent' in b);
    assert.equal(guardedBlocks.length, 1);
    const guardedText = (guardedBlocks[0] as { guardContent: { text: { text: string } } }).guardContent.text.text;
    assert.equal(guardedText, 'x'.repeat(CLASSIFIER_MAX_INPUT_CHARS) + '\n\n');
    for (const b of content) {
      if ('text' in b && typeof b.text === 'string') assert.ok(!b.text.includes('xxxx'), 'page text leaked into a plain block');
    }
  });

  it('sets maxTokens and passes the guardrail through only when configured', () => {
    const plain = buildClassifierRequest({ modelId: 'us.m', url: SPOUSAL_URL, pageText: 'p' });
    assert.equal(plain.inferenceConfig?.maxTokens, 512);
    assert.equal(plain.guardrailConfig, undefined);
    const withGuard = buildClassifierRequest({
      modelId: 'us.m',
      url: SPOUSAL_URL,
      pageText: 'p',
      guardrailConfig: { guardrailIdentifier: 'g1', guardrailVersion: '3', trace: 'enabled' },
    });
    assert.deepEqual(withGuard.guardrailConfig, { guardrailIdentifier: 'g1', guardrailVersion: '3', trace: 'enabled' });
  });
});

describe('parseClassification', () => {
  const good = {
    category: 'policy-page-change',
    policyDomain: 'sowp',
    severity: 'medium',
    summary: 'Eligibility for spousal open work permits.',
    topic: 'open-work-permit-eligibility',
    ruleKind: 'procedural',
  };

  it('keeps a reply that is inside the taxonomy', () => {
    const { classification, coerced } = parseClassification(JSON.stringify(good));
    assert.deepEqual(classification, good);
    assert.deepEqual(coerced, []);
  });

  it('reads JSON wrapped in prose or a code fence', () => {
    const { classification } = parseClassification('Here you go:\n```json\n' + JSON.stringify(good) + '\n```');
    assert.equal(classification.policyDomain, 'sowp');
  });

  it('ignores case and surrounding whitespace on enum values', () => {
    const { classification, coerced } = parseClassification(JSON.stringify({ ...good, policyDomain: ' SOWP ', severity: 'High' }));
    assert.equal(classification.policyDomain, 'sowp');
    assert.equal(classification.severity, 'high');
    assert.deepEqual(coerced, []);
  });

  // An unknown domain used to go straight to PolicyRules and the PolicyDelta.
  // The Analyst and Recall match it against client programs, find none, and
  // the change is assessed for nobody.
  it('replaces a domain outside the taxonomy with other and reports it', () => {
    const { classification, coerced } = parseClassification(JSON.stringify({ ...good, policyDomain: 'spousal-open-work-permit' }));
    assert.equal(classification.policyDomain, 'other');
    assert.deepEqual(coerced, [{ field: 'policyDomain', received: 'spousal-open-work-permit', used: 'other' }]);
  });

  it('replaces other out-of-taxonomy enums with their defaults and reports each', () => {
    const { classification, coerced } = parseClassification(
      JSON.stringify({ ...good, category: 'blog', severity: 'critical', ruleKind: 42 }),
    );
    assert.equal(classification.category, 'policy-page-change');
    assert.equal(classification.severity, 'low');
    assert.equal(classification.ruleKind, 'procedural');
    assert.deepEqual(coerced.map((c) => c.field).sort(), ['category', 'ruleKind', 'severity']);
  });

  it('fills missing fields with defaults and reports them', () => {
    const { classification, coerced } = parseClassification('{"policyDomain":"pgwp","summary":"  ","topic":""}');
    assert.deepEqual(classification, {
      category: 'policy-page-change',
      policyDomain: 'pgwp',
      severity: 'low',
      summary: '(no summary)',
      topic: 'unknown',
      ruleKind: 'procedural',
    });
    assert.deepEqual(coerced.map((c) => c.field).sort(), ['category', 'ruleKind', 'severity', 'summary', 'topic']);
  });

  it('throws on a reply with no JSON object', () => {
    assert.throws(() => parseClassification('I cannot classify this page.'), /non-JSON/);
  });

  it('throws on malformed JSON', () => {
    assert.throws(() => parseClassification('{"policyDomain": "sowp",}'), SyntaxError);
  });
});
