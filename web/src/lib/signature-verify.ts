/**
 * Verify an Argus assessment signature entirely in the browser via WebCrypto.
 *
 * KMS signs the SHA-256 hash of the canonicalized assessment payload with
 * ECDSA_SHA_256 on a P-256 (secp256r1) key. KMS returns a DER-encoded
 * ECDSA signature. WebCrypto's ECDSA.verify expects a raw r||s concatenation,
 * so we convert. See NIST FIPS 186-4 for the DER format.
 */

export type VerifyInput = {
  canonicalHashHex: string;
  signatureBase64: string;
  publicKeyPem: string;
};

export async function verifyAssessmentSignature(input: VerifyInput): Promise<boolean> {
  const key = await importSpkiPem(input.publicKeyPem);
  const derSig = base64ToBytes(input.signatureBase64);
  const rawSig = derToRawEcdsa(derSig, 32); // P-256 -> 32 bytes per component
  const hash = hexToBytes(input.canonicalHashHex);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    rawSig,
    hash,
  );
}

async function importSpkiPem(pem: string): Promise<CryptoKey> {
  const b64 = pem.replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const spki = base64ToBytes(b64);
  return crypto.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
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

/**
 * Convert a DER-encoded ECDSA signature to raw r||s of `size` bytes each.
 * DER: 30 <len> 02 <rlen> <r> 02 <slen> <s>
 */
function derToRawEcdsa(der: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("bad DER: missing sequence tag");
  // length byte (single-byte lengths only; ECDSA signatures fit)
  const seqLen = der[offset++];
  if (seqLen + 2 !== der.length) {
    // Also acceptable if this is a long-form length.
    if ((seqLen & 0x80) === 0x80) {
      const lenBytes = seqLen & 0x7f;
      offset += lenBytes; // skip the length bytes; we don't strictly validate
    } else {
      // small-form length that doesn't match; unusual but not necessarily fatal
    }
  }

  if (der[offset++] !== 0x02) throw new Error("bad DER: missing r integer tag");
  let rLen = der[offset++];
  let r = der.slice(offset, offset + rLen);
  offset += rLen;

  if (der[offset++] !== 0x02) throw new Error("bad DER: missing s integer tag");
  let sLen = der[offset++];
  let s = der.slice(offset, offset + sLen);
  offset += sLen;

  const rPadded = trimAndPad(r, size);
  const sPadded = trimAndPad(s, size);

  const out = new Uint8Array(new ArrayBuffer(size * 2));
  out.set(rPadded, 0);
  out.set(sPadded, size);
  return out;
}

function trimAndPad(v: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  // Strip leading 0x00 that DER adds to keep integers non-negative.
  let cur = v;
  while (cur.length > size && cur[0] === 0x00) cur = cur.slice(1);
  if (cur.length > size) throw new Error(`component larger than expected ${size} bytes`);
  const padded = new Uint8Array(new ArrayBuffer(size));
  padded.set(cur, size - cur.length);
  return padded;
}
