import { createHash } from 'node:crypto';

// Pure read-model logic for the policy events service. No AWS calls, so the
// tests in derive.test.ts run it against fixture rows.
//
// A policy event is one rule (ruleHash). Every pipeline run on that rule
// (Sentinel detection, Recall replay, test run) writes one ImpactAssessment
// per client, keyed `${policyEventId}#${clientId}`. Records are never deleted
// (ADR-0002), so one rule can carry several assessments per client:
// - the latest one by timestamp is the client's current assessment
// - the earlier ones are history
// Counts read the current assessment only, so a replay never double counts.

export type Severity = 'high' | 'medium' | 'low';
export type EventStatus = 'action-required' | 'done' | 'no-impact';
export type Row = Record<string, unknown>;

export type Assessment = {
  assessmentKey: string;
  policyEventId: string;
  ruleHash: string;
  clientId: string;
  topic: string;
  isAffected: boolean;
  timestamp: string;
  canonicalHash: string | null;
  signatureAlgorithm: string | null;
};

export type Rule = {
  ruleHash: string;
  summary: string | null;
  severity: Severity | null;
  category: string | null;
  policyDomain: string | null;
  topic: string | null;
  sourceUrl: string | null;
  sourceS3Key: string | null;
  sourceS3VersionId: string | null;
  capturedAt: string | null;
};

export type BriefRow = {
  briefId: string;
  assessmentKey: string;
  clientId: string;
  topic: string;
  status: string;
  sentAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CorrectionRow = {
  correctionKey: string;
  assessmentKey: string;
  clientId: string;
  topic: string;
  correctedAt: string;
};

export type PolicyEvent = {
  eventId: string;
  ref: string;
  origin: 'sentinel' | 'recall';
  ruleHash: string;
  topic: string;
  title: string;
  policyDomain: string | null;
  category: string | null;
  severity: Severity | null;
  summary: string | null;
  sourceUrl: string | null;
  detectedAt: string;
  runs: number;
  assessedCount: number;
  affectedCount: number;
  signedCount: number;
  briefsSent: number;
  briefsUnsent: number;
  awaitingBrief: number;
  correctionsFiled: number;
  status: EventStatus;
  lastActivityAt: string;
};

export type ImpactBrief = { briefId: string; assessmentKey: string; status: string; sentAt: string | null };

export type PriorAssessment = {
  assessmentKey: string;
  policyEventId: string;
  signedAt: string;
  isAffected: boolean;
  canonicalHash: string | null;
  correctionsFiled: number;
};

export type EventImpact = {
  clientId: string;
  assessmentKey: string;
  program: string | null;
  clientStatus: string | null;
  currentCrsScore: number | null;
  isAffected: boolean;
  impactType: string;
  numericDelta: number | null;
  confidence: string;
  recommendedAction: string;
  narrative: string;
  canonicalHash: string | null;
  signedAt: string;
  brief: ImpactBrief | null;
  correctionsFiled: number;
  assessmentCount: number;
  priorAssessments: PriorAssessment[];
};

export type ActivityItem = {
  id: string;
  at: string;
  kind: 'assessment-signed' | 'brief-sent' | 'correction-filed' | 'alert-emailed';
  title: string;
  ref: { kind: 'event' | 'assessment' | 'brief'; id: string };
  eventId: string | null;
  clientId: string | null;
  fingerprint: string | null;
};

export const EVENTS_DEFAULT_LIMIT = 50;
export const EVENTS_MAX_LIMIT = 200;
export const ACTIVITY_DEFAULT_LIMIT = 20;
export const ACTIVITY_MAX_LIMIT = 100;

// Display-only casing for kebab-case topic words. Not policy data.
const ACRONYMS = new Set(['crs', 'ee', 'pnp', 'lmia', 'noc', 'teer', 'clb', 'nclc', 'ircc', 'fsw', 'fst', 'cec', 'pgp', 'pgwp', 'pr', 'eca', 'cip', 'gcms']);

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * The event an assessment belongs to. Every assessment should carry a
 * ruleHash (ADR-0001). A row without one can't be merged with anything, so it
 * stands alone under its policyEventId instead of disappearing.
 */
export function eventIdOf(a: { ruleHash: string; policyEventId: string }): string {
  return a.ruleHash || a.policyEventId;
}

export function groupByEvent<T extends { ruleHash: string; policyEventId: string }>(assessments: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const a of assessments) {
    const id = eventIdOf(a);
    if (!id) continue;
    const list = out.get(id) ?? [];
    list.push(a);
    out.set(id, list);
  }
  return out;
}

