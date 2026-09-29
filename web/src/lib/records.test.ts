import { test } from "node:test";
import assert from "node:assert/strict";
import { matchingPreset, presetRange, rangeError, receiptHref, recordHref } from "./records.ts";
import type { LedgerEntry } from "./types/records.ts";

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  kind: "assessment",
  id: "evt-2026-09-12#C-101",
  clientId: "C-101",
  policyEventId: "evt-2026-09-12",
  topic: "express-entry-draw",
  signedAt: "2026-09-03T10:00:00.000Z",
  canonicalHash: "ab".repeat(32),
  signed: true,
  ...over,
});

test("presets use UTC calendar edges", () => {
  // 20:30 on Sep 30 in Toronto is already Oct 1 in UTC. The API takes UTC dates.
  const now = new Date("2026-10-01T00:30:00.000Z");
  assert.deepEqual(presetRange("this-month", now), { from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(presetRange("last-month", now), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(presetRange("this-year", now), { from: "2026-01-01", to: "2026-10-01" });
});

test("last month in January reaches back into the previous year", () => {
  assert.deepEqual(presetRange("last-month", new Date("2027-01-15T12:00:00.000Z")), { from: "2026-12-01", to: "2026-12-31" });
});

test("last month ends on the real last day, leap years included", () => {
  assert.deepEqual(presetRange("last-month", new Date("2028-03-10T12:00:00.000Z")), { from: "2028-02-01", to: "2028-02-29" });
});

test("a custom range matches no preset", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");
  assert.equal(matchingPreset(presetRange("last-month", now), now), "last-month");
  assert.equal(matchingPreset({ from: "2026-09-02", to: "2026-09-29" }, now), null);
});

test("rangeError catches empty, impossible and reversed ranges", () => {
  assert.equal(rangeError({ from: "2026-09-01", to: "2026-09-30" }), null);
  assert.equal(rangeError({ from: "2026-09-30", to: "2026-09-30" }), null);
  assert.match(rangeError({ from: "", to: "2026-09-30" }) ?? "", /Pick a start/);
  assert.match(rangeError({ from: "2026-02-30", to: "2026-03-01" }) ?? "", /Pick a start/);
  assert.match(rangeError({ from: "2026-09-30", to: "2026-09-01" }) ?? "", /after the end/);
});

test("rows link to the right screen, with the # in assessment keys encoded", () => {
  assert.equal(recordHref(entry()), "/impacts/evt-2026-09-12%23C-101");
  assert.equal(recordHref(entry({ kind: "brief", id: "b-1" })), "/briefs/b-1");
});

test("only signed assessments get a public receipt link", () => {
  assert.equal(receiptHref(entry()), `/verify/${"ab".repeat(32)}`);
  assert.equal(receiptHref(entry({ kind: "brief" })), undefined);
  assert.equal(receiptHref(entry({ signed: false })), undefined);
});
