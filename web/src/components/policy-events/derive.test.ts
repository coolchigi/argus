import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL,
  NO_DOMAIN,
  aggregateActions,
  clientBriefState,
  clientNeedsAction,
  deltaSummary,
  domainsIn,
  eventNote,
  filterEvents,
  sealSummary,
  signedRows,
  verifyRow,
  visibleClients,
  type SignatureMaterial,
} from "./derive.ts";
import type { PolicyEvent, PolicyEventImpact } from "../../lib/types/policy-events.ts";

const ev = (over: Partial<PolicyEvent>): PolicyEvent =>
  ({
    eventId: "r1",
    ref: "EE-20260922-1CBB",
    title: "CRS scorecard",
    topic: "crs-scorecard",
    summary: null,
    policyDomain: "express-entry",
    status: "action-required",
    runs: 1,
    correctionsFiled: 0,
    ...over,
  }) as PolicyEvent;

const client = (over: Partial<PolicyEventImpact>): PolicyEventImpact =>
  ({
    clientId: "C-101",
    assessmentKey: "e1#C-101",
    isAffected: true,
    impactType: "crs-delta",
    numericDelta: null,
    recommendedAction: "Prepare ITA response package",
    canonicalHash: null,
    signedAt: "2026-09-22T10:00:00Z",
    brief: null,
    correctionsFiled: 0,
    assessmentCount: 1,
    priorAssessments: [],
    ...over,
  }) as PolicyEventImpact;

// ---------------------------------------------------------------------------
// List filtering
// ---------------------------------------------------------------------------

const events = [
  ev({ eventId: "a", ref: "EE-1", title: "CRS draw cut-off", topic: "crs-draw", status: "action-required" }),
  ev({ eventId: "b", ref: "PG-2", title: "PGWP field of study", topic: "pgwp-fos", policyDomain: "pgwp", status: "done" }),
  ev({ eventId: "c", ref: "XX-3", title: "Fee update", topic: "fees", policyDomain: null, status: "no-impact", summary: "Biometrics fee rises" }),
];

test("status and domain filters combine, and a missing domain has its own option", () => {
  assert.deepEqual(filterEvents(events, { query: "", status: "done", domain: ALL }).map((e) => e.eventId), ["b"]);
  assert.deepEqual(filterEvents(events, { query: "", status: ALL, domain: "pgwp" }).map((e) => e.eventId), ["b"]);
  assert.deepEqual(filterEvents(events, { query: "", status: ALL, domain: NO_DOMAIN }).map((e) => e.eventId), ["c"]);
  assert.deepEqual(filterEvents(events, { query: "", status: "done", domain: "express-entry" }), []);
});

test("search matches ref, title and summary, case-insensitively, every word required", () => {
  assert.deepEqual(filterEvents(events, { query: "pg-2", status: ALL, domain: ALL }).map((e) => e.eventId), ["b"]);
  assert.deepEqual(filterEvents(events, { query: "crs CUT", status: ALL, domain: ALL }).map((e) => e.eventId), ["a"]);
  assert.deepEqual(filterEvents(events, { query: "biometrics", status: ALL, domain: ALL }).map((e) => e.eventId), ["c"]);
  assert.deepEqual(filterEvents(events, { query: "crs biometrics", status: ALL, domain: ALL }), []);
});

test("domain options are distinct, sorted, with the missing-domain option last", () => {
  assert.deepEqual(domainsIn([...events, ev({ eventId: "d" })]), ["express-entry", "pgwp", NO_DOMAIN]);
  assert.deepEqual(domainsIn([events[0]]), ["express-entry"]);
});

test("the note line counts reassessments after the first run and corrections", () => {
  assert.equal(eventNote({ runs: 1, correctionsFiled: 0 }), null);
  assert.equal(eventNote({ runs: 3, correctionsFiled: 0 }), "Reassessed 2x");
  assert.equal(eventNote({ runs: 1, correctionsFiled: 1 }), "1 correction filed");
  assert.equal(eventNote({ runs: 2, correctionsFiled: 2 }), "Reassessed 1x · 2 corrections filed");
});

// ---------------------------------------------------------------------------
// Affected clients
// ---------------------------------------------------------------------------

test("unaffected clients are hidden until asked for", () => {
  const list = [client({ clientId: "A" }), client({ clientId: "B", isAffected: false })];
  assert.deepEqual(visibleClients(list, false).map((c) => c.clientId), ["A"]);
  assert.deepEqual(visibleClients(list, true).map((c) => c.clientId), ["A", "B"]);
});

test("brief state separates a missing brief from one that isn't needed", () => {
  const brief = (status: string) => ({ briefId: "b", assessmentKey: "k", status, sentAt: null });
  assert.equal(clientBriefState(client({ brief: null })), "missing");
  assert.equal(clientBriefState(client({ isAffected: false, brief: null })), "not-needed");
  assert.equal(clientBriefState(client({ brief: brief("sent") })), "sent");
  assert.equal(clientBriefState(client({ brief: brief("edited") })), "edited");
  assert.equal(clientBriefState(client({ brief: brief("queued") })), "draft");
  assert.equal(clientNeedsAction(client({ brief: brief("draft") })), true);
  assert.equal(clientNeedsAction(client({ brief: brief("sent") })), false);
  assert.equal(clientNeedsAction(client({ isAffected: false })), false);
});

