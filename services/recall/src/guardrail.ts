import type { ConverseCommandOutput, GuardrailAssessment } from '@aws-sdk/client-bedrock-runtime';

// Guardrail tagging rule, identical in every Argus agent that calls Bedrock.
// Content that comes from outside our code (IRCC page and rule text, client
// profiles, Analyst hypotheses, consultant corrections, prior assessments)
// goes in a guardContent block so the guardrail evaluates it. Our own fixed
// instructions and JSON schemas stay plain text. Once any guardContent block
// is present the guardrail evaluates only tagged input, so our instruction
// wording can't trip PROMPT_ATTACK. Model output is still evaluated in full.
// Callers keep the old line breaks on each block, so the blocks join back
// into the same prompt text the model saw before tagging.
export function guarded(text: string): { guardContent: { text: { text: string } } } {
  return { guardContent: { text: { text } } };
}

export type GuardrailBlock = { stage: 'input' | 'output' | 'unknown'; policies: string[] };

// Says which side of the call was blocked and by which policies. Reads only
// policy names and types from the trace, never `match` or `modelOutput`,
// because those can hold the PII that tripped the filter.
export function describeGuardrailBlock(res: ConverseCommandOutput): GuardrailBlock {
  const trace = res.trace?.guardrail;
  const input = Object.values(trace?.inputAssessment ?? {}).flatMap(blockedPolicies);
  const output = Object.values(trace?.outputAssessments ?? {}).flat().flatMap(blockedPolicies);
  if (input.length > 0) return { stage: 'input', policies: [...new Set(input)] };
  if (output.length > 0) return { stage: 'output', policies: [...new Set(output)] };
  return { stage: 'unknown', policies: [] };
}

export type GroundingCheck = {
  grounding: number | null;
  groundingThreshold: number | null;
  relevance: number | null;
  relevanceThreshold: number | null;
};

// Reads the contextual grounding and relevance scores from the output
// assessment. The guardrail runs these checks in detect mode, so they're
// evidence for the Auditor and never block. Reads only numbers from the
// trace. Null means the check didn't run (no grounding source or query).
export function readGroundingCheck(res: ConverseCommandOutput): GroundingCheck {
  const filters = Object.values(res.trace?.guardrail?.outputAssessments ?? {})
    .flat()
    .flatMap((a) => a.contextualGroundingPolicy?.filters ?? []);
  const pick = (type: string) => filters.find((f) => f.type === type);
  const grounding = pick('GROUNDING');
  const relevance = pick('RELEVANCE');
  return {
    grounding: grounding?.score ?? null,
    groundingThreshold: grounding?.threshold ?? null,
    relevance: relevance?.score ?? null,
    relevanceThreshold: relevance?.threshold ?? null,
  };
}

function blockedPolicies(a: GuardrailAssessment): string[] {
  const out: string[] = [];
  for (const t of a.topicPolicy?.topics ?? []) if (t.action === 'BLOCKED') out.push(`topic:${t.name}`);
  for (const f of a.contentPolicy?.filters ?? []) if (f.action === 'BLOCKED') out.push(`content:${f.type}`);
  for (const w of a.wordPolicy?.customWords ?? []) if (w.action === 'BLOCKED') out.push('word:custom');
  for (const w of a.wordPolicy?.managedWordLists ?? []) if (w.action === 'BLOCKED') out.push(`word:${w.type}`);
  for (const p of a.sensitiveInformationPolicy?.piiEntities ?? []) if (p.action === 'BLOCKED') out.push(`pii:${p.type}`);
  for (const r of a.sensitiveInformationPolicy?.regexes ?? []) if (r.action === 'BLOCKED') out.push(`regex:${r.name}`);
  for (const f of a.contextualGroundingPolicy?.filters ?? []) if (f.action === 'BLOCKED') out.push(`grounding:${f.type}`);
  return out;
}
