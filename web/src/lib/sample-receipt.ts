/**
 * The sample receipt the onboarding wizard verifies. Same hash as the landing
 * page's "Live sample receipt" (src/app/page.tsx), a real signed assessment
 * from the demo tenant with no client data in it. sample-receipt.test.ts fails
 * if the two drift apart.
 */

import { verifyAssessmentSignature } from "./signature-verify.ts";

export const SAMPLE_RECEIPT_HASH = "8be968886f7d6f6d9b1b0c1185f00f8e08032546dee5d8f3a1f00c0037c07d7b";

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
