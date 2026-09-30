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
//
// ADR-0004 adds consultant reviews: signed rows (recordKind
// "consultant-review") a consultant wrote by correcting the verdict. A
// review beats every agent row for the same (rule, client), and the newest
// review wins among reviews. So a replay of the rule never undoes a
// consultant's verdict. Agent rows can carry the Auditor's stance on
// isAffected, and a current agent row the Auditor disagrees with needs the
// consultant's attention.

export type Severity = 'high' | 'medium' | 'low';
export type EventStatus = 'action-required' | 'done' | 'no-impact';
export type Row = Record<string, unknown>;

export type RecordKind = 'agent' | 'consultant-review';
export type Stance = 'agree' | 'disagree' | 'uncertain';
/**
 * contradicted is true only on an "uncertain" the Auditor's stance-check
 * produced, because the Auditor's reason argued the opposite of its stance.
 */
export type AuditorStance = { stance: Stance; reason: string; contradicted: boolean };

/**
 * Why a client needs the consultant. The Auditor's flags come first: settle
 * the verdict before briefing on it. auditor-unsure is a stance the Auditor
 * contradicted, so nobody knows which answer it meant.
 */
export type ActionReason = 'auditor-disagrees' | 'auditor-unsure' | 'brief-needed';

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
  recordKind: RecordKind;
  /** Agent rows signed after ADR-0004. null on older rows and on consultant reviews. */
  auditorStance: AuditorStance | null;
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
  /** The public receipt fingerprint of a brief Argus sent. */
  sentBodyHash?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/**
 * A brief is delivered once Argus sent it, or once the consultant copied it
 * into their own mail client (`sent-externally`). Either one clears the
 * action for that client.
 */
export function isDelivered(status: string): boolean {
  return status === 'sent' || status === 'sent-externally';
}

export type CorrectionRow = {
  correctionKey: string;
  assessmentKey: string;
  clientId: string;
  topic: string;
  correctedAt: string;
};

export type EventOrigin = 'sentinel' | 'recall' | 'demo';

/**
 * What sent a run into the pipeline, from its id. Recall replays are
 * `recall-...` and demo triggers `demo-${ms}-${hash8}` (services/demo). The
 * delta's demoOrigin flag never reaches an assessment row, so the id is it.
 */
export function originOf(policyEventId: string): EventOrigin {
  if (policyEventId.startsWith('recall-')) return 'recall';
  if (policyEventId.startsWith('demo-')) return 'demo';
  return 'sentinel';
}

export type PolicyEvent = {
  eventId: string;
  ref: string;
  /** From the first run's id: `recall-` is a Recall replay, `demo-` a demo trigger. */
  origin: EventOrigin;
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
  /** Clients whose current verdict is the agent's and the Auditor disagrees with it. */
  auditorDisagrees: number;
  /** Clients whose current verdict is the agent's and the Auditor contradicted its own stance. */
  auditorUnsure: number;
  /** Clients whose current verdict is a consultant review. */
  consultantReviewed: number;
  correctionsFiled: number;
  status: EventStatus;
  lastActivityAt: string;
};

export type ImpactBrief = { briefId: string; assessmentKey: string; status: string; sentAt: string | null };

export type PriorAssessment = {
  assessmentKey: string;
  recordKind: RecordKind;
  policyEventId: string;
  signedAt: string;
  isAffected: boolean;
  canonicalHash: string | null;
  correctionsFiled: number;
};

