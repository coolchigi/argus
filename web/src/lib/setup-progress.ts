/**
 * Setup guide checklist, derived from GET /me plus one browser flag. Pure, so
 * setup-progress.test.ts runs it directly. Section 7.8 of FIGMA_MAPPING.
 *
 * Two-step sign-in (plan Phase D item 5) isn't on the list yet because
 * Settings doesn't offer it yet.
 */

import { PROVINCE_LABELS } from "./settings-draft.ts";
import type { MeResponse } from "./types/me.ts";

export type SetupItemId = "account" | "practice" | "areas" | "caseload" | "sample-receipt";

export type SetupItem = {
  id: SetupItemId;
  title: string;
  done: boolean;
  /** One line under the title. Says what's there when done, what to do when not. */
  detail: string;
};

/** Set by the verify page and the in-app receipt after a signature checks out. */
export const SAMPLE_VERIFIED_KEY = "argus.setup.sampleReceiptVerified";
/** Fired on window when this tab sets the flag. The storage event only reaches other tabs. */
export const SAMPLE_VERIFIED_EVENT = "argus:sample-verified";

export function setupItems(me: MeResponse, sampleVerified: boolean): SetupItem[] {
  const { setup, consultant } = me;
  const clients = setup.clientCount;
  return [
    {
      id: "account",
      title: "Account confirmed",
      done: setup.provisioned,
      detail: setup.provisioned
        ? `Signed in as RCIC ${consultant.rcicLicense ?? consultant.rcicId}.`
        : "Argus hasn't finished creating your account. Sign out and back in.",
    },
    {
      id: "practice",
      title: "Practice details",
      done: setup.profileComplete,
      detail: setup.profileComplete
        ? [consultant.firm, consultant.province ? PROVINCE_LABELS[consultant.province] : null].filter(Boolean).join(", ")
        : "Add your firm and province.",
    },
    {
      id: "areas",
      title: "Program areas chosen",
      done: setup.domainsChosen,
      detail: setup.domainsChosen
        ? `${Object.values(me.preferences.policyDomains).filter(Boolean).length} of ${Object.keys(me.preferences.policyDomains).length} areas monitored.`
        : "Pick the IRCC program areas Argus watches for you.",
    },
    {
      id: "caseload",
      title: "Caseload imported",
      done: clients > 0,
      detail: clients > 0 ? `${clients} ${clients === 1 ? "client" : "clients"} in your caseload.` : "Import a CSV of case numbers and programs.",
    },
    {
      id: "sample-receipt",
      title: "Verified a sample receipt",
      done: sampleVerified,
      detail: sampleVerified
        ? "You've checked a signature in your browser."
        : "Check one signed receipt in your browser, so you know what your clients will see.",
    },
  ];
}

export function setupProgress(items: SetupItem[]): { done: number; total: number; complete: boolean } {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, complete: done === items.length };
}

type ReadStore = Pick<Storage, "getItem"> | null | undefined;
type WriteStore = Pick<Storage, "setItem"> | null | undefined;

export function readSampleVerified(store: ReadStore): boolean {
  try {
    return store?.getItem(SAMPLE_VERIFIED_KEY) != null;
  } catch {
    return false;
  }
}

/** Stores when it happened. Returns false when storage is blocked. */
export function writeSampleVerified(store: WriteStore, at: Date): boolean {
  try {
    if (!store) return false;
    store.setItem(SAMPLE_VERIFIED_KEY, at.toISOString());
    return true;
  } catch {
    return false;
  }
}
