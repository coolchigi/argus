import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { asGuestView, isGuestRoute } from '../../shared/guest-view.ts';
import { asGuestConsultant, planWrites, toMeResponse, validatePatch, type Claims, type Row, type Signing } from './model.ts';

// GET /me and PATCH /me (Phase E). Routes and rules, with storage behind the
// Store interface so tests run against memory. handler.ts wires DynamoDB and
// KMS.
//
// PATCH is a read, merge, conditional write. The condition pins the row's
// updatedAt as read, so two saves racing from two tabs can't interleave and
// drop each other's preference changes. A lost race re-reads and re-merges.

export interface Store {
  getUser(rcicId: string): Promise<Row | null>;
  /**
   * Writes `set` and `remove` only if the row still exists and its updatedAt
   * still equals `expectedUpdatedAt` (null: the row has no updatedAt yet).
   * Returns the new row, or null when the condition failed.
   */
  updateUser(rcicId: string, set: Row, remove: string[], expectedUpdatedAt: string | null): Promise<Row | null>;
  /** Every profile in the tenant, closed ones included. */
  countClients(rcicId: string): Promise<number>;
  hasAssessments(rcicId: string): Promise<boolean>;
}

type Json = APIGatewayProxyStructuredResultV2;
type Log = (level: 'info' | 'error', msg: string, fields: Record<string, unknown>) => void;

const MAX_WRITE_ATTEMPTS = 3;

export function createApp(
  store: Store,
  signing: () => Promise<Signing | null>,
  opts: { now?: () => Date; log?: Log; guestRcicId?: string } = {},
) {
  const now = opts.now ?? (() => new Date());
  const log: Log = opts.log ?? ((level, msg, fields) => console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields })));

  async function respond(rcicId: string, claims: Claims, row: Row | null, guest = false): Promise<Json> {
    const [clientCount, hasAssessments, key] = await Promise.all([store.countClients(rcicId), store.hasAssessments(rcicId), signing()]);
    const me = toMeResponse({ rcicId, claims, row, signing: key, clientCount, hasAssessments });
    return json(200, guest ? asGuestConsultant(me) : me);
  }

  async function patch(rcicId: string, claims: Claims, body: Row): Promise<Json> {
    const v = validatePatch(body);
    if (!v.ok) return json(400, { error: v.error, ...(v.fields ? { fields: v.fields } : {}) });

    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      const row = await store.getUser(rcicId);
      if (!row) return json(404, { error: 'consultant-not-provisioned' });
      const { set, remove } = planWrites(row, v.plan, now().toISOString());
      const expected = typeof row.updatedAt === 'string' ? row.updatedAt : null;
      const updated = await store.updateUser(rcicId, set, remove, expected);
      if (updated) {
        log('info', 'me-updated', { rcicId, fields: [...Object.keys(set), ...remove].filter((f) => f !== 'updatedAt'), attempt });
        return respond(rcicId, claims, updated);
      }
      log('info', 'me-update-conflict', { rcicId, attempt });
    }
    return json(409, { error: 'concurrent-update' });
  }

  return async function handle(incoming: APIGatewayProxyEventV2): Promise<Json> {
    const guest = isGuestRoute(incoming);
    const event = asGuestView(incoming, opts.guestRcicId);
    const routeKey = event.routeKey ?? `${event.requestContext.http.method} ${event.rawPath}`;
    const claims = readClaims(event);
    const rcicId = resolveRcicId(claims);
    log('info', 'me-request', { routeKey, rcicId });
    try {
      if (!rcicId) return json(403, { error: 'missing-tenant-claim' });
      if (routeKey === 'GET /me') return await respond(rcicId, claims, await store.getUser(rcicId), guest);
      if (routeKey === 'PATCH /me') return await patch(rcicId, claims, parseBody(event));
      return json(404, { error: 'route-not-found', routeKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const httpStatus = (err as { httpStatus?: number }).httpStatus ?? 500;
      log(httpStatus >= 500 ? 'error' : 'info', 'me-request-failed', { routeKey, rcicId, error: message, httpStatus });
      return json(httpStatus, { error: httpStatus >= 500 ? 'internal-error' : message });
    }
  };
}

function readClaims(event: APIGatewayProxyEventV2): Claims {
  const claims = (event.requestContext as { authorizer?: { jwt?: { claims?: Claims } } }).authorizer?.jwt?.claims;
  return claims ?? {};
}

/** No fallback tenant: a token without an rcic claim never reads another tenant's row. */
function resolveRcicId(claims: Claims): string | null {
  const id = claims['custom:rcic_id'];
  if (typeof id === 'string' && id.length > 0) return id;
  const license = claims['custom:rcic_license'];
  if (typeof license === 'string' && license.length > 0) return license;
  return null;
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

function json(statusCode: number, body: unknown): Json {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function httpError(status: number, code: string): Error & { httpStatus?: number } {
  const err = new Error(code) as Error & { httpStatus?: number };
  err.httpStatus = status;
  return err;
}
