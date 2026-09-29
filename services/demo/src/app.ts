import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

// POST /demo/trigger-policy-change. Replays a real PolicyRules row as a
// PolicyDelta aimed at the caller's tenant only, so a demo can show the whole
// Analyst, Auditor, Anchor, Composer chain without waiting for IRCC to change
// a page. Nothing here writes a table: the delta goes to EventBridge and the
// agents do the rest exactly as they do for Sentinel.
//
// Two gates, both from the environment:
// - DEMO_TRIGGER_ENABLED must be "true", or the route answers 404.
// - The caller's rcicId must be in DEMO_RCIC_ALLOWLIST (comma-separated).
// Every trigger runs the Bedrock agents for each client in that tenant, so a
// real consultant's tenant never gets here.
//
// handler.ts wires DynamoDB and EventBridge. Tests run this against memory.

/** Sentinel's policyDomain set. Same list as services/me/src/model.ts. */
export const POLICY_DOMAINS = ['express-entry', 'pgwp', 'sowp', 'pgp', 'pnp', 'study-permit', 'general', 'other'] as const;
export const DEFAULT_POLICY_DOMAIN = 'express-entry';

export type Rule = {
  rule_hash: string;
  rule_kind?: string;
  policy_domain?: string;
  topic?: string;
  category?: string;
  severity?: string;
  summary?: string;
  source_url?: string;
  source_s3_key?: string;
  captured_at?: string;
};

/** The shape Sentinel emits and the Analyst reads (services/analyst/src/handler.ts). */
export type PolicyDelta = {
  eventId: string;
  timestamp: string;
  policyDomain: string;
  sourceUrl: string;
  category: string;
  severity: string;
  summary: string;
  topic: string;
  ruleKind: string;
  ruleHash: string;
  previousHash: null;
  newHash: string;
  s3Key: string;
  contentLengthDelta: 0;
  targetRcicIds: string[];
  demoOrigin: true;
};

export interface Deps {
  getRule(ruleHash: string): Promise<Rule | null>;
  /** Every rule in the domain. Order doesn't matter. */
  rulesInDomain(policyDomain: string): Promise<Rule[]>;
  emit(delta: PolicyDelta): Promise<void>;
}

export type Config = { enabled: boolean; allowlist: ReadonlySet<string> };

export function readConfig(env: Record<string, string | undefined>): Config {
  return {
    enabled: env.DEMO_TRIGGER_ENABLED === 'true',
    allowlist: new Set(
      (env.DEMO_RCIC_ALLOWLIST ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  };
}

type Json = APIGatewayProxyStructuredResultV2;
type Log = (level: 'info' | 'error', msg: string, fields: Record<string, unknown>) => void;

export function createApp(deps: Deps, config: Config, opts: { now?: () => Date; log?: Log } = {}) {
  const now = opts.now ?? (() => new Date());
  const log: Log = opts.log ?? ((level, msg, fields) => console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...fields })));

  async function trigger(rcicId: string, body: Record<string, unknown>): Promise<Json> {
    const { policyDomain, ruleHash } = body;
    if (ruleHash !== undefined && (typeof ruleHash !== 'string' || !/^[0-9a-f]{64}$/.test(ruleHash))) {
      return json(400, { error: 'invalid-ruleHash' });
    }
    if (policyDomain !== undefined && (typeof policyDomain !== 'string' || !(POLICY_DOMAINS as readonly string[]).includes(policyDomain))) {
      return json(400, { error: 'invalid-policyDomain', allowed: POLICY_DOMAINS });
    }

    const rule = typeof ruleHash === 'string' ? await deps.getRule(ruleHash) : newest(await deps.rulesInDomain((policyDomain as string | undefined) ?? DEFAULT_POLICY_DOMAIN));
    if (!rule) return json(404, { error: typeof ruleHash === 'string' ? 'rule-not-found' : 'no-rule-for-domain' });

    const at = now();
    const delta: PolicyDelta = {
      eventId: `demo-${at.getTime()}-${rule.rule_hash.slice(0, 8)}`,
      timestamp: at.toISOString(),
      policyDomain: rule.policy_domain ?? '',
      sourceUrl: rule.source_url ?? '',
      category: rule.category ?? '',
      severity: rule.severity ?? '',
      summary: rule.summary ?? '',
      topic: rule.topic ?? '',
      ruleKind: rule.rule_kind ?? '',
      ruleHash: rule.rule_hash,
      previousHash: null,
      newHash: rule.rule_hash,
      s3Key: rule.source_s3_key ?? '',
      contentLengthDelta: 0,
      targetRcicIds: [rcicId],
      demoOrigin: true,
    };
    await deps.emit(delta);
    log('info', 'demo-delta-emitted', { rcicId, eventId: delta.eventId, ruleHash: delta.ruleHash, policyDomain: delta.policyDomain, topic: delta.topic });
    return json(202, { eventId: delta.eventId, ruleHash: delta.ruleHash, policyDomain: delta.policyDomain, topic: delta.topic, targetRcicId: rcicId });
  }

  return async function handler(event: APIGatewayProxyEventV2): Promise<Json> {
    const routeKey = event.routeKey ?? `${event.requestContext.http.method} ${event.rawPath}`;
    const rcicId = resolveRcicId(event);
    try {
      if (!config.enabled) return json(404, { error: 'demo-disabled' });
      if (!rcicId) return json(403, { error: 'missing-tenant-claim' });
      if (!config.allowlist.has(rcicId)) {
        log('info', 'demo-refused', { rcicId, routeKey });
        return json(403, { error: 'demo-not-allowed-for-tenant' });
      }
      if (routeKey === 'POST /demo/trigger-policy-change') {
        const body = parseBody(event.body);
        if (!body) return json(400, { error: 'invalid-json-body' });
        return await trigger(rcicId, body);
      }
      // /demo/seed stays unbuilt. scripts/seed-demo-tenant.sh seeds a tenant.
      if (routeKey === 'POST /demo/seed') return json(501, { error: 'not-implemented' });
      return json(404, { error: 'route-not-found', routeKey });
    } catch (err) {
      log('error', 'demo-request-failed', { routeKey, rcicId, error: err instanceof Error ? err.message : String(err) });
      return json(500, { error: 'internal-error' });
    }
  };
}

/** The most recently captured rule. Rows without captured_at sort last. */
export function newest(rules: Rule[]): Rule | null {
  let best: Rule | null = null;
  for (const r of rules) {
    if (typeof r.rule_hash !== 'string' || r.rule_hash.length === 0) continue;
    if (!best || (r.captured_at ?? '') > (best.captured_at ?? '')) best = r;
  }
  return best;
}

// No fallback tenant: a token without an rcic claim never triggers anything.
function resolveRcicId(event: APIGatewayProxyEventV2): string | null {
  const claims = (event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } }).authorizer?.jwt?.claims;
  for (const key of ['custom:rcic_id', 'custom:rcic_license']) {
    const v = claims?.[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function parseBody(body: string | undefined): Record<string, unknown> | null {
  if (!body) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function json(statusCode: number, body: unknown): Json {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
