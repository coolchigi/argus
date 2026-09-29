import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractFingerprint } from "./verify-input.ts";

const H = "8be968886f7d6f6d9b1b0c1185f00f8e08032546dee5d8f3a1f00c0037c07d7b";

describe("extractFingerprint", () => {
  it("takes a bare hash, any case, with surrounding space", () => {
    assert.equal(extractFingerprint(H), H);
    assert.equal(extractFingerprint(`  ${H.toUpperCase()}\n`), H);
  });

  it("takes a hash grouped in 4s the way receipts print it", () => {
    const grouped = H.match(/.{4}/g)!.join(" ");
    assert.equal(extractFingerprint(grouped), H);
  });

  it("takes a verify link from any host, with a query, fragment or trailing slash", () => {
    for (const url of [
      `https://tryargus.ca/verify/${H}`,
      `https://phase-8-frontend.d270cjhakw6y7j.amplifyapp.com/verify/${H}/`,
      `tryargus.ca/verify/${H}?utm_source=email`,
      `http://localhost:3000/verify/${H}#check`,
    ]) {
      assert.equal(extractFingerprint(url), H, url);
    }
  });

  it("finds the hash in a pasted email footer line", () => {
    assert.equal(extractFingerprint(`Verify this message: https://tryargus.ca/verify/${H}`), H);
    assert.equal(extractFingerprint(`sha256:${H}`), H);
  });

  it("refuses short, long, non-hex or ambiguous input", () => {
    for (const bad of ["", "   ", H.slice(1), `${H}0`, H.replace("8", "g"), `https://tryargus.ca/verify/${H}0`, `${H} ${"0".repeat(64)}`]) {
      assert.equal(extractFingerprint(bad), null, JSON.stringify(bad));
    }
  });
});