/**
 * Accepts the rule-level eventId or, for links minted before events were
 * keyed by rule, an old policyEventId. Returns the rule-level eventId, or
 * null when nothing in the tenant matches.
 */
export function resolveEventId(assessments: Array<{ ruleHash: string; policyEventId: string }>, id: string): string | null {
  if (!id) return null;
  if (assessments.some((a) => eventIdOf(a) === id)) return id;
  const byRun = assessments.find((a) => a.policyEventId === id);
  return byRun ? eventIdOf(byRun) : null;
}

type ClientRuns<T> = { clientId: string; current: T; prior: T[] };

/** Newest first per client. Ties on timestamp break on assessmentKey so the pick is stable. */
export function splitCurrent<T extends { clientId: string; assessmentKey: string; timestamp: string }>(list: T[]): ClientRuns<T>[] {
  const byClient = new Map<string, T[]>();
  for (const a of list) {
    const key = a.clientId || a.assessmentKey;
    const l = byClient.get(key) ?? [];
    l.push(a);
    byClient.set(key, l);
  }
  const out: ClientRuns<T>[] = [];
  for (const [clientId, runs] of byClient) {
    runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.assessmentKey.localeCompare(a.assessmentKey));
    out.push({ clientId, current: runs[0], prior: runs.slice(1) });
  }
  return out;
}

function indexBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k) ?? [];
    list.push(item);
    out.set(k, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Brief and correction attachment:
 * - A client counts as briefed when any brief on any of their assessments of
 *   this rule was sent. The brief told the client about the rule change, and
 *   a replay of the same rule is not a new change to tell them about.
 * - An unsent brief counts only when it sits on the client's current
 *   assessment and the client has no sent brief. A draft on an older run was
 *   written against a verdict that has since been superseded.
 * - correctionsFiled counts every correction on any run of the rule. Each
 *   correction row is a distinct record that a replay never duplicates, and
 *   dropping it after a replay would hide it from the audit count.
 */
export function buildEvents(assessments: Assessment[], rules: Map<string, Rule>, briefs: BriefRow[], corrections: CorrectionRow[]): PolicyEvent[] {
  const briefsByAssessment = indexBy(briefs, (b) => b.assessmentKey);
  const correctionsByAssessment = indexBy(corrections, (c) => c.assessmentKey);

  const events: PolicyEvent[] = [];
  for (const [eventId, list] of groupByEvent(assessments)) {
    const earliest = [...list].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.assessmentKey.localeCompare(b.assessmentKey))[0];
    const rule = rules.get(earliest.ruleHash) ?? null;
    const topic = rule?.topic ?? earliest.topic;
    const detectedAt = detectedAtForRule(rule, list);
    const clients = splitCurrent(list);

    let briefsSent = 0;
    let briefsUnsent = 0;
    let awaitingBrief = 0;
    for (const { current, prior } of clients) {
      const sent = [current, ...prior].some((a) => (briefsByAssessment.get(a.assessmentKey) ?? []).some((b) => b.status === 'sent'));
      if (sent) briefsSent += 1;
      else if ((briefsByAssessment.get(current.assessmentKey) ?? []).length > 0) briefsUnsent += 1;
      if (current.isAffected && !sent) awaitingBrief += 1;
    }

    const activity: string[] = [];
    let correctionsFiled = 0;
    for (const a of list) {
      if (a.timestamp) activity.push(a.timestamp);
      for (const b of briefsByAssessment.get(a.assessmentKey) ?? []) {
        for (const t of [b.createdAt, b.updatedAt, b.sentAt]) if (t) activity.push(t);
      }
      for (const c of correctionsByAssessment.get(a.assessmentKey) ?? []) {
        correctionsFiled += 1;
        if (c.correctedAt) activity.push(c.correctedAt);
      }
    }

    const current = clients.map((c) => c.current);
    const affectedCount = current.filter((a) => a.isAffected).length;
    const status: EventStatus = affectedCount === 0 ? 'no-impact' : awaitingBrief > 0 ? 'action-required' : 'done';

    events.push({
      eventId,
      ref: refFor(eventId, rule?.policyDomain ?? null, detectedAt),
      origin: earliest.policyEventId.startsWith('recall-') ? 'recall' : 'sentinel',
      ruleHash: earliest.ruleHash,
      topic,
      title: humanizeTopic(topic),
      policyDomain: rule?.policyDomain ?? null,
      category: rule?.category ?? null,
      severity: rule?.severity ?? null,
      summary: rule?.summary ?? null,
      sourceUrl: rule?.sourceUrl ?? null,
      detectedAt,
      runs: new Set(list.map((a) => a.policyEventId)).size,
      assessedCount: current.length,
      affectedCount,
      signedCount: current.filter((a) => a.canonicalHash !== null && a.signatureAlgorithm !== null).length,
      briefsSent,
      briefsUnsent,
      awaitingBrief,
      correctionsFiled,
      status,
      lastActivityAt: activity.reduce((max, t) => (t > max ? t : max), detectedAt),
    });
  }

  events.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.eventId.localeCompare(b.eventId));
  return events;
}

