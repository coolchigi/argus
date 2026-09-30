import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  EMPTY_COUNTS,
  clientAssessments,
  clientBriefs,
  countsByClient,
  toAssessment,
  toBrief,
  type ClientAssessment,
  type ClientBrief,
  type ClientCounts,
  type Row,
} from './derive.ts';
import {
  DETAIL_FIELDS,
  FORBIDDEN_COLUMNS,
  LIST_FIELDS,
  MAX_BULK_ROWS,
  PROGRAMS,
  STATUSES,
  checkColumns,
  clientIdErrors,
  jsonToRow,
  normalizeColumn,
  pick,
  validatePatch,
  validateRow,
  type ValidProfile,
} from './validate.ts';

// Profiles service (Phase F). Routes, validation and the read model, with
// storage behind the Store interface so tests run against memory.
// handler.ts wires the DynamoDB store. Response shapes live in
// web/src/lib/types/profiles.ts.
//
// Data rules this file holds to:
// - Zero client PII. Nothing that identifies a person is accepted, and every
//   response is built from a whitelist (validate.ts LIST_FIELDS, DETAIL_FIELDS).
// - `notes` is never accepted and never returned.
// - `age` is accepted on write because the Analyst uses it for CRS, and never
//   returned, on the list or the detail view. currentCrsScore already gives
//   the consultant the CRS context. Age next to NOC, province, CIP code and
//   graduation date narrows a client down more than any other field would,
//   and it goes stale a year after import with nothing on screen saying so.
// - No hard deletes. DELETE /profiles/{id} is a soft close (status closed,
//   closedAt set). ADR-0002 counts the signed assessments that point at a
//   profile as client records kept 6 years past file closure, so closing is
//   the event that starts that clock. The Lambda role has no DeleteItem.
// - Creates never overwrite. Every put is conditional on the client not
//   existing. Changing an existing client takes a PATCH, or a bulk import
//   with `update: true`.

export interface Store {
  /** Every profile in the tenant, projected to `fields`. */
  listProfiles(rcicId: string, fields: readonly string[]): Promise<Row[]>;
  getProfile(rcicId: string, clientId: string, fields: readonly string[]): Promise<Row | null>;
  /** Conditional put. false when the client already exists. */
  createProfile(rcicId: string, item: Row): Promise<boolean>;
  /** Conditional update. null when the client doesn't exist. Returns the new item projected to `fields`. */
  updateProfile(rcicId: string, clientId: string, set: Row, remove: string[], fields: readonly string[]): Promise<Row | null>;
  listAssessments(rcicId: string): Promise<Row[]>;
  listBriefs(rcicId: string): Promise<Row[]>;
}

export type ClientSummary = Row & ClientCounts & { clientId: string };

export type BulkResult = {
  dryRun: boolean;
  created: number;
  updated: number;
  /** One entry per accepted row, in file order. */
  accepted: Array<{ row: number; clientId: string; action: 'create' | 'update' }>;
  rejected: Array<{ row: number; clientId: string | null; errors: string[] }>;
};

type Json = APIGatewayProxyStructuredResultV2;
type Log = (level: 'info' | 'error', msg: string, fields: Record<string, unknown>) => void;

const CONCURRENCY = 10;

