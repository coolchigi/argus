import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildActivity,
  buildEventImpacts,
  buildEvents,
  eventIdOf,
  humanizeTopic,
  listView,
  originOf,
  parseActivityBefore,
  resolveEventId,
  toAssessment,
  type Assessment,
  type BriefRow,
  type CorrectionRow,
  type PolicyEvent,
  type Row,
  type Rule,
} from './derive.ts';

// Fixture rows shaped like argus-impact-assessments, argus-briefs,
// argus-training-corrections and argus-policy-rules items.

const RULE_A = 'a1b2c3d4'.padEnd(64, '0');
const RULE_B = 'e5f6a7b8'.padEnd(64, '1');

// Sentinel run ids: `${Date.now()}-${ruleHash.slice(0, 8)}`.
const RUN_A1 = `${Date.parse('2026-09-20T10:00:00.000Z')}-${RULE_A.slice(0, 8)}`;
const RUN_A2 = `${Date.parse('2026-09-25T10:00:00.000Z')}-${RULE_A.slice(0, 8)}`;
const RECALL_A = `recall-${RULE_A.slice(0, 12)}`;

function row(runId: string, ruleHash: string, clientId: string, timestamp: string, extra: Row = {}): Row {
  return {
    assessmentKey: `${runId}#${clientId}`,
    policyEventId: runId,
    ruleHash,
    clientId,
    topic: 'crs-scorecard',
    isAffected: true,
    impactType: 'crs-delta',
    numericDelta: -10,
    confidence: 'high',
    recommendedAction: 'Review the profile',
    narrative: 'n',
    canonicalHash: `hash-${runId}-${clientId}`,
    signatureAlgorithm: 'ECDSA_SHA_256',
    timestamp,
    ...extra,
  };
}

function rule(ruleHash: string, extra: Partial<Rule> = {}): Rule {
  return {
    ruleHash,
    summary: 'summary',
    severity: 'high',
    category: 'scoring',
    policyDomain: 'express-entry',
    topic: 'crs-scorecard',
    sourceUrl: 'https://www.canada.ca/x',
    sourceS3Key: 'k',
    sourceS3VersionId: null,
    capturedAt: '2026-09-20T09:59:00.000Z',
    ...extra,
  };
}

function brief(assessmentKey: string, status: string, extra: Partial<BriefRow> = {}): BriefRow {
  return {
    briefId: `brief-${assessmentKey}-${status}`,
    assessmentKey,
    clientId: assessmentKey.split('#')[1] ?? '',
    topic: 'crs-scorecard',
    status,
    sentAt: status === 'sent' ? '2026-09-26T00:00:00.000Z' : null,
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: null,
    ...extra,
  };
}

function correction(assessmentKey: string, correctedAt = '2026-09-22T00:00:00.000Z'): CorrectionRow {
  return {
    correctionKey: `${assessmentKey}#${correctedAt}`,
    assessmentKey,
    clientId: assessmentKey.split('#')[1] ?? '',
    topic: 'crs-scorecard',
    correctedAt,
  };
}

function rules(...list: Rule[]): Map<string, Rule> {
  return new Map(list.map((r) => [r.ruleHash, r]));
}

function events(rows: Row[], ruleMap: Map<string, Rule>, briefs: BriefRow[] = [], corrections: CorrectionRow[] = []): PolicyEvent[] {
  return buildEvents(rows.map(toAssessment), ruleMap, briefs, corrections);
}

function only(list: PolicyEvent[]): PolicyEvent {
  assert.equal(list.length, 1, `expected one event, got ${list.length}: ${list.map((e) => e.eventId).join(', ')}`);
  return list[0];
}

// Two full runs of RULE_A for C-1 and C-2. Run 2 is a replay five days later.
const TWO_RUNS = [
  row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z'),
  row(RUN_A1, RULE_A, 'C-2', '2026-09-20T10:01:05.000Z', { isAffected: false }),
  row(RUN_A2, RULE_A, 'C-1', '2026-09-25T10:01:00.000Z'),
  row(RUN_A2, RULE_A, 'C-2', '2026-09-25T10:01:05.000Z', { isAffected: false }),
];

