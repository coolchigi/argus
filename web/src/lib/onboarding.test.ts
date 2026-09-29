import { test } from "node:test";
import assert from "node:assert/strict";
import { LAST_STEP, clampStep, needsOnboarding, startStep } from "./onboarding.ts";
import type { MeResponse } from "./types/me.ts";

type Overrides = {
  onboarding?: Partial<MeResponse["onboarding"]>;
  setup?: Partial<MeResponse["setup"]>;
};

// A fresh signup: row provisioned, nothing set, onboarding never touched.
const me = ({ onboarding = {}, setup = {} }: Overrides = {}): MeResponse => ({
  consultant: { rcicId: "R000001", rcicLicense: "R000001", givenName: null, familyName: null, displayName: null, email: null, firm: null, province: null },
  preferences: {
    policyDomains: { "express-entry": true, pgwp: true, sowp: true, pgp: true, pnp: true, "study-permit": true },
    realtimeAlerts: true,
    showIdentityOnPublicReceipts: true,
  },
  onboarding: { step: 1, completedAt: null, skippedAt: null, ...onboarding },
  signing: null,
  setup: { provisioned: true, profileComplete: false, domainsChosen: false, clientCount: 0, hasAssessments: false, ...setup },
});

test("a fresh signup is sent to the wizard and starts on step 1", () => {
  assert.equal(needsOnboarding(me()), true);
  assert.equal(startStep(me()), 1);
});

test("finishing or skipping the wizard lets the consultant into the app", () => {
  assert.equal(needsOnboarding(me({ onboarding: { completedAt: "2026-09-29T10:00:00Z", step: 4 } })), false);
  assert.equal(needsOnboarding(me({ onboarding: { skippedAt: "2026-09-29T10:00:00Z", step: 2 } })), false);
});

test("a consultant set up before the wizard existed isn't trapped in it", () => {
  // R670922 today: firm and province saved, no onboarding map, so /me says step 1.
  assert.equal(needsOnboarding(me({ setup: { profileComplete: true } })), false);
  // The demo tenant: no firm or province, but a caseload and signed assessments.
  assert.equal(needsOnboarding(me({ setup: { clientCount: 12 } })), false);
  assert.equal(needsOnboarding(me({ setup: { hasAssessments: true } })), false);
});

test("half-filled practice details don't count as set up", () => {
  // profileComplete needs firm and province both. Area switches alone don't count either.
  assert.equal(needsOnboarding(me({ setup: { domainsChosen: true } })), true);
});

test("a consultant mid-wizard goes back to it even after saving their practice", () => {
  // Leaving step 1 saves firm, province and step 2 in one PATCH.
  const midway = me({ onboarding: { step: 3 }, setup: { profileComplete: true, domainsChosen: true } });
  assert.equal(needsOnboarding(midway), true);
  assert.equal(startStep(midway), 3);
});

test("an account without a row isn't sent to a wizard that can't save", () => {
  assert.equal(needsOnboarding(me({ setup: { provisioned: false } })), false);
});

test("skipping keeps the step so the wizard resumes there later", () => {
  assert.equal(startStep(me({ onboarding: { step: 3, skippedAt: "2026-09-29T10:00:00Z" } })), 3);
});

test("coming back after finishing starts over at step 1", () => {
  assert.equal(startStep(me({ onboarding: { step: 4, completedAt: "2026-09-29T10:00:00Z" } })), 1);
});

test("out-of-range steps clamp into the wizard", () => {
  assert.equal(clampStep(0), 1);
  assert.equal(clampStep(-2), 1);
  assert.equal(clampStep(2.5), 1);
  assert.equal(clampStep(LAST_STEP + 3), LAST_STEP);
  assert.equal(clampStep(2), 2);
});