// ---------------------------------------------------------------------------
// Recommended actions
// ---------------------------------------------------------------------------

test("actions are de-duplicated across wording noise and counted per client", () => {
  const out = aggregateActions([
    client({ clientId: "C1", recommendedAction: "Prepare ITA response package" }),
    client({ clientId: "C2", recommendedAction: "  prepare ITA  response package. " }),
    client({ clientId: "C3", recommendedAction: "Confirm biometrics validity" }),
    client({ clientId: "C4", recommendedAction: "Prepare ITA response package" }),
    client({ clientId: "C5", recommendedAction: "Ignore me", isAffected: false }),
    client({ clientId: "C6", recommendedAction: "   " }),
  ]);
  assert.deepEqual(out, [
    { action: "Prepare ITA response package", clientIds: ["C1", "C2", "C4"] },
    { action: "Confirm biometrics validity", clientIds: ["C3"] },
  ]);
});

test("a client listed twice for one action counts once, ties sort alphabetically", () => {
  const out = aggregateActions([
    client({ clientId: "C1", recommendedAction: "Zeta" }),
    client({ clientId: "C1", recommendedAction: "zeta" }),
    client({ clientId: "C2", recommendedAction: "Alpha" }),
  ]);
  assert.deepEqual(out.map((a) => [a.action, a.clientIds.length]), [["Alpha", 1], ["Zeta", 1]]);
});

// ---------------------------------------------------------------------------
// Delta summary
// ---------------------------------------------------------------------------

test("delta summary covers affected clients with a number only", () => {
  assert.equal(deltaSummary([client({ numericDelta: null })]), null);
  assert.deepEqual(
    deltaSummary([
      client({ numericDelta: -12 }),
      client({ numericDelta: 4 }),
      client({ numericDelta: -3 }),
      client({ numericDelta: 50, isAffected: false }),
    ]),
    { count: 3, median: -3, min: -12, max: 4 },
  );
  assert.equal(deltaSummary([client({ numericDelta: -10 }), client({ numericDelta: -4 })])?.median, -7);
});

// ---------------------------------------------------------------------------
// Verify all
// ---------------------------------------------------------------------------

test("only rows with a fingerprint are signed records", () => {
  const rows = signedRows([client({ clientId: "A", canonicalHash: "ab" }), client({ clientId: "B", canonicalHash: null })]);
  assert.deepEqual(rows.map((r) => r.clientId), ["A"]);
});

const material = (hash: string): SignatureMaterial => ({ canonicalHash: hash, signatureBase64: "sig", publicKeyPem: "pem" });

test("verifyRow: a good signature over the shown fingerprint verifies", async () => {
  const seen: string[] = [];
  const out = await verifyRow(
    { assessmentKey: "k1", canonicalHash: "ABCD" },
    async (k) => {
      seen.push(k);
      return material("abcd");
    },
    async (input) => input.canonicalHashHex === "abcd" && input.signatureBase64 === "sig",
  );
  assert.equal(out, "verified");
  assert.deepEqual(seen, ["k1"]);
});

test("verifyRow: a valid signature over a different record is invalid", async () => {
  const out = await verifyRow({ assessmentKey: "k1", canonicalHash: "abcd" }, async () => material("ffff"), async () => true);
  assert.equal(out, "invalid");
});

test("verifyRow: a failed check is invalid and a failed fetch is an error", async () => {
  assert.equal(await verifyRow({ assessmentKey: "k", canonicalHash: "ab" }, async () => material("ab"), async () => false), "invalid");
  assert.equal(
    await verifyRow({ assessmentKey: "k", canonicalHash: "ab" }, async () => material("ab"), async () => {
      throw new Error("bad key");
    }),
    "invalid",
  );
  assert.equal(
    await verifyRow({ assessmentKey: "k", canonicalHash: "ab" }, async () => {
      throw new Error("503");
    }, async () => true),
    "error",
  );
});

test("the seal is green only when every signed record verified", () => {
  assert.equal(sealSummary(["verified", "verified"]).state, "verified");
  assert.equal(sealSummary(["verified", "error"]).state, "incomplete");
  assert.equal(sealSummary(["verified", "idle"]).state, "incomplete");
  assert.equal(sealSummary(["idle", "idle"]).state, "idle");
  assert.equal(sealSummary([]).state, "idle");
  assert.equal(sealSummary(["verified", "verifying"]).state, "verifying");
});

test("one invalid signature decides the seal, even mid-run", () => {
  const s = sealSummary(["verified", "invalid", "verifying", "error"]);
  assert.equal(s.state, "invalid");
  assert.deepEqual([s.total, s.verified, s.invalid, s.errored, s.pending], [4, 1, 1, 1, 1]);
});