describe('grouping by rule', () => {
  it('folds two runs of the same rule into one event keyed by ruleHash', () => {
    const e = only(events(TWO_RUNS, rules(rule(RULE_A))));
    assert.equal(e.eventId, RULE_A);
    assert.equal(e.ruleHash, RULE_A);
    assert.equal(e.runs, 2);
  });

  it('counts each client once, from the latest run', () => {
    const e = only(events(TWO_RUNS, rules(rule(RULE_A))));
    assert.equal(e.assessedCount, 2);
    assert.equal(e.affectedCount, 1);
    assert.equal(e.signedCount, 2);
    assert.equal(e.awaitingBrief, 1);
    assert.equal(e.status, 'action-required');
  });

  it('keeps earlier runs as per-client history in the impacts view', () => {
    const clients = buildEventImpacts(TWO_RUNS, [], [], new Map());
    assert.equal(clients.length, 2);
    for (const c of clients) {
      assert.equal(c.assessmentCount, 2);
      assert.equal(c.priorAssessments.length, 1);
      assert.equal(c.priorAssessments[0].policyEventId, RUN_A1);
      assert.ok(c.assessmentKey.startsWith(`${RUN_A2}#`), `current should be run 2, got ${c.assessmentKey}`);
    }
  });

  it('keeps detectedAt and ref stable when a replay lands', () => {
    const before = only(events(TWO_RUNS.slice(0, 2), rules(rule(RULE_A))));
    const after = only(events(TWO_RUNS, rules(rule(RULE_A))));
    assert.equal(after.detectedAt, before.detectedAt);
    assert.equal(after.ref, before.ref);
    assert.equal(after.detectedAt, '2026-09-20T09:59:00.000Z');
    assert.equal(after.ref, 'EE-20260920-A1B2');
  });

  it('picks the latest run by timestamp even when rows arrive out of order', () => {
    const shuffled = [TWO_RUNS[2], TWO_RUNS[0], TWO_RUNS[3], TWO_RUNS[1]];
    const clients = buildEventImpacts(shuffled, [], [], new Map());
    assert.deepEqual(
      clients.map((c) => c.assessmentKey).sort(),
      [`${RUN_A2}#C-1`, `${RUN_A2}#C-2`],
    );
  });

  it('takes origin from the first run, so a later Recall replay does not relabel a Sentinel event', () => {
    const rows = [...TWO_RUNS, row(RECALL_A, RULE_A, 'C-1', '2026-09-27T00:00:00.000Z')];
    const e = only(events(rows, rules(rule(RULE_A))));
    assert.equal(e.origin, 'sentinel');
    assert.equal(e.runs, 3);
  });

  it('keeps two different rules detected on the same day as two events', () => {
    const rows = [
      row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z'),
      row(`${Date.parse('2026-09-20T11:00:00.000Z')}-${RULE_B.slice(0, 8)}`, RULE_B, 'C-1', '2026-09-20T11:01:00.000Z', { topic: 'pgwp-length' }),
    ];
    const list = events(rows, rules(rule(RULE_A), rule(RULE_B, { topic: 'pgwp-length', policyDomain: 'pgwp', capturedAt: '2026-09-20T10:59:00.000Z' })));
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((e) => e.eventId), [RULE_B, RULE_A]);
    assert.notEqual(list[0].ref, list[1].ref);
    assert.deepEqual(list.map((e) => e.title), ['PGWP length', 'CRS scorecard']);
  });

  it('keeps a row with no ruleHash as its own event under its policyEventId', () => {
    const rows = [...TWO_RUNS, row('legacy-run', '', 'C-9', '2026-09-21T00:00:00.000Z')];
    const list = events(rows, rules(rule(RULE_A)));
    assert.equal(list.length, 2);
    assert.ok(list.some((e) => e.eventId === 'legacy-run' && e.assessedCount === 1));
  });
});

describe('verdict changes between runs', () => {
  it('reflects a flip from affected to not affected', () => {
    const rows = [
      row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z', { isAffected: true }),
      row(RUN_A2, RULE_A, 'C-1', '2026-09-25T10:01:00.000Z', { isAffected: false }),
    ];
    const e = only(events(rows, rules(rule(RULE_A))));
    assert.equal(e.affectedCount, 0);
    assert.equal(e.status, 'no-impact');
    const [c] = buildEventImpacts(rows, [], [], new Map());
    assert.equal(c.isAffected, false);
    assert.equal(c.priorAssessments[0].isAffected, true);
  });

  it('reflects a flip from not affected to affected', () => {
    const rows = [
      row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z', { isAffected: false }),
      row(RUN_A2, RULE_A, 'C-1', '2026-09-25T10:01:00.000Z', { isAffected: true }),
    ];
    const e = only(events(rows, rules(rule(RULE_A))));
    assert.equal(e.affectedCount, 1);
    assert.equal(e.status, 'action-required');
  });
});

