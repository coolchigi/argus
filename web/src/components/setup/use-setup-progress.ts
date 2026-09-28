"use client";

import { useSyncExternalStore } from "react";
import { useMe } from "@/lib/queries";
import {
  SAMPLE_VERIFIED_EVENT,
  SAMPLE_VERIFIED_KEY,
  readSampleVerified,
  setupItems,
  setupProgress,
  writeSampleVerified,
  type SetupItem,
} from "@/lib/setup-progress";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SAMPLE_VERIFIED_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SAMPLE_VERIFIED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SAMPLE_VERIFIED_EVENT, onChange);
  };
}

/** The browser flag behind "Verified a sample receipt". false on the server. */
export function useSampleVerified(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readSampleVerified(storage()),
    () => false,
  );
}

/** Call after a signature verifies. The sidebar and the setup page update in this tab and others. */
export function markSampleVerified(): void {
  if (writeSampleVerified(storage(), new Date())) window.dispatchEvent(new Event(SAMPLE_VERIFIED_EVENT));
}

export type SetupState = {
  items: SetupItem[];
  done: number;
  total: number;
  complete: boolean;
};

/** null until /me has loaded, so the sidebar never flashes a wrong count. */
export function useSetupProgress(options: { enabled?: boolean } = {}): SetupState | null {
  const me = useMe(options);
  const verified = useSampleVerified();
  if (!me.data) return null;
  const items = setupItems(me.data, verified);
  return { items, ...setupProgress(items) };
}
