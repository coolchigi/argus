import type { SessionClaims } from "./auth.ts";

// The read-only guest view: a visitor looks around the demo caseload without
// an account. The API serves it under /guest, for reads only. The flag lives
// in sessionStorage, so it ends with the tab.

const STORAGE_KEY = "argus-guest";

export const GUEST_READ_ONLY = "This is a read-only demo. Create an account to make changes.";

// No name: the dashboard greets a guest without one, and the sidebar labels
// the session as the demo.
export const GUEST_CLAIMS: SessionClaims = { sub: "guest", email: "" };

export function isGuest(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setGuest(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(STORAGE_KEY, "1");
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked. The guest view then lasts until the page reloads.
  }
}

/**
 * Where a signed-in API call goes for a guest: reads move under /guest, and
 * writes stop here with the read-only message.
 */
export function guestRoute(path: string, method: string): { path: string } | { blocked: string } {
  if (method !== "GET") return { blocked: GUEST_READ_ONLY };
  return { path: `/guest${path.startsWith("/") ? "" : "/"}${path}` };
}
