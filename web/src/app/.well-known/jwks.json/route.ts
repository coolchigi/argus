// Serves the Argus signing key at /.well-known/jwks.json by fetching
// GET /public/jwks from the API on each request.
//
// A route handler instead of a next.config rewrite: Next proxies external
// rewrites from its own router server (server/lib/router-server.js calls
// proxyRequest), and a host that runs the app through its own adapter, like
// Amplify WEB_COMPUTE, may not route through that code. A route handler is
// plain app code that every Next host runs, and it lets us check the body and
// set the cache and CORS headers ourselves.

// Never fetched at build time. The API may not have the route yet when the
// web app builds.
export const dynamic = "force-dynamic";

const API_URL = process.env.NEXT_PUBLIC_ARGUS_API_URL;

const HEADERS = {
  "cache-control": "public, max-age=300",
  // Any verifier, from any origin, can read the public key.
  "access-control-allow-origin": "*",
};

export async function GET(): Promise<Response> {
  if (!API_URL) return Response.json({ error: "jwks-unavailable" }, { status: 503 });
  try {
    const res = await fetch(`${API_URL.replace(/\/+$/, "")}/public/jwks`, { cache: "no-store" });
    if (!res.ok) return Response.json({ error: "jwks-unavailable" }, { status: 502 });
    const body: unknown = await res.json();
    if (!isJwkSet(body)) return Response.json({ error: "jwks-unavailable" }, { status: 502 });
    return Response.json({ keys: body.keys }, { headers: HEADERS });
  } catch {
    return Response.json({ error: "jwks-unavailable" }, { status: 502 });
  }
}

/** Only EC public keys pass through, so a bad upstream can't publish anything else here. */
function isJwkSet(v: unknown): v is { keys: Array<Record<string, string>> } {
  if (!v || typeof v !== "object" || !Array.isArray((v as { keys?: unknown }).keys)) return false;
  const keys = (v as { keys: unknown[] }).keys;
  return (
    keys.length > 0 &&
    keys.every((k) => {
      if (!k || typeof k !== "object") return false;
      const j = k as Record<string, unknown>;
      return j.kty === "EC" && j.crv === "P-256" && typeof j.x === "string" && typeof j.y === "string" && typeof j.kid === "string" && !("d" in j);
    })
  );
}