export function createApp(store: Store, opts: { now?: () => Date; log?: Log } = {}) {
  const now = opts.now ?? (() => new Date());
  const log: Log = opts.log ?? ((level, msg, fields) => console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields })));

  async function listClients(rcicId: string, qs: Record<string, string | undefined>) {
    const status = qs.status ?? 'all';
    if (status !== 'all' && !(STATUSES as readonly string[]).includes(status)) throw httpError(400, 'invalid-status');
    if (qs.program && !(PROGRAMS as readonly string[]).includes(qs.program)) throw httpError(400, 'invalid-program');
    if (qs.needsAction !== undefined && qs.needsAction !== 'true' && qs.needsAction !== 'false') throw httpError(400, 'invalid-needs-action');

    const [profiles, assessments, briefs] = await Promise.all([
      store.listProfiles(rcicId, LIST_FIELDS),
      store.listAssessments(rcicId),
      store.listBriefs(rcicId),
    ]);
    const counts = countsByClient(assessments.map(toAssessment), briefs.map(toBrief));
    const all: ClientSummary[] = profiles.map((p) => {
      const clientId = str(p.clientId);
      return { ...pick(p, LIST_FIELDS), clientId, ...(counts.get(clientId) ?? EMPTY_COUNTS) };
    });
    all.sort((a, b) => b.actionRequired - a.actionRequired || a.clientId.localeCompare(b.clientId));

    const clients = all
      .filter((c) => status === 'all' || c.status === status)
      .filter((c) => !qs.program || c.program === qs.program)
      .filter((c) => qs.needsAction !== 'true' || c.actionRequired > 0);
    log('info', 'profiles-listed', { rcicId, total: all.length, returned: clients.length, assessments: assessments.length });
    return { clients, total: all.length };
  }

  async function getClient(rcicId: string, clientId: string): Promise<{ client: Row; assessments: ClientAssessment[]; briefs: ClientBrief[] }> {
    const profile = await store.getProfile(rcicId, clientId, DETAIL_FIELDS);
    if (!profile) throw httpError(404, 'client-not-found');
    const [assessments, briefs] = await Promise.all([store.listAssessments(rcicId), store.listBriefs(rcicId)]);
    const mine = assessments.map(toAssessment).filter((a) => a.clientId === clientId);
    const myBriefs = briefs.map(toBrief).filter((b) => b.clientId === clientId);
    return {
      client: pick(profile, DETAIL_FIELDS),
      assessments: clientAssessments(mine, myBriefs),
      briefs: clientBriefs(mine, myBriefs),
    };
  }

  function newItem(p: ValidProfile, at: string): Row {
    return {
      clientId: p.clientId,
      program: p.program,
      status: p.status,
      ...p.attributes,
      consentConfirmedAt: at,
      createdAt: at,
      updatedAt: at,
      ...(p.status === 'closed' ? { closedAt: at } : {}),
    };
  }

  async function createClient(rcicId: string, body: Row) {
    const forbidden = Object.keys(body).filter((k) => (FORBIDDEN_COLUMNS as readonly string[]).includes(normalizeColumn(k)));
    if (forbidden.length > 0) return json(400, { error: 'forbidden-column', columns: forbidden.map(normalizeColumn).sort() });
    const { row, unknown } = jsonToRow(body);
    if (unknown.length > 0) return json(400, { error: 'unknown-column', columns: unknown.sort() });
    const result = validateRow(row);
    if (!result.ok) return json(400, { error: 'invalid-fields', errors: result.errors });
    const created = await store.createProfile(rcicId, newItem(result.profile, now().toISOString()));
    if (!created) return json(409, { error: 'client-exists' });
    log('info', 'profile-created', { rcicId, clientId: result.profile.clientId });
    const saved = await store.getProfile(rcicId, result.profile.clientId, DETAIL_FIELDS);
    return json(201, { client: pick(saved ?? {}, DETAIL_FIELDS) });
  }

  async function bulk(rcicId: string, body: Row): Promise<Json> {
    const rows = body.rows;
    if (!Array.isArray(rows)) return json(400, { error: 'rows-must-be-an-array' });
    if (rows.length === 0) return json(400, { error: 'no-rows' });
    if (rows.length > MAX_BULK_ROWS) return json(400, { error: 'too-many-rows', max: MAX_BULK_ROWS, received: rows.length });
    if (!rows.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) return json(400, { error: 'rows-must-be-objects' });
    const dryRun = body.dryRun !== false;
    const allowUpdate = body.update === true;

    const columns = checkColumns(rows as Row[]);
    if (!columns.ok) {
      log('info', 'profiles-bulk-file-rejected', { rcicId, error: columns.error, columns: columns.columns });
      return json(400, { error: columns.error, columns: columns.columns });
    }

    const results = (rows as Row[]).map((r, i) => ({ row: i + 1, result: validateRow(r) }));

    // A client id that appears twice can't be resolved, so every copy is rejected.
    const seen = new Map<string, number>();
    for (const { result } of results) if (result.ok) seen.set(result.profile.clientId, (seen.get(result.profile.clientId) ?? 0) + 1);

    const existing = new Set((await store.listProfiles(rcicId, ['clientId'])).map((p) => str(p.clientId)));

    const out: BulkResult = { dryRun, created: 0, updated: 0, accepted: [], rejected: [] };
    const toCreate: Array<{ row: number; profile: ValidProfile }> = [];
    const toUpdate: Array<{ row: number; profile: ValidProfile }> = [];
    for (const { row, result } of results) {
      if (!result.ok) {
        out.rejected.push({ row, clientId: result.clientId, errors: result.errors });
        continue;
      }
      const id = result.profile.clientId;
      if ((seen.get(id) ?? 0) > 1) {
        out.rejected.push({ row, clientId: id, errors: ['duplicate-client-id-in-file'] });
      } else if (existing.has(id)) {
        if (allowUpdate) toUpdate.push({ row, profile: result.profile });
        else out.rejected.push({ row, clientId: id, errors: ['client-exists'] });
      } else {
        toCreate.push({ row, profile: result.profile });
      }
    }

    if (dryRun) {
      for (const c of toCreate) out.accepted.push({ row: c.row, clientId: c.profile.clientId, action: 'create' });
      for (const u of toUpdate) out.accepted.push({ row: u.row, clientId: u.profile.clientId, action: 'update' });
      out.created = toCreate.length;
      out.updated = toUpdate.length;
    } else {
      const at = now().toISOString();
      await runLimited(toCreate, CONCURRENCY, async ({ row, profile }) => {
        if (await store.createProfile(rcicId, newItem(profile, at))) {
          out.created += 1;
          out.accepted.push({ row, clientId: profile.clientId, action: 'create' });
        } else {
          // Someone created it between the existence read and this put.
          out.rejected.push({ row, clientId: profile.clientId, errors: ['client-exists'] });
        }
      });
      await runLimited(toUpdate, CONCURRENCY, async ({ row, profile }) => {
        const set: Row = { program: profile.program, status: profile.status, ...profile.attributes, consentConfirmedAt: at, updatedAt: at };
        if (profile.status === 'closed') set.closedAt = at;
        if (await store.updateProfile(rcicId, profile.clientId, set, [], ['clientId'])) {
          out.updated += 1;
          out.accepted.push({ row, clientId: profile.clientId, action: 'update' });
        } else {
          out.rejected.push({ row, clientId: profile.clientId, errors: ['client-not-found'] });
        }
      });
    }
    out.accepted.sort((a, b) => a.row - b.row);
    out.rejected.sort((a, b) => a.row - b.row);
    log('info', 'profiles-bulk', { rcicId, dryRun, rows: rows.length, created: out.created, updated: out.updated, rejected: out.rejected.length });
    return json(200, out);
  }

  async function patchClient(rcicId: string, clientId: string, body: Row): Promise<Json> {
    const v = validatePatch(body);
    if (!v.ok) return json(v.status, { error: v.error, ...(v.columns ? { columns: v.columns } : {}), ...(v.errors ? { errors: v.errors } : {}) });
    const at = now().toISOString();
    const set: Row = { ...v.set, updatedAt: at };
    const remove = [...v.remove];
    if (v.set.status === 'closed') set.closedAt = at;
    else if (typeof v.set.status === 'string') remove.push('closedAt');
    const updated = await store.updateProfile(rcicId, clientId, set, remove, DETAIL_FIELDS);
    if (!updated) return json(404, { error: 'client-not-found' });
    log('info', 'profile-updated', { rcicId, clientId, fields: [...Object.keys(v.set), ...v.remove] });
    return json(200, { client: pick(updated, DETAIL_FIELDS) });
  }

  async function closeClient(rcicId: string, clientId: string): Promise<Json> {
    const at = now().toISOString();
    const updated = await store.updateProfile(rcicId, clientId, { status: 'closed', closedAt: at, updatedAt: at }, [], DETAIL_FIELDS);
    if (!updated) return json(404, { error: 'client-not-found' });
    log('info', 'profile-closed', { rcicId, clientId });
    return json(200, { client: pick(updated, DETAIL_FIELDS) });
  }

  return async function handle(event: APIGatewayProxyEventV2): Promise<Json> {
    const method = event.requestContext.http.method;
    const routeKey = event.routeKey ?? `${method} ${event.rawPath}`;
    const rcicId = resolveRcicId(event);
    log('info', 'profiles-request', { routeKey, rcicId });
    try {
      if (!rcicId) throw httpError(403, 'missing-tenant-claim');
      if (routeKey === 'GET /profiles') return json(200, await listClients(rcicId, event.queryStringParameters ?? {}));
      if (routeKey === 'POST /profiles') return await createClient(rcicId, parseBody(event));
      if (routeKey === 'POST /profiles/bulk') return await bulk(rcicId, parseBody(event));

      const id = pathId(event);
      if (routeKey === 'GET /profiles/{id}') return json(200, await getClient(rcicId, id));
      if (routeKey === 'PATCH /profiles/{id}') return await patchClient(rcicId, id, parseBody(event));
      if (routeKey === 'DELETE /profiles/{id}') return await closeClient(rcicId, id);
      return json(404, { error: 'route-not-found', routeKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const httpStatus = (err as { httpStatus?: number }).httpStatus ?? 500;
      log(httpStatus >= 500 ? 'error' : 'info', 'profiles-request-failed', { routeKey, rcicId, error: message, httpStatus });
      return json(httpStatus, { error: httpStatus >= 500 ? 'internal-error' : message });
    }
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** No fallback tenant: a token without an rcic claim never reads another tenant's data. */
function resolveRcicId(event: APIGatewayProxyEventV2): string | null {
  const claims = (event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, string> } } }).authorizer?.jwt?.claims;
  const idClaim = claims?.['custom:rcic_id'];
  if (typeof idClaim === 'string' && idClaim.length > 0) return idClaim;
  const licenseClaim = claims?.['custom:rcic_license'];
  if (typeof licenseClaim === 'string' && licenseClaim.length > 0) return licenseClaim;
  return null;
}

/** A path id that fails the client id checks can't exist, and may be PII, so it never reaches a log or a query. */
function pathId(event: APIGatewayProxyEventV2): string {
  const raw = event.pathParameters?.id;
  if (typeof raw !== 'string' || raw.length === 0) throw httpError(400, 'missing-path-param-id');
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  if (clientIdErrors(id).length > 0) throw httpError(404, 'client-not-found');
  return id;
}

function parseBody(event: APIGatewayProxyEventV2): Row {
  if (!event.body) throw httpError(400, 'missing-body');
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw httpError(400, 'invalid-json');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw httpError(400, 'body-must-be-an-object');
  return parsed as Row;
}

async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function json(statusCode: number, body: unknown): Json {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function httpError(status: number, code: string): Error & { httpStatus?: number } {
  const err = new Error(code) as Error & { httpStatus?: number };
  err.httpStatus = status;
  return err;
}
