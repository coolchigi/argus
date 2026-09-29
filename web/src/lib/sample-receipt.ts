/**
 * A real signed assessment from the demo tenant (Express Entry category-based
 * selection). It resolves through the public verify endpoint and exposes no
 * client data. The landing page, /verify and the onboarding wizard all use
 * it. sample-receipt.test.ts fails if the landing page drifts from this hash.
 */

import { verifyAssessmentSignature } from "./signature-verify.ts";

export const SAMPLE_RECEIPT_HASH = "8be968886f7d6f6d9b1b0c1185f00f8e08032546dee5d8f3a1f00c0037c07d7b";
export const SAMPLE_RECEIPT_TOPIC = "ee-category-based-selection";

/** Where the web app serves the signing key. Relative, so it works on every branch host. */
export const JWKS_PATH = "/.well-known/jwks.json";

/** The fields of GET /public/verify/{hash} the check needs. */
export type PublicReceipt = {
  canonicalHash: string;
  signatureBase64: string;
  publicKeyPem: string;
};

/**
 * Loads the sample through `load` and checks its signature in the browser.
 * "verified" only when the receipt is for the hash we asked about and the
 * signature checks out against a pinned Argus key. A validly signed receipt
 * for some other hash still counts as invalid.
 */
export async function verifySampleReceipt(load: (hash: string) => Promise<PublicReceipt>): Promise<"verified" | "invalid"> {
  const receipt = await load(SAMPLE_RECEIPT_HASH);
  if (receipt.canonicalHash !== SAMPLE_RECEIPT_HASH) return "invalid";
  const ok = await verifyAssessmentSignature({
    canonicalHashHex: receipt.canonicalHash,
    signatureBase64: receipt.signatureBase64,
    publicKeyPem: receipt.publicKeyPem,
  });
  return ok ? "verified" : "invalid";
}
