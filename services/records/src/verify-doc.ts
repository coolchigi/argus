// VERIFY.md for an export. The Node script and the OpenSSL commands in it are
// run as-is by verify-doc.test.ts against a locally signed fixture, so the
// instructions can't drift from what actually verifies.
//
// Verification matches web/src/lib/signature-verify.ts: KMS signs the SHA-256
// hash as a digest (MessageType DIGEST), so the verifier must not hash again
// (prehash off), and KMS doesn't normalize S (low-S not required).

export type VerifyDocInput = {
  from: string;
  to: string;
  generatedAt: string;
  keyId: string;
  spkiSha256: string;
  assessmentCount: number;
  /** How many of assessmentCount are consultant reviews (ADR-0004). */
  reviewCount: number;
  briefCount: number;
};

export const RECORDS_FILE = 'records.jsonl';
export const KEY_FILE = 'argus-signing-key.pem';
export const VERIFY_FILE = 'VERIFY.md';

const FENCE = '```';

export function verifyScript(spkiSha256: string): string {
  return [
    "import { createHash, createPublicKey } from 'node:crypto';",
    "import { readFileSync } from 'node:fs';",
    "import { p256 } from '@noble/curves/nist.js';",
    '',
    `const PINNED_SPKI_SHA256 = '${spkiSha256}';`,
    `const [recordsPath = '${RECORDS_FILE}', keyPath = '${KEY_FILE}'] = process.argv.slice(2);`,
    '',
    "const key = createPublicKey(readFileSync(keyPath, 'utf8'));",
    "const spki = key.export({ type: 'spki', format: 'der' });",
    "if (createHash('sha256').update(spki).digest('hex') !== PINNED_SPKI_SHA256) {",
    "  console.error('FAIL key fingerprint does not match ' + PINNED_SPKI_SHA256);",
    '  process.exit(1);',
    '}',
    "const { crv, x, y } = key.export({ format: 'jwk' });",
    "if (crv !== 'P-256') {",
    "  console.error('FAIL key is ' + crv + ', expected P-256');",
    '  process.exit(1);',
    '}',
    "const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(x, 'base64url'), Buffer.from(y, 'base64url')]);",
    '',
    '// Sorted keys at every level, no whitespace. Same as Argus.',
    'function canonicalize(value) {',
    "  if (value === null) return 'null';",
    "  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';",
    "  if (typeof value === 'object') {",
    "    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';",
    '  }',
    '  return JSON.stringify(value);',
    '}',
    '',
    'let failed = 0;',
    "for (const line of readFileSync(recordsPath, 'utf8').split('\\n')) {",
    '  if (!line.trim()) continue;',
    '  const r = JSON.parse(line);',
    "  const hash = Buffer.from(r.canonicalHash, 'hex');",
    '  let signatureOk = false;',
    '  try {',
    '    // prehash: false, because KMS signed the 32-byte hash as a digest.',
    "    // lowS: false, because KMS doesn't normalize S.",
    '    signatureOk = hash.length === 32 && p256.verify(',
    "      Buffer.from(r.signatureBase64, 'base64'), hash, publicKey,",
    "      { prehash: false, lowS: false, format: 'der' },",
    '    );',
    '  } catch {',
    '    signatureOk = false;',
    '  }',
    '  const payloadOk = r.signedPayload === null',
    "    || createHash('sha256').update(canonicalize(r.signedPayload)).digest('hex') === r.canonicalHash;",
    '  const ok = signatureOk && payloadOk;',
    '  if (!ok) failed += 1;',
    "  const payload = r.signedPayload === null ? 'not exported' : payloadOk ? 'matches' : 'CHANGED';",
    "  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + r.kind + ' ' + r.id + ' signature ' + (signatureOk ? 'valid' : 'INVALID') + ', payload ' + payload);",
    '}',
    'process.exit(failed ? 1 : 0);',
  ].join('\n');
}

/** Expects HASH and SIG in the environment, taken from one line of records.jsonl. */
export const OPENSSL_COMMANDS = [
  'printf \'%s\' "$HASH" | xxd -r -p > hash.bin',
  'printf \'%s\' "$SIG" | base64 -d > sig.der',
  `openssl pkeyutl -verify -pubin -inkey ${KEY_FILE} -in hash.bin -sigfile sig.der`,
].join('\n');

