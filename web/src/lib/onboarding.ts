/**
 * Onboarding wizard rules, derived from GET /me. Pure, so onboarding.test.ts
 * runs it directly. The service stores `onboarding.step`, `completedAt` and
 * `skippedAt` on the argus-rcic-users row (services/me/src/model.ts).
 */

import type { MeResponse } from "./types/me.ts";

export const ONBOARDING_STEPS = [
  { step: 1, title: "Your practice" },
  { step: 2, title: "What to watch" },
  { step: 3, title: "Import caseload" },
  { step: 4, title: "How signing works" },
] as const;

export const LAST_STEP = ONBOARDING_STEPS.length;

/**
 * Whether the app should send this consultant to /onboarding.
 *
 * Finished or skipped: never. Then the one hard case is a consultant who was
 * using Argus before the wizard existed. Their row has no onboarding map, so
 * /me reports step 1 with nothing stamped, exactly like a fresh signup. We
 * tell them apart by what they've already set up: firm and province saved, a
 * client imported, or an assessment on file. A fresh signup has none of
 * those.
 *
 * A consultant part-way through the wizard has a stored step of 2 or more,
 * because leaving step 1 saves the step alongside firm and province. So they
 * keep coming back to the wizard even though their profile is now complete.
 *
 * An unprovisioned account can't save anything (PATCH /me answers 404), so
 * the wizard would be a dead end. Those stay in the app, where the setup
 * guide tells them to sign out and back in.
 */
export function needsOnboarding(me: MeResponse): boolean {
  const { onboarding, setup } = me;
  if (onboarding.completedAt || onboarding.skippedAt) return false;
  if (!setup.provisioned) return false;
  if (onboarding.step > 1) return true;
  const established = setup.profileComplete || setup.clientCount > 0 || setup.hasAssessments;
  return !established;
}

/**
 * The step the wizard opens on. A consultant who finished before and came
 * back starts over at 1. Everyone else resumes where they left off.
 */
export function startStep(me: MeResponse): number {
  if (me.onboarding.completedAt) return 1;
  return clampStep(me.onboarding.step);
}

export function clampStep(step: number): number {
  if (!Number.isInteger(step) || step < 1) return 1;
  return Math.min(step, LAST_STEP);
}
