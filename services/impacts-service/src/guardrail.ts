import type { ApplyGuardrailCommandOutput, GuardrailAssessment } from '@aws-sdk/client-bedrock-runtime';

export type GuardrailVerdict = { intervened: boolean; policies: string[] };

// Reads which policies fired from an ApplyGuardrail response. Reads only
// policy names and types, never `match` or `outputs`, because those hold
// the text that tripped the filter.
export function readGuardrailVerdict(res: ApplyGuardrailCommandOutput): GuardrailVerdict {
  const intervened = res.action === 'GUARDRAIL_INTERVENED';
  const policies = [...new Set((res.assessments ?? []).flatMap(firedPolicies))];
  return { intervened, policies };
}

// Same policy naming as describeGuardrailBlock in the agent services, so a
// correction rejected here logs the same names an audit block would. Counts
// BLOCKED and ANONYMIZED, since either one makes the guardrail intervene.
function firedPolicies(a: GuardrailAssessment): string[] {
  const fired = (action: string | undefined) => action === 'BLOCKED' || action === 'ANONYMIZED';
  const out: string[] = [];
  for (const t of a.topicPolicy?.topics ?? []) if (fired(t.action)) out.push(`topic:${t.name}`);
  for (const f of a.contentPolicy?.filters ?? []) if (fired(f.action)) out.push(`content:${f.type}`);
  for (const w of a.wordPolicy?.customWords ?? []) if (fired(w.action)) out.push('word:custom');
  for (const w of a.wordPolicy?.managedWordLists ?? []) if (fired(w.action)) out.push(`word:${w.type}`);
  for (const p of a.sensitiveInformationPolicy?.piiEntities ?? []) if (fired(p.action)) out.push(`pii:${p.type}`);
  for (const r of a.sensitiveInformationPolicy?.regexes ?? []) if (fired(r.action)) out.push(`regex:${r.name}`);
  return out;
}