describe('partial replay', () => {
  // Run 1 covers C-1, C-2, C-3. The replay only re-assesses C-2, and flips it.
  const rows = [
    row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z'),
    row(RUN_A1, RULE_A, 'C-2', '2026-09-20T10:01:01.000Z'),
    row(RUN_A1, RULE_A, 'C-3', '2026-09-20T10:01:02.000Z', { isAffected: false }),
    row(RUN_A2, RULE_A, 'C-2', '2026-09-25T10:01:00.000Z', { isAffected: false }),
  ];

  it('keeps clients the replay skipped, on their only assessment', () => {
    const e = only(events(rows, rules(rule(RULE_A))));
    assert.equal(e.assessedCount, 3);
    assert.equal(e.affectedCount, 1);
    assert.equal(e.runs, 2);
  });

  it('gives only the re-assessed client a history', () => {
    const byClient = new Map(buildEventImpacts(rows, [], [], new Map()).map((c) => [c.clientId, c]));
    assert.equal(byClient.get('C-1')?.assessmentCount, 1);
    assert.equal(byClient.get('C-2')?.assessmentCount, 2);
    assert.equal(byClient.get('C-2')?.assessmentKey, `${RUN_A2}#C-2`);
    assert.equal(byClient.get('C-3')?.assessmentCount, 1);
    assert.equal(byClient.get('C-1')?.assessmentKey, `${RUN_A1}#C-1`);
  });
});

describe('briefs across runs', () => {
  const affectedTwice = [
    row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z'),
    row(RUN_A2, RULE_A, 'C-1', '2026-09-25T10:01:00.000Z'),
  ];
  const OLD = `${RUN_A1}#C-1`;
  const NEW = `${RUN_A2}#C-1`;

  it('treats a brief sent on the old assessment as covering the client', () => {
    const e = only(events(affectedTwice, rules(rule(RULE_A)), [brief(OLD, 'sent')]));
    assert.equal(e.briefsSent, 1);
    assert.equal(e.briefsUnsent, 0);
    assert.equal(e.awaitingBrief, 0);
    assert.equal(e.status, 'done');
    const [c] = buildEventImpacts(affectedTwice, [brief(OLD, 'sent')], [], new Map());
    assert.equal(c.brief?.status, 'sent');
    assert.equal(c.brief?.assessmentKey, OLD);
  });

  it('treats a brief sent on the new assessment as covering the client', () => {
    const e = only(events(affectedTwice, rules(rule(RULE_A)), [brief(NEW, 'sent')]));
    assert.equal(e.briefsSent, 1);
    assert.equal(e.status, 'done');
  });

  it('counts a client once when both runs have a sent brief', () => {
    const e = only(events(affectedTwice, rules(rule(RULE_A)), [brief(OLD, 'sent'), brief(NEW, 'sent')]));
    assert.equal(e.briefsSent, 1);
  });

  it('ignores a draft left on a superseded assessment', () => {
    const e = only(events(affectedTwice, rules(rule(RULE_A)), [brief(OLD, 'draft')]));
    assert.equal(e.briefsUnsent, 0);
    assert.equal(e.awaitingBrief, 1);
    assert.equal(e.status, 'action-required');
    const [c] = buildEventImpacts(affectedTwice, [brief(OLD, 'draft')], [], new Map());
    assert.equal(c.brief, null);
  });

  it('counts a draft on the current assessment as unsent', () => {
    const e = only(events(affectedTwice, rules(rule(RULE_A)), [brief(NEW, 'draft')]));
    assert.equal(e.briefsUnsent, 1);
    assert.equal(e.briefsSent, 0);
    assert.equal(e.status, 'action-required');
  });

  it('does not count a new draft as unsent once an old brief went out', () => {
    const e = only(events(affectedTwice, rules(rule(RULE_A)), [brief(OLD, 'sent'), brief(NEW, 'draft')]));
    assert.equal(e.briefsSent, 1);
    assert.equal(e.briefsUnsent, 0);
    assert.equal(e.status, 'done');
    const [c] = buildEventImpacts(affectedTwice, [brief(OLD, 'sent'), brief(NEW, 'draft')], [], new Map());
    assert.equal(c.brief?.status, 'sent');
  });

  it('treats a brief the consultant copied out as covering the client', () => {
    const e = only(events(affectedTwice, rules(rule(RULE_A)), [brief(NEW, 'sent-externally')]));
    assert.equal(e.awaitingBrief, 0);
    assert.equal(e.status, 'done');
    const [c] = buildEventImpacts(affectedTwice, [brief(OLD, 'draft'), brief(NEW, 'sent-externally')], [], new Map());
    assert.equal(c.brief?.status, 'sent-externally');
  });

  it('does not let a brief on another rule cover this one', () => {
    const other = row(`${Date.parse('2026-09-21T00:00:00.000Z')}-${RULE_B.slice(0, 8)}`, RULE_B, 'C-1', '2026-09-21T00:01:00.000Z');
    const list = events([...affectedTwice, other], rules(rule(RULE_A), rule(RULE_B)), [brief(String(other.assessmentKey), 'sent')]);
    const a = list.find((e) => e.eventId === RULE_A);
    assert.equal(a?.briefsSent, 0);
    assert.equal(a?.status, 'action-required');
  });
});