export function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/** Filters and limit apply to `events`. `totals` always cover every event. */
export function listView(
  all: PolicyEvent[],
  qs: Record<string, string | undefined>,
  now: Date,
): { events: PolicyEvent[]; totals: { actionRequired: number; detectedThisMonth: number } } {
  const limit = parseLimit(qs.limit, EVENTS_DEFAULT_LIMIT, EVENTS_MAX_LIMIT);
  const monthPrefix = now.toISOString().slice(0, 7);
  return {
    events: all
      .filter((e) => (qs.status ? e.status === qs.status : true))
      .filter((e) => (qs.domain ? e.policyDomain === qs.domain : true))
      .slice(0, limit),
    totals: {
      actionRequired: all.filter((e) => e.status === 'action-required').length,
      detectedThisMonth: all.filter((e) => e.detectedAt.startsWith(monthPrefix)).length,
    },
  };
}

// Sentinel eventIds are `${Date.now()}-${ruleHash.slice(0, 8)}`. Anything else
// (Recall, test runs) falls back to the assessment's timestamp.
const SENTINEL_EVENT_ID = /^(\d{13})-([0-9a-f]{8})$/;

function runDetectedAt(policyEventId: string, assessmentAt: string): string {
  const m = SENTINEL_EVENT_ID.exec(policyEventId);
  if (m) {
    const d = new Date(Number(m[1]));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return assessmentAt;
}

/**
 * PolicyRules.captured_at is written once (Sentinel puts the row with
 * attribute_not_exists), so it stays put across replays. Without a rule row,
 * the earliest run's detection time stands in.
 */
function detectedAtForRule(rule: Rule | null, list: Assessment[]): string {
  if (rule?.capturedAt) return rule.capturedAt;
  return list.map((a) => runDetectedAt(a.policyEventId, a.timestamp)).filter(Boolean).reduce((min, t) => (t < min ? t : min));
}

// `${domainCode}-${YYYYMMDD}-${4 hash chars}`. A hex ruleHash supplies the
// hash chars directly. Anything else (test rules, rows without a ruleHash)
// is hashed first.
function refFor(eventId: string, policyDomain: string | null, detectedAt: string): string {
  const code = domainCode(policyDomain);
  const date = detectedAt.slice(0, 10).replace(/-/g, '');
  const hex = /^[0-9a-f]{4}/i.test(eventId) ? eventId : createHash('sha256').update(eventId).digest('hex');
  return `${code}-${date}-${hex.slice(0, 4).toUpperCase()}`;
}

function domainCode(policyDomain: string | null): string {
  if (!policyDomain) return 'GEN';
  const initials = policyDomain
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return initials || 'GEN';
}

export function humanizeTopic(topic: string): string {
  if (!topic) return 'Untitled policy change';
  const words = topic.split(/[-_\s]+/).filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Impacts
// ---------------------------------------------------------------------------

/** Sent beats unsent. Within the same state, the newest createdAt wins. */
function pickBrief(briefs: BriefRow[]): BriefRow | null {
  let best: BriefRow | null = null;
  for (const b of briefs) {
    if (!best) {
      best = b;
      continue;
    }
    const bestSent = best.status === 'sent';
    const nextSent = b.status === 'sent';
    if (nextSent && !bestSent) best = b;
    else if (nextSent === bestSent && (b.createdAt ?? '') > (best.createdAt ?? '')) best = b;
  }
  return best;
}

/**
 * One row per client: their current assessment, plus the earlier runs as
 * priorAssessments (newest first). `brief` follows the same rule as the event
 * counts: a sent brief from any run, else a brief on the current assessment.
 * `rows` must already be limited to one event.
 */
export function buildEventImpacts(rows: Row[], briefs: BriefRow[], corrections: CorrectionRow[], profiles: Map<string, Row>): EventImpact[] {
  const briefsByAssessment = indexBy(briefs, (b) => b.assessmentKey);
  const correctionCounts = new Map<string, number>();
  for (const c of corrections) correctionCounts.set(c.assessmentKey, (correctionCounts.get(c.assessmentKey) ?? 0) + 1);

  const withKeys = rows.map((r) => ({ row: r, clientId: str(r.clientId), assessmentKey: str(r.assessmentKey), timestamp: str(r.timestamp) }));
  const clients = splitCurrent(withKeys).map(({ current, prior }) => {
    const r = current.row;
    const profile = profiles.get(current.clientId);
    const sentBrief = pickBrief([current, ...prior].flatMap((a) => (briefsByAssessment.get(a.assessmentKey) ?? []).filter((b) => b.status === 'sent')));
    const brief = sentBrief ?? pickBrief(briefsByAssessment.get(current.assessmentKey) ?? []);
    return {
      clientId: current.clientId,
      assessmentKey: current.assessmentKey,
      program: profile ? strOrNull(profile.program) : null,
      clientStatus: profile ? strOrNull(profile.status) : null,
      currentCrsScore: profile ? numOrNull(profile.currentCrsScore) : null,
      isAffected: r.isAffected === true,
      impactType: str(r.impactType),
      numericDelta: numOrNull(r.numericDelta),
      confidence: str(r.confidence),
      recommendedAction: str(r.recommendedAction),
      narrative: str(r.narrative),
      canonicalHash: strOrNull(r.canonicalHash),
      signedAt: current.timestamp,
      brief: brief ? { briefId: brief.briefId, assessmentKey: brief.assessmentKey, status: brief.status, sentAt: brief.sentAt } : null,
      correctionsFiled: correctionCounts.get(current.assessmentKey) ?? 0,
      assessmentCount: prior.length + 1,
      priorAssessments: prior.map((p) => ({
        assessmentKey: p.assessmentKey,
        policyEventId: str(p.row.policyEventId),
        signedAt: p.timestamp,
        isAffected: p.row.isAffected === true,
        canonicalHash: strOrNull(p.row.canonicalHash),
        correctionsFiled: correctionCounts.get(p.assessmentKey) ?? 0,
      })),
    };
  });

  clients.sort((a, b) => Number(b.isAffected) - Number(a.isAffected) || a.clientId.localeCompare(b.clientId));
  return clients;
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/**
 * A history feed, so every assessment appears, replays included. Each item
 * carries the rule-level eventId it belongs to. `ref` keeps pointing at the
 * assessment or brief, which is the record the item is about.
 */
export function buildActivity(
  assessments: Assessment[],
  briefs: BriefRow[],
  corrections: CorrectionRow[],
  alerts: Row[],
  opts: { limit: number; before: string | null },
): { items: ActivityItem[]; nextBefore: string | null } {
  const eventByAssessment = new Map<string, string>();
  for (const a of assessments) eventByAssessment.set(a.assessmentKey, eventIdOf(a));

  const items: ActivityItem[] = [];

  for (const a of assessments) {
    if (!a.canonicalHash || !a.timestamp) continue;
    items.push({
      id: `assessment-signed:${a.assessmentKey}`,
      at: a.timestamp,
      kind: 'assessment-signed',
      title: `Assessment signed for ${humanizeTopic(a.topic)}`,
      ref: { kind: 'assessment', id: a.assessmentKey },
      eventId: eventIdOf(a) || null,
      clientId: a.clientId || null,
      fingerprint: a.canonicalHash,
    });
  }

  const briefById = new Map<string, BriefRow>();
  for (const b of briefs) {
    briefById.set(b.briefId, b);
    if (b.status !== 'sent' || !b.sentAt) continue;
    items.push({
      id: `brief-sent:${b.briefId}`,
      at: b.sentAt,
      kind: 'brief-sent',
      title: `Brief sent for ${humanizeTopic(b.topic)}`,
      ref: { kind: 'brief', id: b.briefId },
      eventId: eventByAssessment.get(b.assessmentKey) ?? null,
      clientId: b.clientId || null,
      // The sent-body hash can't be verified on the public receipt page yet
      // (PHASE8_PLAN B4), so it isn't offered as a fingerprint.
      fingerprint: null,
    });
  }

  for (const c of corrections) {
    if (!c.correctedAt) continue;
    items.push({
      id: `correction-filed:${c.correctionKey}`,
      at: c.correctedAt,
      kind: 'correction-filed',
      title: `Correction filed on ${humanizeTopic(c.topic)}`,
      ref: { kind: 'assessment', id: c.assessmentKey },
      eventId: eventByAssessment.get(c.assessmentKey) ?? null,
      clientId: c.clientId || null,
      fingerprint: null,
    });
  }

  // consultant-manual rows mirror a brief send, which is already listed above.
  for (const al of alerts) {
    const at = str(al.timestamp);
    const briefId = str(al.briefId);
    if (!at || str(al.channel) === 'consultant-manual') continue;
    const brief = briefById.get(briefId);
    const topic = brief?.topic ?? '';
    items.push({
      id: `alert-emailed:${at}`,
      at,
      kind: 'alert-emailed',
      title: topic ? `Alert emailed for ${humanizeTopic(topic)}` : 'Alert emailed',
      ref: { kind: 'brief', id: briefId },
      eventId: brief ? (eventByAssessment.get(brief.assessmentKey) ?? null) : null,
      clientId: strOrNull(al.clientId),
      fingerprint: null,
    });
  }

  const sorted = items
    .filter((i) => (opts.before ? i.at < opts.before : true))
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const page = sorted.slice(0, opts.limit);
  const nextBefore = sorted.length > opts.limit && page.length > 0 ? page[page.length - 1].at : null;
  return { items: page, nextBefore };
}

// ---------------------------------------------------------------------------
// Row coercion
// ---------------------------------------------------------------------------

export function toAssessment(r: Row): Assessment {
  return {
    assessmentKey: str(r.assessmentKey),
    policyEventId: str(r.policyEventId),
    ruleHash: str(r.ruleHash),
    clientId: str(r.clientId),
    topic: str(r.topic),
    isAffected: r.isAffected === true,
    timestamp: str(r.timestamp),
    canonicalHash: strOrNull(r.canonicalHash),
    signatureAlgorithm: strOrNull(r.signatureAlgorithm),
  };
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0 && Number.isFinite(Number(v))) return Number(v);
  return null;
}
