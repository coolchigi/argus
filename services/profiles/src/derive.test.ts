import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clientAssessments, clientBriefs, countsByClient, toAssessment, toBrief, type Row } from './derive.ts';

// ADR-0004 on the caseload read model: a consultant review is the current
// verdict for its (rule, client), and an Auditor disagreement needs action.

const RULE = 'r'.repeat(64);

function agent(run: string, timestamp: string, extra: Row = {}): Row {
  return {
    assessmentKey: `${run}#C-1`,
    policyEventId: run,
    ruleHash: RULE,
    clientId: 'C-1',
    topic: 'pal-tal-requirements',
    isAffected: false,
    impactType: 'none',
    numericDelta: null,
    confidence: 'medium',
    recommendedAction: 'No action',
    timestamp,
    canonicalHash: `h-${run}`,
    signatureAlgorithm: 'ECDSA_SHA_256',
    ...extra,
  };
}

function review(of: Row, reviewedAt: string, extra: Row = {}): Row {
  const key = `review-${Date.parse(reviewedAt)}-${String(of.policyEventId)}#C-1`;
  return {
    ...of,
    assessmentKey: key,
    recordKind: 'consultant-review',
    supersedes: of.assessmentKey,
    timestamp: reviewedAt,
    canonicalHash: `h-${key}`,
    ...extra,
  };
}

function brief(assessmentKey: string, status: string): Row {
  return { briefId: `b-${assessmentKey}-${status}`, assessmentKey, clientId: 'C-1', ruleHash: RULE, topic: 't', status, createdAt: '2026-09-21T00:00:00.000Z', updatedAt: null, sentAt: status === 'sent' ? '2026-09-26T00:00:00.000Z' : null };
}

const disagree = { auditorStance: { stance: 'disagree', reason: 'The profile holds the letter the rule requires.' } };

describe('caseload current verdict (ADR-0004)', () => {
  it('a review beats a newer agent replay and needs a brief when it flips to affected', () => {
    const a1 = agent('run-1', '2026-09-20T00:00:00.000Z', disagree);
    const rows = [a1, review(a1, '2026-09-22T00:00:00.000Z', { isAffected: true, impactType: 'eligibility-flip' }), agent('run-2', '2026-09-25T00:00:00.000Z')].map(toAssessment);
    const [c] = clientAssessments(rows, []);
    assert.equal(c.recordKind, 'consultant-review');
    assert.equal(c.supersedes, 'run-1#C-1');
    assert.equal(c.isAffected, true);
    assert.equal(c.auditorStance, null);
    assert.equal(c.actionReason, 'brief-needed');
    assert.equal(c.needsBrief, true);
    assert.deepEqual(c.priorAssessments.map((p) => [p.assessmentKey, p.recordKind]), [['run-2#C-1', 'agent'], ['run-1#C-1', 'agent']]);
    const counts = countsByClient(rows, []).get('C-1');
    assert.equal(counts?.affectedCount, 1);
    assert.equal(counts?.unsentBriefs, 1);
    assert.equal(counts?.auditorDisagrees, 0, 'the review settled the disagreement');
  });

  it('a flip to not affected leaves the old draft on record but off the current verdict', () => {
    const a1 = agent('run-1', '2026-09-20T00:00:00.000Z', { isAffected: true, impactType: 'procedural' });
    const rows = [a1, review(a1, '2026-09-22T00:00:00.000Z', { isAffected: false })].map(toAssessment);
    const briefs = [toBrief(brief('run-1#C-1', 'draft'))];
    const [c] = clientAssessments(rows, briefs);
    assert.equal(c.needsBrief, false);
    assert.equal(c.actionReason, null);
    assert.equal(c.brief, null);
    const [b] = clientBriefs(rows, briefs);
    assert.equal(b.onCurrentAssessment, false);
    assert.equal(countsByClient(rows, briefs).get('C-1')?.unsentBriefs, 0);
  });

  it('counts an Auditor disagreement on the current agent verdict', () => {
    const rows = [agent('run-1', '2026-09-20T00:00:00.000Z', disagree)].map(toAssessment);
    assert.equal(countsByClient(rows, []).get('C-1')?.auditorDisagrees, 1);
    const [c] = clientAssessments(rows, []);
    assert.equal(c.actionReason, 'auditor-disagrees');
    assert.equal(c.auditorStance?.stance, 'disagree');
  });

  it('reads rows signed before ADR-0004 as agent rows with no stance', () => {
    const a = toAssessment(agent('run-1', '2026-09-20T00:00:00.000Z'));
    assert.equal(a.recordKind, 'agent');
    assert.equal(a.auditorStance, null);
    assert.equal(clientAssessments([a], [])[0].actionReason, null);
  });
});

const contradicted = (extra: Row = {}) => ({
  auditorStance: { stance: 'uncertain', reason: 'The Auditor answered "agree" with isAffected=false, but its reason argues the opposite.', contradicted: true, ...extra },
});

describe('a stance the Auditor contradicted needs action', () => {
  it('counts it as auditor-unsure on the current agent verdict', () => {
    const rows = [agent('run-1', '2026-09-20T00:00:00.000Z', contradicted())].map(toAssessment);
    const counts = countsByClient(rows, []).get('C-1');
    assert.equal(counts?.auditorUnsure, 1);
    assert.equal(counts?.auditorDisagrees, 0);
    assert.equal(counts?.actionRequired, 1);
    const [c] = clientAssessments(rows, []);
    assert.equal(c.actionReason, 'auditor-unsure');
    assert.equal(c.auditorStance?.contradicted, true);
  });

  it('comes before a missing brief', () => {
    const rows = [agent('run-1', '2026-09-20T00:00:00.000Z', { isAffected: true, impactType: 'procedural', ...contradicted() })].map(toAssessment);
    assert.equal(clientAssessments(rows, [])[0].actionReason, 'auditor-unsure');
    assert.equal(countsByClient(rows, []).get('C-1')?.actionRequired, 1, 'one rule counts once');
  });

  it('a consultant review clears it', () => {
    const a1 = agent('run-1', '2026-09-20T00:00:00.000Z', contradicted());
    const rows = [a1, review(a1, '2026-09-22T00:00:00.000Z', { auditorStance: undefined })].map(toAssessment);
    const counts = countsByClient(rows, []).get('C-1');
    assert.equal(counts?.auditorUnsure, 0);
    assert.equal(counts?.actionRequired, 0);
    assert.equal(clientAssessments(rows, [])[0].actionReason, null);
  });

  it('ignores the marker unless it is exactly true on an uncertain stance', () => {
    for (const extra of [{ contradicted: 'true' }, { contradicted: false }, { stance: 'agree' }]) {
      const rows = [agent('run-1', '2026-09-20T00:00:00.000Z', contradicted(extra))].map(toAssessment);
      assert.equal(countsByClient(rows, []).get('C-1')?.actionRequired, 0, JSON.stringify(extra));
      assert.equal(clientAssessments(rows, [])[0].auditorStance?.contradicted, false);
    }
  });
});