describe('corrections across runs', () => {
  const rows = [
    row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z'),
    row(RUN_A2, RULE_A, 'C-1', '2026-09-25T10:01:00.000Z'),
  ];

  it('keeps a correction on the old assessment in the event count and in that run of history', () => {
    const cs = [correction(`${RUN_A1}#C-1`)];
    assert.equal(only(events(rows, rules(rule(RULE_A)), [], cs)).correctionsFiled, 1);
    const [c] = buildEventImpacts(rows, [], cs, new Map());
    assert.equal(c.correctionsFiled, 0);
    assert.equal(c.priorAssessments[0].correctionsFiled, 1);
  });

  it('attaches a correction on the new assessment to the current row', () => {
    const cs = [correction(`${RUN_A2}#C-1`)];
    assert.equal(only(events(rows, rules(rule(RULE_A)), [], cs)).correctionsFiled, 1);
    const [c] = buildEventImpacts(rows, [], cs, new Map());
    assert.equal(c.correctionsFiled, 1);
    assert.equal(c.priorAssessments[0].correctionsFiled, 0);
  });

  it('adds corrections on both runs without inflating on replay', () => {
    const cs = [correction(`${RUN_A1}#C-1`), correction(`${RUN_A2}#C-1`, '2026-09-26T00:00:00.000Z')];
    const e = only(events(rows, rules(rule(RULE_A)), [], cs));
    assert.equal(e.correctionsFiled, 2);
    assert.equal(e.lastActivityAt, '2026-09-26T00:00:00.000Z');
  });
});

describe('missing data', () => {
  it('handles a missing rule row with nulls and a detection time from the first run', () => {
    const e = only(events(TWO_RUNS, new Map()));
    assert.equal(e.policyDomain, null);
    assert.equal(e.severity, null);
    assert.equal(e.summary, null);
    assert.equal(e.sourceUrl, null);
    assert.equal(e.category, null);
    assert.equal(e.title, 'CRS scorecard');
    assert.equal(e.detectedAt, '2026-09-20T10:00:00.000Z');
    assert.equal(e.ref, 'GEN-20260920-A1B2');
  });

  it('marks an event with no affected client as no-impact', () => {
    const rows = TWO_RUNS.map((r) => ({ ...r, isAffected: false }));
    const e = only(events(rows, rules(rule(RULE_A))));
    assert.equal(e.affectedCount, 0);
    assert.equal(e.awaitingBrief, 0);
    assert.equal(e.status, 'no-impact');
  });

  it('counts only current assessments that carry both a hash and an algorithm as signed', () => {
    const rows = [
      row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z'),
      row(RUN_A2, RULE_A, 'C-1', '2026-09-25T10:01:00.000Z', { signatureAlgorithm: undefined }),
    ];
    assert.equal(only(events(rows, rules(rule(RULE_A)))).signedCount, 0);
  });
});

describe('ordering and limits', () => {
  function manyEvents(n: number): PolicyEvent[] {
    const rows: Row[] = [];
    const ruleList: Rule[] = [];
    for (let i = 0; i < n; i += 1) {
      const hash = i.toString(16).padStart(8, '0').padEnd(64, 'f');
      const day = new Date(Date.UTC(2026, 8, 28) - i * 3_600_000).toISOString();
      rows.push(row(`run-${i}`, hash, 'C-1', day, { isAffected: i % 2 === 0 }));
      ruleList.push(rule(hash, { capturedAt: day, policyDomain: i % 3 === 0 ? 'pgwp' : 'express-entry' }));
    }
    return events(rows, rules(...ruleList));
  }

  it('sorts newest first and breaks detectedAt ties on eventId', () => {
    const list = manyEvents(5);
    for (let i = 1; i < list.length; i += 1) assert.ok(list[i - 1].detectedAt >= list[i].detectedAt);
    const tie = events(
      [row('run-x', RULE_B, 'C-1', '2026-09-20T00:00:00.000Z'), row('run-y', RULE_A, 'C-1', '2026-09-20T00:00:00.000Z')],
      rules(rule(RULE_A, { capturedAt: '2026-09-20T00:00:00.000Z' }), rule(RULE_B, { capturedAt: '2026-09-20T00:00:00.000Z' })),
    );
    assert.deepEqual(tie.map((e) => e.eventId), [RULE_A, RULE_B]);
  });

  it('applies the default, explicit and maximum limits', () => {
    const all = manyEvents(250);
    const now = new Date('2026-09-28T12:00:00.000Z');
    assert.equal(listView(all, {}, now).events.length, 50);
    assert.equal(listView(all, { limit: '3' }, now).events.length, 3);
    assert.equal(listView(all, { limit: '999' }, now).events.length, 200);
    assert.equal(listView(all, { limit: '0' }, now).events.length, 50);
    assert.equal(listView(all, { limit: 'abc' }, now).events.length, 50);
  });

  it('computes totals over every event, ignoring filters and limit', () => {
    const all = manyEvents(10);
    const now = new Date('2026-09-28T12:00:00.000Z');
    const view = listView(all, { status: 'done', domain: 'pgwp', limit: '1' }, now);
    assert.equal(view.totals.actionRequired, 5);
    assert.equal(view.totals.detectedThisMonth, 10);
    assert.equal(view.events.length, 0, 'no pgwp event is done, every event is action-required or no-impact');
    const pgwp = listView(all, { domain: 'pgwp' }, now);
    assert.deepEqual(pgwp.events.map((e) => e.policyDomain), ['pgwp', 'pgwp', 'pgwp', 'pgwp']);
  });

  it('does not count replays toward the event totals', () => {
    const rows = [...TWO_RUNS, row(RECALL_A, RULE_A, 'C-1', '2026-09-26T00:00:00.000Z')];
    const view = listView(events(rows, rules(rule(RULE_A))), {}, new Date('2026-09-28T00:00:00.000Z'));
    assert.equal(view.events.length, 1);
    assert.equal(view.totals.actionRequired, 1);
    assert.equal(view.totals.detectedThisMonth, 1);
  });
});

