"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Ctx = {
  labels: Record<string, string>;
  setLabel: (path: string, label: string | null) => void;
};

const BreadcrumbContext = createContext<Ctx | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const setLabel = useCallback((path: string, label: string | null) => {
    setLabels((prev) => {
      if (label === null) {
        if (!(path in prev)) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      }
      if (prev[path] === label) return prev;
      return { ...prev, [path]: label };
    });
  }, []);
  return <BreadcrumbContext.Provider value={{ labels, setLabel }}>{children}</BreadcrumbContext.Provider>;
}

/**
 * A detail page calls this to name itself in the top bar, for example
 * `useBreadcrumbLabel("EE-20260922-1CBB")`. Pass null while data loads.
 */
export function useBreadcrumbLabel(label: string | null | undefined) {
  const ctx = useContext(BreadcrumbContext);
  const pathname = usePathname();
  const setLabel = ctx?.setLabel;
  useEffect(() => {
    if (!setLabel || !label) return;
    setLabel(pathname, label);
    return () => setLabel(pathname, null);
  }, [setLabel, pathname, label]);
}

export function useBreadcrumbLabels(): Record<string, string> {
  return useContext(BreadcrumbContext)?.labels ?? {};
}
