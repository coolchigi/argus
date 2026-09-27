"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { PolicyEvent } from "@/lib/types/policy-events";
import { bannerEvents, bannerImpactSentence, formatDayMonth } from "@/components/dashboard/derive";

const STORAGE_KEY = "argus-banner-dismissed";

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage blocked or full. The banner still hides for this session.
  }
}

/**
 * Newest action-required event from the last 14 days. Static amber dot, no pulse
 * (PERFORMATIVE section 8). Dismiss records every event the banner currently
 * covers, so a newer event brings it back and a refresh doesn't.
 */
export function AlertBanner({ events }: { events: PolicyEvent[] }) {
  // null until localStorage has been read, so the banner never flashes on for dismissed events.
  const [dismissed, setDismissed] = useState<Set<string> | null>(null);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const qualifying = useMemo(() => (dismissed ? bannerEvents(events, dismissed) : []), [events, dismissed]);

  const dismiss = useCallback(() => {
    setDismissed((prev) => {
      const next = new Set(prev ?? []);
      for (const e of qualifying) next.add(e.eventId);
      writeDismissed(next);
      return next;
    });
  }, [qualifying]);

  const top = qualifying[0];
  if (!top) return null;
  const more = qualifying.length - 1;

  return (
    <section
      aria-label="Policy change that needs your attention"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-brand/40 bg-brand-subtle px-4 py-3"
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
      <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-1">
        IRCC changed <span className="font-medium">{top.title}</span> on {formatDayMonth(top.detectedAt)}.{" "}
        <span className="text-ink-2">{bannerImpactSentence(top)}</span>
      </p>
      <div className="flex shrink-0 items-center gap-3">
        {more > 0 && (
          <Link
            href="/policy-events?status=action-required"
            className="font-mono text-[11px] text-brand-ink underline-offset-4 hover:underline"
          >
            +{more} more
            <span className="sr-only"> {more === 1 ? "event needs" : "events need"} action</span>
          </Link>
        )}
        <Link
          href={`/policy-events/${encodeURIComponent(top.eventId)}`}
          className="inline-flex h-7 items-center rounded-sm border border-brand-ink bg-brand px-3 text-[12px] font-medium text-on-brand transition-colors hover:bg-brand-hover"
        >
          Review<span className="sr-only"> {top.ref}</span>
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-2 transition-colors hover:bg-sunk hover:text-ink-1"
        >
          <X aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span className="sr-only">Dismiss this alert</span>
        </button>
      </div>
    </section>
  );
}