describe('event id resolution', () => {
  const keyed = TWO_RUNS.map(toAssessment);

  it('accepts the rule-level id as is', () => {
    assert.equal(resolveEventId(keyed, RULE_A), RULE_A);
  });

  it('maps an old policyEventId from either run to the rule', () => {
    assert.equal(resolveEventId(keyed, RUN_A1), RULE_A);
    assert.equal(resolveEventId(keyed, RUN_A2), RULE_A);
  });

  it('returns null for an id no row carries', () => {
    assert.equal(resolveEventId(keyed, 'nope'), null);
    assert.equal(resolveEventId(keyed, ''), null);
    assert.equal(resolveEventId(keyed, RULE_A.slice(0, 8)), null);
  });

  it('serves every run of the rule when an old run id is used', () => {
    const id = resolveEventId(keyed, RUN_A1);
    const selected = TWO_RUNS.filter((r) => eventIdOf({ ruleHash: String(r.ruleHash), policyEventId: String(r.policyEventId) }) === id);
    assert.equal(selected.length, 4);
    const clients = buildEventImpacts(selected, [], [], new Map());
    assert.deepEqual(clients.map((c) => c.assessmentCount), [2, 2]);
  });
});

describe('activity feed', () => {
  const rows = TWO_RUNS.map(toAssessment);
  const bs = [brief(`${RUN_A1}#C-1`, 'sent', { sentAt: '2026-09-21T00:00:00.000Z' })];
  const cs = [correction(`${RUN_A1}#C-2`)];
  const alerts: Row[] = [{ timestamp: '2026-09-21T00:00:01.000Z', briefId: bs[0].briefId, clientId: 'C-1', channel: 'email' }];

  it('keeps every assessment, replays included, and tags each item with the rule-level event', () => {
    const { items } = buildActivity(rows, bs, cs, alerts, { limit: 100, before: null });
    assert.equal(items.filter((i) => i.kind === 'assessment-signed').length, 4);
    assert.equal(items.length, 7);
    for (const i of items) assert.equal(i.eventId, RULE_A, `${i.id} should belong to ${RULE_A}`);
  });

  it("offers a sent brief's receipt fingerprint and leaves copied briefs out of the alert rows", () => {
    const hash = 'b'.repeat(64);
    const sent = [brief(`${RUN_A1}#C-1`, 'sent', { sentAt: '2026-09-21T00:00:00.000Z', sentBodyHash: hash })];
    const copyRow: Row = { timestamp: '2026-09-21T00:00:02.000Z', briefId: 'x', clientId: 'C-2', channel: 'consultant-copy' };
    const { items } = buildActivity(rows, sent, [], [copyRow], { limit: 100, before: null });
    assert.equal(items.find((i) => i.kind === 'brief-sent')?.fingerprint, hash);
    assert.equal(items.filter((i) => i.kind === 'alert-emailed').length, 0);
  });

  it('pages newest first with nextBefore', () => {
    const first = buildActivity(rows, bs, cs, alerts, { limit: 3, before: null });
    assert.equal(first.items.length, 3);
    assert.equal(first.items[0].at, '2026-09-25T10:01:05.000Z');
    assert.ok(first.nextBefore);
    assert.deepEqual(parseActivityBefore(first.nextBefore), { at: first.items[2].at, id: first.items[2].id });
    const seen = pageAll(rows, bs, cs, alerts, 3);
    assert.equal(seen.length, 7);
    assert.equal(new Set(seen).size, 7);
  });
});

