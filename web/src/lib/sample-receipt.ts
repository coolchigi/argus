/**
 * A real signed assessment from the demo tenant (Express Entry category-based
 * selection). It resolves through the public verify endpoint and exposes no
 * client data. The landing page and /verify both link to it.
 */
export const SAMPLE_RECEIPT_HASH = "8be968886f7d6f6d9b1b0c1185f00f8e08032546dee5d8f3a1f00c0037c07d7b";
export const SAMPLE_RECEIPT_TOPIC = "ee-category-based-selection";

/** Where the web app serves the signing key. Relative, so it works on every branch host. */
export const JWKS_PATH = "/.well-known/jwks.json";