export type EventImpact = {
  clientId: string;
  assessmentKey: string;
  /** The current row's policyEventId. On a consultant review, the run it reviewed. Never parse it from the key. */
  policyEventId: string;
  /** 'consultant-review' when the consultant's signed verdict is current. */
  recordKind: RecordKind;
  /** On a consultant review, the assessment it replaced. */
  supersedes: string | null;
  /** On a consultant review, when it was signed. */
  reviewedAt: string | null;
  /** The Auditor's signed stance on the current agent verdict. null on reviews and older rows. */
  auditorStance: AuditorStance | null;
  actionRequired: boolean;
  actionReason: ActionReason | null;
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
  kind: 'assessment-signed' | 'consultant-review-signed' | 'brief-sent' | 'correction-filed' | 'alert-emailed';
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

// Display-only casing for kebab-case topic words. Not policy data. A copy of
// web/src/lib/humanize.ts, since services don't share code. The test pins the
// same labels as web/src/lib/humanize.test.ts, so keep both in step.
const ACRONYMS: Record<string, string> = {
  crs: 'CRS',
  ee: 'EE',
  ircc: 'IRCC',
  ita: 'ITA',
  lmia: 'LMIA',
  noc: 'NOC',
  teer: 'TEER',
  pgwp: 'PGWP',
  sowp: 'SOWP',
  pgp: 'PGP',
  pnp: 'PNP',
  cec: 'CEC',
  fsw: 'FSW',
  fst: 'FST',
  clb: 'CLB',
  nclc: 'NCLC',
  ielts: 'IELTS',
  tef: 'TEF',
  cicc: 'CICC',
  rcic: 'RCIC',
  gcms: 'GCMS',
  eta: 'eTA',
  trv: 'TRV',
  sds: 'SDS',
  pal: 'PAL',
  tal: 'TAL',
  dli: 'DLI',
  sin: 'SIN',
  pr: 'PR',
  eca: 'ECA',
  cip: 'CIP',
};

// Proper nouns keep their capitals inside a sentence-case label.
const PROPER: Record<string, string> = {
  express: 'Express',
  entry: 'Entry',
  french: 'French',
  canada: 'Canada',
  canadian: 'Canadian',
  quebec: 'Quebec',
  atlantic: 'Atlantic',
};

// Acronym pairs IRCC names as alternatives, written with a slash: the
// provincial or territorial attestation letter, and the English or French
// language benchmark.
const SLASH_PAIRS = new Set(['pal/tal', 'clb/nclc']);

// Words that close a compound modifier and keep the hyphen before them.
const COMPOUND_TAILS = new Set(['based', 'specific', 'related']);

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

type Ranked = { assessmentKey: string; timestamp: string; recordKind?: RecordKind };

/**
 * The current-verdict order (ADR-0004): consultant reviews before agent rows,
 * then newest first. Ties on timestamp break on assessmentKey so the pick is
 * stable. Rows without recordKind are agent rows.
 */
export function currentFirst(a: Ranked, b: Ranked): number {
  const review = (x: Ranked) => (x.recordKind === 'consultant-review' ? 1 : 0);
  return review(b) - review(a) || newestFirst(a, b);
}

function newestFirst(a: Ranked, b: Ranked): number {
  return b.timestamp.localeCompare(a.timestamp) || b.assessmentKey.localeCompare(a.assessmentKey);
}

/** Per client: the current verdict (see currentFirst), then the rest, newest first. */
export function splitCurrent<T extends { clientId: string } & Ranked>(list: T[]): ClientRuns<T>[] {
  const byClient = new Map<string, T[]>();
  for (const a of list) {
    const key = a.clientId || a.assessmentKey;
    const l = byClient.get(key) ?? [];
    l.push(a);
    byClient.set(key, l);
  }
  const out: ClientRuns<T>[] = [];
  for (const [clientId, runs] of byClient) {
    runs.sort(currentFirst);
    const [current, ...rest] = runs;
    // History reads in time order, whatever kind of record each one is.
    out.push({ clientId, current, prior: rest.sort(newestFirst) });
  }
  return out;
}

/**
 * What the consultant has to do for one client on one rule, from the current
 * verdict. A consultant review carries no Auditor stance, so reviewing a
 * disagreement clears it.
 */
export function actionReasonOf(
  current: { isAffected: boolean; recordKind: RecordKind; auditorStance: AuditorStance | null },
  briefSent: boolean,
): ActionReason | null {
  if (current.recordKind === 'agent' && current.auditorStance?.stance === 'disagree') return 'auditor-disagrees';
  if (current.recordKind === 'agent' && current.auditorStance?.contradicted) return 'auditor-unsure';
  if (current.isAffected && !briefSent) return 'brief-needed';
  return null;
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
    let auditorDisagrees = 0;
    let auditorUnsure = 0;
    let consultantReviewed = 0;
    let needsAction = 0;
    for (const { current, prior } of clients) {
      const sent = [current, ...prior].some((a) => (briefsByAssessment.get(a.assessmentKey) ?? []).some((b) => isDelivered(b.status)));
      if (sent) briefsSent += 1;
      else if ((briefsByAssessment.get(current.assessmentKey) ?? []).length > 0) briefsUnsent += 1;
      if (current.isAffected && !sent) awaitingBrief += 1;
      if (current.recordKind === 'consultant-review') consultantReviewed += 1;
      else if (current.auditorStance?.stance === 'disagree') auditorDisagrees += 1;
      else if (current.auditorStance?.contradicted) auditorUnsure += 1;
      if (actionReasonOf(current, sent)) needsAction += 1;
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
    const status: EventStatus = needsAction > 0 ? 'action-required' : affectedCount === 0 ? 'no-impact' : 'done';

    events.push({
      eventId,
      ref: refFor(eventId, rule?.policyDomain ?? null, detectedAt),
      origin: originOf(earliest.policyEventId),
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
      auditorDisagrees,
      auditorUnsure,
      consultantReviewed,
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

/**
 * "pal-tal-requirements" becomes "PAL/TAL requirements".
 * "ee-category-based-selection" becomes "EE category-based selection".
 */
export function humanizeTopic(topic: string): string {
  if (!topic) return 'Untitled policy change';
  const raw = topic.split(/[-_\s]+/).filter(Boolean).map((w) => w.toLowerCase());
  const words = raw.map((lower, i) => {
    if (ACRONYMS[lower]) return ACRONYMS[lower];
    if (PROPER[lower]) return PROPER[lower];
    if (/^p\d+$/.test(lower)) return lower.toUpperCase();
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return words.reduce((out, word, i) => {
    if (i === 0) return word;
    const sep = SLASH_PAIRS.has(`${raw[i - 1]}/${raw[i]}`) ? '/' : COMPOUND_TAILS.has(raw[i]) ? '-' : ' ';
    return out + sep + word;
  }, '');
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
    const bestSent = isDelivered(best.status);
    const nextSent = isDelivered(b.status);
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

  const withKeys = rows.map((r) => ({
    row: r,
    clientId: str(r.clientId),
    assessmentKey: str(r.assessmentKey),
    timestamp: str(r.timestamp),
    recordKind: recordKindOf(r),
  }));
  const clients = splitCurrent(withKeys).map(({ current, prior }) => {
    const r = current.row;
    const profile = profiles.get(current.clientId);
    const sentBrief = pickBrief([current, ...prior].flatMap((a) => (briefsByAssessment.get(a.assessmentKey) ?? []).filter((b) => isDelivered(b.status))));
    const brief = sentBrief ?? pickBrief(briefsByAssessment.get(current.assessmentKey) ?? []);
    const isReview = current.recordKind === 'consultant-review';
    const auditorStance = isReview ? null : stanceOf(r.auditorStance);
    const actionReason = actionReasonOf({ isAffected: r.isAffected === true, recordKind: current.recordKind, auditorStance }, sentBrief !== null);
    return {
      clientId: current.clientId,
      assessmentKey: current.assessmentKey,
      policyEventId: str(r.policyEventId),
      recordKind: current.recordKind,
      supersedes: isReview ? strOrNull(r.supersedes) : null,
      reviewedAt: isReview ? (strOrNull(r.reviewedAt) ?? current.timestamp) : null,
      auditorStance,
      actionRequired: actionReason !== null,
      actionReason,
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
        recordKind: p.recordKind,
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
  opts: { limit: number; before: ActivityCursor | null },
): { items: ActivityItem[]; nextBefore: string | null } {
  const eventByAssessment = new Map<string, string>();
  for (const a of assessments) eventByAssessment.set(a.assessmentKey, eventIdOf(a));

  const items: ActivityItem[] = [];

  for (const a of assessments) {
    if (!a.canonicalHash || !a.timestamp) continue;
    const kind = a.recordKind === 'consultant-review' ? 'consultant-review-signed' : 'assessment-signed';
    items.push({
      id: `${kind}:${a.assessmentKey}`,
      at: a.timestamp,
      kind,
      title: `${kind === 'consultant-review-signed' ? 'Consultant review signed' : 'Assessment signed'} for ${humanizeTopic(a.topic)}`,
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
      // The public receipt page finds a sent brief by this hash.
      fingerprint: b.sentBodyHash ?? null,
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
  // consultant-copy rows record a brief copied out by the consultant, which
  // isn't an email Argus sent.
  for (const al of alerts) {
    const at = str(al.timestamp);
    const briefId = str(al.briefId);
    const channel = str(al.channel);
    if (!at || channel === 'consultant-manual' || channel === 'consultant-copy') continue;
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

  const before = opts.before;
  const sorted = items
    .filter((i) => (before ? isAfterCursor(i, before) : true))
    .sort(compareActivity);
  const page = sorted.slice(0, opts.limit);
  const last = page[page.length - 1];
  const nextBefore = sorted.length > opts.limit && last ? encodeActivityCursor({ at: last.at, id: last.id }) : null;
  return { items: page, nextBefore };
}

/**
 * Where the next /activity page starts. `id` is null for a legacy `before=ISO`
 * request, which keeps its old meaning: everything strictly older than `at`.
 */
export type ActivityCursor = { at: string; id: string | null };

const CURSOR_PREFIX = 'c1.';

// Feed order: newest first, then id ascending. Item ids are unique per tenant
// (they carry the row's sort key), so (at, id) is a total order and a cursor
// on it never skips or repeats an item that shares a timestamp.
function compareActivity(a: { at: string; id: string }, b: { at: string; id: string }): number {
  return b.at.localeCompare(a.at) || a.id.localeCompare(b.id);
}

function isAfterCursor(item: { at: string; id: string }, c: ActivityCursor): boolean {
  if (c.id === null) return item.at < c.at;
  return compareActivity(item, { at: c.at, id: c.id }) > 0;
}

/** Opaque to clients. They pass nextBefore back as `before` unchanged. */
export function encodeActivityCursor(c: { at: string; id: string }): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify([c.at, c.id]), 'utf8').toString('base64url');
}

/**
 * Parses the `before` query param: a cursor minted by encodeActivityCursor, or
 * an ISO timestamp from an older client. Returns null for a malformed value.
 */
export function parseActivityBefore(raw: string): ActivityCursor | null {
  if (raw.startsWith(CURSOR_PREFIX)) {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(raw.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'));
      if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string' && parsed[0] && parsed[1]) {
        return { at: parsed[0], id: parsed[1] };
      }
    } catch {
      // fall through to null
    }
    return null;
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return { at: new Date(ms).toISOString(), id: null };
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
    recordKind: recordKindOf(r),
    auditorStance: recordKindOf(r) === 'consultant-review' ? null : stanceOf(r.auditorStance),
  };
}

/** Rows without recordKind were all written by Anchor. */
export function recordKindOf(r: Row): RecordKind {
  return r.recordKind === 'consultant-review' ? 'consultant-review' : 'agent';
}

/** The signed auditorStance map, or null when the row has none (signed before ADR-0004). */
export function stanceOf(v: unknown): AuditorStance | null {
  if (!v || typeof v !== 'object') return null;
  const { stance, reason, contradicted } = v as Row;
  if (stance !== 'agree' && stance !== 'disagree' && stance !== 'uncertain') return null;
  return { stance, reason: typeof reason === 'string' ? reason : '', contradicted: stance === 'uncertain' && contradicted === true };
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