// Walks /activity the way a client does: pass nextBefore back as before.
function pageAll(rows: Assessment[], bs: BriefRow[], cs: CorrectionRow[], alerts: Row[], limit: number): string[] {
  const seen: string[] = [];
  let before: string | null = null;
  for (let page = 0; page < 1000; page += 1) {
    const cursor = before === null ? null : parseActivityBefore(before);
    if (before !== null) assert.ok(cursor, `nextBefore ${before} must parse`);
    const res = buildActivity(rows, bs, cs, alerts, { limit, before: cursor });
    assert.ok(res.items.length <= limit);
    seen.push(...res.items.map((i) => i.id));
    if (!res.nextBefore) return seen;
    before = res.nextBefore;
  }
  throw new Error('pagination did not terminate');
}

describe('activity pagination across identical timestamps', () => {
  const SAME = '2026-09-25T10:00:00.000Z';
  // 25 assessments from one run all signed in the same millisecond, which is
  // what a Sentinel fan-out across a tenant's clients looks like.
  const sameRun = Array.from({ length: 25 }, (_, i) =>
    toAssessment(row(RUN_A2, RULE_A, `C-${String(i).padStart(2, '0')}`, SAME)),
  );

  it('returns every item exactly once, in feed order, for every page size', () => {
    const all = buildActivity(sameRun, [], [], [], { limit: 1000, before: null }).items.map((i) => i.id);
    assert.equal(all.length, 25);
    for (const limit of [1, 2, 3, 4, 7, 24, 25, 26]) {
      const seen = pageAll(sameRun, [], [], [], limit);
      assert.deepEqual(seen, all, `limit ${limit}`);
    }
  });

  it('keeps ties intact when every kind shares the boundary timestamp', () => {
    const mixedRows = [
      ...sameRun,
      toAssessment(row(RUN_A1, RULE_A, 'C-older', '2026-09-20T10:00:00.000Z')),
      toAssessment(row(RUN_A1, RULE_A, 'C-newer', '2026-09-26T10:00:00.000Z')),
    ];
    const mixedBriefs = Array.from({ length: 5 }, (_, i) => brief(`${RUN_A2}#C-${String(i).padStart(2, '0')}`, 'sent', { sentAt: SAME }));
    const mixedCorrections = Array.from({ length: 5 }, (_, i) => correction(`${RUN_A2}#C-${String(i + 5).padStart(2, '0')}`, SAME));
    const mixedAlerts: Row[] = [{ timestamp: SAME, briefId: mixedBriefs[0].briefId, clientId: 'C-00', channel: 'email' }];
    const all = buildActivity(mixedRows, mixedBriefs, mixedCorrections, mixedAlerts, { limit: 1000, before: null }).items.map((i) => i.id);
    assert.equal(all.length, 38);
    assert.equal(new Set(all).size, 38);
    for (let limit = 1; limit <= 40; limit += 1) {
      assert.deepEqual(pageAll(mixedRows, mixedBriefs, mixedCorrections, mixedAlerts, limit), all, `limit ${limit}`);
    }
  });

  it('still honours a legacy before=ISO as strictly older than that instant', () => {
    const mixed = [...sameRun, toAssessment(row(RUN_A1, RULE_A, 'C-older', '2026-09-20T10:00:00.000Z'))];
    const res = buildActivity(mixed, [], [], [], { limit: 100, before: parseActivityBefore(SAME) });
    assert.deepEqual(res.items.map((i) => i.clientId), ['C-older']);
    assert.equal(res.nextBefore, null);
  });

  it('rejects a malformed before', () => {
    assert.equal(parseActivityBefore('not-a-date'), null);
    assert.equal(parseActivityBefore('c1.'), null);
    assert.equal(parseActivityBefore('c1.!!!'), null);
    assert.equal(parseActivityBefore(`c1.${Buffer.from('["only-one"]').toString('base64url')}`), null);
    assert.equal(parseActivityBefore(`c1.${Buffer.from('{"at":"x","id":"y"}').toString('base64url')}`), null);
  });
});

describe('origin', () => {
  it('reads each run id prefix', () => {
    assert.equal(originOf(RUN_A1), 'sentinel');
    assert.equal(originOf(RECALL_A), 'recall');
    assert.equal(originOf(`demo-${Date.parse('2026-09-29T10:00:00.000Z')}-${RULE_A.slice(0, 8)}`), 'demo');
  });

  it('labels an event first sent in by the demo trigger as demo', () => {
    const demo = `demo-${Date.parse('2026-09-19T10:00:00.000Z')}-${RULE_A.slice(0, 8)}`;
    const rows = [row(demo, RULE_A, 'C-1', '2026-09-19T10:01:00.000Z'), ...TWO_RUNS];
    assert.equal(only(events(rows, rules(rule(RULE_A)))).origin, 'demo');
  });
});

