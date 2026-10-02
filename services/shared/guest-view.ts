// The read-only guest view. API Gateway serves GET /guest/<route> with no
// Cognito authorizer, so anyone can look at one demo tenant without signing
// in. This turns that request into the signed-in GET <route> for the guest
// tenant, so each service runs its normal read path and nothing else.
//
// Safe because API Gateway sets routeKey from the route it matched: a caller
// can't make a signed-in route look like a guest route, and the guest routes
// exist only for GET, so a guest can never reach a write.

export const GUEST_ROUTE_PREFIX = 'GET /guest/';

type RouteEvent = { routeKey?: string; rawPath?: string; requestContext: object };

export function isGuestRoute(event: RouteEvent): boolean {
  return (event.routeKey ?? '').startsWith(GUEST_ROUTE_PREFIX);
}

/**
 * Returns the event as the guest tenant's signed-in GET. With no guest tenant
 * configured, the claims stay empty, so the service answers 403.
 */
export function asGuestView<E extends RouteEvent>(event: E, guestRcicId: string | undefined): E {
  if (!isGuestRoute(event)) return event;
  const claims: Record<string, string> = guestRcicId ? { 'custom:rcic_id': guestRcicId } : {};
  return {
    ...event,
    routeKey: `GET /${event.routeKey!.slice(GUEST_ROUTE_PREFIX.length)}`,
    rawPath: event.rawPath?.replace(/^\/guest\//, '/'),
    requestContext: { ...event.requestContext, authorizer: { jwt: { claims, scopes: [] } } },
  };
}
