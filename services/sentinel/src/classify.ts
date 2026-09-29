import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { guarded } from './guardrail.ts';

// The classifier's taxonomy, its prompt, and the parser for its reply. No
// AWS calls, so classify.test.ts runs it offline.
//
// The prompt enum, the definitions and the parser all read the lists below,
// so a domain can't be offered to the model without a definition, and the
// model can't hand back a value the rest of Argus doesn't know. An unknown
// policyDomain would otherwise reach the Analyst and Recall as a program no
// client has, and the change would be assessed for nobody.
//
// Services don't share code. services/me/src/model.ts, the profiles
// validator and the Analyst and Recall preference filters keep their own
// copy of POLICY_DOMAINS, so a change here has to land there too.

export const CATEGORIES = ['ministerial-instruction', 'news-release', 'rounds-of-invitations', 'policy-page-change'] as const;
export const POLICY_DOMAINS = ['express-entry', 'pgwp', 'sowp', 'pgp', 'pnp', 'study-permit', 'general', 'other'] as const;
export const SEVERITIES = ['low', 'medium', 'high'] as const;
export const RULE_KINDS = ['scoring', 'interpretation', 'procedural'] as const;

export type Category = (typeof CATEGORIES)[number];
export type PolicyDomain = (typeof POLICY_DOMAINS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type RuleKind = (typeof RULE_KINDS)[number];

export type Classification = {
  category: Category;
  policyDomain: PolicyDomain;
  severity: Severity;
  summary: string;
  topic: string;
  ruleKind: RuleKind;
};

/**
 * What each domain covers, in the order the prompt lists them. Program
 * scope only. IRCC thresholds and eligibility rules stay out of the prompt
 * (ADR-0001).
 */
export const POLICY_DOMAIN_DEFINITIONS: Record<PolicyDomain, string> = {
  'express-entry':
    'Express Entry profiles, the Comprehensive Ranking System (CRS), rounds of invitations, and the federal skilled worker, federal skilled trades and Canadian experience classes.',
  pgwp: 'post-graduation work permits for international students who graduated from a Canadian school.',
  sowp: 'open work permits for the spouse, common-law partner or dependent children of a worker, student or permanent residence applicant.',
  pgp: 'sponsoring parents and grandparents for permanent residence, including interest to sponsor forms and invitations to apply.',
  pnp: 'the Provincial Nominee Program and provincial nominations.',
  'study-permit': 'study permits, including acceptance letters and provincial or territorial attestation letters.',
  general: 'a change that applies across several of the programs above.',
  other: 'none of the above.',
};

const DEFAULTS: Classification = {
  category: 'policy-page-change',
  policyDomain: 'other',
  severity: 'low',
  summary: '(no summary)',
  topic: 'unknown',
  ruleKind: 'procedural',
};

export const CLASSIFIER_MAX_INPUT_CHARS = 12_000;

export type GuardrailConfig = { guardrailIdentifier: string; guardrailVersion: string; trace: 'enabled' };

export function buildClassifierRequest(opts: {
  modelId: string;
  url: string;
  pageText: string;
  guardrailConfig?: GuardrailConfig;
}): ConverseCommandInput {
  const snippet = opts.pageText.slice(0, CLASSIFIER_MAX_INPUT_CHARS);
  const intro = [
    'Classify this IRCC page change. Return valid JSON only, no prose.',
    '',
    `URL: ${opts.url}`,
    'Content (may be truncated):',
  ].join('\n');
  const instructions = [
    'Return this exact JSON shape:',
    '{',
    `  "category": ${enumLine(CATEGORIES)},`,
    `  "policyDomain": ${enumLine(POLICY_DOMAINS)},`,
    `  "severity": ${enumLine(SEVERITIES)},`,
    '  "summary": "one sentence describing what changed or what this page is",',
    '  "topic": "short kebab-case topic id, e.g. crs-scorecard or ee-category-list",',
    `  "ruleKind": ${enumLine(RULE_KINDS)}`,
    '}',
    '',
    'policyDomain definitions. Pick the program whose applicants the page\'s rules are about. A program the page only mentions in passing does not decide the domain.',
    ...POLICY_DOMAINS.map((d) => `- ${d}: ${POLICY_DOMAIN_DEFINITIONS[d]}`),
    '',
    'Severity rules:',
    '- high: eligibility flip, program or intake open, pause or close, a change to how points are awarded (a points factor added, removed or re-weighted).',
    '- medium: category-based-draw change, procedural rule change.',
    '- low: news release, statistics, minor form-version bump.',
    'Judge severity from what the page says. Do not use point values, dates or program rules from memory.',
  ].join('\n');

  // The IRCC page text is the only outside content, so it's the only
  // guarded block. See guardrail.ts for the tagging rule.
  return {
    modelId: opts.modelId,
    system: [
      {
        text: 'You classify Canadian IRCC (Immigration, Refugees and Citizenship Canada) policy pages. Return valid JSON only. No preamble, no explanation.',
      },
    ],
    messages: [{ role: 'user', content: [{ text: intro + '\n' }, guarded(snippet + '\n\n'), { text: instructions }] }],
    inferenceConfig: { maxTokens: 512, temperature: 0.1 },
    guardrailConfig: opts.guardrailConfig,
  };
}

function enumLine(values: readonly string[]): string {
  return values.map((v) => `"${v}"`).join(' | ');
}

export type ParsedClassification = {
  classification: Classification;
  /** Fields the model left out or filled with a value outside the taxonomy, and what they fell back to. */
  coerced: Array<{ field: keyof Classification; received: unknown; used: string }>;
};

/**
 * Reads the model's reply. Enum fields must be one of the listed values
 * (case and surrounding whitespace ignored). Anything else falls back to the
 * default and is reported in `coerced` so the caller can log it.
 */
export function parseClassification(raw: string): ParsedClassification {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`classifier returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const parsed: unknown = JSON.parse(match[0]);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`classifier returned a non-object: ${match[0].slice(0, 200)}`);
  }
  const obj = parsed as Record<string, unknown>;
  const coerced: ParsedClassification['coerced'] = [];

  function pick<T extends string>(field: keyof Classification, allowed: readonly T[], fallback: T): T {
    const v = obj[field];
    const norm = typeof v === 'string' ? v.trim().toLowerCase() : null;
    const hit = allowed.find((a) => a === norm);
    if (hit) return hit;
    coerced.push({ field, received: v, used: fallback });
    return fallback;
  }

  function text(field: keyof Classification, fallback: string): string {
    const v = obj[field];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    coerced.push({ field, received: v, used: fallback });
    return fallback;
  }

  return {
    classification: {
      category: pick('category', CATEGORIES, DEFAULTS.category),
      policyDomain: pick('policyDomain', POLICY_DOMAINS, DEFAULTS.policyDomain),
      severity: pick('severity', SEVERITIES, DEFAULTS.severity),
      summary: text('summary', DEFAULTS.summary),
      topic: text('topic', DEFAULTS.topic),
      ruleKind: pick('ruleKind', RULE_KINDS, DEFAULTS.ruleKind),
    },
    coerced,
  };
}