describe('humanizeTopic', () => {
  // Same labels as web/src/lib/humanize.test.ts, for every topic in the live
  // PolicyRules table on 2026-09-29. If one copy changes, both tests must.
  const live: Array<[string, string]> = [
    ['crs-scorecard-p5-test', 'CRS scorecard P5 test'],
    ['crs-scorecheck', 'CRS scorecheck'],
    ['ee-category-based-selection', 'EE category-based selection'],
    ['field-of-study-requirement', 'Field of study requirement'],
    ['ircc-newsroom', 'IRCC newsroom'],
    ['open-work-permit-eligibility', 'Open work permit eligibility'],
    ['pal-tal-requirements', 'PAL/TAL requirements'],
    ['pgp-program-pause', 'PGP program pause'],
    ['pnp-express-entry', 'PNP Express Entry'],
  ];
  for (const [topic, label] of live) {
    it(`${topic} reads "${label}"`, () => assert.equal(humanizeTopic(topic), label));
  }

  it('names the change the same way in the event title and the activity feed', () => {
    const rows = [row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z', { topic: 'pal-tal-requirements' })];
    assert.equal(only(events(rows, rules(rule(RULE_A, { topic: 'pal-tal-requirements' })))).title, 'PAL/TAL requirements');
    const { items } = buildActivity(rows.map(toAssessment), [], [], [], { limit: 10, before: null });
    assert.ok(items.some((i) => i.title === 'Assessment signed for PAL/TAL requirements'));
  });
});

// ADR-0004. A consultant review as impacts-service writes it: its own key,
// the original run's policyEventId, and recordKind consultant-review.
function review(of: Row, reviewedAt: string, extra: Row = {}): Row {
  const key = `review-${Date.parse(reviewedAt)}-${String(of.policyEventId)}#${String(of.clientId)}`;
  return {
    ...of,
    assessmentKey: key,
    recordKind: 'consultant-review',
    supersedes: of.assessmentKey,
    reviewedBy: 'R1',
    reviewedAt,
    timestamp: reviewedAt,
    canonicalHash: `hash-${key}`,
    auditorStance: undefined,
    ...extra,
  };
}

const stance = (s: string) => ({ auditorStance: { stance: s, reason: 'The profile meets the condition the rule sets.' } });

describe('current verdict with consultant reviews (ADR-0004)', () => {
  const agent = row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z', { isAffected: false });

  it('a review beats a newer agent replay of the same rule', () => {
    const rows = [
      agent,
      review(agent, '2026-09-22T09:00:00.000Z', { isAffected: true, impactType: 'eligibility-flip' }),
      row(RUN_A2, RULE_A, 'C-1', '2026-09-25T10:01:00.000Z', { isAffected: false }),
    ];
    const e = only(events(rows, rules(rule(RULE_A))));
    assert.equal(e.affectedCount, 1);
    assert.equal(e.consultantReviewed, 1);
    assert.equal(e.awaitingBrief, 1);
    assert.equal(e.status, 'action-required');
    assert.equal(e.runs, 2, 'a review is not a pipeline run');
    const [c] = buildEventImpacts(rows, [], [], new Map());
    assert.equal(c.recordKind, 'consultant-review');
    assert.equal(c.isAffected, true);
    assert.equal(c.supersedes, agent.assessmentKey);
    assert.equal(c.reviewedAt, '2026-09-22T09:00:00.000Z');
    assert.equal(c.actionReason, 'brief-needed');
    // History in time order, the newer agent replay first.
    assert.deepEqual(c.priorAssessments.map((p) => [p.policyEventId, p.recordKind]), [[RUN_A2, 'agent'], [RUN_A1, 'agent']]);
  });

  it('the newest review wins when there are several', () => {
    const first = review(agent, '2026-09-22T09:00:00.000Z', { isAffected: true });
    const second = review(first, '2026-09-23T09:00:00.000Z', { isAffected: false, supersedes: first.assessmentKey });
    // Input order must not matter.
    for (const rows of [[agent, first, second], [second, agent, first]]) {
      const [c] = buildEventImpacts(rows, [], [], new Map());
      assert.equal(c.assessmentKey, second.assessmentKey);
      assert.equal(c.isAffected, false);
      assert.equal(only(events(rows, rules(rule(RULE_A)))).status, 'no-impact');
    }
  });

  it('a flip to not affected stops the unsent draft on the agent row from counting', () => {
    const affected = row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z');
    const draft = brief(String(affected.assessmentKey), 'draft');
    const before = only(events([affected], rules(rule(RULE_A)), [draft]));
    assert.equal(before.briefsUnsent, 1);
    assert.equal(before.status, 'action-required');

    const rows = [affected, review(affected, '2026-09-22T09:00:00.000Z', { isAffected: false, impactType: 'none' })];
    const after = only(events(rows, rules(rule(RULE_A)), [draft]));
    assert.equal(after.briefsUnsent, 0);
    assert.equal(after.awaitingBrief, 0);
    assert.equal(after.status, 'no-impact');
    const [c] = buildEventImpacts(rows, [draft], [], new Map());
    assert.equal(c.brief, null, 'the draft belongs to a superseded verdict');
    assert.equal(c.actionRequired, false);
  });

  it('a flip to affected is done once the brief Composer drafted on the review is sent', () => {
    const r = review(agent, '2026-09-22T09:00:00.000Z', { isAffected: true, impactType: 'eligibility-flip' });
    const draft = brief(String(r.assessmentKey), 'draft');
    assert.equal(only(events([agent, r], rules(rule(RULE_A)), [draft])).briefsUnsent, 1);
    const sent = only(events([agent, r], rules(rule(RULE_A)), [brief(String(r.assessmentKey), 'sent')]));
    assert.equal(sent.briefsSent, 1);
    assert.equal(sent.status, 'done');
  });

  it('lists a review in the activity feed as a consultant review', () => {
    const r = review(agent, '2026-09-22T09:00:00.000Z', { isAffected: true });
    const { items } = buildActivity([agent, r].map(toAssessment), [], [], [], { limit: 10, before: null });
    assert.deepEqual(items.map((i) => i.kind), ['consultant-review-signed', 'assessment-signed']);
    assert.match(items[0].title, /^Consultant review signed for /);
  });
});

describe('Auditor disagreement as action required (ADR-0004)', () => {
  it('flags a not-affected verdict the Auditor disagrees with', () => {
    const rows = [row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z', { isAffected: false, ...stance('disagree') })];
    const e = only(events(rows, rules(rule(RULE_A))));
    assert.equal(e.affectedCount, 0);
    assert.equal(e.auditorDisagrees, 1);
    assert.equal(e.status, 'action-required');
    assert.equal(listView([e], {}, new Date('2026-09-29T00:00:00.000Z')).totals.actionRequired, 1);
    const [c] = buildEventImpacts(rows, [], [], new Map());
    assert.equal(c.actionRequired, true);
    assert.equal(c.actionReason, 'auditor-disagrees');
    assert.deepEqual(c.auditorStance, { stance: 'disagree', reason: 'The profile meets the condition the rule sets.' });
  });

  it('puts disagreement ahead of a missing brief, and keeps it after a brief was sent', () => {
    const rows = [row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z', stance('disagree'))];
    const [c] = buildEventImpacts(rows, [], [], new Map());
    assert.equal(c.actionReason, 'auditor-disagrees');
    const sent = [brief(String(rows[0].assessmentKey), 'sent')];
    assert.equal(only(events(rows, rules(rule(RULE_A)), sent)).status, 'action-required');
  });

  for (const s of ['agree', 'uncertain']) {
    it(`does not flag stance ${s}`, () => {
      const rows = [row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z', { isAffected: false, ...stance(s) })];
      const e = only(events(rows, rules(rule(RULE_A))));
      assert.equal(e.auditorDisagrees, 0);
      assert.equal(e.status, 'no-impact');
    });
  }

  it('a consultant review clears the disagreement', () => {
    const disputed = row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z', { isAffected: false, ...stance('disagree') });
    const rows = [disputed, review(disputed, '2026-09-22T09:00:00.000Z', { isAffected: false, impactType: 'none' })];
    const e = only(events(rows, rules(rule(RULE_A))));
    assert.equal(e.auditorDisagrees, 0);
    assert.equal(e.status, 'no-impact');
    const [c] = buildEventImpacts(rows, [], [], new Map());
    assert.equal(c.auditorStance, null);
    assert.equal(c.actionReason, null);
  });

  it('only the current run counts: a disagreement on an older run is history', () => {
    const rows = [
      row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z', { isAffected: false, ...stance('disagree') }),
      row(RUN_A2, RULE_A, 'C-1', '2026-09-25T10:01:00.000Z', { isAffected: false, ...stance('agree') }),
    ];
    assert.equal(only(events(rows, rules(rule(RULE_A)))).auditorDisagrees, 0);
  });

  it('reads a row signed before ADR-0004 as having no stance', () => {
    const a = toAssessment(row(RUN_A1, RULE_A, 'C-1', '2026-09-20T10:01:00.000Z'));
    assert.equal(a.auditorStance, null);
    assert.equal(a.recordKind, 'agent');
  });
});
