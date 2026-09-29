// Contracts for the unauthenticated routes in services/impacts-service:
// GET /public/verify/{hash}, GET /public/jwks and GET /public/stats.

export type ReceiptKind = "assessment" | "brief";

export type PublicConsultant = { displayName: string; rcicLicense: string };

export type PublicVerify = {
  /** Absent on responses from before briefs could be verified. Treat as "assessment". */
  kind?: ReceiptKind;
  /** Signing scheme id, for example "kms-digest-v1". Optional. */
  scheme?: string;
  fingerprint: string;
  /** Assessments carry a topic. A brief may not. */
  topic?: string;
  signedAt: string;
  signatureAlgorithm: string;
  canonicalHash: string;
  signatureBase64: string;
  signingKeyId: string;
  publicKeyPem: string;
  /** Only when the consultant turned on "Show my name on public receipts". */
  consultant?: PublicConsultant | null;
};

export type Jwk = { kty: "EC"; crv: "P-256"; x: string; y: string; kid: string; alg: "ES256"; use: "sig" };
export type JwkSet = { keys: Jwk[] };

export type PublicStats = { assessmentsSigned7d: number; briefsSent7d: number; lastSignedAt: string | null };

export function receiptKind(r: Pick<PublicVerify, "kind">): ReceiptKind {
  return r.kind === "brief" ? "brief" : "assessment";
}
