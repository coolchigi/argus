import { test } from "node:test";
import assert from "node:assert/strict";
import { changeCount, describeMeError, diffDraft, draftFromMe, validateDraft, type SettingsDraft } from "./settings-draft.ts";
import type { MeResponse } from "./types/me.ts";

const me = (over: Partial<MeResponse["consultant"]> = {}, prefs: Partial<MeResponse["preferences"]> = {}): MeResponse => ({
  consultant: { rcicId: "R1", rcicLicense: "R1", givenName: "P", familyName: "S", displayName: "P S", email: "p@example.ca", firm: "Maple Law", province: "ON", ...over },
  preferences: {
    policyDomains: { "express-entry": true, pgwp: true, sowp: false, pgp: true, pnp: true, "study-permit": true },
    realtimeAlerts: true,
    showIdentityOnPublicReceipts: true,
    ...prefs,
  },
  onboarding: { step: 1, completedAt: null, skippedAt: null },
  signing: null,
  setup: { provisioned: true, profileComplete: true, domainsChosen: true, clientCount: 0, hasAssessments: false },
});

const saved = draftFromMe(me());
const edit = (fn: (d: SettingsDraft) => void): SettingsDraft => {
  const d = structuredClone(saved);
  fn(d);
  return d;
};

test("an untouched draft is clean", () => {
  assert.equal(diffDraft(saved, structuredClone(saved)), null);
  assert.equal(changeCount(saved, structuredClone(saved)), 0);
});

test("the draft is a copy, so editing it never mutates the cached /me response", () => {
  const cached = me();
  const d = draftFromMe(cached);
  d.policyDomains.pgp = false;
  assert.equal(cached.preferences.policyDomains.pgp, true);
});

test("only the area that flipped goes in the patch", () => {
  const body = diffDraft(saved, edit((d) => (d.policyDomains.pgp = false)));
  assert.deepEqual(body, { preferences: { policyDomains: { pgp: false } } });
});

test("flipping an area and flipping it back is clean again", () => {
  const d = edit((d) => {
    d.policyDomains.pgp = false;
    d.policyDomains.pgp = true;
  });
  assert.equal(diffDraft(saved, d), null);
});

test("whitespace around the firm isn't a change", () => {
  assert.equal(diffDraft(saved, edit((d) => (d.firm = "  Maple Law "))), null);
});

test("clearing firm or province sends null", () => {
  assert.deepEqual(diffDraft(saved, edit((d) => (d.firm = "   "))), { firm: null });
  assert.deepEqual(diffDraft(saved, edit((d) => (d.province = ""))), { province: null });
});

test("a missing firm and province load as empty fields", () => {
  const d = draftFromMe(me({ firm: null, province: null }));
  assert.equal(d.firm, "");
  assert.equal(d.province, "");
});

test("several changes are counted one by one", () => {
  const d = edit((d) => {
    d.firm = "New Firm";
    d.province = "BC";
    d.policyDomains.pgp = false;
    d.policyDomains.sowp = true;
    d.realtimeAlerts = false;
  });
  assert.equal(changeCount(saved, d), 5);
  assert.deepEqual(diffDraft(saved, d), {
    firm: "New Firm",
    province: "BC",
    preferences: { policyDomains: { pgp: false, sowp: true }, realtimeAlerts: false },
  });
});

test("firm length is checked after trimming, at the service's limit", () => {
  assert.equal(validateDraft(edit((d) => (d.firm = ` ${"a".repeat(120)} `))).firm, undefined);
  assert.match(validateDraft(edit((d) => (d.firm = "a".repeat(121)))).firm ?? "", /120 characters/);
});

test("a firm with a line break is rejected", () => {
  assert.ok(validateDraft(edit((d) => (d.firm = "Maple\nLaw"))).firm);
});

test("a province that isn't a code is rejected", () => {
  assert.ok(validateDraft(edit((d) => (d.province = "Ontario" as never))).province);
  assert.equal(validateDraft(edit((d) => (d.province = "QC"))).province, undefined);
});

test("known service errors get their own copy, others a generic line", () => {
  assert.match(describeMeError("invalid-province"), /province/);
  assert.match(describeMeError("concurrent-update"), /another tab/);
  assert.equal(describeMeError("internal-error"), describeMeError(null));
});

test("showing your name on public receipts is its own change", () => {
  const off = draftFromMe(me({}, { showIdentityOnPublicReceipts: false }));
  assert.equal(off.showIdentityOnPublicReceipts, false);
  const on = { ...off, showIdentityOnPublicReceipts: true };
  assert.deepEqual(diffDraft(off, on), { preferences: { showIdentityOnPublicReceipts: true } });
  assert.equal(changeCount(off, on), 1);
  assert.deepEqual(diffDraft(on, off), { preferences: { showIdentityOnPublicReceipts: false } });
});

test("a missing identity preference loads as off", () => {
  const legacy = me();
  delete (legacy.preferences as Partial<MeResponse["preferences"]>).showIdentityOnPublicReceipts;
  assert.equal(draftFromMe(legacy).showIdentityOnPublicReceipts, false);
});
