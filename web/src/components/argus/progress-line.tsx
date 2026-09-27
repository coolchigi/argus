"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 1px loading line pinned to the top of its container (or the viewport with
 * `fixed`). One forward sweep per load, then it fills and fades. It never loops,
 * pulses or shimmers.
 */
export function ProgressLine({
  active,
  fixed = false,
  label = "Loading",
  className,
}: {
  active: boolean;
  fixed?: boolean;
  label?: string;
  className?: string;
}) {
  const [phase, setPhase] = useState<"idle" | "start" | "running" | "done">(active ? "start" : "idle");

  useEffect(() => {
    if (active) {
      setPhase("start");
      const id = window.requestAnimationFrame(() => setPhase("running"));
      return () => window.cancelAnimationFrame(id);
    }
    setPhase((p) => (p === "idle" ? "idle" : "done"));
    const t = window.setTimeout(() => setPhase("idle"), 320);
    return () => window.clearTimeout(t);
  }, [active]);

  if (phase === "idle") return null;

  const width = phase === "start" ? "0%" : phase === "running" ? "80%" : "100%";

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy={active}
      className={cn(
        "pointer-events-none inset-x-0 top-0 z-50 h-px",
        fixed ? "fixed" : "absolute",
        className,
      )}
    >
      <div
        className={cn(
          "h-full bg-brand",
          phase === "running" && "transition-[width] duration-[2400ms] ease-[cubic-bezier(0.2,0.9,0.3,1)]",
          phase === "done" && "opacity-0 transition-[width,opacity] duration-[220ms]",
        )}
        style={{ width }}
      />
    </div>
  );
}
