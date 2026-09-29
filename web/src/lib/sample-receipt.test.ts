import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { p256 } from "@noble/curves/nist.js";
import { SAMPLE_RECEIPT_HASH, verifySampleReceipt, type PublicReceipt } from "./sample-receipt.ts";

// GET /public/verify/8be9…7d7b as served on 2026-09-29. A real KMS signature
// from key 8b3b43ef, so this runs the same check the wizard's step 4 runs.
const LIVE: PublicReceipt = {
  canonicalHash: "8be968886f7d6f6d9b1b0c1185f00f8e08032546dee5d8f3a1f00c0037c07d7b",
  signatureBase64: "MEUCIQCf0WL/3GaByyTA/B2isDp/bIHwm2WjxK4DSgOFwbsVewIgEXiS+KAV8d1ZHRTaK4sY/4fccdwc0swrhkDwQgD417g=",
  publicKeyPem:
    "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAETLXkvBXjXKQOEsJEji8ACgbBKlCn\nrHXHg3aAn8TIysVuGHiq2WvoWtaSA16ueCh3RuxVzkqRRu/AoIt+/eQpyg==\n-----END PUBLIC KEY-----\n",
};

const serve = (r: PublicReceipt) => async (hash: string) => {
  assert.equal(hash, SAMPLE_RECEIPT_HASH);
  return r;
};

test("the live sample receipt verifies", async () => {
  assert.equal(await verifySampleReceipt(serve(LIVE)), "verified");
});

test("a tampered signature fails", async () => {
  const sig = Buffer.from(LIVE.signatureBase64, "base64");
  sig[sig.length - 1] ^= 0x01;
  assert.equal(await verifySampleReceipt(serve({ ...LIVE, signatureBase64: sig.toString("base64") })), "invalid");
});

test("a receipt for a different hash fails even if the server says it's the sample", async () => {
  const other = "0".repeat(64);
  assert.equal(await verifySampleReceipt(serve({ ...LIVE, canonicalHash: other })), "invalid");
});

test("a correct signature from a key Argus doesn't sign with fails", async () => {
  // Forge the sample: sign its hash the way KMS does (digest mode) with a fresh key.
  const secretKey = p256.utils.randomSecretKey();
  const der = p256.sign(Buffer.from(SAMPLE_RECEIPT_HASH, "hex"), secretKey, { prehash: false, format: "der" });
  const raw = p256.getPublicKey(secretKey, false);
  const forged = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: Buffer.from(raw.slice(1, 33)).toString("base64url"), y: Buffer.from(raw.slice(33)).toString("base64url") },
    format: "jwk",
  });
  const receipt = {
    canonicalHash: SAMPLE_RECEIPT_HASH,
    signatureBase64: Buffer.from(der).toString("base64"),
    publicKeyPem: forged.export({ type: "spki", format: "pem" }).toString(),
  };
  // Sanity: the forgery itself is a valid signature, so only the key pin can catch it.
  assert.equal(p256.verify(der, Buffer.from(SAMPLE_RECEIPT_HASH, "hex"), raw, { prehash: false, format: "der" }), true);
  assert.equal(await verifySampleReceipt(serve(receipt)), "invalid");
});

test("the wizard checks the same receipt the landing page shows", () => {
  // The landing page takes the hash from this module. A hardcoded hash there
  // could drift from the one the wizard verifies.
  const landing = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(landing, /import \{[^}]*\bSAMPLE_RECEIPT_HASH\b[^}]*\} from "@\/lib\/sample-receipt"/, "src/app/page.tsx must import SAMPLE_RECEIPT_HASH from @/lib/sample-receipt");
  assert.ok(!/\b[0-9a-f]{64}\b/.test(landing), "src/app/page.tsx hardcodes a 64-hex hash. Use SAMPLE_RECEIPT_HASH instead.");
});
