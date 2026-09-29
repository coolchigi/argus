import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkItYourselfSnippet } from "./receipt-snippet.ts";
import { verifyAssessmentSignature } from "./signature-verify.ts";

// Runs the exact "Check it yourself" script from the receipt page in a child
// Node process, with fetch answering from a real receipt. If the snippet
// drifts from how KMS signs (digest mode, high-S allowed), this fails.

const here = path.dirname(fileURLToPath(import.meta.url));
// Under web/node_modules so the script resolves @noble/curves like a user's install would.
const outDir = path.join(here, "..", "..", "node_modules", ".cache", "argus-test");

// The landing page's sample receipt, as GET /public/verify returned it on
// 2026-09-29. Signed by KMS key 8b3b43ef-6d27-4193-9da8-f80c95b2dc65.
const RECEIPT = {
  canonicalHash: "8be968886f7d6f6d9b1b0c1185f00f8e08032546dee5d8f3a1f00c0037c07d7b",
  signatureBase64: "MEUCIQCf0WL/3GaByyTA/B2isDp/bIHwm2WjxK4DSgOFwbsVewIgEXiS+KAV8d1ZHRTaK4sY/4fccdwc0swrhkDwQgD417g=",
  signingKeyId: "8b3b43ef-6d27-4193-9da8-f80c95b2dc65",
  publicKeyPem:
    "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAETLXkvBXjXKQOEsJEji8ACgbBKlCn\nrHXHg3aAn8TIysVuGHiq2WvoWtaSA16ueCh3RuxVzkqRRu/AoIt+/eQpyg==\n-----END PUBLIC KEY-----\n",
};

// The JWK is the point at the end of the SPKI: 0x04 || x || y.
function jwkFor(pem: string, kid: string) {
  const der = Buffer.from(pem.replace(/-----[A-Z ]+-----|\s/g, ""), "base64");
  const point = der.subarray(der.length - 64);
  return { kty: "EC", crv: "P-256", kid, alg: "ES256", use: "sig", x: point.subarray(0, 32).toString("base64url"), y: point.subarray(32).toString("base64url") };
}

function runSnippet(receipt: typeof RECEIPT, jwks: unknown): string {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `check-${Math.random().toString(36).slice(2)}.mjs`);
  const snippet = checkItYourselfSnippet({ apiUrl: "https://api.example/", jwksUrl: "https://web.example/.well-known/jwks.json", hash: receipt.canonicalHash });
  // Imports hoist, so the fake fetch is in place before the snippet's first await.
  const fake = `globalThis.fetch = async (url) => ({ json: async () => {
    if (url === "https://api.example/public/verify/${receipt.canonicalHash}") return ${JSON.stringify(receipt)};
    if (url === "https://web.example/.well-known/jwks.json") return ${JSON.stringify(jwks)};
    throw new Error("unexpected fetch " + url);
  } });\n`;
  writeFileSync(file, fake + snippet);
  return execFileSync(process.execPath, [file], { encoding: "utf8" });
}

describe("Check it yourself snippet", () => {
  const jwks = { keys: [jwkFor(RECEIPT.publicKeyPem, RECEIPT.signingKeyId)] };

  it("verifies the real sample receipt against the published key", () => {
    const out = runSnippet(RECEIPT, jwks);
    assert.match(out, /key matches JWKS: true/);
    assert.match(out, /signature valid: true/);
  });

  it("agrees with the in-browser verifier on the same receipt", async () => {
    assert.equal(
      await verifyAssessmentSignature({ canonicalHashHex: RECEIPT.canonicalHash, signatureBase64: RECEIPT.signatureBase64, publicKeyPem: RECEIPT.publicKeyPem }),
      true,
    );
  });

  it("reports an invalid signature when one byte of the hash changes", async () => {
    const tampered = { ...RECEIPT, canonicalHash: `0${RECEIPT.canonicalHash.slice(1)}` };
    assert.match(runSnippet(tampered, jwks), /signature valid: false/);
    assert.equal(
      await verifyAssessmentSignature({ canonicalHashHex: tampered.canonicalHash, signatureBase64: RECEIPT.signatureBase64, publicKeyPem: RECEIPT.publicKeyPem }),
      false,
    );
  });

  it("flags a receipt whose PEM isn't the published key", () => {
    const otherPem = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "pem", type: "spki" }).toString();
    const other = jwkFor(otherPem, RECEIPT.signingKeyId);
    assert.match(runSnippet(RECEIPT, { keys: [other] }), /key matches JWKS: false/);
  });

  it("uses the API URL without a doubled slash", () => {
    const s = checkItYourselfSnippet({ apiUrl: "https://api.example///", jwksUrl: "https://x/.well-known/jwks.json", hash: "ab" });
    assert.match(s, /"https:\/\/api\.example\/public\/verify\/ab"/);
  });
});