export function buildVerifyDoc(i: VerifyDocInput): string {
  const lines = [
    '# Verifying your Argus records',
    '',
    `This archive holds ${i.assessmentCount} signed assessments (${i.reviewCount} of them consultant reviews) and ${i.briefCount} sent briefs from ${i.from} to ${i.to} (UTC dates, both included). Argus built it at ${i.generatedAt}.`,
    '',
    `- \`${RECORDS_FILE}\`: one signed record per line.`,
    `- \`${KEY_FILE}\`: the public half of the key that signed them.`,
    `- \`${VERIFY_FILE}\`: this file.`,
    '',
    'You can check every record below without Argus being online.',
    '',
    '## How Argus signs',
    '',
    `Argus signs with an AWS KMS key, ECDSA on curve P-256, key ID \`${i.keyId}\`. It hashes each record with SHA-256, then has KMS sign that 32-byte hash as a digest (\`MessageType: DIGEST\`).`,
    '',
    "So verify the signature against the hash itself. Don't hash it again. Most ECDSA tools hash their input by default, and that check fails on every real Argus signature.",
    '',
    "KMS also doesn't normalize signatures to low-S, so your verifier has to accept high-S signatures.",
    '',
    'Each line of the records file has:',
    '',
    '- `canonicalHash`: the hex SHA-256 that was signed.',
    '- `signatureBase64`: the DER-encoded ECDSA signature, in base64.',
    '- `signingKeyId`: the KMS key that signed it.',
    '- `signedPayload`, on assessments: the exact object Argus hashed. Sort its keys at every level, serialize it as JSON with no whitespace, and the SHA-256 of that string is `canonicalHash`. The script below does this for you.',
    '',
    'Assessments come in 2 kinds, named by `recordKind`:',
    '',
    "- `agent`: the pipeline's assessment. Argus signed the Analyst's `isAffected`. On newer records `signedPayload.auditorStance` holds the Auditor's view of that answer (`agree`, `disagree` or `uncertain`) and its reason, under the same signature. `contradicted: true` on an `uncertain` stance means the Auditor's reason argued the opposite of the stance it gave, so Argus recorded it as `uncertain`.",
    "- `consultant-review`: your own verdict, filed as a correction that changed `isAffected`. `supersedes` names the assessment it replaces and `supersedesCanonicalHash` pins that record's hash. The replaced assessment is never edited or deleted, so it's in this file too when it falls in the date range.",
    '',
    'Both kinds verify the same way.',
    '',
    "Briefs carry their hash and signature only (`signedPayload` is `null`). The sent text isn't in this export: you can edit a brief freely before sending it, so it could name a client. The recipient's address isn't here either, in any form. The signature still proves Argus signed that hash when the brief went out.",
    '',
    '## 1. Check the key',
    '',
    'The SHA-256 of the key (SPKI, DER) must be:',
    '',
    FENCE,
    i.spkiSha256,
    FENCE,
    '',
    'Argus shows the same fingerprint in Settings, under Signing key, and every public receipt page under tryargus.ca/verify checks against it. To compute it yourself:',
    '',
    FENCE + 'sh',
    `openssl pkey -pubin -in ${KEY_FILE} -outform DER | openssl dgst -sha256`,
    FENCE,
    '',
    '## 2. Check every record (Node.js 20 or later)',
    '',
    'Save this as `verify.mjs` next to the records file:',
    '',
    FENCE + 'js',
    verifyScript(i.spkiSha256),
    FENCE,
    '',
    'Then run:',
    '',
    FENCE + 'sh',
    'npm install @noble/curves@2',
    `node verify.mjs ${RECORDS_FILE} ${KEY_FILE}`,
    FENCE,
    '',
    'It prints one line per record and exits with status 1 if any record fails. A record passes when its signature is valid and, for assessments, its payload still hashes to `canonicalHash`.',
    '',
    '## 3. Or check one record with OpenSSL',
    '',
    'Copy `canonicalHash` into `HASH` and `signatureBase64` into `SIG` from one line of the records file, then run:',
    '',
    FENCE + 'sh',
    OPENSSL_COMMANDS,
    FENCE,
    '',
    "`openssl pkeyutl` treats `hash.bin` as the digest and doesn't hash it again. A good signature prints `Signature Verified Successfully`.",
    '',
    '## Why you have this',
    '',
    'CICC Client File Management Regulation s. 7.2 has you keep client records for 6 years after a file closes, and Argus assessments and sent briefs count as client records. Argus keeps them too, but file this export with your own client records.',
    '',
  ];
  return lines.join('\n');
}
