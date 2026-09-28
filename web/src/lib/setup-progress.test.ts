import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_VERIFIED_KEY, readSampleVerified, setupItems, setupProgress, writeSampleVerified } from "./setup-progress.ts";
import type { MeResponse } from "./types/me.ts";

const me = (setup: Partial<MeResponse["setup"]> = {}, consultant: Partial<MeResponse["consultant"]> = {}): MeResponse => ({
  consultant: { rcicId: "R670922", rcicLicense: "R670922", givenName: null, familyName: null, displayName: null, email: null, firm: null, province: null, ...consultant },
  preferences: {
    policyDomains: { "express-entry": true, pgwp: true, sowp: false, pgp: true, pnp: false, "study-permit": true },
    realtimeAlerts: true,
    showIdentityOnPublicReceipts: true,
  },
  onboarding: { step: 1, completedAt: null, skippedAt: null },
  signing: null,
  setup: { provisioned: true, profileComplete: false, domainsChosen: false, clientCount: 0, hasAssessments: false, ...setup },
});

const doneIds = (m: MeResponse, verified = false) => setupItems(m, verified).filter((i) => i.done).map((i) => i.id);

test("a new account has only the account item done", () => {
  const items = setupItems(me(), false);
  assert.deepEqual(setupProgress(items), { done: 1, total: 5, complete: false });
  assert.deepEqual(doneIds(me()), ["account"]);
});

test("an account without a row isn't counted as confirmed", () => {
  assert.deepEqual(doneIds(me({ provisioned: false })), []);
});

test("importing clients ticks the caseload item and says how many", () => {
  const items = setupItems(me({ clientCount: 3 }), false);
  const caseload = items.find((i) => i.id === "caseload")!;
  assert.equal(caseload.done, true);
  assert.match(caseload.detail, /3 clients/);
  assert.match(setupItems(me({ clientCount: 1 }), false).find((i) => i.id === "caseload")!.detail, /1 client in/);
});

test("practice details need both firm and province, and read back in words", () => {
  const items = setupItems(me({ profileComplete: true }, { firm: "Maple Law", province: "ON" }), false);
  const practice = items.find((i) => i.id === "practice")!;
  assert.equal(practice.done, true);
  assert.equal(practice.detail, "Maple Law, Ontario");
});

test("program areas count what's on", () => {
  const areas = setupItems(me({ domainsChosen: true }), false).find((i) => i.id === "areas")!;
  assert.equal(areas.detail, "4 of 6 areas monitored.");
});

test("everything done is complete", () => {
  const items = setupItems(me({ profileComplete: true, domainsChosen: true, clientCount: 12 }, { firm: "F", province: "BC" }), true);
  assert.deepEqual(setupProgress(items), { done: 5, total: 5, complete: true });
});

test("the sample receipt flag is the only thing that ticks the last item", () => {
  const all = { profileComplete: true, domainsChosen: true, clientCount: 12, hasAssessments: true };
  assert.equal(setupProgress(setupItems(me(all), false)).complete, false);
});

test("the flag round-trips through storage and survives blocked storage", () => {
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  assert.equal(readSampleVerified(store), false);
  assert.equal(writeSampleVerified(store, new Date("2026-09-28T12:00:00Z")), true);
  assert.equal(map.get(SAMPLE_VERIFIED_KEY), "2026-09-28T12:00:00.000Z");
  assert.equal(readSampleVerified(store), true);

  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  assert.equal(readSampleVerified(blocked), false);
  assert.equal(writeSampleVerified(blocked, new Date()), false);
  assert.equal(readSampleVerified(null), false);
});
