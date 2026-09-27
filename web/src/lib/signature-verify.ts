/**
 * Verify an Argus signature entirely in the browser.
 *
 * Anchor and briefs-service call KMS Sign with MessageType DIGEST, so KMS
 * signs the 32-byte SHA-256 hash itself. WebCrypto's ECDSA verify always
 * hashes its input again, which checks sha256(hash) and fails on every real
 * signature. So we verify with @noble/curves in digest mode (prehash off).
 *
 * KMS doesn't normalize S, so high-S signatures are valid here (lowS off).
 * The public key comes back in the same response as the signature, so we pin
 * it: the SPKI SHA-256 must match a key we know Argus signs with.
 */

import { p256 } from "@noble/curves/nist.js";

/** SHA-256 of the SPKI DER for each Argus KMS signing key. */
const PINNED_SPKI_SHA256 = new Set([
  // 8b3b43ef-6d27-4193-9da8-f80c95b2dc65, ECC_NIST_P256, checked against KMS GetPublicKey
  "9eeaa3055e1915ee2c31e6c904c37bdde22eb43e82a08ccf9fba9dfccebe94be",
]);

export type VerifyInput = {
  canonicalHashHex: string;
  signatureBase64: string;
  publicKeyPem: string;
};

export async function verifyAssessmentSignature(input: VerifyInput): Promise<boolean> {
  const spki = pemToSpki(input.publicKeyPem);
  if (!PINNED_SPKI_SHA256.has(await sha256Hex(spki))) return false;

  // WebCrypto checks the key really is a P-256 point, then hands us its raw bytes.
  const key = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));

  const hash = hexToBytes(input.canonicalHashHex);
  if (hash.length !== 32) return false;
  const derSig = base64ToBytes(input.signatureBase64);
  try {
    return p256.verify(derSig, hash, publicKey, { prehash: false, lowS: false, format: "der" });
  } catch {
    return false;
  }
}

function pemToSpki(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  return base64ToBytes(b64);
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new Error("hex length must be even");
  const buf = new ArrayBuffer(hex.length / 2);
  const out = new Uint8Array(buf);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
