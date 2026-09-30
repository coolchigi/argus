// What "affected" means, word for word the same in the Analyst and the
// Auditor. services/analyst/src/affected.ts and services/auditor/src/affected.ts
// must stay byte-identical, and a test in each service fails if they drift.
//
// isAffected=true is what makes Composer draft a brief and the caseload ask
// for one, so "affected" means the consultant has something to tell the
// client. A new step the client must take counts, even when the rule exempts
// them from something else, since the consultant still has to tell them to
// take it. Generic on purpose: no program, threshold or document names (ADR-0001).
export const AFFECTED_DEFINITION = [
  'DEFINITION OF AFFECTED (the same for every agent in Argus):',
  '- isAffected=true when the rule, applied to this client\'s profile, requires the client to do anything, or changes any outcome, eligibility, deadline, cost or document for them. That includes a new procedural step, such as proving that an exemption applies to them.',
  '- isAffected=false when the rule changes nothing the client must do and nothing they can expect.',
  '- An exemption from one requirement does not make the client unaffected when the rule still asks them for a step to claim it.',
  '- A client who is affected never has impactType "none". A change that only adds a step is "procedural".',
].join('\n');
