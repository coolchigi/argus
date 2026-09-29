/**
 * The "Check it yourself" script on a receipt page. It does what
 * signature-verify.ts does, outside Argus, so an auditor can run it in Node
 * with one dependency:
 *
 * - KMS signed the 32-byte SHA-256 digest itself (MessageType DIGEST), so the
 *   check runs in digest mode: prehash off.
 * - KMS doesn't normalize S, so a high-S signature is valid: lowS off.
 * - The key comes from the JWKS, matched by kid, and must equal the PEM the
 *   receipt returned.
 *
 * receipt-snippet.test.ts runs this exact text against a real receipt.
 */
export function checkItYourselfSnippet(opts: { apiUrl: string; jwksUrl: string; hash: string }): string {
  const api = opts.apiUrl.replace(/\/+$/, "");
  return `// Node 20 or later. npm install @noble/curves, then save as check.mjs and run: node check.mjs
import { p256 } from "@noble/curves/nist.js";

const receipt = await (await fetch("${api}/public/verify/${opts.hash}")).json();
const jwks = await (await fetch("${opts.jwksUrl}")).json();

// The key Argus publishes, matched by kid, as an uncompressed P-256 point.
const jwk = jwks.keys.find((k) => k.kid === receipt.signingKeyId);
if (!jwk) throw new Error("No published key with kid " + receipt.signingKeyId);
const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);

// The PEM on the receipt has to be that same key.
const spki = Buffer.from(receipt.publicKeyPem.replace(/-----[A-Z ]+-----|\\s/g, ""), "base64");
const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
const pemPoint = Buffer.from(await crypto.subtle.exportKey("raw", key));
console.log("key matches JWKS:", pemPoint.equals(point));

// KMS signed the SHA-256 digest itself, so verify the digest as is (prehash off).
// KMS doesn't normalize S, so don't require low-S.
const digest = Buffer.from(receipt.canonicalHash, "hex");
const signature = Buffer.from(receipt.signatureBase64, "base64");
console.log("signature valid:", p256.verify(signature, digest, point, { prehash: false, lowS: false, format: "der" }));
`;
}
