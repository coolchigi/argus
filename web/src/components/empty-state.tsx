"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Seal } from "@/components/seal";
import { cn } from "@/lib/utils";

type Props = {
  headline: string;
  body: string;
  action?: ReactNode;
};

/**
 * Empty state per PERFORMATIVE.md Section 3d. Hexagon does one thing on
 * mount: a 400ms fill sweep from bottom to top. Then it stops. No
 * pulsing, no rotation, no cursor follow.
 */
export function EmptyState({ headline, body, action }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 30);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="flex flex-col items-center py-20 text-center">
      <div className="relative h-12 w-12">
        <Seal className="absolute inset-0 h-12 w-12 text-border" filled={false} />
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-0 bottom-0 overflow-hidden transition-[height] duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            mounted ? "h-12" : "h-0",
          )}
        >
          <Seal className="absolute inset-x-0 bottom-0 h-12 w-12 text-seal-subtle" />
        </span>
        <Seal className="relative h-12 w-12 text-seal" filled={false} />
      </div>
      <h3
        className="mt-6 text-[20px] font-medium tracking-tight text-ink-primary"
        style={{ fontFamily: "var(--font-newsreader), serif" }}
      >
        {headline}
      </h3>
      <p className="mt-2 max-w-[400px] text-[13px] leading-relaxed text-ink-secondary">
        {body}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
