"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  number: number | string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Marks the section for the demo tour ([data-tour]). */
  tour?: string;
};

/** A § numbered section, as on the Figma impact detail. Heading is Plex Serif at the 20px floor. */
export function NumberedSection({ number, title, actions, children, className, tour }: Props) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-tour={tour} className={cn("border-t border-hairline pt-6", className)}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span aria-hidden className="font-mono text-[11px] text-ink-3">
            §{number}
          </span>
          <h2 id={headingId} className="font-display text-[20px] leading-tight text-ink-1">
            <span className="sr-only">Section {number}: </span>
            {title}
          </h2>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
