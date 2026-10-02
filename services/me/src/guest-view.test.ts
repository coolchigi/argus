import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asGuestView, isGuestRoute } from '../../shared/guest-view.ts';

function event(routeKey: string, claims?: Record<string, string>) {
  return {
    routeKey,
    rawPath: routeKey.split(' ')[1],
    requestContext: { http: { method: routeKey.split(' ')[0] }, ...(claims ? { authorizer: { jwt: { claims } } } : {}) },
  };
}

type Claims = { authorizer?: { jwt?: { claims?: Record<string, string> } } };
const claimsOf = (e: { requestContext: object }) => (e.requestContext as Claims).authorizer?.jwt?.claims;

test('a guest GET becomes the signed-in GET for the guest tenant', () => {
  const out = asGuestView(event('GET /guest/impacts/{id}'), 'R000000');
  assert.equal(out.routeKey, 'GET /impacts/{id}');
  assert.equal(out.rawPath, '/impacts/{id}');
  assert.deepEqual(claimsOf(out), { 'custom:rcic_id': 'R000000' });
});

test('a signed-in request keeps its own tenant', () => {
  const signedIn = event('GET /impacts/{id}', { 'custom:rcic_id': 'R111111' });
  const out = asGuestView(signedIn, 'R000000');
  assert.equal(out, signedIn);
  assert.deepEqual(claimsOf(out), { 'custom:rcic_id': 'R111111' });
});

test('writes are never guest routes, even under /guest', () => {
  assert.equal(isGuestRoute(event('POST /guest/impacts/{id}/correction')), false);
  const out = asGuestView(event('POST /guest/impacts/{id}/correction'), 'R000000');
  assert.equal(claimsOf(out), undefined);
});

test('with no guest tenant configured, the guest view carries no tenant', () => {
  const out = asGuestView(event('GET /guest/briefs'), undefined);
  assert.equal(out.routeKey, 'GET /briefs');
  assert.deepEqual(claimsOf(out), {});
});
